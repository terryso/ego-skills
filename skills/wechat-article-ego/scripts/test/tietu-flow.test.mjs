import assert from "node:assert/strict";
import test from "node:test";
import { executeTietu } from "../lib/tietu-flow.mjs";
import { buildTietu } from "../lib/tietu.mjs";

function post() {
  const built = buildTietu({
    title: "编程 agent 的尽头是修车",
    text: "贴图说明\nhttps://example.com/tietu",
    topics: ["编程Agent", "ClaudeCode"],
    images: [
      { name: "cover.jpg", path: "/absolute/path/cover.jpg", bytes: 4, sha256: "abc" },
      { name: "more.jpg", path: "/absolute/path/more.jpg", bytes: 5, sha256: "def" },
    ],
  });
  assert.equal(built.ok, true);
  return built;
}

function memoryReceipts(initial = null) {
  const saved = [];
  return {
    saved,
    read() { return initial && initial.current ? initial.current : null; },
    write(_dir, receipt) {
      saved.push(receipt);
      if (initial) initial.current = receipt;
    },
  };
}

function browserWith(session) {
  return {
    async open() {
      if (session.openError) throw new Error(session.openError);
      return session;
    },
  };
}

function readback(extra = {}) {
  const article = post();
  return {
    title: article.title,
    text: `${article.text}\n#编程Agent`,
    topics: article.topics,
    imageCount: article.imageCount,
    appmsgid: "",
    type: null,
    savedTime: "",
    ...extra,
  };
}

function session(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    uploads: [],
    saves: 0,
    openError: overrides.openError || "",
    async probe() {
      calls.push("probe");
      return overrides.probe || { loggedIn: true, loginWall: false, accounts: ["听懂 AI"], ambiguous: false };
    },
    async listDrafts() {
      calls.push("drafts");
      if (overrides.listError) throw new Error(overrides.listError);
      if (Object.prototype.hasOwnProperty.call(overrides, "drafts")) return overrides.drafts || [];
      return [{ title: "编程 agent 的尽头是修车", id: "100001815", time: "01:23", itemShowType: 8 }];
    },
    async openEditor() { calls.push("editor"); if (overrides.editorError) throw new Error(overrides.editorError); },
    async uploadImages(files) {
      calls.push("upload");
      api.uploads.push(...files);
      if (overrides.uploadError) throw new Error(overrides.uploadError);
    },
    async fillTitle() { calls.push("title"); },
    async fillBody(steps) { calls.push("body"); api.steps = steps; },
    async readEditor() {
      calls.push("read");
      if (overrides.readError) throw new Error(overrides.readError);
      const queue = overrides.readQueue;
      if (queue && queue.length) return queue.shift();
      return overrides.read || readback();
    },
    async waitForAutosave() {
      calls.push("autosave");
      if (overrides.autosaveError) throw new Error(overrides.autosaveError);
      return overrides.autosave || {
        ok: true,
        appmsgid: "100001815",
        toastText: "01:23已保存",
        imageFields: { cdnNonEmpty: true, shareNonEmpty: true, nonEmpty: true },
      };
    },
    async clickSaveDraft() {
      calls.push("save");
      api.saves += 1;
      if (overrides.saveError) throw new Error(overrides.saveError);
    },
    async confirmSave() {
      calls.push("confirm");
      if (overrides.confirmError) throw new Error(overrides.confirmError);
      const given = overrides.confirmed || {
        ok: true,
        appmsgid: "100001815",
        savedTime: "01:23",
        toastText: "01:23 已保存",
        url: "https://mp.weixin.qq.com/cgi-bin/appmsg?type=77&appmsgid=100001815&token=redacted",
        saveResponse: { ret: 0, appMsgId: "100001815" },
        screenshot: "/absolute/path/tietu-save-confirm.png",
      };
      return {
        ok: Boolean(given.appmsgid),
        toastText: "",
        url: "",
        saveResponse: null,
        screenshot: "",
        saved: false,
        ...given,
      };
    },
    async reopen(id) {
      calls.push(`reopen:${id}`);
      if (overrides.reopenError) throw new Error(overrides.reopenError);
      return overrides.reopened || {
        ...readback(),
        topics: ["#编程Agent", "ClaudeCode"],
        appmsgid: "100001815",
        type: 77,
        savedTime: "01:23",
      };
    },
    async captureViews() {
      calls.push("shots");
      if (overrides.shotError) throw new Error(overrides.shotError);
      return ["/absolute/path/tietu-top.png"];
    },
    async finish() { calls.push("finish"); if (overrides.finishError) throw new Error("finish failed"); },
  };
  return api;
}

