// Pure logic for bilibili-video. No ego imports, fully unit-testable.
import { inflateSync } from "node:zlib";

export const BASE = "https://member.bilibili.com";
export const FRAME_URL = `${BASE}/platform/upload/video/frame`;
export const PUBLISH_CONFIG_PATH = "/tmp/bilibili-video-publish.json";

export const TITLE_MAX = 80;
export const DESC_MAX = 2000;
export const TAGS_MAX = 10;
export const VIDEO_MAX_BYTES = 16 * 1024 * 1024 * 1024;
export const VIDEO_EXTS = [".mp4", ".flv", ".avi", ".wmv", ".mov", ".webm", ".mpeg4", ".ts", ".mpg", ".rm", ".rmvb", ".mkv", ".m4v", ".vob", ".swf", ".3gp", ".mts", ".m2v", ".m2ts", ".f4v", ".m2t", ".3g2", ".asf"];
export const COVER_EXTS = [".png", ".jpg", ".jpeg"];
export const RATIO_TOLERANCE = 0.08;

export const RATIO_4_3 = 4 / 3;
export const RATIO_16_9 = 16 / 9;

// 创作声明下拉的选项文本(2026-11 实测)。必填:为空时点「立即投稿」会被表单校验拦下。
export const DECLARE_OPTIONS = {
  none: "内容无需标注",
  ai: "含AI生成内容",
  fiction: "含虚构演绎内容",
  marketing: "内容含营销信息",
  opinion: "个人观点，仅供参考",
  repost: "内容为转载",
  original: "内容为自制：未经作者允许，禁止转载",
};

export const LOGIN_WALL_RE = /扫码登录|二维码登录|扫描二维码|请登录|登录后|登录哔哩哔哩/;
export const CREATOR_CHROME_RE = /创作中心|投稿管理|内容管理|上传视频/;
export const UPLOAD_DONE_RE = /上传完成|更换视频/;
export const UPLOAD_FAIL_RE = /上传失败|解析失败/;
export const PUBLISH_OK_RE = /投递成功|投稿成功|提交成功|审核中/;

const FLAG_SPECS = {
  "--video": "value",
  "--title": "value",
  "--desc": "value",
  "--cover-4x3": "value",
  "--cover-16x9": "value",
  "--tags": "value",
  "--type": "value",
  "--declare": "value",
  "--yes": "flag",
  "--stop-before-submit": "flag",
  "--keep": "flag",
  "--space-id": "value",
};

export function parsePublishArgs(argv) {
  const out = { desc: "", tags: "", yes: false, stopBeforeSubmit: false, keep: false, cover43: "", cover169: "", type: "", declare: "none", spaceId: 0 };
  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    let inline = null;
    const eq = token.indexOf("=");
    if (token.startsWith("--") && eq > 0) {
      inline = token.slice(eq + 1);
      token = token.slice(0, eq);
    }
    const spec = FLAG_SPECS[token];
    if (!spec) return { error: `未知参数: ${token}` };
    if (spec === "flag") {
      out[flagKey(token)] = true;
      continue;
    }
    let value = inline;
    if (value === null) {
      i += 1;
      if (i >= argv.length) return { error: `${token} 缺少值` };
      value = argv[i];
    }
    out[flagKey(token)] = value;
  }
  if (out.spaceId) {
    const n = Number(out.spaceId);
    if (!Number.isInteger(n) || n <= 0) return { error: "--space-id 必须是正整数" };
    out.spaceId = n;
  }
  if (!(out.declare in DECLARE_OPTIONS)) {
    return { error: `--declare 只支持 ${Object.keys(DECLARE_OPTIONS).join("/")}之一` };
  }
  return { ok: true, args: out };
}

