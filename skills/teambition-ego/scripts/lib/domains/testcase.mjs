import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { whichEgo } from "../launch-check.mjs";
import {
  MAX_PAGES,
  RESULT_TAG,
  SPACE_NAME,
  USAGE,
  buildCaseQueryUrl,
  buildTql,
  egoMissingSummary,
  extractTaggedJson,
  formatCase,
  formatCases,
  formatGroups,
  formatPlan,
  groupsEndpoint,
  interpretFetch,
  mapBrowserError,
  missingIds,
  parsePlanUrl,
  parseTestcaseArgs,
  planEndpoint,
  resolveProcessExit,
} from "../pure.mjs";
import { createTransport } from "../session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fail(message, code = 1) {
  return { exitCode: code, stdout: "", stderr: `错误: ${message}\n` };
}

function ok(stdout, stderr = "") {
  return { exitCode: 0, stdout, stderr };
}

export async function collectCases(session, config) {
  const tql = buildTql(config.planId, config.mode === "cases" ? config.groupId : "");
  const maxPages = config.maxPages || MAX_PAGES;
  const out = [];
  let token = "";
  let pages = 0;
  let found = null;
  while (pages < maxPages) {
    const url = buildCaseQueryUrl({
      projectId: config.projectId,
      tql,
      pageToken: token,
      needResult: config.needResult !== false,
    });
    const fetchPage = config.fetch || ((nextUrl, opts) => session.fetch(nextUrl, opts));
    const response = await fetchPage(url, { timeout: 30_000 });
    const status = response && response.status != null ? response.status : 200;
    if (status === 401) return { error: "401 未登录" };
    if (status !== 200) return { error: `HTTP ${status}` };
    const body = response ? response.body : null;
    if (!body || typeof body !== "object") return { error: "响应 JSON 解析失败" };
    const rows = Array.isArray(body.result) ? body.result : [];
    if (config.mode === "get") {
      found = rows.find((item) => String(item.uniqueId) === String(config.uniqueId)) || null;
      if (found) break;
    } else {
      out.push(...rows);
    }
    pages += 1;
    token = body.nextPageToken || "";
    if (!token || rows.length === 0) break;
  }
  if (config.mode === "get") return { found };
  return { cases: out };
}

export async function executeTestcase(config, { session, transport } = {}) {
  const cmd = config.cmd;
  try {
    if (cmd === "cleanup") {
      await session.cleanup();
      return ok("已关闭常驻浏览器空间\n");
    }
    if (cmd !== "plan" && cmd !== "groups" && cmd !== "cases" && cmd !== "get") {
      return fail(`未知命令: ${cmd || ""}`);
    }
    const idError = missingIds(cmd, [cmd, config.projectId, config.planId, config.uniqueId]);
    if (idError) return fail(idError);
    if (typeof session.ensureSite === "function") await session.ensureSite();
    const link = transport || createTransport(config.transport || "browser", session);
    if (cmd === "plan") {
      const payload = await link.request(planEndpoint(config.projectId, config.planId));
      const checked = interpretFetch(payload);
      if (checked.error) return fail(checked.error);
      return ok(formatPlan(checked.body, config.asJson));
    }
    if (cmd === "groups") {
      const payload = await link.request(groupsEndpoint(config.projectId, config.planId));
      const checked = interpretFetch(payload);
      if (checked.error) return fail(checked.error);
      return ok(formatGroups(checked.body, config.asJson));
    }
    const collected = await collectCases(session, {
      mode: cmd,
      projectId: config.projectId,
      planId: config.planId,
      groupId: config.groupId,
      uniqueId: config.uniqueId,
      needResult: true,
      maxPages: config.maxPages,
      fetch: (url, opts) => link.request(url, opts),
    });
    if (collected.error) return fail(mapBrowserError(collected.error));
    if (cmd === "get") {
      if (collected.found == null) return fail(`计划内未找到用例 #${config.uniqueId}`);
      return ok(formatCase(collected.found, config.asJson));
    }
    const formatted = formatCases(collected.cases, config.asJson);
    return ok(formatted.stdout, formatted.stderr);
  } catch (error) {
    return fail(error && error.message ? error.message : String(error));
  }
}

