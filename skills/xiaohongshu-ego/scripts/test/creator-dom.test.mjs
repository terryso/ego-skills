import assert from "node:assert/strict";
import test from "node:test";
import { COVER_INPUT_SELECTOR, VIDEO_INPUT_SELECTOR, creatorAct } from "../lib/creator-dom.mjs";
import { createDocument, h } from "./dom-fixture.mjs";

test("creatorAct requires a document and rejects unknown ops", () => {
  const previous = globalThis.document;
  delete globalThis.document;
  assert.match(creatorAct({ op: "probe" }).error, /document/);
  globalThis.document = previous;
  createDocument(h("body", { text: "首页" }));
  assert.match(creatorAct({ op: "nope" }).error, /unknown op/);
  assert.equal(creatorAct("nope").ok, true);
  assert.equal(creatorAct(null).ok, true);
});

test("probe reads the creator nickname and login wall", () => {
  const nick = h("div", { className: "user-name", text: "听懂AI" });
  const nav = h("div", { className: "nickname", text: "发布笔记" });
  createDocument(h("body", { text: "发布笔记 笔记管理" }, [nick, nav]), {
    href: "https://creator.xiaohongshu.com/",
    title: "创作服务平台",
  });
  const probe = creatorAct({ op: "probe" });
  assert.equal(probe.nickname, "听懂AI");
  assert.equal(probe.creatorChrome, true);
  assert.equal(probe.loginWall, false);
  createDocument(h("body", { text: "笔记管理" }, [
    h("div", { className: "user-name", text: "https://creator.xiaohongshu.com/" }),
    h("div", { className: "nick-name", text: "x".repeat(40) }),
    h("header", {}, [h("span", { className: "name", text: "听懂AI" })]),
  ]));
  assert.equal(creatorAct({ op: "probe" }).nickname, "听懂AI");
  globalThis.document = { title: "", body: null, querySelector() { return null; }, querySelectorAll() { return []; } };
  assert.equal(creatorAct({ op: "probe" }).text, "");
  createDocument(h("body", { text: "请使用小红书App扫码" }), {
    href: "https://creator.xiaohongshu.com/login",
  });
  assert.equal(creatorAct({ op: "probe" }).loginWall, true);
  createDocument(h("body"));
  assert.equal(creatorAct({ op: "probe" }).text, "");
});

test("cover input is the PK input, not the video input", () => {
  const video = h("input", { className: "upload-input", type: "file", accept: ".mp4,.mov" });
  const cover = h("input", {
    className: "pk-cover-list-file-input",
    type: "file",
    accept: ".jpg,.jpeg,.png",
  });
  const gif = h("input", { className: "pk-cover-list-file-input other", type: "file", accept: ".gif" });
  createDocument(h("body", { text: "设置封面" }, [video, cover]));
  const found = creatorAct({ op: "cover-input" });
  assert.equal(found.ok, true);
  assert.equal(found.selector, COVER_INPUT_SELECTOR);
  assert.match(found.accept, /\.png/);
  assert.equal(creatorAct({ op: "video-input" }).selector, VIDEO_INPUT_SELECTOR);
  createDocument(h("body", {}, [gif]));
  assert.match(creatorAct({ op: "cover-input" }).error, /png or jpg/);
  createDocument(h("body", {}, [video]));
  assert.match(creatorAct({ op: "cover-input" }).error, /PK cover/);
  assert.match(creatorAct({ op: "video-input" }).selector, /upload-input/);
  createDocument(h("body"));
  assert.match(creatorAct({ op: "video-input" }).error, /video/);
});