function flagKey(token) {
  if (token === "--cover-4x3") return "cover43";
  if (token === "--cover-16x9") return "cover169";
  return token
    .slice(2)
    .replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function validatePublishInput(input) {
  const { video, title, desc, cover43, cover169, tags, videoExists, videoSize } = input;
  if (!video) return { error: "缺少 --video(本地视频绝对路径)" };
  if (!videoExists) return { error: `视频不存在: ${video}` };
  if (!videoSize || videoSize <= 0) return { error: `视频是空文件: ${video}` };
  if (videoSize > VIDEO_MAX_BYTES) return { error: "视频超过 B 站 16G 上限" };
  const ext = extOf(video);
  if (!VIDEO_EXTS.includes(ext)) return { error: `视频格式不支持(${ext});B 站推荐 MP4/MOV/MKV` };

  if (!title || !String(title).trim()) return { error: "缺少 --title(B 站标题必填)" };
  if (String(title).length > TITLE_MAX) return { error: `标题超长:${String(title).length}/${TITLE_MAX}` };
  if (String(desc || "").length > DESC_MAX) return { error: `简介超长:${String(desc).length}/${DESC_MAX}` };

  const tagList = parseTags(tags);
  if (tagList.length > TAGS_MAX) return { error: `标签最多 ${TAGS_MAX} 个,收到 ${tagList.length}` };
  for (const t of tagList) {
    if (t.length > 20) return { error: `标签过长(>20 字): ${t}` };
  }

  for (const [key, label, ratio] of [["cover43", "--cover-4x3", RATIO_4_3], ["cover169", "--cover-16x9", RATIO_16_9]]) {
    const path = input[key];
    if (!path) continue;
    if (!COVER_EXTS.includes(extOf(path))) return { error: `${label} 只支持 png/jpg: ${path}` };
    const dims = input[`${key}Dims`];
    if (dims && !ratioWithin(dims.width, dims.height, ratio)) {
      return { error: `${label} 图片 ${dims.width}x${dims.height} 不是目标比例(容差 ±8%)` };
    }
  }
  if (!cover43 !== !cover169) {
    return { error: "B 站要求 4:3 和 16:9 两张封面分开上传:要么都传,要么都不传" };
  }
  return { ok: true, tagList, sizeMB: Math.round((videoSize / (1024 * 1024)) * 10) / 10 };
}

function extOf(p) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(p || "");
  return m ? `.${m[1].toLowerCase()}` : "";
}

export function parseTags(raw) {
  return String(raw || "")
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Parse image dimensions from a PNG or JPEG buffer.
export function imageDimsFromBuffer(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 <= buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { off += 2; continue; }
      const len = buf.readUInt16BE(off + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7), format: "jpeg" };
      }
      off += 2 + len;
    }
    return null;
  }
  return null;
}

export function ratioWithin(w, h, target) {
  if (!w || !h || !target) return false;
  const actual = w / h;
  return Math.abs(actual - target) / target <= RATIO_TOLERANCE;
}

// Classify login from a page probe on the frame URL.
export function classifyLogin({ url, text }) {
  const blob = `${url || ""}\n${text || ""}`;
  const onLoginWall = /passport\.bilibili\.com\/login|\/login/i.test(url || "") || LOGIN_WALL_RE.test(blob);
  const creatorChrome = CREATOR_CHROME_RE.test(text || "");
  const loggedIn = creatorChrome && !onLoginWall;
  return { logged_in: loggedIn, on_login_wall: onLoginWall, creator_chrome: creatorChrome };
}

export function egoMissingSummary(command) {
  const how = "安装 Ego Lite 并把 ego-browser 加入 PATH(非交互 shell 可再试 ~/.local/bin/ego-browser),或在 Ego 浏览器里登录 bilibili.com 后重试。";
  return {
    ok: false,
    login_required: true,
    exit_code: 2,
    error: `ego-browser 不在 PATH,无法${command === "check" ? "检查登录" : "发布"}。`,
    how_to_login: how,
    how_to_login_zh: how,
  };
}

export function loginRequiredBody({ spaceId, url } = {}) {
  const how = "在 Ego Lite 浏览器里打开 bilibili.com 或 member.bilibili.com,扫码登录后重跑 check-login。";
  return {
    ok: false,
    login_required: true,
    exit_code: 2,
    spaceId: spaceId ?? null,
    url: url ?? null,
    login_tip: "Ego 会话里没有可用的 B 站登录态。",
    how_to_login: how,
    how_to_login_zh: how,
  };
}

export function flowErrorBody(msg, extra = {}) {
  return { ok: false, error: msg, ...extra };
}

export function planBody({ video, sizeMB, title, desc, tags, cover43, cover169, spaceId, declare, type }) {
  return {
    ok: true,
    plan_only: true,
    exit_code: 3,
    spaceId: spaceId ?? null,
    video,
    sizeMB,
    title,
    desc,
    tags: parseTags(tags),
    declare: declare ?? "none",
    cover_mode: cover43 && cover169 ? "two-ratio" : "none",
    covers: {
      "4x3": cover43 || null,
      "16x9": cover169 || null,
    },
    type: type || null,
    note: "未传 --yes:只做本地校验并打印计划,不打开浏览器、不查登录、不上传、不投稿。补 --yes 才会真实投稿(过审后公开)。B 站没有『仅自己可见』选项。指定分区用 --type,选不中就停,不会沿用旧分区。AI 生成内容请加 --declare ai。",
  };
}

