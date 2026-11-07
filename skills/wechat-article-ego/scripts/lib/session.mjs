// Node-side adapter around one Ego page. Browser DOM work goes through mpAct.
import path from "node:path";
import { mpAct } from "./mp-dom.mjs";

export function createMpSession({ task, page, timings = {} } = {}) {
  if (!task || !page) throw new Error("createMpSession requires task and page");
  let current = page;
  let finished = false;
  const attempts = timings.attempts ?? 8;
  const waitMs = timings.waitMs ?? 250;

  async function pause(ms) {
    if (ms && current && typeof current.waitForTimeout === "function") await current.waitForTimeout(ms);
  }

  async function act(op, extra = {}) {
    const result = await current.evaluate(mpAct, { op, ...extra });
    return result || { ok: false, error: "empty evaluate result" };
  }

  async function adopt(popup) {
    if (!popup) return false;
    const label = popup.label || (popup.page && popup.page.label);
    if (label && typeof task.page === "function") {
      current = task.page(label);
      return true;
    }
    if (typeof popup.goto === "function" || typeof popup.evaluate === "function") {
      current = popup;
      return true;
    }
    return false;
  }

  return {
    get page() {
      return current;
    },
    spaceId: task.spaceId,
    act,
    async goto(url) {
      await current.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try {
        if (typeof current.waitForLoadState === "function") {
          await current.waitForLoadState("networkidle", { timeout: 8_000 });
        }
      } catch {
        // The console keeps requests open after the shell is ready.
      }
    },
    async probe() {
      try {
        return await act("probe");
      } catch (error) {
        return { ok: false, loginWall: true, loggedIn: false, accounts: [], error: String(error.message || error) };
      }
    },
    async openEditor() {
      const ready = await act("probe");
      if (ready.editorReady) return ready;
      const created = await act("click", { text: "新的创作", required: true });
      if (!created.ok) throw new Error(created.error || "新的创作 not found");
      await pause(waitMs);
      const popupPromise = typeof current.waitForEvent === "function"
        ? current.waitForEvent("popup", { timeout: 2_000 }).catch(() => null)
        : Promise.resolve(null);
      const article = await act("click", { text: "文章", required: true });
      if (!article.ok) throw new Error(article.error || "文章 not found");
      await adopt(await popupPromise);
      for (let index = 0; index < attempts; index += 1) {
        const probe = await act("probe");
        if (probe.editorReady) return probe;
        await pause(waitMs);
      }
      throw new Error("article editor did not open");
    },
    async fillTitle(title) {
      const marked = await act("title-field");
      if (marked.ok && typeof current.fill === "function") {
        await current.fill(marked.selector, title);
        return { ok: true, via: "fill" };
      }
      const set = await act("set-title", { value: title });
      if (!set.ok) throw new Error(set.error || "title field not found");
      return set;
    },
    async fillOptional(op, value) {
      if (!value) return { ok: true, skipped: true };
      const set = await act(op, { value });
      if (!set.ok) return { ok: true, skipped: true, reason: set.error || "field missing" };
      return set;
    },
    async pasteHtml(html, text) {
      const focused = await act("focus-body");
      if (!focused.ok) throw new Error(focused.error || "editor body not found");
      if (!current.keyboard || typeof current.keyboard.paste !== "function") {
        throw new Error("keyboard.paste is required for the rich-text editor");
      }
      await current.keyboard.paste({ text: text || "", html: html || "" });
      return { ok: true };
    },
    async imageCount() {
      const result = await act("image-count");
      return result && typeof result.imageCount === "number" ? result.imageCount : 0;
    },
    async uploadImage(file) {
      const before = await this.imageCount();
      const chooserPromise = typeof current.waitForFileChooser === "function"
        ? current.waitForFileChooser({ timeout: 4_000 }).catch(() => null)
        : Promise.resolve(null);
      await act("open-image");
      const chooser = await chooserPromise;
      if (chooser && typeof chooser.setFiles === "function") {
        await chooser.setFiles(file);
      } else if (typeof current.setInputFiles === "function") {
        const input = await act("image-input");
        if (!input.ok) throw new Error(input.error || "image upload control not found");
        await current.setInputFiles(input.selector, [file]);
      } else {
        throw new Error("no supported file upload API");
      }
      await act("confirm-image");
      let after = before;
      for (let index = 0; index < attempts; index += 1) {
        after = await this.imageCount();
        if (after >= before + 1) return { before, after };
        await pause(waitMs);
      }
      throw new Error(`image did not appear in the editor (${before} -> ${after})`);
    },
    async ensureCover(file) {
      const state = await act("cover-state");
      if (!state.present || state.filled) return { ok: true, skipped: true, reason: state.filled ? "cover already set" : "no cover control" };
      const fromBody = await act("cover-from-body");
      if (fromBody.ok) return { ok: true, via: "body" };
      if (state.selector && file && typeof current.setInputFiles === "function") {
        await current.setInputFiles(state.selector, [file]);
        await act("confirm-image");
        return { ok: true, via: "upload" };
      }
      if (state.empty) return { ok: false, error: "cover is empty and no supported control" };
      return { ok: true, skipped: true, reason: "cover not required" };
    },
    async readEditor() {
      return act("read-editor");
    },
    async clickSave() {
      const result = await act("click-save");
      if (!result.ok) throw new Error(result.error || "保存 control not found");
      if (result.forbidden) throw new Error(result.error || "refusing to click a publish control");
      return result;
    },
    async saveConfirmed() {
      for (let index = 0; index < attempts; index += 1) {
        const probe = await act("probe");
        if (/保存成功|已保存|保存草稿成功/.test(probe.text || "")) return true;
        await pause(waitMs);
      }
      return false;
    },
    async listDrafts() {
      await act("click", { text: "草稿箱" });
      await pause(waitMs);
      const listed = await act("draft-rows");
      return listed.rows || [];
    },
    async openDraft(title) {
      const opened = await act("click", { text: title, required: true });
      if (!opened.ok) throw new Error(opened.error || "draft row not found");
      for (let index = 0; index < attempts; index += 1) {
        const probe = await act("probe");
        if (probe.editorReady) return probe;
        await pause(waitMs);
      }
      throw new Error("draft editor did not open");
    },
    async openPreview() {
      const state = await act("preview-state");
      if (state.pane) return { ok: true, kind: "pane" };
      if (!state.button) return { ok: false, skipped: true };
      const clicked = await act("click-preview");
      if (!clicked.ok) return { ok: false, skipped: true, error: clicked.error };
      return { ok: true, kind: "dialog" };
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
        await act("clear-unload");
      } catch {
        // Closing must still run when the page is already gone.
      }
      await task.finish({ keep: [] });
    },
  };
}
