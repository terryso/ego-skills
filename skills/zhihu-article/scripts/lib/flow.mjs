// Login, one article draft, and cleanup. Public publishing is not a path.
import {
  HOME_URL,
  TASK_NAME,
  WRITE_URL,
  classifyAccess,
  classifyOutcome,
  coalescePastes,
  compactText,
  decideAccount,
  decideAttempt,
  draftEditUrl,
  howToLogin,
  loginTip,
  normalizeText,
  planOf,
  seal,
  validateReadback,
} from "./pure.mjs";
import { createReceiptStore } from "./prepare.mjs";

function result(command, fields) {
  return seal({
    command,
    account: "",
    accounts: [],
    draftId: "",
    draftUrl: "",
    error: "",
    consent: command === "save-draft" ? "save-draft" : "none",
    ...fields,
    publishPermitted: false,
  });
}

function accountFailure(command, decision, article) {
  const copy = decision.loginRequired ? howToLogin() : {};
  return result(command, {
    exitCode: decision.exitCode,
    state: "not-started",
    retryable: false,
    login_required: Boolean(decision.loginRequired),
    account: decision.account || "",
    accounts: decision.accounts || [],
    identityVisible: Boolean(decision.identityVisible),
    reason: decision.reason,
    error: decision.reason,
    plan: article ? planOf(article) : undefined,
    ...copy,
  });
}

function receiptBody(article, account, outcome, extra = {}) {
  return {
    version: 1,
    skill: "zhihu-article",
    hash: article.hash,
    title: article.title,
    account: account || "",
    state: outcome.state,
    verified: Boolean(outcome.verified),
    retryable: Boolean(outcome.retryable),
    mutation: outcome.mutation || "none",
    consent: "save-draft",
    publishPermitted: false,
    draftId: outcome.draftId || "",
    draftUrl: draftEditUrl(outcome.draftId),
    imageCount: article.imageCount,
    cover: !article.cover ? "not-requested" : (extra.coverApplied ? "applied" : "unverified"),
    error: outcome.error || "",
    phase: extra.phase || outcome.state,
    observed: extra.observed || null,
    readback: extra.readback || null,
    updatedAt: extra.updatedAt,
  };
}

