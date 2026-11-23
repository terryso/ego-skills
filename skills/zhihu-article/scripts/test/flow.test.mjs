import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCheck, executeCleanup, executeSave } from "../lib/flow.mjs";
import { createReceiptStore } from "../lib/prepare.mjs";

function article(extra = {}) {
  return {
    title: "示例标题",
    hash: "hash-1",
    imageCount: 0,
    images: [],
    cover: null,
    snippets: ["一段说明"],
    headings: [{ level: 2, text: "小节" }],
    listItems: ["第一点"],
    links: [{ href: "https://example.com/docs", text: "链接" }],
    segments: [{ kind: "html", html: "<p>一段说明</p>", text: "一段说明" }],
    fidelity: [],
    ...extra,
  };
}

function home(extra = {}) {
  return {
    ok: true,
    loginWall: false,
    loggedIn: true,
    accounts: ["示例作者"],
    ambiguous: false,
    ...extra,
  };
}

function editor(extra = {}) {
  return {
    ...home(),
    surface: "article",
    editorReady: true,
    bodyAmbiguous: false,
    blank: true,
    explicitDraftLabel: "",
    imageInput: true,
    imageAmbiguous: false,
    coverInput: true,
    coverAmbiguous: false,
    autosaveLabel: "",
    draftId: "",
    draftAmbiguous: false,
    published: false,
    ...extra,
  };
}

function readback(extra = {}) {
  return {
    ok: true,
    loginWall: false,
    loggedIn: true,
    title: "示例标题",
    text: "一段说明 小节 第一点 链接",
    headings: [{ level: 2, text: "小节" }],
    listItems: ["第一点"],
    hrefs: ["https://example.com/docs"],
    imageCount: 0,
    coverApplied: false,
    draftId: "123",
    autosaveLabel: "已保存",
    published: false,
    draftAmbiguous: false,
    ...extra,
  };
}

function sessionWith(steps) {
  const calls = { goto: [], finish: 0, click: 0, upload: 0, cover: 0, paste: 0, capture: 0 };
  let probes = [...steps.probes];
  const session = {
    calls,
    async goto(url) {
      calls.goto.push(url);
      if (steps.onGoto) await steps.onGoto(url);
    },
    async probe() {
      const next = probes.shift();
      if (!next) throw new Error("unexpected probe");
      return next;
    },
    async fillTitle() {
      if (steps.fillTitle) return steps.fillTitle();
      return { ok: true, draftId: "", autosaveLabel: "" };
    },
    async pasteBody() {
      calls.paste += 1;
      return steps.paste ? steps.paste() : { ok: true };
    },
    async replaceBody() {
      calls.replace = (calls.replace || 0) + 1;
      return steps.replace ? steps.replace() : { ok: true, replaced: true };
    },
    async clearPendingUpload() {
      calls.clear = (calls.clear || 0) + 1;
      return steps.clear ? steps.clear() : { ok: true, cleared: 1 };
    },
    async removeDuplicateLead() {
      calls.dedupe = (calls.dedupe || 0) + 1;
      return { ok: true, removed: 0 };
    },
    async uploadBodyImage() {
      calls.upload += 1;
      return steps.upload ? steps.upload() : { ok: true, submitted: true, imageCount: 1 };
    },
    async uploadCover() {
      calls.cover += 1;
      return steps.cover ? steps.cover() : { ok: true, submitted: true, coverApplied: true };
    },
    async clickDraftSave() {
      calls.click += 1;
      return steps.click ? steps.click() : { ok: true, clicked: true, label: "保存草稿" };
    },
    async waitForSavedDraft() {
      return steps.settled || { ok: true, draftId: "123", autosaveLabel: "已保存", published: false, draftAmbiguous: false };
    },
    async readEditor() {
      return steps.read ? steps.read() : readback();
    },
    async capture() {
      calls.capture += 1;
      return "/tmp/zhihu-article-unverified.png";
    },
    async finish() { calls.finish += 1; },
  };
  return session;
}

function browserFor(session, spaces = []) {
  const opened = [];
  return {
    opened,
    async open(options) {
      opened.push(options);
      return session;
    },
    async listSpaces() { return spaces; },
    async finishSpace(space) { spaces.closed = spaces.closed || []; spaces.closed.push(space.name); },
  };
}

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhihu-flow-"));
  return { receiptDir: path.join(root, "receipts"), screenshotDir: path.join(root, "shots") };
}