const config = (extra = {}) => ({
  yes: true,
  expectAccount: "听懂 AI",
  receiptDir: "/absolute/path/receipts",
  screenshotDir: "",
  post: post(),
  ...extra,
});

test("tietu dry-run plans one type 77 draft and does not open the editor", async () => {
  const dry = session();
  const preview = await executeTietu(config({ yes: false }), {
    browser: browserWith(dry),
    receipts: memoryReceipts(),
  });
  assert.equal(preview.exitCode, 3);
  assert.equal(preview.confirmation_required, true);
  assert.equal(preview.plan.save, false);
  assert.equal(preview.plan.type, 77);
  assert.equal(preview.plan.externalUrlsClickable, false);
  assert.match(preview.plan.fidelity.join(" "), /not clickable/);
  assert.equal(preview.plan.images[0].path, undefined);
  assert.equal(dry.calls.includes("editor"), false);
  assert.equal(dry.calls.includes("save"), false);
  assert.equal(dry.calls.includes("upload"), false);
  assert.equal(dry.calls.at(-1), "finish");
});

test("account gates stop before a 贴图 write", async () => {
  const out = await executeTietu(config(), {
    browser: browserWith(session({ probe: { loggedIn: false, loginWall: true, accounts: [] } })),
    receipts: memoryReceipts(),
  });
  assert.equal(out.exitCode, 2);
  assert.equal(out.login_required, true);
  assert.equal(out.plan.title, "编程 agent 的尽头是修车");

  const many = await executeTietu(config(), {
    browser: browserWith(session({ probe: { loggedIn: true, accounts: ["甲", "乙"], ambiguous: true } })),
    receipts: memoryReceipts(),
  });
  assert.equal(many.exitCode, 4);
  assert.equal(many.reason, "ambiguous-account");

  const mismatch = await executeTietu(config({ expectAccount: "别的号" }), {
    browser: browserWith(session()),
    receipts: memoryReceipts(),
  });
  assert.equal(mismatch.exitCode, 2);
  assert.equal(mismatch.reason, "account-mismatch");

  const unnamed = await executeTietu(config({ expectAccount: "" }), {
    browser: browserWith(session({ probe: { loggedIn: true, accounts: [] } })),
    receipts: memoryReceipts(),
  });
  assert.equal(unnamed.reason, "unidentified-account");

  const missing = await executeTietu(config({ post: null }), {
    browser: browserWith(session()),
    receipts: memoryReceipts(),
  });
  assert.match(missing.error, /not prepared/);
});

test("an existing or reconciled 贴图 is not saved again", async () => {
  const built = post();
  const dup = session();
  const again = await executeTietu(config(), {
    browser: browserWith(dup),
    receipts: memoryReceipts({ current: { hash: built.hash, status: "saved", draftId: "100001815", draftTime: "01:23" } }),
  });
  assert.equal(again.duplicate, true);
  assert.equal(again.appmsgid, "100001815");
  assert.equal(again.savedTime, "01:23");
  assert.equal(dup.calls.includes("editor"), false);

  const found = session({ drafts: [{ title: built.title, id: "8", time: "今天 01:00" }] });
  const kept = await executeTietu(config(), {
    browser: browserWith(found),
    receipts: memoryReceipts({ current: { hash: built.hash, status: "uncertain" } }),
  });
  assert.equal(kept.action, "reconciled");
  assert.equal(kept.draftId, "8");
  assert.equal(found.calls.includes("save"), false);

  const doubled = session({ drafts: [{ title: built.title, id: "1" }, { title: built.title, id: "2" }] });
  const ambiguous = await executeTietu(config(), {
    browser: browserWith(doubled),
    receipts: memoryReceipts({ current: { hash: built.hash, status: "pending" } }),
  });
  assert.equal(ambiguous.action, "ambiguous-draft");
  assert.equal(doubled.saves, 0);

  const blocked = session({ listError: "list down" });
  const stalled = await executeTietu(config(), {
    browser: browserWith(blocked),
    receipts: memoryReceipts({ current: { hash: built.hash, status: "uncertain" } }),
  });
  assert.equal(stalled.exitCode, 4);
  assert.match(stalled.error, /cannot list/);
  assert.equal(blocked.calls.includes("editor"), false);
});

