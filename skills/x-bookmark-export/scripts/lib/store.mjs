// Account-scoped archive. Original post JSON is written before scan state advances.
// No session cookies, no media bytes, no network.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renderExportDocument, renderExportMarkdown } from "./export-doc.mjs";
import { withLock } from "./lock.mjs";
import {
  WorkflowError,
  accountPaths,
  assertAccountId,
  containedFile,
  decideIngest,
  emptyScan,
  initialRecord,
  normalizePage,
  postPath,
  recordPath,
} from "./pure.mjs";

function useFs(deps) {
  return deps.fs || fs;
}

export function writeJsonAtomic(file, value, deps = {}) {
  const fsImpl = useFs(deps);
  if (deps.failOn && deps.failOn(file)) {
    throw new WorkflowError("archive_failed", `failed to write ${path.basename(file)}`);
  }
  const dir = path.dirname(file);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fsImpl.openSync(tmp, "w", 0o600);
  try {
    fsImpl.writeSync(fd, data);
    if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
  try {
    fsImpl.renameSync(tmp, file);
  } catch (error) {
    try { fsImpl.unlinkSync(tmp); } catch { /* the temp file may already be gone */ }
    throw error;
  }
  return file;
}

export function readJson(file, deps = {}) {
  const fsImpl = useFs(deps);
  try {
    return JSON.parse(fsImpl.readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new WorkflowError("not_found", `missing ${path.basename(file)}`);
    }
    throw new WorkflowError("invalid_schema", `unreadable JSON at ${path.basename(file)}`);
  }
}

function nowIso(deps) {
  return (deps.now || (() => new Date().toISOString()))();
}

function defaultConsent(accountId, now) {
  return {
    schema: 1,
    account_id: accountId,
    cleanup_processed: false,
    discard_unhelpful: false,
    updated_at: now,
    source: "default-preview",
  };
}

function createKey() {
  return crypto.randomBytes(32).toString("hex");
}

export function ensureArchive(root, accountId, deps = {}) {
  assertAccountId(accountId);
  const paths = accountPaths(root, accountId);
  const fsImpl = useFs(deps);
  return withLock(paths.dir, () => {
    const now = nowIso(deps);
    fsImpl.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    if (!fsImpl.existsSync(paths.manifest)) {
      writeJsonAtomic(paths.manifest, {
        schema: 1,
        account_id: accountId,
        created_at: now,
        runtime: "grok-x-connector",
        ego_browser: "unsupported",
      }, deps);
      writeJsonAtomic(paths.key, { schema: 1, mac_key_hex: createKey() }, deps);
      writeJsonAtomic(paths.scan, emptyScan(accountId, now), deps);
      writeJsonAtomic(paths.consent, defaultConsent(accountId, now), deps);
      writeJsonAtomic(paths.suggestionIndex, { schema: 1, entries: [] }, deps);
    }
    const manifest = readJson(paths.manifest, deps);
    if (!manifest || manifest.account_id !== accountId || manifest.schema !== 1) {
      throw new WorkflowError("account_mismatch", "archive manifest does not match this account");
    }
    return paths;
  }, deps.lock);
}

export function readAccount(root, accountId, deps = {}) {
  const paths = ensureArchive(root, accountId, deps);
  const scan = readJson(paths.scan, deps);
  if (scan.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "scan state does not match this account");
  }
  return { paths, scan };
}

function listJsonIds(directory, deps) {
  const fsImpl = useFs(deps);
  if (!fsImpl.existsSync(directory)) return [];
  return fsImpl.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .sort();
}

export function readPost(root, accountId, postId, deps = {}) {
  const paths = accountPaths(root, accountId);
  return readJson(postPath(paths, postId), deps);
}

export function readRecord(root, accountId, postId, deps = {}) {
  const paths = accountPaths(root, accountId);
  return readJson(recordPath(paths, postId), deps);
}