export function publishSuccessBody({ title, type, declare, tags, coverApplied, url, bvid, identity } = {}) {
  const id = bvid || null;
  const page = url || (id ? `https://www.bilibili.com/video/${id}/` : null);
  return {
    ok: true,
    status: "审核中",
    title: title ?? null,
    type: type ?? null,
    declare: declare ?? null,
    tags: tags ?? [],
    covers: coverApplied ?? { "4x3": null, "16x9": null },
    bvid: id,
    url: page,
    identity: identity || (page ? "bvid" : "unconfirmed"),
  };
}

// The upload form remembers the last partition. A requested name is either
// already selected, present in the opened human-type list, or a hard stop.
// An unsupported name must not fall through to the remembered value.
export function partitionChoice({ requested, current, options } = {}) {
  const want = String(requested || "").trim();
  const now = String(current || "").trim();
  const names = (Array.isArray(options) ? options : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!want) {
    if (!now) return { action: "fail", reason: "empty", type: "" };
    return { action: "keep", reason: "remembered", type: now };
  }
  if (want === now) return { action: "keep", reason: "match", type: now };
  if (!names.includes(want)) return { action: "fail", reason: "unsupported", type: now };
  return { action: "select", reason: "listed", type: want };
}

export function coverSlotEvidence({ slot, width, height, target } = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!slot || !w || !h || !ratioWithin(w, h, target)) return null;
  return { slot, width: w, height: h };
}

export const COVER_MATCH_MIN = 0.82;
export const COVER_GRID = 8;

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  if (du <= dul) return up;
  return upLeft;
}

export function lumaGridFromRgba(rgba, width, height, gridSize = COVER_GRID) {
  const cells = gridSize * gridSize;
  const sum = new Array(cells).fill(0);
  const count = new Array(cells).fill(0);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(gridSize - 1, Math.floor((y * gridSize) / height));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(gridSize - 1, Math.floor((x * gridSize) / width));
      const pixel = (y * width + x) * 4;
      const luma = 0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2];
      const cell = gy * gridSize + gx;
      sum[cell] += luma;
      count[cell] += 1;
    }
  }
  return sum.map((value, index) => Math.round(value / count[index]));
}

export function centerRgba(rgba, width, height, keep = 0.8) {
  const x0 = Math.floor((width * (1 - keep)) / 2);
  const y0 = Math.floor((height * (1 - keep)) / 2);
  const cropWidth = Math.max(1, Math.floor(width * keep));
  const cropHeight = Math.max(1, Math.floor(height * keep));
  const out = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    const from = ((y0 + y) * width + x0) * 4;
    out.set(rgba.subarray(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  return { rgba: out, width: cropWidth, height: cropHeight };
}

// Correlation of two spatial grids. Mean color is removed first, so two
// different pictures with the same average do not match.
export function fingerprintCorrelation(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) return null;
  let meanLeft = 0;
  let meanRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    meanLeft += left[i];
    meanRight += right[i];
  }
  meanLeft /= left.length;
  meanRight /= right.length;
  let dot = 0;
  let energyLeft = 0;
  let energyRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - meanLeft;
    const b = right[i] - meanRight;
    dot += a * b;
    energyLeft += a * a;
    energyRight += b * b;
  }
  if (energyLeft === 0 || energyRight === 0) return Math.abs(meanLeft - meanRight) <= 12 ? 1 : 0;
  return dot / Math.sqrt(energyLeft * energyRight);
}

export function bestFingerprintScore(observed, source) {
  if (!source) return null;
  const scores = [fingerprintCorrelation(observed, source.full)];
  if (source.center) scores.push(fingerprintCorrelation(observed, source.center));
  const finite = scores.filter((score) => Number.isFinite(score));
  if (!finite.length) return null;
  return Math.max(...finite);
}

// Average an 8-bit non-interlaced PNG. Returns null when the file is not one of those.
function decodePngRgba(buf) {
  if (!buf || buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let interlace = 1;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const kind = buf.slice(offset + 4, offset + 8).toString("latin1");
    const start = offset + 8;
    const body = buf.subarray(start, start + length);
    offset = start + length + 4;
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) return null;
    } else if (kind === "IDAT") {
      idat.push(body);
    } else if (kind === "IEND") {
      break;
    }
  }
  if (!width || !height || !idat.length) return null;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;
  const rgba = new Uint8Array(width * height * 4);
  let cursor = 0;
  const previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Uint8Array.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) return null;
    }
    previous.set(row);
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = channels > 1 ? row[source + 1] : row[source];
      rgba[target + 2] = channels > 2 ? row[source + 2] : row[source];
      rgba[target + 3] = channels === 4 ? row[source + 3] : 255;
    }
  }
  return { rgba, width, height };
}

