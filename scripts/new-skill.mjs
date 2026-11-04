#!/usr/bin/env node
// Copy skills/_template to skills/<id> and replace __SKILL_ID__.
//   npm run new-skill -- <id>
//   node scripts/new-skill.mjs <id>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PLACEHOLDER = "__SKILL_ID__";

export function assertSkillId(id) {
  if (typeof id !== "string" || !SKILL_ID_RE.test(id)) {
    throw new Error(
      `Invalid skill id "${id}". Use lowercase letters, digits, and single hyphens, starting with a letter (example: my-site-download).`,
    );
  }
}

export function copyTemplate({ id, root, templateDir }) {
  assertSkillId(id);
  if (!root || !templateDir) throw new Error("copyTemplate requires root and templateDir");
  if (!fs.existsSync(templateDir)) throw new Error(`Missing template at ${templateDir}`);
  const dest = path.join(root, "skills", id);
  if (fs.existsSync(dest)) throw new Error(`Refusing to overwrite ${dest}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(templateDir, dest, { recursive: true });
  replacePlaceholder(dest, id);
  return dest;
}

function replacePlaceholder(dir, id) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replacePlaceholder(full, id);
      continue;
    }
    if (!entry.isFile()) continue;
    const text = fs.readFileSync(full, "utf8");
    if (!text.includes(PLACEHOLDER)) continue;
    fs.writeFileSync(full, text.replaceAll(PLACEHOLDER, id));
  }
}

function printUsage() {
  return `Usage: node scripts/new-skill.mjs <skill-id>
       npm run new-skill -- <skill-id>

Copies skills/_template to skills/<skill-id> and replaces ${PLACEHOLDER}.
Ids are lowercase, start with a letter, and use single hyphens (my-site-download).
`;
}

export function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = io.root || path.resolve(here, "..");
  const templateDir = io.templateDir || path.join(root, "skills", "_template");
  const id = argv[0];
  if (!id || id === "--help" || id === "-h") {
    stdout.write(printUsage());
    return id ? 0 : 1;
  }
  if (argv.length > 1) {
    stderr.write(`Unexpected extra argument: ${argv[1]}\n${printUsage()}`);
    return 1;
  }
  try {
    const dest = copyTemplate({ id, root, templateDir });
    stdout.write(`Created ${path.relative(root, dest) || dest}\n`);
    stdout.write("Next: replace TEMPLATE notes and example.com, then run npm test.\n");
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main(process.argv.slice(2)));
