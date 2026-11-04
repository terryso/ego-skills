// Pure helpers for xiaohongshu-ego. No browser, no process.exit.
// Publish UI matches the 2026-11-04 creator.xiaohongshu.com capture.

import path from "node:path";

export const SKILL = "xiaohongshu-ego";
export const CREATOR_HOME = "https://creator.xiaohongshu.com/";
export const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=tab_switch&source=official";
export const NOTE_MANAGER_URL = "https://creator.xiaohongshu.com/new/note-manager";
export const EXPLORE_PREFIX = "https://www.xiaohongshu.com/explore/";
export const SPACE_PREFIX = "xiaohongshu-ego";
export const LOGIN_TASK = "xiaohongshu-ego-login";
export const PUBLISH_TASK = "xiaohongshu-ego";
export const EDIT_TASK = "xiaohongshu-ego-edit";
export const RESULT_TAG = "XHSEGO";
export const VIDEO_INPUT_SELECTOR = "input.upload-input";
export const COVER_INPUT_SELECTOR = "input.pk-cover-list-file-input";
export const TITLE_RECOMMENDED_CHARS = 20;

const VIDEO_EXT = new Set([".mp4", ".mov", ".flv", ".f4v", ".mkv", ".rm", ".rmvb", ".m4v", ".mpg", ".mpeg", ".ts"]);
const COVER_EXT = new Set([".jpg", ".jpeg", ".png"]);

const VALUE_FLAGS = new Set([
  "--video", "--title", "--desc", "--topics", "--cover", "--expect-account", "--task-name", "--note-id",
]);

export const HOW_TO_LOGIN = [
  "Install Ego Lite and put ego-browser on PATH (often ~/.local/bin). Open the Ego Lite app.",
  "Visit https://creator.xiaohongshu.com/ and sign in to the creator account that should publish. www.xiaohongshu.com can show a different account than the creator site.",
  "Leave that creator session signed in inside Ego. Do not paste cookies or type a password into the skill.",
  "Re-run check-login. When --expect-account is set, the creator header nickname must match before any upload.",
  "One video note per run. Nothing is uploaded without --yes. If --cover is set, 发布 is clicked only after the PK cover replaces the first frame.",
];

export const HOW_TO_LOGIN_ZH = [
  "先安装 Ego Lite，并把 ego-browser 放进 PATH（常见 ~/.local/bin）。打开 Ego Lite。",
  "访问 https://creator.xiaohongshu.com/ ，登录要发布的创作者账号。www.xiaohongshu.com 上的登录账号可能和创作者平台不是同一个。",
  "保持 Ego 里的创作者平台为登录状态。不要粘贴 Cookie，也不要让技能代填密码。",
  "重新跑 check-login。传了 --expect-account 时，必须是创作者页眉上的昵称一致，才能上传。",
  "每次只发一条视频笔记。没有 --yes 不会上传。传了 --cover 时，必须确认 PK 封面已换掉视频首帧，才会点「发布」。",
];

export const LOGIN_TIP =
  "Tell the user: sign in to creator.xiaohongshu.com inside Ego Lite before posting. Check the creator header nickname, not only www.xiaohongshu.com. If login-check exits 2, ask them to open Ego Lite and sign in, then re-run. Show the plan and wait for confirmation before --yes. Never type a password or paste cookies.";

export const LOGIN_TIP_ZH =
  "请告诉用户：在 Ego Lite 里登录 creator.xiaohongshu.com 之后才能发笔记。要对创作者页眉昵称，不要只看 www.xiaohongshu.com。若 login-check 退出码是 2，请人在 Ego Lite 登录后再跑。先展示计划，等人确认后再加 --yes。不要代填密码，不要粘贴 Cookie。";

