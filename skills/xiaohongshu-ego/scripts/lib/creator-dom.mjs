// Browser-side creator.xiaohongshu.com actions.
// page.evaluate serializes this function alone, so it must not close over imports.
// Tests call it with globalThis.document set.

export const VIDEO_INPUT_SELECTOR = "input.upload-input";
export const COVER_INPUT_SELECTOR = "input.pk-cover-list-file-input";

const NICK_SELECTORS = [
  "[class*='user-name']",
  "[class*='nickname']",
  "[class*='nick-name']",
  "[class*='account-name']",
  ".user-info .name",
  "header .name",
];

const NAV = new Set([
  "首页", "笔记管理", "发布笔记", "数据中心", "上传视频", "创作灵感", "登录",
  "发布", "暂存离开", "创作服务平台", "设置封面", "换封面", "填写标题",
]);

function qsa(doc, selector) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  return [...doc.querySelectorAll(selector)];
}

function bodyText(doc) {
  const body = doc && doc.body;
  if (!body) return "";
  return String(body.innerText || body.textContent || "");
}

function usableNick(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || value.length > 32) return "";
  if (NAV.has(value)) return "";
  if (/^https?:/i.test(value)) return "";
  return value;
}

function nicknameFrom(doc) {
  for (const selector of NICK_SELECTORS) {
    const nodes = qsa(doc, selector);
    for (const node of nodes) {
      const name = usableNick(node && (node.innerText || node.textContent));
      if (name) return name;
    }
  }
  return "";
}

function isFileInput(el) {
  return Boolean(el) && el.tagName === "INPUT" && String(el.getAttribute("type") || "").toLowerCase() === "file";
}

function labelOf(el) {
  const nodes = el && el.childNodes ? [...el.childNodes] : [];
  const own = nodes
    .filter((node) => node && node.nodeType === 3)
    .map((node) => String(node.textContent || "").trim())
    .join("");
  const full = String((el && (el.innerText || el.textContent)) || "").trim().replace(/\s+/g, "");
  return { own: own.replace(/\s+/g, ""), full };
}

function isExactPublish(el) {
  const { own, full } = labelOf(el);
  return own === "发布" || full === "发布";
}

function writeControl(el, value) {
  const editable = Boolean(el && (el.isContentEditable || (el.getAttribute && el.getAttribute("contenteditable") === "true")));
  if (editable) {
    el.textContent = value;
    if ("innerText" in el) el.innerText = value;
  } else if (el) {
    el.value = value;
  }
  if (el && typeof el.dispatchEvent === "function") {
    el.dispatchEvent({ type: "input", bubbles: true });
    el.dispatchEvent({ type: "change", bubbles: true });
  }
  if (!el) return "";
  if (editable) return String(el.innerText || el.textContent || "");
  return String(el.value ?? "");
}

function fileInput(doc, selector, label) {
  const found = typeof doc.querySelector === "function" ? doc.querySelector(selector) : null;
  if (!found || found.tagName !== "INPUT") return { ok: false, error: `${label} file input not found` };
  return { ok: true, selector, accept: found.getAttribute("accept") || "" };
}

function coverPreviewNodes(doc) {
  const seen = new Set();
  const out = [];
  for (const node of [...qsa(doc, "[class*='cover']"), ...qsa(doc, "[class*='pk-cover']"), ...qsa(doc, "img")]) {
    if (!node || seen.has(node) || node.tagName === "INPUT") continue;
    seen.add(node);
    out.push(node);
  }
  return out;
}

