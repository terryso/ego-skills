import assert from "node:assert/strict";
import test from "node:test";
import { zhihuAct } from "../lib/dom.mjs";
import { classifyAccess, decideAccount } from "../lib/pure.mjs";
import { createDocument, h } from "./dom-fixture.mjs";

function editorParts() {
  const profile = h("a", { attrs: { href: "/people/example" } }, ["示例作者"]);
  const title = h("textarea", { placeholder: "请输入标题（最多 100 个字）" });
  const body = h("div", { className: "public-DraftEditor-content", editable: true });
  const image = h("input", { type: "file", accept: "image/png,image/jpeg", attrs: { multiple: "true" }, zero: true });
  const cover = h("input", { type: "file", accept: "image/png", className: "UploadPicture-input", zero: true });
  const draft = h("button", {}, ["保存草稿"]);
  const publish = h("button", {}, ["发布"]);
  const invite = h("button", {}, ["邀请预览"]);
  const badge = h("span", {}, ["已保存"]);
  return { profile, title, body, image, cover, draft, publish, invite, badge };
}

function mount(parts, href = "https://zhuanlan.zhihu.com/write") {
  createDocument(h("body", {}, [
    parts.profile, parts.title, parts.body, parts.image, parts.cover, parts.draft, parts.publish, parts.invite, parts.badge,
  ]), { href, title: "写文章" });
  return parts;
}

test("zhihuAct requires a document and ignores unknown operations", () => {
  const previous = globalThis.document;
  delete globalThis.document;
  assert.match(zhihuAct({ op: "probe" }).error, /document/);
  globalThis.document = previous;
  mount(editorParts());
  assert.match(zhihuAct({ op: "nope" }).error, /unknown op/);
  const isolated = new Function(`return (${zhihuAct.toString()})`)();
  assert.equal(isolated({ op: "probe" }).editorReady, true);
});

test("probe separates login, article, answer, idea, and comment surfaces", () => {
  createDocument(h("body", {}, [h("a", {}, ["登录"])]), { href: "https://www.zhihu.com/signin?token=secret" });
  const wall = zhihuAct({ op: "probe" });
  assert.equal(wall.loginWall, true);
  assert.equal(wall.loggedIn, false);
  assert.match(wall.url, /token=redacted/);
  assert.equal(wall.surface, "signin");

  const nav = h("a", { attrs: { href: "/question/1" } }, ["写回答"]);
  const profile = h("a", { attrs: { href: "/people/example" } }, ["示例作者"]);
  const header = h("header", { className: "AppHeader" }, [profile, h("a", {}, ["创作中心"])]);
  createDocument(h("body", {}, [header, nav]), { href: "https://www.zhihu.com/" });
  const home = zhihuAct({ op: "probe" });
  assert.equal(home.surface, "home");
  assert.equal(home.loggedIn, true);
  assert.equal(home.identityVisible, true);
  assert.deepEqual(home.accounts, ["示例作者"]);
  assert.equal(home.editorReady, false);

  const other = h("a", { attrs: { href: "/people/other" } }, ["另一账号"]);
  const both = h("header", {}, [profile, other]);
  createDocument(h("body", {}, [both]), { href: "https://www.zhihu.com/" });
  const many = zhihuAct({ op: "probe" });
  assert.equal(many.ambiguous, true);
  assert.deepEqual(many.accounts, ["示例作者", "另一账号"]);
  assert.equal(many.loggedIn, true);

  createDocument(h("body", {}, [h("button", {}, ["登录"])]), { href: "https://www.zhihu.com/" });
  assert.equal(zhihuAct({ op: "probe" }).loginWall, true);
  createDocument(h("body", {}, [h("div", {}, ["首页"])]), { href: "https://www.zhihu.com/" });
  const unnamed = zhihuAct({ op: "probe" });
  assert.equal(unnamed.loginWall, false);
  assert.equal(unnamed.loggedIn, false);

  const answerTitle = h("textarea", { placeholder: "写回答" });
  createDocument(h("body", {}, [answerTitle]), { href: "https://www.zhihu.com/question/1" });
  assert.equal(zhihuAct({ op: "probe" }).surface, "answer");
  createDocument(h("body", {}, [h("div", { editable: true, placeholder: "写想法" })]), { href: "https://www.zhihu.com/pin/1" });
  assert.equal(zhihuAct({ op: "probe" }).surface, "idea");
  createDocument(h("body", {}, [h("div", { editable: true, attrs: { "aria-label": "写评论" } })]), { href: "https://www.zhihu.com/follow" });
  assert.equal(zhihuAct({ op: "probe" }).surface, "comment");
  createDocument(h("body", {}, []), { href: "https://example.com/" });
  assert.equal(zhihuAct({ op: "probe" }).surface, "other");
});

