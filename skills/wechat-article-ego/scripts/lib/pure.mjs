// Argument parsing, Markdown → article model, account/save decisions.
// No browser, no filesystem, no network.
import crypto from "node:crypto";

export const RESULT_TAG = "WXARTICLE ";
export const TASK_NAME = "wechat-article-ego";
export const START_URL = "https://mp.weixin.qq.com/";
export const TITLE_MAX = 64;
export const DIGEST_MAX = 120;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const USAGE = `Usage:
  node scripts/check-login.mjs [--expect-account NAME] [--json]
  node scripts/save-draft.mjs --markdown /absolute/path/to/article.md [--yes] [--json]
      [--title TEXT] [--digest TEXT] [--source-url https://example.com/post]
      [--asset-root /absolute/path/to/assets] [--expect-account NAME]
      [--receipt-dir /absolute/path/to/receipts]
      [--screenshot-dir /absolute/path/to/screenshots]
  node scripts/cleanup.mjs [--json]

Without --yes, save-draft only checks the login and prints a plan (exit 3).
--yes saves one new draft. It never clicks 发表, 群发, 定时群发, or 发送预览.
The task space is always closed. --keep is not supported.
`;

const HOW_TO_LOGIN = [
  "Install Ego Lite and put ego-browser on PATH.",
  "Open https://mp.weixin.qq.com/ in that same Ego Lite window.",
  "Scan the QR with WeChat and pick the Official Account yourself.",
  "Re-run check-login. Continue only after exit 0.",
];

const HOW_TO_LOGIN_ZH = [
  "安装 Ego Lite，并保证 ego-browser 在 PATH 上。",
  "在同一个 Ego Lite 窗口打开 https://mp.weixin.qq.com/ 。",
  "用微信扫码，并自己选中要使用的公众号。",
  "重新运行 check-login，退出码 0 后再继续。",
];

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
    login_tip: `Logged in${who}. This skill only saves one Official Account article draft. It never clicks 发表, 群发, 定时群发, or 发送预览.`,
    login_tip_zh: `已登录${account ? `：${account}` : ""}。这个技能只保存一篇公众号图文草稿，不会点「发表」「群发」「定时群发」或「发送预览」。`,
  };
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

function parseCommon(argv, { allowMarkdown }) {
  const out = {
    help: false,
    json: false,
    yes: false,
    markdown: "",
    title: "",
    digest: "",
    sourceUrl: "",
    assetRoot: "",
    expectAccount: "",
    receiptDir: "",
    screenshotDir: "",
  };
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
    if (token === "--yes") {
      if (!allowMarkdown) throw new Error("--yes is only valid for save-draft");
      out.yes = true;
      index += 1;
      continue;
    }
    if (token === "--keep") throw new Error("--keep is not supported; the task space always closes");
    const named = token.startsWith("--expect-account")
      || token.startsWith("--receipt-dir")
      || token.startsWith("--screenshot-dir")
      || token.startsWith("--markdown")
      || token.startsWith("--asset-root")
      || token.startsWith("--source-url")
      || token.startsWith("--title")
      || token.startsWith("--digest");
    if (!named) throw new Error(`Unknown argument: ${token}`);
    if (!allowMarkdown && !token.startsWith("--expect-account") && token !== "--json") {
      throw new Error(`${token.split("=")[0]} is only valid for save-draft`);
    }
    const taken = takeFlag(argv, index);
    const key = token.split("=")[0];
    if (key === "--expect-account") out.expectAccount = taken.value;
    else if (key === "--receipt-dir") out.receiptDir = taken.value;
    else if (key === "--screenshot-dir") out.screenshotDir = taken.value;
    else if (key === "--markdown") out.markdown = taken.value;
    else if (key === "--asset-root") out.assetRoot = taken.value;
    else if (key === "--source-url") out.sourceUrl = taken.value;
    else if (key === "--title") out.title = taken.value;
    else if (key === "--digest") out.digest = taken.value;
    index = taken.next;
  }
  return out;
}

export function parseCheckArgs(argv) {
  return parseCommon(argv, { allowMarkdown: false });
}

export function parseCleanupArgs(argv) {
  return parseCommon(argv, { allowMarkdown: false });
}

export function parseSaveArgs(argv) {
  const args = parseCommon(argv, { allowMarkdown: true });
  if (!args.help && !args.markdown) throw new Error("--markdown is required");
  return args;
}

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function clipDigest(value) {
  const text = normalizeText(value);
  if ([...text].length <= DIGEST_MAX) return { text, trimmed: false };
  return { text: [...text].slice(0, DIGEST_MAX).join(""), trimmed: true };
}

