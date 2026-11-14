// One 贴图 editor tab. Account probing stays on the shared mp.weixin.qq.com page.
import path from "node:path";
import { mpAct } from "./mp-dom.mjs";
import { tietuAct } from "./tietu-dom.mjs";
import {
  TIETU_FILE_INPUT,
  sessionToken,
  tietuEditorUrl,
  tietuListUrl,
} from "./tietu.mjs";

export function createTietuSession({ task, page, timings = {} } = {}) {
  if (!page) throw new Error("createTietuSession requires a page");
  let current = page;
  let finished = false;
  const attempts = timings.attempts ?? 8;
  const waitMs = timings.waitMs ?? 100;
  const uploadWaitMs = timings.uploadWaitMs ?? 300;
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
    async uploadImages(files) {
      const list = [...(files || [])];
      if (!list.length) throw new Error("--image is required");
      let count = 0;
      for (const file of list) {
        const beforeState = await act("editor-state");
        if ((beforeState.fileInputs || 0) < 2) {
          throw new Error("the 贴图 uploader is the second file input");
        }
        const before = beforeState.imageCount || 0;
        if (typeof current.setInputFiles !== "function") throw new Error("setInputFiles is required");
        await current.setInputFiles(TIETU_FILE_INPUT, [file]);
        let after = before;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          after = (await act("editor-state")).imageCount || 0;
          if (after >= before + 1) break;
          await pause(uploadWaitMs);
        }
        if (after < before + 1) throw new Error(`image thumbnail did not appear (${before} -> ${after})`);
        count = after;
      }
      return { imageCount: count };
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
      const id = String(appmsgid || "");
      if (!/^[0-9]+$/.test(id)) throw new Error("贴图 draft id is missing");
      const value = await token();
      if (!value) throw new Error("cannot reopen the 贴图 draft");
      await redactGoto(tietuEditorUrl({ token: value, appmsgid: id }));
      for (let index = 0; index < attempts; index += 1) {
        const state = await act("editor-state");
        if (state.editorReady) return act("read-editor");
        await pause(waitMs);
      }
      throw new Error("贴图 draft editor did not open");
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
