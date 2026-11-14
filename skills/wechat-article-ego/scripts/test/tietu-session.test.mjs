import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { h, createDocument } from "./dom-fixture.mjs";
import { tietuAct } from "../lib/tietu-dom.mjs";
import { createTietuSession } from "../lib/tietu-session.mjs";
import { TIETU_FILE_INPUT, tietuEditorUrl, tietuListUrl, uploadAdvanced } from "../lib/tietu.mjs";

function editorTree({ titleText = "", saved = "01:23 已保存", appmsgid = "" } = {}) {
  const title = h("div", { className: "ProseMirror", editable: true, text: titleText });
  const topic = h("a", { className: "wx_topic_link", text: "#编程Agent", attrs: { "topic-id": "1", "data-topic": "1" } });
  const picture = h("img", { attrs: { src: "https://mmbiz.example/a.jpg" } });
  const blank = h("img", { attrs: { src: "about:blank" } });
  const body = h("div", { className: "ProseMirror", editable: true, text: "贴图说明\nhttps://example.com/tietu" }, [topic, picture, blank]);
  const hidden = h("button", { text: "保存为草稿", attrs: { hidden: "" } });
  const invisible = h("button", { text: "保存为草稿", attrs: { "aria-hidden": "true" } });
  const unrected = h("button", { text: "保存为草稿" });
  unrected.getClientRects = () => [];
  const decoy = h("div", { text: "保存为草稿" });
  const span = h("span", { text: "保存为草稿" });
  const save = h("button", { text: "保存为草稿" });
  save.getClientRects = () => [{ width: 40, height: 20 }];
  const publish = h("button", { text: "发表" });
  const preview = h("button", { text: "预览" });
  const menuInput = h("input", { type: "file" });
  const mainInput = h("input", { type: "file" });
  const root = h("div", { text: saved }, [
    title, body, hidden, invisible, unrected, decoy, span, save, publish, preview, menuInput, mainInput,
  ]);
  const href = appmsgid
    ? tietuEditorUrl({ token: "test-token", appmsgid })
    : tietuEditorUrl({ token: "test-token" });
  const doc = createDocument(root, { href });
  return { doc, title, body, save, publish, preview, span };
}

test("tietuAct reads the editor, focuses without clicking the body, and only clicks 保存为草稿", () => {
  assert.deepEqual(tietuAct({ op: "probe" }), { ok: false, error: "tietuAct requires a document" });
  const built = editorTree();
  let ranged = 0;
  built.doc.createRange = () => ({
    selectNodeContents() { ranged += 1; },
    collapse() {},
  });
  globalThis.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  const state = tietuAct({ op: "editor-state" });
  assert.equal(state.editorReady, true);
  assert.equal(state.type, 77);
  assert.equal(state.imageCount, 1);
  assert.equal(state.fileInputs, 2);
  assert.deepEqual(state.topics, ["#编程Agent"]);
  assert.equal(state.savedTime, "01:23");
  assert.equal(state.saved, true);
  assert.equal(state.hasToken, true);
  assert.equal(tietuAct({ op: "session-token" }).token, "test-token");
  const titled = tietuAct({ op: "focus-title" });
  assert.equal(titled.via, "click");
  assert.equal(built.title.clicked, 1);
  assert.equal(built.title.focused, true);
  const focused = tietuAct({ op: "focus-body" });
  assert.equal(focused.via, "focus");
  assert.equal(built.body.clicked, 0);
  assert.equal(built.body.focused, true);
  assert.ok(ranged >= 2);
  globalThis.getSelection = () => { throw new Error("selection failed"); };
  assert.equal(tietuAct({ op: "focus-body" }).ok, true);
  globalThis.getSelection = () => null;
  assert.equal(tietuAct({ op: "focus-title" }).ok, true);
  const clicked = tietuAct({ op: "click-save-draft" });
  assert.equal(clicked.label, "保存为草稿");
  assert.equal(built.save.clicked, 1);
  assert.equal(built.publish.clicked, 0);
  assert.equal(built.preview.clicked, 0);
  assert.equal(built.span.clicked, 0);
  const read = tietuAct({ op: "read-editor" });
  assert.match(read.text, /example\.com/);
  assert.equal(tietuAct({ op: "scroll", where: "end" }).ok, true);
  assert.equal(tietuAct({ op: "scroll", where: "middle" }).top > 0, true);
  assert.equal(tietuAct({ op: "nope" }).ok, false);

  const card = h("div", { text: "09:41" }, [
    h("a", {
      className: "weui-desktop-publish__cover__title",
      text: "题",
      attrs: { href: "/cgi-bin/appmsg?action=edit&appmsgid=42" },
    }),
  ]);
  const timed = h("a", {
    className: "weui-desktop-publish__cover__title",
    text: "另一题",
    attrs: { "data-appmsgid": "7", "data-time": "08:08" },
  });
  const banned = h("a", { className: "weui-desktop-publish__cover__title", text: "发表" });
  const blankTitle = h("a", { className: "weui-desktop-publish__cover__title", text: "" });
  createDocument(h("div", {}, [card, timed, banned, blankTitle]), {
    href: tietuListUrl({ token: "test-token" }),
  });
  const rows = tietuAct({ op: "draft-cards" }).rows;
  assert.equal(rows[0].id, "42");
  assert.equal(rows[0].time, "09:41");
  assert.equal(rows[1].id, "7");
  assert.equal(rows[1].time, "08:08");
  assert.equal(rows.some((row) => row.title === "发表"), false);

  createDocument(h("div", {}, [h("div", { className: "ProseMirror", text: "只有标题" })]));
  assert.match(tietuAct({ op: "focus-body" }).error, /body field/);
  globalThis.document = { body: null, querySelectorAll() { return []; } };
  globalThis.location = new URL("https://mp.weixin.qq.com/");
  assert.match(tietuAct({ op: "scroll" }).error, /nothing to scroll/);
  globalThis.location = new URL("https://example.com/?token=test-token");
  globalThis.document = createDocument(h("div", { text: "别处" }), { href: "https://example.com/?token=test-token" });
  assert.equal(tietuAct({ op: "session-token" }).token, "");
  delete globalThis.getSelection;
});

