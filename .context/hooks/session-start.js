#!/usr/bin/env node
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
const { appendChangeLog, ensureContextFile, findRoot } = lib;

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

let warning = '';
const freshMarker = path.join(root, '.context', '.last-scan');
let snapshotFresh = false;
try { snapshotFresh = fs.existsSync(path.join(root, 'context.md')) && (Date.now() - fs.statSync(freshMarker).mtimeMs < 5 * 60 * 1000); } catch {}
try {
  ensureContextFile(root, { refresh: !snapshotFresh });
  appendChangeLog(root, 'session started — snapshot refreshed');
} catch (err) {
  // Never delete user data: move the broken file aside (it is preserved), then recover.
  const broken = path.join(root, 'context.md.broken-' + Date.now());
  try { fs.renameSync(path.join(root, 'context.md'), broken); warning = ' WARNING: previous context.md had broken markers and was moved to ' + path.basename(broken) + ' (not deleted).'; } catch {}
  try { ensureContextFile(root, { refresh: false }); } catch {}
  try { appendChangeLog(root, 'session started — recovered from broken context.md'); } catch {}
}

try {
  fs.mkdirSync(path.join(root, '.context'), { recursive: true });
  fs.writeFileSync(path.join(root, '.context', 'session-state.json'), JSON.stringify({ edits: 0, pendingEdit: false, lastEdit: null, backfillPending: !backfillDone, contextRead: false, stopCount: 0 }), 'utf8');
} catch {}

const taskContext = 'MANDATORY (context-md): before ANY work in this repo, read the FULL context.md in the repo root — the pre-tool READ GATE blocks all file edits until context.md has been read this session. It is the live source of truth for what this project is, its structure, key decisions and current focus. After meaningful decisions/changes, UPDATE context.md (Purpose / Key Knowledge / Current Focus). The stop gate will block session end if files changed and context.md was not updated. Do not trust prior memory over the file.';
const firstRun = 'FIRST-RUN BACKFILL (context-md): this project has never been backfilled. Before ANY other task, do this and nothing else: (1) read README* and docs/ if any, the manifests (package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml), and the 2-4 most important source files; (2) run git log --oneline -50 to understand the arc of the project; (3) rewrite context.md Purpose and Key Knowledge with the REAL project purpose, stack decisions, conventions and gotchas (NO placeholders, NO invented facts); (4) create an empty file .context/.backfill-done (mkdir -p .context first if needed); (5) tell the user the backfill is done. While backfillPending is set, finishing any file edits without doing this will be blocked at session end.';

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: (backfillDone ? taskContext : taskContext + '\n\n' + firstRun) + warning,
  },
};
process.stdout.write(JSON.stringify(payload));
