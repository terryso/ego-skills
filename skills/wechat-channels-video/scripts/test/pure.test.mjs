import test from "node:test";
import assert from "node:assert/strict";
import {
  channelsClickMethod,
  classifyLogin,
  contentTypeFor,
  coverPreviewDecision,
  descriptionReadbackOk,
  egoMissingSummary,
  maySaveCheckpoint,
  maySaveDraft,
  parseCheckArgs,
  parseServeArgs,
  publicUrl,
  uploadProbeDecision,
  wujieProbeDecision,
} from "../lib/pure.mjs";

test("classifyLogin detects login.html", () => {
  const r = classifyLogin({
    url: "https://channels.weixin.qq.com/login.html",
    title: "登录",
    text: "扫码登录",
  });
  assert.equal(r.logged_in, false);
  assert.equal(r.login_required, true);
  assert.equal(r.on_login_page, true);
});

test("classifyLogin detects platform home", () => {
  const r = classifyLogin({
    url: "https://channels.weixin.qq.com/platform",
    text: "内容管理 发表视频",
    signals: { platformChrome: true },
  });
  assert.equal(r.logged_in, true);
  assert.equal(r.login_required, false);
});

test("parse args", () => {
  assert.equal(parseCheckArgs(["--keep"]).keep, true);
  assert.equal(parseServeArgs(["--file", "/tmp/a.mp4", "--port", "18765"]).port, 18765);
  assert.throws(() => parseServeArgs([]));
});

test("content helpers", () => {
  assert.equal(contentTypeFor("x.mp4"), "video/mp4");
  assert.equal(contentTypeFor("clip.MOV"), "video/quicktime");
  assert.equal(contentTypeFor("a.webm"), "video/webm");
  assert.equal(contentTypeFor("c.png"), "image/png");
  assert.equal(contentTypeFor("c.jpg"), "image/jpeg");
  assert.equal(contentTypeFor("c.jpeg"), "image/jpeg");
  assert.equal(contentTypeFor("c.webp"), "image/webp");
  assert.equal(contentTypeFor("blob.bin"), "application/octet-stream");
  assert.equal(publicUrl(18765, "my video.mp4"), "http://127.0.0.1:18765/my%20video.mp4");
  const missing = egoMissingSummary();
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.login_required, true);
  assert.ok(missing.how_to_login.length >= 5);
  assert.match(missing.login_tip_zh, /扫码/);
});

test("parseCheckArgs and parseServeArgs cover help, names, and bad ports", () => {
  assert.equal(parseCheckArgs(["--help"]).help, true);
  assert.equal(parseCheckArgs(["--task-name", "channels-9"]).taskName, "channels-9");
  assert.equal(parseCheckArgs(["--task-name"]).taskName, "wechat-channels-login-check");
  assert.throws(() => parseCheckArgs(["--nope"]), /Unknown arg/);
  const named = parseServeArgs(["--file", "/tmp/a.mp4", "--name", "clip.mp4", "--port", "9"]);
  assert.equal(named.name, "clip.mp4");
  assert.equal(named.port, 9);
  assert.equal(parseServeArgs(["--help"]).help, true);
  assert.equal(parseServeArgs(["-h"]).file, null);
  assert.throws(() => parseServeArgs(["--file", "/tmp/a.mp4", "--port", "0"]), /--port/);
  assert.throws(() => parseServeArgs(["--file", "/tmp/a.mp4", "--port", "nope"]), /--port/);
  assert.throws(() => parseServeArgs(["--port"]), /--file is required/);
});

test("classifyLogin uses cookies, draft chrome, and ignores QR text off the login page", () => {
  const cookie = classifyLogin({
    url: "https://channels.weixin.qq.com/",
    signals: { loggedInCookie: true },
  });
  assert.equal(cookie.logged_in, true);
  assert.equal(cookie.has_qr_hint, undefined);
  const draft = classifyLogin({ url: "https://channels.weixin.qq.com/platform/post/list", text: "草稿箱" });
  assert.equal(draft.logged_in, true);
  const query = classifyLogin({ url: "https://channels.weixin.qq.com/login?from=home", text: "微信扫一扫" });
  assert.equal(query.on_login_page, true);
  assert.equal(query.has_qr_hint, true);
  assert.equal(query.logged_in, false);
  const empty = classifyLogin({});
  assert.equal(empty.logged_in, false);
  assert.equal(empty.url, undefined);
});

const readyUpload = {
  wujie: true,
  progress: 100,
  hasPreview: true,
  stableCount: 2,
};
const matched = { ok: true, reason: "match" };

test("description readback folds newline runs and stops on mismatch", () => {
  const ok = descriptionReadbackOk(
    { ok: true, value: "正文\n\n#话题" },
    { desc: "正文", tags: "#话题" },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.save, true);
  assert.equal(ok.publish, false);
  assert.equal(descriptionReadbackOk("正文\u00a0\r\n\r\n#话题", "正文\n#话题").reason, "match");
  assert.equal(descriptionReadbackOk({ text: "只有正文" }, { desc: "只有正文" }).ok, true);
  assert.equal(descriptionReadbackOk({ value: "" }, { desc: "正文" }).reason, "empty-readback");
  const mismatch = descriptionReadbackOk({ value: "写歪了" }, { desc: "正文", tags: "#话题" });
  assert.equal(mismatch.reason, "mismatch");
  assert.equal(mismatch.save, false);
  assert.equal(mismatch.publish, false);
  assert.equal(descriptionReadbackOk(null, { desc: "正文" }).reason, "unresolved");
  assert.equal(descriptionReadbackOk({ ok: false }, { desc: "正文" }).reason, "unresolved");
  assert.equal(descriptionReadbackOk({ value: null }, "正文").reason, "unresolved");
  assert.equal(descriptionReadbackOk({ value: "正文" }, { desc: "  ", tags: "" }).reason, "missing-expected");
  assert.equal(descriptionReadbackOk("话题", { desc: "", tags: "话题" }).ok, true);
});