export const USAGE = `xiaohongshu-ego — publish one Xiaohongshu video note via Ego Lite (creator web UI)

Install Ego Lite and put ego-browser on PATH first. Missing ego-browser soft-fails (exit 2).
Nothing is uploaded without --yes. With --cover, 发布 is clicked only after the PK cover
replaces the video first frame. If that confirmation fails, the run fails and does not publish.
Without --cover, the platform keeps the first frame. This skill does not invent a cover.

  node scripts/check-login.mjs [--expect-account <nickname>] [--keep]
  node scripts/post-video.mjs --video <abs> --title <text> --desc <text> [--topics "#a #b"] [--cover <abs png/jpg>] [--expect-account <nickname>]
  node scripts/post-video.mjs --video <abs> --title <text> --desc <text> --cover <abs> --yes [--json] [--keep]
  node scripts/edit-cover.mjs --note-id <id> --cover <abs> [--yes] [--json]
  node scripts/cleanup.mjs [--task-name <prefix>]

check-login exits 0 when the creator site is signed in, 2 when login is required, the nickname mismatches, or ego-browser is missing.
post-video without --yes checks login, prints a plan JSON (including the cover path), and exits 3. It does not upload.
post-video --yes prints https://www.xiaohongshu.com/explore/<noteId> after 发布成功.
With --cover, 发布 waits for toast 「已添加 PK 封面」 and the counter advancing (for example 0/3 → 1/3). No crop dialog is clicked.
edit-cover.mjs is best-effort for a note that already published. Prefer --cover on post-video.
Default finish({ keep: [] }). --keep leaves the page.
cleanup closes spaces whose names start with xiaohongshu-ego. It does not delete notes.
`;

export function strip(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") delete obj[key];
  }
  return obj;
}

export function charCount(text) {
  return Array.from(String(text || "")).length;
}

export function composeBody(desc, topics) {
  const body = String(desc || "").trim();
  const tags = String(topics || "").trim();
  if (!tags) return body;
  if (!body) return tags;
  return `${body}\n\n${tags}`;
}

export function isAbsolutePath(value) {
  return path.isAbsolute(String(value || ""));
}

export function videoExtensionOk(file) {
  return VIDEO_EXT.has(path.extname(String(file || "")).toLowerCase());
}

export function coverExtensionOk(file) {
  return COVER_EXT.has(path.extname(String(file || "")).toLowerCase());
}

function parseFlags(argv, out, handlers) {
  const args = argv || [];
  if (args.includes("--help") || args.includes("-h")) {
    out.help = true;
    return out;
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const handler = handlers[arg];
    if (!handler) throw new Error(`Unknown arg: ${arg}`);
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value == null || String(value).startsWith("--")) throw new Error(`Missing value for ${arg}`);
      handler(value);
      i += 1;
    } else {
      handler();
    }
  }
  return out;
}

export function parseCheckArgs(argv) {
  const out = { keep: false, help: false, taskName: LOGIN_TASK, expectAccount: "" };
  return parseFlags(argv, out, {
    "--keep": () => { out.keep = true; },
    "--expect-account": (value) => { out.expectAccount = String(value || "").trim(); },
    "--task-name": (value) => { out.taskName = String(value || "").trim() || out.taskName; },
  });
}

export function parseCleanupArgs(argv) {
  const out = { help: false, taskName: "" };
  return parseFlags(argv, out, {
    "--task-name": (value) => { out.taskName = String(value || "").trim(); },
  });
}

export function parsePostArgs(argv) {
  const out = {
    help: false,
    yes: false,
    json: false,
    keep: false,
    video: "",
    title: "",
    desc: "",
    topics: "",
    cover: "",
    expectAccount: "",
    taskName: PUBLISH_TASK,
  };
  const parsed = parseFlags(argv, out, {
    "--video": (value) => { out.video = String(value || "").trim(); },
    "--title": (value) => { out.title = String(value || "").trim(); },
    "--desc": (value) => { out.desc = String(value == null ? "" : value).trim(); },
    "--topics": (value) => { out.topics = String(value || "").trim(); },
    "--cover": (value) => { out.cover = String(value || "").trim(); },
    "--expect-account": (value) => { out.expectAccount = String(value || "").trim(); },
    "--yes": () => { out.yes = true; },
    "--json": () => { out.json = true; },
    "--keep": () => { out.keep = true; },
    "--task-name": (value) => { out.taskName = String(value || "").trim() || out.taskName; },
  });
  if (parsed.help) return parsed;
  if (!parsed.video) throw new Error("Missing --video");
  if (!parsed.title) throw new Error("Missing --title");
  if (!parsed.desc) throw new Error("Missing --desc");
  return parsed;
}

