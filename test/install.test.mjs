import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'context-md.js');
let fixture;

function run(args, opts = {}) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts }).trim();
}

before(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-test-'));
  execSync('git init -b main', { cwd: fixture, stdio: 'pipe' });
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'fixture-app',
    version: '1.0.0',
    dependencies: { react: '^19.0.0', next: '^16.0.0' },
    scripts: { dev: 'next dev', test: 'node --test' },
  }, null, 2));
  fs.mkdirSync(path.join(fixture, 'src'));
  fs.writeFileSync(path.join(fixture, 'src', 'index.js'), 'console.log("hi")');
  execSync('git add -A && git -c user.email=test@example.com -c user.name=test commit -m init', { cwd: fixture, stdio: 'pipe' });
});

after(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('install creates context.md with all marker sections', () => {
  const out = run(['install', fixture]);
  assert.match(out, /context\.md\s+created/);
  const ctx = fs.readFileSync(path.join(fixture, 'context.md'), 'utf8');
  for (const marker of ['context-md:snapshot:start', 'context-md:structure:start', 'context-md:log:start']) {
    assert.ok(ctx.includes(marker), `missing ${marker}`);
  }
  assert.match(ctx, /Next\.js/, 'stack detection should find Next.js');
  assert.match(ctx, /Snapshot/);
});

test('install wires Claude Code, Codex, Gemini, Cursor, opencode', () => {
  for (const rel of ['.claude/settings.json', '.codex/hooks.json', '.gemini/settings.json', '.cursor/hooks.json']) {
    const file = path.join(fixture, rel);
    assert.ok(fs.existsSync(file), `${rel} missing`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(JSON.stringify(json).includes('.context/hooks/'), `${rel} has no context-md hooks`);
  }
  assert.ok(fs.existsSync(path.join(fixture, '.opencode/plugins/context-md.js')));
});

test('install writes instruction blocks into agent instruction files', () => {
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/context-md.mdc', '.kiro/steering/context-md.md']) {
    const file = path.join(fixture, rel);
    assert.ok(fs.existsSync(file), `${rel} missing`);
    assert.ok(fs.readFileSync(file, 'utf8').includes('<!-- context-md:start -->'), `${rel} missing block`);
  }
});

test('install adds .context session files to .gitignore but keeps .context committable', () => {
  const gitignore = fs.readFileSync(path.join(fixture, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.context\/session-state\.json/);
  assert.match(gitignore, /\.context\/\.last-scan/);
  assert.ok(!gitignore.split('\n').some((l) => l.trim() === '.context/'), '.context/ itself must not be ignored');
  // idempotent: second install does not duplicate
  run(['install', fixture]);
  const again = fs.readFileSync(path.join(fixture, '.gitignore'), 'utf8');
  assert.equal((again.match(/\.context\/session-state\.json/g) || []).length, 1);
});

test('install is idempotent — blocks and hooks do not duplicate', () => {
  run(['install', fixture]);
  const agents = fs.readFileSync(path.join(fixture, 'AGENTS.md'), 'utf8');
  const occurrences = agents.split('<!-- context-md:start -->').length - 1;
  assert.equal(occurrences, 1, 'instruction block duplicated');
  const settings = JSON.parse(fs.readFileSync(path.join(fixture, '.claude/settings.json'), 'utf8'));
  const sessionStart = JSON.stringify(settings.hooks.SessionStart);
  const occurrences2 = sessionStart.split('.context/hooks/').length - 1;
  assert.equal(occurrences2, 1, 'claude SessionStart hook duplicated');
});

test('post-tool hook appends to Change Log', () => {
  const hook = path.join(fixture, '.context', 'hooks', 'post-tool.js');
  execFileSync(process.execPath, [hook], { cwd: fixture, input: JSON.stringify({ tool_input: { file_path: 'src/index.js' } }), stdio: ['pipe', 'pipe', 'pipe'] });
  const ctx = fs.readFileSync(path.join(fixture, 'context.md'), 'utf8');
  assert.match(ctx, /edited src[\\/]index\.js/);
});

test('session-start hook emits agent-compatible JSON and refreshes', () => {
  const hook = path.join(fixture, '.context', 'hooks', 'session-start.js');
  const out = execFileSync(process.execPath, [hook], { cwd: fixture, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.match(parsed.hookSpecificOutput.additionalContext, /context\.md/);
});

test('refresh updates snapshot timestamp', async () => {
  const before1 = fs.readFileSync(path.join(fixture, 'context.md'), 'utf8');
  await new Promise((r) => setTimeout(r, 1100));
  run(['refresh', fixture]);
  const after1 = fs.readFileSync(path.join(fixture, 'context.md'), 'utf8');
  assert.notEqual(before1, after1, 'snapshot should change on refresh');
});

test('verify passes on fresh context and fails after newer edits', async () => {
  assert.match(run(['verify', fixture]), /OK|STALE/);
  // Make a tracked change newer than context.md
  await new Promise((r) => setTimeout(r, 1100));
  fs.writeFileSync(path.join(fixture, 'src', 'index.js'), 'console.log("changed")');
  execSync('git add -A', { cwd: fixture, stdio: 'pipe' });
  let code = 0;
  try {
    run(['verify', fixture]);
  } catch (err) {
    code = err.status;
  }
  assert.equal(code, 1, 'verify should fail when repo changed after context.md');
  run(['refresh', fixture]);
  assert.match(run(['verify', fixture]), /OK/);
});

test('stop gate blocks turn-end after edits without context.md update', () => {
  const postTool = path.join(fixture, '.context', 'hooks', 'post-tool.js');
  const stopCheck = path.join(fixture, '.context', 'hooks', 'stop-check.js');
  // One non-context edit → pendingEdit = true
  execFileSync(process.execPath, [postTool], { cwd: fixture, input: JSON.stringify({ tool_input: { file_path: 'src/index.js' } }), stdio: ['pipe', 'pipe', 'pipe'] });
  const state = JSON.parse(fs.readFileSync(path.join(fixture, '.context', 'session-state.json'), 'utf8'));
  assert.equal(state.pendingEdit, true);
  // Stop gate must block with a Claude/Codex-style decision JSON
  const blocked = execFileSync(process.execPath, [stopCheck, '--agent=claude'], { cwd: fixture, input: '{}', encoding: 'utf8' });
  assert.deepEqual(Object.keys(JSON.parse(blocked)), ['decision', 'reason']);
  assert.equal(JSON.parse(blocked).decision, 'block');
});

test('stop gate passes after an agent edit of context.md', () => {
  const postTool = path.join(fixture, '.context', 'hooks', 'post-tool.js');
  const stopCheck = path.join(fixture, '.context', 'hooks', 'stop-check.js');
  // Agent updates context.md → pendingEdit cleared
  execFileSync(process.execPath, [postTool], { cwd: fixture, input: JSON.stringify({ tool_input: { file_path: 'context.md' } }), stdio: ['pipe', 'pipe', 'pipe'] });
  const state = JSON.parse(fs.readFileSync(path.join(fixture, '.context', 'session-state.json'), 'utf8'));
  assert.equal(state.pendingEdit, false);
  const out = execFileSync(process.execPath, [stopCheck, '--agent=claude'], { cwd: fixture, input: '{}', encoding: 'utf8' });
  assert.equal(out.trim(), '{}');
});

test('stop gate passes when already continuing after a stop hook', () => {
  const stopCheck = path.join(fixture, '.context', 'hooks', 'stop-check.js');
  // Make state pending again
  fs.writeFileSync(path.join(fixture, '.context', 'session-state.json'), JSON.stringify({ edits: 3, pendingEdit: true, lastEdit: new Date().toISOString() }));
  const out = execFileSync(process.execPath, [stopCheck, '--agent=claude'], { cwd: fixture, input: JSON.stringify({ stop_hook_active: true }), encoding: 'utf8' });
  assert.equal(out.trim(), '{}');
});

test('stop gate outputs gemini and cursor shapes', () => {
  const stopCheck = path.join(fixture, '.context', 'hooks', 'stop-check.js');
  const outGemini = execFileSync(process.execPath, [stopCheck, '--agent=gemini'], { cwd: fixture, input: '{}', encoding: 'utf8' });
  assert.equal(JSON.parse(outGemini).decision, 'deny');
  const outCursor = execFileSync(process.execPath, [stopCheck, '--agent=cursor'], { cwd: fixture, input: '{}', encoding: 'utf8' });
  assert.match(JSON.parse(outCursor).followup_message, /context\.md/);
});

test('global install wires a fake HOME and auto-onboards a fresh project', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-fresh-'));
  try {
    execSync('git init -b main', { cwd: proj, stdio: 'pipe' });
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"fresh"}');
    run(['install', '--global', '--home', home]);
    assert.ok(fs.existsSync(path.join(home, '.context-md', 'hooks', 'session-start.js')), 'global runtime installed');
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.ok(JSON.stringify(settings).includes('.context-md/hooks/'), 'global claude hooks wired');

    // Simulate a SessionStart in the fresh project: context.md must auto-create
    const start = path.join(home, '.context-md', 'hooks', 'session-start.js');
    const out = execFileSync(process.execPath, [start], { cwd: proj, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /FIRST-RUN BACKFILL/);
    assert.ok(fs.existsSync(path.join(proj, 'context.md')), 'context.md auto-created for fresh project');

    // Agent edits a file, then tries to stop → gate must block (backfill pending)
    const post = path.join(home, '.context-md', 'hooks', 'post-tool.js');
    execFileSync(process.execPath, [post], { cwd: proj, input: JSON.stringify({ tool_input: { file_path: 'package.json' } }), stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = path.join(home, '.context-md', 'hooks', 'stop-check.js');
    const blocked = execFileSync(process.execPath, [stop, '--agent=claude'], { cwd: proj, input: '{}', encoding: 'utf8' });
    assert.equal(JSON.parse(blocked).decision, 'block');

    // Agent does the backfill: edits context.md → gate passes
    execFileSync(process.execPath, [post], { cwd: proj, input: JSON.stringify({ tool_input: { file_path: 'context.md' } }), stdio: ['pipe', 'pipe', 'pipe'] });
    const after = execFileSync(process.execPath, [stop, '--agent=claude'], { cwd: proj, input: '{}', encoding: 'utf8' });
    assert.equal(after.trim(), '{}');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('global hooks defer when the repo has local wiring (no duplicate logging)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-local-'));
  try {
    execSync('git init -b main', { cwd: proj, stdio: 'pipe' });
    run(['install', '--global', '--home', home]);
    run(['install', proj]);
    const start = path.join(home, '.context-md', 'hooks', 'session-start.js');
    const out = execFileSync(process.execPath, [start], { cwd: proj, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    assert.equal(out, '{}', 'global must defer to local runtime in wired repos');
    const ctx = fs.readFileSync(path.join(proj, 'context.md'), 'utf8');
    assert.equal((ctx.match(/session started/g) || []).length, 0, 'global wrote no changelog line');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('global uninstall removes machine-wide wiring', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context-md-home-'));
  try {
    run(['install', '--global', '--home', home]);
    assert.ok(fs.existsSync(path.join(home, '.context-md')));
    run(['uninstall', '--global', '--home', home]);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.ok(!JSON.stringify(settings).includes('.context-md/hooks/'), 'global hooks removed');
    assert.ok(!fs.existsSync(path.join(home, '.context-md')), 'runtime removed');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('uninstall removes blocks and hooks but keeps context.md', () => {
  const out = run(['uninstall', fixture]);
  assert.match(out, /kept/);
  const agents = fs.existsSync(path.join(fixture, 'AGENTS.md'))
    ? fs.readFileSync(path.join(fixture, 'AGENTS.md'), 'utf8')
    : '';
  assert.ok(!agents.includes('<!-- context-md:start -->'));
  const settings = JSON.parse(fs.readFileSync(path.join(fixture, '.claude/settings.json'), 'utf8'));
  assert.ok(!JSON.stringify(settings).includes('.context/hooks/'));
  assert.ok(fs.existsSync(path.join(fixture, 'context.md')), 'context.md must be kept by default');
  assert.ok(!fs.existsSync(path.join(fixture, '.context', 'hooks')), '.context/hooks should be removed');
});