test("createTietuSession requires a page and probes the console", async () => {
  assert.throws(() => createTietuSession({}), /requires a page/);
  const home = h("div", { text: "新的创作 草稿箱" }, [
    h("div", { className: "weui-desktop-account__nickname", text: "听懂 AI" }),
  ]);
  createDocument(home, { href: "https://mp.weixin.qq.com/?token=test-token&lang=zh_CN" });
  const page = { async evaluate(fn, arg) { return fn(arg); } };
  const session = createTietuSession({ page, task: { async finish() {} }, timings: { attempts: 1, waitMs: 0 } });
  const probe = await session.probe();
  assert.equal(probe.accounts[0], "听懂 AI");
  page.evaluate = async () => { throw new Error("probe down"); };
  const wall = await session.probe();
  assert.equal(wall.loginWall, true);
});

test("openEditor follows the 贴图 popup, then the signed-in editor url", async () => {
  const homeHref = "https://mp.weixin.qq.com/?token=test-token&lang=zh_CN";
  const homeDoc = createDocument(h("div", {}, [
    h("button", { text: "新的创作" }),
    h("button", { text: "贴图" }),
  ]), { href: homeHref });
  const editor = editorTree();
  const editorHref = tietuEditorUrl({ token: "test-token" });
  const state = { mode: "home", urls: [], label: "" };
  const show = (which) => {
    if (which === "editor") {
      globalThis.document = editor.doc;
      globalThis.location = new URL(editorHref);
    } else {
      globalThis.document = homeDoc;
      globalThis.location = new URL(homeHref);
    }
  };
  const editorPage = {
    async evaluate(fn, arg) { show("editor"); return fn(arg); },
    async url() { return editorHref; },
    async goto(url) { state.urls.push(url); },
    async waitForTimeout() {},
    async waitForLoadState() {},
  };
  const page = {
    async evaluate(fn, arg) { show(state.mode); return fn(arg); },
    async url() { return state.mode === "editor" ? editorHref : homeHref; },
    async goto(url) { state.urls.push(url); state.mode = "editor"; },
    async waitForTimeout() {},
    async waitForLoadState() { throw new Error("still loading"); },
    async waitForEvent() { return { label: "p2" }; },
  };
  const task = {
    page(label) { state.label = label; return editorPage; },
    async finish(options) { state.finish = options; },
  };
  const popupSession = createTietuSession({ task, page, timings: { attempts: 2, waitMs: 0, popupMs: 20 } });
  const opened = await popupSession.openEditor();
  assert.equal(opened.editorReady, true);
  assert.equal(state.label, "p2");
  assert.equal(state.urls.length, 0);

  state.mode = "home";
  const directPage = {
    async evaluate(fn, arg) { show(state.mode); return fn(arg); },
    async url() { return homeHref; },
    async goto(url) { state.urls.push(url); state.mode = "editor"; show("editor"); },
    async waitForEvent() { return { label: "orphan" }; },
    async waitForLoadState() { throw new Error("still loading"); },
  };
  const direct = createTietuSession({
    task: {},
    page: directPage,
    timings: { attempts: 1, waitMs: 0, popupMs: 20 },
  });
  const viaUrl = await direct.openEditor();
  assert.equal(viaUrl.editorReady, true);
  assert.match(state.urls.at(-1), /type=77/);
  assert.match(state.urls.at(-1), /createType=8/);
  assert.doesNotMatch(state.urls.at(-1), /appmsgid=/);

  const blocked = createTietuSession({
    page: {
      async evaluate(fn, arg) {
        globalThis.document = createDocument(h("div", { text: "空" }), { href: "https://mp.weixin.qq.com/" });
        return fn(arg);
      },
      async url() { return "https://mp.weixin.qq.com/"; },
    },
    timings: { attempts: 1, waitMs: 0 },
  });
  await assert.rejects(() => blocked.openEditor(), /新的创作|did not open/);

  const forbidden = createTietuSession({
    page: {
      async evaluate(fn, arg) {
        if (arg && arg.text === "贴图") return { ok: false, forbidden: true, error: "refusing to click 贴图" };
        show("home");
        return fn(arg);
      },
      async waitForEvent() { return null; },
    },
    timings: { attempts: 1, waitMs: 0, popupMs: 20 },
  });
  await assert.rejects(() => forbidden.openEditor(), /refusing/);
});

