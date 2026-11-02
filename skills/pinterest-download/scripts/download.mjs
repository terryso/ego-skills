// pinterest-download — ego-browser nodejs < skills/pinterest-download/scripts/download.mjs
// ego-browser does NOT inherit shell env or cwd: keep all inputs as absolute paths / inlined CONFIG.
// Parity target: @sunkimkk/pinterest-mcp search + download (query, limit, prefer originals).

const CONFIG = {
  query: "舒淇",
  limit: 3,
  outDir: "/tmp/ego-pinterest-smoke",
  // "originals" | "736x" | "474x" — prefer originals, fall back to 736x on fetch miss
  size: "originals",
  media: "image", // "image" | "any" (video URLs skipped when "image")
  taskName: "pinterest-download",
  // set true to keep the Ego Lite window open after finish
  keepBrowser: false,
};

const BASE = "https://www.pinterest.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");

function strip(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") delete obj[k];
  }
  return obj;
}

function pickImage(images, ...keys) {
  for (const k of keys) if (images?.[k]?.url) return images[k];
  return undefined;
}

function normalizePin(p) {
  if (!p || p.type !== "pin" || p.is_promoted) return null;
  const orig = pickImage(p.images, "orig", "736x", "564x", "474x", "236x");
  if (!orig) return null;
  const numeric = /^\d+$/.test(String(p.id));
  return strip({
    id: numeric ? String(p.id) : undefined,
    pin_url: numeric ? `${BASE}/pin/${p.id}/` : undefined,
    title: (p.title || p.grid_title || "").toString().trim().slice(0, 140) || undefined,
    image_url: orig.url,
    width: orig.width,
    height: orig.height,
    low_res: Number(orig.width) > 0 && orig.width < 500 ? true : undefined,
    dominant_color: p.dominant_color || undefined,
    video_url: p.videos?.video_list?.V_720P?.url || undefined,
  });
}

function resizeUrl(u, size) {
  const swapped = u.replace(/(pinimg\.com\/)(originals|\d+x\d*(?:_RS)?)\//, `$1${size}/`);
  return size === "originals" ? swapped : swapped.replace(/\.(png|gif|webp)$/i, ".jpg");
}

function toOriginals(url) {
  if (!url || typeof url !== "string") return null;
  if (!/pinimg\.com/i.test(url)) return url;
  return url.replace(/\/\d+x\d*(?:_RS)?\//, "/originals/");
}

function assertPinimg(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    throw new Error(`Invalid image URL: ${u}`);
  }
  if (url.protocol !== "https:" || !/(^|\.)pinimg\.com$/.test(url.hostname)) {
    throw new Error(`Only https://*.pinimg.com URLs allowed: ${u}`);
  }
  return url;
}

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function fetchImageBytes(u, preferredSize) {
  assertPinimg(u);
  const sizes =
    preferredSize === "originals"
      ? ["originals", "736x"]
      : [preferredSize, "736x", "originals"];
  const candidates = [...new Set(sizes.map((s) => resizeUrl(u, s)).concat(u))];
  let lastErr;
  for (const c of candidates) {
    try {
      const res = await fetch(c, {
        headers: {
          "User-Agent": UA,
          Referer: `${BASE}/`,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });
      const type = (res.headers.get("content-type") || "").split(";")[0];
      if (res.ok && type.startsWith("image/")) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) {
          lastErr = `too small ${buf.length}`;
          continue;
        }
        return { url: c, type, buf };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String(e.message || e);
    }
  }
  throw new Error(`Could not fetch ${u}: ${lastErr}`);
}

async function searchViaPageFetch(page, query, limit) {
  // Same BaseSearchResource shape sunkim uses; runs inside the logged-in Page so cookies apply.
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
  const options = {
    query,
    scope: "pins",
    rs: "typed",
    redux_normalize_feed: true,
  };
  const qs = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify({ options, context: {} }),
    _: String(Date.now()),
  });
  const apiPath = `/resource/BaseSearchResource/get/?${qs}`;
  const response = await page.fetch(apiPath, {
    method: "GET",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "X-Pinterest-AppState": "active",
      "X-Pinterest-PWS-Handler": "www/search/[scope].js",
    },
    timeout: 20_000,
  });
  if (!response.ok) {
    throw new Error(`BaseSearchResource HTTP ${response.status}`);
  }
  const body = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
  const results = body?.resource_response?.data?.results || [];
  const bookmark = body?.resource_response?.bookmark;
  const pins = [];
  const seen = new Set();
  for (const raw of results) {
    if (pins.length >= limit) break;
    const pin = normalizePin(raw);
    if (!pin || seen.has(pin.image_url)) continue;
    if (CONFIG.media === "image" && pin.video_url) continue;
    seen.add(pin.image_url);
    pins.push(pin);
  }
  return { pins, next_bookmark: bookmark && bookmark !== "-end-" ? bookmark : undefined, method: "BaseSearchResource" };
}

