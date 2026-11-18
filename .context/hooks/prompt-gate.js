#!/usr/bin/env node
// context-md strict prompt gate.
// Injects the non-negotiable context protocol into EVERY user turn.
// Usage: node prompt-gate.js --agent=claude|codex|gemini
import fs from 'node:fs';

const agentFlag = (process.argv.find((a) => a.startsWith('--agent=')) || '--agent=claude').split('=')[1];
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

const STRICT = 'STRICT (context-md — NO COMPROMISE): (1) Before ANY work in this repo, read the FULL context.md — it is the live source of truth. (2) After ANY change or decision, update context.md immediately — it must ALWAYS reflect the complete project, existing and new context. (3) Never finish a turn or session with context.md behind the repo state. Missing context.md? Create it NOW (node .context/hooks/session-start.js) before doing anything else. No exceptions, even for "quick" tasks.';

let out;
if (agentFlag === 'gemini') {
  out = { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: STRICT } };
} else {
  // claude + codex share this shape
  out = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: STRICT } };
}
process.stdout.write(JSON.stringify(out));