export function isForbiddenLabel(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (/发送预览|定时群发|定时发表/.test(text)) return true;
  return /群发|发表/.test(text);
}

export function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|pass|cookie|session|key/i.test(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return "";
  }
}

function parseFrontmatter(raw) {
  const data = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = unquote(match[2]);
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((item) => unquote(item)).filter(Boolean);
    }
    data[match[1]] = value;
  }
  return data;
}

function renderInline(src) {
  let index = 0;
  let html = "";
  let text = "";
  const links = [];
  const source = String(src || "");
  while (index < source.length) {
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const mark = source.slice(index, index + 2);
      const end = source.indexOf(mark, index + 2);
      if (end !== -1) {
        const inner = renderInline(source.slice(index + 2, end));
        html += `<strong>${inner.html}</strong>`;
        text += inner.text;
        links.push(...inner.links);
        index = end + 2;
        continue;
      }
    }
    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end !== -1) {
        const code = source.slice(index + 1, end);
        html += `<code>${escapeHtml(code)}</code>`;
        text += code;
        index = end + 1;
        continue;
      }
    }
    if (source[index] === "*" && source[index + 1] !== "*") {
      const end = source.indexOf("*", index + 1);
      if (end !== -1 && !source.slice(index + 1, end).includes("\n")) {
        const inner = renderInline(source.slice(index + 1, end));
        html += `<em>${inner.html}</em>`;
        text += inner.text;
        links.push(...inner.links);
        index = end + 1;
        continue;
      }
    }
    if (source[index] === "[") {
      const close = source.indexOf("]", index + 1);
      if (close !== -1 && source[close + 1] === "(") {
        const end = source.indexOf(")", close + 2);
        if (end !== -1) {
          const inner = renderInline(source.slice(index + 1, close));
          const href = source.slice(close + 2, end).trim();
          html += `<a href="${escapeHtml(href)}">${inner.html}</a>`;
          text += inner.text;
          links.push(...inner.links, { text: inner.text, href });
          index = end + 1;
          continue;
        }
      }
    }
    html += escapeHtml(source[index]);
    text += source[index];
    index += 1;
  }
  return { html, text, links };
}