async function compose(session, article, initial) {
  const progress = {
    accepted: false,
    mediaSubmitted: false,
    explicitControl: Boolean(initial.explicitDraftLabel),
    explicitClicked: false,
    forbidden: false,
    published: Boolean(initial.published),
    autosaveBadge: Boolean(initial.autosaveLabel),
    autosaveObserved: Boolean(initial.autosaveLabel || initial.draftId),
    readbackOk: false,
    coverRequired: Boolean(article.cover),
    coverApplied: false,
    timedOut: false,
    draftId: initial.draftId || "",
    preexistingId: initial.draftId || "",
    localFailure: false,
    loginExpired: false,
    error: "",
    observed: null,
    readback: null,
  };
  const title = await session.fillTitle(article.title);
  if (!title.ok) {
    progress.draftId = title.draftId || progress.draftId;
    progress.autosaveBadge = Boolean(title.autosaveLabel);
    progress.autosaveObserved = Boolean(title.autosaveLabel || title.draftId);
    progress.accepted = Boolean(title.draftId || title.autosaveLabel);
    progress.localFailure = !progress.accepted;
    progress.error = title.error || "title-mismatch";
    return progress;
  }
  progress.accepted = true;
  if (title.draftId) progress.draftId = title.draftId;
  if (title.autosaveLabel) {
    progress.autosaveBadge = true;
    progress.autosaveObserved = true;
  }
  if (typeof initial.onAccepted === "function") await initial.onAccepted(progress);

  if (!await fillBody(session, article, progress, { replace: false })) return progress;

  if (article.cover && article.cover.path) {
    const cover = await session.uploadCover(article.cover.path);
    if (cover.submitted) progress.mediaSubmitted = true;
    progress.coverApplied = Boolean(cover.coverApplied);
    if (!cover.ok) {
      progress.timedOut = cover.code === "upload-timeout";
      progress.error = cover.code || cover.error || "cover-unverified";
      return progress;
    }
  }

  const mid = await session.probe();
  const midAccess = classifyAccess(mid, { openedWrite: true });
  if (!midAccess.ok) {
    progress.loginExpired = midAccess.reason === "login-expired";
    progress.challenge = midAccess.reason === "challenge";
    progress.error = midAccess.reason;
    return progress;
  }

  if (progress.explicitControl) {
    const click = await session.clickDraftSave();
    if (click.forbidden) {
      progress.forbidden = true;
      progress.error = "publish-refused";
      return progress;
    }
    if (click.ok && click.clicked) progress.explicitClicked = true;
    else progress.explicitMiss = click.error || "explicit-save-failed";
  }

  const settled = await session.waitForSavedDraft();
  progress.published = Boolean(settled.published);
  progress.timedOut = Boolean(settled.timedOut) || progress.timedOut;
  if (settled.draftId) progress.draftId = settled.draftId;
  if (settled.autosaveLabel) {
    progress.autosaveBadge = true;
    progress.autosaveObserved = true;
  }
  if (settled.draftAmbiguous) {
    progress.error = progress.error || "draft-id-ambiguous";
    return progress;
  }
  if (progress.published) {
    progress.error = progress.error || "published-url";
    return progress;
  }
  if (!progress.draftId) {
    progress.error = progress.error || progress.explicitMiss || "";
    return progress;
  }
  if (progress.explicitMiss && !progress.explicitClicked) return progress;
  if (progress.preexistingId && progress.draftId !== progress.preexistingId) {
    progress.error = "draft-id-changed";
    return progress;
  }

  await session.goto(draftEditUrl(progress.draftId));
  const again = await session.readEditor();
  const againAccess = classifyAccess(again, { openedWrite: true });
  if (!againAccess.ok) {
    progress.loginExpired = againAccess.reason === "login-expired";
    progress.challenge = againAccess.reason === "challenge";
    progress.error = againAccess.reason;
    return progress;
  }
  if (again.published) {
    progress.published = true;
    progress.error = "published-url";
    return progress;
  }
  if (again.draftId && again.draftId !== progress.draftId) {
    progress.draftId = again.draftId;
    progress.error = "draft-id-changed";
    return progress;
  }
  if (again.autosaveLabel) progress.autosaveBadge = true;
  if (again.coverApplied) progress.coverApplied = true;
  const check = validateReadback(article, again);
  progress.readback = {
    titleOk: check.titleOk,
    imagesOk: check.imagesOk,
    coverOk: check.coverOk,
    missing: check.missing,
    missingHeadings: check.missingHeadings,
    missingItems: check.missingItems,
    missingHrefs: check.missingHrefs,
    rawMarkup: check.rawMarkup,
    duplicateLead: Boolean(check.duplicateLead),
    duplicateShape: Boolean(check.duplicateShape),
    uploadPending: Boolean(check.uploadPending),
  };
  progress.readbackOk = Boolean(check.ok && again.draftId === progress.draftId);
  if (!check.ok && !progress.error) progress.error = readbackError(check);
  progress.observed = {
    title: again.title || "",
    imageCount: again.imageCount,
    autosaveLabel: again.autosaveLabel || "",
    coverApplied: Boolean(again.coverApplied),
    draftId: again.draftId || progress.draftId,
    excerpt: normalizeText(again.text).slice(0, 80),
  };
  return progress;
}

function readbackError(check) {
  if (!check || check.ok) return "";
  if (check.duplicateLead || check.duplicateShape) return "duplicate-content";
  if (check.uploadPending) return "upload-pending";
  return "readback-mismatch";
}

async function fillBody(session, article, progress, { replace = false } = {}) {
  const groups = coalescePastes(article.segments || []);
  if (replace) {
    progress.error = "editor-replacement-unproven";
    return false;
  }
  let replacing = replace;
  for (const segment of groups) {
    if (segment.kind === "html") {
      const pasted = replacing
        ? await session.replaceBody(segment.html, segment.text)
        : await session.pasteBody(segment.html, segment.text);
      replacing = false;
      if (!pasted || !pasted.ok) {
        progress.error = (pasted && pasted.error) || (replace ? "body-replace-failed" : "paste-failed");
        return false;
      }
    } else if (segment.kind === "image") {
      const uploaded = await session.uploadBodyImage(segment.path);
      if (uploaded && uploaded.submitted) progress.mediaSubmitted = true;
      if (!uploaded || !uploaded.ok) {
        progress.timedOut = Boolean(uploaded && uploaded.code === "upload-timeout");
        progress.error = (uploaded && (uploaded.code || uploaded.error)) || "upload-failed";
        return false;
      }
    }
  }
  return true;
}

function articleLead(article) {
  const captions = new Set((article.segments || [])
    .filter((segment) => segment && segment.kind === "image")
    .map((segment) => normalizeText(segment.alt))
    .filter(Boolean));
  return (article.snippets || []).map(normalizeText).find((item) => item && !captions.has(item) && !(article.headings || []).some((heading) => normalizeText(heading.text) === item)) || "";
}

