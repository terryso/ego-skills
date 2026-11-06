#!/usr/bin/env node
// Fail when a shipped skill is missing structure, a personal path, or a secret-shaped file.
// Scans skills/* only. Scaffold directories (names starting with _) are skipped.
// Docs outside skills/ are not scanned, so CONTRIBUTING can name the banned prefixes.
//
//   node scripts/check-skill-hygiene.mjs
//   npm run hygiene
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;

const PERSONAL_PATH_RULES = [
  {
    label: "/Users/",
    test(line) {
      return line.includes("/Users/") || /[A-Za-z]:\\Users\\/.test(line);
    },
  },
  {
    label: "/home/<name>/",
    // A username segment is required. A host such as x.com/home/following does not match,
    // because the slash is preceded by a letter or a dot.
    test(line) {
      return /(?:^|[^A-Za-z0-9.])\/home\/[A-Za-z0-9._-]+(?:\/|["']|\s|$)/.test(line);
    },
  },
  {
    label: "podcast directory",
    // Path-shaped only. The word "podcast" in a sentence does not match.
    test(line) {
      return /~\/Podcasts\/|\/Podcasts\//i.test(line);
    },
  },
];

export function extractFrontmatter(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

function unquote(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
    || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function frontmatterName(frontmatter) {
  if (typeof frontmatter !== "string") return null;
  const match = frontmatter.match(/^name:\s*(.+?)\s*$/m);
  return match ? unquote(match[1]) : null;
}

export function frontmatterBins(frontmatter) {
  if (typeof frontmatter !== "string") return [];
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^(\s*)bins:\s*(.*)$/);
    if (!header) continue;
    const inline = header[2].trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      return inline
        .slice(1, -1)
        .split(",")
        .map((item) => unquote(item))
        .filter(Boolean);
    }
    const bins = [];
    const indent = header[1].length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() === "") continue;
      const current = line.match(/^(\s*)/)[1].length;
      if (current <= indent) break;
      const item = line.trim().match(/^-\s+(.+)$/);
      if (!item) break;
      bins.push(unquote(item[1]));
    }
    return bins;
  }
  return [];
}

export function findPersonalPaths(text) {
  if (typeof text !== "string" || text.includes("\0")) return [];
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of PERSONAL_PATH_RULES) {
      if (!rule.test(lines[index])) continue;
      hits.push({ line: index + 1, label: rule.label });
    }
  }
  return hits;
}

export function isSecretFileName(rel) {
  const base = path.posix.basename(String(rel).split("\\").join("/"));
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|p8|pfx|p12|key)$/i.test(base)) return true;
  if (/^AuthKey_.+\.p8$/i.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(base)) return true;
  if (/^cookies?\.(txt|json|jsonl|sqlite|sqlite3|db|jar|dump)$/i.test(base)) return true;
  if (/cookie[-_.]?(dump|jar|store)/i.test(base)) return true;
  return false;
}

export function isSkillTestFile(rel) {
  const norm = String(rel).split("\\").join("/");
  return norm.startsWith("scripts/test/") && norm.endsWith(".test.mjs");
}

export function isScaffoldSkill(id) {
  return typeof id === "string" && id.startsWith("_");
}

function finding(fields) {
  return {
    skill: fields.skill || null,
    file: fields.file || null,
    line: fields.line || null,
    code: fields.code,
    message: fields.message,
  };
}

function walkFiles(dir, fsImpl) {
  const out = [];
  if (!fsImpl.existsSync(dir)) return out;
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "coverage") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of walkFiles(abs, fsImpl)) {
        out.push({ rel: `${entry.name}/${child.rel}`, text: child.text });
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const buf = fsImpl.readFileSync(abs);
    const binary = buf.includes(0);
    out.push({ rel: entry.name, text: binary ? null : buf.toString("utf8") });
  }
  return out;
}

