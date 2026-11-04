import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURED_CREATE_NOTE_TWEET_QUERY_ID,
  CAPTURED_CREATE_TWEET_QUERY_ID,
  PUBLIC_WEB_BEARER,
} from "../lib/pure.mjs";
import { executeCleanup, executePost, performPost, resolveCreateTweetQuery } from "../lib/post-flow.mjs";

const CSRF = "csrf-secret-value";
const REST_ID = "2117826829981749672";

function successBody(screen = "Suchuanyi") {
  return {
    data: {
      create_tweet: {
        tweet_results: {
          result: {
            rest_id: REST_ID,
            legacy: { id_str: REST_ID },
            core: { user_results: { result: { core: { screen_name: screen } } } },
          },
        },
      },
    },
  };
}

function session(overrides = {}) {
  const calls = { post: null, goto: [], hand: 0, finish: 0, fetched: [] };
  return {
    calls,
    spaceId: 19,
    async ensureSite() {},
    async detect() {
      return overrides.detect ?? {
        url: "https://x.com/home",
        title: "主页 / X",
        text: "发帖",
        lang: "zh-CN",
        authCookie: true,
        csrfCookie: true,
        jarRead: true,
        onLoginWall: false,
        platformChrome: true,
        profileHref: "/Suchuanyi",
      };
    },
    async csrfToken() { return overrides.csrf === undefined ? CSRF : overrides.csrf; },
    async pageSource() {
      if (overrides.pageSourceError) throw new Error("html down");
      return overrides.html ?? "<html></html>";
    },
    async fetchText(url) {
      calls.fetched.push(url);
      if (overrides.fetchError) throw new Error("bundle down");
      return overrides.bundle ?? "";
    },
    async screenName() {
      if (overrides.screenError) throw new Error("no profile");
      return overrides.href ?? "/Suchuanyi";
    },
    async postJson(request) {
      calls.post = request;
      return overrides.response ?? { status: 200, body: successBody() };
    },
    async goto(url) { calls.goto.push(url); },
    async handOff() {
      calls.hand += 1;
      if (overrides.handError) throw new Error("hand");
    },
    async finish() {
      calls.finish += 1;
      if (overrides.finishError) throw new Error("finish");
    },
    async cleanup() { calls.finish += 1; },
  };
}

test("a verified CreateTweet response becomes the status URL", async () => {
  const live = session();
  const summary = await performPost({ yes: true, text: "ego-x-post-capture-ping" }, live);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.sent, true);
  assert.equal(summary.url, `https://x.com/Suchuanyi/status/${REST_ID}`);
  assert.equal(summary.query_id, CAPTURED_CREATE_TWEET_QUERY_ID);
  assert.equal(summary.query_id_source, "captured-2026-11-04");
  assert.equal(live.calls.post.headers["x-csrf-token"], CSRF);
  assert.equal(live.calls.post.headers.authorization, `Bearer ${PUBLIC_WEB_BEARER}`);
  assert.equal(live.calls.post.headers["x-twitter-client-language"], "zh-cn");
  assert.equal("x-client-transaction-id" in live.calls.post.headers, false);
  assert.equal(live.calls.post.body.variables.disallowed_reply_options, null);
  assert.equal(JSON.stringify(summary).includes(CSRF), false);
  assert.equal(JSON.stringify(summary).includes(PUBLIC_WEB_BEARER), false);
});

test("bundle query id and bearer win over the captured fallback", async () => {
  const bundleId = "AbcdefghijklmnopQR";
  const bearer = "AAAAAAAAAAAAAAAAAAAAANRILgTESTTOKEN123456";
  const html = `<script src="https://abs.twimg.com/responsive-web/client-web/vendor.1.js"></script><script src="https://abs.twimg.com/responsive-web/client-web/main.deadbeef.js"></script>`;
  const live = session({
    html,
    bundle: `queryId:"${bundleId}",operationName:"CreateTweet" ${bearer}`,
  });
  const summary = await performPost({ yes: true, text: "hi" }, live);
  assert.equal(summary.query_id, bundleId);
  assert.equal(summary.query_id_source, "bundle");
  assert.equal(live.calls.post.url, `https://x.com/i/api/graphql/${bundleId}/CreateTweet`);
  assert.match(live.calls.fetched[0], /\/main\./);
  assert.match(live.calls.post.headers.authorization, /TESTTOKEN123456$/);
});

test("an explicit query id is sent, and a bad one is refused", async () => {
  const live = session({ html: `queryId:"ShouldNotUse0000",operationName:"CreateTweet"` });
  const summary = await performPost({ yes: true, text: "hi", queryId: "OverrideId123456" }, live);
  assert.equal(summary.query_id, "OverrideId123456");
  assert.equal(summary.query_id_source, "flag");
  assert.equal(live.calls.fetched.length, 0);
  const bad = await performPost({ yes: true, text: "hi", queryId: "!!!" }, session());
  assert.equal(bad.exitCode, 1);
  assert.match(bad.error, /not usable/);
  assert.equal(bad.query_id_source, "flag");
});

