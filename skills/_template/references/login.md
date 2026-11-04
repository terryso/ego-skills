# Login (__SKILL_ID__)

TEMPLATE. Replace `https://example.com/login` with the real site. This skill checks its own login. Do not add a separate cookie-healthcheck skill.

## soft-fail

`login_required: true`, exit code `2`, plus `how_to_login` / `how_to_login_zh`. The agent **stops**, shows the steps, and does not type a password, automate a QR scan, or paste cookies.

Replace these signals:

- Logged out: URL is still the login page, or the page is a QR / sign-in wall.
- Logged in: the login page is gone and the product chrome (or a documented logged-in signal) is visible.

## What the human does

1. Open **Ego Lite** (the same profile `ego-browser` drives).
2. Open the site and sign in there. Scan a QR code yourself when the site asks for one.
3. Re-run `node scripts/check-login.mjs`. Continue only after exit `0`.

Optional: `--keep` leaves the window up so a person can sign in. The template does not call `handOff()` until you wire a real ego session.

## 登录说明

1. 打开 **Ego Lite**（和 `ego-browser` 同一个配置档）。
2. 在站点里自己登录。要扫码时由人扫，技能不代扫。
3. 重新跑 `check-login`，退出码 `0` 再继续。退出码 `2` 就停。