test("homepage feed authors are not the signed-in account", () => {
  const self = h("a", {
    attrs: { href: "/people/self", "aria-label": "点击打开 示例作者 的主页" },
  });
  const header = h("header", { className: "AppHeader" }, [
    self,
    h("a", {}, ["创作中心"]),
    h("a", {}, ["私信"]),
    h("a", {}, ["消息"]),
  ]);
  const feed = [
    ["八云的饭团", "/people/a"],
    ["木寸上春树", "/people/b"],
    ["新住", "/people/c"],
    ["求生之路", "/people/d"],
    ["王小板儿", "/people/e"],
    ["import 潘多拉", "/people/f"],
    ["invalid s", "/people/g"],
    ["牧之野", "/people/h"],
    ["刘不是", "/people/i"],
    ["Zpuzzle", "/people/j"],
    ["冷哲", "/people/k"],
  ].map(([name, href]) => h("a", { attrs: { href, "aria-label": `点击打开 ${name} 的主页` } }, [name]));
  createDocument(h("body", {}, [header, h("main", {}, feed)]), {
    href: "https://www.zhihu.com/",
    title: "(5 封私信 / 10 条消息) 首页 - 知乎",
  });
  const probe = zhihuAct({ op: "probe" });
  assert.equal(probe.loggedIn, true);
  assert.equal(probe.ambiguous, false);
  assert.equal(probe.identityVisible, true);
  assert.deepEqual(probe.accounts, ["示例作者"]);
  assert.equal(decideAccount(probe, "示例作者").reason, "ok");
  assert.equal(decideAccount(probe, "八云的饭团").reason, "account-mismatch");

  const avatar = h("img", { className: "Avatar", attrs: { alt: "" } });
  const nameless = h("header", { className: "AppHeader" }, [
    h("button", {}, [avatar]),
    h("a", {}, ["创作中心"]),
    h("a", {}, ["私信"]),
  ]);
  createDocument(h("body", {}, [nameless, h("main", {}, feed)]), { href: "https://www.zhihu.com/" });
  const hidden = zhihuAct({ op: "probe" });
  assert.equal(hidden.loggedIn, true);
  assert.equal(hidden.loginWall, false);
  assert.equal(hidden.ambiguous, false);
  assert.deepEqual(hidden.accounts, []);
  const decision = decideAccount(hidden);
  assert.equal(decision.reason, "identity-not-visible");
  assert.equal(decision.exitCode, 4);
  assert.equal(decision.loginRequired, false);
  assert.equal(decideAccount(hidden, "示例作者").reason, "identity-not-visible");
});

test("header avatar alt is the signed-in name, with or without spaces", () => {
  const feed = [
    ["八云的饭团", "/people/a"],
    ["木寸上春树", "/people/b"],
    ["冷哲", "/people/c"],
  ].map(([name, href]) => h("a", { attrs: { href, "aria-label": `点击打开${name}的主页` } }, [name]));
  function page(alt) {
    const logo = h("img", { attrs: { alt: "知乎" } });
    const avatar = h("img", { className: "Avatar", attrs: { alt } });
    const header = h("header", { className: "AppHeader" }, [
      logo,
      h("a", { attrs: { href: "/people/self" } }, [avatar]),
      h("a", {}, ["创作中心"]),
      h("a", {}, ["私信"]),
      h("a", {}, ["消息"]),
    ]);
    createDocument(h("body", {}, [header, h("main", {}, feed)]), {
      href: "https://www.zhihu.com/",
      title: "(5 封私信 / 10 条消息) 首页 - 知乎",
    });
    return zhihuAct({ op: "probe" });
  }
  for (const alt of ["点击打开BMAD实验室的主页", "点击打开 BMAD实验室 的主页"]) {
    const probe = page(alt);
    assert.equal(probe.loggedIn, true, alt);
    assert.equal(probe.ambiguous, false, alt);
    assert.equal(probe.identityVisible, true, alt);
    assert.deepEqual(probe.accounts, ["BMAD实验室"], alt);
    assert.equal(decideAccount(probe, "BMAD实验室").reason, "ok", alt);
    assert.equal(decideAccount(probe, "八云的饭团").reason, "account-mismatch", alt);
  }
  createDocument(h("body", {}, [
    h("main", {}, [h("img", { className: "Avatar", attrs: { alt: "点击打开BMAD实验室的主页" } }), ...feed]),
  ]), { href: "https://www.zhihu.com/" });
  const outside = zhihuAct({ op: "probe" });
  assert.deepEqual(outside.accounts, []);
  assert.equal(outside.identityVisible, false);
  assert.equal(outside.loggedIn, false);
});

