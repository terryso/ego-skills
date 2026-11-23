import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RESULT_TAG } from "../lib/pure.mjs";
import { renderEntry, runCli, whichEgo } from "../lib/launch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function capture() {
  let text = "";
  return { text: () => text, write(chunk) { text += chunk; } };
}

function childWith({ stdout = "", stderr = "", code = 0, error } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (error) {
      child.emit("error", error);
      return;
    }
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    child.emit("close", code);
  });
  return child;
}

function article() {
  return {
    ok: true,
    article: {
      title: "示例标题",
      hash: "abc",
      imageCount: 1,
      images: [{ name: "image.png", bytes: 10, sha256: "abc" }],
      cover: null,
      links: [],
      headings: [],
      fidelity: ["draft only"],
    },
  };
}

const io = (extra = {}) => ({
  stdout: capture(),
  stderr: capture(),
  whichEgo: () => "ego-browser",
  mkdtemp: async () => path.join(os.tmpdir(), "ego-zhihu-article-test"),
  fs: { promises: { writeFile: async () => {}, rm: async () => {} } },
  prepare: async () => article(),
  home: path.join(os.tmpdir(), "zhihu-home"),
  env: {},
  ...extra,
});

test("whichEgo maps PATH, a missing binary, and the home fallback", () => {
  assert.equal(whichEgo(() => ({ error: new Error("missing") }), {}), null);
  assert.equal(whichEgo(() => ({ status: 0 })), "ego-browser");
  assert.equal(whichEgo(() => null), "ego-browser");
  const fallback = whichEgo((cmd) => (
    cmd === "ego-browser" ? { error: new Error("no path") } : { status: 0 }
  ), { HOME: path.join(os.tmpdir(), "fixture-home") });
  assert.match(fallback, /ego-browser$/);
  const live = whichEgo();
  const homeBin = path.join(process.env.HOME || process.env.USERPROFILE || "", ".local", "bin", "ego-browser");
  assert.ok(live === null || live === "ego-browser" || live === homeBin);
});