test("a confirmed 贴图 is saved once and reopened", async () => {
  const happy = session();
  const store = memoryReceipts();
  const saved = await executeTietu(config({ screenshotDir: "/absolute/path/shots" }), {
    browser: browserWith(happy),
    receipts: store,
    now: () => "2026-11-14T00:00:00.000Z",
  });
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.saved, true);
  assert.equal(saved.appmsgid, "100001815");
  assert.equal(saved.type, 77);
  assert.equal(saved.title, "编程 agent 的尽头是修车");
  assert.match(saved.text, /https:\/\/example\.com\/tietu/);
  assert.deepEqual(saved.topics, ["#编程Agent", "ClaudeCode"]);
  assert.equal(saved.imageCount, 2);
  assert.equal(saved.savedTime, "01:23");
  assert.equal(saved.externalUrlsClickable, false);
  assert.equal(happy.saves, 1);
  assert.deepEqual(happy.uploads, ["/absolute/path/cover.jpg", "/absolute/path/more.jpg"]);
  assert.equal(happy.steps.some((step) => step.value === "https://example.com/tietu"), true);
  assert.ok(happy.calls.indexOf("body") < happy.calls.indexOf("autosave"));
  assert.ok(happy.calls.indexOf("autosave") < happy.calls.indexOf("save"));
  assert.ok(happy.calls.indexOf("save") < happy.calls.indexOf("confirm"));
  assert.ok(happy.calls.indexOf("confirm") < happy.calls.indexOf("reopen:100001815"));
  assert.ok(happy.calls.indexOf("reopen:100001815") < happy.calls.indexOf("drafts"));
  assert.equal(saved.saveResponse.appMsgId, "100001815");
  assert.equal(saved.toastText, "01:23 已保存");
  assert.match(saved.url, /token=redacted/);
  assert.equal(store.saved.find((row) => row.saveConfirm && row.status === "pending").saveConfirm.appmsgid, "100001815");
  assert.equal(saved.screenshots.length, 1);
  assert.equal(store.saved.at(-1).status, "saved");
  assert.equal(happy.calls.at(-1), "finish");

  const noisy = session({ finishError: true });
  const still = await executeTietu(config({ yes: false }), {
    browser: browserWith(noisy),
    receipts: memoryReceipts(),
  });
  assert.equal(still.exitCode, 3);
});

