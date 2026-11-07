// Portable X bookmark helpers. No network, no browser, no process.exit.
// The Grok Bot X connector is the only sanctioned read/remove path.
// This module never calls it.

import crypto from "node:crypto";
import path from "node:path";

export const SKILL = "x-bookmark-export";
export const RUNTIME = "grok-x-connector";
export const STANDALONE_EGO_BOOKMARK_BACKEND = "unsupported";
export const EGO_BOOKMARK_GAP =
  "Standalone Ego is not an X bookmark backend. A runtime smoke inside ego-browser nodejs does not prove bookmark read or remove. The Grok Bot X connector is the runtime route. This recipe is not that backend.";
export const LIST_TOOL = "get_users_bookmarks";
export const REMOVE_TOOL = "delete_users_bookmark";
export const MAX_PAGE_RESULTS = 100;
export const ID_RE = /^[0-9]{1,20}$/;
export const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

export const HOW_TO_CONNECT = [
  "In the bot host, connect the authenticated X connector for this owner.",
  "Read bookmarks with get_users_bookmarks (pagination_token, max_results, post fields). Do not call api.x.com.",
  "Save that tool result to a file and ingest it. The script archives first and does not remove bookmarks.",
  "Ego Lite is not an X backend for this skill. Do not launch ego-browser, copy cookies, or reuse a browser session.",
];

export const HOW_TO_CONNECT_ZH = [
  "在 bot 宿主里为这位所有者连接已认证的 X 连接器。",
  "用 get_users_bookmarks 读取书签（pagination_token、max_results 和帖子字段）。不要调用 api.x.com。",
  "把工具结果存成文件再导入。脚本会先归档，不会取消书签。",
  "本技能不把 Ego Lite 当作 X 后端。不要启动 ego-browser，不要复制 Cookie，不要复用浏览器会话。",
];

export const LIST_FIELDS = {
  "post.fields": "id,text,created_at,author_id,note_tweet,entities,attachments,referenced_tweets,conversation_id",
  expansions: "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
  "user.fields": "id,name,username",
  "media.fields": "media_key,type,alt_text",
};

export class WorkflowError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function assertAccountId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new WorkflowError("invalid_id", "account id must be a 1-20 digit string");
  }
  return id;
}

export function assertPostId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new WorkflowError("invalid_id", "post id must be a 1-20 digit string");
  }
  return id;
}

export function assertArchiveRoot(root) {
  if (typeof root !== "string" || root.trim() === "" || root.includes("\0")) {
    throw new WorkflowError("unsafe_path", "archive root is invalid");
  }
  if (!path.isAbsolute(root)) {
    throw new WorkflowError("unsafe_path", "archive root must be absolute");
  }
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    throw new WorkflowError("unsafe_path", "archive root cannot be the filesystem root");
  }
  return resolved;
}

export function accountPaths(root, accountId) {
  const base = assertArchiveRoot(root);
  const id = assertAccountId(accountId);
  const dir = path.resolve(base, "accounts", id);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (!dir.startsWith(prefix)) {
    throw new WorkflowError("unsafe_path", "account path escapes the archive root");
  }
  return {
    root: base,
    dir,
    manifest: path.join(dir, "manifest.json"),
    key: path.join(dir, "key.json"),
    scan: path.join(dir, "scan.json"),
    consent: path.join(dir, "consent.json"),
    owner: path.join(dir, "owner.json"),
    suggestionIndex: path.join(dir, "suggestion-index.json"),
    pendingRemoval: path.join(dir, "pending-removal.json"),
    posts: path.join(dir, "posts"),
    records: path.join(dir, "records"),
    exports: path.join(dir, "exports"),
    analysis: path.join(dir, "analysis"),
    recommendations: path.join(dir, "recommendations"),
    receipts: path.join(dir, "receipts"),
    plans: path.join(dir, "plans"),
  };
}

