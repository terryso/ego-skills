// Resolve a local Markdown or plain article and its PNG/JPG files.
// Remote images are rejected. Nothing is downloaded.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildArticle,
  inspectImage,
  isAbsolutePath,
  parseMarkdown,
  parsePlain,
} from "./pure.mjs";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function withinRoot(file, root) {
  const abs = path.resolve(file);
  const base = path.resolve(root);
  return abs === base || abs.startsWith(`${base}${path.sep}`);
}

export function classifyImageRef(markdownPath, raw, assetRoot = "") {
  const ref = String(raw || "").trim();
  if (!ref) throw new Error("image path is empty");
  if (/^https?:\/\//i.test(ref) || /^data:/i.test(ref)) throw new Error("remote images are unsupported");
  if (/^[a-z]+:/i.test(ref)) throw new Error(`unsupported image reference: ${path.basename(ref)}`);
  if (path.isAbsolute(ref)) return path.resolve(ref);
  if (!markdownPath) throw new Error("relative images require a markdown file");
  const markdownDir = path.dirname(path.resolve(markdownPath));
  const abs = path.resolve(markdownDir, ref);
  const roots = [markdownDir, assetRoot].filter(Boolean);
  if (!roots.some((root) => withinRoot(abs, root))) throw new Error("image path escapes the article directory");
  return abs;
}

async function readImage(file, fsImpl, role) {
  let buf;
  try {
    buf = await fsImpl.promises.readFile(file);
  } catch (error) {
    return { ok: false, error: `cannot read image ${path.basename(file)}: ${error.code || "error"}` };
  }
  const inspected = inspectImage(buf, path.basename(file), { role });
  if (!inspected.ok) return inspected;
  return {
    ok: true,
    name: path.basename(file),
    path: file,
    bytes: buf.length,
    sha256: sha256(buf),
    width: inspected.width,
    height: inspected.height,
    type: inspected.type,
  };
}

function inputError(message) {
  return { ok: false, error: message, state: "failed" };
}

export function validateRequest(args, command) {
  if (command === "check" || command === "cleanup") return { ok: true };
  const modes = [
    args.markdown ? "markdown" : "",
    args.textSet ? "text" : "",
    args.textFileSet ? "text-file" : "",
  ].filter(Boolean);
  if (modes.length !== 1) return inputError("pass exactly one of --markdown, --text, or --text-file");
  if (args.markdown && !isAbsolutePath(args.markdown)) return inputError("markdown path must be absolute");
  if (args.textFile && !isAbsolutePath(args.textFile)) return inputError("text file path must be absolute");
  if ((args.textSet || args.textFileSet) && !String(args.title || "").trim()) {
    return inputError("--title is required with --text or --text-file");
  }
  if (args.cover && !isAbsolutePath(args.cover)) return inputError("cover path must be absolute");
  if (args.assetRoot && !isAbsolutePath(args.assetRoot)) return inputError("asset root must be absolute");
  if (args.receiptDir && !isAbsolutePath(args.receiptDir)) return inputError("receipt dir must be absolute");
  if (args.screenshotDir && !isAbsolutePath(args.screenshotDir)) return inputError("screenshot dir must be absolute");
  return { ok: true };
}

export async function prepareArticle(options) {
  const fsImpl = options.fsImpl || fs;
  const request = validateRequest(options, options.command || "preview");
  if (!request.ok) return request;
  let parsed;
  try {
    if (options.markdown) {
      const source = await fsImpl.promises.readFile(options.markdown, "utf8");
      parsed = parseMarkdown(source);
    } else if (options.textFileSet) {
      const source = await fsImpl.promises.readFile(options.textFile, "utf8");
      parsed = parsePlain(source, options.title);
    } else {
      parsed = parsePlain(options.text, options.title);
    }
  } catch (error) {
    return inputError(`cannot read article: ${error.code || "error"}`);
  }
  if (!parsed.ok) {
    return { ok: false, error: "unsupported markdown", unsupported: parsed.unsupported, state: "failed" };
  }
  const refs = parsed.blocks.filter((block) => block.type === "image");
  const images = [];
  try {
    for (const block of refs) {
      const file = classifyImageRef(options.markdown, block.src, options.assetRoot || "");
      const read = await readImage(file, fsImpl, "body");
      if (!read.ok) return { ...read, state: "failed" };
      images.push({ ...read, alt: block.alt });
    }
    let cover = null;
    if (options.cover) {
      const read = await readImage(options.cover, fsImpl, "cover");
      if (!read.ok) return { ...read, state: "failed" };
      cover = read;
    }
    const article = buildArticle({
      parsed,
      images,
      cover,
      title: options.title || "",
    });
    if (!article.ok) return { ...article, state: "failed" };
    return { ok: true, article };
  } catch (error) {
    return inputError(error.message);
  }
}

export function receiptFile(dir, hash) {
  return path.join(dir, `${hash}.json`);
}

export function createReceiptStore(fsImpl = fs) {
  return {
    read(dir, hash) {
      if (!dir || !hash) return null;
      const file = receiptFile(dir, hash);
      if (!fsImpl.existsSync(file)) return null;
      try {
        const parsed = JSON.parse(fsImpl.readFileSync(file, "utf8"));
        if (!parsed || parsed.hash !== hash) return { hash, state: "unverified", unreadable: true };
        return parsed;
      } catch {
        return { hash, state: "unverified", unreadable: true };
      }
    },
    write(dir, receipt) {
      if (!dir) throw new Error("receipt dir is empty");
      fsImpl.mkdirSync(dir, { recursive: true });
      const file = receiptFile(dir, receipt.hash);
      const tmp = `${file}.tmp`;
      const body = `${JSON.stringify(receipt, null, 2)}\n`;
      fsImpl.writeFileSync(tmp, body, { mode: 0o600 });
      fsImpl.renameSync(tmp, file);
      return file;
    },
  };
}