export function listRecords(root, accountId, deps = {}) {
  const paths = accountPaths(root, accountId);
  return listJsonIds(paths.records, deps).map((id) => readRecord(root, accountId, id, deps));
}

export function transitionRecord(record, status, reason, now, extra = {}) {
  const next = {
    ...record,
    ...extra,
    status,
    history: [...record.history, { at: now, status, reason }],
  };
  return next;
}

export function ingestPage(root, accountId, page, opts = {}) {
  const deps = opts.deps || {};
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = nowIso(deps);
    const scan = readJson(paths.scan, deps);
    const normalized = normalizePage(page, accountId);
    const decision = decideIngest({
      scan,
      normalized,
      maxPages: opts.maxPages ?? null,
      maxItems: opts.maxItems ?? null,
    });
    if (decision.action === "stop") {
      const stopped = {
        ...scan,
        complete: false,
        incomplete_reason: decision.incomplete_reason,
        updated_at: now,
      };
      writeJsonAtomic(paths.scan, stopped, deps);
      return {
        ok: true,
        ingested: false,
        account_id: accountId,
        complete: false,
        incomplete_reason: decision.incomplete_reason,
        next_token: scan.next_token,
        page_new: 0,
        page_duplicates: decision.duplicateIds.length,
        in_page_duplicates: normalized.inPageDuplicates,
        pages_ingested: scan.pages_ingested,
        unique_count: scan.unique_count,
      };
    }
    const fsImpl = useFs(deps);
    const seen = new Set(scan.seen_ids || []);
    const content = { complete: 0, incomplete: 0, uncertain: 0 };
    for (const post of decision.newPosts) {
      const existing = postPath(paths, post.id);
      const recordFile = recordPath(paths, post.id);
      if (!fsImpl.existsSync(existing)) writeJsonAtomic(existing, post, deps);
      const stored = readJson(existing, deps);
      if (!fsImpl.existsSync(recordFile)) {
        writeJsonAtomic(recordFile, initialRecord({ accountId, post: stored, now }), deps);
      }
      seen.add(stored.id);
      content[stored.content_status] += 1;
    }
    const nextScan = {
      ...scan,
      account_id: accountId,
      complete: decision.complete,
      incomplete_reason: decision.complete ? null : decision.incomplete_reason,
      next_token: normalized.pageEndKnown ? normalized.nextToken : scan.next_token,
      page_end_known: normalized.pageEndKnown,
      pages_ingested: scan.pages_ingested + 1,
      unique_count: seen.size,
      seen_ids: [...seen].sort(),
      updated_at: now,
    };
    writeJsonAtomic(paths.scan, nextScan, deps);
    return {
      ok: true,
      ingested: true,
      account_id: accountId,
      complete: nextScan.complete,
      incomplete_reason: nextScan.incomplete_reason,
      next_token: nextScan.next_token,
      page_new: decision.newPosts.length,
      page_duplicates: decision.duplicateIds.length,
      in_page_duplicates: normalized.inPageDuplicates,
      pages_ingested: nextScan.pages_ingested,
      unique_count: nextScan.unique_count,
      content,
    };
  }, deps.lock);
}

export function markRead(root, accountId, postId, deps = {}) {
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const now = nowIso(deps);
    const record = readRecord(root, accountId, postId, deps);
    if (record.account_id !== accountId) {
      throw new WorkflowError("account_mismatch", "record account does not match");
    }
    const next = transitionRecord(record, record.status, "marked_read", now, { read: true });
    writeJsonAtomic(recordPath(paths, postId), next, deps);
    return { ok: true, post_id: postId, read: true, notified: next.notified, status: next.status };
  }, deps.lock);
}

