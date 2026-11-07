// Review CLI. Analysis in, connector ops out. No live X call and no ego-browser.

import fs from "node:fs";
import { dependencyReport, WorkflowError } from "../../../x-bookmark-export/scripts/lib/pure.mjs";
import { readConsent, writeConsent } from "../../../x-bookmark-export/scripts/lib/store.mjs";
import { acceptAnalysis, deliverRecommendations } from "./analysis.mjs";
import { buildPlan, commitRemoval, prepareApply, reconcilePresence } from "./cleanup.mjs";
import { applyOnboarding, mergeConsent, nextOnboardingQuestion } from "./onboard.mjs";
import { siblingStatus } from "./sibling.mjs";

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--yes") flags.yes = true;
    else if (arg === "--apply") flags.apply = true;
    else if (arg === "--require-connector") flags.requireConnector = true;
    else if (arg === "--require-ego") flags.requireEgo = true;
    else if (arg === "--all" || arg === "--delete-all") {
      throw new WorkflowError("rejected", "blanket removal is not available");
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        throw new WorkflowError("invalid_arg", `missing value for ${arg}`);
      }
      flags[key] = value;
      index += 1;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

function requireFlag(flags, key) {
  if (!flags[key]) throw new WorkflowError("invalid_arg", `missing --${key}`);
  return flags[key];
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new WorkflowError("invalid_schema", "JSON file is unreadable");
  }
}

function boolWord(value, name) {
  if (value == null) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new WorkflowError("invalid_arg", `--${name} must be true or false`);
}

function integerFlag(flags, key) {
  if (flags[key] == null) return null;
  if (!/^[1-9][0-9]*$/.test(flags[key])) {
    throw new WorkflowError("invalid_arg", `--${key} must be a positive integer`);
  }
  return Number(flags[key]);
}

export function usage() {
  return `x-bookmark-review — recommendations and unbookmark plans from an archive

No live X call. No ego-browser. Cleanup is a preview until the owner opts in and passes --yes.
Exit 3 is a dry run. Exit 2 means the connector, the sibling export skill, or Ego was requested
and is not invoked.

  node scripts/review.mjs onboard --answers /absolute/answers.json [--apply --account <id> --archive /absolute/archive]
  node scripts/review.mjs accept-analysis --account <id> --archive /absolute/archive --analysis /absolute/analysis.json
  node scripts/review.mjs recommend --account <id> --archive /absolute/archive
  node scripts/review.mjs plan --account <id> --archive /absolute/archive [--cap N]
  node scripts/review.mjs apply --account <id> --archive /absolute/archive --plan <planId> [--yes]
  node scripts/review.mjs commit-removal --account <id> --archive /absolute/archive --results /absolute/results.json
  node scripts/review.mjs reconcile --account <id> --archive /absolute/archive --presence /absolute/presence.json
  node scripts/review.mjs consent-show --account <id> --archive /absolute/archive
  node scripts/review.mjs consent-set --account <id> --archive /absolute/archive [--processed true|false] [--unhelpful true|false]
`;
}

function finish(stdout, result) {
  stdout.write(`${JSON.stringify(result)}\n`);
  return result && Number.isInteger(result.exit) ? result.exit : 0;
}

export function runReview(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const sibling = (io.siblingStatus || siblingStatus)();
    if (!sibling.ok) {
      throw new WorkflowError("missing_export_skill", "Install x-bookmark-export beside x-bookmark-review.");
    }
    const { positionals, flags } = parseArgs(argv);
    if (flags.help || positionals.length === 0) {
      stdout.write(`${usage()}\n`);
      return positionals.length === 0 && !flags.help ? 1 : 0;
    }
    const command = positionals[0];
    if (positionals.length > 1) throw new WorkflowError("invalid_arg", "unexpected positional argument");
    if (flags.yes && command !== "apply") {
      throw new WorkflowError("rejected", "--yes is only valid on apply");
    }
    if (command === "onboard") {
      const answers = readJsonFile(requireFlag(flags, "answers"));
      if (!flags.apply) return finish(stdout, nextOnboardingQuestion(answers));
      return finish(stdout, applyOnboarding(requireFlag(flags, "archive"), requireFlag(flags, "account"), answers));
    }
    const archive = requireFlag(flags, "archive");
    const account = requireFlag(flags, "account");
    if (command === "accept-analysis") {
      return finish(stdout, acceptAnalysis(archive, account, readJsonFile(requireFlag(flags, "analysis"))));
    }
    if (command === "recommend") return finish(stdout, deliverRecommendations(archive, account));
    if (command === "plan") {
      const cap = integerFlag(flags, "cap");
      return finish(stdout, buildPlan(archive, account, cap == null ? {} : { cap }));
    }
    if (command === "apply") {
      return finish(stdout, prepareApply(archive, account, requireFlag(flags, "plan"), { yes: flags.yes === true }));
    }
    if (command === "commit-removal") {
      return finish(stdout, commitRemoval(archive, account, readJsonFile(requireFlag(flags, "results"))));
    }
    if (command === "reconcile") {
      return finish(stdout, reconcilePresence(archive, account, readJsonFile(requireFlag(flags, "presence"))));
    }
    if (command === "consent-show") return finish(stdout, readConsent(archive, account));
    if (command === "consent-set") {
      const current = readConsent(archive, account);
      const next = mergeConsent(current, {
        processed: boolWord(flags.processed, "processed"),
        unhelpful: boolWord(flags.unhelpful, "unhelpful"),
      });
      return finish(stdout, writeConsent(archive, account, next));
    }
    throw new WorkflowError("invalid_arg", `unknown command ${command}`);
  } catch (error) {
    const code = error.code || "error";
    const exit = code === "connector_required" || code === "ego_unsupported" || code === "missing_export_skill" ? 2 : 1;
    stderr.write(`${JSON.stringify({ ok: false, code, error: error.message, details: error.details || null })}\n`);
    return exit;
  }
}

export function runReviewDeps(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const { positionals, flags } = parseArgs(argv);
    if (flags.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (positionals.length > 0) throw new WorkflowError("invalid_arg", "check-deps takes flags only");
    const sibling = (io.siblingStatus || siblingStatus)();
    if (!sibling.ok) {
      throw new WorkflowError("missing_export_skill", "Install x-bookmark-export beside x-bookmark-review.");
    }
    const report = dependencyReport({
      requireConnector: Boolean(flags.requireConnector),
      requireEgo: Boolean(flags.requireEgo),
    });
    stdout.write(`${JSON.stringify({ ...report, skill: "x-bookmark-review", sibling: true })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || "error";
    const exit = code === "connector_required" || code === "ego_unsupported" || code === "missing_export_skill" ? 2 : 1;
    stderr.write(`${JSON.stringify({ ok: false, code, error: error.message })}\n`);
    return exit;
  }
}
