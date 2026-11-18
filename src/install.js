// Installation logic: instruction files + per-agent hook adapters.
// Every mutation is idempotent (marked blocks / identifiable hook entries) and
// JSON configs are backed up before modification.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instructionBlock, INSTRUCTION_MARKER, INSTRUCTION_END, OPENCODE_PLUGIN, SESSION_START_HOOK, POST_TOOL_HOOK, STOP_HOOK } from './templates.js';
import { ensureContextFile, refreshDeterministic, contextPath } from './context-file.js';

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

const HOOK_TAG = '.context/hooks/';

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
  if (next.trim()) fs.writeFileSync(file, next, 'utf8');
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
    fs.writeFileSync(file, (frontmatter ? frontmatter + '\n' : '') + block + '\n', 'utf8');
    return { action: 'created', file };
  }

  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(INSTRUCTION_MARKER)) {
    // Refresh in place (update to the latest block version).
    const s = content.indexOf(INSTRUCTION_MARKER);
    const e = content.indexOf(INSTRUCTION_END, s);
    if (e !== -1) {
      const next = content.slice(0, s) + block + content.slice(e + INSTRUCTION_END.length);
      if (next !== content) fs.writeFileSync(file, next, 'utf8');
      return { action: 'refreshed', file };
    }
  }
  fs.writeFileSync(file, content.replace(/\s+$/g, '') + '\n\n' + block + '\n', 'utf8');
  return { action: 'appended', file };
}

export function removeInstructionBlocks(root, files = INSTRUCTION_FILES) {
  const results = [];
  for (const rel of files) {
    results.push({ file: rel, ...removeMarkedBlock(path.join(root, rel)) });
  }
  return results;
}

// ---------- hooks + vendored lib ----------

export function copyRuntime(root) {
  const destLib = path.join(root, '.context', 'lib');
  const destHooks = path.join(root, '.context', 'hooks');
  fs.mkdirSync(destLib, { recursive: true });
  fs.mkdirSync(destHooks, { recursive: true });

  fs.copyFileSync(path.join(SRC_DIR, 'scan.js'), path.join(destLib, 'scan.js'));
  fs.copyFileSync(path.join(SRC_DIR, 'context-file.js'), path.join(destLib, 'context-file.js'));
  fs.writeFileSync(path.join(destHooks, 'session-start.js'), SESSION_START_HOOK, 'utf8');
  fs.writeFileSync(path.join(destHooks, 'post-tool.js'), POST_TOOL_HOOK, 'utf8');
  fs.writeFileSync(path.join(destHooks, 'stop-check.js'), STOP_HOOK, 'utf8');
  // ESM modules even when the target repo has no "type": "module".
  fs.writeFileSync(path.join(root, '.context', 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n', 'utf8');
  return { lib: destLib, hooks: destHooks };
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
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Merge context-md hook entries into a Claude/Codex-style settings object.
// shape: { SessionStart: [{matcher?, hooks: [{type, command, ...}]}] }
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
    if (JSON.stringify(groups[i]).includes(HOOK_TAG)) lastContext = i;
  }
  return groups.filter((g, i) => !JSON.stringify(g).includes(HOOK_TAG) || i === lastContext);
}

function hookCommand(root, script) {
  // Forward slashes: valid on every shell/node, and keeps the
  // ".context/hooks/" marker consistent across platforms.
  return `node "${path.join(root, '.context', 'hooks', script).replace(/\\/g, '/')}"`;
}

// Claude Code: .claude/settings.json
export function installClaude(root) {
  const file = path.join(root, '.claude', 'settings.json');
  const settings = readJson(file) ?? {};
  const cmd = hookCommand(root, 'post-tool.js');
  const start = hookCommand(root, 'session-start.js');
  const stop = `node "${path.join(root, '.context', 'hooks', 'stop-check.js').replace(/\\/g, '/')}" --agent=claude`;
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [
      { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: start, timeout: 15 }] },
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
export function installCodex(root) {
  const file = path.join(root, '.codex', 'hooks.json');
  const config = readJson(file) ?? { description: 'context-md hooks', hooks: {} };
  const stop = `node "${path.join(root, '.context', 'hooks', 'stop-check.js').replace(/\\/g, '/')}" --agent=codex`;
  config.hooks = mergeHooks(config.hooks, {
    SessionStart: [
      { matcher: 'startup|resume|clear|compact|fork', hooks: [{ type: 'command', command: hookCommand(root, 'session-start.js'), timeout: 15 }] },
    ],
    PostToolUse: [
      { matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: hookCommand(root, 'post-tool.js'), timeout: 15 }] },
    ],
    Stop: [
      { hooks: [{ type: 'command', command: stop, timeout: 15 }] },
    ],
  });
  writeJson(file, config);
  return { agent: 'codex', file };
}

