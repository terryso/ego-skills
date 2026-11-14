// One 贴图 editor tab. Account probing stays on the shared mp.weixin.qq.com page.
import fs from "node:fs";
import path from "node:path";
import { mpAct } from "./mp-dom.mjs";
import { tietuAct } from "./tietu-dom.mjs";
import {
  TIETU_FILE_INPUT,
  TIETU_AUTOSAVE_TIMEOUT_MS,
  TIETU_SAVE_POLL_MS,
  TIETU_SAVE_TIMEOUT_MS,
  TIETU_UPLOAD_POLL_MS,
  TIETU_UPLOAD_TIMEOUT_MS,
  appmsgidFromSave,
  articleListUrl,
  describeFileInputs,
  describeUpload,
  imageFieldsFromBody,
  mergeSaveObservations,
  parseSaveResponse,
  savesFromEvents,
  redactMpUrl,
  sessionToken,
  tietuEditorUrl,
  tietuListUrl,
  trimUploaderHtml,
  uploadAdvanced,
} from "./tietu.mjs";

export function createTietuSession({ task, page, timings = {} } = {}) {
  if (!page) throw new Error("createTietuSession requires a page");
  let current = page;
  let finished = false;
  const attempts = timings.attempts ?? 8;
  const waitMs = timings.waitMs ?? 100;
  const uploadWaitMs = timings.uploadWaitMs ?? TIETU_UPLOAD_POLL_MS;
  const uploadTimeoutMs = timings.uploadTimeoutMs ?? TIETU_UPLOAD_TIMEOUT_MS;
  const savePollMs = timings.savePollMs ?? TIETU_SAVE_POLL_MS;
  const saveTimeoutMs = timings.saveTimeoutMs ?? TIETU_SAVE_TIMEOUT_MS;
  const autosaveTimeoutMs = timings.autosaveTimeoutMs ?? TIETU_AUTOSAVE_TIMEOUT_MS;
  let saveClickedAt = 0;
  const popupMs = timings.popupMs ?? 4_000;

  async function pause(ms) {
    if (ms && current && typeof current.waitForTimeout === "function") await current.waitForTimeout(ms);
  }

  async function act(op, extra = {}) {
    const result = await current.evaluate(tietuAct, { op, ...extra });
    return result || { ok: false, error: "empty evaluate result" };
  }

  async function redactGoto(url) {
    try {
      await current.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try {
        if (typeof current.waitForLoadState === "function") {
          await current.waitForLoadState("networkidle", { timeout: 8_000 });
        }
      } catch {
        // The editor keeps requests open after the shell is ready.
      }
    } catch (error) {
      const message = String(error && error.message ? error.message : error).replace(/token=[^&\s]+/gi, "token=redacted");
      throw new Error(message);
    }
  }

  async function token() {
    try {
      const fromDom = await act("session-token");
      if (fromDom && fromDom.token) return fromDom.token;
    } catch {
      // Fall through to the page URL when evaluate cannot see location.
    }
    if (typeof current.url === "function") return sessionToken(await current.url());
    return "";
  }

  async function adopt(popup) {
    if (!popup) return false;
    const label = popup.label || (popup.page && popup.page.label);
    if (label && task && typeof task.page === "function") {
      current = task.page(label);
      return true;
    }
    if (typeof popup.goto === "function" || typeof popup.evaluate === "function") {
      current = popup;
      return true;
    }
    return false;
  }

  async function waitReady() {
    let last = { editorReady: false };
    for (let index = 0; index < attempts; index += 1) {
      last = await act("editor-state");
      if (last.editorReady && !last.appmsgid) return last;
      await pause(waitMs);
    }
    return last;
  }

  async function openByUrl() {
    const value = await token();
    if (!value) return null;
    await redactGoto(tietuEditorUrl({ token: value }));
    const ready = await waitReady();
    if (ready.editorReady) return ready;
    return null;
  }

  async function observedSaves(watch) {
    let pageSaves = [];
    try {
      const read = await act("read-saves");
      pageSaves = (read && read.saves) || [];
    } catch {
      pageSaves = [];
    }
    let events = [];
    if (typeof current.events === "function") {
      try {
        events = savesFromEvents(await current.events());
      } catch {
        events = [];
      }
    }
    return mergeSaveObservations({
      pageSaves,
      events,
      requests: watch && typeof watch.requests === "function" ? watch.requests() : [],
      responses: watch && typeof watch.responses === "function" ? watch.responses() : [],
    });
  }

  return {
    get page() {
      return current;
    },
    async goto(url) {
      await redactGoto(url);
    },
    async probe() {
      try {
        const result = await current.evaluate(mpAct, { op: "probe" });
        return result || { ok: false, loginWall: true, loggedIn: false, accounts: [] };
      } catch (error) {
        return { ok: false, loginWall: true, loggedIn: false, accounts: [], error: String(error.message || error) };
      }
    },
    async openEditor() {
      const existing = await act("editor-state");
      if (existing.editorReady && !existing.appmsgid) return existing;
      const created = await current.evaluate(mpAct, { op: "click", text: "新的创作", required: true });
      if (created && created.ok) {
        await pause(waitMs);
        const popupPromise = typeof current.waitForEvent === "function"
          ? current.waitForEvent("popup", { timeout: popupMs }).catch(() => null)
          : Promise.resolve(null);
        const picked = (await current.evaluate(mpAct, { op: "click", text: "贴图", required: true }))
          || { ok: false, error: "贴图 not found" };
        if (picked.forbidden) throw new Error(picked.error || "refusing to click a publish control");
        await adopt(await popupPromise);
        const ready = await waitReady();
        if (ready.editorReady && !ready.appmsgid) return ready;
        if (!picked.ok && !ready.editorReady) {
          const direct = await openByUrl();
          if (direct) return direct;
          throw new Error(picked.error || "贴图 editor did not open");
        }
      }
      const direct = await openByUrl();
      if (direct) return direct;
      throw new Error((created && created.error) || "贴图 editor did not open");
    },
    async uploadImages(files, options = {}) {
      const list = [...(files || [])];
      if (!list.length) throw new Error("--image is required");
      const timeout = options.timeoutMs ?? uploadTimeoutMs;
      const interval = options.pollMs ?? uploadWaitMs;
      const fsImpl = options.fs || fs;
      const dir = options.screenshotDir || options.receiptDir || "";
      let count = 0;
      const uploads = [];

      function watchUploads() {
        let seen = 0;
        const handler = (response) => {
          try {
            const url = typeof response.url === "function" ? response.url() : String((response && response.url) || "");
            if (/filetransfer|uploadimg/i.test(url)) seen += 1;
          } catch {
            // A response without a URL is not an upload.
          }
        };
        try {
          if (typeof current.on === "function") current.on("response", handler);
        } catch {
          // This page does not emit network events. The DOM probe still counts resource entries.
        }
        return {
          count() { return seen; },
          stop() {
            try {
              if (typeof current.off === "function") current.off("response", handler);
              else if (typeof current.removeListener === "function") current.removeListener("response", handler);
            } catch {
              // The page may already be gone.
            }
          },
        };
      }

      async function probe(networkHits) {
        return act("upload-probe", { networkHits });
      }

      async function writeDebug(html) {
        const written = { screenshot: "", uploaderHtml: "" };
        if (!dir) return written;
        try {
          await fsImpl.promises.mkdir(dir, { recursive: true });
          const htmlPath = path.join(dir, "tietu-upload-failed.html");
          await fsImpl.promises.writeFile(htmlPath, trimUploaderHtml(html), "utf8");
          written.uploaderHtml = htmlPath;
        } catch (error) {
          written.htmlError = String(error.message || error);
        }
        if (typeof current.screenshot === "function") {
          const shot = path.join(dir, "tietu-upload-failed.png");
          try {
            const saved = await current.screenshot({ path: shot });
            written.screenshot = saved || shot;
          } catch (error) {
            written.screenshotError = String(error.message || error);
          }
        }
        return written;
      }

      function summaryOf(probe) {
        return {
          imageCount: probe && probe.imageCount || 0,
          thumbCount: probe && probe.thumbCount || 0,
          placeholder: Boolean(probe && probe.placeholder),
          inputValue: probe && probe.inputValue || "",
          inputChildren: probe && probe.inputChildren || 0,
          uploadResponses: probe && probe.uploadResponses || 0,
        };
      }

      async function failUpload(message, before, after) {
        const debug = await writeDebug(after && after.outerHTML || before && before.outerHTML || "");
        const paths = [debug.screenshot && `screenshot=${debug.screenshot}`, debug.uploaderHtml && `uploaderHtml=${debug.uploaderHtml}`]
          .filter(Boolean)
          .join("; ");
        const error = new Error(`${message}; ${describeFileInputs(before)}; ${describeUpload(before, after)}${paths ? `; ${paths}` : ""}`);
        error.uploadDebug = {
          ...debug,
          fileInputs: (before && before.fileInputs) || [],
          chosenIndex: before && before.chosenIndex || 0,
          chosenAccept: before && before.chosenAccept || "",
          before: summaryOf(before),
          after: summaryOf(after),
        };
        throw error;
      }

      for (const file of list) {
        const watcher = watchUploads();
        try {
          const before = await probe(watcher.count());
          if ((before.fileInputs || []).length < 2) {
            await failUpload("the 贴图 uploader is the second file input", before, before);
          }
          if (typeof current.setInputFiles !== "function") throw new Error("setInputFiles is required");
          await current.setInputFiles(TIETU_FILE_INPUT, [file]);
          const started = Date.now();
          const expected = uploads.length + 1;
          let after = await probe(watcher.count());
          let decision = uploadAdvanced(before, after, { expected });
          while (!decision.ok && timeout > 0 && interval > 0 && Date.now() - started < timeout) {
            await pause(interval);
            after = await probe(watcher.count());
            decision = uploadAdvanced(before, after, { expected });
          }
          if (!decision.ok) {
            const hinted = (decision.hints || []).join(",") || "none";
            await failUpload(`贴图 image is not on the CDN yet (${after.cdnImageCount || 0}/${expected}); hints=${hinted}; not saving`, before, after);
          }
          count = after.cdnImageCount || 0;
          uploads.push({
            file: path.basename(String(file || "")),
            via: decision.reasons,
            hints: decision.hints,
            fileInputs: before.fileInputs,
            chosenIndex: before.chosenIndex,
            chosenAccept: before.chosenAccept,
          });
        } finally {
          watcher.stop();
        }
      }
      return { imageCount: count, uploads };
    },
    async assertContentImages(expected, options = {}) {
      const timeout = options.timeoutMs ?? uploadTimeoutMs;
      const interval = options.pollMs ?? uploadWaitMs;
      const started = Date.now();
      const fsImpl = options.fs || fs;
      const dir = options.screenshotDir || options.receiptDir || "";
      let last = await act("upload-probe");
      while ((last.cdnImageCount || 0) < expected && timeout > 0 && interval > 0 && Date.now() - started < timeout) {
        await pause(interval);
        last = await act("upload-probe");
      }
      if ((last.cdnImageCount || 0) < expected) {
        let shot = "";
        let shotError = "";
        if (dir && typeof current.screenshot === "function") {
          shot = path.join(dir, "tietu-upload-failed.png");
          try {
            await fsImpl.promises.mkdir(dir, { recursive: true });
            await current.screenshot({ path: shot, fullPage: true });
          } catch (error) {
            shotError = String(error.message || error);
            shot = "";
          }
        }
        const error = new Error(`贴图 image is not on the CDN yet (${last.cdnImageCount || 0}/${expected}); not saving`);
        error.uploadDebug = {
          screenshot: shot,
          screenshotError: shotError,
          cdnImageCount: last.cdnImageCount || 0,
          expected,
          placeholder: Boolean(last.placeholder),
        };
        throw error;
      }
      return { cdnImageCount: last.cdnImageCount, expected };
    },
    async fillTitle(title) {
      const focused = await act("focus-title");
      if (!focused.ok) throw new Error(focused.error || "title field not found");
      if (!current.keyboard || typeof current.keyboard.insertText !== "function") {
        throw new Error("keyboard.insertText is required");
      }
      if (focused.text && typeof current.keyboard.press === "function") {
        await current.keyboard.press("Backspace");
      }
      await current.keyboard.insertText(title);
      return { ok: true, via: "insertText" };
    },
    async fillBody(steps) {
      const focused = await act("focus-body");
      if (!focused.ok) throw new Error(focused.error || "body field not found");
      if (!current.keyboard || typeof current.keyboard.insertText !== "function" || typeof current.keyboard.press !== "function") {
        throw new Error("keyboard.insertText is required");
      }
      for (const step of steps || []) {
        if (step.op === "enter") {
          await current.keyboard.press("Enter");
          continue;
        }
        if (step.op === "insertText") {
          await current.keyboard.insertText(step.value);
          if (step.value === "#") await pause(waitMs);
        }
      }
      return { ok: true };
    },
    async readEditor() {
      return act("read-editor");
    },
    async beginSaveWatch() {
      try {
        await act("install-save-hook");
      } catch {
        // The in-page hook is the primary source. page.on below is only a fallback.
      }
      const responses = [];
      const requests = [];
      const onResponse = async (response) => {
        try {
          const rawUrl = typeof response.url === "function" ? response.url() : String((response && response.url) || "");
          if (rawUrl && !/operate_appmsg/i.test(rawUrl)) return;
          let body = null;
          if (response && typeof response.json === "function") body = await response.json();
          else if (response && typeof response.text === "function") body = await response.text();
          const parsed = parseSaveResponse(body);
          if (!parsed.body.appMsgId && parsed.ret == null) return;
          responses.push({
            at: Date.now(),
            url: redactMpUrl(rawUrl),
            ret: parsed.ret,
            appMsgId: parsed.body.appMsgId || "",
          });
        } catch {
          // A response that is not the save JSON is ignored.
        }
      };
      const onRequest = (request) => {
        try {
          const rawUrl = typeof request.url === "function" ? request.url() : String((request && request.url) || "");
          if (!/operate_appmsg/i.test(rawUrl)) return;
          const post = typeof request.postData === "function" ? request.postData() : request.postData;
          const fields = imageFieldsFromBody(post || "");
          requests.push({ at: Date.now(), url: redactMpUrl(rawUrl), ...fields });
        } catch {
          // A request without a readable body is still noted below as missing fields.
        }
      };
      const listen = (event, handler) => {
        try {
          if (typeof current.on === "function") current.on(event, handler);
        } catch {
          // This page does not emit that event.
        }
      };
      listen("response", onResponse);
      listen("request", onRequest);
      const forget = (event, handler) => {
        try {
          if (typeof current.off === "function") current.off(event, handler);
          else if (typeof current.removeListener === "function") current.removeListener(event, handler);
        } catch {
          // The page may already be gone.
        }
      };
      return {
        responses() { return responses.slice(); },
        requests() { return requests.slice(); },
        stop() {
          forget("response", onResponse);
          forget("request", onRequest);
        },
      };
    },
    async waitForAutosave(options = {}) {
      // After the last keystroke. Do not click 保存为草稿 in here.
      const timeout = options.timeoutMs ?? autosaveTimeoutMs;
      const interval = options.pollMs ?? savePollMs;
      const watch = options.watch;
      const started = Date.now();
      let last = { ok: false, appmsgid: "", toastText: "", url: "", imageFields: null };
      let settled = false;
      while (!settled) {
        const state = await act("editor-state");
        const observed = await observedSaves(watch);
        const responses = observed.responses;
        const requests = observed.requests;
        const autosaveResponse = [...responses].reverse().find((item) => item.ret === 0 || item.ret === "0" || item.appMsgId);
        const footer = /\d{1,2}:\d{2}\s*已保存/.test(`${state.toastText || ""} ${state.savedTime || ""}`);
        const appmsgid = state.appmsgid || (autosaveResponse && autosaveResponse.appMsgId) || "";
        const signal = Boolean(footer || appmsgid || (autosaveResponse && (autosaveResponse.ret === 0 || autosaveResponse.ret === "0")));
        const imageFields = requests.length ? requests[requests.length - 1] : null;
        last = {
          ok: signal && (!imageFields || imageFields.nonEmpty),
          appmsgid,
          via: appmsgid && state.appmsgid ? "url" : (autosaveResponse ? "response" : (footer ? "footer" : "")),
          toastText: state.toastText || (footer ? `${state.savedTime || ""}已保存` : ""),
          url: state.url || "",
          imageFields: imageFields ? {
            cdnNonEmpty: Boolean(imageFields.cdnNonEmpty),
            shareNonEmpty: Boolean(imageFields.shareNonEmpty),
            nonEmpty: Boolean(imageFields.nonEmpty),
          } : null,
        };
        const imagesReady = !imageFields || imageFields.nonEmpty;
        settled = (signal && imagesReady) || !(timeout > 0 && interval > 0 && Date.now() - started < timeout);
        if (!settled) await pause(interval);
      }
      if (!last.ok) {
        const why = last.imageFields && !last.imageFields.nonEmpty
          ? "autosave request had no image"
          : "贴图 editor did not autosave";
        const error = new Error(why);
        error.autosave = last;
        throw error;
      }
      return last;
    },
    async confirmSave(options = {}) {
      // Stay on the editor page. Do not goto, reopen, or close while this waits.
      const timeout = options.timeoutMs ?? saveTimeoutMs;
      const interval = options.pollMs ?? savePollMs;
      const watch = options.watch;
      const fsImpl = options.fs || fs;
      const dir = options.screenshotDir || options.receiptDir || "";
      const started = Date.now();
      let last = {
        ok: false,
        appmsgid: "",
        via: "",
        url: "",
        toastText: "",
        savedTime: "",
        saved: false,
        saveResponse: null,
        screenshot: "",
        screenshotError: "",
      };
      let settled = false;
      while (!settled) {
        const state = await act("editor-state");
        const observed = await observedSaves(watch);
        const responses = observed.responses;
        const picked = appmsgidFromSave({ urlId: state.appmsgid || "", responses });
        const matched = responses.find((item) => item.appMsgId && item.appMsgId === picked.appmsgid) || responses.at(-1) || null;
        last = {
          ok: Boolean(picked.appmsgid),
          appmsgid: picked.appmsgid,
          via: picked.via,
          url: state.url || "",
          toastText: state.toastText || "",
          savedTime: state.savedTime || "",
          saved: Boolean(state.saved || state.toastText),
          saveResponse: matched ? { ret: matched.ret, appMsgId: matched.appMsgId || "" } : null,
          screenshot: last.screenshot,
          screenshotError: "",
        };
        const requests = observed.requests;
        const manual = [...requests].reverse().find((item) => item.at >= saveClickedAt) || null;
        last.saveRequest = manual ? {
          cdnNonEmpty: Boolean(manual.cdnNonEmpty),
          shareNonEmpty: Boolean(manual.shareNonEmpty),
          nonEmpty: Boolean(manual.nonEmpty),
        } : { missing: true, nonEmpty: false };
        settled = Boolean(picked.appmsgid) || !(timeout > 0 && interval > 0 && Date.now() - started < timeout);
        if (!settled) await pause(interval);
      }
      if (dir && typeof current.screenshot === "function") {
        const shot = path.join(dir, "tietu-save-confirm.png");
        try {
          await fsImpl.promises.mkdir(dir, { recursive: true });
          try {
            await act("scroll", { where: "top" });
          } catch {
            // The editor can still be captured from the current scroll position.
          }
          let written = "";
          try {
            written = await current.screenshot({ path: shot, fullPage: true });
          } catch {
            written = await current.screenshot({ path: shot });
          }
          last.screenshot = written || shot;
          if (last.screenshot && typeof fsImpl.existsSync === "function" && !fsImpl.existsSync(last.screenshot)) {
            last.screenshotError = `screenshot file was not written: ${last.screenshot}`;
            last.screenshot = "";
          }
        } catch (error) {
          last.screenshotError = String(error.message || error);
          last.screenshot = "";
        }
      } else if (!dir) {
        last.screenshotError = "no directory for the save confirm screenshot";
      } else {
        last.screenshotError = "screenshot is not available";
      }
      if (last.screenshotError) last.ok = false;
      return last;
    },
    async clickSaveDraft() {
      const guard = await act("find-save-draft");
      if (!guard.ok) throw new Error(guard.error || "保存为草稿 not found");
      if (guard.forbidden) throw new Error(guard.error || "refusing to click a publish control");
      saveClickedAt = Date.now();
      if (typeof current.click === "function") {
        await current.click('text="保存为草稿"');
        return { ok: true, via: "page.click", label: "保存为草稿" };
      }
      if (typeof current.locator === "function") {
        await current.locator('text="保存为草稿"').click();
        return { ok: true, via: "locator.click", label: "保存为草稿" };
      }
      throw new Error("page.click is required; refusing in-page el.click() for 保存为草稿");
    },
    async saveConfirmed() {
      let last = { ok: false, appmsgid: "", savedTime: "", saved: false };
      for (let index = 0; index < attempts; index += 1) {
        const state = await act("editor-state");
        last = {
          ok: Boolean(state.saved || state.appmsgid),
          appmsgid: state.appmsgid || "",
          savedTime: state.savedTime || "",
          saved: Boolean(state.saved),
        };
        if (last.ok) return last;
        await pause(waitMs);
      }
      return last;
    },
    async listDrafts(kind = "tietu") {
      const value = await token();
      if (!value) throw new Error("贴图 draft list needs the signed-in session");
      await redactGoto(kind === "article" ? articleListUrl({ token: value }) : tietuListUrl({ token: value }));
      const listed = await act("draft-cards");
      return (listed && listed.rows) || [];
    },
    async listArticleDrafts() {
      return this.listDrafts("article");
    },
    async reopen(appmsgid) {
      // Read-only. Open the edit URL and read fields. Do not click 删除, 废弃,
      // 丢弃, 不保存, or any confirm that would discard the draft.
      const id = String(appmsgid || "");
      if (!/^[0-9]+$/.test(id)) throw new Error("贴图 draft id is missing");
      const value = await token();
      if (!value) throw new Error("cannot reopen the 贴图 draft");
      await redactGoto(tietuEditorUrl({ token: value, appmsgid: id }));
      const interval = timings.reopenPollMs ?? waitMs;
      const timeout = timings.reopenTimeoutMs ?? (interval > 0 ? saveTimeoutMs : 0);
      const started = Date.now();
      let ready = false;
      while (!ready) {
        const state = await act("editor-state");
        ready = Boolean(state.editorReady && String(state.title || "").trim());
        if (ready) return act("read-editor");
        if (!(timeout > 0 && interval > 0 && Date.now() - started < timeout)) break;
        await pause(interval);
      }
      throw new Error("贴图 draft editor did not show a title");
    },
    async captureViews(dir, prefix) {
      if (!dir || typeof current.screenshot !== "function") return [];
      const shots = [];
      for (const where of ["top", "middle", "end"]) {
        await act("scroll", { where });
        const file = path.join(dir, `${prefix}-${where}.png`);
        const written = await current.screenshot({ path: file });
        shots.push(written || file);
      }
      return shots;
    },
    async finish() {
      if (finished) return;
      finished = true;
      try {
        await current.evaluate(mpAct, { op: "clear-unload" });
      } catch {
        // Closing must still run when the page is already gone.
      }
      if (task && typeof task.finish === "function") await task.finish({ keep: [] });
    },
  };
}
