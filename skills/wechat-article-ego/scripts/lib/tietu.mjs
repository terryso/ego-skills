// 贴图 (image post, type 77) planning. No browser, no filesystem, no network.
import crypto from "node:crypto";
import { IMAGE_MAX_BYTES, normalizeText, sniffImage } from "./pure.mjs";

export const TIETU_TYPE = 77;
export const TIETU_SHOW_TYPE = 8;
export const TIETU_TITLE_MAX = 20;
export const TIETU_TEXT_MAX = 1000;
export const TIETU_FILE_INPUT = 'xpath=(//input[@type="file"])[2]';
export const TIETU_UPLOAD_TIMEOUT_MS = 60_000;
export const TIETU_UPLOAD_POLL_MS = 500;
export const TIETU_SAVE_TIMEOUT_MS = 20_000;
export const TIETU_SAVE_POLL_MS = 500;
export const TIETU_AUTOSAVE_TIMEOUT_MS = 30_000;

const URL_IN_TEXT = /https?:\/\/[^\s]+/gi;
const BARE_URL = /^https?:\/\/\S+$/i;

export function charCount(value) {
  return [...String(value ?? "")].length;
}

export function normalizeTietuText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
}

export function findUrls(text) {
  const found = [];
  for (const line of normalizeTietuText(text).split("\n")) {
    const matches = line.match(URL_IN_TEXT) || [];
    found.push(...matches);
  }
  return found;
}

export function bareUrlLines(text) {
  return normalizeTietuText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => BARE_URL.test(line));
}

export function normalizeTopic(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "topic is empty" };
  if (text.includes("#")) {
    return { ok: false, error: `topic ${JSON.stringify(text)} must not include '#'; pass the name only` };
  }
  if (/\s/u.test(text)) {
    return { ok: false, error: `topic ${JSON.stringify(text)} must be one name without spaces` };
  }
  return { ok: true, topic: text };
}

export function topicLabel(value) {
  return String(value ?? "").trim().replace(/^#/, "");
}

export function fileBaseName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parts = text.split(/[/\\]/);
  return parts[parts.length - 1] || text;
}