export function auditSkillDir(dir, id, fsImpl = fs) {
  const findings = [];
  const skillFile = path.join(dir, "SKILL.md");
  if (!fsImpl.existsSync(skillFile)) {
    findings.push(finding({
      skill: id,
      code: "missing-skill-md",
      message: `skills/${id}/SKILL.md is missing`,
    }));
  } else {
    const skillText = fsImpl.readFileSync(skillFile, "utf8");
    const frontmatter = extractFrontmatter(skillText);
    const name = frontmatterName(frontmatter);
    if (name !== id) {
      findings.push(finding({
        skill: id,
        file: `skills/${id}/SKILL.md`,
        code: "name-mismatch",
        message: `skills/${id}/SKILL.md frontmatter name is ${name == null ? "missing" : JSON.stringify(name)}; expected ${JSON.stringify(id)}`,
      }));
    }
    if (!frontmatterBins(frontmatter).includes("ego-browser")) {
      findings.push(finding({
        skill: id,
        file: `skills/${id}/SKILL.md`,
        code: "missing-ego-browser",
        message: `skills/${id}/SKILL.md metadata.requires.bins does not include ego-browser`,
      }));
    }
  }

  const files = walkFiles(dir, fsImpl);
  if (!files.some((file) => isSkillTestFile(file.rel))) {
    findings.push(finding({
      skill: id,
      code: "missing-tests",
      message: `skills/${id}/scripts/test/ needs at least one *.test.mjs file`,
    }));
  }

  for (const file of files) {
    const display = `skills/${id}/${file.rel}`;
    if (isSecretFileName(file.rel)) {
      findings.push(finding({
        skill: id,
        file: display,
        code: "secret-file",
        message: `${display} is a secret-shaped file`,
      }));
    }
    if (file.text == null) continue;
    if (PRIVATE_KEY_RE.test(file.text)) {
      findings.push(finding({
        skill: id,
        file: display,
        code: "private-key",
        message: `${display} contains a private key block`,
      }));
    }
    for (const hit of findPersonalPaths(file.text)) {
      findings.push(finding({
        skill: id,
        file: display,
        line: hit.line,
        code: "personal-path",
        message: `${display}:${hit.line} contains personal path ${hit.label}`,
      }));
    }
  }
  return findings;
}

export function auditRepo(root, fsImpl = fs) {
  const skillsRoot = path.join(root, "skills");
  if (!fsImpl.existsSync(skillsRoot)) {
    return [finding({
      code: "missing-skills",
      message: `skills/ is missing under ${root}`,
    })];
  }
  const findings = [];
  for (const entry of fsImpl.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || isScaffoldSkill(entry.name)) continue;
    findings.push(...auditSkillDir(path.join(skillsRoot, entry.name), entry.name, fsImpl));
  }
  return findings;
}

function usage() {
  return `Usage: node scripts/check-skill-hygiene.mjs

Checks each skills/* directory except scaffolds (names starting with _).
Fails when SKILL.md is missing, frontmatter name differs from the directory,
metadata.requires.bins omits ego-browser, the tree contains a personal path
(/Users/, /home/<name>/, or a /Podcasts/ or ~/Podcasts/ directory) or a
secret-shaped file, or scripts/test/ has no *.test.mjs file.
Does not scan docs/ or README files.
`;
}

export function main(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const fsImpl = io.fs || fs;
  if (argv.includes("--help") || argv.includes("-h")) {
    stdout.write(usage());
    return 0;
  }
  if (argv.length > 0) {
    stderr.write(`Unknown argument: ${argv[0]}\n${usage()}`);
    return 1;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = io.root || path.resolve(here, "..");
  const findings = auditRepo(root, fsImpl);
  if (findings.length === 0) {
    stdout.write("skill hygiene ok\n");
    return 0;
  }
  for (const item of findings) stderr.write(`${item.message}\n`);
  stderr.write(`${findings.length} hygiene problem(s)\n`);
  return 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main(process.argv.slice(2)));
