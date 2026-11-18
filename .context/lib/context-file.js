// Reading, generating and patching the target repo's context.md.
// The file is divided into:
//   - agent-maintained sections (Purpose, Key Knowledge, Current Focus)
//   - auto-managed sections wrapped in `context-md:<name>:start/end` markers
// Hooks only ever touch the marked sections; the agent owns the rest.
import fs from 'node:fs';
import path from 'node:path';
import { buildSnapshot, buildStructure, findRoot } from './scan.js';

// ---------- write safety (symlinks + atomicity) ----------

export function assertNotSymlink(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return; // does not exist yet — fine to create
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing to write through symlink: ${file}`);
  }
}

// Atomic write: refuse symlinks, write tmp sibling, rename over the target.
export function atomicWriteFile(file, content) {
  assertNotSymlink(file);
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

const SNAP_START = '<!-- context-md:snapshot:start -->';
const SNAP_END = '<!-- context-md:snapshot:end -->';
const STRUCT_START = '<!-- context-md:structure:start -->';
const STRUCT_END = '<!-- context-md:structure:end -->';
const LOG_START = '<!-- context-md:log:start -->';
const LOG_END = '<!-- context-md:log:end -->';

export function contextPath(root) {
  return path.join(root, 'context.md');
}

function replaceBetween(content, startMarker, endMarker, body) {
  const s = content.indexOf(startMarker);
  const e = content.indexOf(endMarker);
  if (s === -1 || e === -1 || e < s) {
    throw new Error(`context.md is missing ${startMarker} / ${endMarker} — was it hand-edited? Run \`context-md refresh\`.`);
  }
  return content.slice(0, s + startMarker.length) + '\n' + body.trim() + '\n' + content.slice(e);
}

function getBetween(content, startMarker, endMarker) {
  const s = content.indexOf(startMarker);
  const e = content.indexOf(endMarker);
  if (s === -1 || e === -1 || e < s) return null;
  return content.slice(s + startMarker.length, e).trim();
}

function initialTemplate(root) {
  const snapshot = buildSnapshot(root);
  const structure = buildStructure(root);
  return `# context.md — live project context

> Maintained by **context-md**. Every AI agent working in this repo MUST read this file
> BEFORE doing anything, and update it as the project changes.
> Sections between \`context-md:*\` markers are auto-managed by hooks — do not edit inside them.
> Everything else is yours to keep current: Purpose, Key Knowledge, Current Focus.

## Snapshot

${SNAP_START}
${snapshot}
${SNAP_END}

## Structure

${STRUCT_START}
${structure}
${STRUCT_END}

## Purpose

- (Agent: after your first look at the repo, replace this line with what this project actually is.)

## Key Knowledge

- Stack & architecture: (agent: fill in decisions, patterns, constraints — e.g. "auth via Supabase", "state in Zustand", "no ORMs")
- Conventions: (agent: naming, testing, formatting, commit style observed in this repo)
- Gotchas: (agent: non-obvious things that would bite a newcomer — e.g. generated files, flaky tests, env vars required)

## Current Focus / Next Steps

- (Agent: what is actively being worked on right now, and what comes next.)

## Change Log

${LOG_START}
- ${new Date().toISOString()} context.md created by context-md
${LOG_END}
`;
}

export function ensureContextFile(root, { refresh = true } = {}) {
  const file = contextPath(root);
  if (!fs.existsSync(file)) {
    atomicWriteFile(file, initialTemplate(root));
    return { created: true, file };
  }
  if (refresh) refreshDeterministic(root);
  return { created: false, file };
}

export function refreshDeterministic(root) {
  const file = contextPath(root);
  if (!fs.existsSync(file)) return ensureContextFile(root);
  let content = fs.readFileSync(file, 'utf8');
  content = replaceBetween(content, SNAP_START, SNAP_END, buildSnapshot(root));
  content = replaceBetween(content, STRUCT_START, STRUCT_END, buildStructure(root));
  atomicWriteFile(file, content);
  return { file };
}

export function appendChangeLog(root, entry, { cap = 100 } = {}) {
  const file = contextPath(root);
  if (!fs.existsSync(file)) ensureContextFile(root, { refresh: false });
  let content = fs.readFileSync(file, 'utf8');
  const previous = getBetween(content, LOG_START, LOG_END) || '';
  const stamp = new Date().toISOString();
  const line = `- ${stamp} ${entry}`;
  const lines = previous ? previous.split('\n') : [];
  lines.push(line);
  const trimmed = lines.slice(-cap).join('\n');
  content = replaceBetween(content, LOG_START, LOG_END, trimmed);
  atomicWriteFile(file, content);
  return line;
}

// Re-export for hook convenience.
export { findRoot };

export function extractChangedFile(toolInput) {
  if (!toolInput) return null;
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 3) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === 'string' && /^(file_path|filePath|target_file)$/i.test(key)) {
        if (v.length > 1 && v.length < 300 && !v.includes('\n')) return v;
      }
    }
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === 'string' && /^(path|filename|file)$/i.test(key)) {
        if (v.length > 1 && v.length < 300 && !v.includes('\n')) return v;
      }
    }
    for (const v of Object.values(value)) {
      const found = visit(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(toolInput, 0);
}