export function trimUploaderHtml(html, limit = 4000) {
  const text = String(html ?? "").replace(/token=[^&"'\s<]+/gi, "token=redacted");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n<!-- truncated -->`;
}

function uploadNumber(probe, key) {
  const value = Number(probe && probe[key]);
  return Number.isFinite(value) ? value : 0;
}

export function isCdnImageSrc(src) {
  return /mmbiz\.qpic\.cn|mmbiz/i.test(String(src || ""));
}

export function imageFieldsFromBody(body) {
  const text = String(body || "");
  let cdn = "";
  let share = "";
  try {
    const params = new URLSearchParams(text);
    cdn = params.get("cdn_url0") || "";
    share = params.get("share_imageinfo0") || "";
  } catch {
    cdn = "";
    share = "";
  }
  if (!cdn) {
    const matched = text.match(/(?:^|&)cdn_url0=([^&]*)/);
    if (matched) cdn = decodeURIComponent(matched[1].replace(/\+/g, " "));
  }
  if (!share) {
    const matched = text.match(/(?:^|&)share_imageinfo0=([^&]*)/);
    if (matched) share = decodeURIComponent(matched[1].replace(/\+/g, " "));
  }
  const cdnNonEmpty = Boolean(String(cdn).trim());
  let shareNonEmpty = false;
  if (String(share).trim()) {
    try {
      const parsed = JSON.parse(share);
      const url = parsed && parsed.list && parsed.list[0] && parsed.list[0].url;
      shareNonEmpty = Boolean(url && String(url).trim());
    } catch {
      shareNonEmpty = !/^\s*\{\s*"list"\s*:\s*\[\s*\]\s*\}\s*$/.test(share);
    }
  }
  return {
    cdnNonEmpty,
    shareNonEmpty,
    nonEmpty: cdnNonEmpty && shareNonEmpty,
  };
}

// A 贴图 is uploaded only when .image-selector holds the expected number of
// distinct mmbiz CDN pictures. File-input, network, and placeholder changes
// are hints that the upload started. They do not make it safe to save.
export function uploadAdvanced(before, after, { expected } = {}) {
  const prev = before || {};
  const next = after || {};
  const hints = [];
  if (uploadNumber(next, "thumbCount") > uploadNumber(prev, "thumbCount")) hints.push("thumbnail");
  if (uploadNumber(next, "imageCount") > uploadNumber(prev, "imageCount")) hints.push("image-count");
  const prevValue = String(prev.inputValue || "");
  const nextValue = String(next.inputValue || "");
  if (nextValue && nextValue !== prevValue) hints.push("input-value");
  if (uploadNumber(next, "inputChildren") > uploadNumber(prev, "inputChildren")) hints.push("input-children");
  if (prev.placeholder && !next.placeholder) hints.push("placeholder-gone");
  if (uploadNumber(next, "uploadResponses") > uploadNumber(prev, "uploadResponses")) hints.push("upload-response");
  const cdn = uploadNumber(next, "cdnImageCount");
  const prevCdn = uploadNumber(prev, "cdnImageCount");
  const ready = expected == null ? cdn > prevCdn && cdn > 0 : cdn >= expected && cdn > 0;
  return { ok: ready, reasons: ready ? ["cdn-image"] : [], hints };
}

export function describeUpload(before, after) {
  const bit = (probe, key) => uploadNumber(probe, key);
  const flag = (probe) => Boolean(probe && probe.placeholder);
  const name = (probe) => fileBaseName(probe && probe.inputValue);
  return `cdn ${bit(before, "cdnImageCount")}->${bit(after, "cdnImageCount")}, imageCount ${bit(before, "imageCount")}->${bit(after, "imageCount")}, thumbs ${bit(before, "thumbCount")}->${bit(after, "thumbCount")}, placeholder ${flag(before)}->${flag(after)}, inputValue ${JSON.stringify(name(before))}->${JSON.stringify(name(after))}, responses ${bit(before, "uploadResponses")}->${bit(after, "uploadResponses")}`;
}

export function redactMpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|pass|cookie|session|key/i.test(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function parseSaveResponse(payload) {
  let data = payload;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return { ok: false, appmsgid: "", ret: null, body: { ret: null, appMsgId: "" } };
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { ok: false, appmsgid: "", ret: null, body: { ret: null, appMsgId: "" } };
    }
  }
  if (!data || typeof data !== "object") {
    return { ok: false, appmsgid: "", ret: null, body: { ret: null, appMsgId: "" } };
  }
  const base = data.base_resp && typeof data.base_resp === "object" ? data.base_resp : null;
  const ret = data.ret != null ? data.ret : (base && base.ret != null ? base.ret : null);
  const raw = data.appMsgId ?? data.appmsgid ?? data.app_msg_id ?? (base && (base.appMsgId ?? base.appmsgid)) ?? "";
  const appmsgid = /^[0-9]+$/.test(String(raw)) ? String(raw) : "";
  const retOk = ret == null || ret === 0 || ret === "0";
  return {
    ok: Boolean(appmsgid) && retOk,
    appmsgid: retOk ? appmsgid : "",
    ret,
    body: { ret, appMsgId: appmsgid },
  };
}

export function appmsgidFromSave({ urlId = "", responses = [] } = {}) {
  if (/^[0-9]+$/.test(String(urlId || ""))) {
    return { appmsgid: String(urlId), via: "url" };
  }
  const hits = Array.isArray(responses) ? responses : [];
  const hit = [...hits].reverse().find((item) => (
    item && /^[0-9]+$/.test(String(item.appMsgId || ""))
    && (item.ret == null || item.ret === 0 || item.ret === "0")
  ));
  if (hit) return { appmsgid: String(hit.appMsgId), via: "response" };
  return { appmsgid: "", via: "" };
}

export function describeFileInputs(probe) {
  const inputs = (probe && probe.fileInputs) || [];
  const accepts = inputs.map((item) => String((item && item.accept) || ""));
  const chosen = probe && probe.chosenIndex ? probe.chosenIndex : 0;
  return `fileInputs=${inputs.length} accept=${JSON.stringify(accepts)} chosen=${chosen}`;
}

export function composeTietuBody(text, topics) {
  const normalized = normalizeTietuText(text);
  const lines = normalized.length ? normalized.split("\n") : [];
  const steps = [];
  lines.forEach((line, index) => {
    if (index > 0) steps.push({ op: "enter" });
    if (line.length) steps.push({ op: "insertText", value: line });
  });
  topics.forEach((topic, index) => {
    if (lines.length > 0 && index === 0) steps.push({ op: "enter" });
    if (index > 0) steps.push({ op: "insertText", value: " " });
    steps.push({ op: "insertText", value: "#" });
    steps.push({ op: "insertText", value: topic });
  });
  const topicChunk = topics.map((topic) => `#${topic}`).join(" ");
  let composed = normalized;
  if (normalized && topicChunk) composed = `${normalized}\n${topicChunk}`;
  else if (topicChunk) composed = topicChunk;
  return {
    text: normalized,
    lines,
    topics: [...topics],
    steps,
    urls: findUrls(normalized),
    bareUrls: bareUrlLines(normalized),
    charCount: charCount(normalized),
    composedCount: charCount(composed),
  };
}

export function inspectImage(buf, name) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const label = name || "image";
  if (data.length > IMAGE_MAX_BYTES) {
    return { ok: false, error: `image exceeds ${IMAGE_MAX_BYTES} bytes: ${label}` };
  }
  const type = sniffImage(data);
  if (!type) return { ok: false, error: `not an image file: ${label}` };
  return {
    ok: true,
    type,
    bytes: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  };
}

