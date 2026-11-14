import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { IMAGE_MAX_BYTES, parseCheckArgs, parseSaveArgs } from "../lib/pure.mjs";
import { prepareTietu } from "../lib/tietu-prepare.mjs";
import {
  TIETU_TEXT_MAX,
  TIETU_TITLE_MAX,
  TIETU_UPLOAD_POLL_MS,
  TIETU_UPLOAD_TIMEOUT_MS,
  appmsgidFromSave,
  appmsgidFromUrl,
  buildTietu,
  charCount,
  composeTietuBody,
  describeFileInputs,
  describeUpload,
  findUrls,
  inspectImage,
  parseSaveResponse,
  planOfTietu,
  redactMpUrl,
  sessionToken,
  tietuEditorUrl,
  tietuListUrl,
  tietuLoginTip,
  trimUploaderHtml,
  uploadAdvanced,
  validateTietuReadback,
} from "../lib/tietu.mjs";

const image = { name: "cover.jpg", path: "/absolute/path/cover.jpg", bytes: 4, sha256: "abc" };
const extra = { name: "more.jpg", path: "/absolute/path/more.jpg", bytes: 8, sha256: "def" };

function post(extraFields = {}) {
  const built = buildTietu({
    title: "编程 agent 的尽头是修车",
    text: "贴图说明\nhttps://example.com/tietu",
    topics: ["编程Agent", "ClaudeCode"],
    images: [image, extra],
    ...extraFields,
  });
  assert.equal(built.ok, true);
  return built;
}

test("tietu args accept a plan and reject article flags, keep, and unknown kinds", () => {
  const saved = parseSaveArgs([
    "--kind=tietu",
    "--title", "编程 agent 的尽头是修车",
    "--text", "正文 https://example.com/a",
    "--image", "/absolute/path/cover.jpg",
    "--image=/absolute/path/more.jpg",
    "--topic", "编程Agent",
    "--topic", "ClaudeCode",
    "--expect-account", "听懂 AI",
    "--yes",
    "--json",
    "--receipt-dir", "/absolute/path/receipts",
    "--screenshot-dir", "/absolute/path/shots",
  ]);
  assert.equal(saved.kind, "tietu");
  assert.equal(saved.yes, true);
  assert.deepEqual(saved.images, ["/absolute/path/cover.jpg", "/absolute/path/more.jpg"]);
  assert.deepEqual(saved.topics, ["编程Agent", "ClaudeCode"]);
  assert.equal(saved.textSet, true);
  assert.equal(parseSaveArgs(["--kind", "article", "--markdown", "/absolute/path/a.md"]).kind, "article");
  assert.throws(() => parseSaveArgs(["--kind", "贴图", "--markdown", "/absolute/path/a.md"]), /Unknown --kind/);
  assert.throws(() => parseSaveArgs(["--kind"]), /Missing value/);
  assert.throws(() => parseSaveArgs(["--kind", "tietu", "--title", "题"]), /--image/);
  assert.throws(() => parseSaveArgs(["--kind", "tietu", "--image", "/absolute/path/a.jpg", "--text", "正文"]), /--title/);
  assert.throws(() => parseSaveArgs(["--kind", "tietu", "--image", "/absolute/path/a.jpg", "--title", "题"]), /--text/);
  assert.throws(() => parseSaveArgs([
    "--kind", "tietu", "--image", "/absolute/path/a.jpg", "--title", "题", "--text", "正文", "--text-file", "/absolute/path/b.txt",
  ]), /only one/);
  assert.throws(() => parseSaveArgs(["--kind", "tietu", "--markdown", "/absolute/path/a.md", "--title", "题", "--text", "正文", "--image", "/absolute/path/a.jpg"]), /article draft/);
  assert.throws(() => parseSaveArgs(["--markdown", "/absolute/path/a.md", "--image", "/absolute/path/a.jpg"]), /--kind tietu/);
  assert.throws(() => parseCheckArgs(["--kind", "tietu"]), /save-draft/);
  assert.throws(() => parseCheckArgs(["--topic", "话题"]), /save-draft/);
});

