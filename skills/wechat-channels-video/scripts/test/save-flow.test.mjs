import assert from "node:assert/strict";
import test from "node:test";
import { executeSaveDraft, saveDraftControl, saveDraftFlow } from "../lib/save-flow.mjs";

function readyFresh(overrides = {}) {
  return {
    description: { ok: true, text: "正文\n#话题" },
    upload: { wujie: true, readable: true, progress: 100, hasPreview: true, failed: false, text: "100% 转发 赞 评论" },
    cover: { readable: true, previewChanged: true, spinning: false, text: "" },
    ...overrides,
  };
}

function scripted(reads, click = async () => true) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async readFresh() {
      calls.push("read");
      const next = reads[Math.min(index, reads.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    async pause() { calls.push("pause"); },
    async clickSaveDraft() {
      calls.push("click");
      return click();
    },
  };
}

const yes = { yes: true, desc: "正文", tags: "#话题", coverRequested: true };

test("a confirmed save reads the editor again and only then clicks 保存草稿", async () => {
  const session = scripted([readyFresh()]);
  const result = await executeSaveDraft(yes, session);
  assert.equal(result.clicked, true);
  assert.equal(result.publish, false);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(session.calls.filter((call) => call === "click"), ["click"]);
  assert.ok(session.calls.indexOf("read") < session.calls.lastIndexOf("read") || session.calls.includes("read"));
  assert.equal(session.calls.at(-1), "click");
  assert.equal(session.calls.filter((call) => call === "click").length, 1);
});

test("missing, mismatched, failed, or unfinished state never clicks save", async () => {
  const cases = [
    readyFresh({ description: { ok: true, text: "别的正文" } }),
    readyFresh({ description: { ok: false } }),
    readyFresh({ upload: { wujie: true, readable: true, failed: true, text: "上传失败" } }),
    readyFresh({ upload: { wujie: true, readable: true, progress: 40, hasPreview: false, text: "上传中" } }),
    readyFresh({ upload: null }),
    readyFresh({ cover: { readable: true, previewChanged: false, text: "上传中" } }),
    readyFresh({ cover: { readable: true, revertedToDefault: true, previewChanged: true } }),
    readyFresh({ cover: null }),
    null,
  ];
  for (const fresh of cases) {
    const session = scripted([fresh]);
    const result = await executeSaveDraft(yes, session);
    assert.equal(result.clicked, false, JSON.stringify(fresh));
    assert.equal(result.publish, false);
    assert.equal(session.calls.includes("click"), false);
  }
});

test("without --yes the save flow does not read or click", async () => {
  const session = scripted([readyFresh()]);
  const result = await executeSaveDraft({ desc: "正文", tags: "#话题", coverRequested: true }, session);
  assert.equal(result.exitCode, 3);
  assert.equal(result.clicked, false);
  assert.deepEqual(session.calls, []);
});

test("a click that does not land is not reported as saved", async () => {
  const session = scripted([readyFresh()], async () => false);
  const result = await executeSaveDraft(yes, session);
  assert.equal(result.clicked, false);
  assert.equal(result.save, false);
  assert.equal(session.calls.at(-1), "click");
});

test("an unreadable editor and a thrown click both stop closed", async () => {
  const unreadable = scripted([new Error("shadow root missing")]);
  const unread = await saveDraftFlow(unreadable, { expected: { desc: "正文", tags: "#话题" }, coverRequested: false });
  assert.equal(unread.clicked, false);
  assert.equal(unread.reason, "unreadable");
  const thrown = scripted([readyFresh({ cover: { requested: false } })], async () => { throw new Error("click rejected"); });
  const boom = await executeSaveDraft({ ...yes, coverRequested: false }, thrown);
  assert.equal(boom.clicked, false);
  assert.equal(boom.reason, "click-failed");
});

test("the save control is only the exact 保存草稿 label", () => {
  assert.equal(saveDraftControl(["发表", "保存草稿"]).label, "保存草稿");
  assert.equal(saveDraftControl(["发表", "发布"]).ok, false);
  assert.equal(saveDraftControl([]).reason, "save-control-missing");
});

test("the page click only presses an exact 保存草稿 control", async () => {
  const { clickChannelsSaveDraft, readChannelsEditorState } = await import("../lib/run-save.mjs");
  const clicked = [];
  const button = (label) => ({
    innerText: label,
    click() { clicked.push(label); },
  });
  const root = {
    querySelector() { return null; },
    querySelectorAll() { return [button("发表"), button("保存草稿")]; },
    innerText: "",
  };
  const app = { shadowRoot: root };
  globalThis.document = {
    querySelector(selector) { return selector === "wujie-app" ? app : null; },
  };
  assert.equal(clickChannelsSaveDraft(), true);
  assert.deepEqual(clicked, ["保存草稿"]);
  const hidden = button("保存草稿");
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  hidden.click = () => clicked.push("hidden");
  const visible = button("保存草稿");
  visible.getBoundingClientRect = () => ({ width: 88, height: 32 });
  visible.click = () => clicked.push("visible");
  root.querySelectorAll = () => [hidden, button("发表"), visible];
  assert.equal(clickChannelsSaveDraft(), true);
  assert.deepEqual(clicked, ["保存草稿", "visible"]);
  root.querySelectorAll = () => [button("发表")];
  assert.equal(clickChannelsSaveDraft(), false);
  assert.deepEqual(clicked, ["保存草稿", "visible"]);
  globalThis.document = { querySelector() { return null; } };
  assert.equal(readChannelsEditorState().wujie, false);
});

test("the live reader uses the visible post surface, not stylesheet text", async () => {
  const { readChannelsEditorState } = await import("../lib/run-save.mjs");
  const attrs = {};
  const cover = {
    className: "vertical-img-size cover-img-vertical",
    alt: "",
    currentSrc: "https://example.test/custom-cover",
    getAttribute(name) { return name === "src" ? this.currentSrc : ""; },
    getBoundingClientRect() { return { width: 74, height: 98 }; },
  };
  const hint = {
    className: "cover",
    alt: "",
    currentSrc: "https://example.test/short-title-hint",
    getAttribute() { return this.currentSrc; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
  };
  const video = { getBoundingClientRect() { return { width: 184, height: 327 }; } };
  const wrap = {
    getAttribute(name) { return attrs[name] || ""; },
    setAttribute(name, value) { attrs[name] = value; },
  };
  const root = {
    innerText: "",
    textContent: "css width: 100%; .cover { background: url(hint) }",
    querySelector(sel) {
      if (sel === ".main-body") return { innerText: "转发 赞 评论 封面预览" };
      if (sel === ".input-editor") return { innerText: "CHANNELS-SAVE-TEST" };
      if (sel === ".cover-preview-wrap") return wrap;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "video") return [video];
      if (sel === "img") return [hint, cover];
      return [];
    },
  };
  globalThis.document = { querySelector(sel) { return sel === "wujie-app" ? { shadowRoot: root } : null; } };
  attrs["data-cover-baseline"] = "https://example.test/auto-frame";
  const changed = readChannelsEditorState();
  assert.equal(changed.upload.progress, 100);
  assert.equal(changed.upload.hasPreview, true);
  assert.equal(changed.cover.previewChanged, true);
  assert.equal(changed.description.text, "CHANNELS-SAVE-TEST");
  attrs["data-cover-baseline"] = cover.currentSrc;
  const same = readChannelsEditorState();
  assert.equal(same.cover.previewChanged, false);
  delete attrs["data-cover-baseline"];
  cover.currentSrc = "";
  const hiddenOnly = readChannelsEditorState();
  assert.equal(hiddenOnly.cover.previewChanged, false);
  globalThis.document = { querySelector() { return null; } };
});

test("the command exit code follows the save result, not the browser process status", async () => {
  const { exitCodeFromSaveOutput } = await import("../lib/launch-save.mjs");
  const saved = "{\"ok\":true,\"clicked\":true,\"exitCode\":0}\n";
  assert.equal(exitCodeFromSaveOutput(saved, 1), 0);
  assert.equal(exitCodeFromSaveOutput("{\"exitCode\":1}\n", 0), 1);
  assert.equal(exitCodeFromSaveOutput("", 1), 1);
});

test("the save command reaches the click only through saveDraftFlow", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const entry = await read("../save-draft.mjs");
  const launch = await read("../lib/launch-save.mjs");
  const run = await read("../lib/run-save.mjs");
  const flow = await read("../lib/save-flow.mjs");
  assert.match(entry, /runSaveCli/);
  assert.match(launch, /executeChannelsSave/);
  assert.match(run, /executeSaveDraft/);
  assert.doesNotMatch(`${entry}\n${launch}\n${run}`, /发表/);
  const decision = flow.indexOf("maySaveDraft");
  const click = flow.indexOf("clickSaveDraft");
  assert.ok(decision > 0 && click > decision);
});
