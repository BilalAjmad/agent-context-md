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