export function parseEditArgs(argv) {
  const out = {
    help: false,
    yes: false,
    json: false,
    keep: false,
    noteId: "",
    cover: "",
    expectAccount: "",
    taskName: EDIT_TASK,
    command: "edit-cover",
  };
  const parsed = parseFlags(argv, out, {
    "--note-id": (value) => { out.noteId = String(value || "").trim(); },
    "--cover": (value) => { out.cover = String(value || "").trim(); },
    "--expect-account": (value) => { out.expectAccount = String(value || "").trim(); },
    "--yes": () => { out.yes = true; },
    "--json": () => { out.json = true; },
    "--keep": () => { out.keep = true; },
    "--task-name": (value) => { out.taskName = String(value || "").trim() || out.taskName; },
  });
  if (parsed.help) return parsed;
  if (!parsed.noteId) throw new Error("Missing --note-id");
  if (!parsed.cover) throw new Error("Missing --cover");
  return parsed;
}

function fileProblem(file, label, exists, stat) {
  if (typeof exists === "function" && !exists(file)) return `--${label} not found: ${file}`;
  if (typeof stat !== "function") return "";
  let info;
  try {
    info = stat(file);
  } catch {
    return `--${label} not found: ${file}`;
  }
  if (!info || typeof info.isFile !== "function" || !info.isFile()) return `--${label} is not a file: ${file}`;
  if (!(info.size > 0)) return `--${label} is empty: ${file}`;
  return "";
}

export function validatePostInput(args = {}, { exists, stat } = {}) {
  const video = String(args.video || "").trim();
  const title = String(args.title || "").trim();
  const desc = String(args.desc || "").trim();
  const topics = String(args.topics || "").trim();
  const cover = String(args.cover || "").trim();
  const fields = { video, title, desc, topics, cover, body: composeBody(desc, topics) };
  if (!video) return { ok: false, error: "Missing --video", ...fields };
  if (!isAbsolutePath(video)) return { ok: false, error: "--video must be an absolute path", ...fields };
  if (!videoExtensionOk(video)) return { ok: false, error: "--video extension is not accepted by the creator upload input", ...fields };
  const videoError = fileProblem(video, "video", exists, stat);
  if (videoError) return { ok: false, error: videoError, ...fields };
  if (!title) return { ok: false, error: "Missing --title", ...fields };
  if (!desc) return { ok: false, error: "Missing --desc", ...fields };
  if (cover) {
    if (!isAbsolutePath(cover)) return { ok: false, error: "--cover must be an absolute path", ...fields };
    if (!coverExtensionOk(cover)) return { ok: false, error: "--cover must be a .jpg, .jpeg, or .png file", ...fields };
    const coverError = fileProblem(cover, "cover", exists, stat);
    if (coverError) return { ok: false, error: coverError, ...fields };
  }
  const titleWarning = charCount(title) > TITLE_RECOMMENDED_CHARS
    ? `title is longer than ${TITLE_RECOMMENDED_CHARS} characters; the creator UI recommends about that many`
    : "";
  return { ok: true, ...fields, titleWarning };
}

export function isNoteId(value) {
  return /^[a-f0-9]{16,32}$/i.test(String(value || "").trim());
}

export function updateUrl(noteId) {
  const id = String(noteId || "").trim();
  if (!isNoteId(id)) return "";
  return `https://creator.xiaohongshu.com/publish/update?id=${id}&noteType=video`;
}

