#!/usr/bin/env node
// pinterest-download — search pins and save images with the Ego Lite session.
//
// ego-browser nodejs does not forward process.argv, process.env (beyond HOME/USER),
// or the shell cwd (cwd is "/"). Pass query/count/out through this CLI; it inlines
// them and runs `ego-browser nodejs`.
//
//   node skills/pinterest-download/scripts/download.mjs \
//     --query wallpaper --count 2 --out /tmp/ego-pinterest-wallpaper
//
// Direct (no args; prints usage and does not open a browser):
//   ego-browser nodejs < skills/pinterest-download/scripts/download.mjs

const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");

const BASE = "https://www.pinterest.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SIZES = new Set(["originals", "736x", "474x"]);
const MEDIAS = new Set(["image", "any"]);
const MAX_PAGES = 4;

const USAGE = `pinterest-download — search Pinterest and save pin images via ego-browser

Usage:
  node skills/pinterest-download/scripts/download.mjs --query <text> --count <n> --out <dir>
  skills/pinterest-download/scripts/download.sh --query wallpaper --count 2 --out /tmp/ego-pinterest-wallpaper

Options:
  --query, --keyword   Search text (required)
  --count, --limit     How many images to save (1-100, default 10)
  --out, --out-dir     Output directory (default ~/Downloads/pinterest-ego)
  --size               originals | 736x | 474x (default originals, falls back to 736x)
  --media              image | any (default image; video pins are skipped)
  --keep               Leave the Pinterest tab open when the run ends
  --allow-anonymous    Search while logged out (default: soft-fail and ask for a one-time Ego login)
  --task-name          Ego task space name (default: unique pinterest-download-<time>)

The embedded runtime ignores extra argv, so this file is the CLI. It injects
EGO_PINTEREST_CONFIG and executes: ego-browser nodejs
`;

const HOW_TO_LOGIN = [
  "Open the Ego Lite app and use the same profile ego-browser drives.",
  "Go to https://www.pinterest.com/login/ and sign in once. Do not automate the password.",
  "Leave that profile logged in. Cookies stay in Ego for later ego-browser runs.",
  "Re-run this skill without --allow-anonymous.",
  "Optional: if Chrome is already signed in, import that profile (ego-browser import --browser chrome --profile Default) and confirm Pinterest in the Ego window.",
];

const HOW_TO_LOGIN_ZH = [
  "打开 Ego Lite，使用 ego-browser 正在驱动的同一个配置档。",
  "访问 https://www.pinterest.com/login/ 手动登录一次。不要自动填写密码。",
  "保持该配置档处于登录状态，Cookie 会留给之后的 ego-browser 任务。",
  "去掉 --allow-anonymous 后重新运行本技能。",
  "可选：若 Chrome 已登录 Pinterest，可执行 ego-browser import --browser chrome --profile Default，再在 Ego 窗口里确认已登录。",
];

