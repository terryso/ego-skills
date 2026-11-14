// Resolve local 贴图 images and body text into the portable post model.
import fs from "node:fs";
import path from "node:path";
import { buildTietu, inspectImage } from "./tietu.mjs";

function readError(error, label, file) {
  const name = path.basename(String(file || label));
  if (error && error.code === "ENOENT") return `${label} not found: ${name}`;
  return error && error.message ? error.message : String(error);
}

export async function prepareTietu(options) {
  const fsImpl = options.fsImpl || fs;
  const images = [];
  try {
    for (const file of options.images || []) {
      let buf;
      try {
        buf = await fsImpl.promises.readFile(file);
      } catch (error) {
        return { ok: false, error: readError(error, "image", file) };
      }
      const inspected = inspectImage(buf, path.basename(file));
      if (!inspected.ok) return inspected;
      images.push({
        name: path.basename(file),
        path: path.resolve(file),
        bytes: inspected.bytes,
        sha256: inspected.sha256,
      });
    }
    let text = options.text || "";
    if (options.textFile) {
      try {
        text = await fsImpl.promises.readFile(options.textFile, "utf8");
      } catch (error) {
        return { ok: false, error: readError(error, "text file", options.textFile) };
      }
    }
    const post = buildTietu({
      title: options.title || "",
      text,
      topics: options.topics || [],
      images,
    });
    if (!post.ok) return post;
    return { ok: true, post };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}
