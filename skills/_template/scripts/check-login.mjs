#!/usr/bin/env node
// TEMPLATE soft-fail entry for __SKILL_ID__.
// Exit 0: --help. Exit 2: bad args, or ego-browser missing (JSON how_to_login on stdout).
// Exit 1: ego-browser exists but this scaffold has no real login probe yet.
import { spawnSync } from "node:child_process";
import { USAGE, checkLoginOutcome, parseCheckArgs } from "./lib/pure.mjs";

let args;
try {
  args = parseCheckArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n${USAGE}`);
  process.exit(2);
}

const probe = spawnSync("ego-browser", ["--help"], { encoding: "utf8" });
const outcome = checkLoginOutcome({ help: args.help, egoPresent: !probe.error });
process.stdout.write(outcome.text);
process.exit(outcome.code);