async function searchViaDom(page, limit) {
  // Fallback: scrape visible pinimg URLs and upgrade size segment to originals.
  const extracted = await page.evaluate((max) => {
    const urls = [];
    const seen = new Set();
    const push = (u) => {
      if (!u || typeof u !== "string") return;
      if (!/pinimg\.com/i.test(u)) return;
      const clean = u.split("?")[0];
      if (seen.has(clean)) return;
      seen.add(clean);
      urls.push(clean);
    };
    for (const img of document.querySelectorAll("img")) {
      push(img.currentSrc || img.src);
      const ss = img.getAttribute("srcset") || "";
      for (const part of ss.split(",")) {
        const u = part.trim().split(/\s+/)[0];
        push(u);
      }
    }
    // Pinterest often hydrates JSON in script tags
    for (const s of document.querySelectorAll("script")) {
      const t = s.textContent || "";
      if (!t.includes("pinimg.com")) continue;
      const re = /https:\/\/i\.pinimg\.com\/[^"'\s]+/g;
      let m;
      while ((m = re.exec(t))) push(m[0].replace(/\\u002F/g, "/"));
    }
    return urls.slice(0, Math.max(max * 3, 30));
  }, limit);

  const pins = [];
  const seen = new Set();
  for (const u of extracted || []) {
    if (pins.length >= limit) break;
    const image_url = toOriginals(u) || u;
    if (seen.has(image_url)) continue;
    seen.add(image_url);
    pins.push({ image_url, source: "dom" });
  }
  return { pins, method: "dom" };
}

async function detectLoginWall(page) {
  const url = await page.url();
  const title = await page.title();
  const flags = await page.evaluate(() => {
    const text = (document.body?.innerText || "").slice(0, 4000).toLowerCase();
    return {
      hasPassword: Boolean(document.querySelector('input[type="password"]')),
      loginish:
        /log\s*in|sign\s*in|创建 an account|继续浏览|登录/.test(text) &&
        !document.querySelector('[data-test-id="pin"], [data-test-id="pinWrapper"], a[href*="/pin/"]'),
    };
  });
  return {
    url,
    title,
    blocked: flags.hasPassword || flags.loginish || /\/login|\/signup/i.test(url),
  };
}

const summary = {
  skill: "pinterest-download",
  query: CONFIG.query,
  limit: CONFIG.limit,
  outDir: CONFIG.outDir,
  size: CONFIG.size,
  ok: false,
  method: null,
  login_wall: false,
  pins: [],
  downloads: [],
  failures: [],
  spaceId: null,
  error: null,
};

try {
  if (!CONFIG.query || typeof CONFIG.query !== "string") {
    throw new Error("CONFIG.query is required");
  }
  const limit = Math.max(1, Math.min(100, Number(CONFIG.limit) || 10));
  const outDir = path.resolve(CONFIG.outDir);
  await fs.mkdir(outDir, { recursive: true });

  const task = await taskSpace(CONFIG.taskName);
  summary.spaceId = task.spaceId;
  const page = task.page("p1");

  const searchUrl = `${BASE}/search/pins/?q=${encodeURIComponent(CONFIG.query)}&rs=typed`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    // Pinterest keeps long-polls; continue after soft timeout.
  }
  await page.waitForTimeout(1500);

  const wall = await detectLoginWall(page);
  if (wall.blocked) {
    summary.login_wall = true;
    summary.error =
      "Login / signup wall detected. Sign in via Ego Lite GUI for this profile, then re-run the same task space.";
    console.log(JSON.stringify(summary, null, 2));
    await task.handOff();
    throw new Error(summary.error);
  }

  let search;
  try {
    search = await searchViaPageFetch(page, CONFIG.query, limit);
  } catch (e) {
    summary.failures.push({ stage: "BaseSearchResource", error: String(e.message || e) });
    search = await searchViaDom(page, limit);
  }

  // If resource returned too few, top up from DOM
  if ((search.pins?.length || 0) < limit) {
    try {
      const dom = await searchViaDom(page, limit);
      const seen = new Set(search.pins.map((p) => p.image_url));
      for (const p of dom.pins) {
        if (search.pins.length >= limit) break;
        if (seen.has(p.image_url)) continue;
        seen.add(p.image_url);
        search.pins.push(p);
      }
      if (search.method !== "dom" && dom.pins.length) search.method = `${search.method}+dom`;
    } catch (e) {
      summary.failures.push({ stage: "dom-topup", error: String(e.message || e) });
    }
  }

  summary.method = search.method;
  summary.pins = search.pins.slice(0, limit).map((p) => ({
    id: p.id,
    pin_url: p.pin_url,
    title: p.title,
    image_url: p.image_url,
    width: p.width,
    height: p.height,
    low_res: p.low_res,
  }));

  let idx = 0;
  for (const pin of summary.pins) {
    const n = String(idx + 1).padStart(2, "0");
    try {
      const img = await fetchImageBytes(pin.image_url, CONFIG.size);
      const hash =
        path.basename(new URL(img.url).pathname).replace(/\.\w+$/, "") ||
        crypto.createHash("sha1").update(img.url).digest("hex").slice(0, 16);
      const ext = EXT[img.type] || "jpg";
      const dest = path.join(outDir, `${n}_${hash}.${ext}`);
      await fs.writeFile(dest, img.buf);
      const row = {
        n,
        path: dest,
        url: img.url,
        bytes: img.buf.length,
        contentType: img.type,
        pin_id: pin.id,
        meta_width: pin.width,
        meta_height: pin.height,
      };
      summary.downloads.push(row);
      idx++;
    } catch (e) {
      summary.failures.push({ url: pin.image_url, error: String(e.message || e) });
    }
  }

  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2));
  summary.manifest = manifestPath;
  summary.ok = summary.downloads.length > 0;
  summary.count = summary.downloads.length;

  console.log(JSON.stringify(summary, null, 2));

  if (CONFIG.keepBrowser) {
    await task.finish({ keep: true });
  } else {
    await task.finish({ keep: false });
  }
} catch (e) {
  summary.error = String((e && e.stack) || e);
  console.log(JSON.stringify(summary, null, 2));
  // non-zero so agents notice
  throw e;
}
