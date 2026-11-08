import { executeSaveDraft } from "./save-flow.mjs";

export function readChannelsEditorState() {
  const app = document.querySelector("wujie-app");
  const root = app && app.shadowRoot ? app.shadowRoot : null;
  if (!root) {
    return {
      readable: false,
      wujie: false,
      description: { ok: false },
      upload: { readable: false, wujie: false },
      cover: { readable: false },
    };
  }
  const editor = root.querySelector(".input-editor");
  const text = String(root.innerText || root.textContent || "");
  const video = root.querySelector("video");
  const poster = video ? String(video.poster || "") : "";
  const coverImage = [...root.querySelectorAll("img")].find((img) => /cover|封面/.test(`${img.className || ""} ${img.alt || ""}`));
  const coverSrc = coverImage ? String(coverImage.currentSrc || coverImage.getAttribute("src") || "") : "";
  const previewChanged = Boolean(coverSrc) && coverSrc !== poster;
  return {
    readable: true,
    wujie: true,
    description: editor ? { ok: true, text: String(editor.innerText || editor.textContent || "") } : { ok: false },
    upload: {
      wujie: true,
      readable: true,
      text,
      progress: /100%/.test(text) ? 100 : null,
      hasPreview: /转发/.test(text) && /赞/.test(text) && /评论/.test(text),
      failed: /上传失败|上传出错|上传异常/.test(text),
    },
    cover: {
      readable: true,
      text,
      spinning: /转圈|上传中/.test(text),
      previewChanged,
      revertedToDefault: Boolean(poster) && coverSrc === poster,
    },
  };
}

export function clickChannelsSaveDraft() {
  const app = document.querySelector("wujie-app");
  const root = app && app.shadowRoot ? app.shadowRoot : document;
  const target = [...root.querySelectorAll("button,a,span,div")].find((el) => String(el.innerText || "").replace(/\s+/g, "") === "保存草稿");
  if (!target) return false;
  target.click();
  return true;
}

export function createChannelsSaveSession(page) {
  return {
    async readFresh() {
      return page.evaluate(readChannelsEditorState);
    },
    async pause() {
      if (typeof page.waitForTimeout === "function") await page.waitForTimeout(500);
    },
    async clickSaveDraft() {
      return page.evaluate(clickChannelsSaveDraft) === true;
    },
  };
}

export async function executeChannelsSave(config, page) {
  return executeSaveDraft(config, createChannelsSaveSession(page));
}