test("save clicks 保存为草稿 once and does not retry an ambiguous result", async () => {
  const built = post();
  const badRead = session({ read: { ...readback(), text: "缺了", topics: [] } });
  const rejected = await executeTietu(config(), { browser: browserWith(badRead), receipts: memoryReceipts() });
  assert.equal(rejected.saved, true);
  assert.equal(badRead.saves, 1);
  assert.equal(rejected.action, "saved");
  assert.ok(badRead.calls.indexOf("confirm") < badRead.calls.indexOf("drafts"));

  const autosaved = session({
    uploadError: "thumbnail missing",
    read: { ...readback(), appmsgid: "100001800" },
  });
  const early = await executeTietu(config(), { browser: browserWith(autosaved), receipts: memoryReceipts() });
  assert.equal(early.exitCode, 4);
  assert.equal(early.action, "uncertain");
  assert.equal(early.appmsgid, "100001800");
  assert.equal(autosaved.saves, 0);

  const broken = session({ saveError: "保存为草稿 not found" });
  const noButton = await executeTietu(config(), { browser: browserWith(broken), receipts: memoryReceipts() });
  assert.match(noButton.error, /保存为草稿/);
  assert.equal(broken.saves, 1);

  const unsure = session({
    confirmed: {
      ok: false,
      appmsgid: "",
      savedTime: "",
      toastText: "01:23 已保存",
      url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=redacted",
      saveResponse: { ret: 0, appMsgId: "" },
      screenshot: "/absolute/path/tietu-save-confirm.png",
    },
    drafts: [],
  });
  const uncertain = await executeTietu(config(), { browser: browserWith(unsure), receipts: memoryReceipts() });
  assert.equal(uncertain.exitCode, 4);
  assert.equal(uncertain.error, "save not confirmed");
  assert.equal(uncertain.action, "save-not-confirmed");
  assert.equal(uncertain.toastText, "01:23 已保存");
  assert.equal(uncertain.screenshot, "/absolute/path/tietu-save-confirm.png");
  assert.equal(unsure.saves, 1);
  assert.equal(unsure.calls.includes("drafts"), false);
  assert.equal(unsure.calls.includes("reopen:100001815"), false);

  const many = session({
    confirmed: { ok: true, appmsgid: "", savedTime: "" },
    drafts: [{ title: built.title, id: "1" }, { title: built.title, id: "2" }],
  });
  const ambiguous = await executeTietu(config(), { browser: browserWith(many), receipts: memoryReceipts() });
  assert.equal(ambiguous.error, "save not confirmed");
  assert.equal(many.saves, 1);
  assert.equal(many.calls.includes("drafts"), false);

  const listed = session({
    confirmed: { ok: true, appmsgid: "100001815", savedTime: "02:02", toastText: "02:02 已保存" },
    drafts: [],
    reopened: { ...readback(), appmsgid: "100001815", type: 77, savedTime: "" },
  });
  const fromList = await executeTietu(config(), {
    browser: browserWith(listed),
    receipts: memoryReceipts(),
    now: () => "2026-11-14T00:00:00.000Z",
  });
  assert.equal(fromList.saved, false);
  assert.equal(fromList.error, "draft list did not include the saved 贴图");
  assert.equal(fromList.appmsgid, "100001815");
  assert.equal(listed.saves, 1);

  const lost = session({
    confirmed: { ok: true, appmsgid: "100001815", savedTime: "01:23" },
    reopenError: "贴图 draft editor did not open",
  });
  const unverified = await executeTietu(config(), { browser: browserWith(lost), receipts: memoryReceipts() });
  assert.equal(unverified.exitCode, 4);
  assert.equal(lost.saves, 1);
  assert.match(unverified.error, /did not open/);

  const drifted = session({
    reopened: { ...readback(), title: "别的题", appmsgid: "100001815", type: 77, topics: ["#编程Agent", "ClaudeCode"] },
  });
  const mismatch = await executeTietu(config(), { browser: browserWith(drifted), receipts: memoryReceipts() });
  assert.equal(mismatch.exitCode, 4);
  assert.match(mismatch.error, /reopen did not match/);
  assert.equal(drifted.saves, 1);

  const wrongType = session({
    reopened: { ...readback(), appmsgid: "999", type: 10, topics: ["#编程Agent", "ClaudeCode"] },
  });
  const typed = await executeTietu(config(), { browser: browserWith(wrongType), receipts: memoryReceipts() });
  assert.equal(typed.exitCode, 4);
  assert.equal(wrongType.saves, 1);
});

test("a missing save request is only a warning when readback passes", async () => {
  const quiet = session({
    confirmed: {
      ok: true,
      appmsgid: "100001903",
      savedTime: "15:47",
      toastText: "15:47已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveResponse: null,
      saveRequest: { missing: true, nonEmpty: false },
    },
    autosave: {
      ok: true,
      appmsgid: "100001903",
      imageFields: null,
    },
    drafts: [{ title: "编程 agent 的尽头是修车", id: "100001903", itemShowType: 8 }],
    reopened: {
      ...readback(),
      appmsgid: "100001903",
      type: 77,
      imageCount: 2,
      savedTime: "15:47",
    },
  });
  const saved = await executeTietu(config(), { browser: browserWith(quiet), receipts: memoryReceipts() });
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.saved, true);
  assert.equal(saved.action, "saved");
  assert.equal(saved.appmsgid, "100001903");
  assert.equal(saved.autosaveId, "100001903");
  assert.match(saved.warning, /save request was not observed/);
  assert.equal(saved.listCheck.itemShowType, 8);
  assert.equal(quiet.saves, 1);
});

