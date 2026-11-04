import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SKILL_ID,
  LOGIN_URL,
  checkLoginOutcome,
  classifyLogin,
  egoMissingSummary,
  parseCheckArgs,
  strip,
} from "../lib/pure.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-login.mjs");

function runCheck(args, pathDir) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: pathDir },
  });
}

test("strip drops empty values and keeps zero and false", () => {
  assert.deepEqual(strip({ a: 1, b: "", c: null, d: undefined, e: 0, f: false }), {
    a: 1,
    e: 0,
    f: false,
  });
});

test("parseCheckArgs", () => {
  assert.equal(parseCheckArgs(["--keep"]).keep, true);
  assert.equal(parseCheckArgs(["--help"]).help, true);
  assert.equal(parseCheckArgs(["-h"]).help, true);
  assert.equal(parseCheckArgs(["--task-name", "lane-9"]).taskName, "lane-9");
  assert.equal(parseCheckArgs(["--task-name"]).taskName, `${SKILL_ID}-login-check`);
  assert.equal(parseCheckArgs([]).taskName, `${SKILL_ID}-login-check`);
  assert.throws(() => parseCheckArgs(["--nope"]), /Unknown arg/);
});

test("classifyLogin is a replaceable stub", () => {
  const login = classifyLogin({
    url: `${LOGIN_URL}?from=home`,
    title: "Sign in",
    text: "扫码",
  });
  assert.equal(login.logged_in, false);
  assert.equal(login.login_required, true);
  assert.equal(login.on_login_page, true);
  assert.equal(login.skill, SKILL_ID);

  const html = classifyLogin({ url: "https://example.com/login.html", signals: { loggedIn: true } });
  assert.equal(html.on_login_page, true);
  assert.equal(html.logged_in, false);

  const inApp = classifyLogin({
    url: "https://example.com/app",
    title: "Home",
    signals: { platformChrome: true },
  });
  assert.equal(inApp.logged_in, true);
  assert.equal(inApp.login_required, false);

  const stillLoginCopy = classifyLogin({
    url: "https://example.com/app",
    text: "Log in to continue",
    signals: { loggedIn: true },
  });
  assert.equal(stillLoginCopy.logged_in, false);

  const empty = classifyLogin({});
  assert.equal(empty.logged_in, false);
  assert.equal(empty.url, undefined);
  assert.equal(empty.title, undefined);
});

test("checkLoginOutcome soft-fails without ego and does not pretend the template is finished", () => {
  const help = checkLoginOutcome({ help: true, egoPresent: false });
  assert.equal(help.code, 0);
  assert.match(help.text, new RegExp(SKILL_ID));

  const missing = checkLoginOutcome({ help: false, egoPresent: false });
  assert.equal(missing.code, 2);
  const body = JSON.parse(missing.text);
  assert.equal(body.exitCode, 2);
  assert.equal(body.error, "ego-browser not found on PATH");
  assert.equal(body.login_required, true);
  assert.ok(body.how_to_login.length >= 3);
  assert.match(body.login_tip_zh, /不要代填密码/);

  const todo = checkLoginOutcome({ help: false, egoPresent: true });
  assert.equal(todo.code, 1);
  assert.match(todo.text, /TEMPLATE/);
  assert.equal(JSON.parse(todo.text).skill, SKILL_ID);
});

test("egoMissingSummary names this skill", () => {
  const missing = egoMissingSummary();
  assert.equal(missing.skill, SKILL_ID);
  assert.equal(missing.command, "check-login");
  assert.match(missing.how_to_login_zh.join("\n"), /example\.com\/login/);
});

test("check-login.mjs soft-fails with exit 2 when ego-browser is not on PATH", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ego-template-nopath-"));
  const missing = runCheck([], empty);
  assert.equal(missing.status, 2);
  const body = JSON.parse(missing.stdout);
  assert.equal(body.exitCode, 2);
  assert.equal(body.login_required, true);
  assert.match(missing.stdout, /how_to_login/);

  const help = runCheck(["--help"], empty);
  assert.equal(help.status, 0);
  assert.match(help.stdout, new RegExp(SKILL_ID));

  const bad = runCheck(["--nope"], empty);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unknown arg/);
});
