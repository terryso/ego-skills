// Browser-side mp.weixin.qq.com actions.
// page.evaluate serializes mpAct alone. Every helper lives inside the function.
// Do not call module-level functions from it.

export function mpAct(payload) {
  const doc = globalThis.document;
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return { ok: false, error: "mpAct requires a document" };
  }
  const input = payload && typeof payload === "object" ? payload : {};
  const op = input.op || "probe";

  function qsa(root, selector) {
    const scope = root || doc;
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    try {
      return [...scope.querySelectorAll(selector)];
    } catch {
      return [];
    }
  }

  function qsaAny(selectors, root) {
    const out = [];
    for (const selector of selectors) out.push(...qsa(root, selector));
    return out;
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
    if (/发送预览|定时群发|定时发表/.test(label)) return true;
    return /群发|发表/.test(label);
  }

  function findExact(text) {
    const want = normalize(text);
    if (!want || isForbidden(want)) return null;
    const tags = { BUTTON: 0, A: 1, SPAN: 2, LI: 3, LABEL: 4, DIV: 5 };
    const found = qsaAny(["button", "a", "span", "li", "label", "div"]).filter((el) => (
      visible(el) && ownLabel(el) === want && !isForbidden(ownLabel(el))
    ));
    found.sort((left, right) => (tags[left.tagName] ?? 9) - (tags[right.tagName] ?? 9));
    return found[0] || null;
  }

  function bodyText() {
    return normalize((doc.body && (doc.body.innerText || doc.body.textContent)) || "");
  }

  function isAccountName(name) {
    const text = normalize(name);
    if (text.length < 2 || text.length > 32) return false;
    if (/扫一扫|请重新登录|登录超时|立即注册|微信公众平台/.test(text)) return false;
    if (/^(公众号|服务号|小程序|登录|首页|草稿箱|文章)$/.test(text)) return false;
    return true;
  }

  function namesFrom(selectors) {
    const values = [];
    for (const el of qsaAny(selectors)) {
      const fromAttr = el.getAttribute && (el.getAttribute("data-account-name") || el.getAttribute("data-nickname"));
      const text = normalize(fromAttr || el.innerText || el.textContent || "");
      if (isAccountName(text)) values.push(text);
    }
    return [...new Set(values)];
  }

  function collectAccounts() {
    const switched = namesFrom([
      "[class*='account-switch']",
      "[class*='switch-item']",
      "[data-account-name]",
    ]);
    if (switched.length) return { accounts: switched, ambiguous: switched.length > 1 };
    const nicknames = namesFrom([
      "[class*='weui-desktop-account__nickname']",
      "[class*='account-nickname']",
      "[class*='nickname']",
    ]);
    return { accounts: nicknames, ambiguous: nicknames.length > 1 };
  }

  function editorRoot() {
    for (const frame of qsa(doc, "iframe")) {
      const idoc = frame.contentDocument;
      const body = idoc && idoc.body;
      if (!body) continue;
      const editable = body.isContentEditable || (body.getAttribute && body.getAttribute("contenteditable") === "true");
      const marked = qsa(idoc, ".editor-body").length || qsa(idoc, ".ProseMirror").length;
      if (editable || marked) return { doc: idoc, body };
    }
    const marked = qsa(doc, ".ProseMirror")[0] || qsa(doc, ".editor-body")[0];
    if (marked) return { doc, body: marked };
    return null;
  }

  function titleField() {
    const fields = qsaAny(["textarea", "input", "[contenteditable='true']"]);
    return fields.find((el) => /标题/.test(
      (el.getAttribute && (el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-placeholder")))
      || el.placeholder
      || "",
    )) || null;
  }

  function fieldByHint(pattern) {
    return qsaAny(["textarea", "input"]).find((el) => pattern.test(
      `${(el.getAttribute && el.getAttribute("placeholder")) || ""} ${(el.getAttribute && el.getAttribute("aria-label")) || ""}`,
    )) || null;
  }

  function safeUrl() {
    try {
      const url = new URL(globalThis.location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|ticket|pass|cookie|session|key/i.test(key)) url.searchParams.set(key, "redacted");
      }
      return url.toString();
    } catch {
      return "";
    }
  }

  function imageCount() {
    const root = editorRoot();
    if (!root) return 0;
    return qsa(root.body, "img").filter((img) => {
      const src = (img.getAttribute && img.getAttribute("src")) || "";
      return src && src !== "about:blank";
    }).length;
  }

  function clickFound(el, via) {
    if (!el || typeof el.click !== "function") return { ok: false, error: "control not found" };
    const label = ownLabel(el);
    if (isForbidden(label)) return { ok: false, error: `refusing to click ${label}`, forbidden: true };
    el.click();
    return { ok: true, via, label };
  }

  function setValue(el, value) {
    if (!el) return { ok: false, error: "field not found" };
    try {
      const proto = el.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement : globalThis.HTMLInputElement;
      const desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch {
      el.value = value;
    }
    if (el.isContentEditable) el.textContent = value;
    if (typeof el.dispatchEvent === "function" && typeof globalThis.Event === "function") {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true };
  }

  if (op === "probe") {
    const account = collectAccounts();
    const text = bodyText();
    const loginWall = account.accounts.length === 0 && /扫一扫|请重新登录|登录超时|使用账号登录/.test(text);
    const loggedIn = !loginWall && (account.accounts.length > 0 || /新的创作|草稿箱|内容管理/.test(text));
    const root = editorRoot();
    return {
      ok: true,
      url: safeUrl(),
      title: doc.title || "",
      text: text.slice(0, 2000),
      loginWall,
      loggedIn,
      accounts: account.accounts,
      ambiguous: account.ambiguous,
      editorReady: Boolean(titleField() || root),
      imageCount: imageCount(),
    };
  }

  if (op === "click") {
    if (isForbidden(input.text)) return { ok: false, error: `refusing to click ${input.text}`, forbidden: true };
    const found = findExact(input.text);
    if (!found) return { ok: !input.required, error: input.required ? `${input.text} not found` : "", missing: !found };
    return clickFound(found, "text");
  }

  if (op === "title-field") {
    const field = titleField();
    if (!field) return { ok: false, error: "title field not found" };
    field.setAttribute("data-wx-article-title", "1");
    return { ok: true, selector: "[data-wx-article-title='1']" };
  }

  if (op === "set-title" || op === "set-digest" || op === "set-source") {
    const field = op === "set-title" ? titleField()
      : op === "set-digest" ? fieldByHint(/摘要/)
        : fieldByHint(/原文/);
    return setValue(field, input.value || "");
  }

  if (op === "focus-body") {
    const root = editorRoot();
    if (!root) return { ok: false, error: "editor body not found" };
    if (typeof root.body.focus === "function") root.body.focus();
    return { ok: true };
  }

  if (op === "open-image") {
    const titled = qsa(doc, "[title='图片']")[0] || qsa(doc, "[class*='insertimage']")[0];
    if (titled && visible(titled)) return clickFound(titled, "toolbar");
    return clickFound(findExact("图片"), "text");
  }

  if (op === "image-input") {
    const inputs = qsa(doc, "input").filter((el) => (el.getAttribute("type") || "") === "file" || el.type === "file");
    const images = inputs.filter((el) => /image|jpg|jpeg|png|webp|gif/i.test(el.getAttribute("accept") || "image"));
    const pool = images.length ? images : inputs;
    const field = pool[pool.length - 1];
    if (!field) return { ok: false, error: "image file input not found" };
    field.setAttribute("data-wx-article-file", "1");
    return { ok: true, selector: "input[data-wx-article-file='1']" };
  }

  if (op === "confirm-image") {
    const text = bodyText();
    if (!/选择图片|上传图片|插入图片|图片编辑/.test(text)) return { ok: true, confirmed: false };
    const button = findExact("确定") || findExact("确认") || findExact("插入");
    if (!button) return { ok: true, confirmed: false };
    button.click();
    return { ok: true, confirmed: true };
  }

  if (op === "image-count") return { ok: true, imageCount: imageCount() };

  if (op === "cover-state") {
    const text = bodyText();
    const present = /封面/.test(text);
    const filled = /已选择封面|封面已设置/.test(text) || qsa(doc, ".cover-preview img").length > 0;
    const empty = present && (/未选择|选择封面|从正文选择/.test(text)) && !filled;
    const file = qsa(doc, "input").find((el) => (
      (el.getAttribute("type") || "") === "file"
      && /cover|封面/.test(`${el.getAttribute("accept") || ""} ${el.getAttribute("class") || ""} ${el.className || ""}`)
    ));
    if (file) file.setAttribute("data-wx-article-cover", "1");
    return {
      ok: true,
      present,
      filled,
      empty,
      selector: file ? "input[data-wx-article-cover='1']" : "",
    };
  }

  if (op === "cover-from-body") {
    const button = findExact("从正文选择");
    if (!button) return { ok: false, error: "从正文选择 not found" };
    button.click();
    const root = editorRoot();
    const first = root && qsa(root.body, "img")[0];
    if (first && typeof first.click === "function") first.click();
    const confirm = findExact("确定") || findExact("确认");
    if (confirm) confirm.click();
    return { ok: true };
  }

  if (op === "click-save") {
    for (const label of ["保存草稿", "保存"]) {
      const found = findExact(label);
      if (found) return clickFound(found, "save");
    }
    return { ok: false, error: "保存 control not found" };
  }

  if (op === "click-preview") {
    if (isForbidden("预览")) return { ok: false, error: "refusing to click 预览", forbidden: true };
    const found = findExact("预览");
    if (!found) return { ok: false, error: "预览 control not found" };
    return clickFound(found, "preview");
  }

  if (op === "preview-state") {
    const pane = qsaAny([".preview-phone", ".rich_media_preview", ".mobile-preview"]).some(visible);
    return { ok: true, pane, button: Boolean(findExact("预览")) };
  }

  if (op === "read-editor") {
    const root = editorRoot();
    const field = titleField();
    const title = field ? (field.value || field.innerText || field.textContent || "") : "";
    const hrefs = root ? qsa(root.body, "a").map((el) => el.getAttribute && el.getAttribute("href")).filter(Boolean) : [];
    return {
      ok: true,
      title: normalize(title),
      text: root ? (root.body.innerText || root.body.textContent || "") : "",
      imageCount: imageCount(),
      hrefs,
    };
  }

  if (op === "draft-rows") {
    const nodes = qsaAny([".draft-title", ".weui-desktop-card__title", ".card_appmsg_title", ".appmsg_title"]);
    const rows = [];
    for (const el of nodes) {
      const title = normalize(el.getAttribute && el.getAttribute("data-draft-title") || el.innerText || el.textContent || "");
      if (!title || isForbidden(title)) continue;
      const parent = el.parentElement;
      const parentText = parent ? String(parent.innerText || parent.textContent || "") : "";
      const timeLine = parentText.split(/\n/).map((line) => line.trim()).find((line) => (
        line && line !== title && /月|今天|昨天|\d{2}:\d{2}|\d{4}-\d{2}/.test(line)
      )) || "";
      const rawId = (el.getAttribute && (el.getAttribute("data-id") || el.getAttribute("data-appmsgid"))) || "";
      rows.push({
        title,
        time: (el.getAttribute && el.getAttribute("data-time")) || timeLine,
        id: /^[0-9]+$/.test(rawId) ? rawId : "",
      });
      if (rows.length >= 30) break;
    }
    return { ok: true, rows };
  }

  if (op === "scroll") {
    const root = editorRoot();
    const node = (root && root.body) || doc.body;
    if (!node) return { ok: false, error: "nothing to scroll" };
    const height = node.scrollHeight || 2400;
    const top = input.where === "end" ? height : input.where === "middle" ? Math.floor(height / 2) : 0;
    if (typeof node.scrollTo === "function") node.scrollTo(0, top);
    node.scrollTop = top;
    return { ok: true, top };
  }

  if (op === "clear-unload") {
    globalThis.onbeforeunload = null;
    return { ok: true };
  }

  return { ok: false, error: `unknown op ${op}` };
}
