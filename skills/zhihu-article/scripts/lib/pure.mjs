// Argument parsing, Markdown model, consent, and draft-state decisions.
// No browser, no filesystem, no network.
import crypto from "node:crypto";

export const RESULT_TAG = "ZHIHUARTICLE ";
export const TASK_NAME = "zhihu-article";
export const HOME_URL = "https://www.zhihu.com/";
export const WRITE_URL = "https://zhuanlan.zhihu.com/write";
export const TITLE_MAX = 100;
export const BODY_MAX = 100000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIN_BYTES = 32;
export const COVER_MIN_WIDTH = 330;
export const COVER_MIN_HEIGHT = 100;

export const DRAFT_BUTTON_LABELS = ["保存草稿", "存草稿", "保存为草稿"];
export const STATES = ["not-started", "uploaded", "draft-saved", "unverified", "failed"];

export const USAGE = `Usage:
  node scripts/check-login.mjs [--expect-account NAME] [--json]
  node scripts/preview.mjs (--markdown /absolute/path/to/article.md | --text TEXT | --text-file /absolute/path/to/body.txt)
      [--title TEXT] [--cover /absolute/path/to/cover.png] [--asset-root /absolute/path/to/assets] [--json]
  node scripts/save-draft.mjs (--markdown /absolute/path/to/article.md | --text TEXT | --text-file /absolute/path/to/body.txt)
      [--title TEXT] [--cover /absolute/path/to/cover.png] [--asset-root /absolute/path/to/assets]
      [--expect-account NAME] [--save-draft] [--json]
      [--receipt-dir /absolute/path/to/receipts]
      [--screenshot-dir /absolute/path/to/screenshots]
  node scripts/cleanup.mjs [--json]

preview and save-draft without --save-draft are offline. They do not open a browser and do not write a draft.
--save-draft consents to one article draft. It does not permit public publishing.
--publish and --yes are refused. Public publishing is not implemented.
The task space is always closed. --keep is not supported.
`;

const HOW_TO_LOGIN = [
  "Install Ego Lite and put ego-browser on PATH.",
  "Open https://www.zhihu.com/ in that same Ego Lite window.",
  "Sign in yourself. This skill does not type a password, paste cookies, or scan a QR code.",
  "Re-run check-login. Continue only after exit 0.",
];

const HOW_TO_LOGIN_ZH = [
  "安装 Ego Lite，并保证 ego-browser 在 PATH 上。",
  "在同一个 Ego Lite 窗口打开 https://www.zhihu.com/ 。",
  "自己登录。这个技能不输入密码、不粘贴 Cookie、不扫码。",
  "重新运行 check-login，退出码 0 后再继续。",
];

const REFUSED = {
  "--publish": "--publish is refused. Public publishing is not part of this skill. --save-draft does not grant permission to publish.",
  "--yes": "--yes is refused. It is not draft-save consent and it is not publish permission. Pass --save-draft to save one draft.",
  "--keep": "--keep is not supported; the task space always closes",
  "--schedule": "--schedule is refused. Scheduling is outside this skill.",
  "--answer": "--answer is refused. This skill prepares articles only.",
  "--idea": "--idea is refused. This skill prepares articles only.",
  "--comment": "--comment is refused. This skill prepares articles only.",
  "--kind": "--kind is refused. This skill prepares articles only.",
};

export function howToLogin(extra = []) {
  return {
    login_required: true,
    how_to_login: [...HOW_TO_LOGIN, ...extra],
    how_to_login_zh: [...HOW_TO_LOGIN_ZH, ...extra],
  };
}

export function loginTip(account) {
  const who = account ? ` as ${account}` : "";
  return {
    login_tip: `Logged in${who}. This skill only prepares one Zhihu article draft. --save-draft does not publish. 发布 and 邀请预览 are never clicked.`,
    login_tip_zh: `已登录${account ? `：${account}` : ""}。这个技能只准备一篇知乎文章草稿。--save-draft 不会发布。不会点「发布」或「邀请预览」。`,
  };
}

