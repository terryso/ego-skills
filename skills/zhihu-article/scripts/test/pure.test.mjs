import assert from "node:assert/strict";
import test from "node:test";
import {
  BODY_MAX,
  COVER_MIN_HEIGHT,
  COVER_MIN_WIDTH,
  IMAGE_MAX_BYTES,
  TITLE_MAX,
  buildArticle,
  charCount,
  classifyOutcome,
  classifyAccess,
  coalescePastes,
  compactText,
  decideAccount,
  decideAttempt,
  defaultReceiptDir,
  draftEditUrl,
  draftIdFromUrl,
  egoMissingSummary,
  extractTaggedJson,
  formatResult,
  headingWasFlattened,
  imageSize,
  inspectImage,
  isPublishedArticleUrl,
  normalizeText,
  parseCheckArgs,
  parseCleanupArgs,
  parseMarkdown,
  parsePlain,
  parsePreviewArgs,
  parseSaveArgs,
  planOf,
  redactUrl,
  resolveProcessExit,
  seal,
  sniffImage,
  validateReadback,
} from "../lib/pure.mjs";
import { COVER, jpeg, png } from "./images.mjs";

const markdown = `---
title: 示例标题
description: 不会单独投稿
---

一段说明，带一个[链接](https://example.com/docs)。

## 小节

- 第一点
- **第二点**

![配图](./image.png)
`;

