import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USAGE, egoMissingSummary, parseSaveDraftArgs } from "./pure.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function whichEgo() {
  const probe = spawnSync("ego-browser", ["--help"], { encoding: "utf8" });
  return probe.error ? null : "ego-browser";
}

export function renderSaveEntry({ config, runHref }) {
  return [
    `import { executeChannelsSave } from ${JSON.stringify(runHref)};`,
    `if (typeof taskSpace !== "function") {`,
    `  console.log(JSON.stringify({ ok: false, save: false, clicked: false, exitCode: 1, reason: "not-inside-ego" }));`,
    `  process.exit(1);`,
    `}`,
    `const config = ${JSON.stringify(config)};`,
    `const task = await taskSpace(config.taskName);`,
    `const page = task.page("p1");`,
    `const result = await executeChannelsSave(config, page);`,
    `console.log(JSON.stringify(result));`,
    `try { await task.finish({ keep: [] }); } catch { /* closing must not hide the result */ }`,
    `if (result.exitCode) process.exitCode = result.exitCode;`,
    "",
  ].join("\n");
}

export async function runSaveCli(argv, deps = {}) {
  const io = {
    fs: deps.fs || fs,
    spawn: deps.spawn || spawn,
    stdout: deps.stdout || process.stdout,
    stderr: deps.stderr || process.stderr,
    whichEgo: deps.whichEgo || whichEgo,
    mkdtemp: deps.mkdtemp || ((prefix) => fs.mkdtemp(prefix)),
    tmp: deps.tmp || os.tmpdir(),
    runModule: deps.runModule || path.join(here, "run-save.mjs"),
  };
  let args;
  try {
    args = parseSaveDraftArgs(argv);
  } catch (error) {
    io.stderr.write(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    io.stdout.write(USAGE);
    return 0;
  }
  if (!io.whichEgo()) {
    io.stdout.write(`${JSON.stringify(egoMissingSummary(), null, 2)}\n`);
    return 2;
  }
  const dir = await io.mkdtemp(path.join(io.tmp, "ego-wechat-channels-save-"));
  const entry = path.join(dir, "entry.mjs");
  await io.fs.writeFile(entry, renderSaveEntry({
    config: {
      yes: args.yes,
      desc: args.desc,
      tags: args.tags,
      coverRequested: args.coverRequested,
      taskName: args.taskName,
    },
    runHref: pathToFileURL(io.runModule).href,
  }));
  const href = pathToFileURL(entry).href;
  const child = io.spawn("ego-browser", ["nodejs", "-e", `await import(${JSON.stringify(href)})`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; io.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { io.stderr.write(chunk); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (!out.trim()) return code || 1;
  return code || 0;
}
