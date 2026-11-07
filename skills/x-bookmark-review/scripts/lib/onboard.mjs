// One question at a time. Nothing here is inherited from another owner.

import {
  WorkflowError,
  containedFile,
} from "../../../x-bookmark-export/scripts/lib/pure.mjs";
import {
  ensureArchive,
  writeConsent,
  writeJsonAtomic,
} from "../../../x-bookmark-export/scripts/lib/store.mjs";

const CADENCE = new Set(["daily", "few_days", "weekly"]);

function question(id, prompt, promptZh) {
  return { done: false, id, prompt, prompt_zh: promptZh };
}

export function nextOnboardingQuestion(answers) {
  const value = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  if (value.x_connected !== true) {
    return question(
      "x_connection",
      "Connect the authenticated X connector for this bot owner? Reply yes only after the host shows that connection. This skill will not open a browser or call api.x.com.",
      "要为这位 bot 所有者连接已认证的 X 连接器吗？只有宿主显示已连接之后才回答 yes。本技能不会打开浏览器，也不会调用 api.x.com。",
    );
  }
  if (typeof value.goals !== "string" || value.goals.trim().length < 3) {
    return question(
      "goals",
      "What should this bot look for in your bookmarks? Describe your goals and interests in your own words.",
      "你希望这个 bot 从书签里帮你看什么？用你自己的话写下目标和兴趣。",
    );
  }
  if (!CADENCE.has(value.cadence)) {
    return question(
      "cadence",
      "How often should the server-side routine run: daily, few_days, or weekly? This does not install a cron job or a watchdog on the machine.",
      "服务器端例程多久跑一次：daily、few_days，还是 weekly？这不会在本机安装 cron 或看门狗。",
    );
  }
  if (value.cleanup_mode !== "preview" && value.cleanup_mode !== "auto") {
    return question(
      "cleanup_mode",
      "Cleanup stays a preview unless you opt in. Reply preview, or auto if you want to be asked about automatic unbookmarking.",
      "清理默认只做预览。回复 preview；如果你愿意继续确认自动取消书签，回复 auto。",
    );
  }
  const goals = value.goals.trim();
  if (value.cleanup_mode === "preview") {
    return {
      done: true,
      goals,
      cadence: value.cadence,
      cleanup_mode: "preview",
      consent: { cleanup_processed: false, discard_unhelpful: false },
    };
  }
  if (value.auto_processed !== true && value.auto_processed !== false) {
    return question(
      "auto_processed",
      "After a suggestion is actually delivered to you, may the bot unbookmark that processed bookmark? Reply true or false.",
      "建议已经真正交给你之后，是否允许 bot 取消这条已处理书签？回复 true 或 false。",
    );
  }
  if (value.auto_unhelpful !== true && value.auto_unhelpful !== false) {
    return question(
      "auto_unhelpful",
      "May the bot unbookmark a bookmark it archived as clearly unhelpful? Incomplete or uncertain posts stay. Reply true or false.",
      "是否允许 bot 取消它已归档、且判定为明显无帮助的书签？不完整或不确定的帖子会保留。回复 true 或 false。",
    );
  }
  return {
    done: true,
    goals,
    cadence: value.cadence,
    cleanup_mode: "auto",
    consent: {
      cleanup_processed: value.auto_processed === true,
      discard_unhelpful: value.auto_unhelpful === true,
    },
  };
}

export function mergeConsent(current, { processed = null, unhelpful = null } = {}) {
  if (processed == null && unhelpful == null) {
    throw new WorkflowError("invalid_arg", "set cleanup_processed or discard_unhelpful");
  }
  if (processed != null && typeof processed !== "boolean") {
    throw new WorkflowError("invalid_arg", "cleanup_processed must be a boolean");
  }
  if (unhelpful != null && typeof unhelpful !== "boolean") {
    throw new WorkflowError("invalid_arg", "discard_unhelpful must be a boolean");
  }
  return {
    ...current,
    cleanup_processed: processed == null ? current.cleanup_processed === true : processed,
    discard_unhelpful: unhelpful == null ? current.discard_unhelpful === true : unhelpful,
  };
}

export function applyOnboarding(root, accountId, answers, deps = {}) {
  const next = nextOnboardingQuestion(answers);
  if (!next.done) return { ok: true, ...next };
  if (!answers || answers.account_id !== accountId) {
    throw new WorkflowError("account_mismatch", "onboarding answers must name this account and no other owner");
  }
  const paths = ensureArchive(root, accountId, deps);
  const owner = {
    schema: 1,
    account_id: accountId,
    goals: next.goals,
    cadence: next.cadence,
    cleanup_mode: next.cleanup_mode,
    x_connected: true,
  };
  writeJsonAtomic(containedFile(paths.dir, "owner.json"), owner, deps);
  const consent = writeConsent(root, accountId, {
    schema: 1,
    account_id: accountId,
    cleanup_processed: next.consent.cleanup_processed,
    discard_unhelpful: next.consent.discard_unhelpful,
  }, deps);
  return {
    ok: true,
    done: true,
    question: null,
    cadence: next.cadence,
    cleanup_mode: next.cleanup_mode,
    consent: {
      cleanup_processed: consent.cleanup_processed,
      discard_unhelpful: consent.discard_unhelpful,
    },
  };
}
