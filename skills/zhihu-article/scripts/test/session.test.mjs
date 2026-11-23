import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createZhihuSession } from "../lib/session.mjs";
import { createDocument, h } from "./dom-fixture.mjs";

function editorPage() {
  const title = h("textarea", { placeholder: "请输入标题" });
  const body = h("div", { className: "public-DraftEditor-content", editable: true, text: "一段说明" });
  const image = h("input", { type: "file", accept: "image/png", attrs: { multiple: "true" }, zero: true });
  const imageControl = h("button", { attrs: { "aria-label": "图片" } }, [image]);
  const cover = h("input", { type: "file", accept: "image/png", className: "UploadPicture-input", zero: true });
  const draft = h("button", {}, ["保存草稿"]);
  const publish = h("button", {}, ["发布"]);
  const badge = h("span", {}, ["已保存"]);
  const profile = h("a", { attrs: { href: "/people/example" } }, ["示例作者"]);
  const header = h("header", { className: "AppHeader" }, [profile, h("a", {}, ["创作中心"])]);
  createDocument(h("body", {}, [header, title, body, imageControl, cover, draft, publish, badge]), {
    href: "https://zhuanlan.zhihu.com/write",
  });
  const calls = { files: 0, fills: 0, pastes: 0 };
  const page = {
    async goto() {},
    async url() { return globalThis.location.href; },
    async evaluate(fn, payload) { return fn(payload); },
    async fill(_selector, value) {
      calls.fills += 1;
      title.value = value;
    },
    async setInputFiles() { calls.files += 1; },
    keyboard: {
      async paste() { calls.pastes += 1; },
      async insertText(value) { title.value = value; },
    },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async screenshot() { return Buffer.from("png"); },
  };
  return { page, calls, title, body, draft, publish };
}

function taskWith(page, extra = {}) {
  const finished = [];
  return {
    task: {
      spaceId: "space-1",
      async finish(options) { finished.push(options); },
    },
    page,
    finished,
    ...extra,
  };
}

test("session fills, pastes, and clicks draft save once", async () => {
  const built = editorPage();
  const wrapped = taskWith(built.page);
  const session = createZhihuSession({ ...wrapped, timings: { waitMs: 0, uploadAttempts: 2, autosaveAttempts: 2 } });
  await session.goto("https://www.zhihu.com/");
  const probe = await session.probe();
  assert.equal(probe.loggedIn, true);
  const title = await session.fillTitle("示例标题");
  assert.equal(title.ok, true);
  assert.equal(built.calls.fills, 1);
  const pasted = await session.pasteBody("<p>一段说明</p>", "一段说明");
  assert.equal(pasted.ok, true);
  assert.equal(built.calls.pastes, 1);
  const clicked = await session.clickDraftSave();
  assert.equal(clicked.clicked, true);
  const again = await session.clickDraftSave();
  assert.equal(again.duplicate, true);
  assert.equal(built.draft.clicked, 1);
  assert.equal(built.publish.clicked, 0);
  await session.finish();
  await session.finish();
  assert.deepEqual(wrapped.finished, [{ keep: [] }]);
});

test("upload and autosave timeouts do not submit twice", async () => {
  const built = editorPage();
  const session = createZhihuSession({
    ...taskWith(built.page),
    timings: { waitMs: 0, uploadAttempts: 1, autosaveAttempts: 1 },
  });
  const image = await session.uploadBodyImage("/absolute/path/to/image.png");
  assert.equal(image.ok, false);
  assert.equal(image.submitted, true);
  assert.equal(image.code, "upload-timeout");
  assert.equal(built.calls.files, 1);
  const cover = await session.uploadCover("/absolute/path/to/cover.png");
  assert.equal(cover.code, "upload-timeout");
  assert.equal(built.calls.files, 2);
  const waited = await session.waitForSavedDraft();
  assert.equal(waited.timedOut, true);
  assert.equal(waited.draftId, "");
});

