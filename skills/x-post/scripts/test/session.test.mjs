import assert from "node:assert/strict";
import test from "node:test";
import { HOME_URL } from "../lib/pure.mjs";
import { createXSession, readCookieJar } from "../lib/session.mjs";

function installDocument(partial = {}) {
  const links = partial.links || [];
  globalThis.document = {
    body: partial.body === null ? null : { innerText: partial.text ?? "发帖" },
    documentElement: partial.documentElement === null ? null : { lang: partial.lang ?? "zh-CN", outerHTML: partial.html ?? "<html>ok</html>" },
    cookie: partial.cookie ?? "",
    querySelector(selector) {
      if (String(selector).includes("AppTabBar_Profile_Link")) return partial.profile ?? null;
      return null;
    },
    querySelectorAll() {
      return links;
    },
  };
}

function link(label, href) {
  return { innerText: label, getAttribute() { return href; } };
}

function fakePage(overrides = {}) {
  const calls = { goto: [], fetch: [], idle: 0, timeout: 0, finish: [] };
  const state = { response: overrides.response ?? { status: 200, body: '{"ok":true}' } };
  const page = {
    async url() { return overrides.url ?? "https://x.com/home"; },
    async title() { return overrides.title ?? "主页 / X"; },
    async goto(url) { calls.goto.push(url); },
    async waitForLoadState() { calls.idle += 1; },
    async waitForTimeout(ms) { calls.timeout = ms; },
    async evaluate(fn) {
      if (overrides.evaluateThrows) throw new Error("evaluate down");
      if (overrides.evaluateNull) return null;
      return fn();
    },
    async fetch(url, opts) {
      calls.fetch.push({ url, opts });
      return state.response;
    },
    async cdp() {
      return overrides.cdp ?? { cookies: [{ name: "auth_token", value: "auth-secret" }, { name: "ct0", value: "jar-secret" }] };
    },
  };
  const task = {
    spaceId: 19,
    async finish(arg) { calls.finish.push(arg); },
    async handOff() { calls.hand = (calls.hand || 0) + 1; },
  };
  return { page, task, calls, state };
}

test("readCookieJar falls back and reports a failed read", async () => {
  assert.deepEqual(await readCookieJar(null), { cookies: [], read: false });
  assert.deepEqual(await readCookieJar({}), { cookies: [], read: false });
  const direct = await readCookieJar({
    async cdp(_method, args) {
      assert.deepEqual(args, undefined);
      return { cookies: [{ name: "auth_token", value: "s" }] };
    },
  });
  assert.equal(direct.read, true);
  let calls = 0;
  const fallback = await readCookieJar({
    async cdp() {
      calls += 1;
      if (calls === 1) return { cookies: null };
      return { cookies: [{ name: "ct0", value: "s" }] };
    },
  });
  assert.equal(fallback.cookies[0].name, "ct0");
  const thrown = await readCookieJar({
    async cdp() { throw new Error("cdp down"); },
  });
  assert.equal(thrown.read, false);
  let n = 0;
  const second = await readCookieJar({
    async cdp() {
      n += 1;
      if (n === 1) throw new Error("scoped");
      return { nope: true };
    },
  });
  assert.equal(second.read, false);
});

test("createXSession requires a task and a page", () => {
  assert.throws(() => createXSession(), /requires task and page/);
  assert.throws(() => createXSession({ task: {} }), /requires task and page/);
});

test("detect reads profile chrome without returning cookie values", async () => {
  installDocument({
    cookie: "ct0=doc-secret; auth_token=also-secret",
    profile: { getAttribute() { return "/Suchuanyi"; } },
  });
  const harness = fakePage();
  const session = createXSession(harness);
  const detected = await session.detect();
  assert.equal(detected.authCookie, true);
  assert.equal(detected.csrfCookie, true);
  assert.equal(detected.profileHref, "/Suchuanyi");
  assert.equal(detected.lang, "zh-CN");
  assert.equal(JSON.stringify(detected).includes("secret"), false);
  const named = await session.screenName();
  assert.equal(named, "/Suchuanyi");
  const csrf = await session.csrfToken();
  assert.equal(csrf, "doc-secret");
  assert.match(await session.pageSource(), /<html>/);
});