test("the 贴图 list matches appmsgid, not a same title", async () => {
  const titled = session({
    confirmed: {
      ok: true,
      appmsgid: "100001920",
      savedTime: "15:47",
      toastText: "15:47已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { missing: true, nonEmpty: false },
    },
    autosave: { ok: true, appmsgid: "100001920", imageFields: null },
    drafts: [
      { title: "【验收】贴图技能测试", id: "100001800" },
      { title: "编程 agent 的尽头是修车", id: "100001801" },
    ],
    reopened: { ...readback(), appmsgid: "100001920", type: 77, imageCount: 2, savedTime: "15:47" },
  });
  const missed = await executeTietu(config(), { browser: browserWith(titled), receipts: memoryReceipts() });
  assert.equal(missed.exitCode, 4);
  assert.equal(missed.error, "draft list did not include the saved 贴图");
  assert.equal(missed.appmsgid, "100001920");
  assert.equal(titled.saves, 1);

  const byId = session({
    confirmed: {
      ok: true,
      appmsgid: "100001920",
      savedTime: "15:47",
      toastText: "15:47已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { missing: true, nonEmpty: false },
    },
    autosave: { ok: true, appmsgid: "100001920", imageFields: null },
    drafts: [{ title: "另一题", id: "100001920", itemShowType: 8 }],
    reopened: { ...readback(), appmsgid: "100001920", type: 77, imageCount: 2, savedTime: "15:47" },
  });
  const saved = await executeTietu(config(), { browser: browserWith(byId), receipts: memoryReceipts() });
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.saved, true);
  assert.equal(saved.listCheck.found, true);
  assert.equal(saved.listCheck.itemShowType, 8);
  assert.match(saved.warning, /save request was not observed/);
});

test("a title match counts only when the 贴图 list grew by one", async () => {
  const rows = [
    { title: "旧一", id: "" },
    { title: "旧二", id: "" },
    { title: "旧三", id: "" },
    { title: "旧四", id: "" },
    { title: "旧五", id: "" },
    { title: "编程 agent 的尽头是修车", id: "" },
  ];
  const grown = session({
    confirmed: {
      ok: true,
      appmsgid: "100001937",
      savedTime: "16:06",
      toastText: "16:06已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { missing: false, nonEmpty: true, cdnNonEmpty: true, shareNonEmpty: true, via: "autosave" },
    },
    autosave: { ok: true, appmsgid: "100001937", imageFields: { nonEmpty: true, cdnNonEmpty: true, shareNonEmpty: true } },
    drafts: rows,
    reopened: { ...readback(), appmsgid: "100001937", type: 77, imageCount: 2, savedTime: "16:06" },
  });
  grown.countDrafts = async () => ({ count: 5 });
  const saved = await executeTietu(config(), { browser: browserWith(grown), receipts: memoryReceipts() });
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.saved, true);
  assert.equal(saved.listCheck.found, true);
  assert.equal(saved.listCheck.weaker, true);
  assert.equal(saved.listCheck.match, "title-and-count");
  assert.equal(saved.listCheck.preSaveCount, 5);
  assert.equal(saved.saveConfirm.saveRequest.via, "autosave");
  assert.equal(saved.warning, "");

  const sameSize = session({
    confirmed: {
      ok: true,
      appmsgid: "100001937",
      savedTime: "16:06",
      toastText: "16:06已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { missing: false, nonEmpty: true, via: "autosave" },
    },
    autosave: { ok: true, appmsgid: "100001937", imageFields: { nonEmpty: true } },
    drafts: rows,
    reopened: { ...readback(), appmsgid: "100001937", type: 77, imageCount: 2, savedTime: "16:06" },
  });
  sameSize.countDrafts = async () => ({ count: 6 });
  const missed = await executeTietu(config(), { browser: browserWith(sameSize), receipts: memoryReceipts() });
  assert.equal(missed.exitCode, 4);
  assert.equal(missed.error, "draft list did not include the saved 贴图");
  assert.equal(missed.listCheck.weaker, false);
});