test("screen name falls back to the profile link, then i/web", async () => {
  const nameless = successBody("");
  delete nameless.data.create_tweet.tweet_results.result.core;
  const fromProfile = await performPost({ yes: true, text: "hi" }, session({
    response: { status: 200, body: nameless },
    href: "https://x.com/Suchuanyi",
  }));
  assert.equal(fromProfile.url, `https://x.com/Suchuanyi/status/${REST_ID}`);
  const web = await performPost({ yes: true, text: "hi" }, session({
    response: { status: 200, body: nameless },
    href: "/home",
    screenError: true,
  }));
  assert.equal(web.url, `https://x.com/i/web/status/${REST_ID}`);
});

test("replies are sent as best-effort and 226 is not retried", async () => {
  const live = session();
  const summary = await performPost({ yes: true, text: "reply", replyTo: "2117826677376160218" }, live);
  assert.equal(summary.reply_best_effort, true);
  assert.match(summary.warning, /226/);
  assert.equal(live.calls.post.body.variables.reply.in_reply_to_tweet_id, "2117826677376160218");
  const blocked = await performPost({ yes: true, text: "reply", replyTo: "5" }, session({
    response: { status: 200, body: { errors: [{ code: 226, message: "This request looks like it might be automated." }] } },
  }));
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.error, /best-effort/);
  assert.equal(blocked.sent, false);
});

test("login, csrf, rate limit, and repaint", async () => {
  const wall = session({
    detect: { url: "https://x.com/i/flow/login", title: "登录 X", text: "Sign in to X", authCookie: false, jarRead: true, onLoginWall: true },
  });
  const loggedOut = await performPost({ yes: true, text: "hi", keep: true }, wall);
  assert.equal(loggedOut.exitCode, 2);
  assert.equal(wall.calls.hand, 1);
  assert.match(loggedOut.how_to_login[1], /x\.com\/home/);
  const handFails = session({
    detect: { url: "https://x.com/i/flow/login", title: "登录", text: "", authCookie: false, jarRead: true, onLoginWall: true },
    handError: true,
  });
  assert.equal((await performPost({ yes: true, text: "hi", keep: true }, handFails)).exitCode, 2);

  const noCsrf = await performPost({ yes: true, text: "hi", keep: true }, session({ csrf: "", handError: true }));
  assert.equal(noCsrf.exitCode, 2);
  assert.match(noCsrf.error, /ct0 missing/);

  const blank = session({
    detect: { url: "about:blank", title: "", text: "", authCookie: false, jarRead: false },
  });
  let paints = 0;
  blank.detect = async () => {
    paints += 1;
    if (paints === 1) return { url: "about:blank", title: "", text: "", authCookie: false, jarRead: false };
    return { url: "https://x.com/home", title: "主页 / X", text: "发帖", lang: "", authCookie: true, jarRead: true, profileHref: "/Suchuanyi" };
  };
  const painted = await performPost({ yes: true, text: "hi" }, blank);
  assert.equal(painted.exitCode, 0);
  assert.equal(blank.calls.goto[0], "https://x.com/home");
  assert.equal("x-twitter-client-language" in blank.calls.post.headers, false);

  const limited = await performPost({ yes: true, text: "hi" }, session({
    response: { status: 429, body: { errors: [{ code: 88, message: "Rate limit exceeded" }] } },
  }));
  assert.match(limited.error, /Not retried/);
  const unauth = await performPost({ yes: true, text: "hi" }, session({
    response: { status: 401, body: { errors: [{ message: "Could not authenticate" }] } },
  }));
  assert.equal(unauth.exitCode, 2);
});

test("without --yes nothing is fetched, and executePost closes the space", async () => {
  const live = session();
  const draft = await performPost({ text: "hi" }, live);
  assert.equal(draft.exitCode, 3);
  assert.equal(live.calls.post, null);
  const browser = {
    async open() { throw new Error("should not open"); },
  };
  const skipped = await executePost({ text: "hi" }, { browser });
  assert.equal(skipped.exitCode, 3);

  const opened = session();
  const summary = await executePost({ yes: true, text: "hi", keep: true, taskName: "custom" }, {
    browser: {
      async open(opts) {
        assert.equal(opts.taskName, "custom");
        assert.equal(opts.keepBrowser, true);
        assert.equal(opts.startUrl, "https://x.com/home");
        return opened;
      },
    },
  });
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.spaceId, 19);
  assert.equal(opened.calls.finish, 1);

  const boom = await executePost({ yes: true, text: "hi" }, {
    browser: { async open() { throw new Error("space down"); } },
  });
  assert.equal(boom.exitCode, 1);
  assert.match(boom.error, /space down/);

  const finishBoom = session({ finishError: true });
  const finished = await executePost({ yes: true, text: "hi" }, {
    browser: { async open() { return finishBoom; } },
  });
  assert.equal(finished.exitCode, 0);
  assert.match(finished.finish_error, /finish/);
});

