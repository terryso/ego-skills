// Public X client-web assets live on abs.twimg.com.
// page.fetch uses window.fetch and the browser CORS-blocks that host from x.com.
// These files are static and do not need the logged-in cookie jar.

import https from "node:https";

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

export function fetchPublicJs(url, { request = https.request, timeout = 60_000, redirects = 3 } = {}) {
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
    const req = request(url, { method: "GET", headers: { accept: "*/*" }, timeout }, (res) => {
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
        fetchPublicJs(next, { request, timeout, redirects: redirects - 1 }).then((body) => {
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
