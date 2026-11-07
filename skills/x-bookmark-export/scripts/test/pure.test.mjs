import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOW_TO_CONNECT_ZH,
  WorkflowError,
  accountPaths,
  archiveHash,
  assertAccountId,
  assertArchiveRoot,
  assertPostId,
  canonicalStatusUrl,
  containedFile,
  decideIngest,
  dependencyReport,
  emptyScan,
  fenceText,
  initialRecord,
  listBookmarksCall,
  normalizePage,
  normalizePost,
  readPageEnd,
  removeBookmarkCall,
  rollupContentStatus,
  safeStatusUrl,
  sha256Text,
  stableStringify,
  validTime,
} from "../lib/pure.mjs";

const ACCOUNT = "1000000000000000001";
const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib");

test("ids, paths, hashes, and content rollup reject unsafe values", () => {
  assert.equal(assertAccountId(ACCOUNT), ACCOUNT);
  assert.throws(() => assertAccountId("../100"), /account id/);
  assert.throws(() => assertPostId("abc"), /post id/);
  assert.equal(assertPostId("1"), "1");
  assert.equal(assertPostId("2000000000000000001"), "2000000000000000001");
  assert.throws(() => assertArchiveRoot("relative/archive"), /absolute/);
  assert.throws(() => assertArchiveRoot(""), /invalid/);
  assert.throws(() => assertArchiveRoot("/tmp/bad\0archive"), /invalid/);
  assert.throws(() => assertArchiveRoot("/"), /filesystem root/);
  const root = assertArchiveRoot("/tmp/x-bookmark-archive");
  const paths = accountPaths(root, ACCOUNT);
  assert.equal(paths.dir, path.join(root, "accounts", ACCOUNT));
  assert.throws(() => containedFile(paths.posts, "../secret.json"), /escapes/);
  assert.throws(() => containedFile(paths.posts, ""), /escapes/);
  assert.equal(stableStringify(undefined), "null");
  assert.equal(stableStringify({ b: 1, a: [null, "x"] }), '{"a":[null,"x"],"b":1}');
  assert.equal(sha256Text("abc").length, 64);
  assert.equal(rollupContentStatus(["uncertain", "complete"]), "uncertain");
  assert.equal(rollupContentStatus(["incomplete", "uncertain"]), "incomplete");
  assert.equal(rollupContentStatus([]), "complete");
  assert.equal(validTime("2026-01-02T03:04:05.000Z"), "2026-01-02T03:04:05.000Z");
  assert.equal(validTime(1700000000000), null);
  assert.equal(validTime("yesterday"), null);
  assert.equal(canonicalStatusUrl("2000000000000000001"), "https://x.com/i/status/2000000000000000001");
  assert.equal(fenceText("keep ``` data"), "````\nkeep ``` data\n````");
});

test("connector recipes describe sanctioned calls and do not prove Ego", () => {
  const list = listBookmarksCall({
    accountId: ACCOUNT,
    paginationToken: "NEXT",
    maxResults: 20,
  });
  assert.equal(list.tool, "get_users_bookmarks");
  assert.equal(list.live_call, false);
  assert.equal(list.arguments.id, ACCOUNT);
  assert.equal(list.arguments.pagination_token, "NEXT");
  assert.match(list.arguments["post.fields"], /note_tweet/);
  assert.throws(() => listBookmarksCall({ accountId: ACCOUNT, maxResults: 101 }), /max_results/);
  assert.throws(() => listBookmarksCall({ accountId: ACCOUNT, paginationToken: 5 }), /pagination_token/);
  const removal = removeBookmarkCall({ accountId: ACCOUNT, tweetId: "2000000000000000001" });
  assert.equal(removal.tool, "delete_users_bookmark");
  assert.equal(removal.deletes_post, false);
  assert.equal(removal.live_call, false);
  const report = dependencyReport();
  assert.equal(report.ego_backend, "not_implemented");
  assert.equal(report.standalone_ego_bookmark_backend, "not_implemented");
  assert.equal(report.ego_bookmark_acceptance, "not_accepted");
  assert.equal(report.connector_recipe_completes_on_print, false);
  assert.match(report.gap_zh, /未实现、未验收/);
  assert.equal(report.live_proven_ego_skill, false);
  assert.equal(report.connector_recipe_equals_ego_backend, false);
  assert.equal(report.pro_runtime_smoke_proves_bookmarks, false);
  assert.match(report.gap, /not implemented and not accepted/);
  assert.equal(report.ego_browser_invoked, false);
  assert.equal(report.live_x, false);
  assert.equal(report.live_cleanup, false);
  assert.ok(report.how_to_connect_zh.length >= 3);
  assert.equal(report.how_to_connect_zh, HOW_TO_CONNECT_ZH);
  assert.throws(() => dependencyReport({ requireEgo: true }), (error) => error.code === "ego_unsupported");
  assert.throws(() => dependencyReport({ requireConnector: true }), (error) => error.code === "connector_required");
});

