#!/usr/bin/env node
// context-md read gate.
// Blocks file EDITS until the agent has read context.md this session.
// Reading context.md (any tool carrying the filename) clears the gate.
// Usage: node read-gate.js --agent=claude|codex|gemini|cursor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRANDPARENT = path.basename(path.resolve(__dirname, '..'));
const HOOK_IS_GLOBAL = GRANDPARENT !== '.context';
const RUNTIME_LIB = path.resolve(__dirname, '..', 'lib', 'context-file.js');
const agentFlag = (process.argv.find((a) => a.startsWith('--agent=')) || '--agent=claude').split('=')[1];

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
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

// context.md is auto-created on the first tool call — but NEVER overwrite an
// existing (possibly hand-edited) file, even if it is broken.
const contextFile = path.join(root, 'context.md');
if (!fs.existsSync(contextFile)) {
  try { lib.ensureContextFile(root); } catch { /* best effort */ }
}

const toolName = String(input.tool_name ?? input.tool ?? input.name ?? '');
const toolInput = input.tool_input ?? input.arguments ?? input.toolInput ?? input;
const isReadTool = /read|grep|glob|search|find/i.test(toolName);
const isShell = /bash|shell|exec|run_shell|command/i.test(toolName);
const EDIT_TOOLS = /edit|write|multiedit|notebookedit|apply_patch|replace|str_replace|patch|create_file|update|delete/i;
const cmdText = (() => { try { const t = toolInput ?? {}; const c = t.command ?? t.cmd ?? t.script ?? t.patch ?? t.input; return typeof c === 'string' ? c.slice(0, 4000) : ''; } catch { return ''; } })();
const READ_VERBS = /(^|[\s;|&(])(cat|type|head|tail|less|more|grep|find|search|sed|Get-Content)\b/i;
const changedRead = lib.extractChangedFile(toolInput ?? input ?? {});
const toolCtxMatch = Boolean(changedRead) && (changedRead === 'context.md' || /(^|[\/])context\.md$/i.test(changedRead));
const cmdCtxMatch = isShell && cmdText.includes('context.md');
const readsRealCtx = toolCtxMatch || (cmdCtxMatch && READ_VERBS.test(cmdText));

const statePath = path.join(root, '.context', 'session-state.json');
let state = { edits: 0, pendingEdit: false, backfillPending: false, contextRead: false, stopCount: 0 };
try { let raw8 = fs.readFileSync(statePath, 'utf8'); if (raw8.charCodeAt(0) === 0xFEFF) raw8 = raw8.slice(1); state = { ...state, ...JSON.parse(raw8) }; } catch {}

// Clearing the gate needs a real read of context.md: a read-ish tool touching
// the real file, or a shell command with an actual read verb on it.
if (readsRealCtx && (isReadTool || (isShell && READ_VERBS.test(cmdText)))) {
  state.contextRead = true;
  try { fs.mkdirSync(path.join(root, '.context'), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(state), 'utf8'); } catch {}
  process.stdout.write('{}');
  process.exit(0);
}

const allow = () => { process.stdout.write('{}'); process.exit(0); };

if (!EDIT_TOOLS.test(toolName) || state.contextRead) allow();

const reason = 'context-md READ GATE: this session has not read context.md yet. context.md is the live source of truth for this project — read it NOW before editing anything, then retry your edit.';
if (agentFlag === 'gemini') {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
} else if (agentFlag === 'cursor') {
  process.stdout.write(JSON.stringify({ permission: 'deny', user_message: reason, agent_message: reason }));
} else {
  // claude + codex
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}
process.exit(0);