test("check-login stays on the home page and fails closed", async () => {
  const session = sessionWith({ probes: [home()] });
  const browser = browserFor(session);
  const ok = await executeCheck({ expectAccount: "示例作者" }, { browser });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.state, "not-started");
  assert.equal(ok.publishPermitted, false);
  assert.equal(session.calls.goto.length, 0);
  assert.equal(session.calls.finish, 1);
  assert.equal(browser.opened[0].startUrl, "https://www.zhihu.com/");

  const mismatch = sessionWith({ probes: [home({ accounts: ["另一账号"] })] });
  const denied = await executeCheck({ expectAccount: "示例作者" }, { browser: browserFor(mismatch) });
  assert.equal(denied.exitCode, 2);
  assert.equal(denied.reason, "account-mismatch");
  assert.equal(denied.login_required, true);

  const unnamed = await executeCheck({}, { browser: browserFor(sessionWith({ probes: [home({ loggedIn: true, accounts: [] })] })) });
  assert.equal(unnamed.reason, "identity-not-visible");
  assert.equal(unnamed.identityVisible, false);
  assert.equal(unnamed.exitCode, 4);

  const many = await executeCheck({}, { browser: browserFor(sessionWith({ probes: [home({ accounts: ["示例作者", "另一账号"], ambiguous: true })] })) });
  assert.equal(many.reason, "ambiguous-account");

  const broken = await executeCheck({}, { browser: { async open() { throw new Error("open failed"); } } });
  assert.equal(broken.exitCode, 1);
  assert.match(broken.error, /open failed/);
});

test("save consent verifies one reopened draft and does not click publish", async () => {
  const { receiptDir, screenshotDir } = dirs();
  const session = sessionWith({ probes: [home(), editor(), home()] });
  const browser = browserFor(session);
  const summary = await executeSave({
    saveDraft: true,
    expectAccount: "示例作者",
    receiptDir,
    screenshotDir,
    article: article(),
  }, { browser, now: () => "2026-01-01T00:00:00.000Z" });
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.state, "draft-saved");
  assert.equal(summary.verified, true);
  assert.equal(summary.mutation, "autosave-verified");
  assert.equal(summary.draftId, "123");
  assert.equal(summary.draftUrl, "https://zhuanlan.zhihu.com/p/123/edit");
  assert.equal(summary.publishPermitted, false);
  assert.equal(summary.consent, "save-draft");
  assert.deepEqual(session.calls.goto, [
    "https://zhuanlan.zhihu.com/write",
    "https://zhuanlan.zhihu.com/p/123/edit",
  ]);
  assert.equal(session.calls.click, 0);
  assert.equal(session.calls.capture, 0);
  const stored = createReceiptStore().read(receiptDir, "hash-1");
  assert.equal(stored.state, "draft-saved");
  assert.equal(stored.verified, true);
  assert.equal(stored.publishPermitted, false);
  assert.equal(JSON.stringify(stored).includes("/absolute/"), false);
});

test("explicit save, autosave ambiguity, upload timeout, and login expiry stay distinct", async () => {
  const explicit = sessionWith({
    probes: [home(), editor({ explicitDraftLabel: "保存草稿" }), home()],
  });
  const explicitResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(explicit) });
  assert.equal(explicitResult.mutation, "explicit-save");
  assert.equal(explicitResult.state, "draft-saved");
  assert.equal(explicit.calls.click, 1);

  const ambiguous = sessionWith({
    probes: [home(), editor({ explicitDraftLabel: "保存草稿" }), home()],
    click: () => ({ ok: false, clicked: false, error: "explicit draft control not found" }),
  });
  const ambiguousResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(ambiguous) });
  assert.equal(ambiguousResult.state, "unverified");
  assert.equal(ambiguousResult.error, "autosave-without-explicit-save");
  assert.equal(ambiguousResult.verified, false);
  assert.equal(ambiguousResult.retryable, false);

  const clickOnly = sessionWith({
    probes: [home(), editor({ explicitDraftLabel: "保存草稿" }), home()],
    settled: { ok: true, draftId: "", autosaveLabel: "", published: false, draftAmbiguous: false, timedOut: true },
  });
  const clickResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    screenshotDir: dirs().screenshotDir,
    article: article(),
  }, { browser: browserFor(clickOnly) });
  assert.equal(clickResult.state, "unverified");
  assert.notEqual(clickResult.state, "draft-saved");
  assert.equal(clickResult.mutation, "explicit-save");
  assert.equal(clickOnly.calls.capture, 1);

  const uploaded = sessionWith({
    probes: [home(), editor(), home()],
    upload: () => ({ ok: false, submitted: true, code: "upload-timeout" }),
  });
  const uploadResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article({
      imageCount: 1,
      images: [{ name: "image.png", sha256: "abc", bytes: 10 }],
      segments: [{ kind: "image", path: "/absolute/path/to/image.png", alt: "配图" }],
      snippets: ["配图"],
      headings: [],
      listItems: [],
      links: [],
    }),
  }, { browser: browserFor(uploaded) });
  assert.equal(uploadResult.state, "uploaded");
  assert.equal(uploadResult.retryable, false);
  assert.equal(uploaded.calls.click, 0);
  assert.equal(uploaded.calls.upload, 1);

  const expired = sessionWith({
    probes: [home(), editor(), { ok: true, loginWall: true, loggedIn: false, accounts: [] }],
  });
  const expiredResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(expired) });
  assert.equal(expiredResult.exitCode, 2);
  assert.equal(expiredResult.error, "login-expired");
  assert.equal(expiredResult.login_required, true);
  assert.equal(expired.calls.capture, 0);
  assert.equal(expired.calls.click, 0);
});