test("renderEntry inlines save consent and not a publish flag", () => {
  const source = renderEntry({
    config: { saveDraft: true, article: { title: "示例标题" } },
    runHref: "file:///opt/flow.mjs",
    depsHref: "file:///opt/ego-deps.mjs",
    exportName: "executeSave",
  });
  assert.match(source, /executeSave/);
  assert.match(source, /ZHIHUARTICLE/);
  assert.match(source, /"saveDraft":true/);
  assert.doesNotMatch(source, /publishPermitted":true/);
});

test("preview and an unconfirmed save do not spawn ego-browser", async () => {
  let spawned = 0;
  let looked = 0;
  const preview = io({
    spawn() { spawned += 1; },
    whichEgo() { looked += 1; return null; },
  });
  assert.equal(await runCli("preview", ["--markdown", "/absolute/path/to/article.md", "--json"], preview), 0);
  const body = JSON.parse(preview.stdout.text());
  assert.equal(body.state, "not-started");
  assert.equal(body.consent, "none");
  assert.equal(body.publishPermitted, false);
  assert.equal(body.plan.save, false);
  const plain = io();
  assert.equal(await runCli("preview", ["--markdown", "/absolute/path/to/article.md"], plain), 0);
  assert.match(plain.stdout.text(), /^preview 示例标题 images=1 state=not-started/);

  const dry = io({ spawn() { spawned += 1; }, whichEgo() { looked += 1; return "ego-browser"; } });
  assert.equal(await runCli("save", ["--markdown", "/absolute/path/to/article.md", "--json"], dry), 3);
  const plan = JSON.parse(dry.stdout.text());
  assert.equal(plan.confirmation_required, true);
  assert.equal(plan.state, "not-started");
  assert.equal(plan.publishPermitted, false);
  assert.equal(spawned, 0);
  assert.equal(looked, 0);
});

test("publish flags and bad input never reach the browser", async () => {
  let spawned = 0;
  const refused = io({ spawn() { spawned += 1; } });
  assert.equal(await runCli("save", ["--publish", "--save-draft", "--markdown", "/absolute/path/to/article.md"], refused), 1);
  assert.match(refused.stderr.text(), /does not grant permission/);
  assert.equal(await runCli("save", ["--save-draft", "--yes"], io()), 1);
  assert.equal(await runCli("preview", ["--help"], io()), 0);
  assert.equal(await runCli("check", ["--help"], io()), 0);
  assert.equal(await runCli("cleanup", ["-h"], io()), 0);
  assert.equal(await runCli("nope", [], io()), 1);
  const bad = io({ prepare: async () => ({ ok: false, error: "malformed image: image.png", unsupported: [] }) });
  assert.equal(await runCli("preview", ["--markdown", "/absolute/path/to/article.md"], bad), 1);
  assert.match(bad.stdout.text(), /malformed image/);
  assert.equal(spawned, 0);
});

test("a consented save spawns ego-browser and a missing binary soft-fails", async () => {
  let entry = "";
  const deps = io({
    fs: { promises: { writeFile: async (_file, source) => { entry = source; }, rm: async () => {} } },
    spawn() {
      return childWith({
        stdout: `${RESULT_TAG}${JSON.stringify({
          exitCode: 0,
          state: "draft-saved",
          verified: true,
          title: "示例标题",
          draftId: "9",
          draftUrl: "https://zhuanlan.zhihu.com/p/9/edit",
          publishPermitted: true,
        })}\n`,
        stderr: "browser note\n",
      });
    },
  });
  const code = await runCli("save", ["--markdown", "/absolute/path/to/article.md", "--save-draft"], deps);
  assert.equal(code, 0);
  assert.match(entry, /"saveDraft":true/);
  assert.match(deps.stdout.text(), /^draft-saved 示例标题/);
  assert.doesNotMatch(deps.stdout.text(), /publishPermitted":true/);
  const json = io({
    spawn() {
      return childWith({
        stdout: `${RESULT_TAG}${JSON.stringify({ exitCode: 4, state: "unverified", error: "readback-mismatch" })}`,
        stderr: `ZHIHUARTICLE noise\n`,
      });
    },
  });
  assert.equal(await runCli("save", ["--markdown", "/absolute/path/to/article.md", "--save-draft", "--json"], json), 4);
  assert.equal(JSON.parse(json.stdout.text()).publishPermitted, false);
  assert.equal(json.stderr.text(), "");

  const missing = io({ whichEgo: () => null, spawn() { throw new Error("should not spawn"); } });
  assert.equal(await runCli("save", ["--markdown", "/absolute/path/to/article.md", "--save-draft"], missing), 2);
  assert.match(missing.stdout.text(), /ego-browser not found/);
  assert.match(missing.stdout.text(), /示例标题/);
  const check = io({ whichEgo: () => null });
  assert.equal(await runCli("check", [], check), 2);
  const emptyHome = io({ whichEgo: () => "ego-browser", home: "", env: {}, spawn() { throw new Error("no"); } });
  assert.equal(await runCli("save", ["--text", "正文", "--title", "示例标题", "--save-draft"], emptyHome), 1);
  assert.match(emptyHome.stdout.text(), /receipt dir is empty/);

  let verifyEntry = "";
  const verify = io({
    fs: { promises: { writeFile: async (_file, source) => { verifyEntry = source; }, rm: async () => {} } },
    spawn() {
      return childWith({
        stdout: `${RESULT_TAG}${JSON.stringify({ exitCode: 4, command: "verify-draft", state: "unverified", error: "duplicate-content" })}`,
      });
    },
  });
  assert.equal(await runCli("save", ["--markdown", "/absolute/path/to/article.md", "--verify-draft", "--json"], verify), 4);
  assert.match(verifyEntry, /"verifyDraft":true/);
  assert.doesNotMatch(verifyEntry, /"saveDraft":true/);
  assert.equal(await runCli("save", ["--verify-draft", "--save-draft", "--markdown", "/absolute/path/to/article.md"], io()), 1);
});

test("spawn failures and cleanup output stay outside a real account", async () => {
  const broken = io({
    spawn() { return childWith({ error: new Error("spawn ego-browser ENOENT") }); },
  });
  assert.equal(await runCli("check", [], broken), 1);
  assert.match(broken.stderr.text(), /ENOENT/);
  const untagged = io({
    spawn() { return childWith({ stdout: "hello", code: 0 }); },
  });
  assert.equal(await runCli("cleanup", ["--json"], untagged), 0);
  assert.match(untagged.stdout.text(), /hello/);
  const coded = io({
    spawn() { return childWith({ stderr: "nodejs process exited with code 2", code: 1 }); },
  });
  assert.equal(await runCli("cleanup", [], coded), 2);
  const rm = io({
    fs: { promises: { writeFile: async () => {}, rm: async () => { throw new Error("rm failed"); } } },
    spawn() { return childWith({ stdout: `${RESULT_TAG}${JSON.stringify({ exitCode: 0, state: "not-started" })}` }); },
  });
  assert.equal(await runCli("cleanup", [], rm), 0);
});

test("entry scripts print help without opening a browser", async () => {
  for (const file of ["check-login.mjs", "preview.mjs", "save-draft.mjs", "cleanup.mjs"]) {
    const child = spawn(process.execPath, [path.join(here, "..", file), "--help"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = await new Promise((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk) => { text += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, text }));
    });
    assert.equal(stdout.code, 0, file);
    assert.match(stdout.text, /--save-draft/);
  }
});
