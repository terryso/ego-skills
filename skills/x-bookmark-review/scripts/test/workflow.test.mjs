import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { archiveHash } from "../../../x-bookmark-export/scripts/lib/pure.mjs";
import { ingestPage, readPost, readRecord, writeConsent } from "../../../x-bookmark-export/scripts/lib/store.mjs";
import { acceptAnalysis, deliverRecommendations, parseAnalysis, sourceIsGrounded, suggestionKey } from "../lib/analysis.mjs";
import {
  MAX_CAP,
  buildPlan,
  commitRemoval,
  mapConnectorUnbookmarkReceipt,
  prepareApply,
  reconcilePresence,
  runAdapterApply,
} from "../lib/cleanup.mjs";
import { readRemovalResults } from "../lib/cli.mjs";
import { applyOnboarding, mergeConsent, nextOnboardingQuestion } from "../lib/onboard.mjs";
import { issueReceipt, receiptProblem, signPayload, verifyPayload } from "../lib/receipts.mjs";
import { siblingStatus } from "../lib/sibling.mjs";
import { runReview, runReviewDeps } from "../lib/cli.mjs";

const ACCOUNT = "1000000000000000001";
const OTHER = "1000000000000000002";
const here = path.dirname(fileURLToPath(import.meta.url));
const reviewCli = path.resolve(here, "../review.mjs");
const depsCli = path.resolve(here, "../check-deps.mjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "x-bookmark-review-"));
}

function author() {
  return { id: "3000000000000000001", username: "example_author", name: "Example" };
}

function post(id, text, extra = {}) {
  return {
    id,
    text,
    created_at: "2026-01-01T00:00:00.000Z",
    bookmarked_at: "2026-04-04T00:00:00.000Z",
    author: author(),
    ...extra,
  };
}

function clock(start = Date.parse("2026-11-07T00:00:00.000Z")) {
  let nowMs = start;
  return {
    deps: { now: () => new Date(nowMs).toISOString() },
    advance(ms) { nowMs += ms; },
    nowMs: () => nowMs,
  };
}

function archiveWith(posts, token = null, time = clock()) {
  const root = tempRoot();
  ingestPage(root, ACCOUNT, { account_id: ACCOUNT, next_token: token, posts }, { deps: time.deps });
  return { root, time };
}

function analysisDoc(items) {
  return {
    schema: "x-bookmark-analysis/1",
    account_id: ACCOUNT,
    generated_at: "2026-11-07T00:00:00.000Z",
    items,
  };
}

function itemFor(root, id, disposition, fields = {}) {
  const stored = readPost(root, ACCOUNT, id);
  const record = readRecord(root, ACCOUNT, id);
  assert.equal(record.archive_sha256, archiveHash(stored));
  return {
    post_id: id,
    archive_sha256: record.archive_sha256,
    disposition,
    rationale: fields.rationale || "Grounded note kept with the archived bookmark.",
    suggestion: disposition === "actionable" ? {
      title: fields.title || `Read ${id.slice(-4)}`,
      detail: fields.detail || "Compare the claim with the archived post.",
      source_url: fields.source_url || stored.url,
    } : null,
    unhelpful_reason: disposition === "unhelpful" ? (fields.unhelpful_reason || "Already handled elsewhere.") : null,
  };
}

function capture() {
  const buffers = { out: "", err: "" };
  return {
    buffers,
    stdout: { write(chunk) { buffers.out += chunk; } },
    stderr: { write(chunk) { buffers.err += chunk; } },
  };
}

