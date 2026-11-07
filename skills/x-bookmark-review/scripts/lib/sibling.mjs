// x-bookmark-review reads the archive implementation from the sibling export skill.
// Installed layouts keep the two skill directories next to each other.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function exportStoreFile(fromDir = path.dirname(fileURLToPath(import.meta.url))) {
  return path.resolve(fromDir, "../../../x-bookmark-export/scripts/lib/store.mjs");
}

export function siblingStatus(fromDir) {
  const storeFile = exportStoreFile(fromDir);
  return {
    ok: fs.existsSync(storeFile),
    store_file: storeFile,
    ego_browser_invoked: false,
  };
}