export function containedFile(directory, name) {
  if (typeof name !== "string" || name !== path.basename(name) || name === "" || name.includes("\0")) {
    throw new WorkflowError("unsafe_path", "file name escapes the account directory");
  }
  const file = path.resolve(directory, name);
  const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
  if (!file.startsWith(prefix)) {
    throw new WorkflowError("unsafe_path", "file path escapes the account directory");
  }
  return file;
}

export function postPath(paths, postId) {
  return containedFile(paths.posts, `${assertPostId(postId)}.json`);
}

export function recordPath(paths, postId) {
  return containedFile(paths.records, `${assertPostId(postId)}.json`);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

export function archiveHash(post) {
  return sha256Text(stableStringify(post));
}

export function rollupContentStatus(parts) {
  if (parts.includes("incomplete")) return "incomplete";
  if (parts.includes("uncertain")) return "uncertain";
  return "complete";
}

export function validTime(value) {
  if (typeof value !== "string" || !value.includes("T")) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function fenceText(text) {
  const value = String(text ?? "");
  const runs = value.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${value}\n${fence}`;
}

function indexBy(list, key) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    if (item && typeof item === "object" && item[key] != null) map.set(String(item[key]), item);
  }
  return map;
}

export function canonicalStatusUrl(id, username) {
  if (username && USERNAME_RE.test(username)) return `https://x.com/${username}/status/${id}`;
  return `https://x.com/i/status/${id}`;
}

export function safeStatusUrl(candidate, id, username) {
  if (typeof candidate === "string") {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const allowed = host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com";
      const match = url.pathname.match(/\/status(?:es)?\/([0-9]+)/);
      if (url.protocol === "https:" && allowed && match && match[1] === id) {
        return canonicalStatusUrl(id, username);
      }
    } catch {
      // Fall through to the canonical status URL.
    }
  }
  return canonicalStatusUrl(id, username);
}

function normalizeAuthor(raw, users) {
  const embedded = raw.author && typeof raw.author === "object" ? raw.author : null;
  const included = raw.author_id != null ? users.get(String(raw.author_id)) : null;
  const source = embedded || included;
  if (!source) return null;
  const id = String(source.id || raw.author_id || "");
  const username = typeof source.username === "string" ? source.username : "";
  const name = typeof source.name === "string" ? source.name : "";
  if (!ID_RE.test(id) || !USERNAME_RE.test(username)) return null;
  return { id, username, name };
}

function normalizeText(raw) {
  const note = raw.note_tweet && typeof raw.note_tweet === "object" ? raw.note_tweet : null;
  if (note && typeof note.text === "string" && note.text.trim() !== "") {
    return { text: note.text, source: "note_tweet", incomplete: false };
  }
  const fallback = typeof raw.text === "string" ? raw.text : "";
  if (note) return { text: fallback, source: fallback ? "text" : "missing", incomplete: true };
  if (typeof raw.text === "string") {
    return { text: raw.text, source: raw.text ? "text" : "missing", incomplete: false };
  }
  return { text: "", source: "missing", incomplete: true };
}

function normalizeQuote(raw, tweets, users) {
  if (raw.quote && typeof raw.quote === "object") {
    const id = String(raw.quote.id || "");
    const text = typeof raw.quote.text === "string" && raw.quote.text ? raw.quote.text : null;
    const longformMissing = raw.quote.note_tweet && !text;
    return {
      id: ID_RE.test(id) ? id : null,
      text,
      status: text ? "present" : "unavailable",
      longform: longformMissing ? "missing" : "none",
      author: raw.quote.author ? normalizeAuthor({ author: raw.quote.author }, users) : null,
    };
  }
  const refs = Array.isArray(raw.referenced_tweets) ? raw.referenced_tweets : [];
  const quoted = refs.find((item) => item && item.type === "quoted");
  if (!quoted) return null;
  const id = String(quoted.id || "");
  const included = tweets.get(id);
  if (!included) {
    return { id: ID_RE.test(id) ? id : null, text: null, status: "unavailable", longform: "none", author: null };
  }
  const note = included.note_tweet && typeof included.note_tweet.text === "string"
    ? included.note_tweet.text
    : "";
  const longformMissing = included.note_tweet && !note;
  const text = note || (typeof included.text === "string" ? included.text : "");
  if (!text) {
    return { id: ID_RE.test(id) ? id : null, text: null, status: "unavailable", longform: "none", author: null };
  }
  return {
    id,
    text,
    status: "present",
    longform: longformMissing ? "missing" : "none",
    author: normalizeAuthor(included, users),
  };
}

function mediaItemsFromRaw(raw) {
  if (raw.attachments && Array.isArray(raw.attachments.media_keys)) {
    return raw.attachments.media_keys.map((key) => ({ media_key: String(key) }));
  }
  if (Array.isArray(raw.media)) {
    return raw.media.map((item) => {
      if (typeof item === "string") return { media_key: item };
      return item && typeof item === "object" ? item : null;
    }).filter(Boolean);
  }
  return [];
}

function normalizeMedia(raw, mediaIndex) {
  const declared = mediaItemsFromRaw(raw);
  if (declared.length === 0) return { status: "none", items: [] };
  const items = [];
  let missing = false;
  for (const item of declared) {
    const key = String(item.media_key || "");
    const found = mediaIndex.get(key) || item;
    const type = typeof found.type === "string" && found.type ? found.type : null;
    if (!key || !type) missing = true;
    items.push({
      media_key: key || null,
      type,
      alt_text: typeof found.alt_text === "string" ? found.alt_text : null,
    });
  }
  return { status: missing ? "missing" : "present", items };
}

function normalizeLinks(raw) {
  const urls = raw.entities && Array.isArray(raw.entities.urls) ? raw.entities.urls : [];
  const extra = Array.isArray(raw.links) ? raw.links : [];
  const out = [];
  for (const item of [...urls, ...extra]) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" ? item.url : null;
    const expanded = typeof item.expanded_url === "string" ? item.expanded_url : null;
    if (!url && !expanded) continue;
    out.push({
      url,
      expanded_url: expanded,
      title: typeof item.title === "string" ? item.title : null,
    });
  }
  return out;
}

