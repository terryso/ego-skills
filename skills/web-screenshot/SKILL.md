---
name: web-screenshot
description: Capture full-page or element screenshots with ego-browser and write PNGs to absolute paths. Use for demos, QA evidence, and README GIFs. Prefer ego-browser when the page needs the user's cookies or local profile.
metadata:
  version: "0.1.0-stub"
  requires:
    bins:
      - ego-browser
  ego:
    min_skill_guide: "2.1.0"
---

# web-screenshot (stub)

## Outline

1. Require target URL (and optional CSS selector) plus absolute output `.png` path.
2. `ego-browser nodejs`: `taskSpace` → `page.goto` → wait for settle / network idle heuristic.
3. Full page: use documented screenshot API from `ego-browser skill` (do not invent Playwright `page.screenshot` options blindly — check guide).
4. Element shot: resolve selector via snapshot/evaluate; crop or element capture per ego API.
5. Write PNG with absolute path; print `{ path, width, height }` JSON to stdout.
6. Optional: logged-in sites — reuse profile; never clear cookies for a "clean" shot unless user asks.
7. Fail soft on selector miss: dump snapshot excerpt, do not loop forever.
8. See `scripts/capture.mjs` (stub).