test("receipts reject forged, expired, and self-declared delivery", () => {
  const key = "ab".repeat(32);
  assert.throws(() => signPayload("zz", { a: 1 }), (error) => error.code === "invalid_key");
  assert.throws(() => signPayload(key, null), /object/);
  assert.throws(() => signPayload(key, { mac: "x" }), /mac/);
  const signed = signPayload(key, { schema: "demo", n: 1 });
  assert.equal(verifyPayload(key, signed), true);
  assert.equal(verifyPayload(key, { ...signed, n: 2 }), false);
  assert.equal(verifyPayload(key, { ...signed, mac: "nope" }), false);
  assert.equal(verifyPayload("nope", signed), false);
  assert.equal(verifyPayload(key, null), false);
  const body = "delivered text";
  const receipt = issueReceipt({
    keyHex: key,
    accountId: ACCOUNT,
    recommendationId: "rec",
    postIds: ["2000000000000000002", "2000000000000000001"],
    body,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
  });
  assert.deepEqual(receipt.post_ids, ["2000000000000000001", "2000000000000000002"]);
  assert.equal(receiptProblem(key, receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
    postId: "2000000000000000001",
    recommendationId: "rec",
  }), null);
  assert.equal(receiptProblem(key, { ...receipt, account_id: OTHER }, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
    postId: "2000000000000000001",
    recommendationId: "rec",
  }), "receipt_forged");
  assert.equal(receiptProblem("cd".repeat(32), receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
  }), "receipt_forged");
  assert.equal(receiptProblem(key, receipt, {
    accountId: OTHER,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
  }), "account_mismatch");
  assert.equal(receiptProblem(key, receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-20T00:00:00.000Z"),
    body,
  }), "receipt_expired");
  assert.equal(receiptProblem(key, receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body: "other",
  }), "receipt_body_mismatch");
  assert.equal(receiptProblem(key, receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
    recommendationId: "other",
  }), "receipt_mismatch");
  assert.equal(receiptProblem(key, receipt, {
    accountId: ACCOUNT,
    nowMs: Date.parse("2026-11-07T00:00:00.000Z"),
    body,
    postId: "2000000000000000099",
  }), "receipt_mismatch");
  assert.equal(receiptProblem(key, null, { accountId: ACCOUNT, nowMs: 0, body }), "receipt_forged");
});

test("connector delete receipts do not name a post and uncertain rows are not unhelpful discards", () => {
  assert.throws(() => mapConnectorUnbookmarkReceipt({ data: { bookmarked: false } }, {}), /account id/);
  const mapped = mapConnectorUnbookmarkReceipt(
    "ignore this wrapper {\"data\":{\"bookmarked\":false}}",
    { accountId: ACCOUNT, tweetId: "2000000000000000001" },
  );
  assert.equal(mapped.receipt_names_post, false);
  assert.equal(mapped.results[0].removed, true);
  assert.equal(mapConnectorUnbookmarkReceipt(
    { data: { bookmarked: true } },
    { accountId: ACCOUNT, tweetId: "2000000000000000001" },
  ).results[0].removed, false);
  assert.throws(() => mapConnectorUnbookmarkReceipt(
    { data: { bookmarked: "false" } },
    { accountId: ACCOUNT, tweetId: "2000000000000000001" },
  ), (error) => error.code === "invalid_schema");
  const wrapped = path.join(tempRoot(), "receipt.txt");
  fs.writeFileSync(wrapped, "note {\"data\":{\"bookmarked\":false}} trailing");
  assert.throws(() => readRemovalResults(wrapped, ACCOUNT, null), (error) => error.code === "receipt_missing_id");
  assert.equal(readRemovalResults(wrapped, ACCOUNT, "2000000000000000001").results[0].tweet_id, "2000000000000000001");

  const time = clock();
  const id = "2000000000000000031";
  const { root } = archiveWith([post(id, "linked post", {
    entities: { urls: [{ url: "https://t.co/example", expanded_url: "https://example.com/story" }] },
  })], null, time);
  assert.equal(readPost(root, ACCOUNT, id).content_status, "uncertain");
  acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, id, "unhelpful"),
  ]), time.deps);
  writeConsent(root, ACCOUNT, {
    schema: 1,
    account_id: ACCOUNT,
    cleanup_processed: true,
    discard_unhelpful: true,
  }, time.deps);
  const blocked = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.ok(blocked.blocked.some((row) => row.post_id === id && row.reason === "content_not_complete"));
  acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, id, "actionable", { title: "Read the link" }),
  ]), time.deps);
  const delivered = deliverRecommendations(root, ACCOUNT, time.deps);
  assert.equal(delivered.silent, false);
  assert.deepEqual(delivered.notified, [id]);
  const plan = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.deepEqual(plan.items.map((row) => row.post_id), [id]);
  assert.equal(plan.connector_ops.length, 0);
});

