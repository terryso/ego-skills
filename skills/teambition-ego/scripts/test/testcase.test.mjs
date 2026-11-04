import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { executeTestcase, renderTestcaseEntry, runTestcaseCli } from "../lib/domains/testcase.mjs";

const PROJECT = "a".repeat(24);
const PLAN = "b".repeat(24);
const GROUP = "c".repeat(24);

function sessionFrom(pages) {
  const urls = [];
  let index = 0;
  return {
    urls,
    ensured: 0,
    cleaned: 0,
    async ensureSite() { this.ensured += 1; },
    async fetch(url) {
      urls.push(url);
      const page = pages[Math.min(index, pages.length - 1)];
      index += 1;
      if (page && page.throw) throw new Error(page.throw);
      return page;
    },
    async cleanup() { this.cleaned += 1; },
  };
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

const host = (extra = {}) => ({
  whichEgo: () => "ego-browser",
  mkdtemp: async () => "/tmp/ego-teambition-tb-test",
  fs: { writeFile: async () => {}, rm: async () => {} },
  ...extra,
});

test("cleanup and rejected commands", async () => {
  const session = sessionFrom([]);
  const closed = await executeTestcase({ cmd: "cleanup" }, { session });
  assert.equal(closed.exitCode, 0);
  assert.match(closed.stdout, /已关闭常驻浏览器空间/);
  assert.equal(session.cleaned, 1);

  const unknown = await executeTestcase({ cmd: "create" }, { session });
  assert.equal(unknown.exitCode, 1);
  assert.match(unknown.stderr, /未知命令/);

  const missing = await executeTestcase({ cmd: "plan" }, { session: sessionFrom([]) });
  assert.match(missing.stderr, /缺少 projectId/);

  const boom = sessionFrom([]);
  boom.cleanup = async () => { throw new Error("finish failed"); };
  const failed = await executeTestcase({ cmd: "cleanup" }, { session: boom });
  assert.match(failed.stderr, /finish failed/);
});

test("plan and groups format the browser payload", async () => {
  const plan = sessionFrom([{ status: 200, body: { result: { name: "回归", statusName: "进行中", testcaseCount: { total: 2 }, creator: { name: "Ada" } } } }]);
  const text = await executeTestcase({ cmd: "plan", projectId: PROJECT, planId: PLAN }, { session: plan });
  assert.equal(text.exitCode, 0);
  assert.match(text.stdout, /名称: 回归/);
  assert.equal(plan.ensured, 1);
  assert.match(plan.urls[0], /\/testplans\//);

  const json = await executeTestcase({ cmd: "plan", projectId: PROJECT, planId: PLAN, asJson: true }, { session: sessionFrom([{ status: 200, body: { result: { name: "J" } } }]) });
  assert.match(json.stdout, /"name": "J"/);

  const denied = await executeTestcase({ cmd: "plan", projectId: PROJECT, planId: PLAN }, { session: sessionFrom([{ status: 401, body: {} }]) });
  assert.match(denied.stderr, /未登录：请在 Ego 浏览器打开 teambition.com/);

  const http = await executeTestcase({ cmd: "groups", projectId: PROJECT, planId: PLAN }, { session: sessionFrom([{ status: 500, body: {} }]) });
  assert.match(http.stderr, /HTTP 500/);

  const groups = await executeTestcase({ cmd: "groups", projectId: PROJECT, planId: PLAN }, {
    session: sessionFrom([{ status: 200, body: { result: [], groups: [{ _id: GROUP, resourceCount: 1, name: "登录" }] } }]),
  });
  assert.equal(groups.stdout, `${GROUP}\t1\t登录\n`);
  assert.match(groups.stdout ? "" : "", /^$/);
  const groupJson = await executeTestcase({
    cmd: "groups",
    projectId: PROJECT,
    planId: PLAN,
    asJson: true,
  }, { session: sessionFrom([{ status: 200, body: [{ _id: "x", name: "A" }] }]) });
  assert.match(groupJson.stdout, /"name": "A"/);
});

test("cases paginate, and get stops when the id appears", async () => {
  const pages = [
    { status: 200, body: { result: [{ uniqueId: 1, title: "一", isDone: true, commongroup: { name: "G" } }], nextPageToken: "100" } },
    { status: 200, body: { result: [{ uniqueId: 2, title: "二", isDone: false }], nextPageToken: "" } },
  ];
  const session = sessionFrom(pages);
  const listed = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN, groupId: GROUP }, { session });
  assert.match(listed.stdout, /#1\t✓\tG\t一/);
  assert.match(listed.stdout, /#2\t✗/);
  assert.equal(listed.stderr, "共 2 条\n");
  assert.match(session.urls[0], new RegExp(`groupId`));
  assert.doesNotMatch(session.urls[0], /pageToken/);
  assert.match(session.urls[1], /pageToken=100/);

  const capped = sessionFrom([{ status: 200, body: { result: [{ uniqueId: 1, title: "x" }], nextPageToken: "next" } }]);
  const limited = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN, maxPages: 2 }, { session: capped });
  assert.equal(capped.urls.length, 2);
  assert.match(limited.stderr, /共 2 条/);

  const empty = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN }, {
    session: sessionFrom([{ status: 200, body: { result: [], nextPageToken: "100" } }]),
  });
  assert.equal(empty.stderr, "共 0 条\n");

  const json = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN, asJson: true }, {
    session: sessionFrom([{ status: 200, body: { result: [{ uniqueId: 4, title: "J" }] } }]),
  });
  assert.equal(json.stderr, "");
  assert.match(json.stdout, /"uniqueId": 4/);

  const denied = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN }, {
    session: sessionFrom([
      { status: 200, body: { result: [{ uniqueId: 1 }], nextPageToken: "100" } },
      { status: 401, body: {} },
    ]),
  });
  assert.equal(denied.stdout, "");
  assert.match(denied.stderr, /未登录/);

  const bad = await executeTestcase({ cmd: "get", projectId: PROJECT, planId: PLAN, uniqueId: "9" }, {
    session: sessionFrom([{ status: 200, body: null }]),
  });
  assert.match(bad.stderr, /响应 JSON 解析失败/);

  const missing = await executeTestcase({ cmd: "get", projectId: PROJECT, planId: PLAN, uniqueId: "9" }, {
    session: sessionFrom([{ status: 200, body: { result: [{ uniqueId: 1, title: "no" }] } }]),
  });
  assert.match(missing.stderr, /计划内未找到用例 #9/);

  const found = await executeTestcase({ cmd: "get", projectId: PROJECT, planId: PLAN, uniqueId: "2" }, {
    session: sessionFrom([
      { status: 200, body: { result: [{ uniqueId: 1, title: "skip" }], nextPageToken: "100" } },
      { status: 200, body: { result: [{ uniqueId: "2", title: "命中", isDone: true, priority: 1, precondition: "就绪", steps: [{ desc: "点", expected: "开" }] }], nextPageToken: "200" } },
    ]),
  });
  assert.match(found.stdout, /#2 命中/);
  assert.match(found.stdout, /优先级: 高/);
  assert.match(found.stdout, /前置条件: 就绪/);
  const foundSessionUrls = 2;
  assert.equal(foundSessionUrls, 2);

  const asJson = await executeTestcase({ cmd: "get", projectId: PROJECT, planId: PLAN, uniqueId: 3, asJson: true }, {
    session: sessionFrom([{ status: 200, body: { result: [{ uniqueId: 3, title: "JSON" }] } }]),
  });
  assert.match(asJson.stdout, /"title": "JSON"/);

  const http = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN }, {
    session: sessionFrom([{ status: 502, body: { result: [] } }]),
  });
  assert.match(http.stderr, /HTTP 502/);
});

