// Pure helpers for wechat-channels-video. No browser, no process.exit.

export const BASE = "https://channels.weixin.qq.com";
export const LOGIN_HINT = "login.html";
export const DEFAULT_SERVE_PORT = 18765;

export const HOW_TO_LOGIN = [
  "Open the Ego Lite app (the same profile ego-browser drives).",
  "Visit https://channels.weixin.qq.com — if you land on login.html, scan the QR with WeChat.",
  "Ignore any “加载失败，点击重试” near WeChat quick-login; that probe fails when the desktop WeChat client is offline. The QR lives in a cross-origin iframe.",
  "Confirm the correct Channels account, leave Ego logged in, then re-run this skill’s login-check (and only then publish).",
  "Ego Lite upgrades that bump Chromium can wipe the session — always login-check before each publish.",
];

export const HOW_TO_LOGIN_ZH = [
  "打开 Ego Lite（ego-browser 驱动的同一个配置档）。",
  "访问 https://channels.weixin.qq.com；若跳到 login.html，用微信扫二维码登录。",
  "忽略「加载失败，点击重试」：那是探本地微信客户端失败，二维码在跨域 iframe 里，点重试没用。",
  "确认是正确的视频号账号，保持 Ego 登录，再重新跑 login-check；通过后才继续发布。",
  "升级 Ego Lite（尤其 Chromium 大版本）可能清掉登录态——每次发布前都要先检查。",
];

export const LOGIN_TIP =
  "Tell the user: WeChat Channels sessions in Ego expire quickly. Before every publish, run login-check. If exit 2, ask them to open Ego Lite, scan the QR on channels.weixin.qq.com, then re-run. Never type a password or paste cookies.";

export const LOGIN_TIP_ZH =
  "请告诉用户：视频号助手在 Ego 里的登录态过期很快。每次发布前先跑 login-check。若 exit 2，请人在 Ego Lite 打开 channels.weixin.qq.com 扫码登录后再跑。不要代填密码，不要粘贴 Cookie。";

export const USAGE = `wechat-channels-video — WeChat Channels helpers via Ego Lite

Install Ego Lite and put ego-browser on PATH first. Missing ego-browser soft-fails (exit 2) with install hints.

  node scripts/check-login.mjs
  node scripts/check-login.mjs --keep
  node scripts/serve-file.mjs --file /path/to/video.mp4 --port 18765

check-login:
  Opens channels.weixin.qq.com in ego-browser, reports logged_in JSON.
  Exit 0 when logged in. Exit 2 when login required or ego-browser missing.
  Always print login_tip; on soft-fail also print how_to_login.

serve-file:
  Serves one local file over http://127.0.0.1:<port>/ with CORS * for page.evaluate fetch + DataTransfer inject.
  Prints JSON { ok, url, file, bytes, port } then stays until SIGINT.

The publish/draft UI flow (wujie form, cover chooser, location) stays in SKILL.md for the agent — too brittle for a full script.
Before 保存草稿, run descriptionReadbackOk, uploadProbeDecision, and coverPreviewDecision. Unresolved, timeout, or mismatch returns save:false. Never click 发表. refClick stays false.
`;

export function strip(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") delete obj[key];
  }
  return obj;
}

export function parseCheckArgs(argv) {
  const out = { keep: false, help: false, taskName: "wechat-channels-login-check" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--task-name") out.taskName = String(argv[++i] || out.taskName);
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

export function parseServeArgs(argv) {
  const out = { file: null, port: DEFAULT_SERVE_PORT, help: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--file" || a === "-f") out.file = argv[++i];
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a === "--name") out.name = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.help) {
    if (!out.file) throw new Error("--file is required");
    if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
      throw new Error("--port must be an integer 1-65535");
    }
  }
  return out;
}

/** Classify Channels login from URL + optional page text/signals. */
export function classifyLogin({ url = "", title = "", text = "", signals = {} } = {}) {
  const u = String(url || "");
  const blob = `${u}\n${title}\n${text}`;
  const onLoginPage = /login\.html/i.test(u) || /\/login(\?|$)/i.test(u);
  const hasQrHint = /扫码|二维码|微信扫一扫|登录/.test(blob) && onLoginPage;
  const platformHint =
    /\/platform\//i.test(u) ||
    /内容管理|发表视频|草稿|视频号助手/.test(blob) ||
    Boolean(signals.platformChrome);
  const loggedIn = !onLoginPage && (platformHint || Boolean(signals.loggedInCookie));
  return strip({
    logged_in: loggedIn,
    login_required: !loggedIn,
    on_login_page: onLoginPage,
    has_qr_hint: hasQrHint || undefined,
    url: u || undefined,
    title: title || undefined,
  });
}

