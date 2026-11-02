import fs from "node:fs/promises";
import { BASE, UA, bufferFetchResponse, sniffImage, sniffVideo } from "./pure.mjs";

export function createEgoBrowser() {
  return {
    async open({ taskName, startUrl, keepBrowser }) {
      const task = await taskSpace(taskName);
      const page = task.page("p1");
      let finished = false;
      const goto = async (url) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        try {
          await page.waitForLoadState("networkidle", { timeout: 8_000 });
        } catch {
          // Pinterest keeps background requests open.
        }
        await page.waitForTimeout(1000);
      };
      if (startUrl) await goto(startUrl);

      return {
        spaceId: task.spaceId,
        goto,
        url: () => page.url(),
        async detect() {
          const url = await page.url();
          const title = await page.title();
          const flags = await page.evaluate(() => {
            const cookie = document.cookie || "";
            return {
              unauth: Boolean(
                document.querySelector('[data-test-id="unauth-header"], [data-test-id="simple-login-button"]'),
              ),
              profile: Boolean(
                document.querySelector(
                  '[data-test-id="header-profile"], [data-test-id="header-accounts-options-button"], [data-test-id="header-avatar"], [data-test-id="business-account-switcher"]',
                ),
              ),
              authCookie: /(?:^|;\s*)_auth=1(?:;|$)/.test(cookie),
            };
          });
          return { url, title, ...flags };
        },
        async fetchJson(apiPath, extraHeaders = {}) {
          const token = await page.evaluate(() => {
            const match = (document.cookie || "").match(/(?:^|;\s*)csrftoken=([^;]+)/);
            return match ? match[1] : "";
          });
          const response = await page.fetch(apiPath, {
            method: "GET",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
              "X-Pinterest-AppState": "active",
              ...extraHeaders,
              ...(token ? { "X-CSRFToken": token } : {}),
            },
            timeout: 20_000,
          });
          return { ok: response.ok, status: response.status, body: response.body };
        },
        async domImages(limit) {
          return page.evaluate((max) => {
            const urls = [];
            const seen = new Set();
            const push = (value) => {
              if (!value || typeof value !== "string" || !/pinimg\.com/i.test(value)) return;
              const clean = value.split("?")[0];
              if (seen.has(clean)) return;
              seen.add(clean);
              urls.push(clean);
            };
            for (const img of document.querySelectorAll("img")) {
              push(img.currentSrc || img.src);
              for (const part of (img.getAttribute("srcset") || "").split(",")) push(part.trim().split(/\s+/)[0]);
            }
            return urls.slice(0, Math.max(max * 3, 12));
          }, limit);
        },
        async fetchBytes(targetUrl, { maxBytes } = {}) {
          let read = { ok: false, status: 0, type: "", buf: Buffer.alloc(0), error: "not fetched" };
          try {
            const response = await fetch(targetUrl, {
              headers: { "User-Agent": UA, Referer: `${BASE}/`, Accept: "*/*" },
              redirect: "follow",
            });
            read = await bufferFetchResponse(response, maxBytes);
            const useful =
              read.ok &&
              (sniffImage(read.buf) || sniffVideo(read.buf) || String(read.type || "").startsWith("video/"));
            if (useful || read.error) return read;
          } catch (error) {
            read = { ok: false, status: 0, type: "", buf: Buffer.alloc(0), error: String(error.message || error) };
          }
          if (/\.(mp4|m3u8|cmfv)($|\?)/i.test(targetUrl)) return read;
          const partial = `/tmp/.pinterest-partial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          try {
            await page.fetch(targetUrl, {
              headers: { Referer: `${BASE}/`, Accept: "image/*,*/*" },
              timeout: 20_000,
              saveAs: partial,
            });
            const buf = await fs.readFile(partial);
            const sniffed = sniffImage(buf);
            if (sniffed && buf.length >= 100 && (!maxBytes || buf.length <= maxBytes)) {
              return { ok: true, status: 200, type: sniffed, buf, error: null };
            }
          } catch (error) {
            return { ok: false, status: read.status || 0, type: read.type || "", buf: Buffer.alloc(0), error: String(error.message || error) };
          } finally {
            await fs.rm(partial, { force: true }).catch(() => {});
          }
          return read;
        },
        async finish() {
          if (finished) return;
          finished = true;
          await task.finish({ keep: keepBrowser ? ["p1"] : [] });
        },
      };
    },
  };
}
