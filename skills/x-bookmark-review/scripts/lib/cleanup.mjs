// Cleanup is a separate step from analysis. Default output is a plan.
// Removal is an unbookmark allowlist, never a post delete and never a blanket wipe.

import fs from "node:fs";
import {
  WorkflowError,
  accountPaths,
  archiveHash,
  assertAccountId,
  assertPostId,
  containedFile,
  removeBookmarkCall,
  sha256Text,
  stableStringify,
} from "../../../x-bookmark-export/scripts/lib/pure.mjs";
import {
  ensureArchive,
  listRecords,
  readConsent,
  readJson,
  readKey,
  readPost,
  readRecord,
  readScan,
  transitionRecord,
  writeJsonAtomic,
  writeRecord,
} from "../../../x-bookmark-export/scripts/lib/store.mjs";
import { withLock } from "../../../x-bookmark-export/scripts/lib/lock.mjs";
import { PLAN_TTL_MS, receiptProblem, signPayload, verifyPayload } from "./receipts.mjs";

export const MAX_CLEANUP_ATTEMPTS = 2;
export const DEFAULT_CAP = 10;
export const MAX_CAP = 25;
export function accountAudit(root, accountId, deps = {}) {
  const paths = ensureArchive(root, accountId, deps);
  const scan = readScan(root, accountId, deps);
  const records = listRecords(root, accountId, deps);
  const pendingDelivery = [];
  const writer = deps.fs || fs;
  if (writer.existsSync(paths.recommendations)) {
    for (const name of writer.readdirSync(paths.recommendations)) {
      if (!name.endsWith(".json")) continue;
      const meta = readJson(containedFile(paths.recommendations, name), deps);
      if (meta && meta.delivery_registered !== true) pendingDelivery.push(meta.recommendation_id);
    }
  }
  const rows = records.map((record) => ({
    post_id: record.post_id,
    status: record.status,
    content_status: record.content_status,
    read: record.read === true,
    notified: record.notified === true,
    delivery_registered: Boolean(record.delivery_receipt_id),
    needs_reconcile: Boolean(record.cleanup_attempt?.remove_dispatched && !record.cleanup_attempt?.remove_acked),
    cleanup_error: record.cleanup_attempt?.last_error || null,
  }));
  return {
    ok: true,
    account_id: accountId,
    scan_complete: scan.complete === true,
    incomplete_reason: scan.complete ? null : scan.incomplete_reason,
    has_next_token: Boolean(scan.next_token),
    claims_full_absence: false,
    pending_delivery: pendingDelivery,
    retained_incomplete_or_uncertain: rows.filter((row) => row.content_status !== "complete").map((row) => row.post_id),
    rows,
  };
}

export function mapConnectorUnbookmarkReceipt(payload, { accountId, tweetId } = {}) {
  assertAccountId(accountId);
  assertPostId(tweetId);
  const body = connectorReceiptBody(payload);
  const bookmarked = body && body.data ? body.data.bookmarked : undefined;
  if (typeof bookmarked !== "boolean") {
    throw new WorkflowError(
      "invalid_schema",
      "connector receipt must contain data.bookmarked as a boolean and does not name a post id",
    );
  }
  return {
    account_id: accountId,
    results: [{
      tweet_id: tweetId,
      removed: bookmarked === false,
      error: bookmarked === false ? null : "still_bookmarked",
    }],
    mapped_from: "connector-data-bookmarked",
    receipt_names_post: false,
  };
}

function connectorReceiptBody(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  if (typeof payload !== "string") return null;
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(payload.slice(start, end + 1));
  } catch {
    return null;
  }
}

export const UNBOOKMARK_NOTICE = "Removing a bookmark does not delete the original post. Bookmarking it again may not restore the previous order or folder.";
export const UNBOOKMARK_NOTICE_ZH = "取消书签不会删除原帖。重新加入书签不一定能恢复原来的顺序或文件夹。";

function clock(deps) {
  return (deps.now || (() => new Date().toISOString()))();
}

function block(postId, reason) {
  return { eligible: false, blocked: { post_id: postId, reason } };
}

function analysisItem(root, accountId, record, deps) {
  if (!record.analysis_id) return null;
  try {
    const paths = accountPaths(root, accountId);
    const analysis = readJson(containedFile(paths.analysis, `${record.analysis_id}.json`), deps);
    return analysis.items.find((item) => item.post_id === record.post_id) || null;
  } catch {
    return null;
  }
}