function normalizeExternal(raw, links) {
  const article = raw.article && typeof raw.article === "object" ? raw.article : null;
  const text = article
    ? (typeof article.plain_text === "string" && article.plain_text) || (typeof article.text === "string" && article.text) || ""
    : "";
  if (text) return { status: "present", text };
  if (links.length > 0) return { status: "unavailable", text: null };
  return { status: "none", text: null };
}

export function normalizePost(raw, includes = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorkflowError("invalid_post", "post must be an object");
  }
  const id = raw.id == null ? "" : String(raw.id);
  assertPostId(id);
  const users = indexBy(includes.users, "id");
  const tweets = indexBy([...(includes.tweets || []), ...(includes.posts || [])], "id");
  const media = indexBy(includes.media, "media_key");
  const author = normalizeAuthor(raw, users);
  const textInfo = normalizeText(raw);
  const quote = normalizeQuote(raw, tweets, users);
  const mediaInfo = normalizeMedia(raw, media);
  const links = normalizeLinks(raw);
  const external = normalizeExternal(raw, links);
  const postCreated = validTime(raw.post_created_at) || validTime(raw.created_at);
  const bookmarked = validTime(raw.bookmarked_at) || validTime(raw.bookmark_created_at);
  const parts = [];
  if (!textInfo.text) parts.push("uncertain");
  if (textInfo.incomplete) parts.push("incomplete");
  if (!author) parts.push("uncertain");
  if (!postCreated) parts.push("uncertain");
  if (quote && (quote.status !== "present" || quote.longform === "missing")) parts.push("incomplete");
  if (mediaInfo.status === "missing") parts.push("incomplete");
  if (external.status === "unavailable") parts.push("uncertain");
  return {
    schema: 1,
    id,
    url: safeStatusUrl(raw.url, id, author?.username),
    text: textInfo.text,
    text_source: textInfo.source,
    author,
    post_created_at: postCreated,
    bookmarked_at: bookmarked,
    bookmark_time_known: Boolean(bookmarked),
    quote,
    media: mediaInfo.items,
    media_status: mediaInfo.status,
    media_downloaded: false,
    links,
    external_text: external.text,
    external_text_status: external.status,
    content_status: rollupContentStatus(parts),
  };
}