test("onboarding asks one question at a time and does not inherit consent", () => {
  const first = nextOnboardingQuestion({});
  assert.equal(first.id, "x_connection");
  assert.equal(first.done, false);
  assert.equal("cadence" in first, false);
  assert.match(first.prompt_zh, /不会打开浏览器/);
  assert.equal(JSON.stringify(first).includes("NEE"), false);
  const goals = nextOnboardingQuestion({ x_connected: true });
  assert.equal(goals.id, "goals");
  const cadence = nextOnboardingQuestion({ x_connected: true, goals: "ship notes" });
  assert.equal(cadence.id, "cadence");
  const cleanup = nextOnboardingQuestion({ x_connected: true, goals: "ship notes", cadence: "weekly" });
  assert.equal(cleanup.id, "cleanup_mode");
  const preview = nextOnboardingQuestion({
    x_connected: true,
    goals: "ship notes",
    cadence: "weekly",
    cleanup_mode: "preview",
  });
  assert.equal(preview.done, true);
  assert.equal(preview.consent.cleanup_processed, false);
  assert.equal(preview.consent.discard_unhelpful, false);
  const processed = nextOnboardingQuestion({
    x_connected: true,
    goals: "ship notes",
    cadence: "daily",
    cleanup_mode: "auto",
  });
  assert.equal(processed.id, "auto_processed");
  const unhelpful = nextOnboardingQuestion({
    x_connected: true,
    goals: "ship notes",
    cadence: "few_days",
    cleanup_mode: "auto",
    auto_processed: false,
  });
  assert.equal(unhelpful.id, "auto_unhelpful");
  const opted = nextOnboardingQuestion({
    x_connected: true,
    goals: "ship notes",
    cadence: "few_days",
    cleanup_mode: "auto",
    auto_processed: true,
    auto_unhelpful: "true",
  });
  assert.equal(opted.id, "auto_unhelpful");
  const autoDone = nextOnboardingQuestion({
    x_connected: true,
    goals: "ship notes",
    cadence: "few_days",
    cleanup_mode: "auto",
    auto_processed: false,
    auto_unhelpful: true,
  });
  assert.equal(autoDone.done, true);
  assert.equal(autoDone.consent.cleanup_processed, false);
  assert.equal(autoDone.consent.discard_unhelpful, true);
  const onlyUnhelpful = mergeConsent({ cleanup_processed: true, discard_unhelpful: true }, { unhelpful: false });
  assert.equal(onlyUnhelpful.cleanup_processed, true);
  assert.equal(onlyUnhelpful.discard_unhelpful, false);
  const root = tempRoot();
  const partial = applyOnboarding(root, ACCOUNT, { x_connected: true });
  assert.equal(partial.done, false);
  assert.equal(fs.existsSync(path.join(root, "accounts", ACCOUNT, "owner.json")), false);
  assert.throws(() => applyOnboarding(root, ACCOUNT, {
    account_id: OTHER,
    x_connected: true,
    goals: "ship notes",
    cadence: "weekly",
    cleanup_mode: "preview",
  }), (error) => error.code === "account_mismatch");
  const applied = applyOnboarding(root, ACCOUNT, {
    account_id: ACCOUNT,
    x_connected: true,
    goals: "  ship notes  ",
    cadence: "weekly",
    cleanup_mode: "preview",
  });
  assert.equal(applied.consent.cleanup_processed, false);
  const owner = JSON.parse(fs.readFileSync(path.join(root, "accounts", ACCOUNT, "owner.json"), "utf8"));
  assert.equal(owner.goals, "ship notes");
  assert.equal(owner.account_id, ACCOUNT);
  assert.throws(() => mergeConsent({ cleanup_processed: false, discard_unhelpful: false }, {}), /set cleanup/);
  assert.throws(() => mergeConsent({ cleanup_processed: false, discard_unhelpful: false }, { processed: "true" }), /boolean/);
  const merged = mergeConsent({ cleanup_processed: false, discard_unhelpful: true }, { processed: true });
  assert.equal(merged.cleanup_processed, true);
  assert.equal(merged.discard_unhelpful, true);
  assert.equal(siblingStatus(os.tmpdir()).ok, false);
  assert.equal(siblingStatus().ok, true);
});

