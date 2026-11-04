import assert from "node:assert/strict";
import test from "node:test";
import { COVER_INPUT_SELECTOR, VIDEO_INPUT_SELECTOR } from "../lib/creator-dom.mjs";
import { createCreatorSession } from "../lib/session.mjs";
import { createDocument, h } from "./dom-fixture.mjs";

function task() {
  const calls = { finish: [], hand: 0 };
  return {
    calls,
    spaceId: 80,
    async finish(arg) { calls.finish.push(arg); },
    async handOff() { calls.hand += 1; },
  };
}

function page(extra = {}) {
  const files = [];
  const waits = [];
  return {
    files,
    waits,
    async url() { return extra.url || "https://creator.xiaohongshu.com/publish/publish"; },
    async title() { return extra.title || "发布笔记"; },
    async goto() {},
    async waitForLoadState() { if (extra.idleError) throw new Error("sockets"); },
    async waitForTimeout(ms) { waits.push(ms); },
    async evaluate(fn, payload) {
      if (extra.evaluateError) throw new Error(extra.evaluateError);
      if (extra.evaluateNull) return null;
      return fn(payload);
    },
    async setInputFiles(selector, file) { files.push({ selector, file }); },
  };
}

test("session requires task and page and finishes keep empty", async () => {
  assert.throws(() => createCreatorSession(), /requires task and page/);
  assert.throws(() => createCreatorSession({ task: {} }), /requires task and page/);
  const host = task();
  const tab = page();
  delete tab.waitForLoadState;
  const session = createCreatorSession({ task: host, page: tab, keep: false });
  await session.goto("https://creator.xiaohongshu.com/");
  await session.finish();
  await session.finish();
  assert.deepEqual(host.calls.finish, [{ keep: [] }]);
  const kept = createCreatorSession({ task: host, page: page({ idleError: true }), keep: true });
  await kept.goto("https://creator.xiaohongshu.com/");
  await kept.finish();
  assert.deepEqual(host.calls.finish[1], { keep: ["p1"] });
  await kept.cleanup();
  assert.equal(host.calls.finish.length, 2);
});

test("detect survives page and evaluate failures", async () => {
  createDocument(h("body", { text: "发布笔记" }, [h("div", { className: "account-name", text: "听懂AI" })]));
  const tab = page();
  tab.url = async () => { throw new Error("url"); };
  tab.title = async () => { throw new Error("title"); };
  const session = createCreatorSession({ task: task(), page: tab });
  const detected = await session.detect();
  assert.equal(detected.nickname, "听懂AI");
  assert.equal(detected.creatorChrome, true);
  const down = createCreatorSession({ task: task(), page: page({ evaluateError: "evaluate down" }) });
  const failed = await down.detect();
  assert.match(failed.evaluateError, /evaluate down/);
  const empty = createCreatorSession({ task: task(), page: page({ evaluateNull: true }) });
  const blank = await empty.probe();
  assert.equal(blank.ok, false);
});

test("setVideo and setCover use the captured file inputs", async () => {
  const video = h("input", { className: "upload-input", type: "file", accept: ".mp4" });
  const cover = h("input", { className: "pk-cover-list-file-input", type: "file", accept: ".jpg,.jpeg,.png" });
  createDocument(h("body", {}, [video, cover]));
  const tab = page();
  const session = createCreatorSession({ task: task(), page: tab });
  await session.setVideo("/absolute/path/to/video.mp4");
  await session.setCover("/absolute/path/to/cover-3x4.png");
  assert.deepEqual(tab.files, [
    { selector: VIDEO_INPUT_SELECTOR, file: "/absolute/path/to/video.mp4" },
    { selector: COVER_INPUT_SELECTOR, file: "/absolute/path/to/cover-3x4.png" },
  ]);
});