export function readPageEnd(page) {
  if (Object.prototype.hasOwnProperty.call(page, "posts")) {
    if (!Object.prototype.hasOwnProperty.call(page, "next_token")) return { known: false, token: null };
    return normalizeToken(page.next_token);
  }
  if (page.meta && typeof page.meta === "object") {
    if (!Object.prototype.hasOwnProperty.call(page.meta, "next_token")) return { known: true, token: null };
    return normalizeToken(page.meta.next_token);
  }
  return { known: false, token: null };
}

function normalizeToken(value) {
  if (value === null) return { known: true, token: null };
  if (typeof value === "string" && value.length > 0) return { known: true, token: value };
  throw new WorkflowError("invalid_page", "next_token must be a non-empty string or null");
}

export function normalizePage(page, accountId) {
  assertAccountId(accountId);
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    throw new WorkflowError("invalid_page", "page must be a JSON object");
  }
  const declared = page.account_id ?? page.authenticated_user_id ?? null;
  if (declared != null && String(declared) !== accountId) {
    throw new WorkflowError("account_mismatch", "page account does not match the archive account");
  }
  const hasPosts = Object.prototype.hasOwnProperty.call(page, "posts");
  const hasData = Object.prototype.hasOwnProperty.call(page, "data");
  if (hasPosts && hasData) throw new WorkflowError("invalid_page", "page has both posts and data");
  if (!hasPosts && !hasData) throw new WorkflowError("invalid_page", "page needs posts or data");
  const rawPosts = hasPosts ? page.posts : page.data;
  if (!Array.isArray(rawPosts)) throw new WorkflowError("invalid_page", "posts must be an array");
  const end = readPageEnd(page);
  const includes = page.includes && typeof page.includes === "object" ? page.includes : {};
  const posts = [];
  const seen = new Set();
  let inPageDuplicates = 0;
  for (const raw of rawPosts) {
    const post = normalizePost(raw, includes);
    if (seen.has(post.id)) {
      inPageDuplicates += 1;
      continue;
    }
    seen.add(post.id);
    posts.push(post);
  }
  return {
    accountId,
    posts,
    nextToken: end.token,
    pageEndKnown: end.known,
    inPageDuplicates,
  };
}

export function emptyScan(accountId, now) {
  return {
    schema: 1,
    account_id: accountId,
    complete: false,
    incomplete_reason: "not_started",
    next_token: null,
    page_end_known: false,
    pages_ingested: 0,
    unique_count: 0,
    seen_ids: [],
    updated_at: now,
  };
}

export function decideIngest({ scan, normalized, maxPages = null, maxItems = null }) {
  if (maxPages != null && (!Number.isInteger(maxPages) || maxPages < 1)) {
    throw new WorkflowError("invalid_arg", "max_pages must be an integer >= 1");
  }
  if (maxItems != null && (!Number.isInteger(maxItems) || maxItems < 1)) {
    throw new WorkflowError("invalid_arg", "max_items must be an integer >= 1");
  }
  const seen = new Set(scan.seen_ids || []);
  if ((maxPages != null && scan.pages_ingested >= maxPages) || (maxItems != null && scan.unique_count >= maxItems && normalized.posts.some((post) => !seen.has(post.id)))) {
    return {
      action: "stop",
      incomplete_reason: "bounded",
      newPosts: [],
      duplicateIds: [],
    };
  }
  const newPosts = [];
  const duplicateIds = [];
  for (const post of normalized.posts) {
    if (seen.has(post.id)) duplicateIds.push(post.id);
    else newPosts.push(post);
  }
  const room = maxItems == null ? Number.POSITIVE_INFINITY : maxItems - scan.unique_count;
  if (newPosts.length > room) {
    return { action: "stop", incomplete_reason: "bounded", newPosts: [], duplicateIds };
  }
  let incomplete = null;
  let complete = false;
  if (!normalized.pageEndKnown) incomplete = "page_end_unknown";
  else if (normalized.nextToken) incomplete = "has_next_token";
  else complete = true;
  if (maxItems != null && scan.unique_count + newPosts.length >= maxItems && normalized.nextToken) {
    incomplete = "bounded";
    complete = false;
  }
  return { action: "ingest", incomplete_reason: incomplete, complete, newPosts, duplicateIds };
}