function defaultOut() {
  const home = process.env.HOME || "/tmp";
  return path.join(home, "Downloads", "pinterest-ego");
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function parseArgs(argv) {
  const out = {
    query: "",
    count: null,
    outDir: "",
    size: "originals",
    media: "image",
    keepBrowser: false,
    allowAnonymous: false,
    taskName: "",
    help: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--query" || arg === "--keyword") out.query = take();
    else if (arg === "--count" || arg === "--limit") out.count = clampCount(take());
    else if (arg === "--out" || arg === "--out-dir" || arg === "--outdir" || arg === "--dir") out.outDir = take();
    else if (arg === "--size") out.size = take();
    else if (arg === "--media") out.media = take();
    else if (arg === "--keep") out.keepBrowser = true;
    else if (arg === "--allow-anonymous") out.allowAnonymous = true;
    else if (arg === "--task-name") out.taskName = take();
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else positionals.push(arg);
  }
  if (!out.query && positionals[0]) out.query = positionals[0];
  if (out.count === null && positionals[1] !== undefined) out.count = clampCount(positionals[1]);
  if (!out.outDir && positionals[2]) out.outDir = positionals[2];
  if (out.count === null) out.count = 10;
  return out;
}

function assertSafeOutDir(dir) {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error("Refuse to use the filesystem root as the output directory");
  return resolved;
}

function toConfig(args) {
  if (!SIZES.has(args.size)) throw new Error(`--size must be one of: ${[...SIZES].join(", ")}`);
  if (!MEDIAS.has(args.media)) throw new Error(`--media must be one of: ${[...MEDIAS].join(", ")}`);
  if (!args.count) throw new Error("--count must be an integer from 1 to 100");
  const query = String(args.query || "").trim();
  if (!query) throw new Error("query is required (--query wallpaper)");
  return {
    query,
    limit: args.count,
    outDir: assertSafeOutDir(args.outDir || defaultOut()),
    size: args.size,
    media: args.media,
    keepBrowser: Boolean(args.keepBrowser),
    allowAnonymous: Boolean(args.allowAnonymous),
    taskName: String(args.taskName || `pinterest-download-${Date.now()}`),
  };
}

function readSummary(text) {
  const marker = '"skill": "pinterest-download"';
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.lastIndexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function runCli() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || error);
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  let config;
  try {
    config = toConfig(args);
  } catch (error) {
    console.error(error.message || error);
    console.error(USAGE);
    process.exit(2);
  }

  const self = fileURLToPath(import.meta.url);
  let source = await fs.readFile(self, "utf8");
  if (source.startsWith("#!")) source = source.slice(source.indexOf("\n") + 1);
  const prelude = `globalThis.EGO_PINTEREST_CONFIG = ${JSON.stringify(config)};\n`;
  const child = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdoutBuf += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuf += text;
    process.stderr.write(text);
  });
  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      console.error("ego-browser is not on PATH. Install Ego Lite: https://lite.ego.app/");
    } else {
      console.error(error.message || error);
    }
    process.exit(1);
  });
  child.stdin.write(prelude);
  child.stdin.write(source);
  child.stdin.end();

  const childCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  const summary = readSummary(`${stdoutBuf}\n${stderrBuf}`);
  const egoExit = `${stdoutBuf}\n${stderrBuf}`.match(/nodejs process exited with code (\d+)/);
  const reported = egoExit ? Number(egoExit[1]) : null;
  // ego-browser 0.6.x prints script console.log on stderr. Mirror the summary to stdout.
  if (summary && !readSummary(stdoutBuf)) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
  if (summary?.ok) process.exit(0);
  if (summary?.login_required) process.exit(2);
  if (summary) process.exit(1);
  if (reported !== null) process.exit(reported);
  process.exit(childCode === 0 || childCode === null ? 1 : childCode);
}

function strip(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") delete obj[key];
  }
  return obj;
}

function pickImage(images, ...keys) {
  for (const key of keys) if (images?.[key]?.url) return images[key];
  return undefined;
}

function isVideoPin(pin) {
  if (pin?.videos?.video_list) return true;
  const pages = pin?.story_pin_data?.pages || [];
  return pages.some((page) => (page?.blocks || []).some((block) => block?.video));
}

function normalizePin(pin) {
  if (!pin || pin.type !== "pin" || pin.is_promoted) return null;
  const image = pickImage(pin.images, "orig", "736x", "564x", "474x", "236x");
  if (!image?.url) return null;
  const numeric = /^\d+$/.test(String(pin.id));
  return strip({
    id: numeric ? String(pin.id) : undefined,
    pin_url: numeric ? `${BASE}/pin/${pin.id}/` : undefined,
    title: String(pin.title || pin.grid_title || "").trim().slice(0, 140) || undefined,
    image_url: image.url,
    width: image.width,
    height: image.height,
    low_res: Number(image.width) > 0 && image.width < 500 ? true : undefined,
    dominant_color: pin.dominant_color || undefined,
    is_video: isVideoPin(pin) || undefined,
  });
}