export function validateEditInput(args = {}, { exists, stat } = {}) {
  const noteId = String(args.noteId || "").trim();
  const cover = String(args.cover || "").trim();
  const fields = { noteId, cover, video: "", title: "", desc: "", topics: "", body: "" };
  if (!isNoteId(noteId)) return { ok: false, error: "--note-id must be the note id from the explore URL", ...fields };
  if (!cover) return { ok: false, error: "Missing --cover", ...fields };
  if (!isAbsolutePath(cover)) return { ok: false, error: "--cover must be an absolute path", ...fields };
  if (!coverExtensionOk(cover)) return { ok: false, error: "--cover must be a .jpg, .jpeg, or .png file", ...fields };
  const coverError = fileProblem(cover, "cover", exists, stat);
  if (coverError) return { ok: false, error: coverError, ...fields };
  return { ok: true, ...fields };
}

export function planOf(config = {}, checked = {}, gate = {}) {
  const cover = String((checked && checked.cover) || config.cover || "").trim();
  const plan = {
    video: String((checked && checked.video) || config.video || ""),
    title: String((checked && checked.title) || config.title || ""),
    desc: String((checked && checked.desc) || config.desc || ""),
    topics: String((checked && checked.topics) || config.topics || ""),
    body: (checked && checked.body) || composeBody(config.desc, config.topics),
    cover: cover || null,
    cover_mode: cover ? "replace-first-frame" : "platform-default-first-frame",
    cover_selector: cover ? COVER_INPUT_SELECTOR : null,
    expect_account: config.expectAccount || null,
    nickname: (gate && gate.nickname) || null,
    task_name: config.taskName || PUBLISH_TASK,
  };
  if (checked && checked.titleWarning) plan.title_warning = checked.titleWarning;
  const noteId = String((checked && checked.noteId) || config.noteId || "").trim();
  if (noteId) {
    plan.note_id = noteId;
    plan.update_url = updateUrl(noteId) || null;
    plan.best_effort = true;
  }
  if (!cover) {
    plan.cover_note = "No --cover. Xiaohongshu keeps the video first frame. This skill does not invent a cover.";
  } else if (noteId) {
    plan.cover_note = "Best-effort edit. Set input.pk-cover-list-file-input, then confirm toast 「已添加 PK 封面」 and the counter advancing (for example 0/3 → 1/3) before the footer 发布. No crop dialog. Save may return the note to 审核中. If the page says 加载失败, 发布 is not clicked.";
  } else {
    plan.cover_note = "Replace the default first-frame cover via input.pk-cover-list-file-input. Confirm toast 「已添加 PK 封面」 and the counter advancing (for example 0/3 → 1/3) before 发布. No crop dialog is clicked. If confirmation fails, the run fails and 发布 is not clicked.";
  }
  return plan;
}

export function onCreator(url) {
  try {
    return /(^|\.)creator\.xiaohongshu\.com$/i.test(new URL(String(url || "")).hostname);
  } catch {
    return false;
  }
}