test("analysis is structured input, delivery is capped, and silence leaves state unread", () => {
  const time = clock();
  const ids = [
    "2000000000000000001",
    "2000000000000000002",
    "2000000000000000003",
    "2000000000000000004",
    "2000000000000000005",
    "2000000000000000006",
  ];
  const { root } = archiveWith(ids.map((id, index) => post(id, `post ${index}`, {
    links: [{ url: "https://example.com/same", expanded_url: "https://example.com/same" }],
    article: { plain_text: "Shared article body for these bookmarks." },
  })), null, time);
  const stored = readPost(root, ACCOUNT, ids[0]);
  assert.equal(sourceIsGrounded(stored, stored.url), true);
  assert.equal(sourceIsGrounded(stored, "https://example.com/same"), true);
  assert.equal(sourceIsGrounded(stored, "http://example.com/same"), false);
  assert.equal(sourceIsGrounded(stored, "https://user:pass@example.com/same"), false);
  assert.equal(suggestionKey({ title: "  Same   Title ", source_url: "https://example.com/same" }), "same title\nhttps://example.com/same");
  assert.throws(() => parseAnalysis({ delivered: true }, ACCOUNT), /forbidden/);
  assert.throws(() => parseAnalysis({
    schema: "x-bookmark-analysis/1",
    account_id: ACCOUNT,
    generated_at: "2026-11-07T00:00:00.000Z",
    items: [],
  }, ACCOUNT), /items/);
  assert.throws(() => parseAnalysis(analysisDoc([itemFor(root, ids[0], "actionable")]), OTHER), (error) => error.code === "account_mismatch");
  assert.throws(() => acceptAnalysis(root, ACCOUNT, analysisDoc([{
    ...itemFor(root, ids[0], "actionable"),
    archive_sha256: "a".repeat(64),
  }]), time.deps), /hash mismatch/);
  assert.equal(readRecord(root, ACCOUNT, ids[0]).status, "fetched");
  assert.throws(() => acceptAnalysis(root, ACCOUNT, analysisDoc([{
    ...itemFor(root, ids[0], "actionable"),
    suggestion: { title: "Bad link here", detail: "This source is not in the post.", source_url: "https://example.com/not-in-post" },
  }]), time.deps), (error) => error.code === "unverified_source");

  const accepted = acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, ids[0], "actionable", { title: "Same title", source_url: "https://example.com/same" }),
    itemFor(root, ids[1], "actionable", { title: "Same title", source_url: "https://example.com/same" }),
    itemFor(root, ids[2], "keep"),
    itemFor(root, ids[3], "actionable", { title: "Fourth idea" }),
    itemFor(root, ids[4], "actionable", { title: "Fifth idea" }),
    itemFor(root, ids[5], "actionable", { title: "Sixth idea" }),
  ]), time.deps);
  assert.equal(accepted.items, 6);
  const first = deliverRecommendations(root, ACCOUNT, time.deps);
  assert.equal(first.silent, false);
  assert.equal(first.suggestions.length, 3);
  assert.match(first.body, /不是认同/);
  assert.deepEqual(first.suggestions.map((row) => row.post_id), [ids[0], ids[3], ids[4]]);
  assert.equal(readRecord(root, ACCOUNT, ids[0]).notified, true);
  assert.equal(readRecord(root, ACCOUNT, ids[0]).read, true);
  assert.equal(readRecord(root, ACCOUNT, ids[1]).notified, false);
  const second = deliverRecommendations(root, ACCOUNT, time.deps);
  assert.equal(second.suggestions.length, 1);
  assert.equal(second.suggestions[0].post_id, ids[5]);
  const quiet = deliverRecommendations(root, ACCOUNT, time.deps);
  assert.equal(quiet.silent, true);
  assert.equal(quiet.body, null);
  assert.equal(readRecord(root, ACCOUNT, ids[2]).notified, false);
  assert.equal(readRecord(root, ACCOUNT, ids[2]).read, false);
  assert.throws(() => acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, ids[0], "keep"),
  ]), time.deps), (error) => error.code === "state_conflict");
});

