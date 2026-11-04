// Pure helpers for __SKILL_ID__. No browser, no process.exit.
// TEMPLATE — replace EXAMPLE login URL and the classifier before shipping.

export const SKILL_ID = "__SKILL_ID__";
export const LOGIN_URL = "https://example.com/login";

export const HOW_TO_LOGIN = [
  "Open the Ego Lite app (the same profile ego-browser drives).",
  `Visit ${LOGIN_URL} and sign in as yourself. Scan any QR code yourself.`,
  "Leave Ego logged in, then re-run this skill's login-check.",
];

export const HOW_TO_LOGIN_ZH = [
  "打开 Ego Lite（ego-browser 驱动的同一个配置档）。",
  `访问 ${LOGIN_URL}，用你自己的账号登录。二维码请人自己扫。`,
  "保持 Ego 登录，再重新跑 login-check。",
];

export const LOGIN_TIP =
  "Tell the user: this skill needs a logged-in Ego Lite session. If login-check exits 2, ask them to sign in inside Ego. Never type a password or paste cookies.";

export const LOGIN_TIP_ZH =
  "请告诉用户：这个技能需要 Ego Lite 里已经登录的会话。login-check 退出码为 2 时，请人在 Ego 里登录后再跑。不要代填密码，不要粘贴 Cookie。";

export const USAGE = `${SKILL_ID} — TEMPLATE login-check via Ego Lite

Replace this usage text. Missing ego-browser soft-fails (exit 2).

  node scripts/check-login.mjs
  node scripts/check-login.mjs --keep
`;

export function strip(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") delete obj[key];
  }
  return obj;
}

export function parseCheckArgs(argv) {
  const out = { keep: false, help: false, taskName: `${SKILL_ID}-login-check` };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--task-name") out.taskName = String(argv[++i] || out.taskName);
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

/** Stub classifier. Replace URL and copy checks with the real site. */
export function classifyLogin({ url = "", title = "", text = "", signals = {} } = {}) {
  const u = String(url || "");
  const blob = `${title}\n${text}`;
  const onLoginPage = /\/login(?:\.html)?(?:\?|$)/i.test(u);
  const loginCopy = /sign in|log in|登录|扫码/i.test(blob);
  const platformHint = Boolean(signals.platformChrome) || Boolean(signals.loggedIn);
  const loggedIn = !onLoginPage && platformHint && !loginCopy;
  return strip({
    skill: SKILL_ID,
    logged_in: loggedIn,
    login_required: !loggedIn,
    on_login_page: onLoginPage,
    url: u || undefined,
    title: title || undefined,
  });
}

export function egoMissingSummary() {
  return strip({
    skill: SKILL_ID,
    command: "check-login",
    ok: false,
    logged_in: false,
    login_required: true,
    exitCode: 2,
    error: "ego-browser not found on PATH",
    login_tip: LOGIN_TIP,
    login_tip_zh: LOGIN_TIP_ZH,
    how_to_login: [
      "Install Ego Lite, then ensure `ego-browser` is on PATH.",
      ...HOW_TO_LOGIN,
    ],
    how_to_login_zh: [
      "先安装 Ego Lite，并把 ego-browser 放进 PATH。",
      ...HOW_TO_LOGIN_ZH,
    ],
  });
}

/**
 * Help → 0. Missing ego-browser → 2 with how_to_login.
 * Ego present but the probe is still the template → 1, so nobody treats the scaffold as a finished login check.
 */
export function checkLoginOutcome({ help, egoPresent }) {
  if (help) return { code: 0, stream: "stdout", text: USAGE };
  if (!egoPresent) {
    return {
      code: 2,
      stream: "stdout",
      text: `${JSON.stringify(egoMissingSummary(), null, 2)}\n`,
    };
  }
  return {
    code: 1,
    stream: "stdout",
    text: `${JSON.stringify({
      skill: SKILL_ID,
      ok: false,
      exitCode: 1,
      error: "TEMPLATE: replace scripts/check-login.mjs with a real ego-browser login probe before shipping.",
    })}\n`,
  };
}