test("upload, title, body, save, list, and reopen stay on the 贴图 editor", async () => {
  const editor = editorTree({ titleText: "旧标题" });
  const listHref = tietuListUrl({ token: "test-token" });
  const listDoc = createDocument(h("div", {}, [
    h("a", {
      className: "weui-desktop-publish__cover__title",
      text: "编程 agent 的尽头是修车",
      attrs: { "data-appmsgid": "100001815", "data-time": "01:23" },
    }),
  ]), { href: listHref });
  const editorHref = tietuEditorUrl({ token: "test-token" });
  let active = editor.doc;
  globalThis.document = editor.doc;
  globalThis.location = new URL(editorHref);
  const typed = [];
  const shots = [];
  let images = 0;
  const page = {
    async evaluate(fn, arg) {
      globalThis.document = active;
      return fn(arg);
    },
    async url() { return globalThis.location.href; },
    async setInputFiles(selector, files) {
      assert.equal(selector, TIETU_FILE_INPUT);
      typed.push(files[0]);
      images += 1;
      let selectorRoot = active.querySelector(".image-selector");
      if (!selectorRoot) {
        selectorRoot = h("div", { className: "image-selector" });
        active.body.childNodes.push(selectorRoot);
      }
      selectorRoot.childNodes.push(h("img", {
        className: "image-selector__preview-center-img",
        attrs: { src: `https://mmbiz.qpic.cn/content/${images}` },
      }));
      selectorRoot.childNodes.push(h("div", { className: "image-selector__strip" }, [
        h("img", { attrs: { src: `https://mmbiz.qpic.cn/content/${images}?wx_fmt=jpeg` } }),
      ]));
    },
    async goto(url) {
      typed.push(url);
      if (String(url).includes("list_card")) {
        active = listDoc;
        globalThis.document = listDoc;
        globalThis.location = new URL(listHref);
      } else {
        active = editor.doc;
        globalThis.document = editor.doc;
        globalThis.location = new URL(url);
      }
    },
    async waitForLoadState() {},
    async click(selector) { page.pointer = selector; },
    async screenshot({ path: file }) { shots.push(file); return file; },
    keyboard: {
      async insertText(value) { typed.push(value); },
      async press(key) { typed.push(key); },
    },
  };
  const task = { async finish(options) { page.finished = options; } };
  const session = createTietuSession({ task, page, timings: { attempts: 2, waitMs: 0, uploadWaitMs: 0 } });
  const uploaded = await session.uploadImages(["/absolute/path/cover.jpg", "/absolute/path/more.jpg"]);
  assert.equal(uploaded.imageCount >= 2, true);
  assert.deepEqual(typed.slice(0, 2), ["/absolute/path/cover.jpg", "/absolute/path/more.jpg"]);
  const titled = await session.fillTitle("编程 agent 的尽头是修车");
  assert.equal(titled.via, "insertText");
  assert.equal(typed.includes("Backspace"), true);
  await session.fillBody([
    { op: "insertText", value: "贴图说明" },
    { op: "enter" },
    { op: "insertText", value: "https://example.com/tietu" },
    { op: "enter" },
    { op: "insertText", value: "#" },
    { op: "insertText", value: "编程Agent" },
  ]);
  assert.equal(typed.includes("Enter"), true);
  assert.equal(typed.includes("#"), true);
  const saved = await session.clickSaveDraft();
  assert.equal(saved.label, "保存为草稿");
  const confirmed = await session.saveConfirmed();
  assert.equal(confirmed.saved, true);
  assert.equal(confirmed.savedTime, "01:23");
  const rows = await session.listDrafts();
  assert.equal(rows[0].id, "100001815");
  const reopened = await session.reopen("100001815");
  assert.equal(reopened.appmsgid, "100001815");
  assert.equal(reopened.type, 77);
  const files = await session.captureViews("/absolute/path/shots", "tietu");
  assert.equal(files.length, 3);
  assert.equal(shots.length, 3);
  await session.finish();
  await session.finish();
  assert.deepEqual(page.finished, { keep: [] });
  await assert.rejects(() => session.reopen("nope"), /draft id/);
  await assert.rejects(() => session.uploadImages([]), /--image/);
});