test("parsers accept a neutral article and reject unsupported constructs", () => {
  const parsed = parseMarkdown(markdown);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.title, "示例标题");
  assert.equal(parsed.description, "不会单独投稿");
  const article = buildArticle({
    parsed,
    images: [{ name: "image.png", path: "/absolute/path/to/image.png", sha256: "abc", bytes: 10, width: 16, height: 16 }],
    title: "",
  });
  assert.equal(article.ok, true);
  assert.equal(article.title, "示例标题");
  assert.equal(article.imageCount, 1);
  assert.equal(article.headings[0].level, 2);
  assert.equal(article.links[0].href, "https://example.com/docs");
  assert.equal(planOf(article).publishPermitted, false);
  assert.equal(article.hash, buildArticle({
    parsed,
    images: [{ name: "image.png", path: "/elsewhere/image.png", sha256: "abc", bytes: 10, width: 16, height: 16 }],
  }).hash);
  const covered = buildArticle({
    parsed,
    images: [{ name: "image.png", path: "/absolute/path/to/image.png", sha256: "abc", bytes: 10, width: 16, height: 16 }],
    cover: { name: "cover.png", path: "/absolute/path/to/cover.png", sha256: "c", bytes: 4, width: 1200, height: 400 },
  });
  assert.equal(covered.cover.path, "/absolute/path/to/cover.png");
  assert.equal(planOf(covered).cover.path, undefined);

  const plain = buildArticle({ parsed: parsePlain("只有正文", "纯文本标题"), images: [] });
  assert.equal(plain.ok, true);
  assert.equal(plain.plain, true);
  assert.match(plain.segments[0].html, /只有正文/);

  const blocked = parseMarkdown("```js\nconsole.log(1)\n```\n\n| a | b |\n\n> 引用\n\n#### 太深\n\n  - 嵌套\n\n脚注[^1]\n\n$$\nx$$\n\n![[wiki.png]]\n\n`<tag>`\n\n<script>alert(1)</script>\n\n![远端](https://example.com/a.png)\n\n![坏](javascript:alert)\n\n段落里 ![内联](./a.png) 不行\n\n[坏链](javascript:alert(1))\n\n---\n");
  const ids = blocked.unsupported.map((item) => item.id);
  for (const id of ["code-fence", "table", "blockquote", "heading-depth", "nested-list", "footnote", "math", "wiki-image", "inline-code", "raw-html", "remote-image", "bad-image", "inline-image", "unsafe-link", "thematic-break"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(buildArticle({ parsed: blocked, images: [] }).ok, false);
});

test("title and body guards fail closed", () => {
  const empty = buildArticle({ parsed: parsePlain("   ", ""), images: [] });
  assert.match(empty.error, /title is empty/);
  const longTitle = "题".repeat(TITLE_MAX + 1);
  const long = buildArticle({ parsed: parsePlain("正文", longTitle), images: [] });
  assert.match(long.error, /local guard/);
  const huge = buildArticle({ parsed: parsePlain("文".repeat(BODY_MAX + 1), "标题"), images: [] });
  assert.match(huge.error, /body is/);
  const mismatch = buildArticle({
    parsed: parseMarkdown("![配图](./a.png)"),
    images: [],
    title: "标题",
  });
  assert.match(mismatch.error, /image count/);
  assert.equal(charCount("题a"), 2);
  assert.equal(normalizeText(" a \n b "), "a b");
});

test("flags refuse publish consent and keep draft consent separate", () => {
  assert.equal(parseSaveArgs(["--save-draft", "--markdown", "/absolute/path/to/article.md"]).saveDraft, true);
  assert.throws(() => parseSaveArgs(["--publish"]), /does not grant permission to publish/);
  assert.throws(() => parseSaveArgs(["--save-draft", "--yes"]), /not draft-save consent/);
  assert.equal(parseSaveArgs(["--verify-draft", "--markdown", "/absolute/path/to/article.md"]).verifyDraft, true);
  assert.throws(() => parseSaveArgs(["--save-draft", "--verify-draft"]), /separate commands/);
  assert.equal(parseSaveArgs(["--repair-draft"]).repairDraft, true);
  assert.throws(() => parsePreviewArgs(["--schedule"]), /Scheduling/);
  assert.throws(() => parseSaveArgs(["--answer"]), /articles only/);
  assert.throws(() => parseSaveArgs(["--idea"]), /articles only/);
  assert.throws(() => parseSaveArgs(["--comment"]), /articles only/);
  assert.throws(() => parseSaveArgs(["--kind", "answer"]), /articles only/);
  assert.throws(() => parseSaveArgs(["--keep"]), /not supported/);
  assert.throws(() => parsePreviewArgs(["--save-draft"]), /only valid for save-draft/);
  assert.throws(() => parsePreviewArgs(["--expect-account", "示例作者"]), /not valid for offline preview/);
  assert.throws(() => parseCheckArgs(["--markdown", "/absolute/path/to/article.md"]), /only valid for preview/);
  assert.throws(() => parseCleanupArgs(["--title", "标题"]), /only valid for preview/);
  assert.throws(() => parseSaveArgs(["--nope"]), /Unknown argument/);
  assert.throws(() => parseSaveArgs(["--markdown"]), /Missing value/);
  const quoted = parseCheckArgs(["--expect-account", '"示例作者"']);
  assert.equal(quoted.expectAccount, "示例作者");
  assert.equal(parseSaveArgs(["--text=正文", "--title=示例标题"]).text, "正文");
  assert.equal(parsePreviewArgs(["--help"]).help, true);
});

test("account decisions fail closed", () => {
  assert.equal(decideAccount({ loginWall: true, loggedIn: false, accounts: [] }).reason, "logged-out");
  assert.equal(decideAccount({ loggedIn: true, accounts: ["示例作者", "另一账号"] }).reason, "ambiguous-account");
  assert.equal(decideAccount({ loggedIn: true, accounts: [] }).reason, "identity-not-visible");
  assert.equal(decideAccount({ loggedIn: true, accounts: [] }).identityVisible, false);
  assert.equal(decideAccount({ loggedIn: true, accounts: ["示例作者"] }, "另一账号").reason, "account-mismatch");
  assert.equal(decideAccount({ loggedIn: true, accounts: ["示例作者"] }, "示例作者").account, "示例作者");
  assert.equal(decideAccount(null).exitCode, 2);
  const write = { ok: true, loginWall: false, loggedIn: true, editorReady: true, accounts: ["BMAD实验室"] };
  assert.equal(classifyAccess(write, { openedWrite: true }).reason, "ok");
  assert.equal(classifyAccess({ ok: true, loginWall: false, loggedIn: false, editorReady: false }, { openedWrite: true }).reason, "session-unrecognized");
  assert.equal(classifyAccess({ ok: false, evaluateFailed: true, loginWall: false }, { openedWrite: true }).reason, "probe-failed");
  assert.equal(classifyAccess({ ok: true, loginWall: true, surface: "signin" }, { openedWrite: true }).reason, "login-expired");
  assert.equal(classifyAccess({ ok: true, loginWall: true }, { openedWrite: false }).reason, "logged-out");
  assert.equal(classifyAccess({ ok: true, challenge: true, loginWall: false }).reason, "challenge");
});

test("attempt and outcome states never treat a click or autosave as publish", () => {
  assert.equal(decideAttempt({ saveDraft: false, hash: "a" }).action, "preview");
  const saved = { hash: "a", state: "draft-saved", verified: true, draftId: "9" };
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: saved }).action, "already-saved");
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: { hash: "a", state: "unverified" } }).action, "blocked-previous-mutation");
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: { hash: "a", state: "unverified", draftId: "55" } }).action, "verify-required");
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: { hash: "a", state: "unverified", draftId: "55" } }).error, "verify-draft-required");
  assert.equal(decideAttempt({ verifyDraft: true, hash: "a", receipt: { hash: "a", state: "unverified", draftId: "55" } }).action, "verify-draft");
  assert.equal(decideAttempt({ verifyDraft: true, hash: "a", receipt: { hash: "a", state: "uploaded", draftId: "55" } }).resume, true);
  assert.equal(decideAttempt({ repairDraft: true, hash: "a", receipt: { hash: "a", state: "unverified", draftId: "55" } }).repair, true);
  assert.equal(decideAttempt({ repairDraft: true, hash: "a", receipt: { hash: "a", state: "unverified" } }).error, "repair-draft-required");
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: { hash: "a", state: "uploaded", draftId: "55" } }).resume, undefined);
  assert.equal(decideAttempt({ saveDraft: true, hash: "a", receipt: { hash: "a", state: "uploaded" } }).exitCode, 4);
  assert.equal(decideAttempt({ saveDraft: true, hash: "b", receipt: saved }).action, "save");

  const verified = classifyOutcome({
    accepted: true,
    draftId: "9",
    autosaveBadge: true,
    readbackOk: true,
  });
  assert.equal(verified.state, "draft-saved");
  assert.equal(verified.mutation, "autosave-verified");
  assert.equal(verified.publishPermitted, false);

  const explicit = classifyOutcome({
    accepted: true,
    explicitControl: true,
    explicitClicked: true,
    draftId: "9",
    autosaveBadge: true,
    readbackOk: true,
    coverRequired: true,
    coverApplied: true,
  });
  assert.equal(explicit.mutation, "explicit-save");
  assert.equal(explicit.verified, true);

  const badgeOnly = classifyOutcome({ accepted: true, autosaveBadge: true, readbackOk: true });
  assert.equal(badgeOnly.state, "unverified");
  assert.equal(badgeOnly.error, "draft-id-unobserved");
  assert.equal(badgeOnly.verified, false);

  const clickOnly = classifyOutcome({ accepted: true, explicitClicked: true });
  assert.equal(clickOnly.state, "unverified");
  assert.notEqual(clickOnly.state, "draft-saved");

  const ambiguous = classifyOutcome({
    accepted: true,
    explicitControl: true,
    autosaveObserved: true,
    draftId: "9",
    autosaveBadge: true,
    readbackOk: true,
  });
  assert.equal(ambiguous.error, "autosave-without-explicit-save");

  const uploaded = classifyOutcome({ accepted: true, mediaSubmitted: true, timedOut: true, error: "upload-timeout" });
  assert.equal(uploaded.state, "uploaded");
  assert.equal(uploaded.retryable, false);

  const timed = classifyOutcome({ accepted: true, timedOut: true });
  assert.equal(timed.error, "autosave-timeout");
  assert.equal(classifyOutcome({ published: true, draftId: "9" }).error, "published-url");
  assert.equal(classifyOutcome({ forbidden: true }).error, "publish-refused");
  assert.equal(classifyOutcome({ localFailure: true, error: "title readback mismatch" }).state, "failed");
  assert.equal(classifyOutcome({ localFailure: true, retryable: false }).retryable, false);
  assert.equal(classifyOutcome({}).state, "not-started");
  const cover = classifyOutcome({
    accepted: true,
    draftId: "9",
    autosaveBadge: true,
    readbackOk: true,
    coverRequired: true,
    coverApplied: false,
  });
  assert.equal(cover.state, "unverified");
  assert.equal(cover.error, "cover-unverified");
});

