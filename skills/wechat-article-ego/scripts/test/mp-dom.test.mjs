import assert from "node:assert/strict";
import test from "node:test";
import { mpAct } from "../lib/mp-dom.mjs";
import { createDocument, h } from "./dom-fixture.mjs";

function isolated() {
  return new Function(`return (${mpAct.toString()})`)();
}

test("mpAct refuses to run without a document and ignores unknown ops", () => {
  const previous = globalThis.document;
  delete globalThis.document;
  assert.match(mpAct({ op: "probe" }).error, /document/);
  globalThis.document = previous;
  createDocument(h("body", { text: "首页" }));
  assert.match(mpAct({ op: "nope" }).error, /unknown op/);
  assert.equal(isolated()({ op: "probe" }).ok, true);
});

test("probe tells a login wall from one account and from several accounts", () => {
  createDocument(h("body", { text: "微信扫一扫，选择公众平台账号登录 请重新登录" }), {
    href: "https://mp.weixin.qq.com/?token=secret&t=home",
    title: "微信公众平台",
  });
  const wall = mpAct({ op: "probe" });
  assert.equal(wall.loginWall, true);
  assert.equal(wall.loggedIn, false);
  assert.equal(wall.url.includes("secret"), false);
  assert.match(wall.url, /token=redacted/);

  const nick = h("div", { className: "weui-desktop-account__nickname", text: "加选" });
  createDocument(h("body", { text: "新的创作 草稿箱" }, [nick]), { title: "公众号" });
  const one = mpAct({ op: "probe" });
  assert.equal(one.loggedIn, true);
  assert.deepEqual(one.accounts, ["加选"]);
  assert.equal(one.ambiguous, false);

  const a = h("div", { className: "account-switch-item", attrs: { "data-account-name": "甲号" } }, ["甲号"]);
  const b = h("div", { className: "account-switch-item", attrs: { "data-account-name": "乙号" } }, ["乙号"]);
  createDocument(h("body", { text: "选择账号" }, [a, b]));
  const many = mpAct({ op: "probe" });
  assert.deepEqual(many.accounts, ["甲号", "乙号"]);
  assert.equal(many.ambiguous, true);

  createDocument(h("body", { text: "新的创作" }));
  const unnamed = mpAct({ op: "probe" });
  assert.equal(unnamed.loggedIn, true);
  assert.deepEqual(unnamed.accounts, []);
});