function editorLooksLikeArticle(article, editor) {
  if (!editor || normalizeText(editor.title) !== normalizeText(article.title)) return false;
  const lead = articleLead(article);
  if (lead && !compactText(editor.text).includes(compactText(lead))) return false;
  return true;
}

function exitFor(outcome, progress) {
  if (progress && (progress.loginExpired || progress.challenge)) return 2;
  if (outcome.state === "draft-saved") return 0;
  if (outcome.state === "uploaded" || outcome.state === "unverified") return 4;
  return 1;
}

function controlsReady(editor, article) {
  if (!article) return true;
  if (article.imageCount && (!editor || !editor.imageInput || editor.imageAmbiguous)) return false;
  if (article.cover && (!editor || !editor.coverInput || editor.coverAmbiguous)) return false;
  return true;
}

async function probeWrite(session, article) {
  const canWait = typeof session.pause === "function";
  const attempts = canWait ? 4 : 1;
  let last = null;
  for (let index = 0; index < attempts; index += 1) {
    last = await session.probe();
    const access = classifyAccess(last, { openedWrite: true });
    const terminal = Boolean(last && (last.loginWall || last.challenge || last.evaluateFailed || last.surface === "signin"));
    if (!access.ok || terminal) {
      if (terminal || !canWait || index + 1 === attempts) return last;
      await session.pause();
      continue;
    }
    if (!canWait || index + 1 === attempts || controlsReady(last, article)) return last;
    await session.pause();
  }
  return last;
}

async function captureEvidence(session, config, probe, reason) {
  const pageUrl = (probe && (probe.url || probe.pageUrl)) || "";
  const pageTitle = probe && typeof probe.pageTitle === "string" ? probe.pageTitle : "";
  let screenshot = "";
  let screenshots = [];
  const dir = config.screenshotDir || config.receiptDir;
  if (dir && session && typeof session.captureViews === "function") {
    screenshots = await session.captureViews(dir, reason || "probe-failed");
    screenshot = screenshots[0] || "";
  } else if (dir && session && typeof session.capture === "function") {
    screenshot = await session.capture(dir, reason || "probe-failed");
    screenshots = screenshot ? [screenshot] : [];
  }
  return { pageUrl, pageTitle, screenshot, screenshots };
}

async function accessFailure(session, config, article, account, probe, access) {
  const evidence = await captureEvidence(session, config, probe, access.reason);
  return result("save-draft", {
    exitCode: access.exitCode,
    state: "not-started",
    retryable: access.reason === "probe-failed" || access.reason === "session-unrecognized",
    error: access.reason,
    login_required: Boolean(access.loginRequired),
    account: account.account,
    accounts: account.accounts,
    identityVisible: Boolean(probe && probe.identityVisible),
    ...evidence,
    plan: planOf(article),
    ...(access.loginRequired ? howToLogin() : {}),
  });
}

export async function executeCheck(config, deps) {
  let session = null;
  try {
    session = await deps.browser.open({ taskName: TASK_NAME, startUrl: HOME_URL });
    const probe = await session.probe();
    const account = decideAccount(probe, config.expectAccount || "");
    if (!account.ok) return accountFailure("check-login", account);
    return result("check-login", {
      ok: true,
      exitCode: 0,
      state: "not-started",
      account: account.account,
      accounts: account.accounts,
      identityVisible: Boolean(account.identityVisible),
      ...loginTip(account.account),
    });
  } catch (error) {
    return result("check-login", {
      exitCode: 1,
      state: "failed",
      retryable: true,
      error: String(error.message || error),
    });
  } finally {
    if (session) await session.finish().catch(() => {});
  }
}

