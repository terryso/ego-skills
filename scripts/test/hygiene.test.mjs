import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  auditRepo,
  auditSkillDir,
  extractFrontmatter,
  findPersonalPaths,
  frontmatterBins,
  frontmatterName,
  isScaffoldSkill,
  isSecretFileName,
  isSkillTestFile,
  main,
  skillOmitsEgoBrowser,
} from "../check-skill-hygiene.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repo, "scripts", "check-skill-hygiene.mjs");

function skillMd(id, bins = ["ego-browser", "node"]) {
  const items = bins.map((bin) => `      - ${bin}`).join("\n");
  return `---
name: ${id}
description: >
  Drive a site with Ego Lite.
  name: not-this
metadata:
  version: "0.0.0"
  requires:
    bins:
${items}
  ego:
    min_skill_guide: "2.1.0"
---

# ${id}

Examples use /tmp/example or /absolute/path/to/video.mp4.
Do not bake in a product or podcast directory.
`;
}

function writeSkill(root, id, { md, files = {} } = {}) {
  const dir = path.join(root, "skills", id);
  fs.mkdirSync(dir, { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(dir, "SKILL.md"), md == null ? skillMd(id) : md);
  for (const [rel, contents] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (Buffer.isBuffer(contents)) fs.writeFileSync(dest, contents);
    else fs.writeFileSync(dest, contents);
  }
  return dir;
}

function codes(findings) {
  return findings.map((item) => item.code);
}

test("frontmatter helpers read name and bins", () => {
  const text = `---
name: "quoted-skill"
description: one line
metadata:
  requires:
    bins: ["ego-browser", 'node']
---
body
`;
  const frontmatter = extractFrontmatter(text);
  assert.equal(frontmatterName(frontmatter), "quoted-skill");
  assert.deepEqual(frontmatterBins(frontmatter), ["ego-browser", "node"]);
  assert.equal(extractFrontmatter("no frontmatter"), null);
  assert.equal(frontmatterName(null), null);
  assert.deepEqual(frontmatterBins("name: x\n"), []);
  assert.equal(frontmatterName(extractFrontmatter(skillMd("demo-skill"))), "demo-skill");
  assert.deepEqual(frontmatterBins(extractFrontmatter(skillMd("demo-skill", ["node"]))), ["node"]);
});

test("personal-path rules ignore urls, tilde downloads, and the word podcast", () => {
  const clean = [
    "https://x.com/home",
    'assert.equal(onHome("https://twitter.com/home/"), true);',
    "https://twitter.com/home/following",
    "see x.com/home/timeline",
    "default ~/Downloads/pinterest-ego",
    "No home-directory paths and no product or podcast directories.",
    "/tmp/fixture-home and /absolute/path/to/video.mp4",
  ].join("\n");
  assert.deepEqual(findPersonalPaths(clean), []);
  assert.deepEqual(findPersonalPaths(null), []);

  const dirty = [
    "out = /Users/nick/Downloads/pins",
    String.raw`clip = C:\Users\nick\video.mp4`,
    "fallback /home/tester/.local/bin/ego-browser",
    "bare /home/tester",
    "show ~/Podcasts/ep.mp4",
    "archive /podcasts/show/ep.mp4",
  ].join("\n");
  assert.deepEqual(
    findPersonalPaths(dirty).map((hit) => hit.label),
    ["/Users/", "/Users/", "/home/<name>/", "/home/<name>/", "podcast directory", "podcast directory"],
  );
});

test("secret file names and test file paths", () => {
  for (const name of [".env", ".env.local", "AuthKey_ABC.p8", "server.pem", "cookies.txt", "cookie.json", "id_rsa", "app.key"]) {
    assert.equal(isSecretFileName(`secrets/${name}`), true, name);
  }
  assert.equal(isSecretFileName("references/login.md"), false);
  assert.equal(isSecretFileName("scripts/lib/session.mjs"), false);
  assert.equal(isSkillTestFile("scripts/test/pure.test.mjs"), true);
  assert.equal(isSkillTestFile("scripts/test/nested/deep.test.mjs"), true);
  assert.equal(isSkillTestFile("scripts/test/dom-fixture.mjs"), false);
  assert.equal(isSkillTestFile("scripts/lib/pure.test.mjs"), false);
  assert.equal(isScaffoldSkill("_template"), true);
  assert.equal(isScaffoldSkill("x-post"), false);
});

test("auditSkillDir reports each broken rule and skips binary noise", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-"));
  writeSkill(root, "good-skill", {
    files: {
      "scripts/test/nested/pure.test.mjs": "import test from 'node:test';\n",
      "references/login.md": "Sign in inside Ego. Do not paste cookies.\n",
    },
  });
  assert.deepEqual(auditSkillDir(path.join(root, "skills", "good-skill"), "good-skill"), []);

  writeSkill(root, "broken-skill", {
    md: skillMd("other-name", ["node"]),
    files: {
      "scripts/lib/pure.mjs": "export const home = '/Users/ada/Podcasts/show';\nconst also = '/home/ada/src';\n",
      "secrets/.env": "TOKEN=1\n",
      "secrets/cookies.json": "{}\n",
      "scripts/lib/key-note.mjs": "const pem = `-----BEGIN PRIVATE KEY-----\\nabc\\n`;\n",
      "assets/noise.bin": Buffer.from([0x2f, 0x55, 0x73, 0x65, 0x72, 0x73, 0x2f, 0x00]),
    },
  });
  const broken = auditSkillDir(path.join(root, "skills", "broken-skill"), "broken-skill");
  assert.deepEqual(codes(broken).sort(), [
    "missing-ego-browser",
    "missing-tests",
    "name-mismatch",
    "personal-path",
    "personal-path",
    "personal-path",
    "private-key",
    "secret-file",
    "secret-file",
  ]);
  assert.equal(broken.some((item) => item.file && item.file.endsWith("noise.bin")), false);

  writeSkill(root, "empty-skill", { md: null, files: {} });
  const empty = auditSkillDir(path.join(root, "skills", "empty-skill"), "empty-skill");
  assert.deepEqual(codes(empty).sort(), ["missing-skill-md", "missing-tests"]);
});