test("session reports a missing uploader, a missed thumbnail, and a redacted navigation error", async () => {
  const lonely = createDocument(h("div", {}, [
    h("div", { className: "ProseMirror", text: "题" }),
    h("div", { className: "ProseMirror", text: "正文" }),
    h("input", { type: "file" }),
  ]), { href: tietuEditorUrl({ token: "test-token" }) });
  const page = {
    async evaluate(fn, arg) { return fn(arg); },
    async setInputFiles() { throw new Error("should not upload"); },
  };
  const session = createTietuSession({ page, timings: { attempts: 1, waitMs: 0, uploadWaitMs: 0 } });
  await assert.rejects(() => session.uploadImages(["/absolute/path/cover.jpg"]), /second file input/);
  globalThis.document = lonely;
  const bare = {
    async evaluate(fn, arg) { return fn(arg); },
    async setInputFiles() {},
    async waitForTimeout() {},
  };
  const waiting = createTietuSession({ page: bare, timings: { attempts: 1, waitMs: 1, uploadWaitMs: 0 } });
  const two = createDocument(h("div", {}, [
    h("div", { className: "ProseMirror", text: "" }),
    h("div", { className: "ProseMirror", text: "" }),
    h("input", { type: "file" }),
    h("input", { type: "file" }),
  ]), { href: tietuEditorUrl({ token: "test-token" }) });
  globalThis.document = two;
  bare.evaluate = async (fn, arg) => fn(arg);
  await assert.rejects(() => waiting.uploadImages(["/absolute/path/cover.jpg"]), /not on the CDN/);
  delete bare.setInputFiles;
  globalThis.document = two;
  await assert.rejects(() => waiting.uploadImages(["/absolute/path/cover.jpg"]), /setInputFiles/);
  const keyboardless = {
    async evaluate(fn, arg) { return fn(arg); },
  };
  const quiet = createTietuSession({ page: keyboardless, timings: { attempts: 1, waitMs: 0 } });
  globalThis.document = two;
  await assert.rejects(() => quiet.fillTitle("题"), /insertText/);
  await assert.rejects(() => quiet.fillBody([{ op: "insertText", value: "正文" }]), /insertText/);
  globalThis.document = createDocument(h("div", { text: "没有编辑器" }), { href: "https://mp.weixin.qq.com/?token=test-token" });
  await assert.rejects(() => quiet.fillTitle("题"), /title field/);
  await assert.rejects(() => quiet.clickSaveDraft(), /保存为草稿/);
  const refusing = createTietuSession({
    page: { async evaluate() { return { ok: false, forbidden: true, error: "refusing to click 发表" }; } },
    timings: { attempts: 1, waitMs: 0 },
  });
  await assert.rejects(() => refusing.clickSaveDraft(), /refusing/);
  const navigated = createTietuSession({
    page: {
      async evaluate() { throw new Error("evaluate down"); },
      async url() { return "https://mp.weixin.qq.com/?token=from-url"; },
      async goto() { throw new Error("navigation failed token=from-url"); },
    },
    timings: { attempts: 1, waitMs: 0 },
  });
  await assert.rejects(() => navigated.goto("https://mp.weixin.qq.com/"), /token=redacted/);
  await assert.rejects(() => navigated.listDrafts(), /token=redacted|signed-in|evaluate/);
  const noToken = createTietuSession({
    page: {
      async evaluate(fn, arg) { return fn(arg); },
      async url() { return "https://mp.weixin.qq.com/"; },
    },
    timings: { attempts: 1, waitMs: 0 },
  });
  globalThis.document = createDocument(h("div"), { href: "https://mp.weixin.qq.com/" });
  await assert.rejects(() => noToken.listDrafts(), /signed-in session/);
  await assert.rejects(() => noToken.reopen("100001815"), /cannot reopen/);
  globalThis.document = createDocument(h("div", { text: "未保存" }, [
    h("div", { className: "ProseMirror", text: "题" }),
    h("div", { className: "ProseMirror", text: "正文" }),
  ]), { href: tietuEditorUrl({ token: "test-token" }) });
  const unconfirmed = createTietuSession({
    page: { async evaluate(fn, arg) { return fn(arg); }, async waitForTimeout() {} },
    timings: { attempts: 1, waitMs: 1 },
  });
  const missed = await unconfirmed.saveConfirmed();
  assert.equal(missed.ok, false);
  const emptyShots = await unconfirmed.captureViews("", "tietu");
  assert.deepEqual(emptyShots, []);
  let finished = 0;
  const closing = createTietuSession({
    page: { async evaluate() { throw new Error("gone"); } },
    task: { async finish() { finished += 1; } },
  });
  await closing.finish();
  assert.equal(finished, 1);
  const stalled = createTietuSession({
    page: {
      async evaluate(fn, arg) { return fn(arg); },
      async url() { return tietuEditorUrl({ token: "test-token" }); },
      async goto() {},
      async waitForTimeout() {},
    },
    timings: { attempts: 1, waitMs: 0 },
  });
  globalThis.document = createDocument(h("div", { text: "空" }), { href: tietuEditorUrl({ token: "test-token" }) });
  await assert.rejects(() => stalled.reopen("100001815"), /did not show a title/);
});

function uploaderDocument() {
  const menu = h("input", { type: "file", accept: "" });
  const main = h("input", { type: "file", accept: "image/jpeg,image/png" });
  const placeholder = h("div", { className: "upload-placeholder", text: "上传图片 token=secret" });
  const region = h("div", { className: "image-upload" }, [main, placeholder]);
  const root = h("div", {}, [
    h("div", { className: "ProseMirror", text: "" }),
    h("div", { className: "ProseMirror", text: "" }),
    menu,
    region,
  ]);
  const doc = createDocument(root, { href: tietuEditorUrl({ token: "test-token" }) });
  return { doc, main, region, placeholder };
}

