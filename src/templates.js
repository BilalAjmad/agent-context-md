// Blocks injected into per-agent instruction files, plus the hook script sources
// copied into <repo>/.context/. Everything is idempotent and wrapped in markers.

export const INSTRUCTION_MARKER = '<!-- context-md:start -->';
export const INSTRUCTION_END = '<!-- context-md:end -->';

export function instructionBlock() {
  return `${INSTRUCTION_MARKER}
## context.md — live project context (context-md)

This repo is wired to **context-md**. Rules for EVERY AI agent, no exceptions:

1. **BEFORE doing anything**, read \`context.md\` at the repo root. It holds the live
   project snapshot, structure, agreed purpose, key knowledge, current focus and a
   timestamped change log.
2. **AFTER any meaningful decision or change**, update \`context.md\` in place:
   - *Purpose* — what this project is, once you know it.
   - *Key Knowledge* — stack/architecture decisions, conventions, gotchas.
   - *Current Focus / Next Steps* — what is being worked on right now.
3. Never delete the \`context-md:*\` markers or the auto-managed sections. Edit only
   the agent-owned sections by hand; hooks maintain the rest.
4. If \`context.md\` is missing, run \`node .context/hooks/session-start.js\` or
   \`npx context-md refresh\` to regenerate it, then read it.
5. **Stop gate:** if you edited any file this session without updating
   \`context.md\`, the session-end hook BLOCKS the stop — you must update
   Purpose / Key Knowledge / Current Focus before finishing.
6. \`context.md\` is meant to be committed — it is the shared brain of the team.

Hooks installed by context-md keep a change log on every file edit and refresh the
snapshot at session start. The file can drift between sessions — re-read it; do not
trust your memory over it.
${INSTRUCTION_END}`;
}

export const OPENCODE_PLUGIN = `// context-md — opencode plugin (v1 + v2 compatible)
// Refreshes context.md on session start and after file edits.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function run(hook, input) {
  try {
    execFileSync(process.execPath, [path.join(root, '.context', 'hooks', hook)], {
      input: JSON.stringify(input ?? {}),
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 10000,
    });
  } catch {
    // Hooks are best-effort: never break the agent loop.
  }
}

const v1 = async () => ({
  'session.created': async () => run('session-start.js'),
  'tool.execute.after': async (input) => run('post-tool.js', input),
});

let v2 = null;
try {
  const mod = await import('@opencode/plugin');
  v2 = mod.Plugin.define({
    id: 'context-md',
    setup(ctx) {
      ctx.tool.hook('execute.after', () => run('post-tool.js'));
    },
  });
} catch {
  v2 = { id: 'context-md' }; // @opencode/plugin unavailable — rely on v1 export
}

export default { ...v2, server: v1 };
`;

export const GLOBAL_OPENCODE_PLUGIN = `// context-md — opencode GLOBAL plugin (v1 + v2 compatible)
// Wires every unconfigured project you open in opencode: ensures context.md,
// logs edits, enforces the stop gate. Defers to a repo's local .context/ runtime.
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const RUNTIME = path.join(os.homedir(), '.context-md', 'hooks');

function run(hook, input) {
  try {
    execFileSync(process.execPath, [path.join(RUNTIME, hook)], {
      input: JSON.stringify(input ?? {}),
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 10000,
    });
  } catch {
    // Hooks are best-effort: never break the agent loop.
  }
}

const v1 = async () => ({
  'session.created': async () => run('session-start.js'),
  'tool.execute.after': async (input) => run('post-tool.js', input),
});

let v2 = null;
try {
  const mod = await import('@opencode/plugin');
  v2 = mod.Plugin.define({
    id: 'context-md',
    setup(ctx) {
      ctx.tool.hook('execute.after', () => run('post-tool.js'));
    },
  });
} catch {
  v2 = { id: 'context-md' }; // @opencode/plugin unavailable — rely on v1 export
}

export default { ...v2, server: v1 };
`;