export function listBookmarksCall({ accountId, paginationToken = null, maxResults = 20 } = {}) {
  assertAccountId(accountId);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_PAGE_RESULTS) {
    throw new WorkflowError("invalid_arg", "max_results must be an integer from 1 to 100");
  }
  const args = { id: accountId, max_results: maxResults, ...LIST_FIELDS };
  if (paginationToken) {
    if (typeof paginationToken !== "string") {
      throw new WorkflowError("invalid_arg", "pagination_token must be a string");
    }
    args.pagination_token = paginationToken;
  }
  return {
    connector: "x",
    tool: LIST_TOOL,
    arguments: args,
    live_call: false,
    notes: [
      "Call the authenticated Grok Bot X connector. Do not call api.x.com.",
      "Do not use ego-browser, cookies, or a browser session.",
      "A short or empty page is not the end while pagination_token / next_token exists.",
      "Save the tool result and ingest it. Archive before any cleanup.",
    ],
  };
}

export function removeBookmarkCall({ accountId, tweetId } = {}) {
  assertAccountId(accountId);
  assertPostId(tweetId);
  return {
    connector: "x",
    tool: REMOVE_TOOL,
    arguments: { id: accountId, tweet_id: tweetId },
    live_call: false,
    effect: "unbookmark",
    deletes_post: false,
    notes: [
      "Unbookmark only. This does not delete the original post.",
      "Adding the bookmark again may not restore order or folder.",
      "Issue this call only for an allowlisted id after local intent is committed.",
    ],
  };
}

export function dependencyReport({ requireConnector = false, requireEgo = false } = {}) {
  if (requireEgo) {
    throw new WorkflowError(
      "ego_unsupported",
      `${EGO_BOOKMARK_GAP} This process did not invoke ego-browser.`,
    );
  }
  if (requireConnector) {
    throw new WorkflowError(
      "connector_required",
      "This process cannot see the Grok Bot X connector. Use get_users_bookmarks in the bot, then ingest the saved page.",
    );
  }
  return {
    ok: true,
    skill: SKILL,
    runtime: RUNTIME,
    ego_browser: "unsupported",
    ego_browser_invoked: false,
    ego_backend: "unverified",
    standalone_ego_bookmark_backend: STANDALONE_EGO_BOOKMARK_BACKEND,
    live_proven_ego_skill: false,
    connector_recipe_equals_ego_backend: false,
    pro_runtime_smoke_proves_bookmarks: false,
    gap: EGO_BOOKMARK_GAP,
    live_x: false,
    live_cleanup: false,
    bins: ["node"],
    how_to_connect: HOW_TO_CONNECT,
    how_to_connect_zh: HOW_TO_CONNECT_ZH,
  };
}

export function initialRecord({ accountId, post, now }) {
  return {
    schema: 1,
    account_id: accountId,
    post_id: post.id,
    status: "fetched",
    read: false,
    notified: false,
    content_status: post.content_status,
    archive_sha256: archiveHash(post),
    fetched_at: now,
    analysis_id: null,
    recommendation_id: null,
    delivery_receipt_id: null,
    cleanup_plan_id: null,
    cleanup_attempt: {
      count: 0,
      remove_dispatched: false,
      remove_acked: false,
      last_error: null,
      last_attempt_at: null,
    },
    history: [{ at: now, status: "fetched", reason: "archived" }],
  };
}

export const STATUSES = [
  "fetched",
  "analyzed",
  "recommendation_delivered",
  "cleanup_planned",
  "cleanup_succeeded",
  "cleanup_failed",
];