test("preconditions and previous mutations do not type into the editor", async () => {
  const cases = [
    [editor({ surface: "answer", editorReady: false }), "unsupported-surface", 1],
    [editor({ blank: false }), "editor-not-blank", 4],
    [editor({ published: true, blank: false }), "published-url", 4],
    [editor({ draftAmbiguous: true }), "draft-id-ambiguous", 4],
    [editor({ imageInput: false }), "image-control-missing", 1],
    [editor({ coverInput: false }), "cover-control-missing", 1],
  ];
  for (const [probe, error, code] of cases) {
    const session = sessionWith({ probes: [home(), probe] });
    const item = article(error === "image-control-missing"
      ? { imageCount: 1, segments: [{ kind: "image", path: "/absolute/path/to/image.png" }] }
      : error === "cover-control-missing"
        ? { cover: { name: "cover.png", sha256: "c", bytes: 10, path: "/absolute/path/to/cover.png" } }
        : {});
    const summary = await executeSave({
      saveDraft: true,
      receiptDir: dirs().receiptDir,
      article: item,
    }, { browser: browserFor(session) });
    assert.equal(summary.error, error, error);
    assert.equal(summary.exitCode, code, error);
    assert.equal(session.calls.paste, 0, error);
    assert.equal(session.calls.goto.length, 1, error);
  }

  const loggedOut = sessionWith({ probes: [home({ loginWall: true, loggedIn: false, accounts: [] })] });
  const login = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(loggedOut) });
  assert.equal(login.exitCode, 2);
  assert.equal(loggedOut.calls.goto.length, 0);

  const expired = sessionWith({ probes: [home(), editor({ loginWall: true, loggedIn: false, accounts: [] })] });
  const mid = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(expired) });
  assert.equal(mid.error, "login-expired");
  assert.equal(mid.state, "not-started");

  const dir = dirs().receiptDir;
  createReceiptStore().write(dir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "",
    account: "示例作者",
  });
  const blockedSession = sessionWith({ probes: [] });
  const blocked = await executeSave({
    saveDraft: true,
    receiptDir: dir,
    article: article(),
  }, { browser: browserFor(blockedSession) });
  assert.equal(blocked.exitCode, 4);
  assert.equal(blocked.error, "previous-mutation");
  assert.equal(blockedSession.calls.goto.length, 0);

  createReceiptStore().write(dir, {
    hash: "hash-1",
    state: "draft-saved",
    verified: true,
    draftId: "55",
    account: "示例作者",
  });
  const duplicate = await executeSave({
    saveDraft: true,
    receiptDir: dir,
    article: article(),
  }, { browser: browserFor(sessionWith({ probes: [] })) });
  assert.equal(duplicate.exitCode, 0);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, "draft-saved");

  const preview = await executeSave({ saveDraft: false, article: article() }, { browser: browserFor(sessionWith({ probes: [] })) });
  assert.equal(preview.exitCode, 3);
  assert.equal(preview.state, "not-started");
  assert.equal(preview.confirmation_required, true);
  assert.equal(preview.publishPermitted, false);
});