test("editor actions fill, paste-focus, upload, save, and never publish", () => {
  const title = h("textarea", { placeholder: "请在这里输入标题" });
  const digest = h("input", { attrs: { placeholder: "选填，摘要会在订阅号消息和转发卡片中显示" } });
  const source = h("input", { attrs: { placeholder: "原文链接" } });
  const body = h("body", { editable: true, text: "选择图片 上传图片" }, [
    h("p", { text: "正文" }, ["正文"]),
  ]);
  const frame = h("iframe");
  frame.contentDocument = {
    body,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
  const imageButton = h("button", { title: "图片" }, ["图片"]);
  const file = h("input", { type: "file", accept: "image/jpeg,image/png" });
  const confirm = h("button", {}, ["确定"]);
  const save = h("button", {}, ["保存"]);
  const publish = h("button", {}, ["发表"]);
  const mass = h("button", {}, ["群发"]);
  const previewSend = h("button", {}, ["发送预览"]);
  const preview = h("button", {}, ["预览"]);
  const hidden = h("button", {}, ["保存草稿"]);
  hidden.getClientRects = () => [];
  createDocument(h("body", { text: "选择图片 上传图片 封面 未选择 从正文选择" }, [
    title, digest, source, frame, imageButton, file, confirm, save, publish, mass, previewSend, preview, hidden,
    h("div", { className: "weui-desktop-account__nickname", text: "加选" }),
  ]));

  assert.equal(mpAct({ op: "probe" }).editorReady, true);
  assert.equal(mpAct({ op: "title-field" }).selector, "[data-wx-article-title='1']");
  assert.equal(mpAct({ op: "set-title", value: "题" }).ok, true);
  assert.equal(title.value, "题");
  assert.equal(mpAct({ op: "set-digest", value: "摘要" }).ok, true);
  assert.equal(digest.value, "摘要");
  assert.equal(mpAct({ op: "set-source", value: "https://example.com/p" }).ok, true);
  assert.equal(mpAct({ op: "focus-body" }).ok, true);
  assert.equal(body.focused, true);
  assert.equal(mpAct({ op: "open-image" }).ok, true);
  assert.equal(imageButton.clicked, 1);
  assert.equal(mpAct({ op: "image-input" }).selector, "input[data-wx-article-file='1']");
  assert.equal(mpAct({ op: "image-count" }).imageCount, 0);
  body.childNodes.push(h("img", { attrs: { src: "https://mmbiz.example/a.jpg" } }));
  body.childNodes.push(h("img", { attrs: { src: "about:blank" } }));
  assert.equal(mpAct({ op: "image-count" }).imageCount, 1);
  assert.equal(mpAct({ op: "confirm-image" }).confirmed, true);
  assert.equal(confirm.clicked, 1);
  const cover = mpAct({ op: "cover-state" });
  assert.equal(cover.present, true);
  assert.equal(cover.empty, true);
  assert.equal(mpAct({ op: "click", text: "发表" }).forbidden, true);
  assert.equal(publish.clicked, 0);
  assert.equal(mpAct({ op: "click", text: "群发" }).forbidden, true);
  assert.equal(mpAct({ op: "click", text: "发送预览" }).forbidden, true);
  assert.equal(mass.clicked, 0);
  assert.equal(previewSend.clicked, 0);
  assert.equal(mpAct({ op: "click-save" }).label, "保存");
  assert.equal(save.clicked, 1);
  assert.equal(hidden.clicked, 0);
  assert.equal(mpAct({ op: "click-preview" }).ok, true);
  assert.equal(preview.clicked, 1);
  assert.equal(mpAct({ op: "preview-state" }).button, true);
  const read = mpAct({ op: "read-editor" });
  assert.equal(read.title, "题");
  assert.equal(read.imageCount, 1);
  assert.equal(mpAct({ op: "scroll", where: "middle" }).ok, true);
  assert.equal(mpAct({ op: "scroll", where: "end" }).top > 0, true);
  assert.equal(mpAct({ op: "clear-unload" }).ok, true);
  assert.equal(mpAct({ op: "click", text: "不存在", required: true }).ok, false);
  assert.equal(mpAct({ op: "click", text: "不存在" }).ok, true);
});

test("draft rows, cover upload, and missing controls", () => {
  const title = h("div", {
    className: "draft-title",
    attrs: { "data-id": "42", "data-time": "2026-11-08 00:40" },
    text: "Git 存储",
  });
  const parent = h("div", { text: "Git 存储\n今天 00:40" }, [title]);
  const bad = h("div", { className: "draft-title", text: "发表" });
  const coverFile = h("input", { type: "file", className: "cover-file", accept: "image/*" });
  createDocument(h("body", { text: "封面 已选择封面" }, [
    parent,
    bad,
    coverFile,
    h("img", { className: "cover-preview" }),
    h("div", { className: "preview-phone" }, ["预览"]),
  ]));
  const rows = mpAct({ op: "draft-rows" }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "42");
  assert.match(rows[0].time, /2026-11-08|今天/);
  const cover = mpAct({ op: "cover-state" });
  assert.equal(cover.filled, true);
  assert.match(cover.selector, /cover/);
  assert.equal(mpAct({ op: "preview-state" }).pane, true);
  assert.equal(mpAct({ op: "image-input" }).ok, true);
  createDocument(h("body", { text: "首页" }));
  assert.equal(mpAct({ op: "focus-body" }).ok, false);
  assert.equal(mpAct({ op: "open-image" }).ok, false);
  assert.equal(mpAct({ op: "image-input" }).ok, false);
  assert.equal(mpAct({ op: "confirm-image" }).confirmed, false);
  assert.equal(mpAct({ op: "set-digest", value: "x" }).ok, false);
  assert.equal(mpAct({ op: "click-save" }).ok, false);
  assert.equal(mpAct({ op: "click-preview" }).ok, false);
  assert.equal(mpAct({ op: "cover-from-body" }).ok, false);
  assert.equal(mpAct({ op: "title-field" }).ok, false);
  assert.equal(mpAct({ op: "read-editor" }).title, "");

  const pick = h("button", {}, ["从正文选择"]);
  const editor = h("div", { className: "editor-body" }, [
    h("img", { attrs: { src: "https://mmbiz.example/a.jpg" } }),
    h("a", { attrs: { href: "https://example.com/a" } }, ["链接"]),
  ]);
  const ok = h("button", {}, ["确认"]);
  createDocument(h("body", { text: "从正文选择 选择图片" }, [pick, editor, ok]));
  assert.equal(mpAct({ op: "cover-from-body" }).ok, true);
  assert.equal(pick.clicked, 1);
  assert.equal(ok.clicked, 1);
  const read = mpAct({ op: "read-editor" });
  assert.deepEqual(read.hrefs, ["https://example.com/a"]);
});

test("a bad location and a query failure stay inside the probe", () => {
  createDocument(h("body"));
  globalThis.location = { href: "::::" };
  assert.equal(mpAct({ op: "probe" }).url, "");
  const broken = {
    title: "",
    body: h("body"),
    querySelectorAll() { throw new Error("bad selector"); },
    querySelector() { return null; },
  };
  globalThis.document = broken;
  assert.equal(mpAct({ op: "probe" }).ok, true);
  assert.equal(mpAct({ op: "scroll" }).ok, true);
});
