// TEMPLATE runtime boundary for __SKILL_ID__.
// ego-browser injects globals such as taskSpace inside `ego-browser nodejs`.
// This file is excluded from c8. Move testable decisions into pure.mjs.
// Do not import Playwright or Puppeteer.

export function createEgoBrowser() {
  throw new Error(
    "TEMPLATE: replace createEgoBrowser() with an ego-browser taskSpace wrapper for __SKILL_ID__. Do not import Playwright or Puppeteer.",
  );
}
