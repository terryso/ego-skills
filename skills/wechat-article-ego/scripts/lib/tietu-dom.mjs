// Browser-side 贴图 editor actions.
// page.evaluate serializes tietuAct alone. Every helper lives inside the function.

export function tietuAct(payload) {
  const doc = globalThis.document;
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return { ok: false, error: "tietuAct requires a document" };
  }
  const input = payload && typeof payload === "object" ? payload : {};
  const op = input.op || "editor-state";

  function qsa(root, selector) {
    const scope = root || doc;
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    try {
      return [...scope.querySelectorAll(selector)];
    } catch {
      return [];
    }
  }

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    const hidden = el.getAttribute && (el.getAttribute("hidden") != null || el.getAttribute("aria-hidden") === "true");
    if (hidden) return false;
    if (typeof el.getClientRects === "function") return el.getClientRects().length > 0;
    return true;
  }

  function ownLabel(el) {
    const direct = [...(el.childNodes || [])]
      .filter((node) => node && node.nodeType === 3)
      .map((node) => node.textContent || "")
      .join("")
      .trim();
    if (direct) return normalize(direct);
    return normalize(el.innerText || el.textContent || "");
  }

  function isForbidden(text) {
    const label = normalize(text);
    if (!label) return false;
    if (/发送预览|定时群发|定时发表|预览/.test(label)) return true;
    return /群发|发表/.test(label);
  }

  function qsaAny(selectors, root) {
    const out = [];
    for (const selector of selectors) out.push(...qsa(root, selector));
    return out;
  }

  function findExact(text) {
    const want = normalize(text);
    if (!want) return null;
    const tags = { BUTTON: 0, A: 1, SPAN: 2, LI: 3, LABEL: 4, DIV: 5 };
    const found = qsaAny(["button", "a", "span", "li", "label", "div"]).filter((el) => (
      visible(el) && ownLabel(el) === want
    ));
    found.sort((left, right) => (tags[left.tagName] ?? 9) - (tags[right.tagName] ?? 9));
    return found[0] || null;
  }

  function pageHref() {
    try {
      return String(globalThis.location && globalThis.location.href || "");
    } catch {
      return "";
    }
  }

  function pageUrl() {
    try {
      return new URL(pageHref());
    } catch {
      return null;
    }
  }

  function mirrors() {
    return qsa(doc, ".ProseMirror");
  }

  function fileInputs() {
    return qsa(doc, "input").filter((el) => (el.getAttribute("type") || el.type) === "file");
  }

  function imageCount(body) {
    if (!body) return 0;
    return qsa(body, "img").filter((img) => {
      const src = (img.getAttribute && img.getAttribute("src")) || "";
      return src && src !== "about:blank";
    }).length;
  }

  function topicTexts(body) {
    if (!body) return [];
    return qsa(body, "a.wx_topic_link").map((el) => String(el.innerText || el.textContent || "").trim()).filter(Boolean);
  }

  function savedClock(text) {
    const matched = String(text || "").match(/(\d{1,2}:\d{2})\s*已保存/);
    return matched ? matched[1] : "";
  }

  function editorState() {
    const fields = mirrors();
    const title = fields[0] || null;
    const body = fields[1] || null;
    const blob = String((doc.body && (doc.body.innerText || doc.body.textContent)) || "");
    const url = pageUrl();
    const id = url ? (url.searchParams.get("appmsgid") || "") : "";
    const typeRaw = url ? url.searchParams.get("type") : "";
    const bodyText = body ? String(body.innerText || body.textContent || "") : "";
    return {
      ok: true,
      editorReady: fields.length >= 2,
      title: title ? String(title.innerText || title.textContent || "") : "",
      text: bodyText,
      topics: topicTexts(body),
      imageCount: imageCount(body),
      fileInputs: fileInputs().length,
      appmsgid: /^[0-9]+$/.test(id) ? id : "",
      type: typeRaw ? Number(typeRaw) : null,
      savedTime: savedClock(blob) || savedClock(bodyText),
      saved: /已保存/.test(blob) || /已保存/.test(bodyText),
      hasToken: Boolean(url && url.searchParams.get("token")),
    };
  }

  function focusCaret(el, { click } = {}) {
    if (!el) return false;
    if (click && typeof el.click === "function") el.click();
    if (typeof el.focus === "function") el.focus();
    const view = globalThis;
    if (typeof view.getSelection !== "function" || typeof doc.createRange !== "function") return true;
    try {
      const selection = view.getSelection();
      if (!selection) return true;
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Focus already happened. The caret move is best-effort.
    }
    return true;
  }

  if (op === "editor-state" || op === "read-editor") return editorState();

  if (op === "session-token") {
    const url = pageUrl();
    const host = url ? url.hostname : "";
    const token = url && /(^|\.)mp\.weixin\.qq\.com$/i.test(host) ? (url.searchParams.get("token") || "") : "";
    return { ok: true, token };
  }

  if (op === "focus-title") {
    const field = mirrors()[0];
    if (!field) return { ok: false, error: "title field not found" };
    focusCaret(field, { click: true });
    return { ok: true, text: String(field.innerText || field.textContent || ""), via: "click" };
  }

  if (op === "focus-body") {
    const field = mirrors()[1];
    if (!field) return { ok: false, error: "body field not found" };
    focusCaret(field, { click: false });
    return { ok: true, via: "focus" };
  }

  if (op === "click-save-draft") {
    const found = findExact("保存为草稿");
    if (!found) return { ok: false, error: "保存为草稿 not found" };
    const label = ownLabel(found);
    if (label !== "保存为草稿" || isForbidden(label)) {
      return { ok: false, forbidden: true, error: `refusing to click ${label || "保存为草稿"}` };
    }
    if (typeof found.click === "function") found.click();
    return { ok: true, via: "保存为草稿", label };
  }

  if (op === "draft-cards") {
    const rows = [];
    for (const el of qsa(doc, "a.weui-desktop-publish__cover__title")) {
      const title = normalize(el.innerText || el.textContent || "");
      if (!title || isForbidden(title)) continue;
      const attr = (el.getAttribute && (el.getAttribute("data-appmsgid") || el.getAttribute("data-id"))) || "";
      const href = (el.getAttribute && el.getAttribute("href")) || "";
      const fromHref = String(href).match(/[?&]appmsgid=(\d+)/);
      const id = /^[0-9]+$/.test(attr) ? attr : (fromHref ? fromHref[1] : "");
      let time = (el.getAttribute && el.getAttribute("data-time")) || "";
      let node = el;
      for (let depth = 0; depth < 6 && node && !time; depth += 1) {
        const blob = String(node.innerText || node.textContent || "");
        const matched = blob.match(/(\d{1,2}:\d{2})\s*已保存/) || blob.match(/\d{1,2}:\d{2}/);
        if (matched && blob !== title) time = matched[1] || matched[0];
        node = node.parentElement;
      }
      rows.push({ title, id, time });
      if (rows.length >= 30) break;
    }
    return { ok: true, rows };
  }

  if (op === "scroll") {
    const body = mirrors()[1] || doc.body;
    if (!body) return { ok: false, error: "nothing to scroll" };
    const height = body.scrollHeight || 2400;
    const top = input.where === "end" ? height : input.where === "middle" ? Math.floor(height / 2) : 0;
    body.scrollTop = top;
    return { ok: true, top };
  }

  return { ok: false, error: `unknown op ${op}` };
}
