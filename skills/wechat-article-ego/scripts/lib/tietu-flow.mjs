// One 贴图 draft. Login and account checks happen before any editor write.
// --yes is the only path that clicks 保存为草稿, and it clicks that control once.
import { createReceiptStore } from "./prepare.mjs";
import {
  decideAccount,
  decideSave,
  howToLogin,
  normalizeText,
} from "./pure.mjs";
import {
  planOfTietu,
  tietuLoginTip,
  validateTietuReadback,
} from "./tietu.mjs";
import { createTietuSession } from "./tietu-session.mjs";

function base(extra = {}) {
  return { ok: false, command: "save-draft", kind: "tietu", saved: false, type: 77, ...extra };
}

function accountFailure(decision, post) {
  const copy = decision.loginRequired ? howToLogin() : {};
  return base({
    exitCode: decision.exitCode,
    login_required: Boolean(decision.loginRequired),
    account: decision.account || "",
    accounts: decision.accounts || [],
    reason: decision.reason,
    error: decision.reason,
    plan: post && post.hash ? planOfTietu(post, "") : undefined,
    ...copy,
  });
}

function isTietuSession(session) {
  return Boolean(session
    && typeof session.fillBody === "function"
    && typeof session.clickSaveDraft === "function"
    && typeof session.uploadImages === "function");
}

function draftRef(match) {
  if (!match) return { draftId: "", draftTime: "" };
  return { draftId: match.id || match.appmsgid || "", draftTime: match.time || match.savedTime || "" };
}

