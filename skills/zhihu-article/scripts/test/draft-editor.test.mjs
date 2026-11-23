import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { zhihuAct } from "../lib/dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function chromeBin() {
  return ["google-chrome", "chromium", "chromium-browser"].find((name) => spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0) || "";
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForTarget(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // Chrome is still opening the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("chrome debugging port did not expose a page");
}

function connect(url) {
  const ws = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("cdp socket failed")));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || "cdp error"));
    else resolve(message.result);
  });
  return {
    ready,
    call(method, params = {}) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(details.exception && details.exception.description || details.text || JSON.stringify(details));
  }
  return result.result.value;
}

async function keyEvent(cdp, type, key, code, keyCode, modifiers) {
  await cdp.call("Input.dispatchKeyEvent", {
    type,
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
}

test("Draft.js keeps a keyboard delete and paste after reload", { timeout: 60000 }, async () => {
  const bin = chromeBin();
  assert.ok(bin, "a local Chrome or Chromium binary is required");
  const root = mkdtempSync(path.join(tmpdir(), "zhihu-draft-"));
  const bundled = path.join(root, "editor.js");
  await esbuild.build({
    entryPoints: [path.join(here, "draft-fixture", "editor.jsx")],
    bundle: true,
    format: "iife",
    outfile: bundled,
    define: { "process.env.NODE_ENV": "\"production\"" },
    banner: { js: "var global = globalThis;" },
    jsx: "automatic",
  });
  writeFileSync(path.join(root, "index.html"), `<!doctype html><meta charset="utf-8"><title>写文章 - 知乎</title>
<style>.public-DraftEditor-content,.DraftEditor-root{min-height:140px}</style>
<div id="root"></div>
<script>window.__errors=[];addEventListener("error",(event)=>window.__errors.push(String(event.message)));</script>
<script src="/editor.js"></script>`);
  const server = http.createServer((request, response) => {
    const file = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const target = path.join(root, file);
    try {
      const body = readFileSync(target);
      response.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  const pagePort = await listen(server);
  const debugPort = 9340 + (pagePort % 100);
  mkdirSync(path.join(root, "profile"), { recursive: true });
  const chrome = spawn(bin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(root, "profile")}`,
    `http://127.0.0.1:${pagePort}/`,
  ], { stdio: "ignore" });
  let cdp;
  try {
    const target = await waitForTarget(debugPort);
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call("Runtime.enable");
    const ready = await evaluate(cdp, `new Promise((resolve) => {
      const started = Date.now();
      const tick = () => window.__fixture ? resolve("ready") : (Date.now() - started > 8000 ? resolve("missing") : setTimeout(tick, 50));
      tick();
    })`);
    if (ready !== "ready") {
      const diagnostic = await evaluate(cdp, `({ errors: window.__errors || [], text: document.body ? document.body.innerText.slice(0, 400) : "" })`);
      throw new Error(`editor did not mount: ${JSON.stringify(diagnostic)}`);
    }
    const before = await evaluate(cdp, `({
      plain: window.__fixture.plain(),
      blocks: window.__fixture.blockCount(),
      title: window.__fixture.title(),
    })`);
    assert.equal(before.plain, "这是导语\n这是导语\n别的段落");
    assert.equal(before.blocks, 3);
    assert.equal(before.title, "技能验收测试草稿");
    const structure = await evaluate(cdp, `(() => {
      const zhihuAct = ${zhihuAct.toString()};
      const read = zhihuAct({ op: "read" });
      return { tags: (read.blocks || []).map((item) => item.tag), count: (read.blocks || []).length, text: (read.blocks || []).map((item) => item.text) };
    })()`);
    assert.ok(structure.count >= 3, `expected Draft data-blocks, got ${structure.count}`);
    assert.equal(structure.tags.includes("DIV") || structure.tags.length >= 3, true);
    assert.equal(structure.text.filter((item) => item.includes("这是导语")).length, 2);

    await evaluate(cdp, `document.querySelector(".public-DraftEditor-content").focus()`);
    await keyEvent(cdp, "rawKeyDown", "Control", "ControlLeft", 17, 2);
    await keyEvent(cdp, "keyDown", "a", "KeyA", 65, 2);
    await keyEvent(cdp, "keyUp", "a", "KeyA", 65, 2);
    await keyEvent(cdp, "keyUp", "Control", "ControlLeft", 17, 0);
    const selected = await evaluate(cdp, `({
      text: getSelection().toString(),
      title: document.querySelector("#title").value,
      inside: document.querySelector(".public-DraftEditor-content").contains(getSelection().anchorNode),
    })`);
    assert.equal(selected.inside, true);
    assert.equal(selected.title, "技能验收测试草稿");
    assert.equal(selected.text.includes("技能验收测试草稿"), false);
    assert.equal(selected.text.split("这是导语").length - 1, 2);

    await keyEvent(cdp, "rawKeyDown", "Backspace", "Backspace", 8, 0);
    await keyEvent(cdp, "keyUp", "Backspace", "Backspace", 8, 0);
    const cleared = await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => resolve({
      plain: window.__fixture.plain(),
      title: window.__fixture.title(),
    })))`);
    assert.equal(cleared.plain, "");
    assert.equal(cleared.title, "技能验收测试草稿");

    const pasted = await evaluate(cdp, `(() => {
      const el = document.querySelector(".public-DraftEditor-content");
      el.focus();
      const data = new DataTransfer();
      data.setData("text/plain", "新导语\\n排版检查");
      data.setData("text/html", "<p>新导语</p><h2>排版检查</h2>");
      return el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    })()`);
    assert.equal(pasted, false);
    const replaced = await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => resolve(window.__fixture.plain())))`);
    assert.equal(replaced.split("新导语").length - 1, 1);
    assert.equal(replaced.includes("这是导语"), false);

    await cdp.call("Page.reload", { ignoreCache: true });
    await evaluate(cdp, `new Promise((resolve) => {
      const started = Date.now();
      const tick = () => window.__fixture ? resolve(true) : (Date.now() - started > 8000 ? resolve(false) : setTimeout(tick, 50));
      tick();
    })`);
    const reloaded = await evaluate(cdp, `window.__fixture.plain()`);
    assert.equal(reloaded.split("新导语").length - 1, 1);
    assert.equal(reloaded.includes("这是导语"), false);

    const sabotaged = await evaluate(cdp, `(() => {
      document.querySelector(".public-DraftEditor-content").innerHTML = "<p>被篡改</p>";
      return {
        plain: window.__fixture.plain(),
        dom: document.querySelector(".public-DraftEditor-content").innerText,
      };
    })()`);
    assert.equal(sabotaged.plain.includes("新导语"), true);
    assert.equal(sabotaged.dom.includes("被篡改"), true);
    await cdp.call("Page.reload", { ignoreCache: true });
    await evaluate(cdp, `new Promise((resolve) => {
      const started = Date.now();
      const tick = () => window.__fixture ? resolve(true) : (Date.now() - started > 8000 ? resolve(false) : setTimeout(tick, 50));
      tick();
    })`);
    const restored = await evaluate(cdp, `({
      plain: window.__fixture.plain(),
      dom: document.querySelector(".public-DraftEditor-content").innerText,
    })`);
    assert.equal(restored.plain.includes("新导语"), true);
    assert.equal(restored.plain.includes("这是导语"), false);
    assert.equal(restored.dom.includes("被篡改"), false);
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});
