#!/usr/bin/env node
// context-md stop gate.
// If any file changed this session and context.md was not updated afterwards,
// the agent is BLOCKED from ending the turn and told to update context.md.
// Usage: node stop-check.js --agent=claude|codex|gemini|cursor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRANDPARENT = path.basename(path.resolve(__dirname, '..'));
const HOOK_IS_GLOBAL = GRANDPARENT !== '.context';
const RUNTIME_LIB = path.resolve(__dirname, '..', 'lib', 'context-file.js');
const agentFlag = (process.argv.find((a) => a.startsWith('--agent=')) || '--agent=claude').split('=')[1];

import { pathToFileURL } from 'node:url';
let root = null;
try {
  const lib = await import(pathToFileURL(RUNTIME_LIB).href);
  try { root = lib.findRoot(process.cwd()); } catch { root = null; }
  if (HOOK_IS_GLOBAL && root && fs.existsSync(path.join(root, '.context', 'lib', 'context-file.js'))) {
    process.stdout.write('{}');
    process.exit(0);
  }
} catch { root = null; }
if (!root) root = path.resolve(__dirname, '..', '..');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
let input = {};
try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

// Guard against infinite loops: if this stop was already a hook retry, let it pass.
const looped = input.stop_hook_active === true || (typeof input.loop_count === 'number' && input.loop_count >= 2);

let state = { pendingEdit: false, edits: 0, backfillPending: false, stopCount: 0 };
try { let raw = fs.readFileSync(path.join(root, '.context', 'session-state.json'), 'utf8'); if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); state = { ...state, ...JSON.parse(raw) }; } catch {}

const allow = () => {
  process.stdout.write('{}');
  process.exit(0);
};

const needsContextUpdate = state.pendingEdit;
const needsBackfill = state.backfillPending && state.edits > 0;
const loopCapReached = (state.stopCount || 0) >= 2;
if (looped || loopCapReached || (!needsContextUpdate && !needsBackfill)) allow();

const reason = needsBackfill && !needsContextUpdate
  ? 'context-md STOP GATE: this project has never been backfilled and files were edited. Do the FIRST-RUN BACKFILL now: read README/manifests/key sources and git log --oneline -50, rewrite context.md Purpose + Key Knowledge with real facts, create .context/.backfill-done, then finish.'
  : 'context-md STOP GATE: files changed this session but context.md was not updated. Update context.md NOW — Current Focus / Key Knowledge / Purpose — then finish. Do not stop before the update.';

// Persist the block so a stuck agent is only re-blocked twice per session, not forever.
state.stopCount = (state.stopCount || 0) + 1;
try {
  fs.mkdirSync(path.join(root, '.context'), { recursive: true });
  fs.writeFileSync(path.join(root, '.context', 'session-state.json'), JSON.stringify(state), 'utf8');
} catch {}
if (agentFlag === 'gemini') {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
} else if (agentFlag === 'cursor') {
  process.stdout.write(JSON.stringify({ followup_message: reason }));
} else {
  // claude + codex share this shape
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}
process.exit(0);