test("an empty save request is not treated as a 贴图 save", async () => {
  const wiped = session({
    confirmed: {
      ok: true,
      appmsgid: "100001815",
      savedTime: "01:23",
      toastText: "01:23已保存",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { missing: false, cdnNonEmpty: false, shareNonEmpty: false, nonEmpty: false },
    },
  });
  const failed = await executeTietu(config(), { browser: browserWith(wiped), receipts: memoryReceipts() });
  assert.equal(failed.exitCode, 1);
  assert.match(failed.error, /cdn_url0 and share_imageinfo0 were empty/);
  assert.equal(failed.autosaveId, "100001815");
  assert.equal(wiped.saves, 1);
  assert.equal(wiped.calls.includes("reopen:100001815"), false);
});

test("a manual save that changes the autosave id reports both", async () => {
  const moved = session({
    autosave: { ok: true, appmsgid: "100001875", imageFields: { cdnNonEmpty: true, shareNonEmpty: true, nonEmpty: true } },
    confirmed: {
      ok: true,
      appmsgid: "100001880",
      screenshot: "/absolute/path/tietu-save-confirm.png",
      screenshotError: "",
      saveRequest: { nonEmpty: true, cdnNonEmpty: true, shareNonEmpty: true },
    },
  });
  const failed = await executeTietu(config(), { browser: browserWith(moved), receipts: memoryReceipts() });
  assert.equal(failed.exitCode, 4);
  assert.match(failed.error, /autosave 100001875, save 100001880/);
  assert.equal(moved.saves, 1);
});

test("a placeholder uploader does not click save", async () => {
  const blocked = session();
  blocked.assertContentImages = async () => {
    const error = new Error("贴图 image is not on the CDN yet (0/1); not saving");
    error.uploadDebug = { cdnImageCount: 0, expected: 1 };
    throw error;
  };
  const skipped = await executeTietu(config(), { browser: browserWith(blocked), receipts: memoryReceipts() });
  assert.equal(skipped.exitCode, 1);
  assert.equal(skipped.action, "aborted");
  assert.match(skipped.error, /not saving/);
  assert.equal(blocked.saves, 0);
  assert.equal(blocked.calls.includes("confirm"), false);
});

test("a missing confirm screenshot is returned instead of success", async () => {
  const blind = session({
    confirmed: {
      ok: true,
      appmsgid: "100001858",
      savedTime: "01:23",
      toastText: "01:23 已保存",
      url: "https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=100001858&token=redacted",
      saveResponse: { ret: 0, appMsgId: "100001858" },
      screenshot: "",
      screenshotError: "screenshot timed out",
    },
  });
  const failed = await executeTietu(config(), { browser: browserWith(blind), receipts: memoryReceipts() });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.saved, false);
  assert.equal(failed.screenshotError, "screenshot timed out");
  assert.match(failed.error, /screenshot timed out/);
  assert.equal(failed.appmsgid, "100001858");
  assert.equal(blind.saves, 1);
  assert.equal(blind.calls.includes("reopen:100001858"), false);
});

test("an article-tab draft is not reported as a 贴图", async () => {
  const filed = session({
    confirmed: { ok: true, appmsgid: "100001815", savedTime: "01:23", screenshot: "/absolute/path/tietu-save-confirm.png", screenshotError: "" },
    drafts: [],
  });
  filed.listArticleDrafts = async () => [{ title: "编程 agent 的尽头是修车", id: "100001815", itemShowType: 0 }];
  const wrong = await executeTietu(config(), { browser: browserWith(filed), receipts: memoryReceipts() });
  assert.equal(wrong.exitCode, 4);
  assert.equal(wrong.error, "draft was saved as an article, not a 贴图");
  assert.equal(wrong.action, "wrong-type");
  assert.equal(filed.saves, 1);
});