export const SESSION_START_HOOK = `#!/usr/bin/env node
// context-md session-start hook.
// Ensures context.md exists, refreshes the auto-managed sections, resets the
// per-session edit tracker, and tells the agent to read context.md FIRST.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Both layouts keep lib/ beside hooks/: local <repo>/.context/lib, global ~/.context-md/lib.
const RUNTIME_LIB = path.resolve(__dirname, '..', 'lib', 'context-file.js');
const GRANDPARENT = path.basename(path.resolve(__dirname, '..'));
const HOOK_IS_GLOBAL = GRANDPARENT !== '.context';

let lib = null;
try {
  lib = await import(pathToFileURL(RUNTIME_LIB).href);
} catch {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
const { refreshDeterministic, appendChangeLog, ensureContextFile, findRoot } = lib;

// Root = project containing cwd (works for repo subdirs and for the global
// runtime); falls back to the repo root derived from hook location.
const root = (() => { try { return findRoot(process.cwd()) || path.resolve(__dirname, '..', '..'); } catch { return path.resolve(__dirname, '..', '..'); } })();

// Global runtime defers to the repo's own local runtime when present, and
// activates only in project-like folders (.git or a known manifest).
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile', 'composer.json', 'requirements.txt', 'setup.py', 'Dockerfile', '.git'];
const projectLike = MANIFESTS.some((m) => fs.existsSync(path.join(root, m)));
if (HOOK_IS_GLOBAL && (fs.existsSync(path.join(root, '.context', 'lib', 'context-file.js')) || !projectLike)) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const backfillDone = (() => { try { return fs.existsSync(path.join(root, '.context', '.backfill-done')); } catch { return false; } })();

try {
  ensureContextFile(root);
  refreshDeterministic(root);
  appendChangeLog(root, 'session started — snapshot refreshed');
} catch (err) {
  try { fs.unlinkSync(path.join(root, 'context.md')); } catch {}
  try { ensureContextFile(root); } catch {}
}

try {
  fs.mkdirSync(path.join(root, '.context'), { recursive: true });
  fs.writeFileSync(path.join(root, '.context', 'session-state.json'), JSON.stringify({ edits: 0, pendingEdit: false, lastEdit: null, backfillPending: !backfillDone }), 'utf8');
} catch {}

const taskContext = 'MANDATORY (context-md): before ANY work in this repo, read the FULL context.md in the repo root. It is the live source of truth for what this project is, its structure, key decisions and current focus. After meaningful decisions/changes, UPDATE context.md (Purpose / Key Knowledge / Current Focus). The stop gate will block session end if files changed and context.md was not updated. Do not trust prior memory over the file.';
const firstRun = 'FIRST-RUN BACKFILL (context-md): this project has never been backfilled. Before ANY other task, do this and nothing else: (1) read README* and docs/ if any, the manifests (package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml), and the 2-4 most important source files; (2) run git log --oneline -50 to understand the arc of the project; (3) rewrite context.md Purpose and Key Knowledge with the REAL project purpose, stack decisions, conventions and gotchas (NO placeholders, NO invented facts); (4) create an empty file .context/.backfill-done (mkdir -p .context first if needed); (5) tell the user the backfill is done. While backfillPending is set, finishing any file edits without doing this will be blocked at session end.';

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: backfillDone ? taskContext : taskContext + '\\n\\n' + firstRun,
  },
};
process.stdout.write(JSON.stringify(payload));
`;

export const STOP_HOOK = `#!/usr/bin/env node
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

let state = { pendingEdit: false, edits: 0, backfillPending: false };
try { state = { ...state, ...JSON.parse(fs.readFileSync(path.join(root, '.context', 'session-state.json'), 'utf8')) }; } catch {}

const allow = () => {
  process.stdout.write('{}');
  process.exit(0);
};

const needsContextUpdate = state.pendingEdit;
const needsBackfill = state.backfillPending && state.edits > 0;
if (looped || (!needsContextUpdate && !needsBackfill)) allow();

const reason = needsBackfill && !needsContextUpdate
  ? 'context-md STOP GATE: this project has never been backfilled and files were edited. Do the FIRST-RUN BACKFILL now: read README/manifests/key sources and git log --oneline -50, rewrite context.md Purpose + Key Knowledge with real facts, create .context/.backfill-done, then finish.'
  : 'context-md STOP GATE: files changed this session but context.md was not updated. Update context.md NOW — Current Focus / Key Knowledge / Purpose — then finish. Do not stop before the update.';
if (agentFlag === 'gemini') {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
} else if (agentFlag === 'cursor') {
  process.stdout.write(JSON.stringify({ followup_message: reason }));
} else {
  // claude + codex share this shape
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}
process.exit(0);
`;

export const POST_TOOL_HOOK = `#!/usr/bin/env node
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
  lib.appendChangeLog(root, changed ? \`edited \${changed}\` : 'file edited');

  // Per-session edit tracker: an agent that edits any file without then
  // updating context.md trips the stop gate at session end.
  const statePath = path.join(root, '.context', 'session-state.json');
  let state = { edits: 0, pendingEdit: false, lastEdit: null };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}
  const touchesContext = changed ? /(^|[\\/])context\.md$/i.test(changed) : false;
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
  process.stderr.write(\`context-md post-tool hook: \${err?.message || err}\\n\`);
}
// Silence is mandatory for strict hooks (Gemini): emit valid JSON only.
process.stdout.write('{}');
`;