export function contentTypeFor(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export function publicUrl(port, leaf) {
  const name = encodeURIComponent(leaf || "file");
  return `http://127.0.0.1:${port}/${name}`;
}

export const CHANNELS_UPLOAD_WAIT_LIMIT = 8;
export const CHANNELS_COVER_WAIT_LIMIT = 12;
export const CHANNELS_WUJIE_NULL_WAIT_LIMIT = 8;

const CHANNELS_UPLOAD_FAILURE_RE = /上传失败|上传出错|上传异常/;

function boundedStop(attempt, limit, pendingReason) {
  if (attempt >= limit) {
    return {
      ok: false,
      action: "stop",
      reason: pendingReason === "pending" ? "timeout" : pendingReason,
      save: false,
      publish: false,
    };
  }
  return { ok: false, action: "retry", reason: pendingReason, save: false, publish: false };
}

export function normalizeDescription(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

export function expectedDescription(desc, tags) {
  const body = normalizeDescription(desc);
  const topic = normalizeDescription(tags);
  if (!topic) return body;
  if (!body) return topic;
  return `${body}\n${topic}`;
}

export function descriptionReadbackOk(read, expected) {
  const expectedText = typeof expected === "string"
    ? expected
    : expectedDescription(expected && expected.desc, expected && expected.tags);
  if (!normalizeDescription(expectedText)) {
    return { ok: false, save: false, publish: false, reason: "missing-expected" };
  }
  if (read == null || read.ok === false) {
    return { ok: false, save: false, publish: false, reason: "unresolved" };
  }
  const actual = typeof read === "string" ? read : (read.value != null ? read.value : read.text);
  if (actual == null) return { ok: false, save: false, publish: false, reason: "unresolved" };
  const left = normalizeDescription(actual);
  const right = normalizeDescription(expectedText);
  if (!left) return { ok: false, save: false, publish: false, reason: "empty-readback" };
  if (left !== right) {
    return { ok: false, save: false, publish: false, reason: "mismatch", actual: left, expected: right };
  }
  return { ok: true, save: true, publish: false, reason: "match" };
}

export function wujieProbeDecision(probe, { attempt = 1, limit = CHANNELS_WUJIE_NULL_WAIT_LIMIT } = {}) {
  if (probe && probe.wujie === true) {
    return { ok: true, action: "proceed", reason: "ready", save: false, publish: false };
  }
  return boundedStop(Number(attempt) || 1, Number(limit) > 0 ? Number(limit) : CHANNELS_WUJIE_NULL_WAIT_LIMIT, "unresolved");
}

export function uploadProbeDecision(probe, { attempt = 1, limit = CHANNELS_UPLOAD_WAIT_LIMIT } = {}) {
  const n = Number(attempt) || 1;
  const cap = Number(limit) > 0 ? Number(limit) : CHANNELS_UPLOAD_WAIT_LIMIT;
  if (!probe || typeof probe !== "object" || probe.wujie === false || probe.readable === false) {
    return boundedStop(n, cap, "unresolved");
  }
  const text = String(probe.text || "");
  if (probe.failed || CHANNELS_UPLOAD_FAILURE_RE.test(text)) {
    return { ok: false, action: "stop", reason: "failed", save: false, publish: false };
  }
  const atHundred = probe.progress === 100 || probe.progress === "100%" || /(^|[^\d])100%/.test(text);
  const preview = probe.hasPreview === true || (/转发/.test(text) && /赞/.test(text) && /评论/.test(text));
  if (atHundred && preview && Number(probe.stableCount) >= 2) {
    return { ok: true, action: "proceed", reason: "ready", save: true, publish: false };
  }
  return boundedStop(n, cap, "pending");
}

export function coverPreviewDecision(probe, { attempt = 1, limit = CHANNELS_COVER_WAIT_LIMIT } = {}) {
  if (probe && probe.requested === false) {
    return { ok: true, action: "skip", reason: "no-cover", save: true, publish: false };
  }
  const n = Number(attempt) || 1;
  const cap = Number(limit) > 0 ? Number(limit) : CHANNELS_COVER_WAIT_LIMIT;
  if (!probe || typeof probe !== "object" || probe.readable === false) {
    return boundedStop(n, cap, "unresolved");
  }
  if (probe.revertedToDefault === true) {
    return { ok: false, action: "stop", reason: "reverted", save: false, publish: false };
  }
  const spinning = probe.spinning === true || /转圈|上传中/.test(String(probe.text || ""));
  if (!spinning && probe.previewChanged === true) {
    return { ok: true, action: "proceed", reason: "confirmed", save: true, publish: false };
  }
  return boundedStop(n, cap, spinning ? "spinning" : "unresolved");
}

export function maySaveCheckpoint(upload) {
  if (!upload || upload.ok !== true || upload.action !== "proceed") {
    return { ok: false, save: false, publish: false, reason: "upload", detail: (upload && upload.reason) || "missing" };
  }
  return { ok: true, save: true, publish: false, reason: "upload-ready" };
}

export function maySaveDraft({ description, upload, cover } = {}) {
  if (!description || description.ok !== true) {
    return { ok: false, save: false, publish: false, reason: "description", detail: (description && description.reason) || "missing" };
  }
  if (!upload || upload.ok !== true || upload.action !== "proceed") {
    return { ok: false, save: false, publish: false, reason: "upload", detail: (upload && upload.reason) || "missing" };
  }
  if (!cover || (cover.action !== "skip" && (cover.ok !== true || cover.action !== "proceed"))) {
    return { ok: false, save: false, publish: false, reason: "cover", detail: (cover && cover.reason) || "missing" };
  }
  return { ok: true, save: true, publish: false, reason: "ready" };
}

export function channelsClickMethod() {
  return {
    refClick: false,
    publish: false,
    reason: "wujie intercepts ref and text clicks. Do not use an accessibility snapshot ref fallback. Use evaluate .click() inside the shadow root, or mouse.click coordinates.",
  };
}

export function egoMissingSummary() {
  return strip({
    skill: "wechat-channels-video",
    command: "check-login",
    ok: false,
    logged_in: false,
    login_required: true,
    exitCode: 2,
    error: "ego-browser not found on PATH",
    login_tip: LOGIN_TIP,
    login_tip_zh: LOGIN_TIP_ZH,
    how_to_login: [
      "Install Ego Lite, then ensure `ego-browser` is on PATH (often ~/.local/bin).",
      ...HOW_TO_LOGIN,
    ],
    how_to_login_zh: [
      "先安装 Ego Lite，并把 ego-browser 放进 PATH（常见 ~/.local/bin）。",
      ...HOW_TO_LOGIN_ZH,
    ],
  });
}
