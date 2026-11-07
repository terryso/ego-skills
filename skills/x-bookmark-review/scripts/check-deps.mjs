#!/usr/bin/env node
import { siblingStatus } from "./lib/sibling.mjs";

const sibling = siblingStatus();
if (!sibling.ok) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "missing_export_skill",
    error: "Install x-bookmark-export beside x-bookmark-review.",
    ego_browser_invoked: false,
  })}\n`);
  process.exit(2);
}

const { runReviewDeps } = await import("./lib/cli.mjs");
process.exit(runReviewDeps(process.argv.slice(2)));
