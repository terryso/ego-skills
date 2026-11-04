import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(file, args) {
  return spawnSync(process.execPath, [path.join(scripts, file), ...args], { encoding: "utf8" });
}

test("the bins print help without posting", () => {
  for (const file of ["check-login.mjs", "post.mjs", "cleanup.mjs"]) {
    const result = run(file, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--yes/);
  }
  const missing = run("post.mjs", []);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing --text/);
});
