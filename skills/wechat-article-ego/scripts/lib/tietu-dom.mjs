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

  function redactedHref() {
    const url = pageUrl();
    if (!url) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|pass|cookie|session|key/i.test(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
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

  function styleImage(el) {
    const style = `${(el.getAttribute && el.getAttribute("style")) || ""} ${(el.style && el.style.backgroundImage) || ""}`;
    return /background-image\s*:\s*url\(/i.test(style) || /url\((['"]?)(?!about:blank)[^)]+\1\)/i.test(style);
  }

  function thumbCount(root) {
    if (!root) return 0;
    let count = imageCount(root);
    count += qsa(root, "canvas").length;
    for (const el of qsa(root, "*")) {
      if (styleImage(el)) count += 1;
    }
    return count;
  }

  function uploaderRoot(inputEl) {
    if (!inputEl) return doc.body || null;
    let node = inputEl;
    let fallback = inputEl.parentElement || inputEl;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      const cls = `${node.className || ""} ${node.id || ""}`;
      if (node !== inputEl && /upload|image|picture|photo|thumb|cover|pic|media/i.test(cls)) return node;
      if (node.parentElement && node.parentElement !== doc.body) fallback = node.parentElement;
      node = node.parentElement;
    }
    return fallback;
  }

  function placeholderVisible(root) {
    if (!root || thumbCount(root) > 0) return false;
    const text = normalize(root.innerText || root.textContent || "");
    if (/选择或拖拽|拖拽|上传图片|添加图片|选择图片|点击上传|暂无图片/.test(text)) return true;
    return qsaAny(["[class*='placeholder']", "[class*='empty']"], root).some((el) => visible(el));
  }

  function resourceUploads() {
    let count = Number(input.networkHits) || 0;
    try {
      const entries = globalThis.performance && typeof globalThis.performance.getEntries === "function"
        ? globalThis.performance.getEntries()
        : [];
      for (const entry of entries) {
        if (/filetransfer|uploadimg/i.test(String(entry && entry.name || ""))) count += 1;
      }
    } catch {
      // performance entries are optional.
    }
    return count;
  }

  function baseName(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const parts = text.split(/[/\\]/);
    return parts[parts.length - 1] || text;
  }

  function inputSnapshot(el, index) {
    const files = el && el.files && typeof el.files.length === "number" ? el.files.length : 0;
    return {
      index,
      accept: String((el.getAttribute && el.getAttribute("accept")) || el.accept || ""),
      id: String(el.id || ""),
      className: String(el.className || "").slice(0, 120),
      value: baseName(el.value),
      files,
      childCount: (el.childNodes || []).length,
    };
  }

  function collectText(el) {
    if (!el) return "";
    if (el.nodeType === 3) return String(el.textContent || "");
    const own = String(el.text || "");
    const kids = (el.childNodes || []).map((child) => collectText(child)).join(" ");
    if (own && kids && !own.includes(kids)) return `${own} ${kids}`;
    return own || kids || String(el.innerText || el.textContent || "");
  }

  function htmlOf(el) {
    if (!el) return "";
    if (typeof el.outerHTML === "string" && el.outerHTML) return el.outerHTML;
    const tag = String(el.tagName || "div").toLowerCase();
    const cls = el.className ? ` class="${String(el.className).replace(/"/g, "")}"` : "";
    const accept = el.getAttribute && el.getAttribute("accept");
    const acc = accept ? ` accept="${accept}"` : "";
    return `<${tag}${cls}${acc}>${collectText(el).slice(0, 1500)}</${tag}>`;
  }

  function mediaSrc(el) {
    const attr = String((el.getAttribute && el.getAttribute("src")) || "");
    if (attr && attr !== "about:blank") return attr;
    const style = `${(el.getAttribute && el.getAttribute("style")) || ""} ${(el.style && el.style.backgroundImage) || ""}`;
    const matched = style.match(/url\((['"]?)(.*?)\1\)/i);
    const url = matched && matched[2];
    if (url && url !== "about:blank") return url;
    return "";
  }

  function srcKey(src) {
    try {
      const url = new URL(src);
      if (url.protocol === "blob:" || url.protocol === "data:") return src;
      return `${url.origin}${url.pathname}`;
    } catch {
      return String(src || "").split("?")[0];
    }
  }

  function distinctCount(nodes) {
    const srcs = new Set();
    for (const el of nodes || []) {
      const src = mediaSrc(el);
      if (src) srcs.add(srcKey(src));
    }
    return srcs.size;
  }

  // Preview and the image strip show the same uploads again, and the left card
  // adds another mmbiz <img>. Count distinct content srcs inside .image-selector
  // only. Never scan the whole page for mmbiz.
  function selectorImages() {
    const roots = qsa(doc, ".image-selector");
    const preview = qsa(doc, ".image-selector__preview-center-img");
    if (!roots.length && !preview.length) return null;
    const nodes = [...preview];
    for (const root of roots) {
      nodes.push(...qsa(root, "img"));
      for (const el of qsa(root, "*")) {
        if (styleImage(el)) nodes.push(el);
      }
    }
    return nodes;
  }

  function cdnNodes(nodes) {
    return (nodes || []).filter((el) => /mmbiz\.qpic\.cn|mmbiz/i.test(mediaSrc(el)));
  }

  function cdnContentCount() {
    const structured = selectorImages();
    if (!structured) return 0;
    return distinctCount(cdnNodes(structured));
  }

  function visibleImageCount() {
    const structured = selectorImages();
    if (structured) return cdnContentCount();
    const nodes = [...qsa(mirrors()[1], "img")];
    const region = uploaderRoot(fileInputs()[1] || fileInputs()[0]);
    if (region && region !== doc.body) nodes.push(...qsa(region, "img"));
    return distinctCount(nodes);
  }

  function uploadProbe() {
    const inputs = fileInputs();
    const listed = inputs.map((el, index) => inputSnapshot(el, index + 1));
    const chosen = inputs[1] || null;
    const region = uploaderRoot(chosen || inputs[0]);
    const chosenSnap = chosen ? inputSnapshot(chosen, 2) : null;
    return {
      ok: true,
      fileInputs: listed,
      chosenIndex: chosen ? 2 : 0,
      chosenAccept: chosenSnap ? chosenSnap.accept : "",
      imageCount: visibleImageCount(),
      cdnImageCount: cdnContentCount(),
      thumbCount: thumbCount(region),
      inputValue: chosenSnap ? chosenSnap.value : "",
      inputChildren: chosenSnap ? chosenSnap.childCount + chosenSnap.files : 0,
      placeholder: placeholderVisible(region),
      uploadResponses: resourceUploads(),
      outerHTML: htmlOf(region),
    };
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
      imageCount: visibleImageCount(),
      fileInputs: fileInputs().length,
      appmsgid: /^[0-9]+$/.test(id) ? id : "",
      type: typeRaw ? Number(typeRaw) : null,
      savedTime: savedClock(blob) || savedClock(bodyText),
      toastText: (String(blob).match(/\d{1,2}:\d{2}\s*已保存/) || String(bodyText).match(/\d{1,2}:\d{2}\s*已保存/) || [])[0]
        || (/已保存/.test(blob) || /已保存/.test(bodyText) ? "已保存" : ""),
      saved: /已保存/.test(blob) || /已保存/.test(bodyText),
      hasToken: Boolean(url && url.searchParams.get("token")),
      url: redactedHref(),
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

  if (op === "find-save-draft" || op === "click-save-draft") {
    const found = findExact("保存为草稿");
    if (!found) return { ok: false, error: "保存为草稿 not found" };
    const label = ownLabel(found);
    if (label !== "保存为草稿" || isForbidden(label)) {
      return { ok: false, forbidden: true, error: `refusing to click ${label || "保存为草稿"}` };
    }
    if (op === "click-save-draft" && typeof found.click === "function") found.click();
    return { ok: true, via: op === "click-save-draft" ? "保存为草稿" : "find", label, clicked: op === "click-save-draft" };
  }

  function domCards() {
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
      let itemShowType = null;
      let typed = el;
      for (let depth = 0; depth < 6 && typed && itemShowType == null; depth += 1) {
        const attr = typed.getAttribute && (
          typed.getAttribute("data-item_show_type")
          || typed.getAttribute("data-item-show-type")
          || typed.getAttribute("item_show_type")
        );
        const href = (typed.getAttribute && typed.getAttribute("href")) || "";
        const fromHref = String(href).match(/item_show_type=(\d+)/);
        if (attr != null && /^\d+$/.test(String(attr))) itemShowType = Number(attr);
        else if (fromHref) itemShowType = Number(fromHref[1]);
        typed = typed.parentElement;
      }
      rows.push({ title, id, time, itemShowType });
      if (rows.length >= 30) break;
    }
    return rows;
  }

  function numericId(value) {
    return /^[0-9]+$/.test(String(value || "")) ? String(value) : "";
  }

  function pushItems(value, out, depth) {
    if (!value || depth > 5 || out.length >= 30) return;
    if (typeof value === "string") {
      try { pushItems(JSON.parse(value), out, depth + 1); } catch { /* not JSON */ }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) pushItems(item, out, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const id = numericId(value.appmsgid || value.appMsgId || value.app_msg_id || value.app_id);
    if (id && (value.title || value.item_show_type != null || value.itemShowType != null)) {
      const show = value.item_show_type != null ? value.item_show_type : value.itemShowType;
      out.push({
        id,
        title: normalize(value.title || value.appmsg_title || ""),
        time: "",
        itemShowType: show == null || show === "" || !Number.isFinite(Number(show)) ? null : Number(show),
      });
    }
    for (const key of ["item", "items", "list", "multi_item", "app_msg_info", "app_msg_list", "cgiData"]) {
      if (value[key] != null) pushItems(value[key], out, depth + 1);
    }
  }

  function embeddedItems() {
    const out = [];
    const view = globalThis;
    const bags = [view.wx && view.wx.cgiData, view.cgiData];
    for (const bag of bags) pushItems(bag, out, 0);
    return out;
  }

  function withDomTitles(dataRows) {
    const dom = domCards();
    return dataRows.map((row, index) => ({
      ...row,
      title: row.title || (dom[index] && dom[index].title) || "",
      time: row.time || (dom[index] && dom[index].time) || "",
    }));
  }

  if (op === "draft-cards") {
    return { ok: true, rows: domCards() };
  }

  if (op === "draft-list") {
    const embedded = embeddedItems();
    if (embedded.some((row) => row.id)) {
      return { ok: true, source: "cgiData", rows: withDomTitles(embedded) };
    }
    const dom = domCards();
    if (dom.some((row) => row.id)) return { ok: true, source: "dom", rows: dom };
    let href = "";
    try { href = String(globalThis.location && globalThis.location.href || ""); } catch { href = ""; }
    if (!href || typeof globalThis.fetch !== "function") return { ok: true, source: "dom", rows: dom };
    let target = "";
    try {
      const url = new URL(href);
      url.searchParams.set("f", "json");
      url.searchParams.set("ajax", "1");
      target = url.toString();
    } catch {
      return { ok: true, source: "dom", rows: dom };
    }
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(8000)
      : undefined;
    return Promise.resolve(globalThis.fetch(target, { credentials: "same-origin", signal })).then((res) => {
      if (!res || typeof res.json !== "function") return { ok: true, source: "dom", rows: dom };
      return Promise.resolve(res.json()).then((json) => {
        const parsed = [];
        pushItems(json, parsed, 0);
        if (!parsed.some((row) => row.id)) return { ok: true, source: "dom", rows: dom };
        return { ok: true, source: "json", rows: withDomTitles(parsed) };
      });
    }).catch(() => ({ ok: true, source: "dom", rows: dom }));
  }

  if (op === "install-save-hook" || op === "read-saves") {
    const view = globalThis;
    const publicUrl = (url) => String(url || "")
      .replace(/([?&#])(token|ticket|pass_ticket|cookie|session|key)=[^&#]*/gi, "$1$2=redacted")
      .slice(0, 240);
    const frameOf = () => {
      let top = false;
      try { top = view === view.top; } catch { top = false; }
      let href = "";
      try { href = publicUrl(view.location && view.location.href); } catch { href = ""; }
      return { top, name: String(view.name || ""), href };
    };
    const noteUrl = (url) => {
      try {
        view.__egoRecent = view.__egoRecent || [];
        view.__egoRecent.push({ at: Date.now(), url: publicUrl(url) });
        if (view.__egoRecent.length > 20) view.__egoRecent.splice(0, view.__egoRecent.length - 20);
      } catch {
        // The ring is diagnostic. A full store must not break the request.
      }
    };
    const status = () => ({
      ok: true,
      installed: Boolean(view.__egoSavesInstalled),
      installedAt: view.__egoSavesInstalledAt || 0,
      hookId: view.__egoHookId || "",
      frame: frameOf(),
      recentUrls: (view.__egoRecent || []).slice(-20),
      saves: Array.isArray(view.__egoSaves) ? view.__egoSaves.slice() : [],
    });
    if (op === "read-saves") return status();
    if (view.__egoSavesInstalled) return { ...status(), already: true };
    view.__egoSaves = [];
    view.__egoRecent = [];
    view.__egoHookId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    view.__egoSavesInstalledAt = Date.now();
    const remember = (entry) => {
      try { view.__egoSaves.push(entry); } catch { /* the page store is best-effort */ }
    };
    const asText = (body) => (typeof body === "string" ? body.slice(0, 8000) : "");
    const XHR = view.XMLHttpRequest;
    if (!view.__egoXhrWrapped && XHR && XHR.prototype && typeof XHR.prototype.open === "function" && typeof XHR.prototype.send === "function") {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      view.__egoXhrWrapped = true;
      XHR.prototype.open = function egoOpen(method, url) {
        this.__egoUrl = String(url || "");
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function egoSend(body) {
        const url = String(this.__egoUrl || "");
        noteUrl(url);
        const text = asText(body);
        if (/operate_appmsg/i.test(url)) {
          remember({ at: Date.now(), url, phase: "request", body: text });
          const xhr = this;
          const done = () => {
            let ret = null;
            let appMsgId = "";
            try {
              const json = JSON.parse(String(xhr.responseText || ""));
              ret = json && json.ret != null ? json.ret : null;
              appMsgId = String((json && (json.appMsgId || json.appmsgid)) || "");
            } catch {
              // The response was not JSON.
            }
            remember({ at: Date.now(), url, phase: "response", body: text, ret, appMsgId });
          };
          if (typeof xhr.addEventListener === "function") xhr.addEventListener("load", done);
        }
        return origSend.apply(this, arguments);
      };
    }
    if (typeof view.fetch === "function" && !view.__egoFetchWrapped) {
      const origFetch = view.fetch;
      view.__egoFetchWrapped = true;
      view.fetch = function egoFetch(inputArg, init) {
        const url = typeof inputArg === "string" ? inputArg : String((inputArg && inputArg.url) || "");
        noteUrl(url);
        const text = asText(init && init.body);
        const watched = /operate_appmsg/i.test(url);
        if (watched) remember({ at: Date.now(), url, phase: "request", body: text });
        return Promise.resolve(origFetch.apply(this, arguments)).then((response) => {
          if (!watched || !response || typeof response.clone !== "function") return response;
          const read = typeof response.clone().json === "function" ? response.clone().json() : Promise.resolve(null);
          return Promise.resolve(read).then((json) => {
            remember({
              at: Date.now(),
              url,
              phase: "response",
              body: text,
              ret: json && json.ret != null ? json.ret : null,
              appMsgId: String((json && (json.appMsgId || json.appmsgid)) || ""),
            });
            return response;
          }).catch(() => response);
        });
      };
    }
    view.__egoSavesInstalled = true;
    return status();
  }

  if (op === "upload-probe") return uploadProbe();

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