export function classifyRecord(root, accountId, record, { consent, keyHex, nowMs, deps = {} }) {
  const postId = record.post_id;
  if (record.account_id !== accountId) return block(postId, "account_mismatch");
  if (record.status === "cleanup_succeeded") return block(postId, "already_succeeded");
  if (record.cleanup_attempt?.remove_dispatched && !record.cleanup_attempt?.remove_acked) {
    return block(postId, "needs_reconcile");
  }
  if ((record.cleanup_attempt?.count || 0) >= MAX_CLEANUP_ATTEMPTS) {
    return block(postId, "retries_exhausted");
  }
  let post;
  try {
    post = readPost(root, accountId, postId, deps);
  } catch {
    return block(postId, "archive_missing");
  }
  if (archiveHash(post) !== record.archive_sha256) return block(postId, "hash_mismatch");
  if (post.content_status === "incomplete") return block(postId, "content_not_complete");
  const item = analysisItem(root, accountId, record, deps);
  if (!item) return block(postId, "missing_analysis");
  if (item.disposition === "keep" || item.disposition === "uncertain") return block(postId, "not_cleanup");
  if (item.disposition === "unhelpful") {
    if (post.content_status !== "complete") return block(postId, "content_not_complete");
    if (!item.unhelpful_reason) return block(postId, "missing_reason");
    if (consent.discard_unhelpful !== true) return block(postId, "no_consent");
    return {
      eligible: true,
      item: {
        post_id: postId,
        reason: "unhelpful",
        archive_sha256: record.archive_sha256,
        analysis_id: record.analysis_id,
        receipt_id: null,
        content_status: post.content_status,
      },
    };
  }
  if (item.disposition !== "actionable") return block(postId, "not_cleanup");
  if (!record.notified || !record.delivery_receipt_id || !record.recommendation_id) {
    return block(postId, "delivery_required");
  }
  if (!["recommendation_delivered", "cleanup_planned", "cleanup_failed"].includes(record.status)) {
    return block(postId, "delivery_required");
  }
  if (consent.cleanup_processed !== true) return block(postId, "no_consent");
  const paths = accountPaths(root, accountId);
  let receipt;
  let body;
  try {
    receipt = readJson(containedFile(paths.receipts, `${record.delivery_receipt_id}.json`), deps);
    body = (deps.fs || fs).readFileSync(
      containedFile(paths.recommendations, `${record.recommendation_id}.md`),
      "utf8",
    );
  } catch {
    return block(postId, "receipt_forged");
  }
  const problem = receiptProblem(keyHex, receipt, {
    accountId,
    nowMs,
    body,
    postId,
    recommendationId: record.recommendation_id,
  });
  if (problem) return block(postId, problem);
  if (!body.includes(item.suggestion.source_url)) return block(postId, "receipt_body_mismatch");
  return {
    eligible: true,
    item: {
      post_id: postId,
      reason: "processed",
      archive_sha256: record.archive_sha256,
      analysis_id: record.analysis_id,
      receipt_id: receipt.receipt_id,
      content_status: post.content_status,
    },
  };
}

export function buildPlan(root, accountId, opts = {}) {
  const cap = opts.cap ?? DEFAULT_CAP;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAP) {
    throw new WorkflowError("invalid_arg", "cap must be an integer from 1 to 25");
  }
  const deps = opts.deps || {};
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = clock(deps);
    const nowMs = Date.parse(now);
    const consent = readConsent(root, accountId, deps);
    const keyHex = readKey(root, accountId, deps);
    const records = listRecords(root, accountId, deps);
    const eligible = [];
    const blocked = [];
    for (const record of records) {
      const result = classifyRecord(root, accountId, record, { consent, keyHex, nowMs, deps });
      if (result.eligible) eligible.push(result.item);
      else blocked.push(result.blocked);
    }
    const items = eligible.slice(0, cap);
    for (const extra of eligible.slice(cap)) blocked.push({ post_id: extra.post_id, reason: "over_cap" });
    const unsigned = {
      schema: "x-bookmark-cleanup-plan/1",
      account_id: accountId,
      created_at: now,
      expires_at: new Date(nowMs + PLAN_TTL_MS).toISOString(),
      cap,
      items,
    };
    const planId = sha256Text(stableStringify(unsigned)).slice(0, 24);
    const plan = signPayload(keyHex, { ...unsigned, plan_id: planId });
    writeJsonAtomic(containedFile(paths.plans, `${planId}.json`), plan, deps);
    for (const item of items) {
      const record = records.find((candidate) => candidate.post_id === item.post_id);
      writeRecord(root, accountId, transitionRecord(record, "cleanup_planned", "cleanup_planned", now, {
        cleanup_plan_id: planId,
      }), deps);
    }
    return {
      ok: true,
      dry_run: true,
      issue: false,
      plan_id: planId,
      items,
      blocked,
      connector_ops: [],
      notice: UNBOOKMARK_NOTICE,
      notice_zh: UNBOOKMARK_NOTICE_ZH,
    };
  }, deps.lock);
}

