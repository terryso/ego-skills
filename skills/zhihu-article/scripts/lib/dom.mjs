// Browser-side visible actions for a Zhihu article editor.
// page.evaluate serializes zhihuAct alone. Helpers stay inside the function.

export function zhihuAct(payload) {
  const doc = globalThis.document;
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return { ok: false, error: "zhihuAct requires a document" };
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

  function attr(el, name) {
    if (!el || typeof el.getAttribute !== "function") return "";
    return el.getAttribute(name) || "";
  }

  function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === "function") return el.hasAttribute(name);
    return attr(el, name) !== "";
  }

  function hidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (hasAttr(el, "hidden")) return true;
    if (attr(el, "aria-hidden") === "true") return true;
    if (hasAttr(el, "disabled")) return true;
    return false;
  }

  function shown(el) {
    if (hidden(el)) return false;
    if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
    if (typeof el.getBoundingClientRect === "function") {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
    }
    return true;
  }

  function ownLabel(el) {
    const direct = [...(el.childNodes || [])]
      .filter((node) => node && node.nodeType === 3)
      .map((node) => node.textContent || "")
      .join("");
    const raw = direct.trim() || el.innerText || el.textContent || "";
    return normalize(raw);
  }

  function hintOf(el) {
    return normalize([
      el.placeholder,
      attr(el, "placeholder"),
      attr(el, "aria-label"),
      attr(el, "data-placeholder"),
      attr(el, "name"),
      el.id,
      el.className,
    ].filter(Boolean).join(" "));
  }

  function contains(root, node) {
    let current = node;
    while (current) {
      if (current === root) return true;
      current = current.parentElement;
    }
    return false;
  }

  function hrefOf() {
    const loc = globalThis.location;
    return loc && loc.href ? String(loc.href) : "";
  }

  function redact(value) {
    try {
      const url = new URL(String(value), "https://www.zhihu.com");
      for (const key of [...url.searchParams.keys()]) {
        if (/token|ticket|pass|cookie|session|key|auth|code/i.test(key)) url.searchParams.set(key, "redacted");
      }
      return url.toString();
    } catch {
      return "";
    }
  }

  function draftIdsIn(value) {
    const text = String(value || "");
    const found = new Set();
    const pattern = /\/p\/(\d{1,20})\/edit(?:[?#]|$)/g;
    let match = pattern.exec(text);
    while (match) {
      found.add(match[1]);
      match = pattern.exec(text);
    }
    return [...found];
  }

  function published(value) {
    const text = String(value || "");
    if (/\/p\/\d{1,20}\/edit(?:[?#]|$)/.test(text)) return false;
    return /\/p\/\d{1,20}(?:[?#]|$)/.test(text);
  }

  function findTitle() {
    const nodes = qsaAny(["textarea", "input"]);
    for (const el of nodes) {
      if (!shown(el)) continue;
      const type = (attr(el, "type") || el.type || "").toLowerCase();
      if (el.tagName === "INPUT" && type && type !== "text") continue;
      const hint = hintOf(el);
      if (hint.includes("标题") && !hint.includes("回答") && !hint.includes("想法") && !hint.includes("评论")) return el;
    }
    return null;
  }

  function areaOf(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function findBodies(title) {
    const nodes = qsaAny(["div", "textarea"]);
    const found = [];
    for (const el of nodes) {
      if (el === title || !shown(el) || inAssistant(el)) continue;
      const editable = Boolean(el.isContentEditable) || attr(el, "contenteditable") === "true";
      if (!editable) continue;
      found.push(el);
    }
    const article = found.filter((el) => /public-DraftEditor-content/.test(String(el.className || "")));
    if (article.length === 1) return article;
    const hinted = (article.length ? article : found).filter((el) => /DraftEditor|Editable-content|public-Draft/i.test(String(el.className || "")));
    const pool = hinted.length ? hinted : found;
    const placeholder = pool.filter((el) => /请输入正文/.test(`${hintOf(el)} ${ownLabel(el)}`));
    if (placeholder.length === 1) return placeholder;
    if (pool.length <= 1) return pool;
    const ranked = [...pool].sort((left, right) => areaOf(right) - areaOf(left));
    if (areaOf(ranked[0]) > areaOf(ranked[1]) * 1.5) return [ranked[0]];
    return pool;
  }

  function directText(el) {
    return normalize([...(el && el.childNodes || [])]
      .filter((node) => node && node.nodeType === 3)
      .map((node) => node.textContent || "")
      .join(""));
  }

  function elementChildren(el) {
    return [...(el && el.childNodes || [])].filter((node) => node && node.nodeType === 1);
  }

  function controlName(el) {
    if (!el || el.nodeType !== 1) return "";
    const aria = normalize(attr(el, "aria-label"));
    if (aria) return aria;
    const title = normalize(attr(el, "title"));
    if (title) return title;
    const direct = directText(el);
    if (direct) return direct;
    const textual = el.tagName === "BUTTON" || el.tagName === "LABEL" || el.tagName === "A" || attr(el, "role") === "button";
    if (!textual) return "";
    const text = normalize(el.innerText || el.textContent || "");
    if (!text || [...text].length > 12) return "";
    return text;
  }

  function selfMarksAssistant(el) {
    const aria = normalize(attr(el, "aria-label"));
    const cls = String(el.className || "");
    if (/创作助手/.test(aria) || /CreationAssistant|assistant-panel/i.test(cls)) return true;
    const direct = directText(el);
    return direct === "创作助手" || direct === "AI 配图" || /AI\s*配图/.test(direct);
  }

  function subtreeHasImageAnchor(root) {
    const nodes = [root, ...qsaAny(["button", "a", "label", "div", "span"], root)];
    return nodes.some((el) => controlName(el) === "图片");
  }

  function inAssistant(el) {
    let current = el && el.parentElement;
    while (current && current.tagName !== "BODY") {
      if (selfMarksAssistant(current)) return true;
      const marker = elementChildren(current).find((kid) => !contains(kid, el) && selfMarksAssistant(kid));
      if (marker && !subtreeHasImageAnchor(current)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function acceptsImages(el) {
    const accept = (attr(el, "accept") || el.accept || "").toLowerCase();
    if (!accept) return false;
    return /image\/|\.png|\.jpe?g|\.webp/.test(accept);
  }

  function excludedName(name) {
    return /附件|导入|视频|AI\s*配图|创作助手|发布设置|封面|题图/.test(String(name || ""));
  }

  function fileInputsUnder(root) {
    return fileInputs().filter((el) => !root || el === root || contains(root, el));
  }

  function namedControlsUnder(root) {
    return qsaAny(["button", "a", "label", "div", "span"], root).filter((el) => controlName(el));
  }

  function ownerName(el) {
    const own = controlName(el);
    if (own) return own;
    let current = el.parentElement;
    for (let depth = 0; depth < 8 && current && current.tagName !== "BODY"; depth += 1) {
      const wrapped = current.tagName === "BUTTON" || current.tagName === "LABEL" || current.tagName === "A" || attr(current, "role") === "button";
      if (wrapped && controlName(current)) return controlName(current);
      if (fileInputsUnder(current).length === 1) {
        const names = [...new Set(namedControlsUnder(current).map((node) => controlName(node)).filter(Boolean))];
        if (names.length === 1) return names[0];
      }
      current = current.parentElement;
    }
    return "";
  }

  function isCoverInput(el) {
    const blob = `${el.className || ""} ${hintOf(el)} ${ownerName(el)} ${controlName(el)}`;
    return /封面|题图|UploadPicture|cover/i.test(blob);
  }

  function exactImageAnchors(root) {
    const nodes = qsaAny(["button", "a", "label", "div", "span"], root).filter((el) => (
      controlName(el) === "图片" && shown(el) && !inAssistant(el)
    ));
    return nodes.filter((el) => !nodes.some((other) => other !== el && contains(other, el)));
  }

  function toolbarImageSignature(el) {
    const accept = (attr(el, "accept") || el.accept || "").toLowerCase().trim();
    const multiple = hasAttr(el, "multiple") || el.multiple === true;
    return multiple && /^image\/webp\b/.test(accept);
  }

  function imageInputsForAnchor(anchor, pool) {
    const inside = pool.filter((el) => contains(anchor, el));
    if (inside.length >= 1) return inside;
    let current = anchor.parentElement;
    for (let depth = 0; depth < 10 && current; depth += 1) {
      if (exactImageAnchors(current).length !== 1) break;
      const candidates = pool.filter((el) => contains(current, el));
      if (candidates.length === 1) return candidates;
      if (candidates.length > 1) {
        const signed = candidates.filter(toolbarImageSignature);
        return signed.length === 1 ? signed : candidates;
      }
      if (current.tagName === "BODY") break;
      current = current.parentElement;
    }
    return [];
  }

  function bodyImageInputs(files) {
    const pool = files.filter((el) => (
      acceptsImages(el)
      && !inAssistant(el)
      && !isCoverInput(el)
      && !excludedName(ownerName(el))
      && !excludedName(controlName(el))
    ));
    const owned = pool.filter((el) => controlName(el) === "图片" || ownerName(el) === "图片");
    if (owned.length >= 1) return owned;
    const anchors = exactImageAnchors();
    if (anchors.length !== 1) return [];
    return imageInputsForAnchor(anchors[0], pool);
  }

  function fileInputs() {
    return qsaAny(["input"]).filter((el) => {
      const type = (attr(el, "type") || el.type || "").toLowerCase();
      return type === "file" && !hasAttr(el, "disabled");
    });
  }

  function mark(el, name) {
    if (!el || typeof el.setAttribute !== "function") return "";
    qsaAny(["textarea", "input", "div", "button", "a"]).forEach((node) => {
      if (attr(node, name)) node.setAttribute(name, "");
    });
    el.setAttribute(name, "1");
    return `[${name}="1"]`;
  }

  function buttonLabel(el) {
    return normalize(attr(el, "aria-label") || ownLabel(el));
  }

  function isPublish(label) {
    const text = normalize(label);
    if (!text || text.includes("发布设置")) return false;
    if (text === "发布" || text === "发表") return true;
    return /定时/.test(text) && /发布|发表/.test(text);
  }

  function isPreviewInvite(label) {
    return label.includes("邀请预览");
  }

  function visibleButtons() {
    return qsaAny(["button", "a"]).filter((el) => shown(el));
  }

  function savedStamp(label) {
    const text = normalize(label);
    if (!text || text.length > 40 || text.includes("发布")) return "";
    if (text === "已保存" || text === "草稿已保存" || /已保存$/.test(text)) return text;
    if (/^(刚刚|\d+分钟前|\d+小时前)\s*·\s*草稿$/.test(text)) return text;
    return "";
  }

  function autosaveBadge(editor) {
    const nodes = qsaAny(["header", "div", "span", "p", "strong"]);
    for (const el of nodes) {
      if (editor && contains(editor, el)) continue;
      const label = savedStamp(ownLabel(el));
      if (label) return label;
    }
    return "";
  }

  function insideMain(el) {
    let current = el;
    while (current) {
      if (current.tagName === "MAIN") return true;
      current = current.parentElement;
    }
    return false;
  }

  function isIdentityRoot(el) {
    if (!el || insideMain(el)) return false;
    const cls = String(el.className || "");
    if (/zhihuLogo/i.test(cls)) return false;
    if (el.tagName === "HEADER") return true;
    if (attr(el, "role") === "banner") return true;
    if (/(?:^|\s)AppHeader(?:\s|$)/.test(cls)) return true;
    return /AppHeader-profileAvatar|(?:^|\s)profileAvatar(?:\s|$)/i.test(cls);
  }

  function identityRoots() {
    const found = qsaAny(["header", "nav", "div", "a", "img", "button"]).filter(isIdentityRoot);
    return found.filter((el) => !found.some((other) => other !== el && contains(other, el)));
  }

  function isPersonName(value) {
    const text = normalize(value);
    if (!text || [...text].length > 32) return false;
    if (/登录|注册|首页|消息|私信|创作|直答|搜索|草稿|推荐|热榜/.test(text)) return false;
    if (/点击打开|的主页|阅读全文|写回答|写文章|发想法/.test(text)) return false;
    return true;
  }

  function identityPhrase(value) {
    const text = normalize(value);
    const opened = text.match(/^点击打开\s*(.+?)\s*的主页$/);
    if (!opened || !isPersonName(opened[1])) return "";
    return opened[1];
  }

  function nameFromControl(el) {
    const hints = [attr(el, "aria-label"), attr(el, "alt"), attr(el, "title"), ownLabel(el)];
    for (const hint of hints) {
      const parsed = identityPhrase(hint);
      if (parsed) return parsed;
    }
    const href = attr(el, "href") || attr(el, "data-href");
    const parentHref = el.parentElement ? (attr(el.parentElement, "href") || "") : "";
    const profile = /\/people\//.test(href) || /\/people\//.test(parentHref);
    if (!profile) return "";
    const text = ownLabel(el) || normalize(attr(el, "alt"));
    return isPersonName(text) ? text : "";
  }

  function accountNames(roots) {
    const names = [];
    for (const root of roots) {
      const nodes = [root, ...qsaAny(["a", "button", "img"], root)];
      for (const el of nodes) {
        if (!shown(el) || insideMain(el)) continue;
        const name = nameFromControl(el);
        if (name) names.push(name);
      }
    }
    return [...new Set(names)];
  }

  function loggedInChrome(roots) {
    for (const root of roots) {
      for (const el of qsaAny(["a", "button", "img"], root)) {
        if (!shown(el) || insideMain(el)) continue;
        const label = normalize(attr(el, "aria-label") || attr(el, "alt") || ownLabel(el));
        if (label === "创作中心" || label === "私信" || label === "消息" || label.startsWith("创作中心")) return true;
        if (/AppHeader-profileAvatar|(?:^|\s)Avatar(?:\s|$)/.test(String(el.className || ""))) return true;
        if (el.tagName === "IMG" && /avatar|profile/i.test(`${el.className || ""} ${label}`)) return true;
      }
    }
    return false;
  }

  function surfaceOf(url, title, body) {
    let path = "";
    let hostOk = false;
    try {
      const parsed = new URL(url, "https://www.zhihu.com");
      path = parsed.pathname;
      hostOk = parsed.hostname === "zhihu.com" || parsed.hostname.endsWith(".zhihu.com");
    } catch {
      path = "";
    }
    if (/\/(signin|signup|login)(?:\/|$)/.test(path)) return "signin";
    const titleHint = title ? hintOf(title) : "";
    const bodyHint = body ? hintOf(body) : "";
    const answer = /写回答|回答问题/.test(titleHint) || /写回答/.test(bodyHint) || /\/question\//.test(path);
    const idea = /想法/.test(titleHint) || /\/pin(?:\/|$)/.test(path);
    const comment = /评论/.test(titleHint) || /写评论/.test(bodyHint);
    const articlePath = path === "/write" || /\/p\/\d{1,20}\/edit$/.test(path);
    const article = Boolean(title && body && articlePath && hostOk);
    const extras = [answer && "answer", idea && "idea", comment && "comment"].filter(Boolean);
    if (article && extras.length) return "mixed";
    if (article) return "article";
    if (answer) return "answer";
    if (idea) return "idea";
    if (comment) return "comment";
    if (hostOk) return "home";
    return "other";
  }

  function srcOf(el) {
    return attr(el, "src") || (el && el.src) || "";
  }

  function schemeHost(src) {
    if (String(src).startsWith("blob:")) return { scheme: "blob", host: "" };
    if (String(src).startsWith("data:")) return { scheme: "data", host: "" };
    try {
      const url = new URL(src, "https://www.zhihu.com");
      return { scheme: url.protocol.replace(":", ""), host: url.host };
    } catch {
      return { scheme: "other", host: "" };
    }
  }

  function inCoverWidget(el, editor) {
    let current = el;
    for (let depth = 0; depth < 6 && current && current !== editor && current.tagName !== "BODY"; depth += 1) {
      const blob = `${current.className || ""} ${hintOf(current)} ${directText(current)}`;
      if (/封面|题图|UploadPicture|添加封面/.test(blob) || /(?:^|[^a-z])cover(?:[^a-z]|$)/i.test(blob)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function sourceFingerprint(src) {
    const located = schemeHost(src);
    let path = "";
    try {
      path = new URL(src, "https://www.zhihu.com").pathname || "";
    } catch {
      path = "";
    }
    const basis = `${located.scheme}://${located.host}${path}`;
    let hash = 2166136261;
    for (let index = 0; index < basis.length; index += 1) {
      hash ^= basis.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return {
      scheme: located.scheme,
      host: located.host,
      path: path.slice(0, 120),
      fingerprint: (hash >>> 0).toString(16).padStart(8, "0"),
    };
  }

  function boxOf(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return { width: 0, height: 0 };
    const box = el.getBoundingClientRect();
    return { width: Math.round(box.width || 0), height: Math.round(box.height || 0) };
  }

  function contentBlockNodes(editor) {
    const marked = qsa(editor, "[data-block='true']");
    if (marked.length) return marked.slice(0, 80);
    const semantic = qsaAny(["h1", "h2", "h3", "p", "li", "figure", "blockquote"], editor);
    return semantic.filter((el) => !semantic.some((other) => other !== el && contains(other, el))).slice(0, 80);
  }

  function blockRecord(el) {
    const nested = /^(H1|H2|H3|P|LI|FIGURE|BLOCKQUOTE)$/.test(String(el.tagName || ""))
      ? el
      : qsaAny(["h1", "h2", "h3", "p", "li", "figure", "blockquote"], el)[0];
    const tagSource = nested || el;
    return {
      tag: String(tagSource.tagName || ""),
      offsetKey: attr(el, "data-offset-key").slice(0, 48),
      text: normalize(el.innerText || el.textContent).slice(0, 80),
    };
  }

  function blockIndexFor(el, blocks) {
    let current = el;
    while (current) {
      if (attr(current, "data-block") === "true") {
        const key = attr(current, "data-offset-key");
        const index = blocks.findIndex((block) => block.offsetKey && block.offsetKey === key);
        return index;
      }
      current = current.parentElement;
    }
    return -1;
  }

  function imageRecord(el, editor, blocks) {
    const src = srcOf(el);
    const located = sourceFingerprint(src);
    const pending = insidePendingUpload(el);
    const cover = inCoverWidget(el, editor);
    let role = "ignored";
    if (!src || src.startsWith("data:image/svg")) role = "ignored";
    else if (pending) role = "pending";
    else if (cover) role = "cover-widget";
    else if (located.scheme === "http" || located.scheme === "https" || located.scheme === "blob") role = "body";
    const ancestors = [];
    let current = el.parentElement;
    for (let depth = 0; depth < 6 && current && current !== editor && current.tagName !== "BODY"; depth += 1) {
      const cls = String(current.className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      ancestors.push(cls ? `${current.tagName}.${cls}` : String(current.tagName || ""));
      current = current.parentElement;
    }
    return {
      role,
      scheme: located.scheme,
      host: located.host,
      path: located.path,
      fingerprint: located.fingerprint,
      alt: normalize(attr(el, "alt")).slice(0, 40),
      ancestors,
      rect: boxOf(el),
      natural: {
        width: Number(el.naturalWidth) || 0,
        height: Number(el.naturalHeight) || 0,
      },
      visible: shown(el),
      blockIndex: blockIndexFor(el, blocks),
    };
  }

  function editorSnapshot(editor) {
    const headings = qsaAny(["h1", "h2", "h3"], editor).filter(shown).map((el) => ({
      level: Number(String(el.tagName || "").replace(/\D/g, "")) || 0,
      text: ownLabel(el) || normalize(el.innerText || el.textContent),
    })).filter((item) => item.text);
    const listItems = qsaAny(["li"], editor).filter(shown).map((el) => ownLabel(el) || normalize(el.innerText || el.textContent)).filter(Boolean);
    const hrefs = [];
    for (const el of qsaAny(["a"], editor)) {
      const href = attr(el, "href");
      if (/^https?:\/\//i.test(href)) hrefs.push(href);
    }
    const blocks = contentBlockNodes(editor).map(blockRecord);
    const imageInventory = qsaAny(["img"], editor).map((el) => imageRecord(el, editor, blocks));
    const text = normalize(editor && (editor.innerText || editor.textContent));
    return {
      text,
      headings,
      listItems,
      hrefs: [...new Set(hrefs)],
      imageCount: imageInventory.filter((item) => item.role === "body").length,
      imageInventory,
      blocks,
      uploadPending: text.includes("图片上传中") || imageInventory.some((item) => item.role === "pending"),
    };
  }

  function insidePendingUpload(el) {
    let current = el;
    while (current && current.tagName !== "BODY") {
      if (normalize(current.innerText || current.textContent || "") === "图片上传中") return true;
      current = current.parentElement;
    }
    return false;
  }

  function coverApplied(editor) {
    const images = qsaAny(["img"]).filter((el) => {
      if (editor && contains(editor, el)) return false;
      const src = attr(el, "src") || el.src || "";
      if (!/^https?:\/\//i.test(src)) return false;
      let blob = `${el.className || ""} ${hintOf(el)}`;
      let current = el.parentElement;
      for (let depth = 0; depth < 4 && current && current.tagName !== "BODY"; depth += 1) {
        blob += ` ${current.className || ""} ${hintOf(current)} ${directText(current)}`;
        current = current.parentElement;
      }
      return /封面|题图|UploadPicture/.test(blob) || /(?:^|[^a-z])cover(?:[^a-z]|$)/i.test(blob);
    });
    return images.length > 0;
  }

  function titleValue(title) {
    if (!title) return "";
    const value = normalize(title.value || "");
    const placeholder = normalize(title.placeholder || attr(title, "placeholder"));
    if (value && value !== placeholder) return value;
    return "";
  }

  function describe() {
    const url = hrefOf();
    const title = findTitle();
    const bodies = findBodies(title);
    const body = bodies.length === 1 ? bodies[0] : null;
    const surface = surfaceOf(url, title, body);
    const files = fileInputs();
    const coverCandidates = files.filter(isCoverInput);
    const imageCandidates = bodyImageInputs(files);
    const buttons = visibleButtons();
    const labels = buttons.map(buttonLabel).filter(Boolean);
    const draftLabels = labels.filter((label) => ["保存草稿", "存草稿", "保存为草稿"].includes(label) && !isPublish(label) && !isPreviewInvite(label));
    const publishLabels = labels.filter(isPublish);
    const previewLabels = labels.filter(isPreviewInvite);
    const ids = [...new Set([
      ...draftIdsIn(url),
      ...qsaAny(["a"]).map((el) => attr(el, "href")).flatMap((href) => draftIdsIn(href)),
    ])];
    const roots = identityRoots();
    const accounts = accountNames(roots);
    const chrome = loggedInChrome(roots);
    const loginControl = visibleButtons().some((el) => /^(登录|注册|登录\/注册)$/.test(buttonLabel(el)));
    const challenge = /安全验证|人机验证|请完成验证/.test(normalize(doc.title));
    const editorVisible = Boolean(title && body);
    const loginWall = surface === "signin" || (accounts.length === 0 && !chrome && !editorVisible && loginControl);
    const snap = body ? editorSnapshot(body) : { text: "", headings: [], listItems: [], hrefs: [], imageCount: 0 };
    const currentTitle = titleValue(title);
    const badge = autosaveBadge(body);
    const bodyText = normalize(snap.text);
    const blankBody = !bodyText || bodyText === "请输入正文";
    return {
      url: redact(url),
      pageTitle: doc.title || "",
      surface,
      challenge,
      loginWall,
      editorVisible,
      loggedIn: !loginWall && !challenge && (accounts.length >= 1 || chrome || editorVisible),
      accounts,
      identityVisible: accounts.length === 1,
      ambiguous: accounts.length > 1,
      editorReady: surface === "article" && Boolean(title && body),
      bodyAmbiguous: bodies.length > 1,
      blank: !currentTitle && blankBody && snap.imageCount === 0 && !published(url),
      explicitDraftLabel: draftLabels[0] || "",
      publishLabels,
      previewLabels,
      imageInput: imageCandidates.length === 1,
      imageAmbiguous: imageCandidates.length > 1,
      coverInput: coverCandidates.length === 1,
      coverAmbiguous: coverCandidates.length > 1,
      autosaveLabel: badge,
      draftIds: ids,
      draftId: ids.length === 1 ? ids[0] : "",
      draftAmbiguous: ids.length > 1,
      published: published(url),
      title: currentTitle,
      ...snap,
      coverApplied: coverApplied(body),
    };
  }

  if (op === "probe" || op === "read") {
    const described = describe();
    return { ok: true, ...described };
  }

  if (op === "mark-title") {
    const title = findTitle();
    if (!title) return { ok: false, error: "title field not found" };
    return { ok: true, selector: mark(title, "data-zhihu-title") };
  }

  if (op === "mark-body") {
    const bodies = findBodies(findTitle());
    if (bodies.length !== 1) return { ok: false, error: bodies.length ? "article body is ambiguous" : "article body not found" };
    return { ok: true, selector: mark(bodies[0], "data-zhihu-body") };
  }

  if (op === "focus-title" || op === "focus-body") {
    const selector = op === "focus-title" ? "[data-zhihu-title='1']" : "[data-zhihu-body='1']";
    const el = qsa(doc, selector)[0];
    if (!el) return { ok: false, error: `${op} target not found` };
    if (typeof el.focus === "function") el.focus();
    return { ok: true };
  }

  if (op === "set-title") {
    const el = qsa(doc, "[data-zhihu-title='1']")[0];
    if (!el) return { ok: false, error: "title field not found" };
    const value = String(input.value ?? "");
    el.value = value;
    if (typeof el.dispatchEvent === "function") el.dispatchEvent({ type: "input" });
    return { ok: true };
  }

  if (op === "mark-image-input" || op === "mark-cover-input") {
    const files = fileInputs();
    const wantCover = op === "mark-cover-input";
    const matches = wantCover ? files.filter(isCoverInput) : bodyImageInputs(files);
    if (matches.length !== 1) {
      return { ok: false, error: matches.length ? `${wantCover ? "cover" : "image"} input is ambiguous` : `${wantCover ? "cover" : "image"} input not found` };
    }
    const name = wantCover ? "data-zhihu-cover" : "data-zhihu-image";
    return { ok: true, selector: mark(matches[0], name) };
  }

  if (op === "mark-draft-save") {
    const matches = visibleButtons().filter((el) => {
      const label = buttonLabel(el);
      return ["保存草稿", "存草稿", "保存为草稿"].includes(label) && !isPublish(label) && !isPreviewInvite(label);
    });
    if (matches.length !== 1) {
      return { ok: false, error: matches.length ? "draft save control is ambiguous" : "explicit draft control not found" };
    }
    return { ok: true, selector: mark(matches[0], "data-zhihu-draft"), label: buttonLabel(matches[0]) };
  }

  if (op === "click-draft-save") {
    const el = qsa(doc, "[data-zhihu-draft='1']")[0];
    if (!el || !shown(el)) return { ok: false, error: "explicit draft control not found" };
    const label = buttonLabel(el);
    if (isPublish(label) || isPreviewInvite(label) || !["保存草稿", "存草稿", "保存为草稿"].includes(label)) {
      return { ok: false, forbidden: true, error: "refusing to click a control that is not an explicit draft save" };
    }
    if (typeof el.click === "function") el.click();
    return { ok: true, clicked: true, label };
  }

  if (op === "select-body") {
    const el = qsa(doc, "[data-zhihu-body='1']")[0];
    if (!el) return { ok: false, error: "article body not found" };
    const selection = typeof globalThis.getSelection === "function" ? globalThis.getSelection() : null;
    if (!selection || typeof doc.createRange !== "function" || typeof selection.removeAllRanges !== "function") {
      return { ok: false, error: "body selection is unavailable" };
    }
    const range = doc.createRange();
    if (typeof range.selectNodeContents !== "function") return { ok: false, error: "body selection is unavailable" };
    range.selectNodeContents(el);
    selection.removeAllRanges();
    if (typeof selection.addRange === "function") selection.addRange(range);
    el.setAttribute("data-zhihu-selected", "1");
    return { ok: true, selected: true };
  }

  if (op === "read-selection") {
    const body = qsa(doc, "[data-zhihu-body='1']")[0];
    const selection = typeof globalThis.getSelection === "function" ? globalThis.getSelection() : null;
    if (!body || !selection || typeof selection.toString !== "function") {
      return { ok: false, error: "selection is unavailable" };
    }
    const anchor = selection.anchorNode
      ? (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement)
      : null;
    return {
      ok: true,
      text: normalize(selection.toString()),
      inside: Boolean(anchor && contains(body, anchor)),
      collapsed: Boolean(selection.isCollapsed),
      title: titleValue(findTitle()),
    };
  }

  if (op === "clear-pending-upload" || op === "remove-duplicate-lead") {
    // Direct childNodes edits are not an editor commit. Node.childNodes is a
    // live readonly NodeList: calling filter throws, and assigning it does not
    // update Draft.js. Leave the draft untouched.
    return { ok: false, disabled: true, mutated: false, error: "editor-mutation-unverified" };
  }

  if (op === "reveal-cover") {
    const nodes = qsaAny(["button", "label", "a", "div", "span"]).filter((el) => {
      if (!shown(el)) return false;
      const label = controlName(el);
      return label === "添加封面" || label === "添加文章封面";
    });
    const leaves = nodes.filter((el) => !nodes.some((other) => other !== el && contains(other, el)));
    if (leaves.length !== 1) return { ok: true, clicked: false };
    const label = controlName(leaves[0]);
    if (!label || label.includes("发布")) return { ok: true, clicked: false };
    if (typeof leaves[0].click === "function") leaves[0].click();
    return { ok: true, clicked: true, label };
  }

  if (op === "scroll-evidence") {
    const where = input.where === "cover" ? "cover" : "end";
    const target = where === "cover"
      ? qsaAny(["button", "label", "div", "img"]).find((el) => /封面|UploadPicture|添加封面/.test(`${controlName(el)} ${el.className || ""}`))
      : qsa(doc, "[data-zhihu-body='1']")[0] || qsaAny(["div"]).find((el) => /public-DraftEditor-content/.test(String(el.className || "")));
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView();
    const scrolling = doc.scrollingElement || doc.body;
    if (scrolling && where === "end") scrolling.scrollTop = scrolling.scrollHeight || 0;
    return { ok: true, where };
  }

  if (op === "confirm-cover-crop") {
    const dialogs = qsaAny(["div", "section"]).filter((el) => {
      const text = normalize(el.innerText || el.textContent || "");
      return text.length > 0 && text.length < 1200 && /封面|裁剪/.test(text);
    });
    const buttons = [];
    for (const dialog of dialogs) {
      for (const el of qsaAny(["button"], dialog)) {
        if (!shown(el)) continue;
        const label = buttonLabel(el);
        if (label === "确定" || label === "完成" || label === "确认") buttons.push(el);
      }
    }
    const unique = buttons.filter((el, index) => buttons.indexOf(el) === index);
    if (unique.length !== 1) return { ok: true, clicked: false };
    const label = buttonLabel(unique[0]);
    if (isPublish(label) || isPreviewInvite(label) || label.includes("发布")) {
      return { ok: false, forbidden: true, clicked: false, error: "refusing to confirm a cover crop through 发布" };
    }
    if (typeof unique[0].click === "function") unique[0].click();
    return { ok: true, clicked: true, label };
  }

  return { ok: false, error: `unknown op ${op}` };
}