test("cleanup stays a preview until opt-in, allowlist, receipt, and reconcile", () => {
  const time = clock();
  const actionable = "2000000000000000001";
  const unhelpful = "2000000000000000002";
  const uncertain = "2000000000000000003";
  const keep = "2000000000000000004";
  const { root } = archiveWith([
    post(actionable, "useful note"),
    post(unhelpful, "noise"),
    post(uncertain, "quote missing", { referenced_tweets: [{ type: "quoted", id: "2000000000000000099" }] }),
    post(keep, "hold"),
  ], null, time);
  acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, actionable, "actionable"),
    itemFor(root, unhelpful, "unhelpful"),
    itemFor(root, uncertain, "unhelpful", { unhelpful_reason: "Cannot verify the missing quote." }),
    itemFor(root, keep, "keep"),
  ]), time.deps);
  const silentPlan = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.equal(silentPlan.items.length, 0);
  assert.equal(silentPlan.connector_ops.length, 0);
  assert.ok(silentPlan.blocked.some((row) => row.post_id === actionable && row.reason === "delivery_required"));
  assert.ok(silentPlan.blocked.some((row) => row.post_id === unhelpful && row.reason === "no_consent"));
  assert.ok(silentPlan.blocked.some((row) => row.post_id === uncertain && row.reason === "content_not_complete"));
  deliverRecommendations(root, ACCOUNT, time.deps);
  writeConsent(root, ACCOUNT, {
    schema: 1,
    account_id: ACCOUNT,
    cleanup_processed: true,
    discard_unhelpful: false,
  }, time.deps);
  const processedOnly = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.deepEqual(processedOnly.items.map((row) => row.post_id), [actionable]);
  assert.equal(processedOnly.issue, false);
  const dry = prepareApply(root, ACCOUNT, processedOnly.plan_id, { yes: false, deps: time.deps });
  assert.equal(dry.exit, 3);
  assert.equal(dry.connector_ops.length, 0);
  time.advance(25 * 60 * 60 * 1000);
  assert.throws(() => prepareApply(root, ACCOUNT, processedOnly.plan_id, { yes: true, deps: time.deps }), (error) => error.code === "stale_plan");
  time.advance(-25 * 60 * 60 * 1000);
  const planPath = path.join(root, "accounts", ACCOUNT, "plans", `${processedOnly.plan_id}.json`);
  const forged = JSON.parse(fs.readFileSync(planPath, "utf8"));
  forged.items = [{ ...forged.items[0], post_id: "2000000000000000088" }];
  fs.writeFileSync(planPath, JSON.stringify(forged));
  assert.throws(() => prepareApply(root, ACCOUNT, processedOnly.plan_id, { yes: true, deps: time.deps }), (error) => error.code === "forged_plan");
  fs.writeFileSync(planPath, JSON.stringify(processedOnly.items && JSON.parse(fs.readFileSync(planPath, "utf8"))));
});

