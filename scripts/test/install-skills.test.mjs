import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("install-skills.sh links shipped skills and skips _template", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ego-skills-home-"));
  const res = spawnSync("bash", [path.join(repo, "scripts/install-skills.sh")], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: dest, EGO_SKILLS_HOME: dest },
  });
  assert.equal(res.status, 0, res.stderr);
  const linked = fs.readdirSync(dest);
  assert.ok(linked.includes("pinterest-download"));
  assert.ok(linked.includes("douyin-video"));
  assert.ok(linked.includes("wechat-channels-video"));
  assert.equal(linked.includes("_template"), false);
  assert.ok(linked.every((name) => !name.startsWith("_")));
  const stat = fs.lstatSync(path.join(dest, "youtube-video"));
  assert.equal(stat.isSymbolicLink(), true);
});