test("a changed draft id, publish url, cover miss, and thrown editor stay unverified", async () => {
  const changed = sessionWith({
    probes: [home(), editor({ draftId: "10", blank: true }), home()],
    settled: { ok: true, draftId: "11", autosaveLabel: "已保存", published: false, draftAmbiguous: false },
  });
  const changedResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(changed) });
  assert.equal(changedResult.state, "unverified");
  assert.equal(changedResult.error, "draft-id-changed");
  assert.equal(changed.calls.goto.includes("https://zhuanlan.zhihu.com/p/11/edit"), false);

  const published = sessionWith({
    probes: [home(), editor(), home()],
    settled: { ok: true, draftId: "", autosaveLabel: "", published: true, draftAmbiguous: false },
  });
  const publishedResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(published) });
  assert.equal(publishedResult.error, "published-url");
  assert.equal(publishedResult.state, "unverified");

  const cover = sessionWith({
    probes: [home(), editor(), home()],
    cover: () => ({ ok: false, submitted: true, code: "upload-timeout", coverApplied: false }),
  });
  const coverResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article({ cover: { name: "cover.png", path: "/absolute/path/to/cover.png", sha256: "c", bytes: 20 } }),
  }, { browser: browserFor(cover) });
  assert.equal(coverResult.state, "uploaded");
  assert.equal(cover.calls.cover, 1);
  assert.equal(cover.calls.click, 0);

  const boom = sessionWith({
    probes: [home(), editor(), home()],
    paste: () => { throw new Error("paste exploded"); },
  });
  const thrown = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(boom) });
  assert.equal(thrown.state, "unverified");
  assert.match(thrown.error, /paste exploded/);
  assert.equal(thrown.retryable, false);

  const mismatch = sessionWith({
    probes: [home(), editor(), home()],
    read: () => readback({ title: "另一标题", text: "不匹配", headings: [], listItems: [], hrefs: [] }),
  });
  const read = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(mismatch) });
  assert.equal(read.state, "unverified");
  assert.equal(read.error, "readback-mismatch");
  assert.equal(read.verified, false);

  const forbidden = sessionWith({
    probes: [home(), editor({ explicitDraftLabel: "保存草稿" }), home()],
    click: () => ({ ok: false, forbidden: true, clicked: false, error: "publish-refused" }),
  });
  const refused = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(forbidden) });
  assert.equal(refused.error, "publish-refused");
  assert.equal(refused.state, "unverified");

  const missing = await executeSave({ saveDraft: true }, { browser: browserFor(sessionWith({ probes: [] })) });
  assert.match(missing.error, /not prepared/);

  const noReceipt = sessionWith({ probes: [home(), editor()] });
  const unwritable = await executeSave({
    saveDraft: true,
    receiptDir: path.join(dirs().receiptDir, "blocked"),
    article: article(),
  }, {
    browser: browserFor(noReceipt),
    receipts: { read() { return null; }, write() { throw new Error("disk full"); } },
  });
  assert.match(unwritable.error, /cannot write receipt/);
  assert.equal(noReceipt.calls.paste, 0);
});

test("reopening a draft that expired, changed, or published stays unverified", async () => {
  const expired = sessionWith({
    probes: [home(), editor(), home()],
    read: () => ({ ok: false, loginWall: true, loggedIn: false, error: "login wall" }),
  });
  const expiredResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(expired) });
  assert.equal(expiredResult.exitCode, 2);
  assert.equal(expiredResult.error, "login-expired");
  assert.equal(expiredResult.state, "unverified");
  assert.equal(expired.calls.click, 0);

  const published = sessionWith({
    probes: [home(), editor(), home()],
    read: () => readback({ published: true, draftId: "" }),
  });
  const publishedResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(published) });
  assert.equal(publishedResult.error, "published-url");
  assert.equal(publishedResult.verified, false);

  const changed = sessionWith({
    probes: [home(), editor(), home()],
    read: () => readback({ draftId: "999" }),
  });
  const changedResult = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(changed) });
  assert.equal(changedResult.error, "draft-id-changed");
  assert.equal(changedResult.retryable, false);

  const crashed = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: { async open() { throw new Error("browser down"); } } });
  assert.equal(crashed.state, "failed");
  assert.match(crashed.error, /browser down/);
  assert.equal(crashed.retryable, true);

  let writes = 0;
  const flaky = sessionWith({ probes: [home(), editor(), home()] });
  const partial = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, {
    browser: browserFor(flaky),
    receipts: {
      read() { return null; },
      write() {
        writes += 1;
        if (writes >= 3) throw new Error("disk full");
      },
    },
  });
  assert.equal(partial.state, "draft-saved");
  assert.match(partial.receiptError, /disk full/);
});

