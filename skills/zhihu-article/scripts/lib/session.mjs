// Node-side adapter around one Ego page. DOM work goes through zhihuAct.
import fs from "node:fs";
import path from "node:path";
import { zhihuAct } from "./dom.mjs";
import { normalizeText } from "./pure.mjs";

export function createZhihuSession({ task, page, timings = {}, fsImpl = fs } = {}) {
  if (!task || !page) throw new Error("createZhihuSession requires task and page");
  let finished = false;
  let draftClicked = false;
  const uploadAttempts = timings.uploadAttempts ?? 20;
  const autosaveAttempts = timings.autosaveAttempts ?? 20;
  const waitMs = timings.waitMs ?? 500;
  const navigationMs = timings.navigationMs ?? 45_000;

  async function pause(ms) {
    if (ms && page && typeof page.waitForTimeout === "function") await page.waitForTimeout(ms);
  }

  async function act(op, extra = {}) {
    const result = await page.evaluate(zhihuAct, { op, ...extra });
    return result || { ok: false, error: "empty evaluate result" };
  }

  async function currentUrl() {
    try {
      if (typeof page.url === "function") return await page.url();
    } catch {
      return "";
    }
    return "";
  }

  async function readEditor() {
    try {
      const described = await act("read");
      if (!described.ok) return described;
      const url = described.url || await currentUrl();
      return { ...described, url };
    } catch (error) {
      return { ok: false, evaluateFailed: true, loginWall: false, loggedIn: false, accounts: [], error: String(error.message || error) };
    }
  }

  async function pollCount(before, readCount) {
    let last = before;
    for (let attempt = 0; attempt < uploadAttempts; attempt += 1) {
      const read = await readEditor();
      last = readCount(read);
      if (last >= before + 1) return { ok: true, submitted: true, value: last };
      await pause(waitMs);
    }
    return { ok: false, submitted: true, code: "upload-timeout", error: "upload timed out", value: last };
  }

  return {
    spaceId: task.spaceId,
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationMs });
      try {
        if (typeof page.waitForLoadState === "function") {
          await page.waitForLoadState("networkidle", { timeout: 8_000 });
        }
      } catch {
        // Zhihu keeps requests open after the shell is ready.
      }
    },
    async probe() {
      try {
        const described = await act("probe");
        if (!described || described.ok === false) {
          return {
            ok: false,
            evaluateFailed: true,
            loginWall: false,
            loggedIn: false,
            accounts: [],
            error: (described && described.error) || "empty evaluate result",
          };
        }
        return described;
      } catch (error) {
        return {
          ok: false,
          evaluateFailed: true,
          loginWall: false,
          loggedIn: false,
          accounts: [],
          error: String(error.message || error),
        };
      }
    },
    async pause() {
      await pause(waitMs);
    },
    readEditor,
    async fillTitle(title) {
      const marked = await act("mark-title");
      if (!marked.ok) return marked;
      if (typeof page.fill === "function") {
        try {
          await page.fill(marked.selector, title);
        } catch (error) {
          return { ok: false, error: `title fill failed: ${error.message || error}` };
        }
      } else if (page.keyboard && typeof page.keyboard.insertText === "function") {
        const focused = await act("focus-title");
        if (!focused.ok) return focused;
        await page.keyboard.insertText(title);
      } else {
        const set = await act("set-title", { value: title });
        if (!set.ok) return set;
      }
      const read = await readEditor();
      if (!read.ok) return { ok: false, error: read.error || "title read failed" };
      if (normalizeText(read.title) !== normalizeText(title)) {
        return {
          ok: false,
          error: "title readback mismatch",
          observed: read.title || "",
          draftId: read.draftId || "",
          autosaveLabel: read.autosaveLabel || "",
        };
      }
      return { ok: true, draftId: read.draftId || "", autosaveLabel: read.autosaveLabel || "" };
    },
    async pasteBody(html, text) {
      const marked = await act("mark-body");
      if (!marked.ok) return marked;
      const focused = await act("focus-body");
      if (!focused.ok) return focused;
      if (!page.keyboard || typeof page.keyboard.paste !== "function") {
        return { ok: false, error: "keyboard.paste is required" };
      }
      await page.keyboard.paste({ text: text || "", html: html || "" });
      return { ok: true };
    },
    async uploadBodyImage(file) {
      const beforeRead = await readEditor();
      const before = beforeRead && typeof beforeRead.imageCount === "number" ? beforeRead.imageCount : 0;
      const marked = await act("mark-image-input");
      if (!marked.ok) return { ok: false, submitted: false, code: "image-control-missing", error: marked.error || "image input not found" };
      if (typeof page.setInputFiles !== "function") {
        return { ok: false, submitted: false, code: "upload-api-missing", error: "setInputFiles is required" };
      }
      try {
        await page.setInputFiles(marked.selector, [file]);
      } catch (error) {
        return { ok: false, submitted: false, code: "upload-failed", error: String(error.message || error) };
      }
      const polled = await pollCount(before, (read) => (read && typeof read.imageCount === "number" ? read.imageCount : before));
      if (!polled.ok) return { ...polled, error: "image did not appear before timeout" };
      return { ok: true, submitted: true, imageCount: polled.value };
    },
    async uploadCover(file) {
      const marked = await act("mark-cover-input");
      if (!marked.ok) return { ok: false, submitted: false, code: "cover-control-missing", error: marked.error || "cover input not found" };
      if (typeof page.setInputFiles !== "function") {
        return { ok: false, submitted: false, code: "upload-api-missing", error: "setInputFiles is required" };
      }
      try {
        await page.setInputFiles(marked.selector, [file]);
      } catch (error) {
        return { ok: false, submitted: false, code: "upload-failed", error: String(error.message || error) };
      }
      for (let attempt = 0; attempt < uploadAttempts; attempt += 1) {
        const read = await readEditor();
        if (read && read.coverApplied) return { ok: true, submitted: true, coverApplied: true };
        await pause(waitMs);
      }
      return { ok: false, submitted: true, code: "upload-timeout", error: "cover preview did not appear before timeout" };
    },
    async clickDraftSave() {
      if (draftClicked) return { ok: false, duplicate: true, clicked: false, error: "draft save already clicked" };
      const marked = await act("mark-draft-save");
      if (!marked.ok) return { ok: false, clicked: false, error: marked.error || "explicit draft control not found" };
      if (marked.forbidden) return { ok: false, forbidden: true, clicked: false, error: marked.error || "publish-refused" };
      draftClicked = true;
      const clicked = await act("click-draft-save");
      if (!clicked.ok) return { ...clicked, clicked: false };
      return clicked;
    },
    async waitForSavedDraft() {
      let last = { ok: false, draftId: "", autosaveLabel: "", published: false, draftAmbiguous: false };
      for (let attempt = 0; attempt < autosaveAttempts; attempt += 1) {
        last = await readEditor();
        if (last.published || last.draftAmbiguous) return last;
        if (last.draftId && last.autosaveLabel) return last;
        await pause(waitMs);
      }
      return { ...last, timedOut: true, code: "autosave-timeout" };
    },
    async capture(dir, state) {
      if (!dir || typeof page.screenshot !== "function") return "";
      const safe = String(state || "probe").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "probe";
      const file = path.join(dir, `zhihu-article-${safe}.png`);
      if (!path.isAbsolute(file)) return "";
      try {
        await fsImpl.promises.mkdir(dir, { recursive: true });
        // ego-browser writes the PNG itself and returns the path. `type` is not a valid option.
        const written = await page.screenshot({ path: file });
        if (Buffer.isBuffer(written)) {
          await fsImpl.promises.writeFile(file, written);
          return file;
        }
        if (typeof written === "string" && written) return written;
        return file;
      } catch {
        return "";
      }
    },
    async finish() {
      if (finished) return;
      finished = true;
      if (typeof task.finish === "function") await task.finish({ keep: [] });
    },
  };
}