test("removal retries only after reconcile and never deletes the archive", () => {
  const time = clock();
  const id = "2000000000000000001";
  const other = "2000000000000000002";
  const { root } = archiveWith([
    post(id, "one"),
    post(other, "two"),
  ], null, time);
  acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, id, "actionable", { title: "First action" }),
    itemFor(root, other, "actionable", { title: "Second action" }),
  ]), time.deps);
  deliverRecommendations(root, ACCOUNT, time.deps);
  writeConsent(root, ACCOUNT, {
    schema: 1,
    account_id: ACCOUNT,
    cleanup_processed: true,
    discard_unhelpful: true,
  }, time.deps);
  const plan = buildPlan(root, ACCOUNT, { cap: 1, deps: time.deps });
  assert.equal(plan.items.length, 1);
  assert.ok(plan.blocked.some((row) => row.reason === "over_cap"));
  assert.throws(() => buildPlan(root, ACCOUNT, { cap: MAX_CAP + 1, deps: time.deps }), /cap/);
  const calls = [];
  const failedCommit = runAdapterApply(root, ACCOUNT, plan.plan_id, {
    yes: true,
    deps: { ...time.deps, failCommitIds: new Set([plan.items[0].post_id]) },
    adapter: { remove(input) { calls.push(input.tweetId); return { removed: true }; } },
  });
  assert.equal(calls.length, 1);
  assert.equal(failedCommit.commit.failed[0].error, "commit_failed");
  assert.equal(fs.existsSync(path.join(root, "accounts", ACCOUNT, "posts", `${plan.items[0].post_id}.json`)), true);
  calls.length = 0;
  const blocked = runAdapterApply(root, ACCOUNT, plan.plan_id, {
    yes: true,
    deps: time.deps,
    adapter: { remove() { calls.push("again"); return { removed: true }; } },
  });
  assert.deepEqual(calls, []);
  assert.ok(blocked.needs_reconcile.includes(plan.items[0].post_id));
  const fixed = reconcilePresence(root, ACCOUNT, {
    account_id: ACCOUNT,
    posts: [{ post_id: plan.items[0].post_id, present: false }],
  }, time.deps);
  assert.deepEqual(fixed.succeeded, [plan.items[0].post_id]);
  assert.deepEqual(fixed.connector_ops, []);
  assert.equal(readRecord(root, ACCOUNT, plan.items[0].post_id).status, "cleanup_succeeded");
  const replay = commitRemoval(root, ACCOUNT, {
    account_id: ACCOUNT,
    results: [{ tweet_id: plan.items[0].post_id, removed: true }],
  }, time.deps);
  assert.equal(replay.skipped[0].reason, "already_succeeded");
  assert.equal(fs.existsSync(path.join(root, "accounts", ACCOUNT, "posts", `${id}.json`)), true);
  assert.equal(fs.existsSync(path.join(root, "accounts", ACCOUNT, "posts", `${other}.json`)), true);
});