test("a visible write editor is not reported as login-expired", async () => {
  const write = editor({
    ok: true,
    loginWall: false,
    loggedIn: true,
    editorReady: true,
    editorVisible: true,
    accounts: ["BMAD实验室"],
    identityVisible: true,
    url: "https://zhuanlan.zhihu.com/write",
    pageTitle: "写文章 - 知乎",
  });
  let probes = 0;
  const session = sessionWith({
    probes: [home(), {
      ok: true,
      loginWall: false,
      loggedIn: false,
      editorReady: false,
      editorVisible: false,
      accounts: [],
      url: "https://zhuanlan.zhihu.com/write",
      pageTitle: "写文章 - 知乎",
    }, write, home()],
  });
  session.pause = async () => { probes += 1; };
  const summary = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(session) });
  assert.equal(summary.state, "draft-saved");
  assert.equal(summary.error || "", "");
  assert.equal(probes, 1);
  assert.equal(session.calls.goto[0], "https://zhuanlan.zhihu.com/write");

  const failed = sessionWith({
    probes: [home(), {
      ok: false,
      evaluateFailed: true,
      loginWall: false,
      loggedIn: false,
      url: "https://zhuanlan.zhihu.com/write",
      pageTitle: "写文章 - 知乎",
      error: "evaluate exploded",
    }],
  });
  const probeFailure = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(failed) });
  assert.equal(probeFailure.reason || probeFailure.error, "probe-failed");
  assert.notEqual(probeFailure.error, "login-expired");
  assert.equal(probeFailure.exitCode, 1);
  assert.equal(probeFailure.pageUrl, "https://zhuanlan.zhihu.com/write");
  assert.equal(probeFailure.pageTitle, "写文章 - 知乎");
  assert.equal(failed.calls.capture, 1);

  const wall = sessionWith({
    probes: [home(), {
      ok: true,
      loginWall: true,
      surface: "signin",
      loggedIn: false,
      url: "https://www.zhihu.com/signin",
      pageTitle: "登录 - 知乎",
    }],
  });
  const expired = await executeSave({
    saveDraft: true,
    receiptDir: dirs().receiptDir,
    article: article(),
  }, { browser: browserFor(wall) });
  assert.equal(expired.error, "login-expired");
  assert.equal(expired.exitCode, 2);
  assert.equal(expired.pageUrl, "https://www.zhihu.com/signin");
  assert.equal(wall.calls.capture, 1);
});

test("an ambiguous body image input records the page and does not publish", async () => {
  const session = sessionWith({
    probes: [home({ accounts: ["BMAD实验室"] }), {
      ok: true,
      loginWall: false,
      loggedIn: true,
      surface: "article",
      editorReady: true,
      blank: true,
      imageInput: false,
      imageAmbiguous: true,
      coverInput: true,
      coverAmbiguous: false,
      accounts: ["BMAD实验室"],
      identityVisible: true,
      url: "https://zhuanlan.zhihu.com/write",
      pageTitle: "写文章 - 知乎",
    }],
  });
  const summary = await executeSave({
    saveDraft: true,
    expectAccount: "BMAD实验室",
    receiptDir: dirs().receiptDir,
    screenshotDir: dirs().screenshotDir,
    article: article({
      imageCount: 1,
      images: [{ name: "body.png", sha256: "abc", bytes: 10 }],
      segments: [{ kind: "image", path: "/absolute/path/to/body.png", alt: "配图" }],
      snippets: ["配图"],
      headings: [],
      listItems: [],
      links: [],
    }),
  }, { browser: browserFor(session) });
  assert.equal(summary.error, "image-control-ambiguous");
  assert.equal(summary.exitCode, 1);
  assert.equal(summary.state, "not-started");
  assert.equal(summary.mutation, "none");
  assert.equal(summary.saved, false);
  assert.equal(summary.pageUrl, "https://zhuanlan.zhihu.com/write");
  assert.equal(summary.pageTitle, "写文章 - 知乎");
  assert.equal(session.calls.capture, 1);
  assert.equal(session.calls.paste, 0);
  assert.equal(session.calls.upload, 0);
  assert.equal(session.calls.click, 0);

  const early = editor({
    imageInput: false,
    imageAmbiguous: true,
    url: "https://zhuanlan.zhihu.com/write",
    pageTitle: "写文章 - 知乎",
    accounts: ["BMAD实验室"],
    identityVisible: true,
  });
  const ready = editor({
    url: "https://zhuanlan.zhihu.com/write",
    pageTitle: "写文章 - 知乎",
    accounts: ["BMAD实验室"],
    identityVisible: true,
  });
  let pauses = 0;
  const settling = sessionWith({
    probes: [home({ accounts: ["BMAD实验室"] }), early, ready],
    upload: () => ({ ok: false, submitted: false, code: "upload-api-missing", error: "stop" }),
  });
  settling.pause = async () => { pauses += 1; };
  const settled = await executeSave({
    saveDraft: true,
    expectAccount: "BMAD实验室",
    receiptDir: dirs().receiptDir,
    article: article({
      imageCount: 1,
      images: [{ name: "body.png", sha256: "abc", bytes: 10 }],
      segments: [{ kind: "image", path: "/absolute/path/to/body.png", alt: "配图" }],
      snippets: ["配图"],
      headings: [],
      listItems: [],
      links: [],
    }),
  }, { browser: browserFor(settling) });
  assert.equal(pauses, 1);
  assert.equal(settling.calls.upload, 1);
  assert.notEqual(settled.error, "image-control-ambiguous");

  const still = editor({
    imageInput: false,
    imageAmbiguous: true,
    url: "https://zhuanlan.zhihu.com/write",
    pageTitle: "写文章 - 知乎",
    accounts: ["BMAD实验室"],
    identityVisible: true,
  });
  let extraPauses = 0;
  const stuck = sessionWith({
    probes: [
      home({ accounts: ["BMAD实验室"] }),
      still,
      { ...still },
      { ...still },
      { ...still },
    ],
  });
  stuck.pause = async () => { extraPauses += 1; };
  const closed = await executeSave({
    saveDraft: true,
    expectAccount: "BMAD实验室",
    receiptDir: dirs().receiptDir,
    screenshotDir: dirs().screenshotDir,
    article: article({
      imageCount: 1,
      images: [{ name: "body.png", sha256: "abc", bytes: 10 }],
      segments: [{ kind: "image", path: "/absolute/path/to/body.png", alt: "配图" }],
      snippets: ["配图"],
      headings: [],
      listItems: [],
      links: [],
    }),
  }, { browser: browserFor(stuck) });
  assert.equal(extraPauses, 3);
  assert.equal(closed.error, "image-control-ambiguous");
  assert.equal(closed.mutation, "none");
  assert.equal(stuck.calls.upload, 0);
  assert.equal(stuck.calls.capture, 1);
});