test("open transport does not call page.fetch", async () => {
  const session = sessionFrom([]);
  const result = await executeTestcase({ cmd: "cases", projectId: PROJECT, planId: PLAN, transport: "open" }, { session });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Phase 1/);
  assert.equal(session.urls.length, 0);
  const weird = await executeTestcase({ cmd: "plan", projectId: PROJECT, planId: PLAN, transport: "socket" }, { session });
  assert.match(weird.stderr, /Unknown transport/);
  const thrown = sessionFrom([{ throw: "page down" }]);
  const crashed = await executeTestcase({ cmd: "plan", projectId: PROJECT, planId: PLAN }, { session: thrown });
  assert.match(crashed.stderr, /page down/);
});

test("parse-url stays local and the launcher soft-fails without ego", async () => {
  const url = `https://www.teambition.com/project/${PROJECT}/testplan/${PLAN}/group/${GROUP}`;
  const parsed = await runTestcaseCli(["parse-url", url], host());
  assert.equal(parsed.stdout, `${PROJECT}\t${PLAN}\t${GROUP}\n`);
  const bare = await runTestcaseCli(["parse-url", `https://www.teambition.com/project/${PROJECT}/testplan/${PLAN}`]);
  assert.equal(bare.stdout, `${PROJECT}\t${PLAN}\t\n`);
  const bad = await runTestcaseCli(["parse-url", "https://example.test/nope"]);
  assert.match(bad.stderr, /无法解析 URL/);
  assert.equal((await runTestcaseCli(["parse-url"])).exitCode, 1);
  assert.equal((await runTestcaseCli(["--help"])).exitCode, 0);
  assert.equal((await runTestcaseCli([])).exitCode, 1);
  assert.match((await runTestcaseCli(["nope"])).stdout, /Phase 1/);
  assert.match((await runTestcaseCli(["plan", "--group"])).stderr, /--group 需要分组 ID/);
  assert.match((await runTestcaseCli(["plan", PROJECT])).stderr, /缺少 projectId/);

  let spawned = 0;
  const missing = await runTestcaseCli(["plan", PROJECT, PLAN], host({
    whichEgo: () => null,
    spawn() { spawned += 1; },
  }));
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stdout, /ego-browser not found/);
  assert.equal(spawned, 0);

  const probed = await runTestcaseCli(["cleanup"], host({
    whichEgo: undefined,
    spawnSync: () => ({ error: new Error("missing") }),
    spawn() { spawned += 1; },
  }));
  assert.equal(probed.exitCode, 2);
});