test("zhuanlan write page keeps the header avatar and ignores the assistant", () => {
  const logo = h("a", { className: "AppHeader-zhihuLogo" }, ["知乎"]);
  const avatar = h("img", { className: "Avatar AppHeader-profileAvatar", attrs: { alt: "点击打开BMAD实验室的主页" } });
  const title = h("textarea", { placeholder: "请输入标题（最多 100 个字）" });
  const article = h("div", { className: "notranslate public-DraftEditor-content", editable: true, text: "请输入正文" });
  const assistant = h("div", { className: "assistant-panel" }, [
    h("div", { editable: true, text: "创作助手" }),
  ]);
  const publishSettings = h("button", {}, ["发布设置"]);
  const preview = h("button", {}, ["预览"]);
  const publish = h("button", {}, ["发布"]);
  createDocument(h("body", {}, [logo, avatar, title, article, assistant, publishSettings, preview, publish]), {
    href: "https://zhuanlan.zhihu.com/write",
    title: "写文章 - 知乎",
  });
  const probe = zhihuAct({ op: "probe" });
  assert.equal(probe.loginWall, false);
  assert.equal(probe.loggedIn, true);
  assert.equal(probe.surface, "article");
  assert.equal(probe.editorReady, true);
  assert.equal(probe.bodyAmbiguous, false);
  assert.equal(probe.blank, true);
  assert.deepEqual(probe.accounts, ["BMAD实验室"]);
  assert.equal(probe.identityVisible, true);
  assert.equal(probe.pageTitle, "写文章 - 知乎");
  assert.deepEqual(probe.publishLabels, ["发布"]);
  assert.equal(classifyAccess(probe, { openedWrite: true }).reason, "ok");
  assert.equal(decideAccount(probe, "BMAD实验室").reason, "ok");
  assert.equal(publishSettings.clicked, 0);
  assert.equal(publish.clicked, 0);
});

test("article editor exposes draft controls and never clicks 发布 or 邀请预览", () => {
  const parts = mount(editorParts());
  const probe = zhihuAct({ op: "probe" });
  assert.equal(probe.surface, "article");
  assert.equal(probe.editorReady, true);
  assert.equal(probe.blank, true);
  assert.equal(probe.explicitDraftLabel, "保存草稿");
  assert.deepEqual(probe.publishLabels, ["发布"]);
  assert.deepEqual(probe.previewLabels, ["邀请预览"]);
  assert.equal(probe.imageInput, true);
  assert.equal(probe.coverInput, true);
  assert.equal(probe.autosaveLabel, "已保存");
  assert.equal(probe.draftId, "");

  assert.equal(zhihuAct({ op: "mark-title" }).ok, true);
  assert.equal(zhihuAct({ op: "set-title", value: "示例标题" }).ok, true);
  assert.equal(zhihuAct({ op: "focus-title" }).ok, true);
  const read = zhihuAct({ op: "read" });
  assert.equal(read.title, "示例标题");
  assert.equal(read.blank, false);

  assert.equal(zhihuAct({ op: "mark-body" }).ok, true);
  assert.equal(zhihuAct({ op: "focus-body" }).ok, true);
  assert.equal(zhihuAct({ op: "mark-image-input" }).ok, true);
  assert.equal(zhihuAct({ op: "mark-cover-input" }).ok, true);
  const marked = zhihuAct({ op: "mark-draft-save" });
  assert.equal(marked.label, "保存草稿");
  const clicked = zhihuAct({ op: "click-draft-save" });
  assert.equal(clicked.clicked, true);
  assert.equal(parts.draft.clicked, 1);
  assert.equal(parts.publish.clicked, 0);
  assert.equal(parts.invite.clicked, 0);

  parts.draft.setAttribute("data-zhihu-draft", "");
  parts.publish.setAttribute("data-zhihu-draft", "1");
  parts.publish.childNodes = [{ nodeType: 3, textContent: "发布", childNodes: [] }];
  parts.publish.text = "发布";
  const refused = zhihuAct({ op: "click-draft-save" });
  assert.equal(refused.forbidden, true);
  assert.equal(parts.publish.clicked, 0);
});

