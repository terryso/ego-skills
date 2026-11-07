import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  classifyUploadBody,
  waitForKuaishouUpload,
} from "../lib/upload-wait.mjs";

function pageOf({
  texts = ["重新上传\n上传完成"],
  acceptError = null,
  clearError = null,
  evaluateError = null,
  waitForTimeout = async () => {},
  omitWait = false,
} = {}) {
  const calls = { acceptTimeout: null, clearTimeout: null, rechecks: [], clicks: 0, reads: 0 };
  let cursor = 0;
  const page = {
    calls,
    async waitForFunction(fn, _arg, opts) {
      const source = Function.prototype.toString.call(fn);
      if (source.includes("重新上传")) {
        calls.acceptTimeout = opts && opts.timeout;
        if (acceptError) throw acceptError;
        return true;
      }
      calls.clearTimeout = opts && opts.timeout;
      if (clearError) throw clearError;
      return true;
    },
    async evaluate() {
      calls.reads += 1;
      if (evaluateError) throw evaluateError;
      const text = texts[Math.min(cursor, texts.length - 1)];
      cursor += 1;
      return text;
    },
    mouse: {
      async click() {
        calls.clicks += 1;
      },
    },
  };
  if (!omitWait) page.waitForTimeout = waitForTimeout;
  return page;
}

async function publishIfReady(page, options) {
  const upload = await waitForKuaishouUpload(page, options);
  if (!upload.ok || !upload.mayPublish) return { published: false, clicks: page.calls.clicks, upload };
  await page.mouse.click(1, 1, { label: "点击发布" });
  return { published: true, clicks: page.calls.clicks, upload };
}

test("classifyUploadBody separates ready, failed, uploading, and unresolved", () => {
  assert.equal(classifyUploadBody("重新上传\n可以发布了").state, "ready");
  assert.equal(classifyUploadBody("重新上传\n生成中…").state, "ready");
  assert.equal(classifyUploadBody("重新上传\n上传中 40%").state, "uploading");
  assert.equal(classifyUploadBody("上传失败，请重新上传").state, "failed");
  assert.equal(classifyUploadBody("视频上传失败").failed, true);
  assert.equal(classifyUploadBody("上传出错").state, "failed");
  assert.equal(classifyUploadBody("上传异常").state, "failed");
  assert.equal(classifyUploadBody("").state, "unresolved");
  assert.equal(classifyUploadBody("   ").state, "unresolved");
  assert.equal(classifyUploadBody(null).state, "unresolved");
  assert.equal(classifyUploadBody("页面走丢了").state, "unresolved");
});

test("a settled upload may publish, and the recheck still runs", async () => {
  const page = pageOf();
  const result = await publishIfReady(page);
  assert.equal(result.published, true);
  assert.equal(result.clicks, 1);
  assert.equal(result.upload.state, "ready");
  assert.equal(result.upload.mayPublish, true);
  assert.equal(page.calls.acceptTimeout, 120000);
  assert.equal(page.calls.clearTimeout, 60000);
  assert.equal(page.calls.reads, 1);
});

test("a flicker that settles on the next read still publishes once", async () => {
  const page = pageOf({ texts: ["重新上传\n上传中 10%", "重新上传\n处理完成"] });
  const result = await publishIfReady(page, { attempts: 3, recheckMs: 1, acceptTimeoutMs: 5, clearTimeoutMs: 5 });
  assert.equal(result.published, true);
  assert.equal(page.calls.reads, 2);
});

test("a never-ready upload does not publish after the wait is exhausted", async () => {
  const page = pageOf({ texts: ["重新上传\n上传中 40%"] });
  const result = await publishIfReady(page, { attempts: 3, recheckMs: 0, acceptTimeoutMs: 10, clearTimeoutMs: 10 });
  assert.equal(result.published, false);
  assert.equal(result.clicks, 0);
  assert.equal(result.upload.mayPublish, false);
  assert.equal(result.upload.ok, false);
  assert.equal(result.upload.state, "timeout");
  assert.match(result.upload.error, /不能当作上传完成/);
});