function resizeUrl(url, size) {
  const swapped = url.replace(/(pinimg\.com\/)(originals|\d+x\d*(?:_RS)?)\//, `$1${size}/`);
  return size === "originals" ? swapped : swapped.replace(/\.(png|gif|webp)$/i, ".jpg");
}

function toOriginals(url) {
  if (!url || typeof url !== "string") return null;
  if (!/pinimg\.com/i.test(url)) return url;
  return url.replace(/\/\d+x\d*(?:_RS)?\//, "/originals/");
}

function assertPinimg(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid image URL: ${raw}`);
  }
  if (url.protocol !== "https:" || !/(^|\.)pinimg\.com$/.test(url.hostname)) {
    throw new Error(`Only https://*.pinimg.com URLs are allowed: ${raw}`);
  }
  return url;
}

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function fetchImageBytes(page, rawUrl, preferredSize) {
  assertPinimg(rawUrl);
  const sizes = preferredSize === "originals" ? ["originals", "736x"] : [preferredSize, "736x", "originals"];
  const candidates = [...new Set(sizes.map((size) => resizeUrl(rawUrl, size)).concat(rawUrl))];
  let lastError = "no candidate";
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: {
          "User-Agent": UA,
          Referer: `${BASE}/`,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });
      const headerType = (response.headers.get("content-type") || "").split(";")[0];
      if (response.ok && headerType.startsWith("image/")) {
        const buf = Buffer.from(await response.arrayBuffer());
        const sniffed = sniffImage(buf);
        if (sniffed && buf.length >= 100) return { url: candidate, type: sniffed, buf };
        lastError = `not an image (${buf.length} bytes, ${headerType})`;
        continue;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error.message || error);
    }
    if (!page) continue;
    const partial = path.join("/tmp", `.pinterest-partial-${crypto.randomBytes(6).toString("hex")}`);
    try {
      await page.fetch(candidate, {
        headers: { Referer: `${BASE}/`, Accept: "image/*,*/*;q=0.8" },
        timeout: 20_000,
        saveAs: partial,
      });
      const buf = await fs.readFile(partial);
      const sniffed = sniffImage(buf);
      if (sniffed && buf.length >= 100) return { url: candidate, type: sniffed, buf };
      lastError = `page.fetch saved a non-image (${buf.length} bytes)`;
    } catch (error) {
      lastError = String(error.message || error);
    } finally {
      await fs.rm(partial, { force: true }).catch(() => {});
    }
  }
  throw new Error(`Could not fetch ${rawUrl}: ${lastError}`);
}

async function csrfHeader(page) {
  const token = await page.evaluate(() => {
    const match = (document.cookie || "").match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? match[1] : "";
  });
  return token ? { "X-CSRFToken": token } : {};
}

async function searchViaPageFetch(page, query, limit, media) {
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
  const pins = [];
  const seen = new Set();
  let bookmark;
  const csrf = await csrfHeader(page);
  for (let pageNo = 0; pageNo < MAX_PAGES && pins.length < limit; pageNo++) {
    const options = { query, scope: "pins", rs: "typed", redux_normalize_feed: true };
    if (bookmark) options.bookmarks = [bookmark];
    const qs = new URLSearchParams({
      source_url: sourceUrl,
      data: JSON.stringify({ options, context: {} }),
      _: String(Date.now()),
    });
    const response = await page.fetch(`/resource/BaseSearchResource/get/?${qs}`, {
      method: "GET",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Pinterest-AppState": "active",
        "X-Pinterest-PWS-Handler": "www/search/[scope].js",
        ...csrf,
      },
      timeout: 20_000,
    });
    if (!response.ok) throw new Error(`BaseSearchResource HTTP ${response.status}`);
    const body = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
    const resource = body?.resource_response || {};
    if ((resource.http_status && resource.http_status >= 400) || resource.status === "failure") {
      throw new Error(`BaseSearchResource ${resource.http_status || resource.status || "failed"}`);
    }
    const results = resource.data?.results || [];
    for (const raw of results) {
      if (pins.length >= limit) break;
      if (media === "image" && isVideoPin(raw)) continue;
      const pin = normalizePin(raw);
      if (!pin || seen.has(pin.image_url)) continue;
      seen.add(pin.image_url);
      pins.push(pin);
    }
    const next = resource.bookmark;
    if (!next || next === "-end-" || results.length === 0) break;
    bookmark = next;
  }
  return { pins, method: "BaseSearchResource" };
}