test("text over the short limit uses CreateNoteTweet and a transaction id", async () => {
  const live = session();
  live.clientTransaction = async ({ method, path }) => {
    assert.equal(method, "POST");
    assert.match(path, /\/CreateNoteTweet$/);
    return "tid-secret-value";
  };
  const summary = await performPost({ yes: true, text: "x".repeat(332) }, live);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.operation, "CreateNoteTweet");
  assert.equal(summary.note, true);
  assert.equal(summary.query_id, CAPTURED_CREATE_NOTE_TWEET_QUERY_ID);
  assert.equal(summary.query_id_source, "captured-note-2026-11-04");
  assert.equal(summary.transaction_id_source, "generated");
  assert.equal(live.calls.post.url, `https://x.com/i/api/graphql/${CAPTURED_CREATE_NOTE_TWEET_QUERY_ID}/CreateNoteTweet`);
  assert.equal(live.calls.post.headers["x-client-transaction-id"], "tid-secret-value");
  assert.equal(live.calls.post.body.variables.semantic_annotation_options.composition_signal_1, true);
  assert.equal(JSON.stringify(summary).includes("tid-secret-value"), false);
  assert.equal("x-client-transaction-id" in (await (async () => live.calls.post.headers)()), true);

  const broken = session();
  broken.clientTransaction = async () => { throw new Error("anim down"); };
  const missed = await performPost({ yes: true, text: "x".repeat(281) }, broken);
  assert.equal(missed.transaction_id_source, "missing");
  assert.equal("x-client-transaction-id" in broken.calls.post.headers, false);

  const forced = session();
  forced.clientTransaction = async () => { throw new Error("anim down"); };
  const flagged = await performPost({ yes: true, text: "hi", long: true, transactionId: "from-flag" }, forced);
  assert.equal(flagged.operation, "CreateNoteTweet");
  assert.equal(flagged.transaction_id_source, "flag");
  assert.equal(forced.calls.post.headers["x-client-transaction-id"], "from-flag");
  assert.equal(JSON.stringify(flagged).includes("from-flag"), false);

  const bare = await performPost({ yes: true, text: "x".repeat(281) }, session({
    response: { status: 200, body: { errors: [{ code: 226, message: "This request looks like it might be automated." }] } },
  }));
  assert.equal(bare.exitCode, 1);
  assert.match(bare.error, /without x-client-transaction-id/);
  assert.equal(bare.transaction_id_source, "missing");

  const rejected = session();
  rejected.clientTransaction = async () => "still-secret";
  const again = await performPost({ yes: true, text: "x".repeat(281) }, {
    ...rejected,
    async postJson(request) {
      rejected.calls.post = request;
      return { status: 200, body: { errors: [{ code: 226, message: "automated" }] } };
    },
  });
  assert.match(again.error, /even with x-client-transaction-id/);
  assert.equal(JSON.stringify(again).includes("still-secret"), false);

  const tooLong = await performPost({ yes: true, text: "hi" }, session({
    response: { status: 200, body: { errors: [{ code: 186, message: "Tweet needs to be a bit shorter." }] } },
  }));
  assert.match(tooLong.error, /GraphQL 186/);
});

test("resolveCreateTweetQuery survives a dead bundle fetch", async () => {
  const dead = session({ pageSourceError: true, fetchError: true });
  const resolved = await resolveCreateTweetQuery(dead, "");
  assert.equal(resolved.queryId, CAPTURED_CREATE_TWEET_QUERY_ID);
  const missed = session({
    html: '<script src="https://abs.twimg.com/responsive-web/client-web/main.err.js"></script>',
    fetchError: true,
  });
  const fallback = await resolveCreateTweetQuery(missed, "");
  assert.equal(fallback.queryId, CAPTURED_CREATE_TWEET_QUERY_ID);
  assert.equal(missed.calls.fetched.length, 1);
  const htmlId = session({ html: `queryId:"FromHtmlBundle1234",operationName:"CreateTweet" ${PUBLIC_WEB_BEARER}` });
  const fromHtml = await resolveCreateTweetQuery(htmlId, "");
  assert.equal(fromHtml.queryId, "FromHtmlBundle1234");
  assert.equal(fromHtml.bearer, PUBLIC_WEB_BEARER);
  assert.equal(htmlId.calls.fetched.length, 0);
});

test("cleanup closes the space and reports an open failure", async () => {
  const live = session();
  const closed = await executeCleanup({ taskName: "x-post" }, {
    browser: { async open(opts) { assert.equal(opts.keepBrowser, false); return live; } },
  });
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.kept, []);
  assert.equal(live.calls.finish, 1);
  const failed = await executeCleanup({}, { browser: { async open() { throw new Error("no space"); } } });
  assert.equal(failed.exitCode, 1);
  const unnamed = await executeCleanup(null, { browser: { async open() { return live; } } });
  assert.equal(unnamed.ok, true);
});