function postedImages(srcs) {
  const preview = h("img", {
    className: "image-selector__preview-center-img",
    attrs: { src: `${srcs[0]}?wx_fmt=jpeg` },
  });
  const strip = h("div", { className: "image-selector__strip" }, srcs.map((src) => h("img", { attrs: { src } })));
  const selector = h("div", { className: "image-selector" }, [preview, strip]);
  const card = h("img", { className: "card-thumb", attrs: { src: srcs[0] } });
  const decoy = h("img", { attrs: { src: "https://mmbiz.qpic.cn/unrelated/icon" } });
  const root = h("div", {}, [
    h("div", { className: "ProseMirror", text: "标题" }),
    h("div", { className: "ProseMirror", text: "正文" }),
    selector,
    card,
    decoy,
  ]);
  createDocument(root, { href: tietuEditorUrl({ token: "test-token", appmsgid: "100001831" }) });
  return tietuAct({ op: "read-editor" }).imageCount;
}

test("image count is distinct selector pictures, not every mmbiz img", () => {
  const one = "https://mmbiz.qpic.cn/content/one";
  assert.equal(postedImages([one]), 1);
  assert.equal(postedImages([
    "https://mmbiz.qpic.cn/content/one",
    "https://mmbiz.qpic.cn/content/two",
    "https://mmbiz.qpic.cn/content/three",
  ]), 3);
});

test("upload probe sees the main input, thumbs, placeholder, and upload urls", () => {
  const built = uploaderDocument();
  const probe = tietuAct({ op: "upload-probe" });
  assert.equal(probe.fileInputs.length, 2);
  assert.equal(probe.fileInputs[0].accept, "");
  assert.equal(probe.chosenIndex, 2);
  assert.equal(probe.chosenAccept, "image/jpeg,image/png");
  assert.equal(probe.placeholder, true);
  assert.equal(probe.thumbCount, 0);
  assert.equal(probe.imageCount, 0);
  assert.match(probe.outerHTML, /上传图片/);
  built.region.childNodes.push(h("canvas"));
  built.region.childNodes.push(h("div", { attrs: { style: "background-image: url(https://mmbiz.example/b.jpg)" } }));
  built.region.childNodes.push(h("img", { attrs: { src: "blob:https://mp.weixin.qq.com/thumb" } }));
  const previous = globalThis.performance;
  globalThis.performance = {
    getEntries: () => [{ name: "https://mp.weixin.qq.com/cgi-bin/filetransfer?action=uploadimg&token=secret" }],
  };
  const again = tietuAct({ op: "upload-probe", networkHits: 1 });
  assert.ok(again.thumbCount >= 3);
  assert.equal(again.placeholder, false);
  assert.ok(again.imageCount >= 1);
  assert.equal(again.cdnImageCount, 0);
  assert.ok(again.uploadResponses >= 2);
  assert.doesNotMatch(JSON.stringify(again.fileInputs), /token=secret/);
  globalThis.performance = previous;
  assert.equal(built.placeholder.text.includes("token=secret"), true);
});

test("a placeholder uploader is not an uploaded 贴图 image", () => {
  const selector = h("div", { className: "image-selector" }, [
    h("div", { className: "upload-placeholder", text: "选择或拖拽图片" }),
    h("input", { type: "file" }),
    h("input", { type: "file" }),
  ]);
  createDocument(h("div", {}, [
    h("div", { className: "ProseMirror", text: "标题" }),
    h("div", { className: "ProseMirror", text: "正文" }),
    selector,
    h("img", { attrs: { src: "https://mmbiz.qpic.cn/card-only" } }),
  ]), { href: tietuEditorUrl({ token: "test-token" }) });
  const probe = tietuAct({ op: "upload-probe" });
  assert.equal(probe.cdnImageCount, 0);
  assert.equal(probe.imageCount, 0);
  assert.equal(probe.placeholder, true);
  const started = uploadAdvanced(
    { cdnImageCount: 0, inputValue: "", uploadResponses: 0, placeholder: true, thumbCount: 0 },
    { cdnImageCount: 0, inputValue: "cover.jpg", uploadResponses: 1, placeholder: false, thumbCount: 1 },
    { expected: 1 },
  );
  assert.equal(started.ok, false);
  assert.ok(started.hints.includes("input-value"));
  assert.ok(started.hints.includes("upload-response"));
});