export function seal(summary) {
  const out = summary && typeof summary === "object" ? { ...summary } : {};
  out.skill = "zhihu-article";
  out.publishPermitted = false;
  out.publishSupported = false;
  if (!out.state) out.state = "not-started";
  if (typeof out.verified !== "boolean") out.verified = out.state === "draft-saved";
  if (typeof out.retryable !== "boolean") out.retryable = false;
  if (!out.mutation) out.mutation = "none";
  if (!out.consent) out.consent = "none";
  out.saved = out.state === "draft-saved" && out.verified === true;
  return out;
}

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
    || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function takeFlag(argv, index) {
  const token = argv[index];
  const eq = token.indexOf("=");
  if (eq !== -1) return { value: token.slice(eq + 1), next: index + 1 };
  if (index + 1 >= argv.length) throw new Error(`Missing value for ${token.split("=")[0]}`);
  return { value: argv[index + 1], next: index + 2 };
}

function emptyArgs() {
  return {
    help: false,
    json: false,
    saveDraft: false,
    markdown: "",
    title: "",
    text: "",
    textFile: "",
    textSet: false,
    textFileSet: false,
    cover: "",
    assetRoot: "",
    expectAccount: "",
    receiptDir: "",
    screenshotDir: "",
  };
}

export function parseArgs(argv, command) {
  const out = emptyArgs();
  const contentCommand = command === "preview" || command === "save";
  for (let index = 0; index < argv.length;) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      out.help = true;
      index += 1;
      continue;
    }
    if (token === "--json") {
      out.json = true;
      index += 1;
      continue;
    }
    if (token === "--save-draft") {
      if (command !== "save") throw new Error("--save-draft is only valid for save-draft");
      out.saveDraft = true;
      index += 1;
      continue;
    }
    const key = token.split("=")[0];
    if (REFUSED[key]) throw new Error(REFUSED[key]);
    const named = new Set([
      "--markdown",
      "--title",
      "--text",
      "--text-file",
      "--cover",
      "--asset-root",
      "--expect-account",
      "--receipt-dir",
      "--screenshot-dir",
    ]);
    if (!named.has(key)) throw new Error(`Unknown argument: ${token}`);
    if (!contentCommand && key !== "--expect-account") {
      throw new Error(`${key} is only valid for preview and save-draft`);
    }
    if (command === "preview" && (key === "--expect-account" || key === "--receipt-dir" || key === "--screenshot-dir")) {
      throw new Error(`${key} is not valid for offline preview`);
    }
    if (command === "check" && key !== "--expect-account") {
      throw new Error(`${key} is only valid for preview and save-draft`);
    }
    const taken = takeFlag(argv, index);
    if (key === "--markdown") out.markdown = taken.value;
    else if (key === "--title") out.title = taken.value;
    else if (key === "--text") {
      out.text = taken.value;
      out.textSet = true;
    } else if (key === "--text-file") {
      out.textFile = taken.value;
      out.textFileSet = true;
    } else if (key === "--cover") out.cover = taken.value;
    else if (key === "--asset-root") out.assetRoot = taken.value;
    else if (key === "--expect-account") out.expectAccount = unquote(taken.value).trim();
    else if (key === "--receipt-dir") out.receiptDir = taken.value;
    else if (key === "--screenshot-dir") out.screenshotDir = taken.value;
    index = taken.next;
  }
  return out;
}

export function parseCheckArgs(argv) {
  return parseArgs(argv, "check");
}

export function parseCleanupArgs(argv) {
  return parseArgs(argv, "cleanup");
}

export function parsePreviewArgs(argv) {
  return parseArgs(argv, "preview");
}

export function parseSaveArgs(argv) {
  return parseArgs(argv, "save");
}

export function normalizeText(value) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function compactText(value) {
  return normalizeText(value).replace(/[\s\u00A0]/g, "");
}