function parseBlocks(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let cursor = 0;
  const pushParagraph = (chunk) => {
    const text = chunk.join(" ").trim();
    if (!text) return;
    const image = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      blocks.push({ type: "image", alt: image[1], src: image[2] });
      return;
    }
    const inline = renderInline(text);
    blocks.push({ type: "paragraph", html: inline.html, text: inline.text, links: inline.links });
  };

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const code = [];
      cursor += 1;
      while (cursor < lines.length && !lines[cursor].startsWith("```")) {
        code.push(lines[cursor]);
        cursor += 1;
      }
      if (cursor < lines.length) cursor += 1;
      blocks.push({ type: "code", lang, text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const inline = renderInline(heading[2].trim());
      blocks.push({ type: "heading", level: heading[1].length, html: inline.html, text: inline.text, links: inline.links });
      cursor += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const quoted = [];
      while (cursor < lines.length && lines[cursor].startsWith(">")) {
        quoted.push(lines[cursor].replace(/^>\s?/, ""));
        cursor += 1;
      }
      const inline = renderInline(quoted.join(" ").trim());
      blocks.push({ type: "quote", html: inline.html, text: inline.text, links: inline.links });
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items = [];
      while (cursor < lines.length && (ordered ? /^\d+\.\s+/.test(lines[cursor]) : /^[-*]\s+/.test(lines[cursor]))) {
        const item = lines[cursor].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
        items.push(renderInline(item.trim()));
        cursor += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const chunk = [];
    while (
      cursor < lines.length
      && lines[cursor].trim()
      && !lines[cursor].startsWith("```")
      && !lines[cursor].startsWith(">")
      && !/^(#{1,6})\s+/.test(lines[cursor])
      && !/^[-*]\s+/.test(lines[cursor])
      && !/^\d+\.\s+/.test(lines[cursor])
    ) {
      chunk.push(lines[cursor].trim());
      cursor += 1;
    }
    pushParagraph(chunk);
  }
  return blocks;
}

export function parseMarkdown(markdown) {
  const source = String(markdown ?? "");
  let body = source;
  let meta = {};
  if (source.startsWith("---")) {
    const end = source.indexOf("\n---", 3);
    if (end !== -1) {
      meta = parseFrontmatter(source.slice(3, end));
      body = source.slice(end + 4).replace(/^\r?\n/, "");
    }
  }
  const blocks = parseBlocks(body);
  const heading = blocks.find((block) => block.type === "heading");
  const title = normalizeText(meta.title || (heading && heading.text) || "");
  return {
    title,
    description: normalizeText(meta.description || ""),
    blocks,
  };
}

const P = "margin:0 0 16px;font-size:16px;line-height:1.8;letter-spacing:0.2px;color:#222222;font-family:Menlo,Consolas,monospace;";
const H = "margin:28px 0 12px;font-size:18px;line-height:1.45;font-weight:700;color:#111111;font-family:Menlo,Consolas,monospace;";
const Q = "margin:16px 0;padding:4px 0 4px 12px;border-left:3px solid #444444;color:#555555;font-size:14px;line-height:1.75;font-family:Menlo,Consolas,monospace;";

function renderBlock(block) {
  if (block.type === "heading") {
    const level = Math.min(Math.max(block.level, 2), 3);
    return { html: `<h${level} style="${H}">${block.html}</h${level}>`, text: block.text, links: block.links || [] };
  }
  if (block.type === "quote") {
    return { html: `<blockquote style="${Q}">${block.html}</blockquote>`, text: block.text, links: block.links || [] };
  }
  if (block.type === "code") {
    return {
      html: `<pre style="margin:0 0 16px;padding:12px;background:#f6f6f6;overflow:auto;font-size:13px;line-height:1.6;"><code>${escapeHtml(block.text)}</code></pre>`,
      text: block.text,
      links: [],
    };
  }
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    const items = block.items.map((item) => `<li>${item.html}</li>`).join("");
    return {
      html: `<${tag} style="margin:0 0 16px;padding-left:1.2em;line-height:1.8;font-size:16px;">${items}</${tag}>`,
      text: block.items.map((item) => item.text).join("\n"),
      links: block.items.flatMap((item) => item.links || []),
    };
  }
  if (block.type === "paragraph") {
    return { html: `<p style="${P}">${block.html}</p>`, text: block.text, links: block.links || [] };
  }
  return { html: "", text: "", links: [] };
}

export function buildArticle({ parsed, images, title, digest, sourceUrl }) {
  const resolvedTitle = normalizeText(title || parsed.title);
  const digestClip = clipDigest(digest || parsed.description || "");
  const fidelity = [];
  if (digestClip.trimmed) fidelity.push("digest was trimmed to 120 characters");
  if ([...resolvedTitle].length > TITLE_MAX) {
    return { ok: false, error: `title is ${[...resolvedTitle].length} characters; WeChat allows ${TITLE_MAX}` };
  }
  if (!resolvedTitle) return { ok: false, error: "title is empty" };
  const imageBlocks = parsed.blocks.filter((block) => block.type === "image");
  if (imageBlocks.length !== images.length) {
    return { ok: false, error: "image count does not match resolved files" };
  }
  const segments = [];
  let html = "";
  let text = "";
  const snippets = [];
  const links = [];
  let imageCursor = 0;
  const flush = () => {
    if (!html) return;
    segments.push({ kind: "html", html, text });
    html = "";
    text = "";
  };
  for (const block of parsed.blocks) {
    if (block.type === "image") {
      flush();
      const file = images[imageCursor];
      imageCursor += 1;
      segments.push({
        kind: "image",
        alt: block.alt,
        src: block.src,
        path: file.path,
        sha256: file.sha256,
        index: imageCursor - 1,
      });
      continue;
    }
    const rendered = renderBlock(block);
    html += rendered.html;
    text += `${rendered.text}\n`;
    if (normalizeText(rendered.text)) snippets.push(rendered.text);
    links.push(...rendered.links);
    if (block.type === "code" && block.lang === "mermaid") {
      fidelity.push("mermaid source was kept as text; the diagram was not rendered");
    }
    if (block.type === "code") fidelity.push("code highlighting is not available in the Official Account editor");
  }
  flush();
  fidelity.push("body font is set toward the blog's monospace hierarchy; WeChat may strip font-family");
  fidelity.push("images are uploaded into the draft instead of left as remote hotlinks");
  fidelity.push("categories and tags are not copied; the editor has no safe equivalent field");
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    title: resolvedTitle,
    snippets: snippets.map(normalizeText),
    images: images.map((image) => image.sha256),
  })).digest("hex");
  return {
    ok: true,
    title: resolvedTitle,
    digest: digestClip.text,
    sourceUrl: sourceUrl || "",
    segments,
    snippets,
    links,
    imageCount: images.length,
    images: images.map((image) => ({
      alt: image.alt,
      name: image.name,
      bytes: image.bytes,
      sha256: image.sha256,
      remote: Boolean(image.remote),
    })),
    fidelity: [...new Set(fidelity)],
    hash,
  };
}

