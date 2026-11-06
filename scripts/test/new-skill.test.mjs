import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSkillId, copyTemplate, main } from "../new-skill.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(repo, "skills", "_template");
const cli = path.join(repo, "scripts", "new-skill.mjs");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("npm test and c8 use globs so a new skill is included", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.match(pkg.scripts.test, /skills\/\*\/scripts\/test\/\*\*\/\*\.test\.mjs/);
  assert.match(pkg.scripts.test, /scripts\/test\/\*\*\/\*\.test\.mjs/);
  assert.equal(pkg.scripts.hygiene, "node scripts/check-skill-hygiene.mjs");
  assert.equal(pkg.scripts["new-skill"], "node scripts/new-skill.mjs");
  assert.deepEqual(pkg.c8.include, ["skills/*/scripts/lib/**/*.mjs"]);
  assert.ok(pkg.c8.exclude.includes("skills/*/scripts/lib/ego-deps.mjs"));
  assert.equal(pkg.c8.lines, 80);
  assert.equal(pkg.c8["check-coverage"], true);
  assert.equal(pkg.c8.all, true);
});

test("assertSkillId rejects scaffold names and bad shapes", () => {
  assert.doesNotThrow(() => assertSkillId("my-site-download"));
  for (const id of ["", "Bad", "a_b", "_template", "foo--bar", "-foo", "9lives", "My-Skill"]) {
    assert.throws(() => assertSkillId(id), /Invalid skill id/);
  }
});

test("copyTemplate remaps placeholders and refuses to overwrite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-new-skill-"));
  const dest = copyTemplate({ id: "demo-skill", root, templateDir });
  assert.equal(path.basename(dest), "demo-skill");
  const skill = fs.readFileSync(path.join(dest, "SKILL.md"), "utf8");
  assert.match(skill, /^name: demo-skill$/m);
  assert.doesNotMatch(skill, /__SKILL_ID__/);
  for (const file of walk(dest)) {
    assert.equal(fs.readFileSync(file, "utf8").includes("__SKILL_ID__"), false, file);
  }
  assert.match(fs.readFileSync(path.join(templateDir, "SKILL.md"), "utf8"), /__SKILL_ID__/);
  assert.throws(() => copyTemplate({ id: "demo-skill", root, templateDir }), /overwrite/);

  const child = spawnSync(process.execPath, ["--test", path.join(dest, "scripts/test/pure.test.mjs")], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

test("main prints usage and does not write into the repo on bad input", () => {
  const logs = { out: "", err: "" };
  const io = {
    root: repo,
    templateDir,
    stdout: { write: (chunk) => { logs.out += chunk; } },
    stderr: { write: (chunk) => { logs.err += chunk; } },
  };
  assert.equal(main([], io), 1);
  assert.match(logs.out, /Usage:/);
  assert.equal(main(["--help"], io), 0);
  assert.equal(main(["demo-skill", "extra"], io), 1);
  assert.match(logs.err, /extra/);
  assert.equal(main(["Bad_ID"], io), 1);
  assert.match(logs.err, /Invalid skill id/);
  assert.equal(fs.existsSync(path.join(repo, "skills", "demo-skill")), false);

  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /new-skill/);
  const bad = spawnSync(process.execPath, [cli, "Not Valid"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Invalid skill id/);
});
