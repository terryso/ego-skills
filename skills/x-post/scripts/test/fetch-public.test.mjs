import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fetchPublicJs, isPublicClientWeb } from "../lib/fetch-public.mjs";

function response({ status = 200, body = "", headers = {} } = {}) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = headers;
  res.resume = () => {};
  queueMicrotask(() => {
    if (body) res.emit("data", Buffer.from(body));
    res.emit("end");
  });
  return res;
}

test("only abs.twimg.com client-web scripts are public fetches", () => {
  assert.equal(isPublicClientWeb("https://abs.twimg.com/responsive-web/client-web/ondemand.s.abc.js"), true);
  assert.equal(isPublicClientWeb("https://abs.twimg.com/responsive-web/client-web/main.abc.js"), true);
  assert.equal(isPublicClientWeb("https://x.com/i/api/graphql/abc/CreateNoteTweet"), false);
  assert.equal(isPublicClientWeb("http://abs.twimg.com/responsive-web/client-web/main.abc.js"), false);
  assert.equal(isPublicClientWeb("not a url"), false);
});

test("fetchPublicJs reads a 200 body and follows one redirect", async () => {
  const seen = [];
  const request = (url, _opts, cb) => {
    seen.push(url);
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    queueMicrotask(() => {
      if (String(url).includes("main.old")) {
        cb(response({ status: 302, headers: { location: "https://abs.twimg.com/responsive-web/client-web/main.new.js" } }));
        return;
      }
      cb(response({ body: `queryId:"Abcdefghijklmnop",operationName:"CreateNoteTweet"` }));
    });
    return req;
  };
  const body = await fetchPublicJs("https://abs.twimg.com/responsive-web/client-web/main.old.js", { request });
  assert.match(body, /CreateNoteTweet/);
  assert.equal(seen.length, 2);
  await assert.rejects(
    () => fetchPublicJs("https://x.com/home", { request }),
    /non public client-web/,
  );
});

test("fetchPublicJs reports HTTP errors and timeouts", async () => {
  const request = (_url, _opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = (error) => req.emit("error", error);
    queueMicrotask(() => cb(response({ status: 404, body: "missing" })));
    return req;
  };
  await assert.rejects(
    () => fetchPublicJs("https://abs.twimg.com/responsive-web/client-web/ondemand.s.missing.js", { request }),
    /HTTP 404/,
  );
  const timingOut = (_url, _opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = (error) => req.emit("error", error);
    queueMicrotask(() => req.emit("timeout"));
    return req;
  };
  await assert.rejects(
    () => fetchPublicJs("https://abs.twimg.com/responsive-web/client-web/main.slow.js", { request: timingOut }),
    /timeout/,
  );
  const failing = () => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    queueMicrotask(() => req.emit("error", new Error("socket down")));
    return req;
  };
  await assert.rejects(
    () => fetchPublicJs("https://abs.twimg.com/responsive-web/client-web/main.down.js", { request: failing }),
    /socket down/,
  );
});