test("upload succeeds when the editor shows the image and cover", async () => {
  const built = editorPage();
  built.page.setInputFiles = async (selector) => {
    built.calls.files += 1;
    if (String(selector).includes("cover")) {
      const preview = h("img", { className: "UploadPicture-preview", attrs: { src: "blob:cover" } });
      globalThis.document.body.childNodes.push(preview);
      return;
    }
    const img = h("img", { attrs: { src: "blob:body" } });
    built.body.childNodes.push(img);
  };
  const session = createZhihuSession({ ...taskWith(built.page), timings: { waitMs: 0, uploadAttempts: 2, autosaveAttempts: 1 } });
  const image = await session.uploadBodyImage("/absolute/path/to/image.png");
  assert.equal(image.ok, true);
  assert.equal(image.imageCount, 1);
  const cover = await session.uploadCover("/absolute/path/to/cover.png");
  assert.equal(cover.coverApplied, true);
  globalThis.location = new URL("https://zhuanlan.zhihu.com/p/15/edit");
  const saved = await session.waitForSavedDraft();
  assert.equal(saved.draftId, "15");
  assert.equal(saved.autosaveLabel, "已保存");
});

test("missing browser APIs and evaluate failures stay fail-closed", async () => {
  assert.throws(() => createZhihuSession({}), /requires task and page/);
  const idle = createZhihuSession(taskWith({
    async evaluate() { return { ok: true, url: "" }; },
    async goto() {},
    async waitForLoadState() { throw new Error("idle"); },
    async url() { throw new Error("url"); },
  }));
  await idle.goto("https://www.zhihu.com/");
  assert.equal((await idle.readEditor()).url, "");
  const page = {
    async evaluate() { return null; },
    async goto() { throw new Error("navigation failed"); },
  };
  const session = createZhihuSession(taskWith(page));
  const probe = await session.probe();
  assert.equal(probe.evaluateFailed, true);
  assert.equal(probe.loginWall, false);
  await assert.rejects(session.goto("https://www.zhihu.com/"), /navigation failed/);
  const throwing = {
    async evaluate() { throw new Error("evaluate exploded"); },
    async goto() {},
    async url() { throw new Error("url"); },
  };
  const broken = createZhihuSession(taskWith(throwing));
  assert.equal((await broken.probe()).evaluateFailed, true);
  assert.equal((await broken.probe()).loginWall, false);
  assert.match((await broken.readEditor()).error, /evaluate exploded/);
  const bare = editorPage();
  delete bare.page.fill;
  delete bare.page.keyboard.paste;
  delete bare.page.setInputFiles;
  bare.page.keyboard.insertText = undefined;
  const limited = createZhihuSession({ ...taskWith(bare.page), timings: { waitMs: 0 } });
  const titled = await limited.fillTitle("示例标题");
  assert.equal(titled.ok, true);
  assert.match((await limited.pasteBody("<p>x</p>", "x")).error, /keyboard.paste/);
  assert.match((await limited.uploadBodyImage("/absolute/path/to/image.png")).error, /setInputFiles/);
  assert.match((await limited.uploadCover("/absolute/path/to/cover.png")).error, /setInputFiles/);
  bare.page.fill = async () => { throw new Error("fill broke"); };
  assert.match((await limited.fillTitle("示例标题")).error, /title fill failed/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-shot-"));
  const shotPage = editorPage().page;
  shotPage.screenshot = async () => { throw new Error("shot"); };
  const shots = createZhihuSession({ ...taskWith(shotPage), fsImpl: fs });
  assert.equal(await shots.capture("", "failed"), "");
  assert.equal(await shots.capture(dir, "failed"), "");
  const seen = [];
  shotPage.screenshot = async (options) => {
    seen.push(options);
    if (!options || !options.path || options.type) throw new Error("path required");
    await fs.promises.writeFile(options.path, Buffer.from("png"));
    return options.path;
  };
  const written = await shots.capture(dir, "image-control-ambiguous");
  assert.match(written, /zhihu-article-image-control-ambiguous\.png/);
  assert.equal(fs.existsSync(written), true);
  assert.equal(seen[0].type, undefined);
  assert.equal(path.isAbsolute(seen[0].path), true);
  shotPage.screenshot = async (options) => {
    if (!options || !options.path) throw new Error("path required");
    return Buffer.from("png");
  };
  const buffered = await shots.capture(dir, "unverified");
  assert.match(buffered, /zhihu-article-unverified\.png/);
  assert.equal(fs.readFileSync(buffered).toString(), "png");
  const noShot = createZhihuSession(taskWith({ async evaluate() { return { ok: true }; }, async goto() {} }));
  assert.equal(await noShot.capture(dir, "failed"), "");
});
