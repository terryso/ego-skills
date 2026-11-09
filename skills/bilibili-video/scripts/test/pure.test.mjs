import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyLogin,
  coverSlotEvidence,
  declareChoice,
  egoMissingSummary,
  flowErrorBody,
  imageDimsFromBuffer,
  loginRequiredBody,
  manuscriptFromText,
  mayClickSubmit,
  parseCheckArgs,
  parsePublishArgs,
  parseTags,
  partitionChoice,
  planBody,
  publishMode,
  publishSuccessBody,
  ratioWithin,
  resolveEgoExit,
  validatePublishInput,
} from "../lib/pure.mjs";

// --- parsePublishArgs ---

test("parsePublishArgs: required flags and comma tags", () => {
  const r = parsePublishArgs([
    "--video", "/tmp/v.mp4",
    "--title", "标题",
    "--desc", "描述 #话题",
    "--tags", "a,b，c",
    "--yes",
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.args.video, "/tmp/v.mp4");
  assert.equal(r.args.title, "标题");
  assert.equal(r.args.yes, true);
  assert.equal(r.args.tags, "a,b，c");
});

test("parsePublishArgs: inline = syntax and covers", () => {
  const r = parsePublishArgs([
    "--video=/tmp/v.mp4",
    "--title=t",
    "--cover-4x3=/a.png",
    "--cover-16x9=/b.jpg",
    "--space-id=42",
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.args.cover43, "/a.png");
  assert.equal(r.args.cover169, "/b.jpg");
  assert.equal(r.args.spaceId, 42);
});

test("parsePublishArgs: rejects unknown flag and missing value", () => {
  assert.ok(parsePublishArgs(["--nope"]).error);
  assert.ok(parsePublishArgs(["--video"]).error);
  assert.ok(parsePublishArgs(["--space-id", "x"]).error);
});

test("parseCheckArgs", () => {
  assert.deepEqual(parseCheckArgs(["--keep"]), { keep: true, taskName: "", help: false });
  const withName = parseCheckArgs(["--task-name", "s1"]);
  assert.equal(withName.taskName, "s1");
  assert.throws(() => parseCheckArgs(["--bogus"]), /未知参数/);
});

// --- validatePublishInput ---

const good = {
  video: "/tmp/v.mp4",
  title: "t",
  desc: "",
  tags: "",
  cover43: "",
  cover169: "",
  videoExists: true,
  videoSize: 1024 * 1024,
};

test("validatePublishInput: happy path with tag list", () => {
  const r = validatePublishInput({ ...good, tags: "a,b" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tagList, ["a", "b"]);
  assert.equal(r.sizeMB, 1);
});

test("validatePublishInput: title required and length-capped", () => {
  assert.match(validatePublishInput({ ...good, title: "" }).error, /title|标题/);
  assert.ok(validatePublishInput({ ...good, title: "x".repeat(81) }).error);
});

test("validatePublishInput: desc max 2000", () => {
  assert.ok(validatePublishInput({ ...good, desc: "x".repeat(2001) }).error);
});

test("validatePublishInput: video checks", () => {
  assert.ok(validatePublishInput({ ...good, video: "" }).error);
  assert.match(validatePublishInput({ ...good, videoExists: false }).error, /不存在/);
  assert.match(validatePublishInput({ ...good, video: "/tmp/v.txt" }).error, /格式/);
  assert.ok(validatePublishInput({ ...good, videoSize: 17 * 1024 ** 3 }).error);
});

test("validatePublishInput: covers must come as a pair with right ratios", () => {
  assert.match(validatePublishInput({ ...good, cover43: "/a.png" }).error, /两张/);
  assert.match(validatePublishInput({ ...good, cover169: "/b.jpg" }).error, /两张/);
  const pairOk = validatePublishInput({
    ...good,
    cover43: "/a.png",
    cover169: "/b.jpg",
    cover43Dims: { width: 1080, height: 810 },
    cover169Dims: { width: 1080, height: 608 },
  });
  assert.equal(pairOk.ok, true);
  assert.match(
    validatePublishInput({
      ...good,
      cover43: "/a.png",
      cover169: "/b.jpg",
      cover43Dims: { width: 500, height: 500 },
    }).error,
    /不是目标比例/,
  );
  assert.match(
    validatePublishInput({ ...good, cover43: "/a.gif", cover169: "/b.jpg" }).error,
    /只支持 png\/jpg/,
  );
});

test("validatePublishInput: tag limits", () => {
  assert.ok(validatePublishInput({ ...good, tags: "1,2,3,4,5,6,7,8,9,10,11" }).error);
  assert.ok(validatePublishInput({ ...good, tags: "x".repeat(21) }).error);
  assert.deepEqual(parseTags(" a ，b,,c ").filter(Boolean), ["a", "b", "c"]);
});

// --- imageDimsFromBuffer ---

test("imageDimsFromBuffer: png IHDR", () => {
  const buf = Buffer.alloc(33);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf.writeUInt32BE(1080, 16);
  buf.writeUInt32BE(810, 20);
  assert.deepEqual(imageDimsFromBuffer(buf), { width: 1080, height: 810, format: "png" });
});

test("imageDimsFromBuffer: jpeg SOF0 with EXIF (APP1) before it", () => {
  const parts = [
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, 0x00, 0x10, ...Array(14).fill(0)]), // APP1
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x60, 0x04, 0x38]),
  ];
  const dims = imageDimsFromBuffer(Buffer.concat(parts));
  assert.deepEqual(dims, { height: 0x0260, width: 0x0438, format: "jpeg" });
});

