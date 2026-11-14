// One 贴图 editor tab. Account probing stays on the shared mp.weixin.qq.com page.
import fs from "node:fs";
import path from "node:path";
import { mpAct } from "./mp-dom.mjs";
import { tietuAct } from "./tietu-dom.mjs";
import {
  TIETU_FILE_INPUT,
  TIETU_SAVE_POLL_MS,
  TIETU_SAVE_TIMEOUT_MS,
  TIETU_UPLOAD_POLL_MS,
  TIETU_UPLOAD_TIMEOUT_MS,
  appmsgidFromSave,
  describeFileInputs,
  describeUpload,
  parseSaveResponse,
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
          let after = await probe(watcher.count());
          let decision = uploadAdvanced(before, after);
          while (!decision.ok && timeout > 0 && interval > 0 && Date.now() - started < timeout) {
            await pause(interval);
            after = await probe(watcher.count());
            decision = uploadAdvanced(before, after);
          }
          if (!decision.ok) {
            await failUpload(`image upload was not detected within ${timeout}ms`, before, after);
          }
          count = Math.max(after.imageCount || 0, after.thumbCount || 0);
          uploads.push({
            file: path.basename(String(file || "")),
            via: decision.reasons,
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
    beginSaveWatch() {
      const found = [];
      const handler = async (response) => {
        try {
          const rawUrl = typeof response.url === "function" ? response.url() : String((response && response.url) || "");
          if (rawUrl && !/appmsg|operate_appmsg|masssend|save/i.test(rawUrl)) return;
          let body = null;
          if (response && typeof response.json === "function") body = await response.json();
          else if (response && typeof response.text === "function") body = await response.text();
          const parsed = parseSaveResponse(body);
          if (!parsed.body.appMsgId && parsed.ret == null) return;
          found.push({
            url: redactMpUrl(rawUrl),
            ret: parsed.ret,
            appMsgId: parsed.body.appMsgId || "",
          });
        } catch {
          // A response that is not the save JSON is ignored.
        }
      };
      try {
        if (typeof current.on === "function") current.on("response", handler);
      } catch {
        // This page does not emit network events. The URL and toast remain the other signals.
      }
      return {
        responses() { return found.slice(); },
        stop() {
          try {
            if (typeof current.off === "function") current.off("response", handler);
            else if (typeof current.removeListener === "function") current.removeListener("response", handler);
          } catch {
            // The page may already be gone.
          }
        },
      };
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
      };
      let settled = false;
      while (!settled) {
        const state = await act("editor-state");
        const responses = watch && typeof watch.responses === "function" ? watch.responses() : [];
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
        };
        settled = Boolean(picked.appmsgid) || !(timeout > 0 && interval > 0 && Date.now() - started < timeout);
        if (!settled) await pause(interval);
      }
      if (dir && typeof current.screenshot === "function") {
        const shot = path.join(dir, "tietu-save-confirm.png");
        try {
          await fsImpl.promises.mkdir(dir, { recursive: true });
          const written = await current.screenshot({ path: shot });
          last.screenshot = written || shot;
        } catch (error) {
          last.screenshotError = String(error.message || error);
        }
      }
      return last;
    },
    async clickSaveDraft() {
      const result = await act("click-save-draft");
      if (!result.ok) throw new Error(result.error || "保存为草稿 not found");
      if (result.forbidden) throw new Error(result.error || "refusing to click a publish control");
      return result;
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
    async listDrafts() {
      const value = await token();
      if (!value) throw new Error("贴图 draft list needs the signed-in session");
      await redactGoto(tietuListUrl({ token: value }));
      const listed = await act("draft-cards");
      return (listed && listed.rows) || [];
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