test("upload and wujie waits are bounded and do not authorize a save early", () => {
  assert.equal(uploadProbeDecision(readyUpload).action, "proceed");
  assert.equal(uploadProbeDecision({ ...readyUpload, progress: "100%" }).save, true);
  assert.equal(uploadProbeDecision({
    wujie: true,
    text: "转发\n赞\n评论\n进度 100%",
    stableCount: 2,
  }).action, "proceed");
  assert.equal(uploadProbeDecision({ ...readyUpload, stableCount: 1 }).action, "retry");
  const timedOut = uploadProbeDecision({ ...readyUpload, stableCount: 1 }, { attempt: 8 });
  assert.equal(timedOut.action, "stop");
  assert.equal(timedOut.reason, "timeout");
  assert.equal(timedOut.save, false);
  assert.equal(uploadProbeDecision({ wujie: true, failed: true }, { attempt: 1 }).reason, "failed");
  assert.equal(uploadProbeDecision({ wujie: true, text: "上传出错" }).action, "stop");
  assert.equal(uploadProbeDecision({ wujie: true, text: "上传异常" }).reason, "failed");
  assert.equal(uploadProbeDecision(null, { attempt: 2 }).action, "retry");
  assert.equal(uploadProbeDecision({ wujie: false }, { attempt: 8 }).reason, "unresolved");
  assert.equal(uploadProbeDecision({ readable: false }, { attempt: 1, limit: 0 }).action, "retry");
  assert.equal(wujieProbeDecision({ wujie: true }).action, "proceed");
  assert.equal(wujieProbeDecision(null, { attempt: 3 }).action, "retry");
  assert.equal(wujieProbeDecision({ wujie: false }, { attempt: 8 }).action, "stop");
  assert.equal(wujieProbeDecision(undefined, { attempt: 0 }).action, "retry");
});

test("cover preview must be confirmed before save, and publish stays unauthorized", () => {
  assert.equal(coverPreviewDecision({ requested: false }).action, "skip");
  assert.equal(coverPreviewDecision({ previewChanged: true, spinning: false }).action, "proceed");
  assert.equal(coverPreviewDecision({ previewChanged: true, text: "转圈" }, { attempt: 2 }).reason, "spinning");
  assert.equal(coverPreviewDecision({ previewChanged: false, text: "上传中" }, { attempt: 12 }).reason, "spinning");
  assert.equal(coverPreviewDecision({ previewChanged: false }, { attempt: 4 }).action, "retry");
  assert.equal(coverPreviewDecision({ previewChanged: false }, { attempt: 12 }).reason, "unresolved");
  assert.equal(coverPreviewDecision({ revertedToDefault: true, previewChanged: true }, { attempt: 1 }).reason, "reverted");
  assert.equal(coverPreviewDecision(null, { attempt: 1 }).action, "retry");
  assert.equal(coverPreviewDecision({ readable: false }, { attempt: 12 }).action, "stop");
  assert.equal(coverPreviewDecision({ previewChanged: true }, { attempt: 0, limit: 0 }).action, "proceed");

  const upload = uploadProbeDecision(readyUpload);
  const description = descriptionReadbackOk("正文\n#话题", { desc: "正文", tags: "#话题" });
  const saved = maySaveDraft({ description, upload, cover: coverPreviewDecision({ requested: false }) });
  assert.equal(saved.save, true);
  assert.equal(saved.publish, false);
  const withCover = maySaveDraft({
    description,
    upload,
    cover: coverPreviewDecision({ previewChanged: true }),
  });
  assert.equal(withCover.save, true);
  assert.equal(withCover.publish, false);
  assert.equal(maySaveDraft({ description: descriptionReadbackOk("别的", "正文"), upload }).save, false);
  assert.equal(maySaveDraft({
    description,
    upload: uploadProbeDecision({ ...readyUpload, stableCount: 1 }, { attempt: 8 }),
  }).reason, "upload");
  assert.equal(maySaveDraft({
    description,
    upload,
    cover: coverPreviewDecision({ revertedToDefault: true }),
  }).reason, "cover");
  assert.equal(maySaveDraft({}).reason, "description");
  assert.equal(maySaveDraft({ description, upload }).reason, "cover");
  assert.equal(maySaveDraft({ description, upload }).save, false);
  assert.equal(maySaveCheckpoint(upload).save, true);
  assert.equal(maySaveCheckpoint(upload).publish, false);
  assert.equal(maySaveCheckpoint(uploadProbeDecision(null, { attempt: 8 })).save, false);
  assert.equal(maySaveCheckpoint(null).save, false);
  assert.equal(channelsClickMethod().refClick, false);
  assert.equal(channelsClickMethod().publish, false);
  assert.equal(matched.ok, true);
});
