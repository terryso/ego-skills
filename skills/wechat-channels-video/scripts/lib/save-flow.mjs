// The only supported 保存草稿 click. It re-reads the editor, then decides.
// A missing or unfinished read never reaches the click.
import {
  CHANNELS_COVER_WAIT_LIMIT,
  CHANNELS_UPLOAD_WAIT_LIMIT,
  coverPreviewDecision,
  descriptionReadbackOk,
  maySaveDraft,
  uploadProbeDecision,
} from "./pure.mjs";

export function saveDraftControl(labels) {
  const names = (Array.isArray(labels) ? labels : []).map((label) => String(label || "").replace(/\s+/g, "").trim());
  if (!names.includes("保存草稿")) return { ok: false, reason: "save-control-missing" };
  if (names.some((label) => label === "保存草稿" && /发表|发布/.test(label))) {
    return { ok: false, reason: "refusing-publish" };
  }
  return { ok: true, label: "保存草稿" };
}

function closed(reason, extra = {}) {
  return { ok: false, save: false, publish: false, clicked: false, reason, ...extra };
}

export async function saveDraftFlow(session, input = {}) {
  if (!session || typeof session.readFresh !== "function" || typeof session.clickSaveDraft !== "function") {
    return closed("missing-session");
  }
  const uploadLimit = CHANNELS_UPLOAD_WAIT_LIMIT;
  const coverLimit = CHANNELS_COVER_WAIT_LIMIT;
  let stableCount = 0;
  const decorate = (fresh) => {
    const upload = fresh && fresh.upload && typeof fresh.upload === "object" ? { ...fresh.upload } : fresh && fresh.upload;
    if (upload && typeof upload === "object") {
      const readyLook = upload.failed !== true
        && (upload.progress === 100 || upload.progress === "100%")
        && upload.hasPreview === true;
      stableCount = readyLook ? stableCount + 1 : 0;
      upload.stableCount = stableCount;
    }
    return fresh && typeof fresh === "object" ? { ...fresh, upload } : fresh;
  };

  let fresh;
  try {
    for (let attempt = 1; attempt <= uploadLimit; attempt += 1) {
      fresh = decorate(await session.readFresh());
      const upload = uploadProbeDecision(fresh && fresh.upload, { attempt });
      if (upload.action !== "retry") break;
      if (typeof session.pause === "function") await session.pause();
    }
    if (input.coverRequested) {
      for (let attempt = 1; attempt <= coverLimit; attempt += 1) {
        fresh = decorate(await session.readFresh());
        const cover = coverPreviewDecision(fresh && fresh.cover, { attempt });
        if (cover.action !== "retry") break;
        if (typeof session.pause === "function") await session.pause();
      }
    }
    fresh = decorate(await session.readFresh());
  } catch (error) {
    return closed("unreadable", { error: String(error.message || error) });
  }
  if (!fresh || typeof fresh !== "object") return closed("missing-state");

  const description = descriptionReadbackOk(fresh.description, input.expected);
  const upload = uploadProbeDecision(fresh.upload, { attempt: uploadLimit });
  const cover = input.coverRequested
    ? coverPreviewDecision(fresh.cover, { attempt: coverLimit })
    : coverPreviewDecision({ requested: false });
  const decision = maySaveDraft({ description, upload, cover });
  if (decision.save !== true || decision.publish !== false) {
    return { ...decision, publish: false, clicked: false };
  }
  let clicked = false;
  try {
    clicked = await session.clickSaveDraft() === true;
  } catch (error) {
    return closed("click-failed", { error: String(error.message || error) });
  }
  if (!clicked) return closed("not-clicked");
  return { ...decision, publish: false, clicked: true, save: true, ok: true };
}

export async function executeSaveDraft(config, session) {
  if (!config || config.yes !== true) {
    return { ...closed("confirmation-required"), exitCode: 3 };
  }
  if (!config.desc || !String(config.desc).trim()) {
    return { ...closed("missing-expected"), exitCode: 1 };
  }
  const result = await saveDraftFlow(session, {
    expected: { desc: config.desc, tags: config.tags || "" },
    coverRequested: Boolean(config.coverRequested),
  });
  return { ...result, exitCode: result.clicked === true ? 0 : 1 };
}