export function renderTestcaseEntry({ config, runHref, sessionHref }) {
  return [
    `import { executeTestcase } from ${JSON.stringify(runHref)};`,
    `import { createEgoSession } from ${JSON.stringify(sessionHref)};`,
    `const config = ${JSON.stringify(config)};`,
    `const session = await createEgoSession(config);`,
    `const result = await executeTestcase(config, { session });`,
    `console.log(${JSON.stringify(RESULT_TAG)} + JSON.stringify(result));`,
    `if (result.exitCode) process.exitCode = result.exitCode;`,
    "",
  ].join("\n");
}

async function launchTestcase(config, deps) {
  const io = {
    fs: deps.fs || fs,
    spawn: deps.spawn || spawn,
    spawnSync: deps.spawnSync,
    whichEgo: deps.whichEgo,
    mkdtemp: deps.mkdtemp || ((prefix) => fs.mkdtemp(prefix)),
    tmp: deps.tmp || os.tmpdir(),
    runModule: deps.runModule || path.join(here, "testcase.mjs"),
    egoModule: deps.egoModule || path.join(here, "..", "ego-deps.mjs"),
  };
  const detect = io.whichEgo || ((impl) => whichEgo(impl || io.spawnSync));
  if (!detect(io.spawnSync)) {
    const summary = egoMissingSummary(config.cmd || "testcase");
    return {
      exitCode: 2,
      stdout: `${JSON.stringify(summary, null, 2)}\n`,
      stderr: "",
    };
  }

  const dir = await io.mkdtemp(path.join(io.tmp, "ego-teambition-tb-"));
  const entry = path.join(dir, "entry.mjs");
  let stdoutBuf = "";
  let stderrBuf = "";
  let code = 1;
  try {
    await io.fs.writeFile(
      entry,
      renderTestcaseEntry({
        config,
        runHref: pathToFileURL(io.runModule).href,
        sessionHref: pathToFileURL(io.egoModule).href,
      }),
    );
    const href = pathToFileURL(entry).href;
    const child = io.spawn("ego-browser", ["nodejs", "-e", `await import(${JSON.stringify(href)})`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
    });
    code = await new Promise((resolve) => {
      child.on("error", (error) => {
        stderrBuf += String(error.message || error);
        resolve(1);
      });
      child.on("close", (status) => resolve(status ?? 1));
    });
  } catch (error) {
    stderrBuf += String(error && error.message ? error.message : error);
    code = 1;
  } finally {
    if (io.fs.rm) await io.fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const combined = `${stdoutBuf}\n${stderrBuf}`;
  const result = extractTaggedJson(combined, RESULT_TAG);
  if (result && typeof result === "object") {
    return {
      exitCode: typeof result.exitCode === "number" ? result.exitCode : resolveProcessExit(combined, code),
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }
  const tail = combined.trim().slice(-300);
  const resolved = resolveProcessExit(combined, code);
  return {
    exitCode: code === 0 && resolved === 0 ? 1 : resolved,
    stdout: "",
    stderr: `错误: 浏览器执行失败（exit=${code}）: ${tail}\n`,
  };
}

export async function runTestcaseCli(argv, deps = {}) {
  const parsed = parseTestcaseArgs(argv);
  if (parsed.error) return fail(parsed.error);
  if (parsed.help || !parsed.cmd) {
    return { exitCode: parsed.help ? 0 : 1, stdout: USAGE, stderr: "" };
  }
  if (parsed.cmd === "parse-url") {
    const idError = missingIds("parse-url", parsed.positional);
    if (idError) return fail(idError);
    const ids = parsePlanUrl(parsed.positional[1]);
    if (!ids) {
      return fail("无法解析 URL，期望格式 .../project/{projectId}/testplan/{planId}/group/{groupId}");
    }
    return ok(`${ids.projectId}\t${ids.planId}\t${ids.groupId}\n`);
  }
  if (!["plan", "groups", "cases", "get", "cleanup"].includes(parsed.cmd)) {
    return { exitCode: 1, stdout: USAGE, stderr: "" };
  }
  const idError = missingIds(parsed.cmd, parsed.positional);
  if (idError) return fail(idError);
  const ids = parsed.positional.slice(1);
  const config = {
    cmd: parsed.cmd,
    asJson: Boolean(parsed.asJson),
    projectId: ids[0],
    planId: ids[1],
    uniqueId: ids[2],
    groupId: parsed.groupId || "",
    taskName: SPACE_NAME,
    transport: "browser",
  };
  return launchTestcase(config, deps);
}
