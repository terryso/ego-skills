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

  function findBodies(title) {
    const nodes = qsaAny(["div", "textarea"]);
    const found = [];
    for (const el of nodes) {
      if (el === title || !shown(el)) continue;
      const editable = Boolean(el.isContentEditable) || attr(el, "contenteditable") === "true";
      if (!editable) continue;
      found.push(el);
    }
    const hinted = found.filter((el) => /DraftEditor|Editable-content|public-Draft/i.test(String(el.className || "")));
    return hinted.length ? hinted : found;
  }

  function isCoverInput(el) {
    const blob = `${el.className || ""} ${hintOf(el)}`;
    return /封面|题图|UploadPicture|cover/i.test(blob);
  }

  function fileInputs() {
    return qsaAny(["input"]).filter((el) => {
      const type = (attr(el, "type") || el.type || "").toLowerCase();
      return type === "file" && !hasAttr(el, "disabled");
    });
  }

  function acceptImage(el) {
    const accept = (attr(el, "accept") || el.accept || "").toLowerCase();
    return !accept || accept.includes("image") || accept.includes("png") || accept.includes("jpg") || accept.includes("jpeg");
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
    return /发布|发表|定时/.test(label);
  }

  function isPreviewInvite(label) {
    return label.includes("邀请预览");
  }

  function visibleButtons() {
    return qsaAny(["button", "a"]).filter((el) => shown(el));
  }

  function autosaveBadge(editor) {
    const nodes = qsaAny(["header", "div", "span", "p", "strong"]);
    for (const el of nodes) {
      if (editor && contains(editor, el)) continue;
      const label = ownLabel(el);
      if (!label || label.length > 40) continue;
      if (label.includes("发布")) continue;
      if (label === "已保存" || label === "草稿已保存" || /已保存$/.test(label)) return label;
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
    if (el.tagName === "HEADER") return true;
    if (attr(el, "role") === "banner") return true;
    return /(?:^|\s)AppHeader(?:\s|$|-)/.test(String(el.className || ""));
  }

  function identityRoots() {
    const found = qsaAny(["header", "nav", "div"]).filter(isIdentityRoot);
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
      for (const el of qsaAny(["a", "button", "img"], root)) {
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
        if (el.tagName === "IMG" && /avatar|Avatar|profile/i.test(`${el.className || ""} ${label}`)) return true;
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
    const images = qsaAny(["img"], editor).filter((el) => {
      const src = attr(el, "src") || el.src || "";
      return Boolean(src) && !src.startsWith("data:image/svg");
    });
    return {
      text: normalize(editor && (editor.innerText || editor.textContent)),
      headings,
      listItems,
      hrefs: [...new Set(hrefs)],
      imageCount: images.length,
    };
  }

  function coverApplied() {
    const images = qsaAny(["img"]).filter((el) => {
      const src = attr(el, "src") || "";
      if (!src) return false;
      const blob = `${el.className || ""} ${hintOf(el)} ${el.parentElement ? hintOf(el.parentElement) : ""}`;
      return /封面|题图|UploadPicture|cover/i.test(blob);
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
    const files = fileInputs().filter(acceptImage);
    const coverCandidates = files.filter(isCoverInput);
    const imageCandidates = files.filter((el) => !isCoverInput(el));
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
    const loginWall = surface === "signin" || (accounts.length === 0 && !chrome && loginControl);
    const snap = body ? editorSnapshot(body) : { text: "", headings: [], listItems: [], hrefs: [], imageCount: 0 };
    const currentTitle = titleValue(title);
    const badge = autosaveBadge(body);
    return {
      url: redact(url),
      surface,
      loginWall,
      loggedIn: !loginWall && (accounts.length >= 1 || chrome),
      accounts,
      identityVisible: accounts.length === 1,
      ambiguous: accounts.length > 1,
      editorReady: surface === "article" && Boolean(title && body),
      bodyAmbiguous: bodies.length > 1,
      blank: !currentTitle && !snap.text && snap.imageCount === 0 && !published(url),
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
      coverApplied: coverApplied(),
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
    const files = fileInputs().filter(acceptImage);
    const wantCover = op === "mark-cover-input";
    const matches = files.filter((el) => isCoverInput(el) === wantCover);
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

  return { ok: false, error: `unknown op ${op}` };
}