export function decideAccount(probe, expectAccount = "") {
  const accounts = [...new Set((probe && probe.accounts) || [])].filter(Boolean);
  const loggedOut = !probe || probe.loginWall || !probe.loggedIn;
  if (loggedOut) {
    return { ok: false, exitCode: 2, loginRequired: true, accounts, reason: "logged-out" };
  }
  if (probe.ambiguous || accounts.length > 1) {
    return { ok: false, exitCode: 4, loginRequired: false, accounts, reason: "ambiguous-account" };
  }
  if (accounts.length !== 1) {
    return { ok: false, exitCode: 4, loginRequired: false, accounts, reason: "unidentified-account" };
  }
  const account = accounts[0];
  if (expectAccount && account !== expectAccount) {
    return {
      ok: false,
      exitCode: 2,
      loginRequired: true,
      account,
      accounts,
      reason: "account-mismatch",
    };
  }
  return { ok: true, exitCode: 0, account, accounts, reason: "ok" };
}

export function decideSave({ yes, receipt, drafts, draftsListed, hash, title }) {
  if (!yes) return { action: "dry-run", exitCode: 3, save: false };
  const same = receipt && receipt.hash === hash;
  if (same && receipt.status === "saved") {
    return { action: "already-saved", exitCode: 0, save: false, receipt };
  }
  if (same && (receipt.status === "pending" || receipt.status === "uncertain")) {
    if (!draftsListed) return { action: "reconcile-first", exitCode: 0, save: false };
    const want = normalizeText(title);
    const matches = (drafts || []).filter((row) => row && normalizeText(row.title) === want);
    if (matches.length > 1) {
      return { action: "ambiguous-draft", exitCode: 4, save: false, matches };
    }
    if (matches.length === 1) {
      return { action: "reconciled", exitCode: 0, save: false, match: matches[0], receipt };
    }
    return { action: "save", exitCode: 0, save: true, reason: "reconciled-missing" };
  }
  return { action: "save", exitCode: 0, save: true, reason: same ? "retry-aborted" : "new" };
}

export function validateReadback(expected, actual) {
  const titleOk = normalizeText(actual && actual.title) === normalizeText(expected.title);
  const imageCount = actual && typeof actual.imageCount === "number" ? actual.imageCount : -1;
  const imagesOk = imageCount === expected.imageCount;
  const haystack = normalizeText(actual && actual.text);
  const missing = [];
  for (const snippet of expected.snippets || []) {
    const needle = normalizeText(snippet);
    if (needle.length < 2) continue;
    if (!haystack.includes(needle)) missing.push(needle.slice(0, 80));
  }
  const hrefs = new Set(actual && actual.hrefs || []);
  const missingHrefs = (expected.links || [])
    .filter((link) => link.href && !hrefs.has(link.href))
    .map((link) => link.href);
  return {
    ok: titleOk && imagesOk && missing.length === 0,
    titleOk,
    imagesOk,
    missing,
    missingHrefs,
    imageCount,
  };
}

export function planOf(article, account) {
  return {
    title: article.title,
    hash: article.hash,
    account: account || "",
    imageCount: article.imageCount,
    images: article.images,
    fidelity: article.fidelity,
    digest: article.digest,
    sourceUrl: article.sourceUrl,
    save: false,
  };
}

export function egoMissingSummary(command) {
  return {
    ok: false,
    exitCode: 2,
    command,
    error: "ego-browser not found",
    ...howToLogin(["ego-browser was not on PATH or ~/.local/bin."]),
  };
}

export function formatResult(summary, { asJson = false } = {}) {
  if (!summary || typeof summary !== "object") return "";
  if (!asJson && summary.exitCode === 0 && summary.saved && summary.title) {
    const id = summary.draftId ? ` id=${summary.draftId}` : "";
    const account = summary.account ? ` account=${summary.account}` : "";
    return `saved ${summary.title}${account}${id}\n`;
  }
  return `${JSON.stringify(summary, null, 2)}\n`;
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
      // Keep scanning; a log line may contain the tag prefix.
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
  if (env.WECHAT_ARTICLE_EGO_RECEIPT_DIR) return env.WECHAT_ARTICLE_EGO_RECEIPT_DIR;
  if (!home) return "";
  return `${home}/.local/state/wechat-article-ego/receipts`;
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