export function charCount(value) {
  return [...String(value ?? "")].length;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function draftEditUrl(id) {
  const text = String(id ?? "");
  if (!/^\d{1,20}$/.test(text)) return "";
  return `https://zhuanlan.zhihu.com/p/${text}/edit`;
}

export function draftIdFromUrl(value) {
  const text = String(value ?? "");
  const edit = text.match(/\/p\/(\d{1,20})\/edit(?:[?#]|$)/);
  if (edit) return edit[1];
  return "";
}

export function isPublishedArticleUrl(value) {
  const text = String(value ?? "");
  if (draftIdFromUrl(text)) return false;
  return /\/p\/\d{1,20}(?:[?#]|$)/.test(text);
}

export function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|pass|cookie|session|key|auth|code/i.test(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function sniffImage(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  const head = buf.subarray(0, 6).toString("ascii");
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb]);

export function imageSize(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const type = sniffImage(buf);
  if (type === "image/png") {
    if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (!width || !height) return null;
    return { width, height };
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buf.length) return null;
      if (SOF_MARKERS.has(marker)) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (!width || !height) return null;
        return { width, height };
      }
      offset += 2 + length;
    }
  }
  return null;
}

export function inspectImage(buffer, name, { role = "body" } = {}) {
  const label = name || "image";
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < IMAGE_MIN_BYTES) return { ok: false, error: `malformed image: ${label}` };
  if (buf.length > IMAGE_MAX_BYTES) return { ok: false, error: `image exceeds ${IMAGE_MAX_BYTES} bytes: ${label}` };
  const type = sniffImage(buf);
  if (type !== "image/png" && type !== "image/jpeg") {
    if (type) return { ok: false, error: `unsupported image type ${type}: ${label}` };
    return { ok: false, error: `malformed image: ${label}` };
  }
  const ext = String(label).includes(".") ? String(label).split(".").pop().toLowerCase() : "";
  const expected = type === "image/png" ? ["png"] : ["jpg", "jpeg"];
  if (!ext || !expected.includes(ext)) return { ok: false, error: `image extension does not match content: ${label}` };
  const size = imageSize(buf);
  if (!size) return { ok: false, error: `malformed image: ${label}` };
  if (role === "cover" && !(size.width > COVER_MIN_WIDTH && size.height > COVER_MIN_HEIGHT)) {
    return {
      ok: false,
      error: `cover must be wider than ${COVER_MIN_WIDTH}px and taller than ${COVER_MIN_HEIGHT}px: ${label}`,
    };
  }
  return { ok: true, type, width: size.width, height: size.height, bytes: buf.length };
}

function parseFrontmatter(raw) {
  const data = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = unquote(match[2]);
  }
  return data;
}

function indexOfSpecial(source, from) {
  const positions = ["**", "*", "["].map((token) => source.indexOf(token, from)).filter((at) => at !== -1);
  if (!positions.length) return source.length;
  return Math.min(...positions);
}

function parseInline(source) {
  const text = [];
  const html = [];
  const links = [];
  let index = 0;
  const input = String(source ?? "");
  while (index < input.length) {
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end === -1) {
        text.push("**");
        html.push("**");
        index += 2;
        continue;
      }
      const inner = parseInline(input.slice(index + 2, end));
      if (!inner.ok) return inner;
      text.push(inner.text);
      html.push(`<strong>${inner.html}</strong>`);
      links.push(...inner.links);
      index = end + 2;
      continue;
    }
    if (input[index] === "*") {
      const end = input.indexOf("*", index + 1);
      if (end === -1 || input[index + 1] === " " || input[index + 1] === "*") {
        text.push("*");
        html.push("*");
        index += 1;
        continue;
      }
      const inner = parseInline(input.slice(index + 1, end));
      if (!inner.ok) return inner;
      text.push(inner.text);
      html.push(`<em>${inner.html}</em>`);
      links.push(...inner.links);
      index = end + 1;
      continue;
    }
    if (input[index] === "[") {
      const close = input.indexOf("]", index + 1);
      const paren = close !== -1 && input[close + 1] === "(" ? input.indexOf(")", close + 2) : -1;
      if (close === -1 || paren === -1) {
        text.push("[");
        html.push("[");
        index += 1;
        continue;
      }
      const href = input.slice(close + 2, paren).trim();
      if (!/^https?:\/\//i.test(href)) {
        return { ok: false, unsupported: [{ id: "unsafe-link", detail: href.split(":")[0] || "link" }] };
      }
      const inner = parseInline(input.slice(index + 1, close));
      if (!inner.ok) return inner;
      text.push(inner.text);
      html.push(`<a href="${escapeHtml(href)}">${inner.html}</a>`);
      links.push({ href, text: inner.text }, ...inner.links);
      index = paren + 1;
      continue;
    }
    const next = indexOfSpecial(input, index);
    const chunk = input.slice(index, next);
    text.push(chunk);
    html.push(escapeHtml(chunk));
    index = next;
  }
  return { ok: true, text: text.join(""), html: html.join(""), links };
}