test("the launcher reads a TBEGO result and reports browser failures", async () => {
  let entry = "";
  const payload = JSON.stringify({ exitCode: 0, stdout: "名称: 计划\n", stderr: "" });
  const ok = await runTestcaseCli(["plan", PROJECT, PLAN, "--json"], host({
    fs: {
      writeFile: async (_file, source) => { entry = source; },
      rm: async () => { throw new Error("rm"); },
    },
    spawn() { return childWith({ stdout: `noise\nTBEGO{bad\nTBEGO${payload}\n` }); },
  }));
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.stdout, "名称: 计划\n");
  assert.match(entry, /tb-testcase api/);
  assert.match(entry, /"asJson":true/);
  assert.match(entry, new RegExp(PROJECT));
  assert.match(renderTestcaseEntry({ config: { cmd: "plan" }, runHref: "file:///run.mjs", sessionHref: "file:///ego.mjs" }), /createEgoSession/);

  const quiet = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ stdout: "TBEGO" + JSON.stringify({ stdout: "已关闭常驻浏览器空间\n" }), code: 0 }); },
  }));
  assert.equal(quiet.exitCode, 0);

  const lost = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ stdout: "no marker", code: 0 }); },
  }));
  assert.equal(lost.exitCode, 1);
  assert.match(lost.stderr, /浏览器执行失败/);

  const coded = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ stderr: "nodejs process exited with code 2", code: 0 }); },
  }));
  assert.equal(coded.exitCode, 2);

  const raw = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ code: 7 }); },
  }));
  assert.equal(raw.exitCode, 7);

  const crashed = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ error: new Error("ENOENT") }); },
  }));
  assert.equal(crashed.exitCode, 1);
  assert.match(crashed.stderr, /ENOENT/);

  const thrown = await runTestcaseCli(["cleanup"], host({
    spawn() { throw new Error("spawn broke"); },
  }));
  assert.match(thrown.stderr, /spawn broke/);

  const closed = await runTestcaseCli(["cleanup"], host({
    spawn() { return childWith({ code: null }); },
  }));
  assert.equal(closed.exitCode, 1);
});
