// Structured analysis intake and recommendation delivery.
// The core does not score bookmark text. It accepts a decision object and
// checks that actionable sources point at the archived post.

import fs from "node:fs";
import { withLock } from "../../../x-bookmark-export/scripts/lib/lock.mjs";
import {
  WorkflowError,
  archiveHash,
  assertAccountId,
  containedFile,
  sha256Text,
  stableStringify,
  validTime,
} from "../../../x-bookmark-export/scripts/lib/pure.mjs";
import {
  ensureArchive,
  listRecords,
  readJson,
  readKey,
  readPost,
  readRecord,
  transitionRecord,
  writeJsonAtomic,
  writeRecord,
} from "../../../x-bookmark-export/scripts/lib/store.mjs";
import { issueReceipt } from "./receipts.mjs";

export const MAX_SUGGESTIONS = 3;
export const ANALYSIS_KEYS = new Set(["schema", "account_id", "generated_at", "items"]);
export const ITEM_KEYS = new Set([
  "post_id",
  "archive_sha256",
  "disposition",
  "rationale",
  "suggestion",
  "unhelpful_reason",
]);
export const SUGGESTION_KEYS = new Set(["title", "detail", "source_url"]);
export const DISPOSITIONS = new Set(["actionable", "unhelpful", "keep", "uncertain"]);
const FORBIDDEN = new Set([
  "delivered",
  "unbookmark",
  "delete",
  "command",
  "shell",
  "cleanup_succeeded",
  "execute",
  "argv",
  "consent",
  "rm",
]);

function assertKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError("invalid_schema", `${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key)) {
      throw new WorkflowError("invalid_schema", `${label} contains forbidden key ${key}`);
    }
    if (!allowed.has(key)) {
      throw new WorkflowError("invalid_schema", `${label} contains unknown key ${key}`);
    }
  }
}

function assertText(value, label, min, max) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new WorkflowError("invalid_schema", `${label} must be ${min}-${max} characters`);
  }
  return value.trim();
}

export function suggestionKey(suggestion) {
  const title = suggestion.title.trim().toLowerCase().replace(/\s+/g, " ");
  return `${title}\n${suggestion.source_url}`;
}

export function sourceIsGrounded(post, sourceUrl) {
  if (typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://")) return false;
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  if (sourceUrl === post.url) return true;
  return (post.links || []).some((link) => link && (link.expanded_url === sourceUrl || link.url === sourceUrl));
}

function parseSuggestion(value, postId) {
  if (value == null) return null;
  assertKeys(value, SUGGESTION_KEYS, `suggestion ${postId}`);
  const title = assertText(value.title, "suggestion title", 4, 140);
  if (/[\r\n]/.test(title)) throw new WorkflowError("invalid_schema", "suggestion title must be one line");
  const detail = assertText(value.detail, "suggestion detail", 12, 2000);
  const source = assertText(value.source_url, "source_url", 12, 500);
  return { title, detail, source_url: source };
}

export function parseAnalysis(input, accountId) {
  assertAccountId(accountId);
  assertKeys(input, ANALYSIS_KEYS, "analysis");
  if (input.schema !== "x-bookmark-analysis/1") {
    throw new WorkflowError("invalid_schema", "analysis schema must be x-bookmark-analysis/1");
  }
  if (input.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "analysis account does not match the archive");
  }
  if (!validTime(input.generated_at)) {
    throw new WorkflowError("invalid_schema", "analysis generated_at must be an ISO time");
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
    throw new WorkflowError("invalid_schema", "analysis items must be a non-empty list of at most 100");
  }
  const seen = new Set();
  const items = input.items.map((item) => {
    assertKeys(item, ITEM_KEYS, "analysis item");
    if (typeof item.post_id !== "string" || seen.has(item.post_id)) {
      throw new WorkflowError("invalid_schema", "analysis post ids must be unique strings");
    }
    seen.add(item.post_id);
    if (typeof item.archive_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.archive_sha256)) {
      throw new WorkflowError("invalid_schema", "archive_sha256 must be a sha256 hex string");
    }
    if (!DISPOSITIONS.has(item.disposition)) {
      throw new WorkflowError("invalid_schema", "disposition is not recognized");
    }
    const rationale = assertText(item.rationale, "rationale", 12, 2000);
    const suggestion = parseSuggestion(item.suggestion, item.post_id);
    let unhelpful = null;
    if (item.disposition === "actionable") {
      if (!suggestion) throw new WorkflowError("invalid_schema", "actionable items need a suggestion");
      if (item.unhelpful_reason != null) {
        throw new WorkflowError("invalid_schema", "actionable items cannot include unhelpful_reason");
      }
    } else if (suggestion) {
      throw new WorkflowError("invalid_schema", "only actionable items include a suggestion");
    }
    if (item.disposition === "unhelpful") {
      unhelpful = assertText(item.unhelpful_reason, "unhelpful_reason", 8, 500);
    } else if (item.unhelpful_reason != null) {
      throw new WorkflowError("invalid_schema", "unhelpful_reason is only valid for unhelpful items");
    }
    return {
      post_id: item.post_id,
      archive_sha256: item.archive_sha256,
      disposition: item.disposition,
      rationale,
      suggestion,
      unhelpful_reason: unhelpful,
    };
  });
  return {
    schema: input.schema,
    account_id: accountId,
    generated_at: validTime(input.generated_at),
    items,
  };
}

export function renderRecommendationBody({ accountId, generatedAt, suggestions }) {
  const lines = [
    "A bookmark records interest. It is not an endorsement.",
    "书签表示兴趣，不是认同。",
    `account_id: ${accountId}`,
    `generated_at: ${generatedAt}`,
    "",
  ];
  suggestions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(item.detail);
    lines.push(`source: ${item.source_url}`);
    lines.push(`post: ${item.post_id}`);
    lines.push("");
  });
  return `${lines.join("\n")}`;
}

export function acceptAnalysis(root, accountId, input, deps = {}) {
  const parsed = parseAnalysis(input, accountId);
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => acceptAnalysisLocked(root, accountId, parsed, paths, deps), deps.lock);
}

function acceptAnalysisLocked(root, accountId, parsed, paths, deps) {
  const now = (deps.now || (() => new Date().toISOString()))();
  const planned = [];
  for (const item of parsed.items) {
    let record;
    try {
      record = readRecord(root, accountId, item.post_id, deps);
    } catch (error) {
      if (error.code === "not_found") {
        throw new WorkflowError("not_found", `archived post ${item.post_id} was not found`);
      }
      throw error;
    }
    if (record.account_id !== accountId) {
      throw new WorkflowError("account_mismatch", "record account does not match");
    }
    if (record.status !== "fetched" && record.status !== "analyzed") {
      throw new WorkflowError("state_conflict", `post ${item.post_id} cannot move backward from ${record.status}`);
    }
    const post = readPost(root, accountId, item.post_id, deps);
    if (archiveHash(post) !== item.archive_sha256) {
      throw new WorkflowError("invalid_schema", `archive hash mismatch for ${item.post_id}`);
    }
    if (item.disposition === "actionable" && !sourceIsGrounded(post, item.suggestion.source_url)) {
      throw new WorkflowError("unverified_source", `suggestion source is not in the archived post ${item.post_id}`);
    }
    planned.push({ item, record });
  }
  const analysisId = sha256Text(stableStringify(parsed)).slice(0, 24);
  const analysisFile = containedFile(paths.analysis, `${analysisId}.json`);
  writeJsonAtomic(analysisFile, parsed, deps);
  for (const { item, record } of planned) {
    const next = transitionRecord(record, "analyzed", "analysis_accepted", now, {
      analysis_id: analysisId,
      content_status: record.content_status,
    });
    writeRecord(root, accountId, next, deps);
  }
  return {
    ok: true,
    analysis_id: analysisId,
    items: planned.length,
    statuses: planned.map(({ item }) => item.disposition),
  };
}

export function deliverRecommendations(root, accountId, deps = {}) {
  assertAccountId(accountId);
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => deliverLocked(root, accountId, paths, deps), deps.lock);
}

function deliverLocked(root, accountId, paths, deps) {
  const now = (deps.now || (() => new Date().toISOString()))();
  const nowMs = Date.parse(now);
  const records = listRecords(root, accountId, deps);
  const index = readJson(paths.suggestionIndex, deps);
  const seen = new Set((index.entries || []).map((entry) => entry.key));
  const chosen = [];
  for (const record of records) {
    if (record.status !== "analyzed" || record.notified || record.content_status === "incomplete") continue;
    if (!record.analysis_id) continue;
    const analysis = readJson(containedFile(paths.analysis, `${record.analysis_id}.json`), deps);
    const item = analysis.items.find((candidate) => candidate.post_id === record.post_id);
    if (!item || item.disposition !== "actionable" || !item.suggestion) continue;
    const post = readPost(root, accountId, record.post_id, deps);
    if (!sourceIsGrounded(post, item.suggestion.source_url)) continue;
    const key = suggestionKey(item.suggestion);
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push({
      post_id: record.post_id,
      title: item.suggestion.title,
      detail: item.suggestion.detail,
      source_url: item.suggestion.source_url,
      key,
      record,
    });
    if (chosen.length === MAX_SUGGESTIONS) break;
  }
  if (chosen.length === 0) {
    return { ok: true, silent: true, suggestions: [], notified: [], body: null };
  }
  const body = renderRecommendationBody({ accountId, generatedAt: now, suggestions: chosen });
  const recommendationId = sha256Text(body).slice(0, 24);
  const keyHex = readKey(root, accountId, deps);
  const receipt = issueReceipt({
    keyHex,
    accountId,
    recommendationId,
    postIds: chosen.map((item) => item.post_id),
    body,
    nowMs,
  });
  const bodyFile = containedFile(paths.recommendations, `${recommendationId}.md`);
  const metaFile = containedFile(paths.recommendations, `${recommendationId}.json`);
  const receiptFile = containedFile(paths.receipts, `${receipt.receipt_id}.json`);
  const writer = deps.fs || fs;
  writeJsonAtomic(metaFile, {
    schema: 1,
    recommendation_id: recommendationId,
    account_id: accountId,
    post_ids: chosen.map((item) => item.post_id),
    receipt_id: receipt.receipt_id,
    generated_at: now,
  }, deps);
  writer.mkdirSync(paths.recommendations, { recursive: true, mode: 0o700 });
  if (deps.failOn && deps.failOn(bodyFile)) {
    throw new WorkflowError("archive_failed", "failed to write recommendation body");
  }
  writer.writeFileSync(bodyFile, body, { mode: 0o600 });
  writeJsonAtomic(receiptFile, receipt, deps);
  const notified = [];
  for (const item of chosen) {
    const next = transitionRecord(item.record, "recommendation_delivered", "recommendation_delivered", now, {
      read: true,
      notified: true,
      recommendation_id: recommendationId,
      delivery_receipt_id: receipt.receipt_id,
    });
    writeRecord(root, accountId, next, deps);
    notified.push(item.post_id);
  }
  const entries = [
    ...(index.entries || []),
    ...chosen.map((item) => ({
      key: item.key,
      post_id: item.post_id,
      recommendation_id: recommendationId,
      title: item.title,
    })),
  ];
  writeJsonAtomic(paths.suggestionIndex, { schema: 1, entries }, deps);
  return {
    ok: true,
    silent: false,
    recommendation_id: recommendationId,
    receipt_id: receipt.receipt_id,
    suggestions: chosen.map(({ post_id, title, source_url }) => ({ post_id, title, source_url })),
    notified,
    body,
    interest_not_endorsement: true,
  };
}