test("normalization keeps bookmark time, quotes, and uncertainty distinct", () => {
  const post = normalizePost({
    id: "2000000000000000001",
    text: "short",
    created_at: "2026-01-01T00:00:00.000Z",
    bookmarked_at: "2026-03-03T00:00:00.000Z",
    author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    url: "https://twitter.com/example_author/status/2000000000000000001",
    note_tweet: { text: "the complete long post" },
    cookie: "sentinel-cookie",
    auth_token: "sentinel-token",
    quote: {
      id: "2000000000000000002",
      text: "quoted body",
      author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    },
    media: [{ media_key: "3_1", type: "photo", alt_text: "a chart", url: "https://cdn.example/secret.jpg" }],
    links: [{ url: "https://t.co/abc", expanded_url: "https://example.com/article" }],
  });
  assert.equal(post.text, "the complete long post");
  assert.equal(post.text_source, "note_tweet");
  assert.equal(post.post_created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(post.bookmarked_at, "2026-03-03T00:00:00.000Z");
  assert.equal(post.bookmark_time_known, true);
  assert.notEqual(post.bookmarked_at, post.post_created_at);
  assert.equal(post.quote.status, "present");
  assert.equal(post.media_downloaded, false);
  assert.equal(post.media[0].url, undefined);
  assert.equal(post.external_text_status, "unavailable");
  assert.equal(post.content_status, "uncertain");
  assert.equal(JSON.stringify(post).includes("sentinel-cookie"), false);
  assert.equal(safeStatusUrl("javascript:alert(1)", post.id, post.author.username), post.url);

  const createdOnly = normalizePost({
    id: "2000000000000000003",
    text: "plain post",
    created_at: "2026-01-01T00:00:00.000Z",
    bookmark_created_at: "not-a-time",
    author_id: "3000000000000000001",
  }, {
    users: [{ id: "3000000000000000001", username: "example_author", name: "Example" }],
  });
  assert.equal(createdOnly.bookmarked_at, null);
  assert.equal(createdOnly.bookmark_time_known, false);
  assert.equal(createdOnly.content_status, "complete");

  const missingQuote = normalizePost({
    id: "2000000000000000004",
    text: "cites a quote",
    created_at: "2026-01-01T00:00:00.000Z",
    author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    referenced_tweets: [{ type: "quoted", id: "2000000000000000005" }],
    attachments: { media_keys: ["3_missing"] },
  });
  assert.equal(missingQuote.quote.status, "unavailable");
  assert.equal(missingQuote.media_status, "missing");
  assert.equal(missingQuote.content_status, "incomplete");

  const fromPosts = normalizePost({
    id: "2000000000000000013",
    text: "wrapper",
    created_at: "2026-01-01T00:00:00.000Z",
    author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    referenced_tweets: [{ type: "quoted", id: "2000000000000000014" }],
    entities: { urls: [{ url: "https://t.co/example", expanded_url: "https://example.com/story" }] },
  }, {
    posts: [{ id: "2000000000000000014", text: "quoted from posts", author_id: "3000000000000000001" }],
    users: [{ id: "3000000000000000001", username: "example_author", name: "Example" }],
  });
  assert.equal(fromPosts.quote.status, "present");
  assert.equal(fromPosts.quote.text, "quoted from posts");
  assert.equal(fromPosts.external_text_status, "unavailable");
  assert.equal(fromPosts.content_status, "uncertain");

  const longQuote = normalizePost({
    id: "2000000000000000006",
    text: "wrapper",
    created_at: "2026-01-01T00:00:00.000Z",
    author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    referenced_tweets: [{ type: "quoted", id: "2000000000000000007" }],
  }, {
    tweets: [{
      id: "2000000000000000007",
      text: "truncated",
      author_id: "3000000000000000001",
      note_tweet: { text: "full quoted note" },
    }],
    users: [{ id: "3000000000000000001", username: "example_author", name: "Example" }],
  });
  assert.equal(longQuote.quote.text, "full quoted note");
  assert.equal(longQuote.content_status, "complete");

  const noteShell = normalizePost({
    id: "2000000000000000008",
    text: "preview only",
    note_tweet: {},
    created_at: "2026-01-01T00:00:00.000Z",
    author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    article: { plain_text: "article body" },
  });
  assert.equal(noteShell.text_source, "text");
  assert.equal(noteShell.external_text, "article body");
  assert.equal(noteShell.content_status, "incomplete");

  const emptyAuthor = normalizePost({ id: "2000000000000000009", text: "" });
  assert.equal(emptyAuthor.author, null);
  assert.equal(emptyAuthor.content_status, "uncertain");
  assert.throws(() => normalizePost([]), /post must be an object/);
  assert.throws(() => normalizePost({ id: "nope", text: "x" }), /post id/);
});

test("page end is explicit and one overlapping page is not a full scan", () => {
  assert.deepEqual(readPageEnd({ posts: [], next_token: null }), { known: true, token: null });
  assert.deepEqual(readPageEnd({ posts: [] }), { known: false, token: null });
  assert.deepEqual(readPageEnd({ data: [], meta: {} }), { known: true, token: null });
  assert.deepEqual(readPageEnd({ data: [], meta: { next_token: "T" } }), { known: true, token: "T" });
  assert.deepEqual(readPageEnd({ data: [] }), { known: false, token: null });
  assert.throws(() => readPageEnd({ posts: [], next_token: "" }), /next_token/);
  assert.throws(() => normalizePage([], ACCOUNT), /JSON object/);
  assert.throws(() => normalizePage({ posts: [], data: [] }, ACCOUNT), /both/);
  assert.throws(() => normalizePage({ meta: {} }, ACCOUNT), /posts or data/);
  assert.throws(() => normalizePage({ posts: {} }, ACCOUNT), /array/);
  assert.throws(() => normalizePage({ posts: [], next_token: null, account_id: "1000000000000000002" }, ACCOUNT), (error) => error.code === "account_mismatch");

  const page = normalizePage({
    account_id: ACCOUNT,
    next_token: "T",
    posts: [
      { id: "2000000000000000011", text: "one", created_at: "2026-01-01T00:00:00.000Z", author: { id: "3000000000000000001", username: "example_author", name: "Example" } },
      { id: "2000000000000000011", text: "dup", created_at: "2026-01-01T00:00:00.000Z", author: { id: "3000000000000000001", username: "example_author", name: "Example" } },
    ],
  }, ACCOUNT);
  assert.equal(page.posts.length, 1);
  assert.equal(page.inPageDuplicates, 1);
  assert.equal(page.pageEndKnown, true);
  assert.equal(page.nextToken, "T");

  const scan = emptyScan(ACCOUNT, "2026-11-07T00:00:00.000Z");
  const short = decideIngest({ scan, normalized: page, maxPages: 2, maxItems: 10 });
  assert.equal(short.action, "ingest");
  assert.equal(short.complete, false);
  assert.equal(short.incomplete_reason, "has_next_token");

  const overlap = decideIngest({
    scan: { ...scan, seen_ids: ["2000000000000000011"], unique_count: 1, pages_ingested: 1 },
    normalized: page,
  });
  assert.equal(overlap.newPosts.length, 0);
  assert.equal(overlap.complete, false);
  assert.deepEqual(overlap.duplicateIds, ["2000000000000000011"]);

  const done = decideIngest({
    scan,
    normalized: { ...page, nextToken: null },
  });
  assert.equal(done.complete, true);
  assert.equal(done.incomplete_reason, null);

  const bounded = decideIngest({
    scan: { ...scan, pages_ingested: 1 },
    normalized: page,
    maxPages: 1,
  });
  assert.equal(bounded.action, "stop");
  assert.equal(bounded.incomplete_reason, "bounded");
  const tooBig = decideIngest({ scan, normalized: page, maxItems: 1 });
  assert.equal(tooBig.action, "ingest");
  const crowded = normalizePage({
    posts: [
      { id: "2000000000000000011", text: "one", created_at: "2026-01-01T00:00:00.000Z", author: { id: "3000000000000000001", username: "example_author", name: "Example" } },
      { id: "2000000000000000012", text: "two", created_at: "2026-01-01T00:00:00.000Z", author: { id: "3000000000000000001", username: "example_author", name: "Example" } },
    ],
    next_token: null,
  }, ACCOUNT);
  assert.equal(decideIngest({ scan, normalized: crowded, maxItems: 1 }).action, "stop");
  assert.throws(() => decideIngest({ scan, normalized: page, maxPages: 0 }), /max_pages/);
  assert.throws(() => decideIngest({ scan, normalized: page, maxItems: 0 }), /max_items/);
  const record = initialRecord({ accountId: ACCOUNT, post: page.posts[0], now: "2026-11-07T00:00:00.000Z" });
  assert.equal(record.status, "fetched");
  assert.equal(record.read, false);
  assert.equal(record.notified, false);
  assert.equal(record.archive_sha256, archiveHash(page.posts[0]));
});

test("library source does not call X, Ego, or the network", () => {
  for (const name of fs.readdirSync(libDir)) {
    const text = fs.readFileSync(path.join(libDir, name), "utf8");
    assert.equal(text.includes("https://api.x.com"), false, name);
    assert.equal(text.includes("child_process"), false, name);
    assert.equal(text.includes("page.fetch"), false, name);
    assert.equal(text.includes("taskSpace"), false, name);
  }
});