test("unhelpful discard, partial failure, forged receipts, and presence checks", () => {
  const time = clock();
  const good = "2000000000000000001";
  const noise = "2000000000000000002";
  const { root } = archiveWith([post(good, "good"), post(noise, "noise")], null, time);
  acceptAnalysis(root, ACCOUNT, analysisDoc([
    itemFor(root, good, "actionable"),
    itemFor(root, noise, "unhelpful"),
  ]), time.deps);
  deliverRecommendations(root, ACCOUNT, time.deps);
  writeConsent(root, ACCOUNT, {
    schema: 1,
    account_id: ACCOUNT,
    cleanup_processed: true,
    discard_unhelpful: true,
  }, time.deps);
  const receiptPath = path.join(root, "accounts", ACCOUNT, "receipts");
  const receiptFile = fs.readdirSync(receiptPath)[0];
  const receiptFull = path.join(receiptPath, receiptFile);
  const originalReceipt = fs.readFileSync(receiptFull, "utf8");
  const tampered = JSON.parse(originalReceipt);
  tampered.expires_at = "2026-11-08T00:00:00.000Z";
  fs.writeFileSync(receiptFull, JSON.stringify(tampered));
  const forged = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.ok(forged.blocked.some((row) => row.post_id === good && row.reason === "receipt_forged"));
  fs.writeFileSync(receiptFull, originalReceipt);
  const bodyPath = path.join(root, "accounts", ACCOUNT, "recommendations");
  const bodyFile = fs.readdirSync(bodyPath).find((name) => name.endsWith(".md"));
  const originalBody = fs.readFileSync(path.join(bodyPath, bodyFile), "utf8");
  fs.writeFileSync(path.join(bodyPath, bodyFile), `${originalBody}\nchanged`);
  const mismatched = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.ok(mismatched.blocked.some((row) => row.reason === "receipt_body_mismatch"));
  fs.writeFileSync(path.join(bodyPath, bodyFile), originalBody);
  time.advance(8 * 24 * 60 * 60 * 1000);
  const expired = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.ok(expired.blocked.some((row) => row.reason === "receipt_expired"));
  time.advance(-8 * 24 * 60 * 60 * 1000);
  const plan = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.equal(plan.items.length, 2);
  const calls = [];
  const partial = runAdapterApply(root, ACCOUNT, plan.plan_id, {
    yes: true,
    deps: time.deps,
    adapter: {
      remove({ tweetId }) {
        calls.push(tweetId);
        if (tweetId === noise) throw new Error("connector down");
        return { removed: true };
      },
    },
  });
  assert.equal(partial.adapter_calls, 2);
  assert.equal(partial.commit.partial, true);
  assert.ok(partial.commit.succeeded.includes(good));
  assert.equal(partial.commit.failed[0].post_id, noise);
  assert.equal(fs.existsSync(path.join(root, "accounts", ACCOUNT, "posts", `${noise}.json`)), true);
  const unknown = reconcilePresence(root, ACCOUNT, {
    account_id: ACCOUNT,
    posts: [{ post_id: noise, present: "maybe" }],
  }, time.deps);
  assert.deepEqual(unknown.unresolved, []);
  const present = reconcilePresence(root, ACCOUNT, {
    account_id: ACCOUNT,
    posts: [],
  }, time.deps);
  assert.deepEqual(present.unresolved, []);
  assert.equal(readRecord(root, ACCOUNT, noise).status, "cleanup_failed");
  const retryPlan = buildPlan(root, ACCOUNT, { deps: time.deps });
  const retryCalls = [];
  runAdapterApply(root, ACCOUNT, retryPlan.plan_id, {
    yes: true,
    deps: time.deps,
    adapter: {
      remove({ tweetId }) {
        retryCalls.push(tweetId);
        return { removed: false, error: "still there" };
      },
    },
  });
  assert.deepEqual(retryCalls, [noise]);
  reconcilePresence(root, ACCOUNT, {
    account_id: ACCOUNT,
    posts: [{ post_id: noise, present: true }],
  }, time.deps);
  const exhausted = buildPlan(root, ACCOUNT, { deps: time.deps });
  assert.ok(exhausted.blocked.some((row) => row.post_id === noise && row.reason === "retries_exhausted"));
  assert.throws(() => commitRemoval(root, ACCOUNT, { account_id: OTHER, results: [] }), (error) => error.code === "account_mismatch");
  const rejected = commitRemoval(root, ACCOUNT, {
    account_id: ACCOUNT,
    results: [{ tweet_id: "nope" }, { tweet_id: "2000000000000000099", removed: true }],
  }, time.deps);
  assert.equal(rejected.rejected.length, 2);
  assert.throws(() => reconcilePresence(root, ACCOUNT, { account_id: OTHER, posts: [] }), (error) => error.code === "account_mismatch");
  const missingRoot = tempRoot();
  const missingId = "2000000000000000008";
  ingestPage(missingRoot, ACCOUNT, {
    account_id: ACCOUNT,
    next_token: null,
    posts: [post(missingId, "will lose its file")],
  }, { deps: time.deps });
  fs.rmSync(path.join(missingRoot, "accounts", ACCOUNT, "posts", `${missingId}.json`));
  const missing = buildPlan(missingRoot, ACCOUNT, { deps: time.deps });
  assert.ok(missing.blocked.some((row) => row.post_id === missingId && row.reason === "archive_missing"));
});

