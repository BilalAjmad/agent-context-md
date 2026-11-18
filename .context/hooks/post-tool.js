#!/usr/bin/env node
// context-md post-tool hook.
// Appends a timestamped entry to context.md's Change Log on every file edit.
// Also refreshes the deterministic snapshot when a stack manifest changed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRANDPARENT = path.basename(path.resolve(__dirname, '..'));
const HOOK_IS_GLOBAL = GRANDPARENT !== '.context';
const RUNTIME_LIB = path.resolve(__dirname, '..', 'lib', 'context-file.js');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8'); // stdin
} catch { /* no stdin */ }

let input = {};
try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

let lib = null;
try { lib = await import(pathToFileURL(RUNTIME_LIB).href); } catch { process.stdout.write('{}'); process.exit(0); }

const root = (() => { try { return lib.findRoot(process.cwd()) || path.resolve(__dirname, '..', '..'); } catch { return path.resolve(__dirname, '..', '..'); } })();

// Global runtime defers to a repo's local runtime when present, and activates
// only in project-like folders (.git or a known manifest).
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile', 'composer.json', 'requirements.txt', 'setup.py', 'Dockerfile', '.git'];
const projectLike = MANIFESTS.some((m) => fs.existsSync(path.join(root, m)));
if (HOOK_IS_GLOBAL && (fs.existsSync(path.join(root, '.context', 'lib', 'context-file.js')) || !projectLike)) {
  process.stdout.write('{}');
  process.exit(0);
}

try {
  const changed = lib.extractChangedFile(input.tool_input ?? input);
  // Strip control chars so repo-controlled paths cannot smuggle escape/formatting
  // sequences into the shared context.md (best-effort containment).
  const changedSafe = changed ? String(changed).replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, 300) : null;
  const ts = new Date().toISOString();
  const cmdText = (() => { try { const t = input.tool_input ?? input ?? {}; const c = t.command ?? t.cmd ?? t.script ?? t.patch ?? t.input; return typeof c === 'string' ? c.slice(0, 4000) : ''; } catch { return ''; } })();
  // Nested-path safe: normalize (absolute → relative) before comparing to root context.md (#32).
  const rel = changed ? path.normalize(path.isAbsolute(changed) ? path.relative(root, changed) : changed) : null;
  const ctxTouchFromPath = rel === 'context.md';
  // Best-effort: a shell command that writes context.md also counts as touching it (#31).
  const ctxTouchFromCmd = Boolean(cmdText) && cmdText.includes('context.md') && />>?|tee|sed|mv|cp|patch|truncate|rm|git\s+add|git\s+commit/i.test(cmdText);
  const touchesContext = ctxTouchFromPath || ctxTouchFromCmd;
  const backfillMarker = path.join(root, '.context', '.backfill-done');
  const backfillDone = fs.existsSync(backfillMarker);
  // Track state BEFORE logging so a log failure cannot silently disarm the gates (#39).
  const statePath = path.join(root, '.context', 'session-state.json');
  let state = { edits: 0, pendingEdit: false, lastEdit: null, backfillPending: false, stopCount: 0 };
  try { let raw = fs.readFileSync(statePath, 'utf8'); if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); state = { ...state, ...JSON.parse(raw) }; } catch {}
  if (touchesContext) {
    state.pendingEdit = false;
    if (backfillDone) state.backfillPending = false; // only the marker clears a backfill (#40)
  } else {
    state.edits = (state.edits || 0) + 1;
    state.pendingEdit = true;
    state.lastEdit = ts;
  }
  try { fs.mkdirSync(path.join(root, '.context'), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(state), 'utf8'); } catch {}
  try { lib.appendChangeLog(root, changedSafe ? 'edited "' + changedSafe + '"' : 'file edited'); } catch {}

  // Refresh the snapshot only when something cheap hints the stack changed.
  const manifests = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile'];
  const markerFile = path.join(root, '.context', '.last-scan');
  let last = 0;
  try { last = fs.statSync(markerFile).mtimeMs; } catch {}
  const manifestChanged = changed && manifests.some((m) => changed.endsWith(m));
  if (manifestChanged || Date.now() - last > 5 * 60 * 1000) {
    lib.refreshDeterministic(root);
    try { fs.writeFileSync(markerFile, String(Date.now())); } catch {}
  }
} catch (err) {
  process.stderr.write(`context-md post-tool hook: ${err?.message || err}\n`);
}
// Silence is mandatory for strict hooks (Gemini): emit valid JSON only.
process.stdout.write('{}');