test("accept timeout, clear timeout, and a non-timeout wait failure do not publish", async () => {
  const accept = pageOf({ acceptError: new Error("Timeout 120000ms exceeded") });
  const acceptResult = await publishIfReady(accept, { attempts: 3, recheckMs: 0 });
  assert.equal(acceptResult.published, false);
  assert.equal(acceptResult.upload.state, "timeout");
  assert.match(acceptResult.upload.error, /重新上传/);
  assert.equal(accept.calls.reads, 0);

  const clear = pageOf({ clearError: "超时" });
  const clearResult = await publishIfReady(clear, { attempts: 5, recheckMs: 0 });
  assert.equal(clearResult.published, false);
  assert.equal(clearResult.upload.state, "timeout");
  assert.equal(clear.calls.clicks, 0);

  const closed = pageOf({ clearError: new Error("page closed") });
  const closedResult = await publishIfReady(closed, { attempts: 2, recheckMs: 0 });
  assert.equal(closedResult.published, false);
  assert.equal(closedResult.upload.state, "unresolved");
  assert.match(closedResult.upload.error, /page closed/);
});

test("failed, unreadable, and unresolved bodies stop before publish", async () => {
  const failed = pageOf({ texts: ["上传失败，请重新上传"] });
  const failedResult = await publishIfReady(failed, { attempts: 4, recheckMs: 0 });
  assert.equal(failedResult.published, false);
  assert.equal(failedResult.upload.state, "failed");

  const unread = pageOf({ evaluateError: new Error("evaluate failed") });
  const unreadResult = await publishIfReady(unread, { attempts: 4, recheckMs: 0 });
  assert.equal(unreadResult.published, false);
  assert.equal(unreadResult.upload.state, "unresolved");
  assert.match(unreadResult.upload.error, /无法读取/);

  const lost = pageOf({ texts: ["只剩空白提示"] });
  const lostResult = await publishIfReady(lost, { attempts: 4, recheckMs: 0 });
  assert.equal(lostResult.published, false);
  assert.equal(lostResult.upload.state, "unresolved");
  assert.match(lostResult.upload.error, /无法确认/);

  const empty = pageOf({ texts: [""] });
  const emptyResult = await publishIfReady(empty, { attempts: 2, recheckMs: 1 });
  assert.equal(emptyResult.upload.state, "unresolved");
  assert.equal(emptyResult.published, false);
});

test("a missing recheck timer or page API does not publish", async () => {
  const noTimer = pageOf({ omitWait: true });
  const missingTimer = await publishIfReady(noTimer, { attempts: 2, recheckMs: 5 });
  assert.equal(missingTimer.published, false);
  assert.match(missingTimer.upload.error, /复核等待不可用/);

  const bare = await waitForKuaishouUpload({}, { attempts: 1 });
  assert.equal(bare.mayPublish, false);
  assert.equal(bare.state, "unresolved");

  const noEvaluate = await waitForKuaishouUpload({ waitForFunction() {} }, { attempts: 1 });
  assert.equal(noEvaluate.mayPublish, false);
});

test("zero attempts are exhaustion, not success", async () => {
  const page = pageOf();
  const result = await publishIfReady(page, { attempts: 0, recheckMs: 0 });
  assert.equal(result.published, false);
  assert.equal(result.upload.state, "unresolved");
  assert.match(result.upload.error, /次数用尽/);
  assert.equal(page.calls.reads, 0);
});

test("publish.js gates the publish click on mayPublish", () => {
  const source = fs.readFileSync(new URL("../publish.js", import.meta.url), "utf8");
  const gate = source.indexOf("waitForKuaishouUpload");
  const guard = source.indexOf("mayPublish");
  const complete = source.indexOf('console.error("上传完成")');
  const click = source.indexOf("点击发布");
  assert.ok(gate >= 0);
  assert.ok(guard > gate);
  assert.ok(complete > guard);
  assert.ok(click > complete);
  assert.match(source.slice(gate, complete), /if \(!upload\.ok \|\| !upload\.mayPublish\)/);
});