test("upload waits for a mmbiz image and ignores placeholder hints", async () => {
  const placeholder = uploaderDocument();
  const hinted = {
    async evaluate(fn, arg) { return fn(arg); },
    async setInputFiles() { placeholder.main.value = "C:\\fakepath\\cover.jpg"; },
    on() {},
    off() {},
  };
  globalThis.document = placeholder.doc;
  const hintedSession = createTietuSession({ page: hinted, timings: { uploadWaitMs: 0, uploadTimeoutMs: 0 } });
  await assert.rejects(() => hintedSession.uploadImages(["/absolute/path/cover.jpg"]), /not on the CDN/);

  const host = uploaderDocument();
  const selector = h("div", { className: "image-selector" }, [
    h("div", { text: "选择或拖拽图片" }),
  ]);
  host.doc.body.childNodes.push(selector);
  let probes = 0;
  const page = {
    async evaluate(fn, arg) {
      if (arg && arg.op === "upload-probe") {
        probes += 1;
        if (probes >= 3) {
          selector.childNodes.push(h("img", {
            className: "image-selector__preview-center-img",
            attrs: { src: "https://mmbiz.qpic.cn/content/cover" },
          }));
          selector.childNodes.push(h("div", { className: "image-selector__strip" }, [
            h("img", { attrs: { src: "https://mmbiz.qpic.cn/content/cover?wx_fmt=jpeg" } }),
          ]));
        }
      }
      return fn(arg);
    },
    async setInputFiles(selectorText) { assert.equal(selectorText, TIETU_FILE_INPUT); },
    async waitForTimeout() {},
    on() {},
    off() {},
  };
  globalThis.document = host.doc;
  const session = createTietuSession({ page, timings: { uploadWaitMs: 1, uploadTimeoutMs: 5_000 } });
  const uploaded = await session.uploadImages(["/absolute/path/cover.jpg"]);
  assert.equal(uploaded.imageCount, 1);
  assert.deepEqual(uploaded.uploads[0].via, ["cdn-image"]);
});