test("imageDimsFromBuffer: junk returns null", () => {
  assert.equal(imageDimsFromBuffer(Buffer.from("not an image at all!!!!!!!")), null);
  assert.equal(imageDimsFromBuffer(Buffer.alloc(4)), null);
});

test("ratioWithin tolerance", () => {
  assert.equal(ratioWithin(1080, 810, 4 / 3), true);
  assert.equal(ratioWithin(1080, 608, 16 / 9), true);
  assert.equal(ratioWithin(1080, 1440, 4 / 3), false);
  assert.equal(ratioWithin(0, 810, 4 / 3), false);
});

// --- classifyLogin ---

test("classifyLogin: logged in on creator page", () => {
  const r = classifyLogin({
    url: "https://member.bilibili.com/platform/upload/video/frame",
    text: "创作中心 投稿 内容管理 上传视频",
  });
  assert.equal(r.logged_in, true);
});

test("classifyLogin: login wall wins", () => {
  const r = classifyLogin({
    url: "https://passport.bilibili.com/login",
    text: "扫码登录",
  });
  assert.equal(r.logged_in, false);
  const wall = classifyLogin({ url: "https://member.bilibili.com/x", text: "请扫码登录后操作" });
  assert.equal(wall.logged_in, false);
});

// --- bodies / exits ---

test("loginRequiredBody and egoMissingSummary shape", () => {
  const b = loginRequiredBody({ spaceId: 7, url: "u" });
  assert.equal(b.exit_code, 2);
  assert.equal(b.login_required, true);
  assert.ok(b.how_to_login);
  const e = egoMissingSummary("publish");
  assert.equal(e.exit_code, 2);
  assert.match(e.error, /ego-browser/);
});

