// Upload-settle gate for the Kuaishou creator form.
// A timed-out, failed, or unreadable upload must not be treated as complete.

import { uploadSignals } from "./pure.mjs";

export const UPLOAD_ACCEPT_TIMEOUT_MS = 120_000;
export const UPLOAD_CLEAR_TIMEOUT_MS = 60_000;
export const UPLOAD_RECHECK_MS = 2_000;
export const UPLOAD_CLEAR_ATTEMPTS = 60;

const UPLOAD_FAILURE_RE = /上传失败|上传出错|上传异常|视频上传失败/;

function detail(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

export function classifyUploadBody(text) {
  if (text == null) {
    return { state: "unresolved", accepted: false, uploading: false, failed: false };
  }
  const body = String(text);
  if (!body.trim()) {
    return { state: "unresolved", accepted: false, uploading: false, failed: false };
  }
  const signals = uploadSignals(body);
  if (UPLOAD_FAILURE_RE.test(body)) {
    return { state: "failed", accepted: signals.accepted, uploading: signals.uploading, failed: true };
  }
  if (signals.uploading) {
    return { state: "uploading", accepted: signals.accepted, uploading: true, failed: false };
  }
  if (signals.accepted) {
    return { state: "ready", accepted: true, uploading: false, failed: false };
  }
  return { state: "unresolved", accepted: false, uploading: false, failed: false };
}

function stop(state, error) {
  return { ok: false, state, mayPublish: false, error };
}

function waitFailure(error, during) {
  const text = detail(error);
  const timedOut = /timeout|timed out|超时/i.test(text);
  if (timedOut) return stop("timeout", `上传等待超时（${during}），停止发布: ${text}`);
  return stop("unresolved", `上传状态无法确认（${during}），停止发布: ${text}`);
}

export async function waitForKuaishouUpload(page, options = {}) {
  if (!page || typeof page.waitForFunction !== "function" || typeof page.evaluate !== "function") {
    return stop("unresolved", "上传状态无法确认（页面没有等待接口），停止发布");
  }
  const acceptTimeoutMs = options.acceptTimeoutMs ?? UPLOAD_ACCEPT_TIMEOUT_MS;
  const clearTimeoutMs = options.clearTimeoutMs ?? UPLOAD_CLEAR_TIMEOUT_MS;
  const recheckMs = options.recheckMs ?? UPLOAD_RECHECK_MS;
  const attempts = options.attempts == null ? UPLOAD_CLEAR_ATTEMPTS : options.attempts;

  try {
    await page.waitForFunction(
      () => (document.body.innerText || "").includes("重新上传"),
      undefined,
      { timeout: acceptTimeoutMs },
    );
  } catch (error) {
    return waitFailure(error, "未见「重新上传」");
  }

  let last = classifyUploadBody("");
  for (let i = 0; i < attempts; i += 1) {
    try {
      await page.waitForFunction(
        () => !(document.body.innerText || "").includes("上传中"),
        undefined,
        { timeout: clearTimeoutMs },
      );
    } catch (error) {
      return waitFailure(error, "仍见「上传中」或等待失败");
    }
    if (recheckMs > 0) {
      if (typeof page.waitForTimeout !== "function") {
        return stop("unresolved", "上传复核等待不可用，停止发布");
      }
      await page.waitForTimeout(recheckMs);
    }
    let text;
    try {
      text = await page.evaluate(() => (document.body && document.body.innerText) || "");
    } catch (error) {
      return stop("unresolved", `上传状态无法读取，停止发布: ${detail(error)}`);
    }
    last = classifyUploadBody(text);
    if (last.state === "failed") return stop("failed", "上传失败，停止发布");
    if (last.state === "ready") return { ok: true, state: "ready", mayPublish: true };
    if (last.state === "unresolved") {
      return stop("unresolved", "上传状态无法确认（未见稳定的「重新上传」），停止发布");
    }
  }
  const state = last.state === "uploading" ? "timeout" : "unresolved";
  return stop(state, "上传等待次数用尽，不能当作上传完成，停止发布");
}