test("setCover reveals 换封面 once when the PK input is missing", async () => {
  const swap = h("button", {}, ["设置封面"]);
  const body = h("body", {}, [swap]);
  createDocument(body);
  swap.click = () => {
    swap.clicked += 1;
    body.childNodes.push(h("input", { className: "pk-cover-list-file-input", type: "file", accept: ".png" }));
  };
  const tab = page();
  const session = createCreatorSession({ task: task(), page: tab });
  await session.setCover("/absolute/path/to/cover-3x4.png");
  assert.equal(swap.clicked, 1);
  assert.equal(tab.files[0].selector, COVER_INPUT_SELECTOR);
  createDocument(h("body"));
  await assert.rejects(() => session.setCover("/absolute/path/to/cover-3x4.png"), /PK cover|换封面/);
  delete tab.setInputFiles;
  createDocument(h("body", {}, [h("input", { className: "upload-input", type: "file" })]));
  await assert.rejects(() => session.setVideo("/absolute/path/to/video.mp4"), /setInputFiles/);
});

test("upload and cover waits honor toast plus counter", async () => {
  const body = h("body", { text: "上传中 40%" });
  createDocument(body);
  const tab = page();
  const session = createCreatorSession({
    task: task(),
    page: tab,
    timings: { uploadAttempts: 3, coverAttempts: 2, waitMs: 1 },
  });
  const pending = session.waitUpload();
  body.text = "重新上传 设置封面";
  assert.equal((await pending).ok, true);
  body.text = "上传中 1%";
  await assert.rejects(() => session.waitUpload(), /did not finish/);
  body.text = "封面 0/3";
  const before = await session.coverState();
  assert.equal(before.coverCount, 0);
  const waiting = session.waitCoverApplied(before);
  body.text = "已添加 PK 封面\n封面 1/3";
  const applied = await waiting;
  assert.equal(applied.state.pkApplied, true);
  assert.equal(applied.state.coverCount, 1);
  body.text = "封面 0/3";
  await assert.rejects(() => session.waitCoverApplied(before), /0\/3/);
  assert.ok(tab.waits.includes(1));
});

test("form actions, success, edit settle, and handoff", async () => {
  const title = h("input", { placeholder: "填写标题" });
  const body = h("div", { editable: true });
  const publish = h("button", {}, ["发布"]);
  const card = h("div", {
    className: "note-card",
    text: "标题甲",
    attrs: { "data-impression": JSON.stringify({ noteTarget: { value: { noteId: "6aeae169000000000e00c4ad" } } }) },
  });
  const shell = h("body", { text: "发布成功" }, [title, body, publish, card]);
  createDocument(shell, {
    href: "https://creator.xiaohongshu.com/publish/success?from=test",
  });
  const tab = page({ url: "https://creator.xiaohongshu.com/publish/success?from=test" });
  const host = task();
  delete host.handOff;
  const session = createCreatorSession({
    task: host,
    page: tab,
    timings: { uploadAttempts: 2, coverAttempts: 2, waitMs: 0 },
  });
  await session.fillTitle("标题甲");
  await session.fillBody("正文");
  await session.clickPublish();
  assert.equal(publish.clicked, 1);
  assert.match((await session.waitSuccess()).url, /success/);
  assert.equal((await session.readNote("标题甲")).noteId, "6aeae169000000000e00c4ad");
  shell.text = "封面PK中";
  globalThis.location.href = "https://creator.xiaohongshu.com/publish/update?id=1";
  assert.match((await session.waitEditSettled()).text, /封面PK中/);
  shell.text = "加载失败";
  await assert.rejects(() => session.waitEditSettled(), /加载失败/);
  shell.text = "编辑中";
  await assert.rejects(() => session.waitEditSettled(), /did not settle/);
  shell.text = "首页";
  globalThis.location.href = "https://creator.xiaohongshu.com/";
  await assert.rejects(() => session.waitSuccess(), /success page/);
  createDocument(h("body"));
  await assert.rejects(() => session.fillTitle("标题甲"), /title field/);
  await assert.rejects(() => session.clickPublish(), /发布 button/);
  await session.handOff();
  assert.equal(host.calls.hand, 0);
});
