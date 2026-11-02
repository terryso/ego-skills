# Sign in to Pinterest once in Ego Lite

This skill reuses the cookies already stored in Ego Lite. It never types a password, solves a captcha, or reads cookie values into the repo.

## When the script soft-fails

Stdout JSON includes `"login_required": true` and the process exits `2`. A `manifest.json` in `--out` repeats the same instructions. No images are saved on this path.

Signals used (booleans only, never cookie values):

- Logged out: `[data-test-id="unauth-header"]` or `[data-test-id="simple-login-button"]`, or a `/login` / `/signup` URL.
- Logged in: a profile / avatar control in the header, or an `_auth=1` cookie visible to the page, and no logged-out header.

## Do this once

1. Open the **Ego Lite** app. `ego-browser` drives that profile.
2. Visit https://www.pinterest.com/login/ yourself and sign in.
3. Leave the profile logged in. Later runs of `download.mjs` pick up the session.
4. Re-run, for example:

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out /tmp/ego-pinterest-wallpaper
```

To keep the tab open so you can sign in there, add `--keep`, sign in, then run again (a new task space).

## Optional Chrome import

If Chrome already has the Pinterest session:

```bash
ego-browser import list
ego-browser import --browser chrome --profile Default
```

Confirm in the Ego window that pinterest.com shows your avatar, then re-run the skill. Do not paste cookies into issues, chats, or this repo.

## Logged-out public search

`--allow-anonymous` skips the login gate and uses whatever the page can see (the same public search a logged-out browser gets). The default stays login-required so the skill does not silently drop to an anonymous jar.