test("an unverified receipt reopens its draft and does not open /write", async () => {
  const dir = dirs().receiptDir;
  createReceiptStore().write(dir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    draftUrl: "https://zhuanlan.zhihu.com/p/55/edit",
    account: "示例作者",
  });
  const session = sessionWith({
    probes: [home(), editor({
      draftId: "55",
      blank: false,
      title: "示例标题",
      text: "一段说明 小节 第一点",
      headings: [{ level: 2, text: "小节" }],
      autosaveLabel: "刚刚 · 草稿",
    })],
    settled: { ok: true, draftId: "55", autosaveLabel: "刚刚 · 草稿", published: false, draftAmbiguous: false },
    read: () => readback({ draftId: "55", autosaveLabel: "刚刚 · 草稿" }),
  });
  const summary = await executeSave({
    saveDraft: true,
    receiptDir: dir,
    article: article(),
  }, { browser: browserFor(session) });
  assert.equal(summary.action, "verify-draft");
  assert.equal(summary.state, "draft-saved");
  assert.equal(summary.verified, true);
  assert.deepEqual(session.calls.goto, [
    "https://zhuanlan.zhihu.com/p/55/edit",
    "https://zhuanlan.zhihu.com/p/55/edit",
  ]);
  assert.equal(session.calls.paste, 0);
  assert.equal(session.calls.replace || 0, 0);
  assert.equal(session.calls.upload, 0);

  const repairDir = dirs().receiptDir;
  createReceiptStore().write(repairDir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    account: "示例作者",
  });
  const repairArticle = article({
    title: "技能验收测试草稿（可删）",
    snippets: ["这是草稿", "排版检查", "这段包含", "列表", "正文配图"],
    headings: [{ level: 2, text: "排版检查" }, { level: 3, text: "列表" }, { level: 2, text: "正文配图" }],
    listItems: [],
    links: [],
    imageCount: 1,
    images: [{ name: "body.png", sha256: "abc", bytes: 10 }],
    segments: [
      { kind: "html", html: "<p>这是草稿</p>", text: "这是草稿" },
      { kind: "html", html: "<h2>排版检查</h2>", text: "排版检查" },
      { kind: "html", html: "<p>这段包含</p>", text: "这段包含" },
      { kind: "html", html: "<h3>列表</h3>", text: "列表" },
      { kind: "html", html: "<h2>正文配图</h2>", text: "正文配图" },
      { kind: "image", path: "/absolute/path/to/body.png", alt: "验收配图一" },
    ],
    cover: { name: "cover.png", path: "/absolute/path/to/cover.png", sha256: "c", bytes: 20 },
  });
  const repairing = sessionWith({
    probes: [home(), editor({
      draftId: "55",
      blank: false,
      title: "技能验收测试草稿（可删）",
      text: "这是草稿 排版检查这段包含 列表 正文配图",
      headings: [{ level: 3, text: "列表" }, { level: 2, text: "正文配图" }],
      coverApplied: false,
      imageCount: 2,
      imageInput: true,
      uploadPending: false,
      autosaveLabel: "刚刚 · 草稿",
      url: "https://zhuanlan.zhihu.com/p/55/edit",
      pageTitle: "写文章 - 知乎",
    })],
    settled: { ok: true, draftId: "55", autosaveLabel: "刚刚 · 草稿", published: false, draftAmbiguous: false },
    read: () => readback({
      draftId: "55",
      title: "技能验收测试草稿（可删）",
      text: "这是草稿 排版检查这段包含 列表 正文配图",
      headings: [{ level: 3, text: "列表" }, { level: 2, text: "正文配图" }],
      listItems: [],
      hrefs: [],
      imageCount: 1,
      coverApplied: true,
      autosaveLabel: "刚刚 · 草稿",
      url: "https://zhuanlan.zhihu.com/p/55/edit",
      pageTitle: "写文章 - 知乎",
    }),
  });
  const repaired = await executeSave({
    saveDraft: true,
    receiptDir: repairDir,
    screenshotDir: dirs().screenshotDir,
    article: repairArticle,
  }, { browser: browserFor(repairing) });
  assert.equal(repaired.error, "readback-mismatch");
  assert.equal(repaired.pageUrl, "https://zhuanlan.zhihu.com/p/55/edit");
  assert.equal(repaired.pageTitle, "写文章 - 知乎");
  assert.equal(repairing.calls.replace || 0, 0);
  assert.equal(repairing.calls.paste, 0);
  assert.equal(repairing.calls.upload, 0);
  assert.equal(repairing.calls.cover, 0);
  assert.equal(repairing.calls.goto.includes("https://zhuanlan.zhihu.com/write"), false);

  const pendingDir = dirs().receiptDir;
  createReceiptStore().write(pendingDir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    account: "示例作者",
  });
  const pendingEditor = editor({
    draftId: "55",
    blank: false,
    title: "示例标题",
    text: "一段说明 图片上传中",
    headings: [{ level: 2, text: "小节" }],
    uploadPending: true,
    url: "https://zhuanlan.zhihu.com/p/55/edit",
    pageTitle: "写文章 - 知乎",
  });
  const pending = sessionWith({
    probes: [home(), pendingEditor],
    settled: { ok: true, draftId: "55", autosaveLabel: "刚刚 · 草稿", published: false, draftAmbiguous: false },
    read: () => readback({
      draftId: "55",
      text: "一段说明 图片上传中 小节 第一点",
      uploadPending: true,
    }),
  });
  const stillPending = await executeSave({
    saveDraft: true,
    receiptDir: pendingDir,
    article: article(),
  }, { browser: browserFor(pending) });
  assert.equal(stillPending.error, "upload-pending");
  assert.equal(stillPending.pageUrl, "https://zhuanlan.zhihu.com/p/55/edit");
  assert.equal(stillPending.pageTitle, "写文章 - 知乎");
  assert.equal(stillPending.readback.uploadPending, true);
  assert.equal(pending.calls.clear || 0, 0);
  assert.equal(pending.calls.upload, 0);
  assert.equal(pending.calls.paste, 0);

  const coverDir = dirs().receiptDir;
  createReceiptStore().write(coverDir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    account: "示例作者",
  });
  const coverSession = sessionWith({
    probes: [home(), editor({
      draftId: "55",
      blank: false,
      title: "示例标题",
      text: "一段说明 小节 第一点",
      headings: [{ level: 2, text: "小节" }],
      coverApplied: false,
      url: "https://zhuanlan.zhihu.com/p/55/edit",
      pageTitle: "写文章 - 知乎",
    })],
    cover: () => ({ ok: false, submitted: true, code: "upload-timeout", coverApplied: false }),
    settled: { ok: true, draftId: "55", autosaveLabel: "刚刚 · 草稿", published: false, draftAmbiguous: false },
    read: () => readback({
      draftId: "55",
      coverApplied: false,
      imageCount: 0,
      text: "一段说明 一段说明 小节 第一点",
    }),
  });
  const coverTimeout = await executeSave({
    saveDraft: true,
    receiptDir: coverDir,
    screenshotDir: dirs().screenshotDir,
    article: article({ cover: { name: "cover.png", path: "/absolute/path/to/cover.png", sha256: "c", bytes: 20 } }),
  }, { browser: browserFor(coverSession) });
  assert.equal(coverTimeout.error, "duplicate-content");
  assert.equal(coverTimeout.mutation, "none");
  assert.equal(coverTimeout.pageUrl, "https://zhuanlan.zhihu.com/p/55/edit");
  assert.equal(coverTimeout.pageTitle, "写文章 - 知乎");
  assert.equal(coverTimeout.readback.titleOk, true);
  assert.equal(coverTimeout.readback.coverOk, false);
  assert.equal(coverTimeout.readback.duplicateLead, true);
  assert.equal(coverTimeout.observed.draftId, "55");
  assert.equal(coverSession.calls.paste, 0);
  assert.equal(coverSession.calls.upload, 0);
  assert.equal(coverSession.calls.cover, 0);

  const emptyDir = dirs().receiptDir;
  createReceiptStore().write(emptyDir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    account: "示例作者",
  });
  const empty = sessionWith({
    probes: [home(), editor({ draftId: "55", blank: true, title: "", text: "", autosaveLabel: "刚刚 · 草稿" })],
  });
  const untouched = await executeSave({
    saveDraft: true,
    receiptDir: emptyDir,
    article: article(),
  }, { browser: browserFor(empty) });
  assert.equal(untouched.error, "resume-empty");
  assert.equal(empty.calls.paste, 0);
  assert.equal(empty.calls.replace || 0, 0);
});