test("a missed upload writes a screenshot and a redacted uploader dump", async () => {
  const built = uploaderDocument();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wx-tietu-upload-"));
  const page = {
    async evaluate(fn, arg) { return fn(arg); },
    async setInputFiles() {},
    async screenshot({ path: file }) {
      fs.writeFileSync(file, "png");
      return file;
    },
  };
  globalThis.document = built.doc;
  const session = createTietuSession({ page, timings: { uploadWaitMs: 0, uploadTimeoutMs: 0 } });
  await assert.rejects(
    () => session.uploadImages(["/absolute/path/cover.jpg"], { screenshotDir: dir }),
    (error) => {
      assert.match(error.message, /not on the CDN/);
      assert.match(error.message, /fileInputs=2/);
      assert.match(error.message, /image\/jpeg,image\/png/);
      assert.match(error.message, /chosen=2/);
      assert.match(error.message, /tietu-upload-failed\.png/);
      assert.match(error.message, /tietu-upload-failed\.html/);
      assert.equal(error.uploadDebug.screenshot, path.join(dir, "tietu-upload-failed.png"));
      assert.equal(error.uploadDebug.uploaderHtml, path.join(dir, "tietu-upload-failed.html"));
      assert.equal(error.uploadDebug.fileInputs[1].accept, "image/jpeg,image/png");
      return true;
    },
  );
  const html = fs.readFileSync(path.join(dir, "tietu-upload-failed.html"), "utf8");
  assert.match(html, /token=redacted/);
  assert.doesNotMatch(html, /token=secret/);
  assert.equal(fs.existsSync(path.join(dir, "tietu-upload-failed.png")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reopen only navigates and reads; it does not discard the draft", async () => {
  const editor = editorTree({ titleText: "编程 agent 的尽头是修车" });
  const ops = [];
  const page = {
    async evaluate(fn, arg) {
      ops.push(arg && arg.op);
      assert.equal(/删除|废弃|丢弃|不保存/.test(JSON.stringify(arg || {})), false);
      return fn(arg);
    },
    async url() { return globalThis.location.href; },
    async goto(url) {
      page.gone = String(url);
      assert.doesNotMatch(page.gone, /delete|discard|del/i);
      globalThis.document = editor.doc;
      globalThis.location = new URL(url);
    },
    async waitForLoadState() {},
  };
  globalThis.document = editor.doc;
  globalThis.location = new URL(tietuEditorUrl({ token: "test-token" }));
  const session = createTietuSession({
    page,
    task: { async finish() {} },
    timings: { attempts: 2, waitMs: 0 },
  });
  const read = await session.reopen("100001815");
  assert.equal(read.appmsgid, "100001815");
  assert.equal(read.type, 77);
  assert.match(page.gone, /appmsgid=100001815/);
  assert.match(page.gone, /action=edit/);
  assert.ok(ops.length > 0);
  assert.ok(ops.every((op) => op === "session-token" || op === "editor-state" || op === "read-editor"));
  assert.equal(ops.includes("click-save-draft"), false);
});

test("in-page hook records operate_appmsg bodies", async () => {
  const previousXhr = globalThis.XMLHttpRequest;
  const previousFetch = globalThis.fetch;
  const previousFlag = globalThis.__egoSavesInstalled;
  const previousWrapped = globalThis.__egoFetchWrapped;
  const previousXhrWrapped = globalThis.__egoXhrWrapped;
  delete globalThis.__egoSavesInstalled;
  delete globalThis.__egoFetchWrapped;
  delete globalThis.__egoXhrWrapped;
  delete globalThis.__egoRecent;
  delete globalThis.__egoHookId;
  delete globalThis.__egoSavesInstalledAt;
  class FakeXHR {
    open() {}
    send() {}
    addEventListener(type, fn) {
      this.listeners = this.listeners || {};
      this.listeners[type] = fn;
    }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  createDocument(h("div", { text: "hook" }), { href: "https://mp.weixin.qq.com/" });
  assert.equal(tietuAct({ op: "install-save-hook" }).ok, true);
  const xhr = new FakeXHR();
  const body = "cdn_url0=&share_imageinfo0=" + encodeURIComponent('{"list":[]}');
  xhr.open("POST", "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create&type=77");
  xhr.send(body);
  xhr.responseText = '{"ret":0,"appMsgId":"100001903"}';
  xhr.listeners.load();
  const noise = new FakeXHR();
  noise.open("POST", "https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&token=secret");
  noise.send("");
  const read = tietuAct({ op: "read-saves" });
  assert.equal(read.installed, true);
  assert.equal(typeof read.installedAt, "number");
  assert.equal(read.installedAt > 0, true);
  assert.equal(typeof read.frame.top, "boolean");
  assert.match(read.frame.href, /mp\.weixin\.qq\.com/);
  const saves = read.saves;
  assert.equal(saves[0].phase, "request");
  assert.match(saves[0].body, /cdn_url0=/);
  assert.equal(saves[1].phase, "response");
  assert.equal(saves[1].appMsgId, "100001903");
  assert.equal(read.recentUrls.some((item) => /operate_appmsg/.test(item.url)), true);
  assert.equal(read.recentUrls.some((item) => /filetransfer/.test(item.url) && /token=redacted/.test(item.url)), true);
  assert.equal(read.recentUrls.some((item) => /secret/.test(item.url)), false);
  assert.equal(saves.some((item) => /filetransfer/.test(item.url)), false);
  const filled = "cdn_url0=https%3A%2F%2Fmmbiz.qpic.cn%2Fa&share_imageinfo0=" + encodeURIComponent('{"list":[{"url":"https://mmbiz.qpic.cn/a"}]}');
  globalThis.fetch = async () => ({
    clone() { return this; },
    async json() { return { ret: 0, appMsgId: "100001903" }; },
  });
  delete globalThis.__egoFetchWrapped;
  delete globalThis.__egoSavesInstalled;
  delete globalThis.__egoFetchWrapped;
  globalThis.__egoSaves = [];
  tietuAct({ op: "install-save-hook" });
  await globalThis.fetch("https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=update&type=77", { body: filled });
  const again = tietuAct({ op: "read-saves" }).saves;
  assert.equal(again.some((item) => item.phase === "request" && item.body.includes("mmbiz")), true);
  globalThis.XMLHttpRequest = previousXhr;
  globalThis.fetch = previousFetch;
  globalThis.__egoSavesInstalled = previousFlag;
  globalThis.__egoFetchWrapped = previousWrapped;
  globalThis.__egoXhrWrapped = previousXhrWrapped;
});

test("save hook is installed in each frame and reported around the click", async () => {
  const editor = editorTree({ titleText: "编程 agent 的尽头是修车", saved: "15:47已保存" });
  const calls = [];
  const child = {
    async evaluate(fn, arg) {
      calls.push(["child", arg && arg.op]);
      return fn(arg);
    },
  };
  const page = {
    async evaluate(fn, arg) {
      calls.push(["page", arg && arg.op]);
      return fn(arg);
    },
    frames() { return [child]; },
    async addInitScript(fn, arg) {
      page.initArg = arg;
      assert.equal(typeof fn, "function");
    },
    on() {},
    off() {},
    async click(selector) { page.pointer = selector; },
  };
  delete globalThis.__egoSavesInstalled;
  delete globalThis.__egoXhrWrapped;
  delete globalThis.__egoFetchWrapped;
  delete globalThis.__egoRecent;
  globalThis.document = editor.doc;
  globalThis.location = new URL(tietuEditorUrl({ token: "secret-token", appmsgid: "100001920" }));
  const session = createTietuSession({ page, timings: { waitMs: 0, saveTimeoutMs: 0, savePollMs: 0 } });
  await session.beginSaveWatch();
  assert.equal(page.initArg.op, "install-save-hook");
  assert.equal(calls.some((item) => item[0] === "child" && item[1] === "install-save-hook"), true);
  assert.equal(calls.some((item) => item[0] === "page" && item[1] === "install-save-hook"), true);
  const clicked = await session.clickSaveDraft();
  assert.equal(clicked.via, "page.click");
  const confirmed = await session.confirmSave({ timeoutMs: 0, pollMs: 0 });
  assert.equal(confirmed.appmsgid, "100001920");
  const before = confirmed.saveHook.beforeClick;
  assert.equal(before.status.frames.some((frame) => frame.installed && frame.installedAt > 0), true);
  assert.equal(before.status.frames.some((frame) => frame.where === "frame:0"), true);
  assert.match(before.status.frames[0].frame.href, /token=redacted/);
  assert.doesNotMatch(before.status.frames[0].frame.href, /secret-token/);
  assert.equal(confirmed.saveHook.afterClick.frames.some((frame) => frame.installed), true);
  assert.equal(confirmed.saveHook.afterReinstall.frames.some((frame) => frame.installed), true);
  assert.equal(confirmed.saveHook.initScript.ok, true);
  assert.equal(confirmed.saveHook.initScript.via, "page.addInitScript");
});

test("manual save waits for autosave and uses a pointer click", async () => {
  const editor = editorTree({ titleText: "编程 agent 的尽头是修车", saved: "" });
  let polls = 0;
  const requests = [];
  const page = {
    async evaluate(fn, arg) {
      if (arg && arg.op === "editor-state") {
        polls += 1;
        if (polls >= 2) editor.doc.body.text = "01:23已保存";
      }
      return fn(arg);
    },
    on(event, handler) {
      if (event === "request") requests.push(handler);
    },
    off() {},
    async click(selector) { page.pointer = selector; },
    async goto() { throw new Error("navigated"); },
  };
  globalThis.document = editor.doc;
  globalThis.location = new URL(tietuEditorUrl({ token: "test-token" }));
  const session = createTietuSession({ page, timings: { autosaveTimeoutMs: 5_000, savePollMs: 1 } });
  const watch = await session.beginSaveWatch();
  await requests[0]({
    url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create&type=77&token=secret",
    postData: () => "cdn_url0=https%3A%2F%2Fmmbiz.qpic.cn%2Fa&share_imageinfo0=" + encodeURIComponent('{"list":[{"url":"https://mmbiz.qpic.cn/a"}]}'),
  });
  const autosave = await session.waitForAutosave({ watch, timeoutMs: 5_000, pollMs: 1 });
  assert.equal(autosave.ok, true);
  assert.match(autosave.toastText, /01:23已保存|已保存/);
  assert.equal(autosave.imageFields.nonEmpty, true);
  assert.equal(page.pointer, undefined);
  const save = editor.doc.querySelector("button");
  const before = save ? save.clicked : 0;
  const clicked = await session.clickSaveDraft();
  assert.equal(clicked.via, "page.click");
  assert.equal(page.pointer, 'text="保存为草稿"');
  if (save) assert.equal(save.clicked, before);
  watch.stop();
});

test("confirmSave stays on the editor until an appmsgid arrives", async () => {
  const editor = editorTree({ titleText: "编程 agent 的尽头是修车", saved: "01:23 已保存" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wx-tietu-save-"));
  let navigated = false;
  const page = {
    handlers: {},
    async evaluate(fn, arg) { return fn(arg); },
    on(event, handler) { page.handlers[event] = handler; },
    off() {},
    async screenshot(options) {
      page.shot = options;
      fs.writeFileSync(options.path, "png");
      return options.path;
    },
    async goto() { navigated = true; },
  };
  globalThis.document = editor.doc;
  globalThis.location = new URL(tietuEditorUrl({ token: "secret-token" }));
  const session = createTietuSession({ page, timings: { saveTimeoutMs: 0, savePollMs: 0 } });
  const watch = await session.beginSaveWatch();
  await page.handlers.response({
    url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?action=save&token=secret-token",
    async json() { return { ret: 0, appMsgId: "100001815" }; },
  });
  const confirmed = await session.confirmSave({ watch, screenshotDir: dir, timeoutMs: 0, pollMs: 0 });
  watch.stop();
  assert.equal(navigated, false);
  assert.equal(confirmed.appmsgid, "100001815");
  assert.equal(confirmed.via, "response");
  assert.deepEqual(confirmed.saveResponse, { ret: 0, appMsgId: "100001815" });
  assert.equal(confirmed.toastText, "01:23 已保存");
  assert.match(confirmed.url, /token=redacted/);
  assert.doesNotMatch(confirmed.url, /secret-token/);
  assert.equal(confirmed.screenshot, path.join(dir, "tietu-save-confirm.png"));
  assert.equal(page.shot.fullPage, true);
  assert.equal(page.shot.type, undefined);
  assert.deepEqual(Object.keys(page.shot).sort(), ["fullPage", "path"]);
  assert.equal(fs.existsSync(confirmed.screenshot), true);

  globalThis.location = new URL(tietuEditorUrl({ token: "secret-token", appmsgid: "100001815" }));
  const fromUrl = await session.confirmSave({ timeoutMs: 0, pollMs: 0 });
  assert.equal(fromUrl.via, "url");
  assert.equal(fromUrl.appmsgid, "100001815");
  assert.equal(navigated, false);

  let probes = 0;
  const late = editorTree({ titleText: "" });
  const latePage = {
    async evaluate(fn, arg) {
      if (arg && arg.op === "editor-state") {
        probes += 1;
        if (probes >= 2) late.title.text = "编程 agent 的尽头是修车";
      }
      return fn(arg);
    },
    async goto(url) { latePage.gone = String(url); globalThis.location = new URL(url); },
    async url() { return tietuEditorUrl({ token: "test-token" }); },
    async waitForTimeout() {},
    async waitForLoadState() {},
  };
  globalThis.document = late.doc;
  globalThis.location = new URL(tietuEditorUrl({ token: "test-token" }));
  const lateSession = createTietuSession({
    page: latePage,
    timings: { waitMs: 0, reopenPollMs: 1, reopenTimeoutMs: 5_000 },
  });
  const read = await lateSession.reopen("100001815");
  assert.equal(read.title, "编程 agent 的尽头是修车");
  assert.match(latePage.gone, /action=edit/);
  assert.match(latePage.gone, /type=77/);
  assert.match(latePage.gone, /appmsgid=100001815/);
  assert.doesNotMatch(latePage.gone, /delete|discard/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
