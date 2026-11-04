// page.fetch session for x.com. Cookie values stay inside this process.

import { HOME_URL, cookieHeaderNames, detectSignals, parseLooseJson } from "./pure.mjs";
import {
  animationPathsFromHtml,
  buildTransactionId,
  describeMissingMaterials,
  onDemandFileUrl,
  shellHasMaterials,
} from "./transaction.mjs";

export async function readCookieJar(page) {
  if (!page || typeof page.cdp !== "function") return { cookies: [], read: false };
  try {
    const scoped = await page.cdp("Network.getCookies", { urls: ["https://x.com/", "https://twitter.com/"] });
    if (scoped && Array.isArray(scoped.cookies)) return { cookies: scoped.cookies, read: true };
  } catch {
    // Some ego builds want the unscoped call.
  }
  try {
    const all = await page.cdp("Network.getCookies");
    if (all && Array.isArray(all.cookies)) return { cookies: all.cookies, read: true };
  } catch {
    return { cookies: [], read: false };
  }
  return { cookies: [], read: false };
}

function cookieNames(jar, header) {
  return [
    ...cookieHeaderNames(header),
    ...(jar.cookies || []).map((cookie) => cookie && cookie.name).filter(Boolean),
  ];
}

export function createXSession({ task, page, pageName = "p1", keep = false } = {}) {
  if (!task || !page) throw new Error("createXSession requires task and page");
  let finished = false;
  const finishWith = async (names) => {
    if (finished) return;
    finished = true;
    await task.finish({ keep: names });
  };
  return {
    spaceId: task.spaceId,
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try {
        if (typeof page.waitForLoadState === "function") await page.waitForLoadState("networkidle", { timeout: 8_000 });
      } catch {
        // x.com keeps sockets open after the shell is ready.
      }
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(800);
    },
    async ensureSite() {
      let current = "";
      try {
        current = await page.url();
      } catch {
        current = "";
      }
      if (!current || !/x\.com|twitter\.com/i.test(String(current))) await this.goto(HOME_URL);
    },
    async detect() {
      let url = "";
      let title = "";
      let probe = { text: "", href: "", cookie: "", lang: "" };
      try { url = await page.url(); } catch { url = ""; }
      try { title = await page.title(); } catch { title = ""; }
      try {
        const evaluated = await page.evaluate(() => {
          const text = (document.body && document.body.innerText) || "";
          const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
          let href = profile ? profile.getAttribute("href") || "" : "";
          if (!href) {
            const links = document.querySelectorAll("a[href]");
            for (const link of links) {
              const label = (link.innerText || "").trim();
              if (label === "个人资料" || label === "Profile") {
                href = link.getAttribute("href") || "";
                break;
              }
            }
          }
          return {
            text: text.slice(0, 4000),
            href,
            cookie: document.cookie || "",
            lang: (document.documentElement && document.documentElement.lang) || "",
          };
        });
        if (evaluated) probe = evaluated;
      } catch {
        // A blank tab still gets a cookie-jar read below.
      }
      const jar = await readCookieJar(page);
      const names = new Set(cookieNames(jar, probe.cookie));
      const signals = detectSignals({
        url,
        title,
        text: probe.text,
        profileHref: probe.href,
        authCookie: names.has("auth_token"),
        csrfCookie: names.has("ct0"),
        jarRead: jar.read,
      });
      return { url, title, text: probe.text || "", lang: probe.lang || "", ...signals };
    },
    async pageSource() {
      const html = await page.evaluate(() => (document.documentElement && document.documentElement.outerHTML) || "");
      return String(html || "");
    },
    async fetchText(url) {
      const response = await page.fetch(url, { method: "GET", credentials: "include", timeout: 30_000 });
      const raw = response ? response.body : "";
      if (typeof raw === "string") return raw;
      if (raw == null) return "";
      return JSON.stringify(raw);
    },
    async csrfToken() {
      let fromDoc = "";
      try {
        fromDoc = await page.evaluate(() => {
          const match = (document.cookie || "").match(/(?:^|;\s*)ct0=([^;]+)/);
          return match ? decodeURIComponent(match[1]) : "";
        });
      } catch {
        fromDoc = "";
      }
      if (fromDoc) return String(fromDoc);
      const jar = await readCookieJar(page);
      const ct0 = (jar.cookies || []).find((cookie) => cookie && cookie.name === "ct0" && cookie.value);
      return ct0 ? String(ct0.value) : "";
    },
    async animationPaths() {
      const paths = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("[id^='loading-x-anim']")).map((frame) => {
          const group = frame.children && frame.children[0];
          const node = group && group.children && group.children[1];
          return node && node.getAttribute ? (node.getAttribute("d") || "") : "";
        });
      });
      return Array.isArray(paths) ? paths.map((path) => String(path || "")) : [];
    },
    async shellHtml() {
      if (this._shell) return this._shell;
      const urls = ["https://x.com/i/jf/", "https://x.com/home", "https://x.com/"];
      let best = "";
      for (const url of urls) {
        let text = "";
        try {
          text = await this.fetchText(url);
        } catch {
          text = "";
        }
        if (shellHasMaterials(text)) {
          this._shell = text;
          return text;
        }
        if (text && text.length > best.length) best = text;
      }
      try {
        await this.goto("https://x.com/i/jf/");
      } catch {
        // The fetched documents above are enough when they already contain the shell.
      }
      try {
        const live = await this.pageSource();
        if (shellHasMaterials(live)) {
          this._shell = live;
          return live;
        }
        if (live && live.length > best.length) best = live;
      } catch {
        // pageSource can fail when the DOM is too large to read back.
      }
      try {
        await this.goto(HOME_URL);
      } catch {
        // Stay where navigation left us; the POST does not depend on the visible tab.
      }
      this._shell = best;
      return best;
    },
    async clientTransaction({ method, path } = {}) {
      const html = await this.shellHtml();
      let paths = animationPathsFromHtml(html);
      if (!paths.some(Boolean)) {
        try {
          paths = await this.animationPaths();
        } catch {
          paths = [];
        }
      }
      const chunkUrl = onDemandFileUrl(html);
      let chunk = "";
      if (chunkUrl) {
        try {
          chunk = await this.fetchText(chunkUrl);
        } catch {
          chunk = "";
        }
      }
      const id = await buildTransactionId({ method, path, html, ondemandSource: chunk, paths });
      if (id) return id;
      const missing = describeMissingMaterials({ html, ondemandSource: chunk, paths });
      const error = new Error(`x.com document is missing ${missing.join(", ") || "transaction materials"}`);
      error.code = "TRANSACTION_MATERIALS";
      throw error;
    },
    async screenName() {
      const href = await page.evaluate(() => {
        const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        if (profile) return profile.getAttribute("href") || "";
        const links = document.querySelectorAll("a[href]");
        for (const link of links) {
          const label = (link.innerText || "").trim();
          if (label === "个人资料" || label === "Profile") return link.getAttribute("href") || "";
        }
        return "";
      });
      return String(href || "");
    },
    async postJson(request) {
      // Media upload is not implemented. The body is the captured text-only CreateTweet shape.
      const response = await page.fetch(request.url, {
        method: "POST",
        credentials: "include",
        headers: request.headers,
        body: JSON.stringify(request.body),
        timeout: 30_000,
      });
      const raw = response ? response.body : undefined;
      const body = typeof raw === "string" || raw == null ? parseLooseJson(raw) : raw;
      return { status: response && response.status ? response.status : 0, body };
    },
    async handOff() {
      if (typeof task.handOff === "function") await task.handOff();
    },
    finish() {
      return finishWith(keep ? [pageName] : []);
    },
    cleanup() {
      return finishWith([]);
    },
  };
}