export function creatorAct(payload) {
  const doc = globalThis.document;
  if (!doc) return { ok: false, error: "creatorAct requires a document" };
  const request = payload && typeof payload === "object" ? payload : {};
  const op = request.op || "probe";
  const href = String((globalThis.location && globalThis.location.href) || "");
  const text = bodyText(doc);

  if (op === "probe") {
    const nickname = nicknameFrom(doc);
    return {
      ok: true,
      text: text.slice(0, 4000),
      url: href,
      title: String(doc.title || ""),
      nickname,
      loginWall: /\/login(?:\b|[/?#]|$)/i.test(href) || /扫码登录|二维码登录|请使用小红书App扫码/.test(text),
      creatorChrome: /发布笔记|笔记管理|上传视频|创作服务平台|数据中心|重新上传|设置封面|填写标题/.test(text),
    };
  }

  if (op === "video-input") return fileInput(doc, "input.upload-input", "video");

  if (op === "cover-input") {
    const found = fileInput(doc, "input.pk-cover-list-file-input", "PK cover");
    if (!found.ok) return found;
    if (found.accept && !/\.png|\.jpg|\.jpeg|image\//i.test(found.accept)) {
      return { ok: false, error: "cover input accept does not allow png or jpg" };
    }
    return found;
  }

  if (op === "reveal-cover") {
    const buttons = [...qsa(doc, "button"), ...qsa(doc, "[role='button']")];
    const target = buttons.find((el) => {
      const { own, full } = labelOf(el);
      return own === "换封面" || full === "换封面" || own === "设置封面" || full === "设置封面";
    });
    if (!target) return { ok: false, error: "换封面 control not found" };
    if (typeof target.click === "function") target.click();
    return { ok: true, via: "click" };
  }

  if (op === "cover-state") {
    const signature = coverPreviewNodes(doc).map((node) => {
      const src = node.getAttribute ? (node.getAttribute("src") || "") : "";
      const bg = node.style && node.style.backgroundImage ? node.style.backgroundImage : "";
      const label = String(node.innerText || node.textContent || "").slice(0, 40);
      return `${src}|${bg}|${label}`;
    }).join("||");
    const previewMatch = text.match(/封面预览[^\n]{0,80}/);
    const near = text.match(/封面[^0-9\n]{0,24}(\d+)\s*\/\s*3/);
    const counter = near || text.match(/(?:^|[^\d])(\d+)\s*\/\s*3/);
    const coverCount = counter ? Number(counter[1]) : null;
    return {
      ok: true,
      pkApplied: /已添加\s*PK\s*封面/.test(text),
      coverCount: Number.isFinite(coverCount) ? coverCount : null,
      counterText: Number.isFinite(coverCount) ? `${coverCount}/3` : "",
      cropDialog: /裁剪封面|裁剪图片|完成裁剪|确认裁剪/.test(text),
      previewSignature: signature,
      previewText: previewMatch ? previewMatch[0] : "",
      text: text.slice(0, 500),
    };
  }

  if (op === "fill-title") {
    const inputs = [...qsa(doc, "input"), ...qsa(doc, "textarea")].filter((el) => !isFileInput(el));
    const field = inputs.find((el) => /填写标题/.test(String(el.getAttribute("placeholder") || "")))
      || inputs.find((el) => /标题/.test(String(el.getAttribute("aria-label") || "")))
      || inputs[0];
    if (!field) return { ok: false, error: "title field not found" };
    const value = writeControl(field, String(request.title || ""));
    return value === String(request.title || "")
      ? { ok: true, value }
      : { ok: false, error: "title readback mismatch", value };
  }

  if (op === "fill-body") {
    const titleInputs = [...qsa(doc, "input"), ...qsa(doc, "textarea")].filter((el) => /填写标题/.test(String(el.getAttribute("placeholder") || "")));
    const editable = qsa(doc, "[contenteditable='true']");
    const areas = qsa(doc, "textarea").filter((el) => !titleInputs.includes(el));
    const field = editable[0]
      || areas.find((el) => /描述|正文|话题/.test(String(el.getAttribute("placeholder") || "")))
      || areas[0];
    if (!field) return { ok: false, error: "description field not found" };
    const value = writeControl(field, String(request.body || ""));
    return value === String(request.body || "")
      ? { ok: true, value }
      : { ok: false, error: "description readback mismatch", value };
  }

  if (op === "click-publish") {
    const buttons = [...qsa(doc, "button"), ...qsa(doc, "[role='button']")];
    const target = buttons.find((el) => isExactPublish(el));
    if (!target) return { ok: false, error: "发布 button not found" };
    if (typeof target.click === "function") target.click();
    return { ok: true, via: "click" };
  }

  if (op === "note-cards") {
    const cards = qsa(doc, ".note-card").map((card) => ({
      text: String(card.innerText || card.textContent || "").slice(0, 500),
      impression: card.getAttribute("data-impression") || "",
    }));
    return { ok: true, cards };
  }

  return { ok: false, error: `unknown op ${op}` };
}