test("flowErrorBody and planBody and publishSuccessBody", () => {
  assert.deepEqual(flowErrorBody("x", { a: 1 }), { ok: false, error: "x", a: 1 });
  const plan = planBody({ video: "v", sizeMB: 1, title: "t", desc: "", tags: "a,b", cover43: "", cover169: "", spaceId: null });
  assert.equal(plan.exit_code, 3);
  assert.equal(plan.cover_mode, "none");
  assert.match(plan.note, /不打开浏览器/);
  const planC = planBody({ video: "v", sizeMB: 1, title: "t", desc: "", tags: "", cover43: "/a", cover169: "/b", type: "知识" });
  assert.equal(planC.cover_mode, "two-ratio");
  assert.equal(planC.type, "知识");
  const ok = publishSuccessBody({ title: "t", type: "科技数码", tags: ["a"], coverApplied: { "4x3": { width: 1280, height: 960 }, "16x9": { width: 1280, height: 720 } } });
  assert.equal(ok.status, "审核中");
  assert.equal(ok.identity, "unconfirmed");
  assert.equal(ok.url, null);
  const identified = publishSuccessBody({ title: "t", bvid: "BV1uVW46QEZn" });
  assert.equal(identified.url, "https://www.bilibili.com/video/BV1uVW46QEZn/");
  assert.equal(identified.identity, "bvid");
});

test("partitionChoice does not keep a remembered partition for an unknown name", () => {
  assert.deepEqual(partitionChoice({ requested: "", current: "音乐" }), { action: "keep", reason: "remembered", type: "音乐" });
  assert.equal(partitionChoice({ requested: "", current: "" }).action, "fail");
  assert.equal(partitionChoice({ requested: "音乐", current: "音乐" }).action, "keep");
  assert.equal(partitionChoice({ requested: "知识", current: "音乐", options: ["影视", "音乐"] }).reason, "unsupported");
  assert.equal(partitionChoice({ requested: "知识", current: "音乐", options: ["知识", "音乐"] }).action, "select");
});

test("an already displayed declaration is kept and submit cannot be combined with the stop flag", () => {
  assert.equal(declareChoice({ requested: "内容无需标注", current: "内容无需标注", options: [] }).action, "keep");
  assert.equal(declareChoice({ requested: "含AI生成内容", current: "内容无需标注", options: ["含AI生成内容"] }).action, "select");
  assert.equal(declareChoice({ requested: "含AI生成内容", current: "内容无需标注", options: [] }).reason, "closed-or-missing");
  assert.equal(publishMode({ yes: false, stopBeforeSubmit: false }), "plan");
  assert.equal(publishMode({ yes: true, stopBeforeSubmit: true }), "stop-before-submit");
  assert.equal(mayClickSubmit({ yes: true, stopBeforeSubmit: true }).allow, false);
  assert.equal(mayClickSubmit({ yes: true, stopBeforeSubmit: false }).allow, true);
  assert.equal(mayClickSubmit({ yes: false, stopBeforeSubmit: true }).allow, false);
});

test("the submit click stays behind the stop gate", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const source = await readFile(fileURLToPath(new URL("../post-video.mjs", import.meta.url)), "utf8");
  const gate = source.indexOf("mayClickSubmit");
  const click = source.indexOf("点击立即投稿");
  assert.ok(gate > 0 && click > gate);
});

test("cover slots keep their own measurements and a BV id is read from text", () => {
  assert.deepEqual(coverSlotEvidence({ slot: "cover-phone-view-home-video-img", width: 1280, height: 960, target: 4 / 3 }).height, 960);
  assert.equal(coverSlotEvidence({ slot: "cover-phone-view-space-video-img", width: 1280, height: 960, target: 16 / 9 }), null);
  assert.equal(manuscriptFromText("稿件投递成功").identity, "unconfirmed");
  assert.equal(manuscriptFromText("https://www.bilibili.com/video/BV1uVW46QEZn/").bvid, "BV1uVW46QEZn");
});

test("resolveEgoExit maps login_required JSON to 2", () => {
  const line = JSON.stringify(loginRequiredBody({ spaceId: 1 }));
  assert.equal(resolveEgoExit({ stdout: `${line}\n`, stderr: "", code: 0 }), 2);
  assert.equal(resolveEgoExit({ stdout: "", stderr: "boom", code: 1 }), 1);
  assert.equal(resolveEgoExit({ stdout: "", stderr: "", code: 0 }), 0);
});