export async function executeSave(config, deps) {
  const article = config.article;
  const store = deps.receipts || createReceiptStore(deps.fs);
  const now = deps.now || (() => new Date().toISOString());
  if (!article || !article.hash) {
    return result("save-draft", { exitCode: 1, state: "failed", error: "article was not prepared" });
  }
  const existing = store.read(config.receiptDir, article.hash);
  const decision = decideAttempt({
    saveDraft: Boolean(config.saveDraft),
    verifyDraft: Boolean(config.verifyDraft),
    repairDraft: Boolean(config.repairDraft),
    receipt: existing,
    hash: article.hash,
  });
  const plan = planOf(article);
  if (decision.resume) return resumeDraft(config, deps, decision, article, store, now, plan);
  if (decision.repair) return repairDraft(config, deps, decision, article, store, now, plan);
  if (!decision.save) {
    const prior = decision.receipt || {};
    return result(config.verifyDraft ? "verify-draft" : "save-draft", {
      ok: decision.exitCode === 0 || decision.action === "preview",
      exitCode: decision.exitCode,
      state: decision.state,
      verified: decision.state === "draft-saved",
      retryable: false,
      mutation: "none",
      consent: decision.consent,
      action: decision.action,
      duplicate: decision.action === "already-saved",
      confirmation_required: decision.action === "preview",
      draftId: prior.draftId || "",
      draftUrl: prior.draftUrl || draftEditUrl(prior.draftId),
      error: decision.error || (decision.action === "blocked-previous-mutation" ? "previous-mutation" : ""),
      plan,
      account: prior.account || "",
    });
  }

  let session = null;
  try {
    session = await deps.browser.open({ taskName: TASK_NAME, startUrl: HOME_URL });
    const home = await session.probe();
    const account = decideAccount(home, config.expectAccount || "");
    if (!account.ok) return accountFailure("save-draft", account, article);

    await session.goto(WRITE_URL);
    const editor = await probeWrite(session, article);
    const access = classifyAccess(editor, { openedWrite: true });
    if (!access.ok) return accessFailure(session, config, article, account, editor, access);
    const blocked = precondition(editor, article);
    if (blocked) {
      const evidence = await captureEvidence(session, config, editor, blocked.error);
      return result("save-draft", {
        ...blocked,
        account: account.account,
        accounts: account.accounts,
        plan,
        draftId: editor.draftId || "",
        draftUrl: draftEditUrl(editor.draftId),
        mutation: editor.draftId || editor.autosaveLabel ? "autosave" : "none",
        ...evidence,
      });
    }

    const opening = receiptBody(article, account.account, {
      state: "unverified",
      verified: false,
      retryable: false,
      mutation: "none",
      draftId: editor.draftId || "",
      error: "",
    }, { phase: "editor-open", updatedAt: now() });
    try {
      store.write(config.receiptDir, opening);
    } catch (error) {
      return result("save-draft", {
        exitCode: 1,
        state: editor.draftId ? "unverified" : "failed",
        retryable: !editor.draftId,
        error: `cannot write receipt: ${error.message}`,
        account: account.account,
        draftId: editor.draftId || "",
        draftUrl: draftEditUrl(editor.draftId),
        plan,
      });
    }

    let progress;
    try {
      progress = await compose(session, article, {
        explicitDraftLabel: editor.explicitDraftLabel,
        draftId: editor.draftId || "",
        autosaveLabel: editor.autosaveLabel || "",
        published: Boolean(editor.published),
        onAccepted: async () => {
          store.write(config.receiptDir, receiptBody(article, account.account, {
            state: "unverified",
            verified: false,
            retryable: false,
            mutation: "none",
            draftId: editor.draftId || "",
            error: "",
          }, { phase: "content-entered", updatedAt: now() }));
        },
      });
    } catch (error) {
      progress = {
        accepted: true,
        error: String(error.message || error),
        draftId: editor.draftId || "",
        coverRequired: Boolean(article.cover),
        explicitControl: Boolean(editor.explicitDraftLabel),
      };
    }

    const outcome = classifyOutcome(progress);
    const body = receiptBody(article, account.account, outcome, {
      phase: outcome.state,
      coverApplied: progress.coverApplied,
      observed: progress.observed,
      readback: progress.readback,
      updatedAt: now(),
    });
    let receiptError = "";
    try {
      store.write(config.receiptDir, body);
    } catch (error) {
      receiptError = `cannot write receipt: ${error.message}`;
    }
    let screenshot = "";
    if (config.screenshotDir && outcome.state !== "draft-saved" && !progress.loginExpired && typeof session.capture === "function") {
      screenshot = await session.capture(config.screenshotDir, outcome.state);
    }
    const exitCode = exitFor(outcome, progress);
    return result("save-draft", {
      ok: exitCode === 0,
      exitCode,
      state: outcome.state,
      verified: outcome.verified,
      retryable: outcome.retryable,
      mutation: outcome.mutation,
      consent: "save-draft",
      account: account.account,
      accounts: account.accounts,
      draftId: outcome.draftId || "",
      draftUrl: draftEditUrl(outcome.draftId),
      error: outcome.error || "",
      receiptError,
      screenshot,
      observed: progress.observed,
      readback: progress.readback,
      plan,
      title: article.title,
      imageCount: article.imageCount,
      ...loginTip(account.account),
      ...(progress.loginExpired ? howToLogin() : {}),
    });
  } catch (error) {
    return result("save-draft", {
      exitCode: 1,
      state: "failed",
      retryable: true,
      error: String(error.message || error),
      plan,
    });
  } finally {
    if (session) await session.finish().catch(() => {});
  }
}