test("an exception during read-only verify keeps the page and does not claim mutation none", async () => {
  const dir = dirs().receiptDir;
  createReceiptStore().write(dir, {
    hash: "hash-1",
    state: "unverified",
    verified: false,
    draftId: "55",
    draftUrl: "https://zhuanlan.zhihu.com/p/55/edit",
    account: "示例作者",
  });
  const session = sessionWith({
    probes: [home(), editor({
      draftId: "55",
      blank: false,
      title: "示例标题",
      text: "一段说明 小节 第一点",
      headings: [{ level: 2, text: "小节" }],
      url: "https://zhuanlan.zhihu.com/p/55/edit",
      pageTitle: "写文章 - 知乎",
    })],
    settled: { ok: true, draftId: "55", autosaveLabel: "刚刚 · 草稿", published: false, draftAmbiguous: false },
    read: () => { throw new Error("childNodes.filter is not a function"); },
  });
  const thrown = await executeSave({
    saveDraft: true,
    receiptDir: dir,
    screenshotDir: dirs().screenshotDir,
    article: article(),
  }, { browser: browserFor(session) });
  assert.equal(thrown.exitCode, 4);
  assert.equal(thrown.state, "unverified");
  assert.equal(thrown.mutation, "unknown");
  assert.equal(thrown.action, "verify-draft");
  assert.equal(thrown.pageUrl, "https://zhuanlan.zhihu.com/p/55/edit");
  assert.equal(thrown.pageTitle, "写文章 - 知乎");
  assert.match(thrown.screenshot, /zhihu-article/);
  assert.match(thrown.error, /childNodes\.filter/);
  assert.equal(session.calls.paste, 0);
  assert.equal(session.calls.upload, 0);
  assert.equal(session.calls.cover, 0);
  assert.equal(session.calls.goto.includes("https://zhuanlan.zhihu.com/write"), false);
});

test("cleanup closes only this skill's task spaces", async () => {
  const spaces = [{ name: "zhihu-article", id: "a" }, { name: "zhihu-article-2" }, { name: "other" }];
  const browser = {
    async listSpaces() { return spaces; },
    async finishSpace(space) { space.done = true; },
  };
  const summary = await executeCleanup({}, { browser });
  assert.equal(summary.exitCode, 0);
  assert.deepEqual(summary.closed, ["a", "zhihu-article-2"]);
  assert.equal(spaces[2].done, undefined);
  const unavailable = await executeCleanup({}, { browser: { async listSpaces() { return null; } } });
  assert.match(unavailable.error, /unavailable/);
  const crashed = await executeCleanup({}, { browser: { async listSpaces() { throw new Error("list failed"); } } });
  assert.match(crashed.error, /list failed/);
});
