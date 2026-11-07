// CLI for the portable export archive. Prints JSON. Does not call X or Ego.

import fs from "node:fs";
import {
  dependencyReport,
  listBookmarksCall,
  WorkflowError,
} from "./pure.mjs";

const REMOVE_TOOL_NAME = "delete_users_bookmark";
import { ingestPage, markRead, renderAccount, statusReport } from "./store.mjs";

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--require-connector") flags.requireConnector = true;
    else if (arg === "--require-ego") flags.requireEgo = true;
    else if (arg === "--yes") {
      throw new WorkflowError("rejected", "export never removes bookmarks and does not accept --yes");
    } else if (arg === "--all" || arg === "--delete-all") {
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

function readPage(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError("invalid_schema", "page file is not JSON");
  }
}

function integerFlag(flags, key) {
  if (flags[key] == null) return null;
  if (!/^[1-9][0-9]*$/.test(flags[key])) {
    throw new WorkflowError("invalid_arg", `--${key} must be a positive integer`);
  }
  return Number(flags[key]);
}

export function usage() {
  return `x-bookmark-export — archive X bookmarks from a connector page file

No live X call. No ego-browser. Exit 2 when a connector or Ego backend is required.

  node scripts/check-deps.mjs
  node scripts/export.mjs recipe --account <id> [--token <pagination>] [--max-results N]
  node scripts/export.mjs ingest --account <id> --archive /absolute/archive --page /absolute/page.json
  node scripts/export.mjs status --account <id> --archive /absolute/archive
  node scripts/export.mjs render --account <id> --archive /absolute/archive
  node scripts/export.mjs mark-read --account <id> --archive /absolute/archive --post <id>
`;
}

export function runExport(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const { positionals, flags } = parseArgs(argv);
    if (flags.help || positionals.length === 0) {
      stdout.write(`${usage()}\n`);
      return positionals.length === 0 && !flags.help ? 1 : 0;
    }
    const command = positionals[0];
    if (positionals.length > 1) throw new WorkflowError("invalid_arg", "unexpected positional argument");
    let result;
    if (command === "recipe") {
      const account = requireFlag(flags, "account");
      const maxResults = flags["max-results"] == null ? 20 : integerFlag(flags, "max-results");
      result = {
        ok: true,
        list: listBookmarksCall({
          accountId: account,
          paginationToken: flags.token || null,
          maxResults,
        }),
        remove_tool: REMOVE_TOOL_NAME,
        live_call: false,
        ego_backend: "unverified",
        live_proven_ego_skill: false,
        connector_recipe_equals_ego_backend: false,
        live_cleanup: false,
      };
    } else if (command === "ingest") {
      result = ingestPage(
        requireFlag(flags, "archive"),
        requireFlag(flags, "account"),
        readPage(requireFlag(flags, "page")),
        { maxPages: integerFlag(flags, "max-pages"), maxItems: integerFlag(flags, "max-items") },
      );
    } else if (command === "status") {
      result = statusReport(requireFlag(flags, "archive"), requireFlag(flags, "account"));
    } else if (command === "render") {
      result = renderAccount(requireFlag(flags, "archive"), requireFlag(flags, "account"));
    } else if (command === "mark-read") {
      result = markRead(
        requireFlag(flags, "archive"),
        requireFlag(flags, "account"),
        requireFlag(flags, "post"),
      );
    } else {
      throw new WorkflowError("invalid_arg", `unknown command ${command}`);
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || "error";
    const exit = code === "connector_required" || code === "ego_unsupported" ? 2 : 1;
    stderr.write(`${JSON.stringify({
      ok: false,
      code,
      error: error.message,
      details: error.details || null,
    })}\n`);
    return exit;
  }
}

export function runDeps(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const { positionals, flags } = parseArgs(argv);
    if (flags.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (positionals.length > 0) throw new WorkflowError("invalid_arg", "check-deps takes flags only");
    const report = dependencyReport({
      requireConnector: Boolean(flags.requireConnector),
      requireEgo: Boolean(flags.requireEgo),
    });
    stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || "error";
    const exit = code === "connector_required" || code === "ego_unsupported" ? 2 : 1;
    stderr.write(`${JSON.stringify({ ok: false, code, error: error.message })}\n`);
    return exit;
  }
}
