# Login (zhihu-article)

`check-login` opens `https://www.zhihu.com/` in the Ego task space. It does not open `https://zhuanlan.zhihu.com/write`, so a login check does not create a draft.

## soft-fail

Exit `2`, `login_required: true`, and `how_to_login` / `how_to_login_zh` when:

- `ego-browser` is not on `PATH` or `~/.local/bin`
- the URL is a sign-in page (`/signin`, `/signup`, `/login`)
- a visible 登录 or 注册 control is present and no profile name can be read
- `--expect-account` does not match the one visible name
- the session expires after the flow has started (`error: login-expired`)

Exit `4` when more than one distinct profile name is visible, or the probe says the account is logged in but no name can be read. The skill stops. It does not pick one.

An evaluate error is treated as logged out. The skill does not type a password, paste a cookie, copy a token, or complete a challenge.

## What the human does

1. Open **Ego Lite** (the same profile `ego-browser` drives).
2. Open `https://www.zhihu.com/` and sign in there.
3. Re-run `node scripts/check-login.mjs`. Continue only after exit `0`.

There is no `--keep`. The task space always closes with `finish({ keep: [] })`.

## 登录说明

1. 打开 **Ego Lite**（和 `ego-browser` 同一个配置档）。
2. 在 `https://www.zhihu.com/` 自己登录。
3. 重新跑 `check-login`。退出码 `2` 或 `4` 就停。