test("readback requires structure, not a button", () => {
  const article = buildArticle({ parsed: parseMarkdown(markdown), images: [{ name: "image.png", sha256: "abc", bytes: 1 }] }).valueOf();
  const built = buildArticle({
    parsed: parseMarkdown(markdown),
    images: [{ name: "image.png", sha256: "abc", bytes: 1, width: 1, height: 1 }],
  });
  const good = validateReadback(built, {
    title: "示例标题",
    text: "一段说明，带一个链接。 小节 第一点 第二点",
    headings: [{ level: 2, text: "小节" }],
    listItems: ["第一点", "第二点"],
    hrefs: ["https://example.com/docs"],
    imageCount: 1,
  });
  assert.equal(good.ok, true);
  assert.equal(good.missing.includes("配图"), false);
  const doubled = validateReadback(built, {
    title: "示例标题",
    text: "一段说明，带一个链接。 一段说明，带一个链接。 小节 第一点 第二点",
    headings: [{ level: 2, text: "小节" }, { level: 2, text: "小节" }],
    listItems: ["第一点", "第二点", "第一点", "第二点"],
    hrefs: ["https://example.com/docs"],
    imageCount: 1,
  });
  assert.equal(doubled.ok, false);
  assert.equal(doubled.duplicateLead, true);
  assert.equal(doubled.duplicateShape, true);
  const coverSource = {
    title: "标题",
    snippets: ["导语"],
    headings: [],
    listItems: [],
    links: [],
    imageCount: 2,
    cover: { name: "cover.png", width: 1200, height: 400 },
  };
  const coverSaved = validateReadback(coverSource, {
    title: "标题",
    text: "导语",
    headings: [],
    listItems: [],
    hrefs: [],
    imageCount: 2,
    coverApplied: false,
    coverProbe: {
      emptyHint: true,
      widget: { inputCount: 1, images: [{ visible: true, natural: { width: 1200, height: 400 } }] },
    },
  });
  assert.equal(coverSaved.coverMatch, true);
  assert.equal(coverSaved.coverOk, true);
  assert.equal(coverSaved.ok, true);
  const coverWrong = validateReadback(coverSource, {
    title: "标题",
    text: "导语",
    headings: [],
    listItems: [],
    hrefs: [],
    imageCount: 2,
    coverApplied: false,
    coverProbe: {
      emptyHint: true,
      widget: { inputCount: 1, images: [{ visible: true, natural: { width: 800, height: 500 } }] },
    },
  });
  assert.equal(coverWrong.coverMatch, false);
  assert.equal(coverWrong.coverOk, false);
  const spaced = validateReadback({
    title: "标题",
    snippets: ["这段包含 粗体 和 斜体，以及一个链接：知乎专栏常见问题。", "验收配图一"],
    headings: [{ level: 2, text: "正文配图" }],
    listItems: [],
    links: [],
    imageCount: 2,
    segments: [{ kind: "image", alt: "验收配图一" }],
  }, {
    title: "标题",
    text: "排版检查这段包含 粗体 和 斜体，以及一个链接：\u200b 知乎专栏常见问题。 正文配图",
    headings: [{ level: 2, text: "正文配图" }],
    listItems: [],
    hrefs: [],
    imageCount: 2,
  });
  assert.deepEqual(spaced.missing, []);
  assert.equal(spaced.missingHeadings.includes("正文配图"), false);
  assert.equal(headingWasFlattened({ headings: [{ level: 2, text: "排版检查" }] }, {
    text: "排版检查这段包含",
    headings: [],
  }), true);
  assert.equal(headingWasFlattened({ headings: [{ level: 2, text: "正文配图" }] }, {
    text: "正文配图",
    headings: [{ level: 2, text: "正文配图" }],
  }), false);
  const groups = coalescePastes([
    { kind: "html", html: "<p>甲</p>", text: "甲" },
    { kind: "html", html: "<h2>排版检查</h2>", text: "排版检查" },
    { kind: "image", path: "/absolute/path/to/a.png" },
    { kind: "html", html: "<p>乙</p>", text: "乙" },
  ]);
  assert.equal(groups.length, 3);
  assert.match(groups[0].html, /<p>甲<\/p><h2>排版检查<\/h2>/);
  assert.equal(groups[1].kind, "image");
  assert.equal(built.cover, null);
  assert.equal(compactText("链接：\u200b 知乎"), "链接：知乎");
  const raw = validateReadback(built, {
    title: "示例标题",
    text: "<p>一段说明，带一个链接。</p> 小节 第一点 第二点 配图",
    headings: [{ level: 2, text: "小节" }],
    listItems: ["第一点", "第二点"],
    hrefs: ["https://example.com/docs"],
    imageCount: 1,
  });
  assert.equal(raw.rawMarkup, true);
  assert.equal(raw.ok, false);
  assert.equal(article && built.imageCount, 1);
});

