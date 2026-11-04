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
  const found = creatorAct({ op: "click-publish" });
  assert.equal(found.ok, true);
  assert.equal(found.tag, "BUTTON");
  assert.equal(publish.clicked, 0);
  assert.equal(publishNotes.clicked, 0);
  assert.equal(stash.clicked, 0);
  createDocument(h("body", {}, [stash]));
  assert.match(creatorAct({ op: "reveal-cover" }).error, /换封面/);
  assert.match(creatorAct({ op: "click-publish" }).error, /发布 button/);
});

test("title, body, and note cards", () => {
  const title = h("input", { placeholder: "填写标题" });
  const body = h("div", { className: "ProseMirror", editable: true });
  const card = h("div", {
    className: "note-card",
    text: "看条广告手机就中招？",
    attrs: { "data-impression": JSON.stringify({ noteTarget: { value: { noteId: "6aeae281000000000e00cb56" } } }) },
  });
  createDocument(h("body", {}, [title, body, card]));
  const target = creatorAct({ op: "title-target" });
  assert.equal(target.ok, true);
  assert.equal(target.selector, "[data-xhs-title='1']");
  title.value = "看条广告";
  assert.equal(creatorAct({ op: "title-value" }).value, "看条广告");
  const prose = creatorAct({ op: "body-target" });
  assert.equal(prose.proseMirror, true);
  body.innerText = "正文";
  assert.equal(creatorAct({ op: "body-value" }).value, "正文");
  const notes = creatorAct({ op: "note-cards" });
  assert.equal(notes.cards[0].impression.includes("6aeae281"), true);
  createDocument(h("body"));
  assert.match(creatorAct({ op: "title-target" }).error, /title field/);
  assert.match(creatorAct({ op: "body-target" }).error, /ProseMirror/);
  const aria = h("input", { attrs: { "aria-label": "标题" } });
  createDocument(h("body", {}, [aria]));
  assert.equal(creatorAct({ op: "title-target" }).ok, true);
});

test("选择图片上传 is the main cover input, not the PK input", () => {
  const video = h("input", { className: "upload-input", type: "file", accept: ".mp4" });
  const pk = h("input", { className: "pk-cover-list-file-input", type: "file", accept: ".png" });
  const main = h("input", { type: "file", accept: ".jpg,.jpeg,.png" });
  const preview = h("img", { attrs: { src: "first-frame.jpg" } });
  const chooser = h("button", {}, ["选择图片上传"]);
  const pkImg = h("img", { className: "pk-cover-list-card-img", attrs: { src: "pk-cover-list-blob" } });
  const group = h("div", {}, [chooser, main, preview]);
  createDocument(h("body", {}, [video, pk, pkImg, group]));
  const found = creatorAct({ op: "main-cover-input" });
  assert.equal(found.ok, true);
  assert.equal(found.scope, "main");
  assert.equal(found.via, "选择图片上传");
  assert.equal(main.getAttribute("data-xhs-main-cover"), "1");
  assert.equal(pk.getAttribute("data-xhs-main-cover"), null);
  const before = creatorAct({ op: "main-cover-state" });
  assert.equal(before.signature, "first-frame.jpg");
  assert.doesNotMatch(before.signature, /pk-cover-list/);
  preview.setAttribute("src", "custom-cover.jpg");
  const after = creatorAct({ op: "main-cover-state" });
  assert.equal(after.signature, "custom-cover.jpg");
  createDocument(h("body", {}, [video, pk, h("button", {}, ["发布"])]));
  assert.match(creatorAct({ op: "main-cover-input" }).error, /选择图片上传/);
});

test("creatorAct has no module closure after serialization", () => {
  const isolated = new Function(`return (${creatorAct.toString()})`)();
  const publish = h("div", {}, ["发布"]);
  const main = h("input", { type: "file", accept: ".png" });
  const chooser = h("button", {}, ["选择图片上传"]);
  publish.getBoundingClientRect = () => ({ x: 0, y: 10, width: 20, height: 10 });
  createDocument(h("body", { text: "发布笔记" }, [
    h("div", { className: "user-name", text: "听懂AI" }),
    h("input", { className: "upload-input", type: "file" }),
    h("div", {}, [chooser, main, h("img", { attrs: { src: "first-frame.jpg" } })]),
    h("input", { placeholder: "填写标题" }),
    h("div", { className: "ProseMirror", editable: true }),
    publish,
  ]), { href: "https://creator.xiaohongshu.com/publish/publish" });
  assert.equal(isolated({ op: "probe" }).nickname, "听懂AI");
  assert.equal(isolated({ op: "main-cover-input" }).scope, "main");
  assert.equal(isolated({ op: "main-cover-state" }).signature, "first-frame.jpg");
  assert.equal(isolated({ op: "title-target" }).ok, true);
  assert.equal(isolated({ op: "body-target" }).proseMirror, true);
  const clicked = isolated({ op: "click-publish" });
  assert.equal(clicked.ok, true);
  assert.equal(clicked.tag, "DIV");
  assert.equal(clicked.x, 10);
  assert.equal(clicked.y, 15);
  assert.equal(publish.clicked, 0);
});