test("auditRepo skips scaffolds and docs outside skills/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-repo-"));
  writeSkill(root, "good-skill", {
    files: { "scripts/test/pure.test.mjs": "test\n" },
  });
  writeSkill(root, "_template", {
    md: "---\nname: __SKILL_ID__\n---\n/Users/example and /home/example/\n",
    files: { "AuthKey_EXAMPLE.p8": "not a real key\n" },
  });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "CONTRIBUTING.md"), "Avoid a /Users/ prefix and /home/<name>/.\n");
  fs.writeFileSync(path.join(root, "skills", "NOTES.txt"), "/Users/not-a-directory\n");
  assert.deepEqual(auditRepo(root), []);

  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-missing-"));
  const gone = auditRepo(missing);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].code, "missing-skills");
});

test("shipped skills pass, even though docs name the banned prefixes", () => {
  const contributing = fs.readFileSync(path.join(repo, "docs", "CONTRIBUTING.md"), "utf8");
  assert.match(contributing, /\/Users\//);
  assert.match(contributing, /\/home\/<name>\//);
  const findings = auditRepo(repo);
  assert.deepEqual(findings, [], findings.map((item) => item.message).join("\n"));

  for (const id of fs.readdirSync(path.join(repo, "skills"))) {
    if (id.startsWith("_")) continue;
    const text = fs.readFileSync(path.join(repo, "skills", id, "SKILL.md"), "utf8");
    const frontmatter = extractFrontmatter(text);
    assert.equal(frontmatterName(frontmatter), id);
    if (skillOmitsEgoBrowser(frontmatter)) {
      assert.equal(frontmatterBins(frontmatter).includes("ego-browser"), false);
      assert.ok(frontmatterBins(frontmatter).includes("node"));
    } else {
      assert.equal(skillOmitsEgoBrowser(frontmatter), false);
      assert.ok(frontmatterBins(frontmatter).includes("ego-browser"));
    }
  }
});

test("grok connector skills may omit ego-browser only with both markers", () => {
  const marked = `---
name: x-bookmark-export
metadata:
  runtime: grok-x-connector
  ego_browser: unsupported
  requires:
    bins:
      - node
---
# x-bookmark-export
`;
  const frontmatter = extractFrontmatter(marked);
  assert.equal(skillOmitsEgoBrowser(frontmatter), true);
  assert.equal(skillOmitsEgoBrowser("runtime: grok-x-connector\n"), false);
  assert.equal(skillOmitsEgoBrowser("ego_browser: unsupported\n"), false);
  assert.equal(skillOmitsEgoBrowser(null), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-connector-"));
  writeSkill(root, "x-bookmark-export", {
    md: marked,
    files: { "scripts/test/pure.test.mjs": "test\n" },
  });
  assert.deepEqual(auditSkillDir(path.join(root, "skills", "x-bookmark-export"), "x-bookmark-export"), []);

  const both = marked.replace("      - node\n", "      - node\n      - ego-browser\n");
  writeSkill(root, "x-bookmark-both", {
    md: both.replace("name: x-bookmark-export", "name: x-bookmark-both"),
    files: { "scripts/test/pure.test.mjs": "test\n" },
  });
  const findings = auditSkillDir(path.join(root, "skills", "x-bookmark-both"), "x-bookmark-both");
  assert.ok(codes(findings).includes("unexpected-ego-browser"));
});

test("main prints help, rejects unknown args, and reports a dirty tree", () => {
  const logs = { out: "", err: "" };
  const io = {
    stdout: { write: (chunk) => { logs.out += chunk; } },
    stderr: { write: (chunk) => { logs.err += chunk; } },
  };
  assert.equal(main(["--help"], io), 0);
  assert.match(logs.out, /Usage:/);
  assert.equal(main(["--nope"], io), 1);
  assert.match(logs.err, /Unknown argument/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-main-"));
  writeSkill(root, "bad-skill", { md: skillMd("bad-skill", ["node"]) });
  const dirty = { ...io, root };
  logs.out = "";
  logs.err = "";
  assert.equal(main([], dirty), 1);
  assert.match(logs.err, /ego-browser/);
  assert.match(logs.err, /hygiene problem/);

  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "ego-hygiene-clean-"));
  writeSkill(clean, "good-skill", {
    files: { "scripts/test/pure.test.mjs": "ok\n" },
  });
  logs.out = "";
  logs.err = "";
  assert.equal(main([], { ...io, root: clean }), 0);
  assert.match(logs.out, /skill hygiene ok/);

  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /scaffolds/);
  const live = spawnSync(process.execPath, [cli], { cwd: repo, encoding: "utf8" });
  assert.equal(live.status, 0, live.stderr);
  assert.match(live.stdout, /skill hygiene ok/);
});