test("profile label fallback, empty document, and thrown probes", async () => {
  installDocument({
    profile: null,
    links: [link("Home", "/home"), link("个人资料", "/Suchuanyi")],
    cookie: "guest=1",
  });
  const harness = fakePage({ cdp: { cookies: [] } });
  const session = createXSession(harness);
  const detected = await session.detect();
  assert.equal(detected.profileHref, "/Suchuanyi");
  assert.equal(detected.authCookie, false);
  assert.equal(await session.screenName(), "/Suchuanyi");
  installDocument({ profile: null, links: [link("Home", "/home")], cookie: "" });
  assert.equal(await createXSession(fakePage()).screenName(), "");

  installDocument({
    profile: { getAttribute() { return ""; } },
    links: [link("Profile", null)],
    body: null,
    documentElement: null,
    cookie: "",
    html: "",
  });
  const empty = createXSession(fakePage({
    cdp: { cookies: [{ name: "ct0", value: "jar-secret" }] },
  }));
  const blank = await empty.detect();
  assert.equal(blank.text, "");
  assert.equal(blank.profileHref, "");
  assert.equal(await empty.pageSource(), "");
  assert.equal(await empty.csrfToken(), "jar-secret");

  const broken = fakePage({
    evaluateThrows: true,
    url: "about:blank",
    cdp: { cookies: [{ name: "ct0", value: "from-jar" }] },
  });
  broken.page.url = async () => { throw new Error("no url"); };
  broken.page.title = async () => { throw new Error("no title"); };
  const recovered = createXSession(broken);
  const detectedBroken = await recovered.detect();
  assert.equal(detectedBroken.url, "");
  assert.equal(detectedBroken.title, "");
  assert.equal(await recovered.csrfToken(), "from-jar");

  installDocument({ cookie: "" });
  const noCsrf = createXSession(fakePage({ evaluateThrows: true, cdp: { cookies: [{ name: "guest" }] } }));
  assert.equal(await noCsrf.csrfToken(), "");
});

test("fetch, navigation, and finish", async () => {
  installDocument();
  const harness = fakePage();
  const session = createXSession(harness);
  await session.ensureSite();
  assert.deepEqual(harness.calls.goto, []);
  harness.page.url = async () => "https://twitter.com/home";
  await session.ensureSite();
  assert.deepEqual(harness.calls.goto, []);
  harness.page.url = async () => "";
  await session.ensureSite();
  assert.equal(harness.calls.goto[0], HOME_URL);
  assert.equal(harness.calls.timeout, 800);

  const elsewhere = fakePage();
  elsewhere.page.url = async () => { throw new Error("no url"); };
  elsewhere.page.waitForLoadState = async () => { throw new Error("sockets"); };
  delete elsewhere.page.waitForTimeout;
  const moved = createXSession(elsewhere);
  await moved.ensureSite();
  assert.equal(elsewhere.calls.goto[0], HOME_URL);
  await moved.goto("https://x.com/home");

  const text = await session.fetchText("https://abs.twimg.com/responsive-web/client-web/main.js");
  assert.equal(text, '{"ok":true}');
  harness.state.response = { status: 200, body: { queryId: "abc" } };
  assert.match(await session.fetchText("https://x.com/bundle"), /queryId/);
  harness.state.response = { status: 200, body: null };
  assert.equal(await session.fetchText("https://x.com/empty"), "");

  const posted = await session.postJson({
    url: "https://x.com/i/api/graphql/abc/CreateTweet",
    headers: { "x-csrf-token": "secret" },
    body: { variables: { tweet_text: "hi" } },
  });
  assert.equal(posted.status, 200);
  const sent = harness.calls.fetch.at(-1);
  assert.equal(sent.opts.method, "POST");
  assert.equal(sent.opts.credentials, "include");
  assert.match(sent.opts.body, /tweet_text/);
  harness.state.response = null;
  const emptyPost = await session.postJson({ url: "https://x.com/i/api/graphql/abc/CreateTweet", headers: {}, body: {} });
  assert.equal(emptyPost.status, 0);
  harness.state.response = { status: 200, body: "{\"ok\":true}" };
  assert.deepEqual((await session.postJson({ url: "https://x.com/x", headers: {}, body: {} })).body, { ok: true });

  await session.finish();
  await session.finish();
  assert.deepEqual(harness.calls.finish, [{ keep: [] }]);
  const kept = createXSession({ ...harness, keep: true });
  await kept.finish();
  assert.deepEqual(harness.calls.finish.at(-1), { keep: ["p1"] });
  await session.cleanup();
  await session.handOff();
  assert.equal(harness.calls.hand, 1);
});