test("a missed upload keeps the debug paths and does not save", async () => {
  const missed = session();
  missed.uploadImages = async () => {
    const error = new Error("image upload was not detected within 30000ms; fileInputs=2 accept=[\"\",\"image/jpeg\"] chosen=2; screenshot=/absolute/path/tietu-upload-failed.png; uploaderHtml=/absolute/path/tietu-upload-failed.html");
    error.uploadDebug = {
      screenshot: "/absolute/path/tietu-upload-failed.png",
      uploaderHtml: "/absolute/path/tietu-upload-failed.html",
      fileInputs: [{ index: 1, accept: "" }, { index: 2, accept: "image/jpeg" }],
      chosenIndex: 2,
      chosenAccept: "image/jpeg",
    };
    throw error;
  };
  const store = memoryReceipts();
  const failed = await executeTietu(config(), { browser: browserWith(missed), receipts: store });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.action, "aborted");
  assert.equal(failed.saved, false);
  assert.match(failed.error, /tietu-upload-failed\.png/);
  assert.match(failed.error, /tietu-upload-failed\.html/);
  assert.equal(failed.screenshot, "/absolute/path/tietu-upload-failed.png");
  assert.equal(failed.uploaderHtml, "/absolute/path/tietu-upload-failed.html");
  assert.equal(failed.uploadDebug.chosenAccept, "image/jpeg");
  assert.equal(failed.uploadDebug.fileInputs.length, 2);
  assert.equal(store.saved.at(-1).status, "aborted");
  assert.equal(store.saved.at(-1).uploadDebug.fileInputs[1].accept, "image/jpeg");
  assert.equal(missed.saves, 0);
});

test("editor, receipt, and browser failures stay unsaved", async () => {
  const store = memoryReceipts();
  store.write = () => { throw new Error("disk full"); };
  const unwritten = await executeTietu(config(), { browser: browserWith(session()), receipts: store });
  assert.match(unwritten.error, /receipt/);

  const crashed = await executeTietu(config(), {
    browser: browserWith(session({ openError: "space failed" })),
    receipts: memoryReceipts(),
  });
  assert.match(crashed.error, /space failed/);

  const unread = session({ readError: "read failed" });
  const noRead = await executeTietu(config(), { browser: browserWith(unread), receipts: memoryReceipts() });
  assert.equal(noRead.saved, true);
  assert.equal(unread.saves, 1);

  const warned = session({ shotError: "shot failed" });
  const partial = await executeTietu(config({ screenshotDir: "/absolute/path/shots" }), {
    browser: browserWith(warned),
    receipts: memoryReceipts(),
  });
  assert.equal(partial.saved, true);
  assert.match(partial.warning, /shot failed/);

  let finished = 0;
  const wrapped = await executeTietu(config({ post: null }), {
    browser: {
      async open() {
        return {
          page: {
            async evaluate(_fn, arg) {
              if (arg && arg.op === "probe") return { loggedIn: false, loginWall: true, accounts: [] };
              return { ok: true };
            },
          },
          async finish() { finished += 1; },
        };
      },
    },
    receipts: memoryReceipts(),
  });
  assert.equal(wrapped.exitCode, 2);
  assert.equal(finished, 1);

  let closed = 0;
  const bare = await executeTietu(config(), {
    browser: {
      async open() {
        return { page: null, async finish() { closed += 1; } };
      },
    },
    receipts: memoryReceipts(),
  });
  assert.match(bare.error, /requires a page/);
  assert.equal(closed, 1);

  const listedDown = session({
    confirmed: { ok: true, appmsgid: "100001815", savedTime: "01:23" },
    listError: "list down",
  });
  const afterSave = await executeTietu(config(), { browser: browserWith(listedDown), receipts: memoryReceipts() });
  assert.equal(afterSave.saved, true);
  assert.match(afterSave.warning, /list down/);
  assert.equal(listedDown.saves, 1);
});