export function buildTietu({ title, text, topics = [], images = [] }) {
  const resolvedTitle = String(title ?? "").trim();
  const titleLen = charCount(resolvedTitle);
  if (!resolvedTitle) return { ok: false, error: "title is empty" };
  if (/[\r\n]/.test(resolvedTitle)) return { ok: false, error: "title must be a single line" };
  if (titleLen > TIETU_TITLE_MAX) {
    return { ok: false, error: `title is ${titleLen} characters; a 贴图 title allows ${TIETU_TITLE_MAX}` };
  }
  if (!images.length) return { ok: false, error: "--image is required" };
  const cleanTopics = [];
  for (const raw of topics) {
    const topic = normalizeTopic(raw);
    if (!topic.ok) return topic;
    cleanTopics.push(topic.topic);
  }
  const body = composeTietuBody(text, cleanTopics);
  if (!body.text && cleanTopics.length === 0) return { ok: false, error: "text is empty" };
  if (body.charCount > TIETU_TEXT_MAX) {
    return {
      ok: false,
      error: `text is ${body.charCount} characters; a 贴图 body allows ${TIETU_TEXT_MAX}, including URLs`,
    };
  }
  if (body.composedCount > TIETU_TEXT_MAX) {
    return {
      ok: false,
      error: `text plus topics is ${body.composedCount} characters; a 贴图 body allows ${TIETU_TEXT_MAX}`,
    };
  }
  const fidelity = [
    "external URLs stay plain text and are not clickable; the 贴图 link field only accepts 公众号内容, 小程序, or 小店",
    "the first image is the cover",
    "topics are typed with # in the body; the editor creates the topic link and no dropdown is used",
  ];
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    kind: "tietu",
    type: TIETU_TYPE,
    title: resolvedTitle,
    text: body.text,
    topics: cleanTopics,
    images: images.map((image) => image.sha256),
  })).digest("hex");
  return {
    ok: true,
    kind: "tietu",
    type: TIETU_TYPE,
    title: resolvedTitle,
    text: body.text,
    topics: cleanTopics,
    lines: body.lines,
    steps: body.steps,
    urls: body.urls,
    bareUrls: body.bareUrls,
    charCount: body.charCount,
    composedCount: body.composedCount,
    imageCount: images.length,
    images: images.map((image, index) => ({
      name: image.name,
      path: image.path,
      bytes: image.bytes,
      sha256: image.sha256,
      cover: index === 0,
    })),
    fidelity,
    hash,
  };
}

