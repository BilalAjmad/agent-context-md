// Installation logic: instruction files + per-agent hook adapters.
// Every mutation is idempotent (marked blocks / identifiable hook entries) and
// JSON configs are backed up before modification.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instructionBlock, INSTRUCTION_MARKER, INSTRUCTION_END, OPENCODE_PLUGIN, GLOBAL_OPENCODE_PLUGIN, SESSION_START_HOOK, POST_TOOL_HOOK, READ_GATE_HOOK, PROMPT_GATE_HOOK, STOP_HOOK } from './templates.js';
import { ensureContextFile, refreshDeterministic, contextPath, atomicWriteFile, assertNotSymlink } from './context-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = __dirname;

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.clinerules',
  '.github/copilot-instructions.md',
  '.cursor/rules/context-md.mdc',
  '.devin/rules/context-md.md',
  '.windsurf/rules/context-md.md',
  '.kiro/steering/context-md.md',
];

const KIRO_STEERING = `---
inclusion: always
---
`;

const CURSOR_MDC = `---
description: context.md live project context — read before any work
alwaysApply: true
---
`;

// Files that hold YAML-ish frontmatter before the shared block.
const FRONTMATTER = {
  '.kiro/steering/context-md.md': KIRO_STEERING,
  '.cursor/rules/context-md.mdc': CURSOR_MDC,
};

const HOOK_TAGS = ['.context/hooks/', '.context-md/hooks/'];
function isOursJson(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return HOOK_TAGS.some((tag) => json.includes(tag));
}

function fsExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.bak-${stamp}`);
}

// ---------- instruction files ----------

export function removeMarkedBlock(file) {
  if (!fsExists(file)) return { removed: false };
  const content = fs.readFileSync(file, 'utf8');
  const s = content.indexOf(INSTRUCTION_MARKER);
  if (s === -1) return { removed: false };
  const e = content.indexOf(INSTRUCTION_END, s);
  if (e === -1) return { removed: false };
  const before = content.slice(0, s).replace(/\s+$/g, '');
  const after = content.slice(e + INSTRUCTION_END.length).replace(/^\s+/, '');
  const next = [before, after].filter(Boolean).join('\n\n') + (before || after ? '\n' : '');
  if (next.trim()) atomicWriteFile(file, next);
  else fs.unlinkSync(file);
  return { removed: true };
}

function frontmatterFor(file) {
  const normalized = file.replace(/\\/g, '/');
  for (const [rel, fm] of Object.entries(FRONTMATTER)) {
    if (normalized.endsWith(rel)) return fm;
  }
  return '';
}

export function injectInstructionBlock(file) {
  const block = instructionBlock();
  const frontmatter = frontmatterFor(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  if (!fsExists(file)) {
    atomicWriteFile(file, (frontmatter ? frontmatter + '\n' : '') + block + '\n');
    return { action: 'created', file };
  }

  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(INSTRUCTION_MARKER)) {
    // Refresh in place (update to the latest block version).
    const s = content.indexOf(INSTRUCTION_MARKER);
    const e = content.indexOf(INSTRUCTION_END, s);
    if (e !== -1) {
      const next = content.slice(0, s) + block + content.slice(e + INSTRUCTION_END.length);
      if (next !== content) atomicWriteFile(file, next);
      return { action: 'refreshed', file };
    }
  }
  atomicWriteFile(file, content.replace(/\s+$/g, '') + '\n\n' + block + '\n');
  return { action: 'appended', file };
}

export function removeInstructionBlocks(root, files = INSTRUCTION_FILES) {
  const results = [];
  for (const rel of files) {
    try {
      results.push({ file: rel, ...removeMarkedBlock(path.join(root, rel)) });
    } catch (err) {
      results.push({ file: rel, removed: false, error: String(err?.message || err) });
    }
  }
  // If only install-time frontmatter remains in .mdc/.steering files, remove them.
  for (const fmFile of Object.keys(FRONTMATTER)) {
    const p = path.join(root, fmFile);
    if (!fsExists(p)) continue;
    try {
      const c = fs.readFileSync(p, 'utf8').trim();
      const fm = String(FRONTMATTER[fmFile]).trim();
      if (fm && c === fm) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
  return results;
}

// ---------- hooks + vendored lib ----------

// Write the runtime (lib + hooks + package.json) into <dir>.
// Local install uses <repo>/.context, global default uses <home>/.context-md.
export function copyRuntimeTo(destDir) {
  const destLib = path.join(destDir, 'lib');
  const destHooks = path.join(destDir, 'hooks');
  for (const d of [destDir, destLib, destHooks]) assertNotSymlink(d);
  fs.mkdirSync(destLib, { recursive: true });
  fs.mkdirSync(destHooks, { recursive: true });

  fs.copyFileSync(path.join(SRC_DIR, 'scan.js'), path.join(destLib, 'scan.js'));
  fs.copyFileSync(path.join(SRC_DIR, 'context-file.js'), path.join(destLib, 'context-file.js'));
  atomicWriteFile(path.join(destHooks, 'session-start.js'), SESSION_START_HOOK);
  atomicWriteFile(path.join(destHooks, 'post-tool.js'), POST_TOOL_HOOK);
  atomicWriteFile(path.join(destHooks, 'read-gate.js'), READ_GATE_HOOK);
  atomicWriteFile(path.join(destHooks, 'prompt-gate.js'), PROMPT_GATE_HOOK);
  atomicWriteFile(path.join(destHooks, 'stop-check.js'), STOP_HOOK);
  // ESM modules even when the target repo has no "type": "module".
  atomicWriteFile(path.join(destDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
  return { lib: destLib, hooks: destHooks };
}

export function copyRuntime(root) {
  const destDir = path.join(root, '.context');
  const { lib, hooks } = copyRuntimeTo(destDir);
  return { lib, hooks };
}

// ---------- JSON config merging ----------

function readJson(file) {
  try {
    // Strip UTF-8 BOM: Windows tools often write BOM-prefixed JSON.
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // eslint-disable-line no-irregular-whitespace
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fsExists(file)) backup(file);
  assertNotSymlink(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

// Merge context-md hook entries into a Claude/Codex-style settings object.
// Shape: { SessionStart: [{matcher?, hooks: [{type, command, ...}]}] }.
// If the user's settings already carry a non-array value under one of our target
// events, we refuse to clobber it — the caller reports an error and writes nothing.
function checkHooksShape(container, events) {
  const hooks = container && typeof container === 'object' ? container.hooks : null;
  if (!hooks || typeof hooks !== 'object') return null;
  for (const event of events) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) return event;
  }
  return null;
}

function mergeHooks(existing, additions) {
  const hooks = existing && typeof existing === 'object' ? existing : {};
  for (const [event, groups] of Object.entries(additions)) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    for (const group of groups) {
      current.push(group);
    }
    // Drop any older context-md groups (stale absolute paths from reinstalls).
    hooks[event] = dedupContextGroups(current);
  }
  return hooks;
}

function dedupContextGroups(groups) {
  // Reinstalls at a new absolute path inject a new context-md group and leave a
  // stale one behind. Keep only the newest (last) context-md group per event.
  let lastContext = -1;
  for (let i = 0; i < groups.length; i++) {
    if (isOursJson(groups[i])) lastContext = i;
  }
  return groups.filter((g, i) => !isOursJson(g) || i === lastContext);
}

function hookCommandAt(hooksDir, script) {
  // Forward slashes everywhere: valid on every shell/node, and keeps the
  // runtime marker consistent across platforms.
  return `node "${path.join(hooksDir, script).replace(/\\/g, '/')}"`;
}

// Local installs must produce COMMITTABLE, machine-independent hook commands,
// so teammates on other machines can clone and use them. Each agent gets its
// documented project-root expansion. Global installs keep absolute paths.
function localCommand(agent, script) {
  const base = {
    claude: '${CLAUDE_PROJECT_DIR}/.context/hooks/',
    codex: '$(git rev-parse --show-toplevel)/.context/hooks/',
    gemini: '$GEMINI_PROJECT_DIR/.context/hooks/',
    cursor: './.context/hooks/',
  }[agent];
  return `node "${base}${script}"`;
}

function agentCommand(agent, script, opts = {}) {
  return opts.hooksDir ? hookCommandAt(opts.hooksDir, script) : localCommand(agent, script);
}

function stopCommand(agent, opts = {}) {
  return `${agentCommand(agent, 'stop-check.js', opts)} --agent=${agent}`;
}

// Claude Code: .claude/settings.json
export function installClaude(root, opts = {}) {
  const file = path.join(root, '.claude', 'settings.json');
  if (fsExists(file)) {
    if (readJson(file) === null) return { agent: 'claude-code', file, error: 'invalid JSON — not touched' };
    const bad = checkHooksShape(readJson(file), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    if (bad) return { agent: 'claude-code', file, error: `hooks.${bad} is not an array — left untouched` };
  }
  const settings = readJson(file) ?? {};
  const cmd = agentCommand('claude', 'post-tool.js', opts);
  const start = agentCommand('claude', 'session-start.js', opts);
  const stop = stopCommand('claude', opts);
  const readGate = `${agentCommand('claude', 'read-gate.js', opts)} --agent=claude`;
  const promptGate = `${agentCommand('claude', 'prompt-gate.js', opts)} --agent=claude`;
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [
      { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: start, timeout: 15 }] },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: promptGate, timeout: 10 }] },
    ],
    PreToolUse: [
      { matcher: 'Read|Grep|Glob|Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: readGate, timeout: 15 }] },
    ],
    PostToolUse: [
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: cmd, timeout: 15 }] },
    ],
    Stop: [
      { hooks: [{ type: 'command', command: stop, timeout: 15 }] },
    ],
  });
  writeJson(file, settings);
  return { agent: 'claude-code', file };
}

// Codex: .codex/hooks.json (separate file, keeps config.toml untouched)
export function installCodex(root, opts = {}) {
  const file = path.join(root, '.codex', 'hooks.json');
  if (fsExists(file)) {
    if (readJson(file) === null) return { agent: 'codex', file, error: 'invalid JSON — not touched' };
    const bad = checkHooksShape(readJson(file), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    if (bad) return { agent: 'codex', file, error: `hooks.${bad} is not an array — left untouched` };
  }
  const config = readJson(file) ?? { description: 'context-md hooks', hooks: {} };
  const stop = stopCommand('codex', opts);
  const readGate = `${agentCommand('codex', 'read-gate.js', opts)} --agent=codex`;
  const promptGate = `${agentCommand('codex', 'prompt-gate.js', opts)} --agent=codex`;
  config.hooks = mergeHooks(config.hooks, {
    SessionStart: [
      { matcher: 'startup|resume|clear|compact|fork', hooks: [{ type: 'command', command: agentCommand('codex', 'session-start.js', opts), timeout: 15 }] },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: promptGate, timeout: 10 }] },
    ],
    PreToolUse: [
      { matcher: 'Bash|apply_patch|Edit|Write', hooks: [{ type: 'command', command: readGate, timeout: 15 }] },
    ],
    PostToolUse: [
      { matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: agentCommand('codex', 'post-tool.js', opts), timeout: 15 }] },
    ],
    Stop: [
      { hooks: [{ type: 'command', command: stop, timeout: 15 }] },
    ],
  });
  writeJson(file, config);
  return { agent: 'codex', file };
}

// Gemini CLI: .gemini/settings.json — hooks key merged into project settings
export function installGemini(root, opts = {}) {
  const file = path.join(root, '.gemini', 'settings.json');
  if (fsExists(file)) {
    if (readJson(file) === null) return { agent: 'gemini-cli', file, error: 'invalid JSON — not touched' };
    const bad = checkHooksShape(readJson(file), ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent']);
    if (bad) return { agent: 'gemini-cli', file, error: `hooks.${bad} is not an array — left untouched` };
  }
  const settings = readJson(file) ?? {};
  const cmd = agentCommand('gemini', 'post-tool.js', opts);
  const start = agentCommand('gemini', 'session-start.js', opts);
  const stop = stopCommand('gemini', opts);
  const readGate = `${agentCommand('gemini', 'read-gate.js', opts)} --agent=gemini`;
  const promptGate = `${agentCommand('gemini', 'prompt-gate.js', opts)} --agent=gemini`;
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [
      { matcher: '*', hooks: [{ name: 'context-md', type: 'command', command: start, timeout: 15000, description: 'Refresh context.md at session start' }] },
    ],
    BeforeAgent: [
      { matcher: '*', hooks: [{ name: 'context-md', type: 'command', command: promptGate, timeout: 10000, description: 'Inject the non-negotiable context protocol into every prompt' }] },
    ],
    BeforeTool: [
      { matcher: '.*', hooks: [{ name: 'context-md', type: 'command', command: readGate, timeout: 15000, description: 'Block file edits until context.md is read' }] },
    ],
    AfterTool: [
      { matcher: 'write_file|replace|edit|write_todos', hooks: [{ name: 'context-md', type: 'command', command: cmd, timeout: 15000, description: 'Log file edit into context.md' }] },
    ],
    AfterAgent: [
      { matcher: '*', hooks: [{ name: 'context-md', type: 'command', command: stop, timeout: 15000, description: 'Block turn end until context.md is updated' }] },
    ],
  });
  writeJson(file, settings);
  return { agent: 'gemini-cli', file };
}

// Cursor: .cursor/hooks.json — project hooks, committed, cloud agents included
export function installCursor(root, opts = {}) {
  const file = path.join(root, '.cursor', 'hooks.json');
  if (fsExists(file)) {
    if (readJson(file) === null) return { agent: 'cursor', file, error: 'invalid JSON — not touched' };
    const bad = checkHooksShape(readJson(file), ['sessionStart', 'preToolUse', 'postToolUse', 'stop']);
    if (bad) return { agent: 'cursor', file, error: `hooks.${bad} is not an array — left untouched` };
  }
  const config = readJson(file) ?? { version: 1, hooks: {} };
  const cmd = agentCommand('cursor', 'post-tool.js', opts);
  const start = agentCommand('cursor', 'session-start.js', opts);
  config.version = 1;
  const stop = stopCommand('cursor', opts);
  const readGate = `${agentCommand('cursor', 'read-gate.js', opts)} --agent=cursor`;
  config.hooks = mergeHooks(config.hooks, {
    sessionStart: [{ command: start, timeout: 15 }],
    preToolUse: [{ command: readGate, timeout: 15, matcher: 'Read|Grep|Shell|Write|Edit|Delete' }],
    postToolUse: [{ command: cmd, timeout: 15, matcher: 'Write|Edit|Shell' }],
    stop: [{ command: stop, timeout: 15, loop_limit: 2 }],
  });
  writeJson(file, config);
  return { agent: 'cursor', file };
}

// opencode: .opencode/plugins/context-md.js — auto-discovered, no config edit needed
export function installOpencode(root) {
  const file = path.join(root, '.opencode', 'plugins', 'context-md.js');
  if (fsExists(file)) {
    const cur = fs.readFileSync(file, 'utf8');
    if (!cur.includes('// context-md')) backup(file); // not ours — preserve a copy
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFile(file, OPENCODE_PLUGIN);
  return { agent: 'opencode', file };
}

export const AGENT_ADAPTERS = [
  ['claude-code', installClaude],
  ['codex', installCodex],
  ['gemini-cli', installGemini],
  ['cursor', installCursor],
  ['opencode', installOpencode],
];

// Remove only context-md hook entries (identified by our runtime path tags).
function unmergeHooks(existing) {
  if (!existing || typeof existing !== 'object') return {};
  const hooks = {};
  for (const [event, groups] of Object.entries(existing)) {
    if (!Array.isArray(groups)) { hooks[event] = groups; continue; }
    const kept = groups.filter((g) => !isOursJson(g));
    if (kept.length) hooks[event] = kept;
  }
  return hooks;
}

export function uninstallHooks(root, { global = false } = {}) {
  const targets = [
    ['.claude', 'settings.json'],
    ['.codex', 'hooks.json'],
    ['.gemini', 'settings.json'],
    ['.cursor', 'hooks.json'],
  ];
  const results = [];
  for (const [dir, name] of targets) {
    const file = path.join(root, dir, name);
    if (!fsExists(file)) { results.push({ file: `${dir}/${name}`, removed: false }); continue; }
    const data = readJson(file);
    if (!data) { results.push({ file: `${dir}/${name}`, removed: false, error: 'invalid JSON' }); continue; }
    backup(file);
    data.hooks = unmergeHooks(data.hooks);
    if (Object.keys(data.hooks).length === 0) delete data.hooks;
    atomicWriteFile(file, JSON.stringify(data, null, 2) + '\n');
    results.push({ file: `${dir}/${name}`, removed: true });
  }
  // The global uninstaller owns .config/opencode/plugins/context-md.js;
  // ~/.opencode/plugins/context-md.js is never ours to delete.
  if (global) return results;
  const opencodePlugin = path.join(root, '.opencode', 'plugins', 'context-md.js');
  if (fsExists(opencodePlugin)) { fs.unlinkSync(opencodePlugin); results.push({ file: '.opencode/plugins/context-md.js', removed: true }); }
  else results.push({ file: '.opencode/plugins/context-md.js', removed: false });
  return results;
}

// ---------- global "default everywhere" install ----------

const GLOBAL_INSTRUCTION_FILES = [
  '.claude/CLAUDE.md',
  '.codex/AGENTS.md',
  '.gemini/GEMINI.md',
  '.cursor/AGENTS.md',
  '.config/opencode/AGENTS.md',
];

// Wires the global agent configs (user-level) + a standalone runtime at
// <home>/.context-md. After this, any project you open with a supported agent
// gets context.md automatically — the repo needs no manual install.
export function installGlobal({ home, clients = null } = {}) {
  const homeDir = path.resolve(home || os.homedir());
  const runtimeDir = path.join(homeDir, '.context-md');
  const hooksDir = path.join(runtimeDir, 'hooks');
  const selected = new Set(clients ?? ['claude-code', 'codex', 'gemini-cli', 'cursor', 'opencode']);
  const report = { home: homeDir, runtime: null, instructionFiles: [], hooks: [], opencode: null, skipped: [] };

  report.runtime = copyRuntimeTo(runtimeDir);

  for (const rel of GLOBAL_INSTRUCTION_FILES) {
    report.instructionFiles.push(injectInstructionBlock(path.join(homeDir, rel)));
  }

  const opts = { hooksDir };
  for (const [id, adapter] of [['claude-code', installClaude], ['codex', installCodex], ['gemini-cli', installGemini], ['cursor', installCursor]]) {
    if (!selected.has(id)) { report.skipped.push(id); continue; }
    try {
      report.hooks.push(adapter(homeDir, opts));
    } catch (err) {
      report.hooks.push({ agent: id, error: String(err?.message || err) });
    }
  }

  if (!selected.has('opencode')) {
    report.opencode = { agent: 'opencode', skipped: true };
  } else {
    const pluginFile = path.join(homeDir, '.config', 'opencode', 'plugins', 'context-md.js');
    try {
      if (fsExists(pluginFile)) {
        const cur = fs.readFileSync(pluginFile, 'utf8');
        if (!cur.includes('// context-md')) backup(pluginFile);
      }
      const homeJson = JSON.stringify(homeDir);
      const pluginSource = GLOBAL_OPENCODE_PLUGIN.split('__CONTEXT_MD_HOME__').join(homeJson);
      fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
      atomicWriteFile(pluginFile, pluginSource);
      report.opencode = { agent: 'opencode', file: pluginFile };
    } catch (err) {
      report.opencode = { agent: 'opencode', error: String(err?.message || err) };
    }
  }

  return report;
}

export function uninstallGlobal({ home } = {}) {
  const homeDir = path.resolve(home || os.homedir());
  const report = { home: homeDir, instructionFiles: [], hooks: [], opencode: null, runtimeKept: false };

  for (const rel of GLOBAL_INSTRUCTION_FILES) {
    report.instructionFiles.push({ file: rel, ...removeMarkedBlock(path.join(homeDir, rel)) });
  }
  report.hooks = uninstallHooks(homeDir, { global: true }); // matches .context-md/hooks/ tags too
  const pluginFile = path.join(homeDir, '.config', 'opencode', 'plugins', 'context-md.js');
  if (fsExists(pluginFile)) { fs.unlinkSync(pluginFile); report.opencode = { removed: true }; } else report.opencode = { removed: false };
  try { fs.rmSync(path.join(homeDir, '.context-md'), { recursive: true, force: true }); } catch {}
  return report;
}

export function uninstallRuntime(root) {
  for (const rel of [
    '.context/hooks/session-start.js',
    '.context/hooks/post-tool.js',
    '.context/hooks/read-gate.js',
    '.context/hooks/prompt-gate.js',
    '.context/hooks/stop-check.js',
    '.context/lib/scan.js',
    '.context/lib/context-file.js',
    '.context/package.json',
    '.context/.last-scan',
    '.context/session-state.json',
    '.context/.backfill-done',
  ]) {
    try { fs.rmSync(path.join(root, rel), { force: true }); } catch {}
  }
  for (const dir of ['.context/hooks', '.context/lib', '.context']) {
    try { fs.rmdirSync(path.join(root, dir)); } catch { /* not empty — user files remain */ }
  }
}

// ---------- .gitignore ----------

const GITIGNORE_LINES = [
  '.context/session-state.json',
  '.context/.last-scan',
  // Backup files our own config writes create — never commit those.
  '.claude/settings.json.bak-*',
  '.codex/hooks.json.bak-*',
  '.gemini/settings.json.bak-*',
  '.cursor/hooks.json.bak-*',
];

// Target repos commit .context/ (hooks must travel with the repo) but not
// per-session state. Append our ignore lines idempotently.
export function manageGitignore(root) {
  const file = path.join(root, '.gitignore');
  let content = '';
  if (fsExists(file)) content = fs.readFileSync(file, 'utf8');
  const missing = GITIGNORE_LINES.filter((line) => !content.split('\n').map((l) => l.trim()).includes(line));
  if (!missing.length) return { file, added: [] };
  const block = (content && !content.endsWith('\n') ? '\n' : '') + '# context-md\n' + missing.join('\n') + '\n';
  atomicWriteFile(file, content + block);
  return { file, added: missing };
}

// ---------- top-level flows ----------

export function install(root, { clients = null } = {}) {
  root = path.resolve(root);
  const selected = new Set(clients ?? ['claude-code', 'codex', 'gemini-cli', 'cursor', 'opencode']);
  const report = { root, contextCreated: false, instructionFiles: [], hooks: [], opencode: null, skipped: [] };

  const ensured = ensureContextFile(root);
  report.contextCreated = ensured.created;

  copyRuntime(root);
  manageGitignore(root);

  for (const rel of INSTRUCTION_FILES) {
    report.instructionFiles.push(injectInstructionBlock(path.join(root, rel)));
  }

  for (const [id, adapter] of AGENT_ADAPTERS) {
    if (!selected.has(id)) { report.skipped.push(id); continue; }
    try {
      report.hooks.push(adapter(root));
    } catch (err) {
      report.hooks.push({ agent: id, error: String(err?.message || err) });
    }
  }

  // Final refresh LAST so context.md is newer than every file install touched
  // (gitignore, agent configs, hooks) — keeps `context-md verify` green on a
  // fresh wiring instead of reporting STALE.
  try { refreshDeterministic(root); } catch {}

  return report;
}

export function uninstall(root, { removeContext = false } = {}) {
  root = path.resolve(root);
  const report = {
    root,
    instructionFiles: removeInstructionBlocks(root),
    hooks: uninstallHooks(root),
    contextKept: !removeContext,
  };
  uninstallRuntime(root);
  if (removeContext) {
    try { fs.rmSync(contextPath(root), { force: true }); } catch {}
  }
  return report;
}

// CI-friendly freshness check: fail if the repo has changes newer than context.md.
export function verify(root) {
  root = path.resolve(root);
  const ctx = contextPath(root);
  if (!fsExists(ctx)) return { ok: false, reason: 'context.md does not exist' };
  const ctxMtime = fs.statSync(ctx).mtimeMs;
  let changed = [];
  try {
    const out = execFileSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z'], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    changed = out.split('\0').map((l) => l.slice(3).trim()).filter(Boolean)
      .map((f) => (f.includes(' -> ') ? f.split(' -> ').pop().trim() : f)) // renames: track the new path
      .filter((f) => f !== 'context.md' && !f.startsWith('.context/'));
  } catch {
    return { ok: true, reason: 'not a git repo — skipped freshness check' };
  }
  const newer = [];
  for (const rel of changed) {
    try {
      if (fs.statSync(path.join(root, rel)).mtimeMs > ctxMtime) newer.push(rel);
    } catch { /* deleted file */ }
  }
  if (newer.length) {
    return { ok: false, reason: `context.md is stale — newer changes: ${newer.slice(0, 5).join(', ')}${newer.length > 5 ? '…' : ''}. Run \`context-md refresh\`.` };
  }
  return { ok: true, reason: 'context.md is fresh' };
}