export function pngFingerprint(buf) {
  const decoded = decodePngRgba(buf);
  if (!decoded) return null;
  const center = centerRgba(decoded.rgba, decoded.width, decoded.height);
  return {
    full: lumaGridFromRgba(decoded.rgba, decoded.width, decoded.height),
    center: lumaGridFromRgba(center.rgba, center.width, center.height),
  };
}

function roundScore(score) {
  return Math.round(score * 1000) / 1000;
}

// Several DOM nodes share one slot class. An unloaded node is not an overwrite.
// Identity is the spatial fingerprint, not the average color.
export function judgeCoverIdentity({ samples, target, source, other, slot, requireRatio = false } = {}) {
  const decoded = (Array.isArray(samples) ? samples : []).filter((sample) => (
    sample && Array.isArray(sample.grid) && sample.grid.length === COVER_GRID * COVER_GRID
    && Number(sample.w) >= 20 && Number(sample.h) >= 20
  ));
  if (!decoded.length) return { status: "unread" };
  if (!source || !source.full) return { status: "unconfirmed" };
  const pool = requireRatio ? decoded.filter((sample) => ratioWithin(sample.w, sample.h, target)) : decoded;
  if (requireRatio && !pool.length) {
    return { status: "mismatch", width: decoded[0].w, height: decoded[0].h };
  }
  let best = null;
  for (const sample of pool) {
    const own = bestFingerprintScore(sample.grid, source);
    if (!Number.isFinite(own)) continue;
    const againstOther = other ? bestFingerprintScore(sample.grid, other) : null;
    if (!best || own > best.own) best = { own, againstOther, sample };
  }
  if (!best) return { status: "unconfirmed" };
  if (best.own < COVER_MATCH_MIN) {
    return { status: "identity", score: roundScore(best.own), width: best.sample.w, height: best.sample.h };
  }
  if (Number.isFinite(best.againstOther) && best.own < best.againstOther + 0.08) {
    return {
      status: "identity",
      score: roundScore(best.own),
      other: roundScore(best.againstOther),
      width: best.sample.w,
      height: best.sample.h,
    };
  }
  return {
    status: "ok",
    evidence: {
      slot,
      width: best.sample.w,
      height: best.sample.h,
      match: roundScore(best.own),
    },
  };
}

export function declareChoice({ requested, current, options } = {}) {
  const want = String(requested || "").trim();
  const now = String(current || "").trim();
  const names = (Array.isArray(options) ? options : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!want) return { action: "fail", reason: "missing", type: now };
  if (now === want) return { action: "keep", reason: "already", type: now };
  if (names.includes(want)) return { action: "select", reason: "listed", type: want };
  return { action: "fail", reason: "closed-or-missing", type: now };
}

export function publishMode({ yes, stopBeforeSubmit } = {}) {
  if (stopBeforeSubmit) return "stop-before-submit";
  if (yes === true) return "submit";
  return "plan";
}

export function mayClickSubmit(input = {}) {
  const mode = publishMode(input);
  if (mode !== "submit") return { allow: false, reason: mode };
  return { allow: true, reason: "confirmed" };
}

export function manuscriptFromText(text) {
  const match = String(text || "").match(/BV[0-9A-Za-z]{10}/);
  if (!match) return { bvid: null, url: null, identity: "unconfirmed" };
  const bvid = match[0];
  return { bvid, url: `https://www.bilibili.com/video/${bvid}/`, identity: "bvid" };
}

export function resolveEgoExit({ stdout, stderr, code }) {
  const combined = `${stdout}\n${stderr}`;
  let loginRequired = false;
  for (const line of combined.split(/\n/)) {
    if (line.includes('"login_required"') && line.includes('"exit_code"')) {
      try {
        const parsed = JSON.parse(line.trim().startsWith("{") ? line.trim() : line.trim().slice(line.indexOf("{")));
        if (parsed && parsed.exit_code === 2) loginRequired = true;
      } catch {
        // not JSON; ignore
      }
    }
  }
  if (loginRequired) return 2;
  if (typeof code === "number") return code;
  return 1;
}

export const CHECK_USAGE = `usage: node scripts/check-login.mjs [--keep] [--task-name <name>]
  --keep            把登录页留给用户扫码(handOff),默认检查完关闭
  --task-name <n>   复用已有 space
输出 JSON;退出码 0=已登录, 2=未登录或 ego-browser 缺失, 1=其它错误`;

export function parseCheckArgs(argv) {
  const out = { keep: false, taskName: "", help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--keep") {
      out.keep = true;
      continue;
    }
    if (token === "--task-name") {
      i += 1;
      if (i >= argv.length) throw new Error("--task-name 缺少值");
      out.taskName = argv[i];
      continue;
    }
    throw new Error(`未知参数: ${token}`);
  }
  return out;
}
