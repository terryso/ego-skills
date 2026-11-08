import { executeSaveDraft } from "./save-flow.mjs";

export function readChannelsEditorState() {
  const boxOf = (el) => {
    if (!el || typeof el.getBoundingClientRect !== "function") return { width: 0, height: 0 };
    const box = el.getBoundingClientRect() || {};
    return { width: Number(box.width) || 0, height: Number(box.height) || 0 };
  };
  const shown = (el) => {
    const box = boxOf(el);
    return box.width > 0 && box.height > 0;
  };
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
  // ShadowRoot has no innerText. textContent includes the stylesheet, which
  // contains "100%" and hidden .cover icons. Read the visible post surface.
  const surface = root.querySelector(".main-body") || root.querySelector(".form");
  const text = String((surface && (surface.innerText || surface.textContent)) || "");
  const editor = root.querySelector(".input-editor");
  const video = [...root.querySelectorAll("video")].find(shown) || null;
  const coverImage = [...root.querySelectorAll("img")].find((img) => {
    return shown(img) && /cover-img|封面/.test(`${img.className || ""} ${img.alt || ""}`);
  });
  const coverSrc = coverImage ? String(coverImage.currentSrc || coverImage.getAttribute("src") || "") : "";
  const wrap = root.querySelector(".cover-preview-wrap");
  if (wrap && coverSrc && !String(wrap.getAttribute("data-cover-baseline") || "")) {
    wrap.setAttribute("data-cover-baseline", coverSrc);
  }
  const baseline = wrap ? String(wrap.getAttribute("data-cover-baseline") || "") : "";
  const previewChanged = Boolean(coverSrc) && Boolean(baseline) && coverSrc !== baseline;
  const failed = /上传失败|上传出错|上传异常/.test(text);
  const previewWords = /转发/.test(text) && /赞/.test(text) && /评论/.test(text);
  const finished = Boolean(video) && previewWords && !failed;
  return {
    readable: true,
    wujie: true,
    description: editor ? { ok: true, text: String(editor.innerText || editor.textContent || "") } : { ok: false },
    upload: {
      wujie: true,
      readable: true,
      text,
      progress: (/100%/.test(text) || finished) ? 100 : null,
      hasPreview: finished,
      failed,
    },
    cover: {
      readable: true,
      text,
      spinning: /转圈|上传中/.test(text),
      previewChanged,
      revertedToDefault: Boolean(baseline) && coverSrc === baseline && wrap.getAttribute("data-cover-replaced") === "1",
    },
  };
}

export function locateChannelsSaveDraft() {
  const shown = (el) => {
    if (!el || typeof el.getBoundingClientRect !== "function") return true;
    const box = el.getBoundingClientRect() || {};
    return (Number(box.width) || 0) > 0 && (Number(box.height) || 0) > 0;
  };
  const app = document.querySelector("wujie-app");
  const root = app && app.shadowRoot ? app.shadowRoot : document;
  const target = [...root.querySelectorAll("button,a,span,div")].find((el) => {
    return shown(el) && String(el.innerText || "").replace(/\s+/g, "") === "保存草稿";
  });
  if (!target) return null;
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  const box = typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
  return { x: Number(box.x || 0) + Number(box.width || 0) / 2, y: Number(box.y || 0) + Number(box.height || 0) / 2 };
}

export function clickChannelsSaveDraft() {
  const shown = (el) => {
    if (!el || typeof el.getBoundingClientRect !== "function") return true;
    const box = el.getBoundingClientRect() || {};
    return (Number(box.width) || 0) > 0 && (Number(box.height) || 0) > 0;
  };
  const app = document.querySelector("wujie-app");
  const root = app && app.shadowRoot ? app.shadowRoot : document;
  const target = [...root.querySelectorAll("button,a,span,div")].find((el) => {
    return shown(el) && String(el.innerText || "").replace(/\s+/g, "") === "保存草稿";
  });
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
      const spot = await page.evaluate(locateChannelsSaveDraft);
      if (spot && page.mouse && typeof page.mouse.click === "function") {
        await page.mouse.click(spot.x, spot.y);
      } else if (await page.evaluate(clickChannelsSaveDraft) !== true) {
        return false;
      }
      if (typeof page.waitForTimeout !== "function") return false;
      for (let i = 0; i < 8; i += 1) {
        await page.waitForTimeout(500);
        const saved = await page.evaluate(() => {
          const app = document.querySelector("wujie-app");
          const root = app && app.shadowRoot;
          if (!root) return false;
          return [...root.querySelectorAll("div,span")].some((el) => {
            if (String(el.innerText || "").replace(/\s+/g, "") !== "已保存") return false;
            if (typeof el.getBoundingClientRect !== "function") return false;
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          });
        });
        if (saved) return true;
      }
      return false;
    },
  };
}

export async function executeChannelsSave(config, page) {
  return executeSaveDraft(config, createChannelsSaveSession(page));
}
