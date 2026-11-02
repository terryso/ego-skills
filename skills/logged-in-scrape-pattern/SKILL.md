---
name: logged-in-scrape-pattern
description: Canonical pattern for scraping pages that require the user's existing login. Use as a template when building site-specific ego-browser skills. Emphasizes session reuse, healthchecks, evaluate-based extract, and safe stop on auth walls.
metadata:
  version: "0.1.0-stub"
  requires:
    bins:
      - ego-browser
  ego:
    min_skill_guide: "2.1.0"
---

# logged-in-scrape-pattern (stub)

## Outline

1. **Prefer ego** whenever the task needs cookies the human already has; skip cloud MCP browsers.
2. **Healthcheck**: open domain home; detect login affordance vs. authenticated chrome via snapshot/evaluate.
3. If logged out → stop; ask user to sign in (or `ego-browser import`) inside ego GUI; do not automate passwords.
4. Navigate to target; `snapshot()`; extract with `page.evaluate()` returning plain JSON only.
5. Persist results to absolute paths; keep rounds in dated goal folders (ego skill guide convention).
6. Never clear cookies/cache without reading ego `references/clearing-state.md`.
7. Site-specific skills should fork this outline + add selectors under `references/`.
8. See `scripts/scrape-pattern.mjs` (stub) for the skeleton loop.
