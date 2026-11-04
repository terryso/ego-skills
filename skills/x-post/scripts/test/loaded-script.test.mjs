import assert from "node:assert/strict";
import test from "node:test";
import { decodeCdpBody, frameNodes, readLoadedClientScript, sameClientScript } from "../lib/loaded-script.mjs";

const ONDEMAND = "https://abs.twimg.com/responsive-web/client-web/ondemand.s.h4sha.js";
const MAIN = "https://abs.twimg.com/responsive-web/client-web/main.live.js";

function pageWith({ scripts = [], resources = [], cdp } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(fn) {
      globalThis.document = { scripts };
      globalThis.performance = {
        getEntriesByType(type) {
          if (type !== "resource") return [];
          return resources.map((name) => ({ name }));
        },
      };
      return fn();
    },
    async cdp(method, args) {
      calls.push({ method, args });
      if (cdp) return cdp(method, args);
      return {};
    },
  };
}

test("client script identity ignores query strings", () => {
  assert.equal(sameClientScript(`${ONDEMAND}?x=1`, ONDEMAND), true);
  assert.equal(sameClientScript("https://x.com/main.js", MAIN), false);
  assert.equal(sameClientScript("not a url", ONDEMAND), false);
  assert.equal(decodeCdpBody(null), "");
  assert.equal(decodeCdpBody({ content: "abc" }), "abc");
  assert.equal(decodeCdpBody({ body: Buffer.from("indices").toString("base64"), base64Encoded: true }), "indices");
  assert.equal(decodeCdpBody({ content: "" }), "");
  assert.equal(frameNodes(null).length, 0);
  assert.equal(frameNodes({ frameTree: { frame: { id: "A" }, childFrames: [{ frame: { id: "B" } }] } }).length, 2);
});

test("script textContent is used when the page already holds the source", async () => {
  const page = pageWith({
    scripts: [{ src: ONDEMAND, textContent: "(a[0], 16)(a[1], 16)" }],
  });
  const text = await readLoadedClientScript(page, ONDEMAND);
  assert.equal(text, "(a[0], 16)(a[1], 16)");
  assert.equal(page.calls.length, 0);
  assert.equal(await readLoadedClientScript(page, "https://x.com/home"), "");
  assert.equal(await readLoadedClientScript(null, ONDEMAND), "");
});

test("performance resource URL is read with Page.getResourceContent", async () => {
  const loaded = `${MAIN}?cb=1`;
  const page = pageWith({
    resources: [loaded],
    cdp(method, args) {
      if (method === "Page.getResourceTree") {
        return { frameTree: { frame: { id: "main" }, resources: [], childFrames: [{ frame: { id: "child" }, resources: [] }] } };
      }
      if (method === "Page.getResourceContent") {
        assert.equal(args.frameId, "main");
        assert.equal(args.url, loaded);
        return { content: 'queryId:"FromCacheQueryId123",operationName:"CreateNoteTweet"' };
      }
      return {};
    },
  });
  const text = await readLoadedClientScript(page, MAIN);
  assert.match(text, /FromCacheQueryId123/);
  assert.equal(page.calls.some((call) => call.method === "Network.getResponseBody"), false);
});

test("Network.getResponseBody supplies bytes when resource content is empty", async () => {
  const page = pageWith({
    cdp(method, args) {
      if (method === "Page.getResourceTree") {
        return {
          frameTree: {
            frame: { id: "main" },
            resources: [{ url: ONDEMAND, type: "Script", requestId: "req-1" }],
          },
        };
      }
      if (method === "Page.getResourceContent") {
        if (page.calls.filter((call) => call.method === "Page.getResourceContent").length === 1) {
          throw new Error("content evicted");
        }
        return { content: "" };
      }
      if (method === "Network.getResponseBody") {
        assert.equal(args.requestId, "req-1");
        return { body: Buffer.from("(a[0], 16)(a[1], 16)").toString("base64"), base64Encoded: true };
      }
      return {};
    },
  });
  // First getResourceContent throws, so the body comes from Network.getResponseBody.
  const text = await readLoadedClientScript(page, ONDEMAND);
  assert.equal(text, "(a[0], 16)(a[1], 16)");
  assert.equal(page.calls.filter((call) => call.method === "Network.getResponseBody").length, 1);

  const down = pageWith({
    cdp() { throw new Error("cdp down"); },
  });
  assert.equal(await readLoadedClientScript(down, ONDEMAND), "");
});
