# Login (zhihu-article)

`check-login` opens `https://www.zhihu.com/` in the Ego task space. It does not open `https://zhuanlan.zhihu.com/write`, so a login check does not create a draft.

## soft-fail

Exit `2`, `login_required: true`, and `how_to_login` / `how_to_login_zh` when:

- `ego-browser` is not on `PATH` or `~/.local/bin`
- the URL is a sign-in page (`/signin`, `/signup`, `/login`)
- a visible 登录 or 注册 control is present, and the header shows neither a profile name nor logged-in chrome (创作中心 / 私信 / 消息 / avatar)
- `--expect-account` does not match the one visible name
- the session expires after the flow has started (`error: login-expired`)

The signed-in name comes from the top identity control: a `header`, a `banner`, an element whose class token is `AppHeader`, or an avatar whose class contains `AppHeader-profileAvatar`. `AppHeader-zhihuLogo` is the logo and is not an identity root. `alt`, `aria-label`, `title`, and the control text match `点击打开<name>的主页` with optional spaces. Feed authors are ignored.

On `zhuanlan.zhihu.com/write` the bar may not say 创作中心, 私信, or 消息. A visible title field, one `public-DraftEditor-content` body, and that avatar still count as logged in. An evaluate failure is `probe-failed`, not a login wall. A real sign-in URL after the write page opens is `login-expired`. A verification page is `challenge`. The failure result includes `pageUrl`, `pageTitle`, and a screenshot when a directory is available. Opening `/write` can make Zhihu show `刚刚 · 草稿` before this skill types; that is not `draft-saved`.

Exit `4` with `ambiguous-account` only when that identity surface itself shows more than one name. Exit `4` with `identity-not-visible` when the page is logged in (创作中心, 私信, 消息, or a header avatar) but no unique name can be read. `--expect-account` is compared only with that unique name. A correct name still fails when the header does not show it. Feed authors never create `ambiguous-account`.

Exit `4` is not a login wall. Do not ask the person to sign in again solely because the nickname is absent.

An evaluate error is treated as logged out. The skill does not type a password, paste a cookie, copy a token, or complete a challenge.

## What the human does

1. Open **Ego Lite** (the same profile `ego-browser` drives).
2. Open `https://www.zhihu.com/` and sign in there.
3. Re-run `node scripts/check-login.mjs`. Continue only after exit `0`.

There is no `--keep`. The task space always closes with `finish({ keep: [] })`.

## 登录说明

1. 打开 **Ego Lite**（和 `ego-browser` 同一个配置档）。
2. 在 `https://www.zhihu.com/` 自己登录。
3. 重新跑 `check-login`。退出码 `0` 再继续。退出码 `2` 是未登录或账号不符。退出码 `4` 且 `identity-not-visible` 表示已经登录，但顶栏没有唯一名字，不能用信息流作者代替。