test("image inspection accepts png and jpeg and rejects malformed files", () => {
  const goodPng = png();
  const goodJpg = jpeg();
  assert.equal(sniffImage(goodPng), "image/png");
  assert.equal(sniffImage(goodJpg), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a" + "x".repeat(20))), "image/gif");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "image/webp");
  assert.equal(sniffImage(Buffer.from("nope")), "");
  assert.deepEqual(imageSize(png(COVER)), COVER);
  assert.deepEqual(imageSize(jpeg(COVER)), COVER);
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0x00])), null);
  assert.equal(inspectImage(png(), "photo.png").ok, true);
  assert.equal(inspectImage(jpeg(), "photo.jpg").ok, true);
  assert.equal(inspectImage(jpeg(), "photo.jpeg").ok, true);
  assert.match(inspectImage(png(), "photo.jpg").error, /extension/);
  assert.match(inspectImage(Buffer.from("GIF89a" + "x".repeat(30)), "a.gif").error, /unsupported image type/);
  assert.match(inspectImage(Buffer.from("short"), "a.png").error, /malformed/);
  assert.match(inspectImage(Buffer.alloc(IMAGE_MAX_BYTES + 1, 1), "a.png").error, /exceeds/);
  assert.match(inspectImage(png({ width: 100, height: 100 }), "cover.png", { role: "cover" }).error, /wider than/);
  assert.equal(inspectImage(png(COVER), "cover.png", { role: "cover" }).ok, true);
  assert.match(inspectImage(png({ width: 0, height: 10 }), "a.png").error, /malformed/);
  const sofSkip = Buffer.alloc(40);
  sofSkip[0] = 0xff;
  sofSkip[1] = 0xd8;
  sofSkip[2] = 0xff;
  sofSkip[3] = 0xd0;
  sofSkip[4] = 0xff;
  sofSkip[5] = 0xc0;
  sofSkip.writeUInt16BE(11, 6);
  sofSkip.writeUInt16BE(20, 9);
  sofSkip.writeUInt16BE(30, 11);
  assert.deepEqual(imageSize(sofSkip), { width: 30, height: 20 });
  assert.ok(COVER_MIN_WIDTH > 0 && COVER_MIN_HEIGHT > 0);
});