test("readback counts structure inside the editor and ignores a badge inside the body", () => {
  const title = h("textarea", { placeholder: "请输入标题" });
  const heading = h("h2", {}, ["小节"]);
  const item = h("li", {}, ["第一点"]);
  const link = h("a", { attrs: { href: "https://example.com/docs" } }, ["链接"]);
  const image = h("img", { attrs: { src: "blob:body" } });
  const inside = h("span", {}, ["已保存"]);
  const body = h("div", { className: "public-DraftEditor-content", editable: true, text: "一段说明 小节 第一点 链接" }, [heading, item, link, image, inside]);
  const cover = h("img", { className: "UploadPicture-preview", attrs: { src: "blob:cover" } });
  const profile = h("a", { attrs: { href: "/people/example" } }, ["示例作者"]);
  const editLink = h("a", { attrs: { href: "/p/77/edit?token=secret" } }, ["继续编辑"]);
  createDocument(h("body", {}, [profile, title, body, cover, editLink]), {
    href: "https://zhuanlan.zhihu.com/p/77/edit",
  });
  const read = zhihuAct({ op: "read" });
  assert.equal(read.draftId, "77");
  assert.equal(read.imageCount, 1);
  assert.equal(read.coverApplied, true);
  assert.equal(read.autosaveLabel, "");
  assert.deepEqual(read.headings, [{ level: 2, text: "小节" }]);
  assert.deepEqual(read.listItems, ["第一点"]);
  assert.deepEqual(read.hrefs, ["https://example.com/docs"]);
  assert.equal(read.published, false);

  createDocument(h("body", {}, [
    profile,
    title,
    h("div", { editable: true, text: "正文" }),
  ]), { href: "https://zhuanlan.zhihu.com/p/88" });
  const published = zhihuAct({ op: "read" });
  assert.equal(published.published, true);
  assert.equal(published.draftId, "");

  const first = h("a", { attrs: { href: "/p/1/edit" } }, ["一"]);
  const second = h("a", { attrs: { href: "/p/2/edit" } }, ["二"]);
  createDocument(h("body", {}, [profile, title, h("div", { editable: true }), first, second]), {
    href: "https://zhuanlan.zhihu.com/write",
  });
  assert.equal(zhihuAct({ op: "probe" }).draftAmbiguous, true);
});

test("ambiguous or missing editor controls fail closed", () => {
  const title = h("textarea", { placeholder: "请输入标题" });
  const body = h("div", { editable: true });
  const other = h("div", { editable: true });
  createDocument(h("body", {}, [title, body, other]), { href: "https://zhuanlan.zhihu.com/write" });
  const ambiguousBody = zhihuAct({ op: "probe" });
  assert.equal(ambiguousBody.bodyAmbiguous, true);
  assert.equal(ambiguousBody.editorReady, false);
  assert.match(zhihuAct({ op: "mark-body" }).error, /ambiguous/);

  const one = h("div", { className: "public-DraftEditor-content", editable: true });
  const imageA = h("input", { type: "file", accept: "image/png" });
  const imageB = h("input", { type: "file", accept: "image/jpeg" });
  createDocument(h("body", {}, [title, one, imageA, imageB]), { href: "https://zhuanlan.zhihu.com/write" });
  assert.equal(zhihuAct({ op: "probe" }).imageAmbiguous, true);
  assert.match(zhihuAct({ op: "mark-image-input" }).error, /ambiguous/);

  const disabled = h("input", { type: "file", accept: "image/png", disabled: true });
  createDocument(h("body", {}, [title, one, disabled]), { href: "https://zhuanlan.zhihu.com/write" });
  assert.equal(zhihuAct({ op: "probe" }).imageInput, false);
  assert.match(zhihuAct({ op: "mark-cover-input" }).error, /not found/);

  const cleanTitle = h("textarea", { placeholder: "请输入标题" });
  const answerBody = h("div", { className: "public-DraftEditor-content", editable: true, attrs: { "aria-label": "写回答" } });
  createDocument(h("body", {}, [cleanTitle, answerBody]), { href: "https://zhuanlan.zhihu.com/write" });
  assert.equal(zhihuAct({ op: "probe" }).surface, "mixed");

  createDocument(h("body", {}, [h("div", {}, ["没有标题"])]), { href: "https://zhuanlan.zhihu.com/write" });
  assert.match(zhihuAct({ op: "mark-title" }).error, /not found/);
  assert.match(zhihuAct({ op: "focus-title" }).error, /not found/);
  assert.match(zhihuAct({ op: "set-title", value: "标题" }).error, /not found/);
  assert.match(zhihuAct({ op: "mark-draft-save" }).error, /not found/);
  assert.match(zhihuAct({ op: "click-draft-save" }).error, /not found/);

  const hiddenDraft = h("button", { hidden: true }, ["保存草稿"]);
  const visible = h("button", {}, ["存草稿"]);
  createDocument(h("body", {}, [title, one, hiddenDraft, visible]), { href: "https://zhuanlan.zhihu.com/write" });
  assert.equal(zhihuAct({ op: "mark-draft-save" }).label, "存草稿");
});
