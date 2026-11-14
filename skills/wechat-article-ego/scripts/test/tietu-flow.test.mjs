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
      return overrides.drafts || [];
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
    async clickSaveDraft() {
      calls.push("save");
      api.saves += 1;
      if (overrides.saveError) throw new Error(overrides.saveError);
    },
    async saveConfirmed() {
      calls.push("confirmed");
      if (overrides.confirmError) throw new Error(overrides.confirmError);
      return overrides.confirmed || { ok: true, appmsgid: "100001815", savedTime: "01:23" };
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
  assert.equal(happy.calls.includes("drafts"), false);
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
  assert.match(rejected.error, /readback/);
  assert.equal(badRead.saves, 0);
  assert.equal(rejected.action, "aborted");

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
    confirmed: { ok: false, appmsgid: "", savedTime: "" },
    readQueue: [readback(), readback()],
    drafts: [],
  });
  const uncertain = await executeTietu(config(), { browser: browserWith(unsure), receipts: memoryReceipts() });
  assert.equal(uncertain.exitCode, 4);
  assert.equal(uncertain.action, "uncertain");
  assert.equal(unsure.saves, 1);
  assert.equal(unsure.calls.filter((call) => call === "save").length, 1);

  const many = session({
    confirmed: { ok: true, appmsgid: "", savedTime: "" },
    readQueue: [readback(), { ...readback(), appmsgid: "" }],
    drafts: [{ title: built.title, id: "1" }, { title: built.title, id: "2" }],
  });
  const ambiguous = await executeTietu(config(), { browser: browserWith(many), receipts: memoryReceipts() });
  assert.equal(ambiguous.error, "ambiguous-draft");
  assert.equal(many.saves, 1);

  const listed = session({
    confirmed: { ok: false, appmsgid: "", savedTime: "" },
    confirmError: "",
    readQueue: [readback(), { ...readback(), appmsgid: "", savedTime: "" }],
    drafts: [{ title: built.title, id: "100001815", time: "02:02" }],
    reopened: { ...readback(), appmsgid: "100001815", type: 77, savedTime: "" },
    captureViews: undefined,
  });
  delete listed.captureViews;
  const fromList = await executeTietu(config({ screenshotDir: "/absolute/path/shots" }), {
    browser: browserWith(listed),
    receipts: memoryReceipts(),
    now: () => "2026-11-14T00:00:00.000Z",
  });
  assert.equal(fromList.saved, true);
  assert.equal(fromList.appmsgid, "100001815");
  assert.equal(fromList.savedTime, "02:02");
  assert.deepEqual(fromList.screenshots, []);
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
  assert.match(noRead.error, /read failed/);
  assert.equal(unread.saves, 0);

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
    confirmed: { ok: true, appmsgid: "", savedTime: "" },
    readQueue: [readback(), readback()],
    listError: "list down",
  });
  const afterSave = await executeTietu(config(), { browser: browserWith(listedDown), receipts: memoryReceipts() });
  assert.equal(afterSave.exitCode, 4);
  assert.equal(listedDown.saves, 1);
});
