import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { zhihuAct } from "../lib/dom.mjs";

function chromeBin() {
  const found = ["google-chrome", "chromium", "chromium-browser"].find((name) => {
    const probe = spawnSync(name, ["--version"], { encoding: "utf8" });
    return probe.status === 0;
  });
  return found || "";
}

function runProductionAct(html) {
  const root = mkdtempSync(path.join(tmpdir(), "zhihu-browser-"));
  const file = path.join(root, "editor.html");
  writeFileSync(file, html);
  const bin = chromeBin();
  assert.ok(bin, "a local Chrome or Chromium binary is required for the real DOM gate");
  const profile = path.join(root, "profile");
  const stdout = openSync(path.join(root, "dom.html"), "w");
  const stderr = openSync(path.join(root, "chrome.err"), "w");
  spawnSync("timeout", [
    "12", bin,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profile}`,
    "--timeout=3000",
    "--virtual-time-budget=1500",
    "--dump-dom",
    `file://${file}`,
  ], { cwd: root, stdio: ["ignore", stdout, stderr] });
  const dom = readFileSync(path.join(root, "dom.html"), "utf8");
  const match = dom.match(/data-result="([^"]*)"/);
  assert.ok(match, `browser harness produced no result: ${dom.slice(0, 400)}`);
  return JSON.parse(match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">"));
}

test("synthetic childNodes arrays do not stand in for a browser NodeList", () => {
  const result = runProductionAct(`<!doctype html><meta charset="utf-8"><title>写文章 - 知乎</title>
<textarea placeholder="请输入标题（最多 100 个字）"></textarea>
<div class="public-DraftEditor-content" contenteditable="true" id="body">
  <p id="lead-a">这是导语</p>
  <p id="lead-b">这是导语</p>
  <p id="other">别的段落</p>
  <figure id="done"><img src="https://pic1.zhimg.com/done.png" alt=""></figure>
  <div id="pending">图片上传中<img src="blob:pending" alt=""></div>
</div>
<script>
const zhihuAct = ${zhihuAct.toString()};
const body = document.getElementById("body");
const events = [];
body.addEventListener("beforeinput", () => events.push("beforeinput"));
body.addEventListener("input", () => events.push("input"));
const lead = document.getElementById("lead-a").textContent;
const nodeList = document.body.childNodes;
let filterError = "";
try { nodeList.filter(() => true); } catch (error) { filterError = error.message; }
let assignChanged = false;
try { body.childNodes = []; } catch { assignChanged = true; }
assignChanged = assignChanged || body.childNodes.length === 0;
const removeResult = zhihuAct({ op: "remove-duplicate-lead", lead });
const clearResult = zhihuAct({ op: "clear-pending-upload" });
document.documentElement.setAttribute("data-result", JSON.stringify({
  filterError,
  filterType: typeof nodeList.filter,
  nodeList: nodeList.constructor.name,
  assignChanged,
  removeResult,
  clearResult,
  leadCount: [...document.querySelectorAll("p")].filter((node) => node.textContent === lead).length,
  other: document.getElementById("other").isConnected,
  done: document.getElementById("done").isConnected,
  pending: document.getElementById("pending").isConnected,
  events,
}));
</script>`);

  assert.equal(result.nodeList, "NodeList");
  assert.equal(result.filterType, "undefined");
  assert.match(result.filterError, /filter is not a function/);
  assert.equal(result.assignChanged, false);
  assert.equal(result.removeResult.mutated, false);
  assert.equal(result.removeResult.error, "editor-mutation-unverified");
  assert.equal(result.clearResult.mutated, false);
  assert.equal(result.clearResult.error, "editor-mutation-unverified");
  assert.equal(result.leadCount, 2);
  assert.equal(result.other, true);
  assert.equal(result.done, true);
  assert.equal(result.pending, true);
  assert.deepEqual(result.events, []);
});
