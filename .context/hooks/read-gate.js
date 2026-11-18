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

// Global runtime defers to a repo's local runtime when present.
if (HOOK_IS_GLOBAL && fs.existsSync(path.join(root, '.context', 'lib', 'context-file.js'))) {
  process.stdout.write('{}');
  process.exit(0);
}

const toolName = String(input.tool_name ?? input.tool ?? input.name ?? '');
const toolInput = input.tool_input ?? input.arguments ?? input.toolInput ?? input;
const serialized = JSON.stringify(toolInput ?? input ?? {});

const READ_TOOLS = /read|grep|glob|ls|search|find|cat|head|tail|bash|shell|exec/i;
const EDIT_TOOLS = /edit|write|multiedit|notebookedit|apply_patch|replace|str_replace|patch|create_file|update|delete/i;
const mentionsContext = serialized.includes('context.md');

const statePath = path.join(root, '.context', 'session-state.json');
let state = { edits: 0, pendingEdit: false, backfillPending: false, contextRead: false };
try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}

// A read of context.md by ANY tool clears the gate for the session.
if (mentionsContext && READ_TOOLS.test(toolName)) {
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