function loadPlan(root, accountId, planId, deps) {
  const paths = accountPaths(root, accountId);
  const plan = readJson(containedFile(paths.plans, `${planId}.json`), deps);
  const keyHex = readKey(root, accountId, deps);
  if (!verifyPayload(keyHex, plan) || plan.schema !== "x-bookmark-cleanup-plan/1" || plan.plan_id !== planId) {
    throw new WorkflowError("forged_plan", "cleanup plan signature does not match this account");
  }
  if (plan.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "cleanup plan is for a different account");
  }
  if (!Array.isArray(plan.items) || plan.items.length > plan.cap || plan.cap > MAX_CAP || plan.cap < 1) {
    throw new WorkflowError("invalid_schema", "cleanup plan cap is invalid");
  }
  for (const item of plan.items) assertPostId(item.post_id);
  return { plan, keyHex, paths };
}

export function prepareApply(root, accountId, planId, opts = {}) {
  const deps = opts.deps || {};
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = clock(deps);
    const { plan, keyHex } = loadPlan(root, accountId, planId, deps);
    const base = {
      plan_id: planId,
      notice: UNBOOKMARK_NOTICE,
      notice_zh: UNBOOKMARK_NOTICE_ZH,
      deletes_post: false,
    };
    if (opts.yes !== true) {
      return {
        ...base,
        ok: true,
        exit: 3,
        dry_run: true,
        issue: false,
        connector_ops: [],
        preview: plan.items,
      };
    }
    if (!(Date.parse(plan.expires_at) > Date.parse(now))) {
      throw new WorkflowError("stale_plan", "cleanup plan has expired");
    }
    const consent = readConsent(root, accountId, deps);
    const reserved = [];
    const blocked = [];
    const needs = [];
    const skipped = [];
    for (const item of plan.items) {
      const record = readRecord(root, accountId, item.post_id, deps);
      if (record.cleanup_plan_id !== plan.plan_id) {
        blocked.push({ post_id: item.post_id, reason: "stale_plan_binding" });
        continue;
      }
      if (record.status === "cleanup_succeeded") {
        skipped.push({ post_id: item.post_id, reason: "already_succeeded" });
        continue;
      }
      if (record.cleanup_attempt.remove_dispatched && !record.cleanup_attempt.remove_acked) {
        needs.push(item.post_id);
        continue;
      }
      const result = classifyRecord(root, accountId, record, {
        consent,
        keyHex,
        nowMs: Date.parse(now),
        deps,
      });
      if (!result.eligible || result.item.reason !== item.reason) {
        blocked.push(result.blocked || { post_id: item.post_id, reason: "plan_mismatch" });
        continue;
      }
      const attempt = {
        ...record.cleanup_attempt,
        count: record.cleanup_attempt.count + 1,
        remove_dispatched: true,
        remove_acked: false,
        last_attempt_at: now,
        last_error: null,
      };
      writeRecord(root, accountId, {
        ...record,
        status: "cleanup_planned",
        cleanup_attempt: attempt,
        history: [...record.history, { at: now, status: "cleanup_planned", reason: "removal_reserved" }],
      }, deps);
      reserved.push(item);
    }
    const connectorOps = reserved.map((item) => removeBookmarkCall({
      accountId,
      tweetId: item.post_id,
    }));
    if (reserved.length > 0) {
      writeJsonAtomic(paths.pendingRemoval, signPayload(keyHex, {
        schema: 1,
        account_id: accountId,
        plan_id: plan.plan_id,
        tweet_ids: reserved.map((item) => item.post_id),
        created_at: now,
      }), deps);
    }
    return {
      ...base,
      ok: blocked.length === 0 && needs.length === 0,
      exit: 0,
      dry_run: false,
      issue: connectorOps.length > 0,
      awaiting_connector: connectorOps.length > 0,
      connector_ops: connectorOps,
      reserved: reserved.map((item) => item.post_id),
      blocked,
      needs_reconcile: needs,
      skipped,
      partial: blocked.length > 0 || needs.length > 0,
    };
  }, deps.lock);
}