async function searchViaDom(page, limit) {
  const extracted = await page.evaluate((max) => {
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
      for (const part of (img.getAttribute("srcset") || "").split(",")) {
        push(part.trim().split(/\s+/)[0]);
      }
    }
    return urls.slice(0, Math.max(max * 3, 12));
  }, limit);

  const pins = [];
  const seen = new Set();
  for (const url of extracted || []) {
    if (pins.length >= limit) break;
    const imageUrl = toOriginals(url) || url;
    if (seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    pins.push({ image_url: imageUrl, source: "dom" });
  }
  return { pins, method: "dom" };
}

async function detectSession(page) {
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
  const loginUrl = /pinterest\.[^/]+\/(login|signup)\b/i.test(url);
  const loggedIn = !flags.unauth && !loginUrl && (flags.profile || flags.authCookie);
  return { url, title, loginUrl, loggedIn, ...flags };
}

function resolveRuntimeConfig() {
  const raw = globalThis.EGO_PINTEREST_CONFIG || {};
  const query = String(raw.query || raw.keyword || "").trim();
  const limit = clampCount(raw.limit ?? raw.count ?? 10);
  const size = SIZES.has(raw.size) ? raw.size : "originals";
  const media = MEDIAS.has(raw.media) ? raw.media : "image";
  return {
    query,
    limit: limit || 10,
    outDir: raw.outDir ? assertSafeOutDir(raw.outDir) : assertSafeOutDir(defaultOut()),
    size,
    media,
    keepBrowser: Boolean(raw.keepBrowser),
    allowAnonymous: Boolean(raw.allowAnonymous),
    taskName: String(raw.taskName || `pinterest-download-${Date.now()}`),
  };
}