test("draft urls, redaction, and result formatting stay draft-only", () => {
  assert.equal(draftEditUrl("123"), "https://zhuanlan.zhihu.com/p/123/edit");
  assert.equal(draftEditUrl("abc"), "");
  assert.equal(draftEditUrl(""), "");
  assert.equal(draftIdFromUrl("https://zhuanlan.zhihu.com/p/42/edit?token=secret"), "42");
  assert.equal(draftIdFromUrl("https://zhuanlan.zhihu.com/p/42"), "");
  assert.equal(isPublishedArticleUrl("https://zhuanlan.zhihu.com/p/42"), true);
  assert.equal(isPublishedArticleUrl("https://zhuanlan.zhihu.com/p/42/edit"), false);
  assert.match(redactUrl("https://www.zhihu.com/signin?token=abc&next=/write"), /token=redacted/);
  assert.equal(redactUrl("not a url"), "");
  const line = formatResult({ exitCode: 0, state: "draft-saved", verified: true, title: "示例标题", draftId: "7", draftUrl: draftEditUrl("7"), publishPermitted: true });
  assert.match(line, /^draft-saved 示例标题 id=7 url=https:\/\/zhuanlan\.zhihu\.com\/p\/7\/edit\n$/);
  assert.doesNotMatch(line, /publish/);
  const preview = formatResult({ command: "preview", exitCode: 0, title: "示例标题", imageCount: 2 });
  assert.match(preview, /state=not-started/);
  const json = JSON.parse(formatResult({ exitCode: 3, state: "not-started", publishPermitted: true }));
  assert.equal(json.publishPermitted, false);
  assert.equal(json.publishSupported, false);
  assert.equal(seal(null).state, "not-started");
  const missing = egoMissingSummary("check-login");
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.login_required, true);
  assert.equal(extractTaggedJson("ZHIHUARTICLE {"), null);
  assert.deepEqual(extractTaggedJson(`noise\nZHIHUARTICLE ${JSON.stringify({ exitCode: 4 })}`), { exitCode: 4 });
  assert.equal(extractTaggedJson("no tag"), null);
  assert.equal(resolveProcessExit("nodejs process exited with code 2", 1), 2);
  assert.equal(resolveProcessExit("", 0), 0);
  assert.equal(resolveProcessExit("", null), 1);
  assert.match(defaultReceiptDir("/tmp/example", {}), /zhihu-article\/receipts$/);
  assert.equal(defaultReceiptDir("", { ZHIHU_ARTICLE_RECEIPT_DIR: "/tmp/receipts" }), "/tmp/receipts");
  assert.equal(defaultReceiptDir(""), "");
});
