import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyImageRef, createReceiptStore, prepareArticle, validateRequest, withinRoot } from "../lib/prepare.mjs";
import { IMAGE_MAX_BYTES } from "../lib/pure.mjs";
import { COVER, jpeg, png } from "./images.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-article-"));
}

test("prepare accepts local png and jpg and rejects bad images without fetching", async () => {
  const dir = tempDir();
  const image = path.join(dir, "image.png");
  const photo = path.join(dir, "photo.jpg");
  const cover = path.join(dir, "cover.png");
  fs.writeFileSync(image, png());
  fs.writeFileSync(photo, jpeg());
  fs.writeFileSync(cover, png(COVER));
  const markdown = path.join(dir, "article.md");
  fs.writeFileSync(markdown, `---\ntitle: 示例标题\n---\n\n一段说明。\n\n![配图](image.png)\n\n![照片](${photo})\n`);
  let fetched = false;
  const prepared = await prepareArticle({
    command: "preview",
    markdown,
    cover,
    fetchImpl() { fetched = true; },
  });
  assert.equal(fetched, false);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.article.imageCount, 2);
  assert.equal(prepared.article.cover.name, "cover.png");
  assert.equal(prepared.article.segments.some((segment) => segment.path && segment.path.includes(photo)), true);

  const remote = path.join(dir, "remote.md");
  fs.writeFileSync(remote, "title is set\n\n![远端](https://example.com/a.png)\n");
  const blocked = await prepareArticle({ command: "preview", markdown: remote, title: "示例标题" });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.unsupported.some((item) => item.id === "remote-image"));

  fs.writeFileSync(path.join(dir, "bad.png"), Buffer.from("not an image file padded to thirty two!!"));
  fs.writeFileSync(path.join(dir, "bad.md"), "![坏](bad.png)\n");
  const malformed = await prepareArticle({ command: "preview", markdown: path.join(dir, "bad.md"), title: "示例标题" });
  assert.match(malformed.error, /malformed image/);

  fs.writeFileSync(path.join(dir, "anim.gif"), Buffer.from(`GIF89a${"x".repeat(40)}`));
  fs.writeFileSync(path.join(dir, "gif.md"), "![动图](anim.gif)\n");
  const gif = await prepareArticle({ command: "preview", markdown: path.join(dir, "gif.md"), title: "示例标题" });
  assert.match(gif.error, /unsupported image type/);

  const tiny = path.join(dir, "tiny.png");
  fs.writeFileSync(tiny, png({ width: 10, height: 10 }));
  const smallCover = await prepareArticle({
    command: "preview",
    markdown,
    cover: tiny,
  });
  assert.match(smallCover.error, /wider than/);

  const mismatch = path.join(dir, "really.jpg");
  fs.writeFileSync(mismatch, png());
  fs.writeFileSync(path.join(dir, "mismatch.md"), "![错](really.jpg)\n");
  const ext = await prepareArticle({ command: "preview", markdown: path.join(dir, "mismatch.md"), title: "示例标题" });
  assert.match(ext.error, /extension/);

  const huge = path.join(dir, "huge.png");
  const big = Buffer.alloc(IMAGE_MAX_BYTES + 1);
  png().copy(big);
  fs.writeFileSync(huge, big);
  fs.writeFileSync(path.join(dir, "huge.md"), "![大](huge.png)\n");
  const over = await prepareArticle({ command: "preview", markdown: path.join(dir, "huge.md"), title: "示例标题" });
  assert.match(over.error, /exceeds/);
});

test("relative images cannot escape the article directory", async () => {
  const root = tempDir();
  const articleDir = path.join(root, "article");
  const outside = path.join(root, "outside.png");
  fs.mkdirSync(articleDir);
  fs.writeFileSync(outside, png());
  fs.writeFileSync(path.join(articleDir, "inside.png"), png());
  const markdown = path.join(articleDir, "post.md");
  assert.equal(withinRoot(path.join(articleDir, "inside.png"), articleDir), true);
  assert.throws(() => classifyImageRef(markdown, "../outside.png"), /escapes/);
  assert.throws(() => classifyImageRef(markdown, "https://example.com/a.png"), /remote/);
  assert.throws(() => classifyImageRef(markdown, "data:image/png;base64,aaaa"), /remote/);
  assert.throws(() => classifyImageRef(markdown, "javascript:alert"), /unsupported image reference/);
  assert.equal(classifyImageRef(markdown, "inside.png"), path.join(articleDir, "inside.png"));
  assert.equal(classifyImageRef(markdown, outside), outside);
  const assetRoot = path.join(root, "assets");
  fs.mkdirSync(assetRoot);
  fs.writeFileSync(path.join(assetRoot, "extra.png"), png());
  assert.equal(classifyImageRef(markdown, "../assets/extra.png", assetRoot), path.join(assetRoot, "extra.png"));

  fs.writeFileSync(markdown, "![逃](../outside.png)\n");
  const escaped = await prepareArticle({ command: "preview", markdown, title: "示例标题" });
  assert.match(escaped.error, /escapes/);
  const missing = await prepareArticle({ command: "preview", markdown: path.join(articleDir, "missing.md"), title: "示例标题" });
  assert.match(missing.error, /cannot read article/);
  fs.writeFileSync(path.join(articleDir, "gone.md"), "![缺](missing.png)\n");
  const gone = await prepareArticle({ command: "preview", markdown: path.join(articleDir, "gone.md"), title: "示例标题" });
  assert.match(gone.error, /cannot read image/);
});

test("input validation and plain text stay offline", async () => {
  assert.match(validateRequest({ textSet: true, text: "正文" }, "preview").error, /--title is required/);
  assert.match(validateRequest({ markdown: "article.md" }, "preview").error, /absolute/);
  assert.match(validateRequest({ textFileSet: true, textFile: "body.txt", title: "标题" }, "preview").error, /absolute/);
  assert.match(validateRequest({ markdown: "/absolute/path/to/article.md", cover: "cover.png" }, "preview").error, /cover path/);
  assert.match(validateRequest({ markdown: "/absolute/path/to/article.md", assetRoot: "assets" }, "preview").error, /asset root/);
  assert.match(validateRequest({}, "preview").error, /exactly one/);
  assert.equal(validateRequest({}, "check").ok, true);
  const dir = tempDir();
  const body = path.join(dir, "body.txt");
  fs.writeFileSync(body, "第一段\n第二段");
  const prepared = await prepareArticle({ command: "preview", textFileSet: true, textFile: body, title: "纯文本标题" });
  assert.equal(prepared.ok, true);
  assert.match(prepared.article.segments[0].html, /第一段<br>第二段/);
  const direct = await prepareArticle({ command: "save", textSet: true, text: "只有一段", title: "标题" });
  assert.equal(direct.article.title, "标题");
});

test("receipts are per hash and an unreadable file blocks a retry", () => {
  const dir = tempDir();
  const store = createReceiptStore();
  assert.equal(store.read(dir, "abc"), null);
  const file = store.write(dir, { hash: "abc", state: "draft-saved", verified: true, draftId: "1" });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.read(dir, "abc").draftId, "1");
  fs.writeFileSync(file, "{");
  assert.equal(store.read(dir, "abc").unreadable, true);
  fs.writeFileSync(file, JSON.stringify({ hash: "other" }));
  assert.equal(store.read(dir, "abc").unreadable, true);
  assert.throws(() => store.write("", { hash: "abc" }), /empty/);
});