async function runInEgo() {
  const summary = {
    skill: "pinterest-download",
    ok: false,
    login_required: false,
    logged_in: false,
    anonymous: false,
    query: null,
    limit: null,
    outDir: null,
    size: null,
    media: null,
    method: null,
    spaceId: null,
    pins: [],
    downloads: [],
    failures: [],
    error: null,
  };
  let task = null;
  let keepBrowser = false;
  try {
    const config = resolveRuntimeConfig();
    keepBrowser = config.keepBrowser;
    summary.query = config.query;
    summary.limit = config.limit;
    summary.outDir = config.outDir;
    summary.size = config.size;
    summary.media = config.media;
    if (!config.query) {
      summary.error = "query is required. Run via: node skills/pinterest-download/scripts/download.mjs --query wallpaper --count 2 --out /absolute/dir";
      summary.usage = USAGE;
      process.exitCode = 2;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await fs.mkdir(config.outDir, { recursive: true });
    task = await taskSpace(config.taskName);
    summary.spaceId = task.spaceId;
    const page = task.page("p1");
    const searchUrl = `${BASE}/search/pins/?q=${encodeURIComponent(config.query)}&rs=typed`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 8_000 });
    } catch {
      // Pinterest keeps connections open; the DOM is enough.
    }
    await page.waitForTimeout(1200);

    const session = await detectSession(page);
    summary.logged_in = session.loggedIn;
    summary.signals = {
      unauth: session.unauth,
      profile: session.profile,
      auth_cookie: session.authCookie,
      login_url: session.loginUrl,
    };
    summary.page = { url: session.url, title: session.title };

    if (!session.loggedIn && !config.allowAnonymous) {
      summary.login_required = true;
      summary.ok = false;
      summary.error = "Pinterest is not logged in inside this Ego Lite profile. Sign in once, then re-run. No password was entered.";
      summary.how_to_login = HOW_TO_LOGIN;
      summary.how_to_login_zh = HOW_TO_LOGIN_ZH;
      const manifestPath = path.join(config.outDir, "manifest.json");
      await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2));
      summary.manifest = manifestPath;
      process.exitCode = 2;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    summary.anonymous = !session.loggedIn;

    let search;
    try {
      search = await searchViaPageFetch(page, config.query, config.limit, config.media);
    } catch (error) {
      summary.failures.push({ stage: "BaseSearchResource", error: String(error.message || error) });
      search = await searchViaDom(page, config.limit);
    }
    if ((search.pins?.length || 0) < config.limit) {
      try {
        const dom = await searchViaDom(page, config.limit);
        const seen = new Set(search.pins.map((pin) => pin.image_url));
        for (const pin of dom.pins) {
          if (search.pins.length >= config.limit) break;
          if (seen.has(pin.image_url)) continue;
          seen.add(pin.image_url);
          search.pins.push(pin);
        }
        if (search.method !== "dom" && dom.pins.length) search.method = `${search.method}+dom`;
      } catch (error) {
        summary.failures.push({ stage: "dom-topup", error: String(error.message || error) });
      }
    }

    summary.method = search.method;
    summary.pins = search.pins.slice(0, config.limit).map((pin) => ({
      id: pin.id,
      pin_url: pin.pin_url,
      title: pin.title,
      image_url: pin.image_url,
      width: pin.width,
      height: pin.height,
      low_res: pin.low_res,
    }));

    for (let index = 0; index < summary.pins.length; index++) {
      const pin = summary.pins[index];
      const n = String(index + 1).padStart(2, "0");
      try {
        const image = await fetchImageBytes(page, pin.image_url, config.size);
        const base =
          path.basename(new URL(image.url).pathname).replace(/\.\w+$/, "") ||
          crypto.createHash("sha1").update(image.url).digest("hex").slice(0, 16);
        const dest = path.join(config.outDir, `${n}_${base}.${EXT[image.type] || "jpg"}`);
        await fs.writeFile(dest, image.buf);
        summary.downloads.push({
          n,
          path: dest,
          url: image.url,
          bytes: image.buf.length,
          contentType: image.type,
          pin_id: pin.id,
          width: pin.width,
          height: pin.height,
        });
      } catch (error) {
        summary.failures.push({ url: pin.image_url, error: String(error.message || error) });
      }
    }

    summary.count = summary.downloads.length;
    summary.ok = summary.downloads.length > 0;
    if (!summary.ok) summary.error = "No images were saved.";
    const manifestPath = path.join(config.outDir, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2));
    summary.manifest = manifestPath;
    await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2));
    process.exitCode = summary.ok ? 0 : 1;
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    summary.ok = false;
    summary.error = String(error.message || error);
    if (summary.outDir) {
      try {
        await fs.mkdir(summary.outDir, { recursive: true });
        const manifestPath = path.join(summary.outDir, "manifest.json");
        await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2));
        summary.manifest = manifestPath;
      } catch {
        // The JSON on stdout is the source of truth when the directory is not writable.
      }
    }
    process.exitCode = 1;
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (task) {
      try {
        await task.finish({ keep: keepBrowser ? ["p1"] : [] });
      } catch (error) {
        console.error(`[pinterest-download] finish: ${error.message || error}`);
      }
    }
  }
}

const inEgo = typeof taskSpace === "function";
if (!inEgo) {
  await runCli();
} else {
  await runInEgo();
}
