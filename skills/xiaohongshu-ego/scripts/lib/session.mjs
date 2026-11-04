import { creatorAct, COVER_INPUT_SELECTOR, VIDEO_INPUT_SELECTOR } from "./creator-dom.mjs";
import {
  coverReplacedFirstFrame,
  editPageFailed,
  editSettled,
  pickNote,
  publishSucceeded,
  uploadReady,
} from "./pure.mjs";

export function createCreatorSession({ task, page, pageName = "p1", keep = false, timings = {} } = {}) {
  if (!task || !page) throw new Error("createCreatorSession requires task and page");
  let finished = false;
  const uploadAttempts = timings.uploadAttempts ?? 40;
  const coverAttempts = timings.coverAttempts ?? 8;
  const waitMs = timings.waitMs ?? 500;

  const finishWith = async (names) => {
    if (finished) return;
    finished = true;
    await task.finish({ keep: names });
  };

  async function evalAct(payload) {
    const result = await page.evaluate(creatorAct, payload);
    return result || { ok: false, error: "empty evaluate result" };
  }

  async function pause(ms) {
    if (ms && typeof page.waitForTimeout === "function") await page.waitForTimeout(ms);
  }

  return {
    spaceId: task.spaceId,
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try {
        if (typeof page.waitForLoadState === "function") {
          await page.waitForLoadState("networkidle", { timeout: 8_000 });
        }
      } catch {
        // The creator site keeps sockets open after the shell is ready.
      }
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(800);
    },
    async probe() {
      return evalAct({ op: "probe" });
    },
    async detect() {
      let url = "";
      let title = "";
      try { url = await page.url(); } catch { url = ""; }
      try { title = await page.title(); } catch { title = ""; }
      try {
        const probed = await this.probe();
        return {
          url: (probed && probed.url) || url,
          title: (probed && probed.title) || title,
          text: (probed && probed.text) || "",
          nickname: (probed && probed.nickname) || "",
          loginWall: Boolean(probed && probed.loginWall),
          creatorChrome: Boolean(probed && probed.creatorChrome),
          evaluateError: probed && probed.ok === false ? probed.error : "",
        };
      } catch (error) {
        return {
          url,
          title,
          text: "",
          nickname: "",
          loginWall: false,
          creatorChrome: false,
          evaluateError: String(error && error.message ? error.message : error),
        };
      }
    },
    async coverState() {
      const state = await evalAct({ op: "cover-state" });
      const count = state && typeof state.coverCount === "number" ? state.coverCount : null;
      return {
        pkApplied: Boolean(state && state.pkApplied),
        coverCount: count,
        counterText: state && state.counterText ? String(state.counterText) : "",
        cropDialog: Boolean(state && state.cropDialog),
        previewSignature: state && state.previewSignature ? String(state.previewSignature) : "",
        previewText: state && state.previewText ? String(state.previewText) : "",
        text: state && state.text ? String(state.text) : "",
      };
    },
    async setInputFiles(selector, file) {
      if (typeof page.setInputFiles !== "function") throw new Error("page.setInputFiles is required");
      await page.setInputFiles(selector, file);
    },
    async setVideo(file) {
      const found = await evalAct({ op: "video-input" });
      if (!found.ok) throw new Error(found.error || "video file input not found");
      await this.setInputFiles(VIDEO_INPUT_SELECTOR, file);
      return found;
    },
    async setCover(file) {
      let found = await evalAct({ op: "cover-input" });
      if (!found.ok) {
        const revealed = await evalAct({ op: "reveal-cover" });
        if (revealed && revealed.ok) found = await evalAct({ op: "cover-input" });
      }
      if (!found.ok) throw new Error(found.error || "PK cover file input not found");
      await this.setInputFiles(COVER_INPUT_SELECTOR, file);
      return found;
    },
    async waitUpload() {
      let last = "";
      for (let i = 0; i < uploadAttempts; i += 1) {
        const probe = await this.probe();
        last = (probe && probe.text) || "";
        if (uploadReady(last)) return { ok: true, text: last };
        await pause(waitMs);
      }
      throw new Error("video upload did not finish");
    },
    async waitCoverApplied(before) {
      let last = null;
      for (let i = 0; i < coverAttempts; i += 1) {
        last = await this.coverState();
        if (coverReplacedFirstFrame(before, last)) return { ok: true, state: last };
        await pause(waitMs);
      }
      const error = new Error("PK cover was not confirmed (missing toast 「已添加 PK 封面」 or the counter did not advance, for example 0/3 → 1/3)");
      error.state = last;
      throw error;
    },
    async fillTitle(title) {
      const result = await evalAct({ op: "fill-title", title });
      if (!result.ok) throw new Error(result.error || "title field not found");
      return result;
    },
    async fillBody(body) {
      const result = await evalAct({ op: "fill-body", body });
      if (!result.ok) throw new Error(result.error || "description field not found");
      return result;
    },
    async clickPublish() {
      const result = await evalAct({ op: "click-publish" });
      if (!result.ok) throw new Error(result.error || "发布 button not found");
      return result;
    },
    async waitEditSettled() {
      let last = { url: "", text: "" };
      for (let i = 0; i < uploadAttempts; i += 1) {
        let url = "";
        try { url = await page.url(); } catch { url = ""; }
        const probe = await this.probe();
        last = { url: (probe && probe.url) || url, text: (probe && probe.text) || "" };
        if (editPageFailed(last.text)) {
          const error = new Error("edit page shows 加载失败");
          error.state = last;
          throw error;
        }
        if (editSettled(last)) return { ok: true, url: last.url, text: last.text };
        await pause(waitMs);
      }
      throw new Error("edit publish did not settle");
    },
    async waitSuccess() {
      let lastUrl = "";
      let lastText = "";
      for (let i = 0; i < uploadAttempts; i += 1) {
        let url = "";
        try { url = await page.url(); } catch { url = ""; }
        const probe = await this.probe();
        lastUrl = (probe && probe.url) || url;
        lastText = (probe && probe.text) || "";
        if (publishSucceeded({ url: lastUrl, text: lastText })) return { ok: true, url: lastUrl, text: lastText };
        await pause(waitMs);
      }
      throw new Error("publish success page did not appear");
    },
    async readNote(title) {
      const result = await evalAct({ op: "note-cards" });
      if (!result.ok) throw new Error(result.error || "note cards were not readable");
      return pickNote(result.cards, title);
    },
    async handOff() {
      if (typeof task.handOff === "function") await task.handOff();
    },
    finish() {
      return finishWith(keep ? [pageName] : []);
    },
    cleanup() {
      return finishWith([]);
    },
  };
}