function textShapeOk(check) {
  return Boolean(check && check.titleOk && !check.duplicateLead && !check.duplicateShape
    && check.missing.length === 0 && check.missingHeadings.length === 0
    && check.missingItems.length === 0 && check.missingHrefs.length === 0 && !check.rawMarkup);
}

function readbackFields(check, editor) {
  return {
    titleOk: Boolean(check.titleOk),
    imagesOk: Boolean(check.imagesOk),
    coverOk: Boolean(check.coverOk),
    duplicateLead: Boolean(check.duplicateLead),
    duplicateShape: Boolean(check.duplicateShape),
    uploadPending: Boolean(check.uploadPending),
    missing: check.missing,
    missingHeadings: check.missingHeadings,
    missingItems: check.missingItems,
    missingHrefs: check.missingHrefs,
    imageCount: check.imageCount,
    imageInventory: Array.isArray(editor && editor.imageInventory) ? editor.imageInventory.slice(0, 12) : [],
    blocks: Array.isArray(editor && editor.blocks) ? editor.blocks.slice(0, 80) : [],
  };
}

async function repairDraft(config, deps, decision, article, store, now, plan) {
  const prior = decision.receipt || {};
  const draftUrl = draftEditUrl(prior.draftId);
  const command = "repair-draft";
  if (!draftUrl) {
    return result(command, {
      exitCode: 4,
      state: prior.state || "unverified",
      mutation: "none",
      error: "previous-mutation",
      draftId: prior.draftId || "",
      plan,
    });
  }
  let session = null;
  let editor = null;
  let mutated = false;
  try {
    session = await deps.browser.open({ taskName: TASK_NAME, startUrl: HOME_URL });
    const home = await session.probe();
    const account = decideAccount(home, config.expectAccount || "");
    if (!account.ok) return accountFailure(command, account, article);
    await session.goto(draftUrl);
    editor = await probeWrite(session, article);
    const access = classifyAccess(editor, { openedWrite: true });
    if (!access.ok) return accessFailure(session, config, article, account, editor, access);
    const stop = editor.published
      ? "published-url"
      : (String(editor.draftId || "") !== String(prior.draftId)
        ? "draft-id-changed"
        : (editor.blank || !compactText(editor.text)
          ? "resume-empty"
          : (!editorLooksLikeArticle(article, editor) ? "resume-mismatch" : "")));
    const beforeShot = await captureEvidence(session, config, editor, stop || "repair-before");
    if (stop) {
      return result(command, {
        exitCode: 4,
        state: "unverified",
        mutation: "none",
        action: "repair-draft",
        error: stop,
        account: account.account,
        accounts: account.accounts,
        draftId: prior.draftId,
        draftUrl,
        plan,
        ...beforeShot,
      });
    }
    const beforeCheck = validateReadback(article, editor);
    if (!beforeCheck.duplicateLead && !beforeCheck.duplicateShape) {
      return result(command, {
        exitCode: 4,
        state: "unverified",
        mutation: "none",
        consent: "repair-draft",
        action: "repair-draft",
        error: "repair-not-duplicated",
        account: account.account,
        draftId: prior.draftId,
        draftUrl,
        plan,
        readback: readbackFields(beforeCheck, editor),
        evidenceScope: "visible-editor-read",
        ...beforeShot,
      });
    }
    const beforeText = editor.text || "";
    const cleared = await session.clearBody({ expectedText: beforeText, title: article.title });
    if (!cleared || !cleared.ok) {
      return result(command, {
        exitCode: 4,
        state: "unverified",
        mutation: cleared && cleared.mutated ? "unknown" : "none",
        consent: "repair-draft",
        action: "repair-draft",
        error: (cleared && cleared.error) || "selection-unverified",
        account: account.account,
        draftId: prior.draftId,
        draftUrl,
        plan,
        readback: readbackFields(beforeCheck, editor),
        evidenceScope: "draft-js-keyboard-sequence",
        ...beforeShot,
      });
    }
    mutated = true;
    const groups = coalescePastes(article.segments || []);
    for (const segment of groups) {
      if (segment.kind !== "html") continue;
      const pasted = await session.pasteBody(segment.html, segment.text);
      if (!pasted || !pasted.ok) {
        return result(command, {
          exitCode: 4,
          state: "unverified",
          mutation: "unknown",
          consent: "repair-draft",
          action: "repair-draft",
          error: (pasted && pasted.error) || "paste-failed",
          draftId: prior.draftId,
          draftUrl,
          plan,
          account: account.account,
          ...beforeShot,
        });
      }
    }
    const mid = await session.readEditor();
    const midCheck = validateReadback(article, { ...mid, imageCount: article.imageCount, coverApplied: !article.cover });
    const identityOk = mid && mid.ok !== false && String(mid.draftId || prior.draftId) === String(prior.draftId)
      && normalizeText(mid.title) === normalizeText(article.title);
    if (!identityOk || !textShapeOk(midCheck)) {
      const rolled = typeof session.restorePlainText === "function"
        ? await session.restorePlainText(beforeText)
        : { ok: false, error: "rollback-unavailable" };
      return result(command, {
        exitCode: 4,
        state: "unverified",
        mutation: "unknown",
        consent: "repair-draft",
        action: "repair-draft",
        error: rolled && rolled.ok ? "repair-rolled-back" : "rollback-unverified",
        draftId: prior.draftId,
        draftUrl,
        plan,
        account: account.account,
        readback: readbackFields(midCheck, mid),
        ...beforeShot,
      });
    }
    for (const segment of groups) {
      if (segment.kind !== "image") continue;
      const uploaded = await session.uploadBodyImage(segment.path);
      if (!uploaded || !uploaded.ok) {
        return result(command, {
          exitCode: 4,
          state: "unverified",
          mutation: "unknown",
          consent: "repair-draft",
          action: "repair-draft",
          error: (uploaded && (uploaded.code || uploaded.error)) || "upload-failed",
          draftId: prior.draftId,
          draftUrl,
          plan,
          account: account.account,
          ...beforeShot,
        });
      }
    }
    let coverError = "";
    if (article.cover && article.cover.path) {
      const cover = await session.uploadCover(article.cover.path);
      if (!cover || !cover.ok) coverError = (cover && (cover.code || cover.error)) || "cover-unverified";
    }
    const settled = await session.waitForSavedDraft();
    if (settled && settled.draftId && String(settled.draftId) !== String(prior.draftId)) {
      return result(command, {
        exitCode: 4,
        state: "unverified",
        mutation: "unknown",
        error: "draft-id-changed",
        draftId: prior.draftId,
        draftUrl,
        plan,
        account: account.account,
      });
    }
    await session.goto(draftUrl);
    const again = await session.readEditor();
    const againCheck = validateReadback(article, again);
    const persisted = !coverError && again && String(again.draftId || "") === String(prior.draftId) && againCheck.ok && again.autosaveLabel;
    const evidence = await captureEvidence(session, config, again || editor, persisted ? "draft-saved" : "repair-unverified");
    const body = receiptBody(article, account.account, {
      state: persisted ? "draft-saved" : "unverified",
      verified: Boolean(persisted),
      draftId: prior.draftId,
      error: persisted ? "" : (coverError || (againCheck.duplicateLead || againCheck.duplicateShape ? "duplicate-content" : (again && again.autosaveLabel ? "readback-mismatch" : "autosave-badge-missing"))),
    }, {
      phase: persisted ? "draft-saved" : "repair-unverified",
      coverApplied: Boolean(again && again.coverApplied),
      observed: again ? { title: again.title || "", imageCount: again.imageCount, draftId: prior.draftId, excerpt: normalizeText(again.text).slice(0, 80) } : null,
      readback: readbackFields(againCheck, again),
      updatedAt: now(),
    });
    let receiptError = "";
    try {
      store.write(config.receiptDir, body);
    } catch (error) {
      receiptError = `cannot write receipt: ${error.message}`;
    }
    return result(command, {
      ok: Boolean(persisted),
      exitCode: persisted ? 0 : 4,
      state: persisted ? "draft-saved" : "unverified",
      verified: Boolean(persisted),
      mutation: "keyboard-replace",
      consent: "repair-draft",
      action: "repair-draft",
      evidenceScope: "draft-js-keyboard-sequence",
      account: account.account,
      accounts: account.accounts,
      draftId: prior.draftId,
      draftUrl,
      error: persisted ? "" : body.error,
      receiptError,
      plan,
      readback: readbackFields(againCheck, again),
      ...evidence,
    });
  } catch (error) {
    let evidence = { pageUrl: "", pageTitle: "", screenshot: "", screenshots: [] };
    try {
      evidence = await captureEvidence(session, config, editor, "repair-threw");
    } catch {
      // Evidence stays empty when capture also fails.
    }
    return result(command, {
      exitCode: 4,
      state: "unverified",
      mutation: mutated ? "unknown" : "none",
      consent: "repair-draft",
      action: "repair-draft",
      error: String(error.message || error),
      draftId: prior.draftId,
      draftUrl,
      plan,
      ...evidence,
    });
  } finally {
    if (session) await session.finish().catch(() => {});
  }
}

