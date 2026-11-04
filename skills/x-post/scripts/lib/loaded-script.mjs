// Bytes for abs.twimg.com scripts the Ego page has already loaded.
// Node HTTPS to that host can reset (Pro accept4: read ECONNRESET). The browser
// copy does not need another GET: script text, the performance resource list,
// Page.getResourceContent, and Network.getResponseBody.

import { isPublicClientWeb } from "./fetch-public.mjs";

export function sameClientScript(left, right) {
  try {
    const a = new URL(String(left || ""));
    const b = new URL(String(right || ""));
    return a.protocol === "https:"
      && a.hostname === b.hostname
      && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

export function decodeCdpBody(body) {
  if (!body || typeof body !== "object") return "";
  const content = typeof body.content === "string"
    ? body.content
    : (typeof body.body === "string" ? body.body : "");
  if (!content) return "";
  if (body.base64Encoded) {
    try {
      return Buffer.from(content, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return content;
}

export function frameNodes(tree) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    out.push(node);
    for (const child of node.childFrames || []) visit(child);
  };
  visit(tree && tree.frameTree);
  return out;
}

async function pageScriptSnapshot(page) {
  if (!page || typeof page.evaluate !== "function") return { scripts: [], resources: [] };
  try {
    const snap = await page.evaluate(() => {
      const scripts = Array.from(document.scripts || []).map((script) => ({
        src: String(script.src || ""),
        text: String(script.textContent || ""),
      }));
      let resources = [];
      try {
        resources = performance.getEntriesByType("resource").map((entry) => String(entry.name || ""));
      } catch {
        resources = [];
      }
      return { scripts, resources };
    });
    return {
      scripts: Array.isArray(snap && snap.scripts) ? snap.scripts : [],
      resources: Array.isArray(snap && snap.resources) ? snap.resources : [],
    };
  } catch {
    return { scripts: [], resources: [] };
  }
}

function textFromSnapshot(snapshot, url) {
  for (const script of snapshot.scripts || []) {
    if (!sameClientScript(script.src, url)) continue;
    const text = String(script.text || "").trim();
    if (text) return text;
  }
  return "";
}

function resourceAttempts(tree, url, resources) {
  const frames = frameNodes(tree);
  const attempts = [];
  for (const node of frames) {
    const frameId = node.frame && node.frame.id;
    if (!frameId) continue;
    for (const resource of node.resources || []) {
      const resourceUrl = String(resource && resource.url || "");
      if (!sameClientScript(resourceUrl, url)) continue;
      attempts.push({ frameId, url: resourceUrl });
    }
  }
  if (attempts.length) return attempts;
  const main = frames.find((node) => node.frame && node.frame.id);
  if (!main) return attempts;
  for (const loaded of resources || []) {
    if (!sameClientScript(loaded, url)) continue;
    attempts.push({ frameId: main.frame.id, url: String(loaded) });
  }
  return attempts;
}

async function readResourceContent(page, url, resources) {
  if (!page || typeof page.cdp !== "function") return "";
  let tree;
  try {
    tree = await page.cdp("Page.getResourceTree");
  } catch {
    return "";
  }
  for (const attempt of resourceAttempts(tree, url, resources)) {
    try {
      const body = await page.cdp("Page.getResourceContent", attempt);
      const text = decodeCdpBody(body).trim();
      if (text) return text;
    } catch {
      // This frame's copy can be gone while another frame still has it.
    }
  }
  return "";
}

async function readNetworkBody(page, url) {
  if (!page || typeof page.cdp !== "function") return "";
  let tree;
  try {
    tree = await page.cdp("Page.getResourceTree");
  } catch {
    return "";
  }
  for (const node of frameNodes(tree)) {
    for (const resource of node.resources || []) {
      if (!resource || !resource.requestId) continue;
      if (!sameClientScript(resource.url, url)) continue;
      try {
        const body = await page.cdp("Network.getResponseBody", { requestId: resource.requestId });
        const text = decodeCdpBody(body).trim();
        if (text) return text;
      } catch {
        // requestId from another document is not a body.
      }
    }
  }
  return "";
}

export async function readLoadedClientScript(page, url) {
  if (!isPublicClientWeb(url)) return "";
  const snapshot = await pageScriptSnapshot(page);
  const inline = textFromSnapshot(snapshot, url);
  if (inline) return inline;
  const fromResource = await readResourceContent(page, url, snapshot.resources);
  if (fromResource) return fromResource;
  return readNetworkBody(page, url);
}