export function isLoginWall({ url = "", title = "", text = "", loginWall = false } = {}) {
  if (loginWall) return true;
  const pageUrl = String(url || "");
  if (/creator\.xiaohongshu\.com\/login/i.test(pageUrl)) return true;
  if (/\/login(?:\b|[/?#]|$)/i.test(pageUrl) && /xiaohongshu/i.test(pageUrl)) return true;
  return /扫码登录|二维码登录|请使用小红书App扫码|登录后继续/.test(`${title}\n${text}`);
}

export function classifyLogin({ url = "", title = "", text = "", nickname = "", creatorChrome = false, loginWall = false } = {}) {
  const pageUrl = String(url || "");
  const blob = `${title}\n${text}`;
  const wall = isLoginWall({ url: pageUrl, title, text, loginWall });
  const chrome = Boolean(creatorChrome) || /发布笔记|笔记管理|上传视频|创作服务平台|数据中心|重新上传|设置封面|填写标题/.test(blob);
  const name = String(nickname || "").trim();
  const loggedIn = onCreator(pageUrl) && !wall && (chrome || Boolean(name));
  return strip({
    logged_in: loggedIn,
    login_required: !loggedIn,
    on_login_page: wall || undefined,
    nickname: name || undefined,
    url: pageUrl || undefined,
    title: title || undefined,
  });
}

export function needsRepaint(detected = {}) {
  if (detected.evaluateError && !String(detected.text || "").trim()) return true;
  if (detected.loginWall || isLoginWall(detected)) return false;
  if (detected.creatorChrome || String(detected.nickname || "").trim()) return false;
  if (String(detected.text || "").trim().length > 40) return false;
  return true;
}

export function accountGate({ nickname = "", expected = "", text = "", loggedIn = false } = {}) {
  const want = String(expected || "").trim();
  const seen = String(nickname || "").trim();
  if (!loggedIn) return { ok: false, account_mismatch: false, nickname: seen };
  if (!want) return { ok: true, account_mismatch: false, nickname: seen };
  if (seen && seen === want) return { ok: true, account_mismatch: false, nickname: seen };
  if (!seen && String(text || "").includes(want)) {
    return { ok: true, account_mismatch: false, nickname: want, nickname_via: "body" };
  }
  return {
    ok: false,
    account_mismatch: true,
    nickname: seen,
    error: seen
      ? `account mismatch: expected ${want}, saw ${seen}`
      : `account mismatch: expected ${want}, nickname not found`,
  };
}

export function uploadReady(text) {
  const body = String(text || "");
  if (/上传中\s*\d+%/.test(body)) return false;
  return /重新上传|设置封面/.test(body);
}

export function pkToastSeen(state) {
  if (!state || typeof state !== "object") return false;
  if (state.pkApplied) return true;
  return /已添加\s*PK\s*封面/.test(`${state.text || ""}\n${state.previewText || ""}`);
}

export function coverCount(state) {
  if (!state || typeof state !== "object") return null;
  if (typeof state.coverCount === "number" && Number.isFinite(state.coverCount)) return state.coverCount;
  const source = `${state.counterText || ""}\n${state.text || ""}\n${state.previewText || ""}`;
  const near = source.match(/封面[^0-9\n]{0,24}(\d+)\s*\/\s*3/);
  const match = near || source.match(/(?:^|[^\d])(\d+)\s*\/\s*3/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

export function cropDialogOpen(state) {
  if (!state || typeof state !== "object") return false;
  if (state.cropDialog) return true;
  return /裁剪封面|裁剪图片|完成裁剪|确认裁剪/.test(String(state.text || ""));
}

export function coverReplacedFirstFrame(before, after) {
  if (!after || typeof after !== "object") return false;
  if (cropDialogOpen(after)) return false;
  if (!pkToastSeen(after)) return false;
  const beforeN = coverCount(before);
  const afterN = coverCount(after);
  if (afterN == null) return false;
  if (beforeN == null) return afterN >= 1;
  return afterN > beforeN;
}

export function editPageFailed(text) {
  return /加载失败/.test(String(text || ""));
}

export function editSettled({ url = "", text = "" } = {}) {
  const body = String(text || "");
  if (editPageFailed(body)) return false;
  if (/\/publish\/success/i.test(String(url || "")) && /发布成功/.test(body)) return true;
  if (/note-manager/i.test(String(url || ""))) return true;
  return /封面PK中|审核中/.test(body);
}

export function assertCoverBeforePublish({ cover = "", coverConfirmed = false } = {}) {
  if (String(cover || "").trim() && !coverConfirmed) {
    return {
      ok: false,
      error: "Refusing to click 发布 because the PK cover was not confirmed. The video first frame would be used.",
    };
  }
  return { ok: true };
}

export function publishSucceeded({ url = "", text = "" } = {}) {
  return /\/publish\/success/i.test(String(url || "")) && /发布成功/.test(String(text || ""));
}

export function parseImpression(raw) {
  if (raw == null || raw === "") return "";
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return "";
    }
  }
  if (!data || typeof data !== "object") return "";
  const id = data.noteTarget?.value?.noteId || data.noteTarget?.noteId || data.noteId || "";
  return /^[a-f0-9]{16,32}$/i.test(String(id)) ? String(id) : "";
}

export function exploreUrl(noteId) {
  const id = String(noteId || "");
  if (!/^[a-f0-9]{16,32}$/i.test(id)) return "";
  return `${EXPLORE_PREFIX}${id}`;
}

export function pickNote(cards, title) {
  const list = Array.isArray(cards) ? cards : [];
  const wanted = String(title || "").trim();
  if (!wanted) return { ok: false, error: "title is empty; note card was not selected" };
  const matched = list.filter((card) => {
    const blob = `${card && card.text ? card.text : ""} ${card && card.title ? card.title : ""}`;
    return blob.includes(wanted);
  });
  const card = matched[0];
  if (!card) return { ok: false, error: "note card matching title not found" };
  const noteId = parseImpression(card.impression != null ? card.impression : card["data-impression"]);
  if (!noteId) return { ok: false, error: "matching note card has no noteId" };
  return { ok: true, noteId, url: exploreUrl(noteId) };
}

export function cleanupTargets({ listed, taskName = "", prefix = SPACE_PREFIX } = {}) {
  const names = [];
  const add = (name) => {
    const value = String(name || "").trim();
    if (!value || names.includes(value)) return;
    names.push(value);
  };
  const fromList = [];
  if (Array.isArray(listed)) {
    for (const item of listed) {
      const name = typeof item === "string" ? item : item && (item.name || item.taskName || "");
      if (name && String(name).startsWith(prefix)) fromList.push(String(name));
    }
  }
  const explicit = String(taskName || "").trim();
  if (explicit && explicit !== prefix) {
    add(explicit);
    for (const name of fromList) {
      if (name === explicit || name.startsWith(explicit)) add(name);
    }
    return names;
  }
  if (fromList.length) {
    for (const name of fromList) add(name);
    return names;
  }
  add(prefix);
  add(`${prefix}-login`);
  add(`${prefix}-edit`);
  return names;
}

export function confirmationSummary(config = {}, checked = {}, gate = {}) {
  const command = config.command || "post-video";
  const error = command === "edit-cover"
    ? "Refusing to upload a cover or click 发布 without --yes. Edit is best-effort. Show this plan, then re-run with --yes only after the user confirms."
    : "Refusing to upload or publish without --yes. Show this plan to the user, then re-run with --yes only after they confirm.";
  return strip({
    skill: SKILL,
    command,
    ok: false,
    published: false,
    uploaded: false,
    clicked_publish: false,
    best_effort: command === "edit-cover" || undefined,
    confirmation_required: true,
    exitCode: 3,
    logged_in: true,
    nickname: gate.nickname || undefined,
    plan: planOf(config, checked, gate),
    login_tip: LOGIN_TIP,
    login_tip_zh: LOGIN_TIP_ZH,
    error,
  });
}

export function inputErrorSummary(config = {}, checked = {}) {
  return strip({
    skill: SKILL,
    command: config.command || "post-video",
    ok: false,
    published: false,
    uploaded: false,
    clicked_publish: false,
    exitCode: 1,
    error: checked.error || "invalid input",
    plan: planOf(config, checked),
  });
}

export function egoMissingSummary(command = "check-login") {
  return strip({
    skill: SKILL,
    command,
    ok: false,
    published: false,
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

export function formatResult(summary, { asJson = false } = {}) {
  if (!summary || typeof summary !== "object") return "";
  if (!asJson && summary.exitCode === 0 && summary.published && summary.url) return `${summary.url}\n`;
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function extractTaggedJson(combined, tag = RESULT_TAG) {
  const lines = String(combined || "").split(/\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const at = line.indexOf(tag);
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + tag.length));
    } catch {
      // keep scanning
    }
  }
  return null;
}

export function resolveProcessExit(combined, code) {
  const matched = String(combined || "").match(/nodejs process exited with code (\d+)/);
  if (matched) return Number(matched[1]);
  if (code === 0) return 0;
  return code ?? 1;
}