async function resumeDraft(config, deps, decision, article, store, now, plan) {
  const prior = decision.receipt || {};
  const draftUrl = draftEditUrl(prior.draftId);
  const command = "verify-draft";
  if (!draftUrl) {
    return result(command, {
      exitCode: 4,
      state: prior.state || "unverified",
      retryable: false,
      error: "previous-mutation",
      draftId: prior.draftId || "",
      plan,
      account: prior.account || "",
    });
  }
  let session = null;
  let editor = null;
  try {
    session = await deps.browser.open({ taskName: TASK_NAME, startUrl: HOME_URL });
    const home = await session.probe();
    const account = decideAccount(home, config.expectAccount || "");
    if (!account.ok) return accountFailure(command, account, article);
    await session.goto(draftUrl);
    editor = await probeWrite(session, article);
    const access = classifyAccess(editor, { openedWrite: true });
    if (!access.ok) return accessFailure(session, config, article, account, editor, access);
    const stop = editor.published
      ? "published-url"
      : (String(editor.draftId || "") !== String(prior.draftId)
        ? "draft-id-changed"
        : (editor.blank || !compactText(editor.text)
          ? "resume-empty"
          : (!editorLooksLikeArticle(article, editor) ? "resume-mismatch" : "")));
    if (stop) {
      const error = stop;
      const evidence = await captureEvidence(session, config, editor, error);
      return result(command, {
        exitCode: editor.published || error === "draft-id-changed" ? 4 : 4,
        state: "unverified",
        retryable: false,
        error,
        account: account.account,
        accounts: account.accounts,
        draftId: prior.draftId,
        draftUrl,
        plan,
        mutation: "none",
        ...evidence,
      });
    }

    const progress = {
      accepted: true,
      mediaSubmitted: false,
      explicitControl: false,
      explicitClicked: false,
      forbidden: false,
      published: false,
      autosaveBadge: Boolean(editor.autosaveLabel),
      autosaveObserved: Boolean(editor.autosaveLabel || editor.draftId),
      readbackOk: false,
      coverRequired: Boolean(article.cover),
      coverApplied: Boolean(editor.coverApplied),
      timedOut: false,
      draftId: String(prior.draftId),
      preexistingId: String(prior.draftId),
      localFailure: false,
      loginExpired: false,
      error: "",
      observed: null,
      readback: null,
    };
    // Read only. Node removal and cover upload are not a verified editor commit,
    // and this hash must not be pasted or published.
    const settled = await session.waitForSavedDraft();
    if (settled.draftId && settled.draftId !== progress.draftId) {
      progress.error = "draft-id-changed";
    } else {
      if (settled.draftId) progress.draftId = settled.draftId;
      if (settled.autosaveLabel) {
        progress.autosaveBadge = true;
        progress.autosaveObserved = true;
      }
      if (settled.published) progress.error = progress.error || "published-url";
      progress.timedOut = Boolean(settled.timedOut) || progress.timedOut;
    }
    let again = null;
    if (!progress.error) {
      await session.goto(draftUrl);
      again = await session.readEditor();
    } else if (typeof session.readEditor === "function") {
      again = await session.readEditor();
    }
    if (again) {
      const againAccess = classifyAccess(again, { openedWrite: true });
      if (!againAccess.ok) {
        progress.loginExpired = againAccess.reason === "login-expired";
        progress.challenge = againAccess.reason === "challenge";
        progress.error = againAccess.reason;
      } else if (again.draftId && again.draftId !== progress.draftId) {
        progress.error = "draft-id-changed";
      } else {
        if (again.autosaveLabel) progress.autosaveBadge = true;
        if (again.coverApplied) progress.coverApplied = true;
        const check = validateReadback(article, again);
        progress.readback = {
          titleOk: check.titleOk,
          imagesOk: check.imagesOk,
          coverOk: check.coverOk,
          missing: check.missing,
          missingHeadings: check.missingHeadings,
          missingItems: check.missingItems,
          missingHrefs: check.missingHrefs,
          rawMarkup: check.rawMarkup,
          duplicateLead: Boolean(check.duplicateLead),
          duplicateShape: Boolean(check.duplicateShape),
          uploadPending: Boolean(check.uploadPending),
          imageCount: check.imageCount,
          imageInventory: Array.isArray(again.imageInventory) ? again.imageInventory.slice(0, 12) : [],
          blocks: Array.isArray(again.blocks) ? again.blocks.slice(0, 60) : [],
        };
        progress.readbackOk = Boolean(check.ok && again.draftId === progress.draftId && !progress.error);
        if (!check.ok && !progress.error) progress.error = readbackError(check);
        progress.observed = {
          title: again.title || "",
          imageCount: again.imageCount,
          imageInventory: Array.isArray(again.imageInventory) ? again.imageInventory.slice(0, 12) : [],
          blocks: Array.isArray(again.blocks) ? again.blocks.slice(0, 60) : [],
          autosaveLabel: again.autosaveLabel || "",
          coverApplied: Boolean(again.coverApplied),
          draftId: again.draftId || progress.draftId,
          excerpt: normalizeText(again.text).slice(0, 80),
        };
      }
    }
    const outcome = classifyOutcome(progress);
    const body = receiptBody(article, account.account, outcome, {
      phase: outcome.state,
      coverApplied: progress.coverApplied,
      observed: progress.observed,
      readback: progress.readback,
      updatedAt: now(),
    });
    let receiptError = "";
    try {
      store.write(config.receiptDir, body);
    } catch (error) {
      receiptError = `cannot write receipt: ${error.message}`;
    }
    const evidence = await captureEvidence(session, config, editor, outcome.error || outcome.state);
    const exitCode = exitFor(outcome, progress);
    return result(command, {
      ok: exitCode === 0,
      exitCode,
      state: outcome.state,
      verified: outcome.verified,
      retryable: false,
      mutation: "none",
      consent: "verify-draft",
      action: "verify-draft",
      evidenceScope: "visible-editor-read",
      repair: { status: "blocked", reason: "editor-replacement-unproven" },
      account: account.account,
      accounts: account.accounts,
      draftId: outcome.draftId || prior.draftId,
      draftUrl,
      error: outcome.error || "",
      receiptError,
      observed: progress.observed,
      readback: progress.readback,
      plan,
      ...evidence,
      ...loginTip(account.account),
    });
  } catch (error) {
    let evidence = { pageUrl: "", pageTitle: "", screenshot: "", screenshots: [] };
    try {
      evidence = await captureEvidence(session, config, editor, "resume-threw");
    } catch {
      // Evidence is best-effort after an exception.
    }
    return result(command, {
      exitCode: 4,
      state: "unverified",
      retryable: false,
      mutation: "unknown",
      consent: "verify-draft",
      action: "verify-draft",
      evidenceScope: "visible-editor-read",
      repair: { status: "blocked", reason: "editor-replacement-unproven" },
      error: String(error.message || error),
      draftId: prior.draftId,
      draftUrl,
      plan,
      ...evidence,
    });
  } finally {
    if (session) await session.finish().catch(() => {});
  }
}