test("title and body limits fail with the counts, and topics reject hash and spaces", () => {
  assert.equal(charCount("编程 agent 的尽头是修车"), 15);
  assert.equal(charCount("👍"), 1);
  const ok = buildTietu({ title: "字".repeat(TIETU_TITLE_MAX), text: "字".repeat(TIETU_TEXT_MAX), topics: [], images: [image] });
  assert.equal(ok.ok, true);
  assert.equal(ok.charCount, TIETU_TEXT_MAX);
  const longTitle = buildTietu({ title: ` ${"字".repeat(TIETU_TITLE_MAX + 1)} `, text: "正文", images: [image] });
  assert.equal(longTitle.ok, false);
  assert.match(longTitle.error, new RegExp(String(TIETU_TITLE_MAX + 1)));
  assert.match(longTitle.error, new RegExp(String(TIETU_TITLE_MAX)));
  const longText = buildTietu({ title: "题", text: "字".repeat(TIETU_TEXT_MAX + 1), images: [image] });
  assert.match(longText.error, /including URLs/);
  assert.match(longText.error, new RegExp(String(TIETU_TEXT_MAX)));
  const crowded = buildTietu({
    title: "题",
    text: "字".repeat(990),
    topics: ["话".repeat(20)],
    images: [image],
  });
  assert.match(crowded.error, /text plus topics/);
  assert.equal(buildTietu({ title: "", text: "正文", images: [image] }).ok, false);
  assert.match(buildTietu({ title: "题\n第二行", text: "正文", images: [image] }).error, /single line/);
  assert.match(buildTietu({ title: "题", text: "", topics: [], images: [image] }).error, /text is empty/);
  assert.match(buildTietu({ title: "题", text: "正文", images: [] }).error, /--image/);
  assert.match(buildTietu({ title: "题", text: "正文", topics: ["#编程Agent"], images: [image] }).error, /must not include '#'/);
  assert.match(buildTietu({ title: "题", text: "正文", topics: ["编程 Agent"], images: [image] }).error, /without spaces/);
  assert.match(buildTietu({ title: "题", text: "正文", topics: ["  "], images: [image] }).error, /empty/);
});

test("body composition keeps bare urls as text lines and types topics with hash", () => {
  const body = composeTietuBody("贴图说明\r\nhttps://example.com/tietu\n", ["编程Agent", "ClaudeCode"]);
  assert.deepEqual(body.steps, [
    { op: "insertText", value: "贴图说明" },
    { op: "enter" },
    { op: "insertText", value: "https://example.com/tietu" },
    { op: "enter" },
    { op: "insertText", value: "#" },
    { op: "insertText", value: "编程Agent" },
    { op: "insertText", value: " " },
    { op: "insertText", value: "#" },
    { op: "insertText", value: "ClaudeCode" },
  ]);
  assert.equal(body.steps.some((step) => String(step.value || "").includes("\n")), false);
  assert.deepEqual(body.bareUrls, ["https://example.com/tietu"]);
  const inline = composeTietuBody("看 https://example.com/a 吧", []);
  assert.deepEqual(inline.steps, [{ op: "insertText", value: "看 https://example.com/a 吧" }]);
  assert.deepEqual(inline.bareUrls, []);
  assert.deepEqual(findUrls(inline.text), ["https://example.com/a"]);
  const blank = composeTietuBody("上\n\n下", []);
  assert.deepEqual(blank.steps.map((step) => step.op === "enter" ? "enter" : step.value), ["上", "enter", "enter", "下"]);
  const topicsOnly = composeTietuBody("", ["甲", "乙"]);
  assert.deepEqual(topicsOnly.steps.map((step) => step.value || "enter"), ["#", "甲", " ", "#", "乙"]);
  const built = post();
  assert.equal(built.type, 77);
  assert.equal(built.images[0].cover, true);
  assert.equal(built.images[1].cover, false);
  assert.equal(built.fidelity.some((note) => note.includes("not clickable")), true);
  assert.equal(built.fidelity.some((note) => note.includes("小程序")), true);
  const plan = planOfTietu(built, "听懂 AI");
  assert.equal(plan.save, false);
  assert.equal(plan.kind, "tietu");
  assert.equal(plan.type, 77);
  assert.equal(plan.account, "听懂 AI");
  assert.equal(plan.externalUrlsClickable, false);
  assert.equal(plan.imageCount, 2);
  assert.equal(plan.images[0].sha256, "abc");
  assert.equal(plan.images[0].path, undefined);
  assert.deepEqual(plan.topics, ["编程Agent", "ClaudeCode"]);
  assert.deepEqual(plan.bareUrls, ["https://example.com/tietu"]);
  const again = post();
  assert.equal(again.hash, built.hash);
  const changed = buildTietu({
    title: built.title,
    text: built.text,
    topics: built.topics,
    images: [{ ...image, sha256: "fff" }],
  });
  assert.notEqual(changed.hash, built.hash);
  assert.match(tietuLoginTip("听懂 AI").login_tip, /保存为草稿/);
  assert.match(tietuLoginTip("听懂 AI").login_tip_zh, /不会点/);
  assert.match(tietuLoginTip("").login_tip, /type 77/);
});