export function commitRemoval(root, accountId, results, deps = {}) {
  if (!results || results.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "removal results are for a different account");
  }
  if (!Array.isArray(results.results)) {
    throw new WorkflowError("invalid_schema", "removal results must be a list");
  }
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = clock(deps);
    const summary = { succeeded: [], failed: [], skipped: [], rejected: [] };
    for (const row of results.results) {
      const postId = row && row.tweet_id;
      try {
        assertPostId(postId);
      } catch {
        summary.rejected.push({ post_id: String(postId), error: "invalid_id" });
        continue;
      }
      let record;
      try {
        record = readRecord(root, accountId, postId, deps);
      } catch {
        summary.rejected.push({ post_id: postId, error: "not_dispatched" });
        continue;
      }
      if (record.account_id !== accountId) {
        summary.rejected.push({ post_id: postId, error: "account_mismatch" });
        continue;
      }
      if (record.status === "cleanup_succeeded" && record.cleanup_attempt.remove_acked) {
        summary.skipped.push({ post_id: postId, reason: "already_succeeded" });
        continue;
      }
      if (!record.cleanup_attempt.remove_dispatched || record.cleanup_attempt.remove_acked) {
        summary.rejected.push({ post_id: postId, error: "not_dispatched" });
        continue;
      }
      if (deps.failCommitIds && deps.failCommitIds.has(postId)) {
        summary.failed.push({ post_id: postId, error: "commit_failed", removed: row.removed === true });
        continue;
      }
      const removed = row.removed === true;
      const next = transitionRecord(
        record,
        removed ? "cleanup_succeeded" : "cleanup_failed",
        removed ? "cleanup_succeeded" : "cleanup_failed",
        now,
        {
          cleanup_attempt: {
            ...record.cleanup_attempt,
            remove_acked: true,
            last_error: removed ? null : (typeof row.error === "string" ? row.error : "not_removed"),
          },
        },
      );
      writeRecord(root, accountId, next, deps);
      if (removed) summary.succeeded.push(postId);
      else summary.failed.push({ post_id: postId, error: next.cleanup_attempt.last_error });
    }
    const partial = summary.failed.length > 0 || summary.rejected.length > 0;
    return {
      ok: !partial,
      partial,
      exit: partial ? 1 : 0,
      ...summary,
      archive_retained: true,
      notice: UNBOOKMARK_NOTICE,
      notice_zh: UNBOOKMARK_NOTICE_ZH,
    };
  }, deps.lock);
}

export function reconcilePresence(root, accountId, presence, deps = {}) {
  if (!presence || presence.account_id !== accountId || !Array.isArray(presence.posts)) {
    throw new WorkflowError("account_mismatch", "presence check does not match this account");
  }
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = clock(deps);
    const known = new Map();
    for (const row of presence.posts) {
      if (!row || typeof row.post_id !== "string") continue;
      known.set(row.post_id, row.present);
    }
    const succeeded = [];
    const retryAllowed = [];
    const exhausted = [];
    const unresolved = [];
    for (const record of listRecords(root, accountId, deps)) {
      if (!record.cleanup_attempt.remove_dispatched || record.cleanup_attempt.remove_acked) continue;
      if (!known.has(record.post_id) || (known.get(record.post_id) !== true && known.get(record.post_id) !== false)) {
        unresolved.push(record.post_id);
        continue;
      }
      const present = known.get(record.post_id);
      if (present === false) {
        writeRecord(root, accountId, transitionRecord(record, "cleanup_succeeded", "reconciled_absent", now, {
          cleanup_attempt: { ...record.cleanup_attempt, remove_acked: true, last_error: null },
        }), deps);
        succeeded.push(record.post_id);
        continue;
      }
      const tooMany = record.cleanup_attempt.count >= MAX_CLEANUP_ATTEMPTS;
      writeRecord(root, accountId, transitionRecord(
        record,
        tooMany ? "cleanup_failed" : "cleanup_planned",
        "reconciled_present",
        now,
        {
          cleanup_attempt: {
            ...record.cleanup_attempt,
            remove_dispatched: false,
            remove_acked: true,
            last_error: "still_present",
          },
        },
      ), deps);
      if (tooMany) exhausted.push(record.post_id);
      else retryAllowed.push(record.post_id);
    }
    return {
      ok: unresolved.length === 0 && exhausted.length === 0,
      succeeded,
      retry_allowed: retryAllowed,
      exhausted,
      unresolved,
      connector_ops: [],
      archive_retained: true,
    };
  }, deps.lock);
}

export function runAdapterApply(root, accountId, planId, opts) {
  const prepared = prepareApply(root, accountId, planId, opts);
  if (prepared.dry_run) return { ...prepared, adapter_calls: 0 };
  const results = [];
  let adapterCalls = 0;
  for (const op of prepared.connector_ops) {
    adapterCalls += 1;
    try {
      const ack = opts.adapter.remove({ accountId, tweetId: op.arguments.tweet_id });
      results.push({
        tweet_id: op.arguments.tweet_id,
        removed: Boolean(ack && ack.removed === true),
        error: ack && ack.error,
      });
    } catch (error) {
      results.push({ tweet_id: op.arguments.tweet_id, removed: false, error: error.message });
    }
  }
  if (results.length === 0) return { ...prepared, adapter_calls: 0, commit: null };
  const commit = commitRemoval(root, accountId, { account_id: accountId, results }, opts.deps || {});
  return { ...prepared, adapter_calls: adapterCalls, commit };
}
