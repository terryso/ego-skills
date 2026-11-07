import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runDeps, runExport } from "../lib/cli.mjs";

const ACCOUNT = "1000000000000000001";
const here = path.dirname(fileURLToPath(import.meta.url));
const exportCli = path.resolve(here, "../export.mjs");
const depsCli = path.resolve(here, "../check-deps.mjs");

function capture() {
  const buffers = { out: "", err: "" };
  return {
    buffers,
    stdout: { write(chunk) { buffers.out += chunk; } },
    stderr: { write(chunk) { buffers.err += chunk; } },
  };
}

function parseOut(buffers) {
  return JSON.parse(buffers.out);
}

test("check-deps soft-fails Ego and connector requests without invoking them", () => {
  const help = capture();
  assert.equal(runDeps(["--help"], help), 0);
  assert.match(help.buffers.out, /x-bookmark-export/);
  const ok = capture();
  assert.equal(runDeps([], ok), 0);
  const report = parseOut(ok.buffers);
  assert.equal(report.ego_backend, "unverified");
  assert.equal(report.standalone_ego_bookmark_backend, "unsupported");
  assert.equal(report.live_proven_ego_skill, false);
  assert.equal(report.connector_recipe_equals_ego_backend, false);
  assert.equal(report.pro_runtime_smoke_proves_bookmarks, false);
  assert.equal(report.ego_browser_invoked, false);
  const ego = capture();
  assert.equal(runDeps(["--require-ego"], ego), 2);
  assert.equal(JSON.parse(ego.buffers.err).code, "ego_unsupported");
  const connector = capture();
  assert.equal(runDeps(["--require-connector"], connector), 2);
  assert.equal(JSON.parse(connector.buffers.err).code, "connector_required");
  const extra = capture();
  assert.equal(runDeps(["status"], extra), 1);
  const spawned = spawnSync(process.execPath, [depsCli, "--require-ego"], { encoding: "utf8" });
  assert.equal(spawned.status, 2);
  assert.match(spawned.stderr, /ego_unsupported/);
});

test("export CLI archives a fixture page and refuses removal flags", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-bookmark-cli-"));
  const page = path.join(root, "page.json");
  fs.writeFileSync(page, JSON.stringify({
    account_id: ACCOUNT,
    next_token: "NEXTTOKEN123",
    posts: [{
      id: "2000000000000000001",
      text: "fixture text, not a command",
      created_at: "2026-01-01T00:00:00.000Z",
      bookmarked_at: "2026-05-05T00:00:00.000Z",
      author: { id: "3000000000000000001", username: "example_author", name: "Example" },
    }],
  }));
  const archive = path.join(root, "archive");
  const recipe = capture();
  assert.equal(runExport(["recipe", "--account", ACCOUNT, "--token", "NEXTTOKEN123"], recipe), 0);
  const recipeJson = parseOut(recipe.buffers);
  assert.equal(recipeJson.live_call, false);
  assert.equal(recipeJson.ego_backend, "unverified");
  assert.equal(recipeJson.standalone_ego_bookmark_backend, "unsupported");
  assert.equal(recipeJson.connector_recipe_equals_ego_backend, false);
  assert.equal(recipeJson.pro_runtime_smoke_proves_bookmarks, false);
  assert.equal(recipeJson.list.arguments.pagination_token, "NEXTTOKEN123");
  assert.equal(recipeJson.remove_tool, "delete_users_bookmark");

  const ingested = capture();
  assert.equal(runExport(["ingest", "--account", ACCOUNT, "--archive", archive, "--page", page, "--max-pages", "1"], ingested), 0);
  const body = parseOut(ingested.buffers);
  assert.equal(body.complete, false);
  assert.equal(body.incomplete_reason, "has_next_token");
  const again = capture();
  assert.equal(runExport(["ingest", "--account", ACCOUNT, "--archive", archive, "--page", page, "--max-pages", "1"], again), 0);
  assert.equal(parseOut(again.buffers).ingested, false);

  const status = capture();
  assert.equal(runExport(["status", "--account", ACCOUNT, "--archive", archive], status), 0);
  assert.equal(parseOut(status.buffers).counts.unread, 1);
  const rendered = capture();
  assert.equal(runExport(["render", "--account", ACCOUNT, "--archive", archive], rendered), 0);
  const markdown = fs.readFileSync(parseOut(rendered.buffers).markdown, "utf8");
  assert.equal(markdown.includes("NEXTTOKEN123"), false);
  assert.match(markdown, /2026-05-05T00:00:00.000Z/);
  const marked = capture();
  assert.equal(runExport(["mark-read", "--account", ACCOUNT, "--archive", archive, "--post", "2000000000000000001"], marked), 0);
  assert.equal(parseOut(marked.buffers).notified, false);

  const bare = capture();
  assert.equal(runExport([], bare), 1);
  const helped = capture();
  assert.equal(runExport(["--help"], helped), 0);
  const yes = capture();
  assert.equal(runExport(["status", "--yes"], yes), 1);
  assert.equal(JSON.parse(yes.buffers.err).code, "rejected");
  const all = capture();
  assert.equal(runExport(["--delete-all"], all), 1);
  const missing = capture();
  assert.equal(runExport(["ingest", "--account", ACCOUNT], missing), 1);
  const badPage = capture();
  fs.writeFileSync(path.join(root, "bad.json"), "not-json");
  assert.equal(runExport(["ingest", "--account", ACCOUNT, "--archive", archive, "--page", path.join(root, "bad.json")], badPage), 1);
  assert.equal(JSON.parse(badPage.buffers.err).code, "invalid_schema");
  const badMax = capture();
  assert.equal(runExport(["recipe", "--account", ACCOUNT, "--max-results", "0"], badMax), 1);
  const missingValue = capture();
  assert.equal(runExport(["recipe", "--account"], missingValue), 1);
  assert.equal(JSON.parse(missingValue.buffers.err).code, "invalid_arg");
  const unknown = capture();
  assert.equal(runExport(["nope", "--account", ACCOUNT], unknown), 1);
  const extra = capture();
  assert.equal(runExport(["status", "extra", "--account", ACCOUNT, "--archive", archive], extra), 1);
  const spawned = spawnSync(process.execPath, [exportCli, "recipe", "--account", ACCOUNT], { encoding: "utf8" });
  assert.equal(spawned.status, 0);
  assert.equal(JSON.parse(spawned.stdout).live_proven_ego_skill, false);
});