test("readback compares title, body lines, topics, images, and type 77", () => {
  const built = post();
  const good = validateTietuReadback(built, {
    title: " 编程 agent 的尽头是修车 ",
    text: "贴图说明\nhttps://example.com/tietu",
    topics: ["#编程Agent", "ClaudeCode"],
    imageCount: 2,
    type: 77,
  });
  assert.equal(good.ok, true);
  const missingUrl = validateTietuReadback(built, {
    title: built.title,
    text: "贴图说明",
    topics: built.topics,
    imageCount: 2,
  });
  assert.equal(missingUrl.ok, false);
  assert.match(missingUrl.missing[0], /example\.com/);
  const wrongTopics = validateTietuReadback(built, {
    title: built.title,
    text: built.text,
    topics: ["编程Agent"],
    imageCount: 2,
    type: 77,
  });
  assert.equal(wrongTopics.topicsOk, false);
  assert.equal(validateTietuReadback(built, {
    title: "别的",
    text: built.text,
    topics: built.topics,
    imageCount: 1,
    type: 10,
  }).ok, false);
  const editor = tietuEditorUrl({ token: "test-token" });
  const params = new URL(editor).searchParams;
  assert.equal(params.get("type"), "77");
  assert.equal(params.get("isNew"), "1");
  assert.equal(params.get("createType"), "8");
  assert.equal(params.get("t"), "media/appmsg_edit_v2");
  assert.equal(params.get("token"), "test-token");
  const edit = new URL(tietuEditorUrl({ token: "test-token", appmsgid: "100001815" }));
  assert.equal(edit.searchParams.get("t"), "media/appmsg_edit");
  assert.equal(edit.searchParams.get("appmsgid"), "100001815");
  assert.equal(edit.searchParams.get("isNew"), null);
  const list = new URL(tietuListUrl({ token: "test-token" }));
  assert.equal(list.searchParams.get("action"), "list_card");
  assert.equal(list.searchParams.get("type"), "77");
  assert.equal(list.searchParams.get("count"), "10");
  assert.equal(sessionToken(editor), "test-token");
  assert.equal(sessionToken("https://example.com/?token=test-token"), "");
  assert.equal(sessionToken("not a url"), "");
  assert.equal(appmsgidFromUrl(edit.toString()), "100001815");
  assert.equal(appmsgidFromUrl(editor), "");
  assert.equal(appmsgidFromUrl("not a url"), "");
});

