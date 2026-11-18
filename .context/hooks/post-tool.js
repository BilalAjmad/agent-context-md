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

// Global runtime defers to a repo's local runtime when present.
if (HOOK_IS_GLOBAL && fs.existsSync(path.join(root, '.context', 'lib', 'context-file.js'))) {
  process.stdout.write('{}');
  process.exit(0);
}

try {
  const changed = lib.extractChangedFile(input.tool_input ?? input);
  const ts = new Date().toISOString();
  lib.appendChangeLog(root, changed ? `edited ${changed}` : 'file edited');

  // Per-session edit tracker: an agent that edits any file without then
  // updating context.md trips the stop gate at session end.
  const statePath = path.join(root, '.context', 'session-state.json');
  let state = { edits: 0, pendingEdit: false, lastEdit: null };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}
  const touchesContext = changed ? /(^|[\/])context.md$/i.test(changed) : false;
  if (touchesContext) {
    state.pendingEdit = false;
    state.backfillPending = false;
  } else {
    state.edits = (state.edits || 0) + 1;
    state.pendingEdit = true;
    state.lastEdit = ts;
  }
  try { fs.writeFileSync(statePath, JSON.stringify(state), 'utf8'); } catch {}

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