export function planOfTietu(post, account) {
  return {
    kind: "tietu",
    type: TIETU_TYPE,
    title: post.title,
    text: post.text,
    topics: post.topics,
    urls: post.urls,
    bareUrls: post.bareUrls,
    hash: post.hash,
    account: account || "",
    imageCount: post.imageCount,
    images: (post.images || []).map(({ name, bytes, sha256, cover }) => ({ name, bytes, sha256, cover })),
    charCount: post.charCount,
    composedCount: post.composedCount,
    fidelity: post.fidelity,
    save: false,
    externalUrlsClickable: false,
  };
}

export function validateTietuReadback(expected, actual) {
  const titleOk = normalizeText(actual && actual.title) === normalizeText(expected.title);
  const imageCount = actual && typeof actual.imageCount === "number" ? actual.imageCount : -1;
  const imagesOk = imageCount === expected.imageCount;
  const haystack = String((actual && actual.text) || "");
  const flat = normalizeText(haystack);
  const missing = [];
  for (const line of String(expected.text || "").split("\n")) {
    const needle = line.trim();
    if (needle.length < 2) continue;
    if (!haystack.includes(needle) && !flat.includes(normalizeText(needle))) missing.push(needle.slice(0, 80));
  }
  const gotTopics = ((actual && actual.topics) || []).map(topicLabel);
  const wantTopics = (expected.topics || []).map(topicLabel);
  const missingTopics = [];
  wantTopics.forEach((topic, index) => {
    if (gotTopics[index] !== topic) missingTopics.push(topic);
  });
  const topicsOk = missingTopics.length === 0 && gotTopics.length === wantTopics.length;
  const typeValue = actual && actual.type != null ? Number(actual.type) : null;
  const typeOk = typeValue == null || typeValue === TIETU_TYPE;
  return {
    ok: titleOk && imagesOk && missing.length === 0 && topicsOk && typeOk,
    titleOk,
    imagesOk,
    topicsOk,
    typeOk,
    missing,
    missingTopics,
    imageCount,
  };
}

export function tietuLoginTip(account) {
  const who = account ? ` as ${account}` : "";
  return {
    login_tip: `Logged in${who}. This run saves one 贴图 draft (type 77). It only clicks 保存为草稿. It never clicks 发表, 预览, 群发, 定时群发, or 发送预览. External URLs stay plain text and are not clickable.`,
    login_tip_zh: `已登录${account ? `：${account}` : ""}。这一次只保存一篇贴图草稿（type 77），只点「保存为草稿」，不会点「发表」「预览」「群发」「定时群发」或「发送预览」。正文里的外部链接保持纯文本，不能点击。`,
  };
}

export function sessionToken(href) {
  try {
    const url = new URL(String(href || ""));
    if (!/(^|\.)mp\.weixin\.qq\.com$/i.test(url.hostname)) return "";
    return url.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export function appmsgidFromUrl(href) {
  try {
    const id = new URL(String(href || "")).searchParams.get("appmsgid") || "";
    return /^[0-9]+$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function mpUrl(path, params) {
  const url = new URL(path, "https://mp.weixin.qq.com");
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function tietuEditorUrl({ token = "", appmsgid = "" } = {}) {
  if (appmsgid) {
    return mpUrl("/cgi-bin/appmsg", {
      t: "media/appmsg_edit",
      action: "edit",
      type: String(TIETU_TYPE),
      appmsgid: String(appmsgid),
      token,
      lang: "zh_CN",
    });
  }
  return mpUrl("/cgi-bin/appmsg", {
    t: "media/appmsg_edit_v2",
    action: "edit",
    isNew: "1",
    type: String(TIETU_TYPE),
    createType: "8",
    token,
    lang: "zh_CN",
  });
}

export function tietuListUrl({ token = "" } = {}) {
  return mpUrl("/cgi-bin/appmsg", {
    begin: "0",
    count: "10",
    type: String(TIETU_TYPE),
    action: "list_card",
    token,
    lang: "zh_CN",
  });
}

export function articleListUrl({ token = "" } = {}) {
  return mpUrl("/cgi-bin/appmsg", {
    begin: "0",
    count: "10",
    type: "10",
    action: "list_card",
    token,
    lang: "zh_CN",
  });
}