function precondition(editor, article) {
  if (editor.published) {
    return { exitCode: 4, state: "not-started", retryable: false, error: "published-url" };
  }
  if (editor.draftAmbiguous) {
    return { exitCode: 4, state: "not-started", retryable: false, error: "draft-id-ambiguous" };
  }
  if (!editor.blank) {
    return { exitCode: 4, state: "not-started", retryable: false, error: "editor-not-blank" };
  }
  if (editor.surface !== "article" || !editor.editorReady || editor.bodyAmbiguous) {
    return { exitCode: 1, state: editor.draftId ? "unverified" : "not-started", retryable: !editor.draftId, error: "unsupported-surface" };
  }
  if (article.imageCount && (!editor.imageInput || editor.imageAmbiguous)) {
    return { exitCode: 1, state: editor.draftId ? "unverified" : "not-started", retryable: !editor.draftId, error: editor.imageAmbiguous ? "image-control-ambiguous" : "image-control-missing" };
  }
  if (article.cover && (!editor.coverInput || editor.coverAmbiguous)) {
    return { exitCode: 1, state: editor.draftId ? "unverified" : "not-started", retryable: !editor.draftId, error: editor.coverAmbiguous ? "cover-control-ambiguous" : "cover-control-missing" };
  }
  return null;
}

export async function executeCleanup(config, deps) {
  try {
    const listed = await deps.browser.listSpaces();
    if (listed == null || !Array.isArray(listed)) {
      return result("cleanup", { exitCode: 1, state: "failed", error: "listTaskSpaces is unavailable" });
    }
    const matched = listed.filter((space) => space && (
      space.name === TASK_NAME || String(space.name || "").startsWith(`${TASK_NAME}-`)
    ));
    const closed = [];
    for (const space of matched) {
      await deps.browser.finishSpace(space);
      closed.push(space.id || space.name);
    }
    return result("cleanup", { ok: true, exitCode: 0, state: "not-started", closed });
  } catch (error) {
    return result("cleanup", { exitCode: 1, state: "failed", error: String(error.message || error) });
  }
}