export function statusReport(root, accountId, deps = {}) {
  const { scan } = readAccount(root, accountId, deps);
  const records = listRecords(root, accountId, deps);
  const counts = {
    fetched: 0,
    analyzed: 0,
    recommendation_delivered: 0,
    cleanup_planned: 0,
    cleanup_succeeded: 0,
    cleanup_failed: 0,
    read: 0,
    unread: 0,
    notified: 0,
    unnotified: 0,
    complete: 0,
    incomplete: 0,
    uncertain: 0,
  };
  for (const record of records) {
    if (Object.prototype.hasOwnProperty.call(counts, record.status)) counts[record.status] += 1;
    counts[record.read ? "read" : "unread"] += 1;
    counts[record.notified ? "notified" : "unnotified"] += 1;
    if (Object.prototype.hasOwnProperty.call(counts, record.content_status)) counts[record.content_status] += 1;
  }
  return {
    ok: true,
    account_id: accountId,
    complete: scan.complete,
    incomplete_reason: scan.incomplete_reason,
    next_token: scan.next_token,
    pages_ingested: scan.pages_ingested,
    unique_count: scan.unique_count,
    counts,
  };
}

export function renderAccount(root, accountId, deps = {}) {
  const paths = ensureArchive(root, accountId, deps);
  return withLock(paths.dir, () => {
    const scan = readJson(paths.scan, deps);
    const ids = listJsonIds(paths.posts, deps);
    const posts = ids.map((id) => readJson(postPath(paths, id), deps));
    const doc = renderExportDocument({
      accountId,
      scan,
      posts,
      generatedAt: nowIso(deps),
    });
    const jsonFile = containedFile(paths.exports, "bookmarks.json");
    const mdFile = containedFile(paths.exports, "bookmarks.md");
    writeJsonAtomic(jsonFile, doc, deps);
    const markdown = renderExportMarkdown(doc);
    const fsImpl = useFs(deps);
    if (deps.failOn && deps.failOn(mdFile)) {
      throw new WorkflowError("archive_failed", "failed to write bookmarks.md");
    }
    fsImpl.mkdirSync(paths.exports, { recursive: true, mode: 0o700 });
    fsImpl.writeFileSync(mdFile, markdown, { mode: 0o600 });
    return {
      ok: true,
      account_id: accountId,
      scan_complete: doc.scan_complete,
      incomplete_reason: doc.incomplete_reason,
      posts: doc.posts.length,
      json: jsonFile,
      markdown: mdFile,
      pagination_token_included: false,
    };
  }, deps.lock);
}

export function readKey(root, accountId, deps = {}) {
  const paths = accountPaths(root, accountId);
  const key = readJson(paths.key, deps);
  if (!key || typeof key.mac_key_hex !== "string" || !/^[0-9a-f]{64}$/.test(key.mac_key_hex)) {
    throw new WorkflowError("invalid_key", "account mac key is missing");
  }
  return key.mac_key_hex;
}

export function writeRecord(root, accountId, record, deps = {}) {
  if (!record || record.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "refusing to write a record for another account");
  }
  const paths = accountPaths(root, accountId);
  writeJsonAtomic(recordPath(paths, record.post_id), record, deps);
  return record;
}

export function readConsent(root, accountId, deps = {}) {
  const paths = ensureArchive(root, accountId, deps);
  const consent = readJson(paths.consent, deps);
  if (consent.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "consent does not match this account");
  }
  return consent;
}

export function writeConsent(root, accountId, consent, deps = {}) {
  if (!consent || consent.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "refusing to write consent for another account");
  }
  const paths = ensureArchive(root, accountId, deps);
  const next = { ...consent, updated_at: nowIso(deps), source: "owner-opt-in" };
  return withLock(paths.dir, () => {
    writeJsonAtomic(paths.consent, next, deps);
    return next;
  }, deps.lock);
}

export function readScan(root, accountId, deps = {}) {
  return readAccount(root, accountId, deps).scan;
}

export function accountFile(root, accountId, kind, name, deps = {}) {
  const paths = accountPaths(root, accountId);
  const directory = paths[kind];
  if (!directory) throw new WorkflowError("unsafe_path", "unknown account directory");
  return containedFile(directory, name);
}
