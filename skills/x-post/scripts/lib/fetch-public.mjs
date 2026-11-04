// Public X client-web assets live on abs.twimg.com.
// page.fetch uses window.fetch and the browser CORS-blocks that host from x.com.
// These files are static and do not need the logged-in cookie jar.
// Pro accept4 reached this path and then saw `read ECONNRESET`, so a single GET is not enough.

import https from "node:https";

export const PUBLIC_JS_ATTEMPTS = 4;

const RETRYABLE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|socket hang up|timed?\s*out|aborted/i;

export function isPublicClientWeb(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:"
      && parsed.hostname === "abs.twimg.com"
      && parsed.pathname.startsWith("/responsive-web/client-web/")
      && parsed.pathname.endsWith(".js");
  } catch {
    return false;
  }
}

export function isRetryablePublicJsError(error) {
  const message = error && error.message ? error.message : String(error || "");
  if (/non public client-web/.test(message)) return false;
  if (/redirected too many times/.test(message)) return false;
  if (/HTTP 5\d\d/.test(message) || /HTTP 408\b/.test(message) || /HTTP 429\b/.test(message)) return true;
  if (/HTTP 4\d\d/.test(message)) return false;
  return RETRYABLE.test(message);
}

export function publicJsBackoffMs(attempt) {
  return 250 * (2 ** attempt);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchPublicJsOnce(url, { request = https.request, timeout = 60_000, redirects = 3 } = {}) {
  if (!isPublicClientWeb(url)) {
    return Promise.reject(new Error(`refusing to Node-fetch a non public client-web URL: ${url}`));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(url, {
      method: "GET",
      headers: { accept: "*/*", "accept-encoding": "identity" },
      timeout,
    }, (res) => {
      const status = Number(res.statusCode || 0);
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          fail(new Error(`public JS redirected too many times: ${url}`));
          return;
        }
        let next = "";
        try {
          next = new URL(res.headers.location, url).href;
        } catch (error) {
          fail(error);
          return;
        }
        fetchPublicJsOnce(next, { request, timeout, redirects: redirects - 1 }).then((body) => {
          if (settled) return;
          settled = true;
          resolve(body);
        }, fail);
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (settled) return;
        settled = true;
        const body = Buffer.concat(chunks).toString("utf8");
        if (status !== 200) {
          reject(new Error(`public JS HTTP ${status} for ${url}`));
          return;
        }
        resolve(body);
      });
      res.on("error", fail);
    });
    req.on("error", fail);
    req.on("timeout", () => req.destroy(new Error(`public JS timeout for ${url}`)));
    req.end();
  });
}

export async function fetchPublicJs(url, options = {}) {
  const attempts = Math.min(5, Math.max(1, Number(options.attempts) || PUBLIC_JS_ATTEMPTS));
  const sleep = options.sleep || wait;
  let last = new Error("public JS fetch failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchPublicJsOnce(url, options);
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts - 1 || !isRetryablePublicJsError(last)) throw last;
      await sleep(publicJsBackoffMs(attempt));
    }
  }
  throw last;
}
