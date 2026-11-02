# Acceptance

`npm test` on 2026-11-02 (Node v24.22.1, c8). Covered modules: `pure.mjs`, `run.mjs`, and `launch.mjs` under both `pinterest-download` and `instagram-saved-download`.

| Metric | Result |
|--------|--------|
| Tests | 34 passed |
| Line coverage | **98.37%** |
| Statement coverage | 98.37% |
| Threshold | lines ≥ 80% (`package.json` `c8.lines`) |

Reproduce: `npm test`. The report is `coverage/coverage-summary.json` (not committed).

## Mini smoke (ego-browser 0.6.0.12)

Default login gate, `wallpaper`, count 2, out `/tmp/ego-skills-smoke/login-required`:

- Exit **2**
- `login_required: true`, `how_to_login` length 5, `login_tip` present
- No images

Anonymous search + preview, same keyword:

```bash
node skills/pinterest-download/scripts/download.mjs search \
  --query wallpaper --count 2 --previews 1 --allow-anonymous \
  --out /tmp/ego-skills-smoke/wallpaper
```

- Exit **0**
- `method: BaseSearchResource`, `anonymous: true`, `login_tip_zh` present
- 2 JPEGs: 81,934 bytes (675×1200), 396,067 bytes (1440×2550)
- 1 preview JPEG, 22,926 bytes, `image/jpeg`
- Files stayed in `/tmp`. Not committed.

Sign in once in Ego Lite at https://www.pinterest.com/login/ for numeric ids, related pins, and boards. The skill does not type the password.

## Parity checklist

| Item | Status |
|------|--------|
| Keyword search + originals download | yes |
| Related pins | yes |
| Board feed | yes |
| Model-facing previews | yes (smoke saved one thumbnail) |
| Video MP4 download | yes in code and unit tests; no live MP4 fetched on this run |
| Login soft-fail + how_to_login | yes |
| Agent must tell the user login improves results | yes (`login_tip` on both runs) |

Live related, board, and MP4 calls were not repeated on this Mini because the Ego profile is logged out. Those paths are covered by `scripts/test/run.test.mjs`.