test("cover state reports the toast and the 0/3 counter", () => {
  const preview = h("div", { className: "cover-preview", text: "首帧" });
  const image = h("img", { attrs: { src: "first-frame.jpg" }, className: "cover" });
  createDocument(h("body", { text: "封面 0/3" }, [preview, image, h("input", { className: "pk-cover-list-file-input", type: "file" })]));
  const before = creatorAct({ op: "cover-state" });
  assert.equal(before.pkApplied, false);
  assert.equal(before.coverCount, 0);
  assert.equal(before.counterText, "0/3");
  assert.equal(before.cropDialog, false);
  assert.match(before.previewSignature, /first-frame/);
  createDocument(h("body", { text: "已添加 PK 封面\n封面 1/3\n封面预览 PK" }, [
    h("div", { className: "cover-preview", text: "PK" }),
  ]));
  const after = creatorAct({ op: "cover-state" });
  assert.equal(after.pkApplied, true);
  assert.equal(after.coverCount, 1);
  assert.match(after.previewText, /封面预览/);
  createDocument(h("body", { text: "裁剪封面 已添加 PK 封面 封面 1/3" }));
  assert.equal(creatorAct({ op: "cover-state" }).cropDialog, true);
  createDocument(h("body", { text: "没有计数" }));
  assert.equal(creatorAct({ op: "cover-state" }).coverCount, null);
});

test("reveal clicks 换封面 and publish clicks only 发布", () => {
  const swap = h("button", {}, ["换封面"]);
  const stash = h("button", {}, ["暂存离开"]);
  const publishNotes = h("div", { attrs: { role: "button" } }, ["发布笔记"]);
  const publish = h("button", {}, ["发布"]);
  createDocument(h("body", {}, [swap, stash, publishNotes, publish]));
  assert.equal(creatorAct({ op: "reveal-cover" }).ok, true);
  assert.equal(swap.clicked, 1);
  assert.equal(stash.clicked, 0);
  assert.equal(creatorAct({ op: "click-publish" }).ok, true);
  assert.equal(publish.clicked, 1);
  assert.equal(publishNotes.clicked, 0);
  assert.equal(stash.clicked, 0);
  createDocument(h("body", {}, [stash]));
  assert.match(creatorAct({ op: "reveal-cover" }).error, /换封面/);
  assert.match(creatorAct({ op: "click-publish" }).error, /发布 button/);
});

test("title, body, and note cards", () => {
  const title = h("input", { placeholder: "填写标题" });
  const body = h("div", { editable: true });
  const card = h("div", {
    className: "note-card",
    text: "看条广告手机就中招？",
    attrs: { "data-impression": JSON.stringify({ noteTarget: { value: { noteId: "6aeae281000000000e00cb56" } } }) },
  });
  createDocument(h("body", {}, [title, body, card]));
  const filled = creatorAct({ op: "fill-title", title: "看条广告" });
  assert.equal(filled.ok, true);
  assert.equal(title.value, "看条广告");
  assert.equal(title.events.length, 2);
  const written = creatorAct({ op: "fill-body", body: "正文\n\n#话题" });
  assert.equal(written.ok, true);
  assert.equal(body.innerText, "正文\n\n#话题");
  const notes = creatorAct({ op: "note-cards" });
  assert.equal(notes.cards[0].impression.includes("6aeae281"), true);
  createDocument(h("body"));
  assert.match(creatorAct({ op: "fill-title", title: "x" }).error, /title field/);
  assert.match(creatorAct({ op: "fill-body", body: "x" }).error, /description field/);
  const sticky = h("textarea", { placeholder: "填写描述" });
  Object.defineProperty(sticky, "value", { get() { return "nope"; }, set() {} });
  createDocument(h("body", {}, [sticky]));
  assert.equal(creatorAct({ op: "fill-body", body: "正文" }).ok, false);
  const aria = h("input", { attrs: { "aria-label": "标题" } });
  createDocument(h("body", {}, [aria]));
  assert.equal(creatorAct({ op: "fill-title", title: "甲" }).ok, true);
  const broken = h("input", { placeholder: "填写标题" });
  Object.defineProperty(broken, "value", { get() { return ""; }, set() {} });
  createDocument(h("body", {}, [broken]));
  assert.equal(creatorAct({ op: "fill-title", title: "甲" }).ok, false);
});