// Gemini CLI: .gemini/settings.json — hooks key merged into project settings
export function installGemini(root) {
  const file = path.join(root, '.gemini', 'settings.json');
  const settings = readJson(file) ?? {};
  const cmd = hookCommand(root, 'post-tool.js');
  const start = hookCommand(root, 'session-start.js');
  const stop = `node "${path.join(root, '.context', 'hooks', 'stop-check.js').replace(/\\/g, '/')}" --agent=gemini`;
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [
      { matcher: '*', hooks: [{ name: 'context-md', type: 'command', command: start, timeout: 15000, description: 'Refresh context.md at session start' }] },
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
export function installCursor(root) {
  const file = path.join(root, '.cursor', 'hooks.json');
  const config = readJson(file) ?? { version: 1, hooks: {} };
  const cmd = hookCommand(root, 'post-tool.js');
  const start = hookCommand(root, 'session-start.js');
  config.version = 1;
  const stop = `node "${path.join(root, '.context', 'hooks', 'stop-check.js').replace(/\\/g, '/')}" --agent=cursor`;
  config.hooks = mergeHooks(config.hooks, {
    sessionStart: [{ command: start, timeout: 15 }],
    postToolUse: [{ command: cmd, timeout: 15, matcher: 'Write|Edit|Shell' }],
    stop: [{ command: stop, timeout: 15, loop_limit: 2 }],
  });
  writeJson(file, config);
  return { agent: 'cursor', file };
}

// opencode: .opencode/plugins/context-md.js — auto-discovered, no config edit needed
export function installOpencode(root) {
  const file = path.join(root, '.opencode', 'plugins', 'context-md.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, OPENCODE_PLUGIN, 'utf8');
  return { agent: 'opencode', file };
}

export const AGENT_ADAPTERS = [
  installClaude,
  installCodex,
  installGemini,
  installCursor,
  installOpencode,
];

// Remove only context-md hook entries (identified by ".context/hooks/").
function unmergeHooks(existing) {
  if (!existing || typeof existing !== 'object') return {};
  const hooks = {};
  for (const [event, groups] of Object.entries(existing)) {
    if (!Array.isArray(groups)) { hooks[event] = groups; continue; }
    const kept = groups.filter((g) => !JSON.stringify(g).includes(HOOK_TAG));
    if (kept.length) hooks[event] = kept;
  }
  return hooks;
}

export function uninstallHooks(root) {
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
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    results.push({ file: `${dir}/${name}`, removed: true });
  }
  const opencodePlugin = path.join(root, '.opencode', 'plugins', 'context-md.js');
  if (fsExists(opencodePlugin)) { fs.unlinkSync(opencodePlugin); results.push({ file: '.opencode/plugins/context-md.js', removed: true }); }
  else results.push({ file: '.opencode/plugins/context-md.js', removed: false });
  return results;
}

export function uninstallRuntime(root) {
  for (const rel of [
    '.context/hooks/session-start.js',
    '.context/hooks/post-tool.js',
    '.context/hooks/stop-check.js',
    '.context/lib/scan.js',
    '.context/lib/context-file.js',
    '.context/package.json',
    '.context/.last-scan',
    '.context/session-state.json',
  ]) {
    try { fs.rmSync(path.join(root, rel), { force: true }); } catch {}
  }
  for (const dir of ['.context/hooks', '.context/lib', '.context']) {
    try { fs.rmdirSync(path.join(root, dir)); } catch { /* not empty — user files remain */ }
  }
}

// ---------- top-level flows ----------

export function install(root) {
  root = path.resolve(root);
  const report = { root, contextCreated: false, instructionFiles: [], hooks: [], opencode: null };

  const ensured = ensureContextFile(root);
  report.contextCreated = ensured.created;

  copyRuntime(root);

  for (const rel of INSTRUCTION_FILES) {
    report.instructionFiles.push(injectInstructionBlock(path.join(root, rel)));
  }

  for (const adapter of AGENT_ADAPTERS) {
    try {
      report.hooks.push(adapter(root));
    } catch (err) {
      report.hooks.push({ agent: adapter.name.replace(/^install/, '').toLowerCase(), error: String(err?.message || err) });
    }
  }

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
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    changed = out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
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