test("inspectImage and prepareTietu accept a local jpeg and reject the rest", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const inspected = inspectImage(jpeg, "cover.jpg");
  assert.equal(inspected.ok, true);
  assert.equal(inspected.type, "image/jpeg");
  assert.equal(inspectImage(Buffer.from("nope"), "notes.txt").ok, false);
  assert.match(inspectImage(Buffer.alloc(IMAGE_MAX_BYTES + 1), "big.jpg").error, /exceeds/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wx-tietu-"));
  const file = path.join(dir, "cover.jpg");
  const textFile = path.join(dir, "body.txt");
  fs.writeFileSync(file, jpeg);
  fs.writeFileSync(textFile, "文件正文\nhttps://example.com/from-file\n");
  const prepared = await prepareTietu({
    images: [file],
    title: "题",
    textFile,
    topics: ["话题"],
    fsImpl: fs,
  });
  assert.equal(prepared.ok, true);
  assert.match(prepared.post.text, /from-file/);
  assert.equal(prepared.post.images[0].cover, true);
  assert.match(prepared.post.images[0].path, /cover\.jpg$/);
  const missing = await prepareTietu({ images: ["/absolute/path/missing.jpg"], title: "题", text: "正文" });
  assert.match(missing.error, /image not found/);
  const bad = await prepareTietu({
    images: [textFile],
    title: "题",
    text: "正文",
    fsImpl: fs,
  });
  assert.match(bad.error, /not an image/);
  const noText = await prepareTietu({
    images: [file],
    title: "题",
    textFile: path.join(dir, "missing.txt"),
    fsImpl: fs,
  });
  assert.match(noText.error, /text file not found/);
  const disk = await prepareTietu({
    images: [file],
    title: "题",
    text: "正文",
    fsImpl: { promises: { readFile: async () => { throw new Error("disk"); } } },
  });
  assert.match(disk.error, /disk/);
  const broken = await prepareTietu({ images: 1, title: "题", text: "正文", fsImpl: fs });
  assert.equal(broken.ok, false);
  const empty = await prepareTietu({ title: "题", text: "正文", fsImpl: fs });
  assert.match(empty.error, /--image/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("upload detection accepts any later signal and describes the file inputs", () => {
  assert.equal(TIETU_UPLOAD_TIMEOUT_MS, 60_000);
  assert.equal(TIETU_UPLOAD_POLL_MS, 500);
  const before = {
    imageCount: 0,
    thumbCount: 0,
    inputValue: "",
    inputChildren: 0,
    placeholder: true,
    uploadResponses: 0,
    fileInputs: [{ index: 1, accept: "" }, { index: 2, accept: "image/jpeg,image/png" }],
    chosenIndex: 2,
  };
  assert.equal(uploadAdvanced(before, { ...before }).ok, false);
  const hinted = uploadAdvanced(before, {
    ...before,
    thumbCount: 1,
    inputValue: "cover.jpg",
    placeholder: false,
    uploadResponses: 1,
  });
  assert.equal(hinted.ok, false);
  assert.ok(hinted.hints.includes("input-value"));
  assert.ok(hinted.hints.includes("upload-response"));
  assert.ok(hinted.hints.includes("thumbnail"));
  const ready = uploadAdvanced(before, { ...before, cdnImageCount: 1 }, { expected: 1 });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.reasons, ["cdn-image"]);
  assert.equal(uploadAdvanced(null, null).ok, false);
  assert.match(describeUpload(before, { ...before, thumbCount: 1 }), /thumbs 0->1/);
  assert.match(describeFileInputs(before), /fileInputs=2/);
  assert.match(describeFileInputs(before), /image\/jpeg,image\/png/);
  assert.match(describeFileInputs(before), /chosen=2/);
  const html = trimUploaderHtml(`<div style="background-image:url(https://mp.weixin.qq.com/a?token=secret)">上传图片</div>`);
  assert.match(html, /token=redacted/);
  assert.doesNotMatch(html, /token=secret/);
  assert.match(trimUploaderHtml("字".repeat(20), 8), /truncated/);
  const saved = parseSaveResponse('{"ret":0,"appMsgId":"100001815"}');
  assert.equal(saved.ok, true);
  assert.equal(saved.appmsgid, "100001815");
  assert.equal(parseSaveResponse({ ret: -1, appMsgId: "9" }).ok, false);
  assert.equal(parseSaveResponse("not json").ok, false);
  assert.equal(appmsgidFromSave({ urlId: "42", responses: [{ ret: 0, appMsgId: "7" }] }).via, "url");
  assert.equal(appmsgidFromSave({ responses: [{ ret: 0, appMsgId: "7" }] }).appmsgid, "7");
  assert.equal(appmsgidFromSave({ responses: [{ ret: 1, appMsgId: "7" }] }).appmsgid, "");
  assert.match(redactMpUrl("https://mp.weixin.qq.com/cgi-bin/appmsg?token=secret&type=77"), /token=redacted/);
  assert.equal(redactMpUrl("not a url"), "");
});