export async function executeTietu(config, deps) {
  const store = deps.receipts || createReceiptStore(deps.fs);
  const now = deps.now || (() => new Date().toISOString());
  let opened = null;
  let session = null;
  const post = config && config.post;
  try {
    opened = await deps.browser.open({
      taskName: "wechat-article-ego",
      startUrl: "https://mp.weixin.qq.com/",
    });
    session = isTietuSession(opened) ? opened : createTietuSession({
      page: opened.page,
      task: { finish: (options) => opened.finish(options) },
    });
    const probe = await session.probe();
    const account = decideAccount(probe, (config && config.expectAccount) || "");
    if (!account.ok) return accountFailure(account, post);
    const tip = tietuLoginTip(account.account);
    if (!post || !post.hash) {
      return base({ exitCode: 1, error: "贴图 was not prepared", account: account.account });
    }
    const receipt = store.read(config.receiptDir, post.hash);
    let decision = decideSave({
      yes: Boolean(config.yes),
      receipt,
      draftsListed: false,
      hash: post.hash,
      title: post.title,
    });
    if (decision.action === "reconcile-first") {
      let drafts = [];
      try {
        drafts = await session.listDrafts();
      } catch (error) {
        return base({
          exitCode: 4,
          action: "uncertain",
          error: `cannot list 贴图 drafts: ${error.message}`,
          account: account.account,
          plan: planOfTietu(post, account.account),
        });
      }
      decision = decideSave({
        yes: true,
        receipt,
        drafts,
        draftsListed: true,
        hash: post.hash,
        title: post.title,
      });
    }
    const plan = planOfTietu(post, account.account);
    if (!decision.save) {
      const ref = draftRef(decision.match || (decision.receipt && {
        id: decision.receipt.draftId,
        time: decision.receipt.draftTime,
      }));
      return {
        ok: decision.exitCode === 0 || decision.action === "dry-run",
        exitCode: decision.exitCode,
        command: "save-draft",
        kind: "tietu",
        type: 77,
        action: decision.action,
        saved: false,
        duplicate: decision.action === "already-saved" || decision.action === "reconciled",
        account: account.account,
        accounts: account.accounts,
        plan,
        appmsgid: ref.draftId,
        draftId: ref.draftId,
        draftTime: ref.draftTime,
        savedTime: ref.draftTime,
        title: post.title,
        text: post.text,
        topics: post.topics,
        imageCount: post.imageCount,
        confirmation_required: decision.action === "dry-run",
        externalUrlsClickable: false,
        ...tip,
        ...(decision.action === "ambiguous-draft" ? { error: "ambiguous-draft", matches: decision.matches } : {}),
      };
    }
    const pending = {
      version: 1,
      kind: "tietu",
      type: 77,
      hash: post.hash,
      title: post.title,
      account: account.account,
      status: "pending",
      startedAt: now(),
      imageCount: post.imageCount,
    };
    try {
      store.write(config.receiptDir, pending);
    } catch (error) {
      return base({
        exitCode: 1,
        error: `cannot write receipt: ${error.message}`,
        account: account.account,
        plan,
      });
    }
    const mark = async (status, extra = {}) => {
      store.write(config.receiptDir, { ...pending, status, ...extra });
    };
    const beforeClick = async (error) => {
      let appmsgid = "";
      try {
        const state = await session.readEditor();
        appmsgid = (state && state.appmsgid) || "";
      } catch {
        appmsgid = "";
      }
      const uncertain = Boolean(appmsgid);
      const debug = error && error.uploadDebug;
      await mark(uncertain ? "uncertain" : "aborted", {
        error: String(error.message || error),
        draftId: appmsgid,
        ...(debug ? { uploadDebug: debug } : {}),
      });
      return base({
        exitCode: uncertain ? 4 : 1,
        action: uncertain ? "uncertain" : "aborted",
        error: String(error.message || error),
        account: account.account,
        plan,
        appmsgid,
        draftId: appmsgid,
        ...(debug ? {
          uploadDebug: debug,
          screenshot: debug.screenshot || "",
          uploaderHtml: debug.uploaderHtml || "",
        } : {}),
      });
    };
    try {
      await session.openEditor();
      await session.uploadImages(post.images.map((image) => image.path), {
        receiptDir: config.receiptDir,
        screenshotDir: config.screenshotDir,
        fs: deps.fs,
      });
      await session.fillTitle(post.title);
      await session.fillBody(post.steps);
    } catch (error) {
      return beforeClick(error);
    }
    // Stay on the editor until 保存为草稿 has had time to persist. listDrafts() and
    // reopen() are the only navigations, and both happen after this wait.
    const watch = typeof session.beginSaveWatch === "function" ? session.beginSaveWatch() : null;
    try {
      await session.clickSaveDraft();
    } catch (error) {
      if (watch && typeof watch.stop === "function") watch.stop();
      await mark("aborted", { error: String(error.message || error) });
      return base({ exitCode: 1, error: String(error.message || error), account: account.account, plan });
    }
    let confirmed = { ok: false, appmsgid: "", savedTime: "", url: "", toastText: "", saveResponse: null, screenshot: "" };
    try {
      confirmed = typeof session.confirmSave === "function"
        ? await session.confirmSave({
          watch,
          receiptDir: config.receiptDir,
          screenshotDir: config.screenshotDir,
          fs: deps.fs,
        })
        : await session.saveConfirmed();
    } catch (error) {
      confirmed = {
        ok: false,
        appmsgid: "",
        savedTime: "",
        url: "",
        toastText: "",
        saveResponse: null,
        screenshot: "",
        error: String(error.message || error),
      };
    } finally {
      if (watch && typeof watch.stop === "function") watch.stop();
    }
    const saveConfirm = {
      url: confirmed.url || "",
      toastText: confirmed.toastText || "",
      savedTime: confirmed.savedTime || "",
      appmsgid: confirmed.appmsgid || "",
      saveResponse: confirmed.saveResponse || null,
      screenshot: confirmed.screenshot || "",
    };
    await mark("pending", { saveClicked: true, saveConfirm });
    const appmsgid = saveConfirm.appmsgid;
    let savedTime = saveConfirm.savedTime;
    if (!appmsgid) {
      await mark("uncertain", {
        saveClicked: true,
        finishedAt: now(),
        error: "save not confirmed",
        saveConfirm,
      });
      return base({
        exitCode: 4,
        action: "save-not-confirmed",
        error: "save not confirmed",
        account: account.account,
        plan,
        url: saveConfirm.url,
        toastText: saveConfirm.toastText,
        saveResponse: saveConfirm.saveResponse,
        screenshot: saveConfirm.screenshot,
        saveConfirm,
      });
    }
    let reopened;
    try {
      reopened = await session.reopen(appmsgid);
    } catch (error) {
      await mark("uncertain", {
        saveClicked: true,
        confirmed: Boolean(confirmed.ok),
        draftId: appmsgid,
        finishedAt: now(),
        error: String(error.message || error),
      });
      return base({
        exitCode: 4,
        error: String(error.message || error),
        account: account.account,
        plan,
        action: "uncertain",
        appmsgid,
        draftId: appmsgid,
        confirmed: Boolean(confirmed.ok),
      });
    }
    const again = validateTietuReadback(post, reopened);
    const typeOk = Number(reopened && reopened.type) === 77;
    const idOk = String((reopened && reopened.appmsgid) || appmsgid || "") === String(appmsgid);
    if (!again.ok || !typeOk || !idOk || !appmsgid) {
      await mark("uncertain", {
        saveClicked: true,
        confirmed: Boolean(confirmed.ok),
        draftId: appmsgid,
        finishedAt: now(),
        error: "reopen did not match the 贴图 draft",
      });
      return base({
        exitCode: 4,
        error: "reopen did not match the 贴图 draft",
        account: account.account,
        plan,
        action: "uncertain",
        appmsgid,
        draftId: appmsgid,
        title: reopened && reopened.title,
        text: reopened && reopened.text,
        topics: reopened && reopened.topics,
        imageCount: reopened && reopened.imageCount,
        readback: again,
        confirmed: Boolean(confirmed.ok),
      });
    }
    let listCheck = { ok: false, count: 0, found: false, error: "" };
    try {
      const rows = await session.listDrafts();
      const want = normalizeText(post.title);
      const found = (rows || []).some((row) => row && (
        String(row.id || "") === String(appmsgid) || normalizeText(row.title) === want
      ));
      listCheck = {
        ok: true,
        count: (rows || []).length,
        found,
        titles: (rows || []).map((row) => row && row.title).filter(Boolean).slice(0, 10),
      };
    } catch (error) {
      listCheck = { ok: false, count: 0, found: false, error: String(error.message || error) };
    }
    if (listCheck.ok && !listCheck.found) {
      await mark("uncertain", {
        saveClicked: true,
        confirmed: Boolean(confirmed.ok),
        draftId: appmsgid,
        finishedAt: now(),
        error: "draft list did not include the saved 贴图",
        saveConfirm,
        listCheck,
      });
      return base({
        exitCode: 4,
        error: "draft list did not include the saved 贴图",
        account: account.account,
        plan,
        action: "uncertain",
        appmsgid,
        draftId: appmsgid,
        title: reopened && reopened.title,
        text: reopened && reopened.text,
        topics: reopened && reopened.topics,
        imageCount: reopened && reopened.imageCount,
        readback: again,
        saveConfirm,
        listCheck,
        confirmed: Boolean(confirmed.ok),
      });
    }
    const clock = (reopened && reopened.savedTime) || savedTime || now();
    const saved = {
      ...pending,
      status: "saved",
      savedAt: now(),
      draftId: appmsgid,
      appmsgid,
      draftTime: clock,
      savedTime: clock,
      confirmed: Boolean(confirmed.ok),
      saveConfirm,
      listCheck,
    };
    store.write(config.receiptDir, saved);
    const shots = [];
    let warning = "";
    if (config.screenshotDir) {
      try {
        if (typeof session.captureViews === "function") {
          shots.push(...await session.captureViews(config.screenshotDir, "tietu"));
        }
      } catch (error) {
        warning = String(error.message || error);
      }
    }
    return {
      ok: true,
      exitCode: 0,
      command: "save-draft",
      kind: "tietu",
      action: "saved",
      saved: true,
      account: account.account,
      appmsgid,
      draftId: appmsgid,
      type: 77,
      title: reopened.title,
      text: reopened.text,
      topics: reopened.topics,
      imageCount: reopened.imageCount,
      savedTime: clock,
      savedAt: saved.savedAt,
      hash: post.hash,
      fidelity: post.fidelity,
      externalUrlsClickable: false,
      urls: post.urls,
      confirmed: Boolean(confirmed.ok),
      readback: again,
      saveConfirm,
      listCheck,
      url: saveConfirm.url,
      toastText: saveConfirm.toastText,
      saveResponse: saveConfirm.saveResponse,
      screenshots: shots,
      warning: [warning, listCheck.error].filter(Boolean).join("; "),
      ...tip,
    };
  } catch (error) {
    return base({ exitCode: 1, error: String(error.message || error) });
  } finally {
    const closer = session || opened;
    if (closer && typeof closer.finish === "function") {
      try {
        await closer.finish();
      } catch {
        // The result above is the source of truth; closing must not replace it.
      }
    }
  }
}