function pushUnsupported(list, id, line) {
  if (list.some((item) => item.id === id && item.line === line)) return;
  list.push({ id, line });
}

function lineUnsupported(line, lineNumber, list) {
  const trimmed = line.trim();
  if (trimmed.startsWith("```")) pushUnsupported(list, "code-fence", lineNumber);
  if (/^\s{2,}([-*]|\d+\.)\s+/.test(line)) pushUnsupported(list, "nested-list", lineNumber);
  if (/^#{4,}\s+/.test(trimmed)) pushUnsupported(list, "heading-depth", lineNumber);
  if (/^\s*>/.test(line)) pushUnsupported(list, "blockquote", lineNumber);
  if (/\[\^/.test(line)) pushUnsupported(list, "footnote", lineNumber);
  if (/\$\$|\\\(|\\\[/.test(line)) pushUnsupported(list, "math", lineNumber);
  if (/!\[\[[^\]]*\]\]/.test(line)) pushUnsupported(list, "wiki-image", lineNumber);
  if (/`[^`]+`/.test(line)) pushUnsupported(list, "inline-code", lineNumber);
  if (/<\/?[a-z][\s\S]*>/i.test(line)) pushUnsupported(list, "raw-html", lineNumber);
  if (/^\s*\|/.test(line) || (line.includes("|") && /\|.*\|/.test(line) && !/!\[[^\]]*\]\([^)]*\|/.test(line))) {
    pushUnsupported(list, "table", lineNumber);
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) pushUnsupported(list, "thematic-break", lineNumber);
}

function imageAtLine(line) {
  const match = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (!match) return null;
  let src = match[2].trim();
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1).trim();
  const titled = src.match(/^(\S+)\s+["'].*["']$/);
  if (titled) src = titled[1];
  return { alt: match[1], src };
}

export function parseMarkdown(markdown) {
  const source = String(markdown ?? "").replace(/^\uFEFF/, "");
  let body = source;
  let meta = {};
  if (source.startsWith("---")) {
    const end = source.indexOf("\n---", 3);
    if (end !== -1) {
      meta = parseFrontmatter(source.slice(4, end));
      body = source.slice(end + 4).replace(/^\r?\n/, "");
    }
  }
  const unsupported = [];
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let cursor = 0;
  const paragraphLines = [];
  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const inline = parseInline(paragraphLines.join(" "));
    paragraphLines.length = 0;
    if (!inline.ok) {
      unsupported.push(...inline.unsupported);
      return;
    }
    const text = inline.text.trim();
    if (!text) return;
    blocks.push({ type: "paragraph", text, html: inline.html, links: inline.links });
  };
  while (cursor < lines.length) {
    const line = lines[cursor];
    const lineNumber = cursor + 1;
    if (line.trim().startsWith("```")) {
      pushUnsupported(unsupported, "code-fence", lineNumber);
      cursor += 1;
      while (cursor < lines.length && !lines[cursor].trim().startsWith("```")) cursor += 1;
      if (cursor < lines.length) cursor += 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      cursor += 1;
      continue;
    }
    lineUnsupported(line, lineNumber, unsupported);
    const image = imageAtLine(line);
    if (image) {
      flushParagraph();
      if (/^https?:\/\//i.test(image.src) || /^data:/i.test(image.src)) {
        pushUnsupported(unsupported, "remote-image", lineNumber);
      } else if (!image.src || /^[a-z]+:/i.test(image.src)) {
        pushUnsupported(unsupported, "bad-image", lineNumber);
      } else {
        blocks.push({ type: "image", alt: image.alt, src: image.src });
      }
      cursor += 1;
      continue;
    }
    if (/!\[[^\]]*\]\(/.test(line) && !image) {
      pushUnsupported(unsupported, "inline-image", lineNumber);
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const inline = parseInline(heading[2].trim());
      if (!inline.ok) unsupported.push(...inline.unsupported);
      else blocks.push({ type: "heading", level: heading[1].length, text: inline.text.trim(), html: inline.html, links: inline.links });
      cursor += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      flushParagraph();
      const ordered = /^\d+\.\s+/.test(line);
      const items = [];
      while (cursor < lines.length && (ordered ? /^\d+\.\s+/.test(lines[cursor]) : /^[-*]\s+/.test(lines[cursor]))) {
        lineUnsupported(lines[cursor], cursor + 1, unsupported);
        const raw = lines[cursor].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
        const inline = parseInline(raw.trim());
        if (!inline.ok) unsupported.push(...inline.unsupported);
        else if (inline.text.trim()) items.push({ text: inline.text.trim(), html: inline.html, links: inline.links });
        cursor += 1;
      }
      if (items.length) blocks.push({ type: "list", ordered, items });
      continue;
    }
    paragraphLines.push(line.trim());
    cursor += 1;
  }
  flushParagraph();
  const title = normalizeText(meta.title || "");
  return {
    ok: unsupported.length === 0,
    title,
    description: normalizeText(meta.description || ""),
    blocks,
    unsupported,
  };
}

export function parsePlain(text, title) {
  const body = String(text ?? "").replace(/\r\n/g, "\n").trim();
  const resolved = normalizeText(title);
  const blocks = body ? [{ type: "paragraph", text: body, html: escapeHtml(body).replace(/\n/g, "<br>"), links: [] }] : [];
  return { ok: true, title: resolved, description: "", blocks, unsupported: [], plain: true };
}

function renderHeading(block) {
  const level = block.level === 1 ? 2 : block.level;
  return `<h${level}>${block.html}</h${level}>`;
}

export function buildArticle({ parsed, images, cover = null, title = "" }) {
  if (!parsed || !parsed.ok) {
    return { ok: false, error: "unsupported markdown", unsupported: (parsed && parsed.unsupported) || [] };
  }
  const resolvedTitle = normalizeText(title || parsed.title || (parsed.blocks.find((block) => block.type === "heading" && block.level === 1) || {}).text);
  if (!resolvedTitle) return { ok: false, error: "title is empty" };
  if (charCount(resolvedTitle) > TITLE_MAX) {
    return { ok: false, error: `title is ${charCount(resolvedTitle)} characters; the local guard is ${TITLE_MAX}` };
  }
  const imageBlocks = parsed.blocks.filter((block) => block.type === "image");
  if (imageBlocks.length !== images.length) return { ok: false, error: "image count does not match resolved files" };
  const titles = new Set([normalizeText(resolvedTitle), normalizeText(parsed.title)].filter(Boolean));
  const segments = [];
  const snippets = [];
  const headings = [];
  const listItems = [];
  const links = [];
  let imageCursor = 0;
  for (const block of parsed.blocks) {
    if (block.type === "heading" && block.level === 1 && titles.has(normalizeText(block.text))) continue;
    if (block.type === "image") {
      const file = images[imageCursor];
      imageCursor += 1;
      segments.push({ kind: "image", alt: block.alt, name: file.name, path: file.path, sha256: file.sha256, index: imageCursor - 1 });
      if (normalizeText(block.alt)) snippets.push(normalizeText(block.alt));
      continue;
    }
    if (block.type === "heading") {
      segments.push({ kind: "html", html: renderHeading(block), text: block.text });
      headings.push({ level: block.level === 1 ? 2 : block.level, text: normalizeText(block.text) });
      snippets.push(normalizeText(block.text));
      links.push(...(block.links || []));
      continue;
    }
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${item.html}</li>`).join("");
      segments.push({
        kind: "html",
        html: `<${tag}>${items}</${tag}>`,
        text: block.items.map((item) => item.text).join("\n"),
      });
      for (const item of block.items) {
        listItems.push(normalizeText(item.text));
        snippets.push(normalizeText(item.text));
        links.push(...(item.links || []));
      }
      continue;
    }
    if (block.type === "paragraph") {
      segments.push({ kind: "html", html: `<p>${block.html}</p>`, text: block.text });
      snippets.push(normalizeText(block.text));
      links.push(...(block.links || []));
    }
  }
  const plain = snippets.map(normalizeText).filter(Boolean).join("\n");
  if (!normalizeText(plain) && !images.length) return { ok: false, error: "body is empty" };
  if (charCount(plain) > BODY_MAX) return { ok: false, error: `body is ${charCount(plain)} characters; the local guard is ${BODY_MAX}` };
  const fidelity = [
    "consecutive text blocks are pasted as one HTML fragment so a heading is not flattened into the next paragraph",
    "images are local PNG or JPG files inserted in markdown order; alt text is not a visible caption in this editor",
    "remote images, tables, code, quotes, raw HTML, math, and headings deeper than h3 are rejected",
    "description frontmatter is not copied; the article editor has no separate digest field in this skill",
    "public publishing is not implemented; 发布 and 邀请预览 are never clicked",
    "a draft is verified only after one numeric id, a non-empty readback, and a saved stamp such as 已保存 or 刚刚 · 草稿",
  ];
  if (parsed.plain) fidelity.push("plain text is pasted as paragraphs without markdown formatting");
  if (parsed.description) fidelity.push("frontmatter description was ignored");
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    title: resolvedTitle,
    snippets: snippets.map(normalizeText),
    links: links.map((link) => link.href),
    images: images.map((image) => image.sha256),
    cover: cover ? cover.sha256 : "",
  })).digest("hex");
  return {
    ok: true,
    title: resolvedTitle,
    segments,
    snippets: snippets.map(normalizeText).filter((item) => item.length >= 1),
    headings,
    listItems,
    links,
    imageCount: images.length,
    images: images.map((image) => ({
      name: image.name,
      bytes: image.bytes,
      sha256: image.sha256,
      width: image.width,
      height: image.height,
    })),
    cover: cover ? {
      name: cover.name,
      bytes: cover.bytes,
      sha256: cover.sha256,
      width: cover.width,
      height: cover.height,
      path: cover.path || "",
    } : null,
    fidelity: [...new Set(fidelity)],
    hash,
    plain: Boolean(parsed.plain),
  };
}

function publicFile(file) {
  if (!file) return file;
  return {
    name: file.name,
    bytes: file.bytes,
    sha256: file.sha256,
    width: file.width,
    height: file.height,
  };
}

export function coalescePastes(segments) {
  const groups = [];
  let html = [];
  const flush = () => {
    if (!html.length) return;
    groups.push({
      kind: "html",
      html: html.map((item) => item.html).join(""),
      text: html.map((item) => item.text).join("\n"),
    });
    html = [];
  };
  for (const segment of segments || []) {
    if (segment && segment.kind === "html") html.push(segment);
    else {
      flush();
      if (segment) groups.push(segment);
    }
  }
  flush();
  return groups;
}

export function planOf(article) {
  return {
    title: article.title,
    hash: article.hash,
    imageCount: article.imageCount,
    images: (article.images || []).map(publicFile),
    cover: publicFile(article.cover),
    linkCount: (article.links || []).length,
    headingCount: (article.headings || []).length,
    fidelity: article.fidelity,
    save: false,
    publishPermitted: false,
  };
}

export function classifyAccess(probe, { openedWrite = false } = {}) {
  if (!probe || probe.evaluateFailed) {
    return { ok: false, exitCode: 1, reason: "probe-failed", loginRequired: false };
  }
  if (probe.challenge) {
    return { ok: false, exitCode: 2, reason: "challenge", loginRequired: true };
  }
  const wall = Boolean(probe.loginWall) || probe.surface === "signin";
  if (wall) {
    return {
      ok: false,
      exitCode: 2,
      reason: openedWrite ? "login-expired" : "logged-out",
      loginRequired: true,
    };
  }
  if (probe.ok === false) {
    return { ok: false, exitCode: 1, reason: "probe-failed", loginRequired: false };
  }
  if (probe.loggedIn || probe.editorReady || probe.editorVisible) {
    return { ok: true, exitCode: 0, reason: "ok", loginRequired: false };
  }
  return { ok: false, exitCode: 1, reason: "session-unrecognized", loginRequired: false };
}

export function decideAccount(probe, expectAccount = "") {
  const accounts = [...new Set((probe && probe.accounts) || [])].map(normalizeText).filter(Boolean);
  const loggedOut = !probe || probe.loginWall || !probe.loggedIn;
  const identityVisible = accounts.length === 1;
  if (loggedOut) {
    return { ok: false, exitCode: 2, loginRequired: true, accounts, identityVisible: false, reason: "logged-out" };
  }
  if (probe.ambiguous || accounts.length > 1) {
    return { ok: false, exitCode: 4, loginRequired: false, accounts, identityVisible: false, reason: "ambiguous-account" };
  }
  if (!identityVisible) {
    return { ok: false, exitCode: 4, loginRequired: false, accounts, identityVisible: false, reason: "identity-not-visible" };
  }
  const account = accounts[0];
  const expected = normalizeText(expectAccount);
  if (expected && account !== expected) {
    return {
      ok: false,
      exitCode: 2,
      loginRequired: true,
      account,
      accounts,
      identityVisible: true,
      reason: "account-mismatch",
    };
  }
  return { ok: true, exitCode: 0, account, accounts, identityVisible: true, reason: "ok" };
}

export function decideAttempt({ saveDraft, receipt, hash }) {
  if (!saveDraft) {
    return { action: "preview", save: false, exitCode: 3, state: "not-started", consent: "none" };
  }
  const same = receipt && receipt.hash === hash;
  if (same && receipt.state === "draft-saved" && receipt.draftId && receipt.verified === true) {
    return {
      action: "already-saved",
      save: false,
      exitCode: 0,
      state: "draft-saved",
      consent: "save-draft",
      receipt,
    };
  }
  if (same && (receipt.state === "unverified" || receipt.state === "uploaded")) {
    if (draftEditUrl(receipt.draftId)) {
      return {
        action: "resume",
        save: false,
        resume: true,
        exitCode: 0,
        state: receipt.state,
        consent: "save-draft",
        receipt,
      };
    }
    return {
      action: "blocked-previous-mutation",
      save: false,
      exitCode: 4,
      state: receipt.state,
      consent: "save-draft",
      receipt,
    };
  }
  return { action: "save", save: true, exitCode: 0, state: "not-started", consent: "save-draft" };
}

export function classifyOutcome(input = {}) {
  const draftId = String(input.draftId || "");
  const accepted = Boolean(input.accepted);
  const mediaSubmitted = Boolean(input.mediaSubmitted);
  const explicitControl = Boolean(input.explicitControl);
  const explicitClicked = Boolean(input.explicitClicked);
  const forbidden = Boolean(input.forbidden) || Boolean(input.published);
  const autosaveBadge = Boolean(input.autosaveBadge);
  const autosaveObserved = Boolean(input.autosaveObserved) || autosaveBadge || Boolean(draftId);
  const readbackOk = Boolean(input.readbackOk);
  const coverRequired = Boolean(input.coverRequired);
  const coverApplied = Boolean(input.coverApplied);
  const timedOut = Boolean(input.timedOut);
  const error = input.error || "";
  const base = {
    draftId,
    verified: false,
    retryable: false,
    publishPermitted: false,
    mutation: "none",
  };
  if (forbidden) {
    return {
      ...base,
      state: "unverified",
      mutation: input.published ? "none" : "explicit-save",
      error: input.published ? (error || "published-url") : (error || "publish-refused"),
    };
  }
  if (!accepted && !mediaSubmitted && !draftId && !explicitClicked) {
    return {
      ...base,
      state: input.localFailure ? "failed" : "not-started",
      retryable: input.localFailure ? input.retryable !== false : true,
      error,
    };
  }
  let mutation = "none";
  if (explicitClicked) mutation = "explicit-save";
  else if (autosaveObserved) mutation = "autosave";
  const coverOk = !coverRequired || coverApplied;
  if (
    readbackOk
    && draftId
    && coverOk
    && autosaveBadge
    && !timedOut
    && (!explicitControl || explicitClicked)
  ) {
    return {
      ...base,
      state: "draft-saved",
      verified: true,
      mutation: explicitClicked ? "explicit-save" : "autosave-verified",
      error: "",
    };
  }
  if (explicitControl && !explicitClicked && autosaveObserved) {
    return { ...base, state: "unverified", mutation: "autosave", error: error || "autosave-without-explicit-save" };
  }
  if (mediaSubmitted && !draftId) {
    return { ...base, state: "uploaded", mutation, error: error || "uploaded-unconfirmed" };
  }
  let reason = error;
  if (!reason && !draftId) reason = timedOut ? "autosave-timeout" : "draft-id-unobserved";
  if (!reason && !autosaveBadge) reason = "autosave-badge-missing";
  if (!reason && coverRequired && !coverApplied) reason = "cover-unverified";
  if (!reason && !readbackOk) reason = "readback-mismatch";
  if (!reason) reason = "unverified";
  return {
    ...base,
    state: "unverified",
    mutation: mutation === "none" ? "autosave" : mutation,
    error: reason,
  };
}

function captionSet(article) {
  const captions = new Set();
  for (const segment of article.segments || []) {
    if (segment && segment.kind === "image" && normalizeText(segment.alt)) captions.add(normalizeText(segment.alt));
  }
  return captions;
}

export function headingWasFlattened(article, editor) {
  const text = compactText(editor && editor.text);
  const actual = new Set((editor && editor.headings || []).map((item) => `${item.level}:${compactText(item.text)}`));
  return (article.headings || []).some((item) => {
    const name = compactText(item.text);
    return name && text.includes(name) && !actual.has(`${item.level}:${name}`);
  });
}

export function validateReadback(article, actual) {
  const titleOk = normalizeText(actual && actual.title) === normalizeText(article.title);
  const imageCount = actual && typeof actual.imageCount === "number" ? actual.imageCount : -1;
  const imagesOk = imageCount === article.imageCount;
  const haystack = compactText(actual && actual.text);
  const captions = captionSet(article);
  const missing = [];
  for (const snippet of article.snippets || []) {
    const needle = normalizeText(snippet);
    if (!needle || captions.has(needle)) continue;
    if (!haystack.includes(compactText(needle))) missing.push(needle.slice(0, 80));
  }
  const actualHeadings = new Set((actual && actual.headings || []).map((item) => `${item.level}:${compactText(item.text)}`));
  const missingHeadings = (article.headings || [])
    .filter((item) => !actualHeadings.has(`${item.level}:${compactText(item.text)}`))
    .map((item) => item.text);
  const actualItems = (actual && actual.listItems || []).map(normalizeText);
  const missingItems = (article.listItems || []).filter((item) => !actualItems.includes(normalizeText(item)));
  const hrefs = new Set(actual && actual.hrefs || []);
  const missingHrefs = (article.links || []).filter((link) => link.href && !hrefs.has(link.href)).map((link) => link.href);
  const rawMarkup = /<\s*(p|h1|h2|h3|ul|ol|li|strong|em|a)\b/i.test(String(actual && actual.text || ""));
  const coverRequired = Boolean(article.cover);
  const coverOk = !coverRequired || Boolean(actual && actual.coverApplied);
  const ok = titleOk && imagesOk && missing.length === 0 && missingHeadings.length === 0
    && missingItems.length === 0 && missingHrefs.length === 0 && !rawMarkup && coverOk;
  return {
    ok,
    titleOk,
    imagesOk,
    coverOk,
    missing,
    missingHeadings,
    missingItems,
    missingHrefs,
    rawMarkup,
    imageCount,
  };
}

export function egoMissingSummary(command) {
  return seal({
    ok: false,
    exitCode: 2,
    command,
    state: "not-started",
    verified: false,
    retryable: false,
    mutation: "none",
    consent: "none",
    error: "ego-browser not found",
    ...howToLogin(["ego-browser was not on PATH or ~/.local/bin."]),
  });
}

export function formatResult(summary, { asJson = false } = {}) {
  const sealed = seal(summary);
  if (!asJson && sealed.exitCode === 0 && sealed.state === "draft-saved" && sealed.title) {
    const id = sealed.draftId ? ` id=${sealed.draftId}` : "";
    const url = sealed.draftUrl ? ` url=${sealed.draftUrl}` : "";
    return `draft-saved ${sealed.title}${id}${url}\n`;
  }
  if (!asJson && sealed.command === "preview" && sealed.exitCode === 0 && sealed.title) {
    return `preview ${sealed.title} images=${sealed.imageCount ?? 0} state=not-started\n`;
  }
  return `${JSON.stringify(sealed, null, 2)}\n`;
}

export function extractTaggedJson(combined, tag = RESULT_TAG) {
  const lines = String(combined || "").split(/\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    const at = line.indexOf(tag);
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + tag.length));
    } catch {
      // Keep scanning. A log line may contain the tag as ordinary text.
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

export function defaultReceiptDir(home, env = {}) {
  if (env.ZHIHU_ARTICLE_RECEIPT_DIR) return env.ZHIHU_ARTICLE_RECEIPT_DIR;
  if (!home) return "";
  return `${home}/.local/state/zhihu-article/receipts`;
}

export function isAbsolutePath(value) {
  const text = String(value ?? "");
  return text.startsWith("/") || /^[A-Za-z]:[\\/]/.test(text);
}