test("review CLI previews cleanup and check-deps stays soft", () => {
  const root = tempRoot();
  const archive = path.join(root, "archive");
  const pageId = "2000000000000000001";
  ingestPage(archive, ACCOUNT, {
    account_id: ACCOUNT,
    next_token: null,
    posts: [post(pageId, "cli post")],
  });
  const stored = readPost(archive, ACCOUNT, pageId);
  const record = readRecord(archive, ACCOUNT, pageId);
  const analysisPath = path.join(root, "analysis.json");
  fs.writeFileSync(analysisPath, JSON.stringify(analysisDoc([
    {
      post_id: pageId,
      archive_sha256: record.archive_sha256,
      disposition: "actionable",
      rationale: "Grounded note kept with the archived bookmark.",
      suggestion: {
        title: "Read the source",
        detail: "Compare the claim with the archived post.",
        source_url: stored.url,
      },
      unhelpful_reason: null,
    },
  ])));
  const answers = path.join(root, "answers.json");
  fs.writeFileSync(answers, JSON.stringify({}));
  const asked = capture();
  assert.equal(runReview(["onboard", "--answers", answers], asked), 0);
  assert.equal(JSON.parse(asked.buffers.out).id, "x_connection");
  const accepted = capture();
  assert.equal(runReview(["accept-analysis", "--account", ACCOUNT, "--archive", archive, "--analysis", analysisPath], accepted), 0);
  const recommended = capture();
  assert.equal(runReview(["recommend", "--account", ACCOUNT, "--archive", archive], recommended), 0);
  assert.equal(JSON.parse(recommended.buffers.out).silent, false);
  const consent = capture();
  assert.equal(runReview(["consent-set", "--account", ACCOUNT, "--archive", archive, "--processed", "true"], consent), 0);
  assert.equal(JSON.parse(consent.buffers.out).cleanup_processed, true);
  const shown = capture();
  assert.equal(runReview(["consent-show", "--account", ACCOUNT, "--archive", archive], shown), 0);
  const planned = capture();
  assert.equal(runReview(["plan", "--account", ACCOUNT, "--archive", archive], planned), 0);
  const planId = JSON.parse(planned.buffers.out).plan_id;
  const preview = capture();
  assert.equal(runReview(["apply", "--account", ACCOUNT, "--archive", archive, "--plan", planId], preview), 3);
  assert.equal(JSON.parse(preview.buffers.out).issue, false);
  const issued = capture();
  assert.equal(runReview(["apply", "--account", ACCOUNT, "--archive", archive, "--plan", planId, "--yes"], issued), 0);
  const ops = JSON.parse(issued.buffers.out);
  assert.equal(ops.issue, true);
  assert.equal(ops.connector_ops[0].tool, "delete_users_bookmark");
  assert.equal(ops.deletes_post, false);
  const results = path.join(root, "results.json");
  fs.writeFileSync(results, JSON.stringify({
    account_id: ACCOUNT,
    results: [{ tweet_id: pageId, removed: true }],
  }));
  const committed = capture();
  assert.equal(runReview(["commit-removal", "--account", ACCOUNT, "--archive", archive, "--results", results], committed), 0);
  assert.equal(fs.existsSync(path.join(archive, "accounts", ACCOUNT, "posts", `${pageId}.json`)), true);
  const presence = path.join(root, "presence.json");
  fs.writeFileSync(presence, JSON.stringify({ account_id: ACCOUNT, posts: [] }));
  const reconciled = capture();
  assert.equal(runReview(["reconcile", "--account", ACCOUNT, "--archive", archive, "--presence", presence], reconciled), 0);
  const rejected = capture();
  assert.equal(runReview(["recommend", "--yes", "--account", ACCOUNT, "--archive", archive], rejected), 1);
  assert.equal(JSON.parse(rejected.buffers.err).code, "rejected");
  const blanket = capture();
  assert.equal(runReview(["--all"], blanket), 1);
  const missingSibling = capture();
  assert.equal(runReview([], { ...missingSibling, siblingStatus: () => ({ ok: false }) }), 2);
  const applied = capture();
  fs.writeFileSync(answers, JSON.stringify({
    account_id: ACCOUNT,
    x_connected: true,
    goals: "ship notes",
    cadence: "weekly",
    cleanup_mode: "preview",
  }));
  assert.equal(runReview(["onboard", "--apply", "--answers", answers, "--account", ACCOUNT, "--archive", archive], applied), 0);
  assert.equal(JSON.parse(applied.buffers.out).done, true);
  const unknown = capture();
  assert.equal(runReview(["nope", "--account", ACCOUNT, "--archive", archive], unknown), 1);
  const badBool = capture();
  assert.equal(runReview(["consent-set", "--account", ACCOUNT, "--archive", archive, "--processed", "yes"], badBool), 1);
  const badCap = capture();
  assert.equal(runReview(["plan", "--account", ACCOUNT, "--archive", archive, "--cap", "0"], badCap), 1);
  const depsMissing = capture();
  assert.equal(runReviewDeps([], { ...depsMissing, siblingStatus: () => ({ ok: false }) }), 2);
  const deps = capture();
  assert.equal(runReviewDeps(["--require-connector"], deps), 2);
  const depsOk = capture();
  assert.equal(runReviewDeps(["--help"], depsOk), 0);
  const spawned = spawnSync(process.execPath, [depsCli], { encoding: "utf8" });
  assert.equal(spawned.status, 0);
  assert.equal(JSON.parse(spawned.stdout).live_proven_ego_skill, false);
  const help = spawnSync(process.execPath, [reviewCli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /preview/);
});
