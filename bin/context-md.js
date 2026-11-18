#!/usr/bin/env node
// context-md — live context.md for every AI agent, kept current via hooks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { install, uninstall, uninstallGlobal, installGlobal, verify } from '../src/install.js';
import { refreshDeterministic, ensureContextFile, contextPath } from '../src/context-file.js';
import { findRoot } from '../src/scan.js';

const VERSION = '0.1.0';

function usage() {
  console.log(`context-md v${VERSION} — live context.md for every AI agent

Usage:
  context-md install [dir]      Wire this repo to context-md (default: cwd / git root)
  context-md install --global   Default for THIS machine: ~/.context-md runtime + global
                                hooks — any project you open gets context.md automatically
  context-md uninstall [dir]    Remove instruction blocks + hooks (keeps context.md)
  context-md uninstall --global Remove machine-wide default wiring + runtime
  context-md uninstall --remove-context [dir]   Also delete context.md
  context-md backfill [dir]     Regenerate context.md + print the backfill protocol
  context-md doctor [dir]       Health check: context.md markers, hook files, agent configs
  context-md refresh [dir]      Regenerate snapshot/structure sections now
  context-md verify [dir]       Exit 1 if context.md is stale vs git changes (for CI)
  context-md status [dir]       Print install status for this repo
  context-md --version | --help

After install, every supported AI agent will read context.md before work and
hooks keep its change log real-time. Commit context.md to share it with your team.
Repos wired before backfill existed get ONE backfill pass on their next session.`);
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function resolveTarget(args) {
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--home') { i++; continue; } // skip flag + value
    filtered.push(args[i]);
  }
  const positional = filtered.filter((a) => !a.startsWith('-'));
  const dir = positional[0] ? path.resolve(positional[0]) : findRoot(process.cwd());
  if (!fs.existsSync(dir)) {
    console.error(`error: directory not found: ${dir}`);
    process.exit(2);
  }
  return dir;
}

function globalHome(args) {
  const home = flagValue(args, '--home');
  return home ? path.resolve(home) : undefined;
}

function printReport(report) {
  if (report.contextCreated !== undefined) {
    console.log(`context.md        ${report.contextCreated ? 'created' : 'updated'}`);
    console.log(`instruction files:`);
    for (const item of report.instructionFiles) {
      console.log(`  ${item.action.padEnd(9)} ${item.file}`);
    }
    console.log(`agent hooks:`);
    for (const item of report.hooks) {
      console.log(`  ${item.error ? `FAILED: ${item.error}` : 'wired'}   ${item.agent}${item.file ? ` -> ${path.relative(report.root, item.file)}` : ''}`);
    }
    console.log('\nDone. Agents now see context.md at session start. Commit context.md to share with your team.');
    return;
  }
  for (const item of report.instructionFiles) console.log(`  block ${item.removed ? 'removed' : 'absent'}  ${item.file}`);
  for (const item of report.hooks) console.log(`  hook  ${item.removed ? 'removed' : 'absent'}  ${item.file}`);
  console.log(`context.md        ${report.contextKept ? 'kept (use --remove-context to delete)' : 'removed'}`);
}

function printGlobalReport(report) {
  if (report.runtime) {
    console.log(`runtime          ${path.join(report.home, '.context-md')} (lib + hooks + opencode plugin)`);
    console.log(`instruction files:`);
    for (const item of report.instructionFiles) {
      console.log(`  ${item.action.padEnd(9)} ${path.join(report.home, item.file ?? '')}`);
    }
    console.log(`agent hooks (global):`);
    for (const item of report.hooks) {
      console.log(`  ${item.error ? `FAILED: ${item.error}` : 'wired'}   ${item.agent}`);
    }
    console.log(`opencode         ${report.opencode?.error ? `FAILED: ${report.opencode.error}` : 'wired   global plugin'}`);
    console.log('\nGlobal default is ON. Open ANY project with these agents and context.md appears automatically.');
    return;
  }
  for (const item of report.instructionFiles) console.log(`  block ${item.removed ? 'removed' : 'absent'}  ${item.file}`);
  for (const item of report.hooks) console.log(`  hook  ${item.removed ? 'removed' : 'absent'}  ${item.file ?? ''}`);
  console.log(`opencode         ${report.opencode?.removed ? 'plugin removed' : 'plugin absent'}`);
  console.log(`runtime          removed   ${path.join(report.home, '.context-md')}`);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

const [command, ...rest] = process.argv.slice(2);
const args = rest;

switch (command) {
  case 'install':
    if (args.includes('--global')) { printGlobalReport(installGlobal({ home: globalHome(args) })); break; }
    printReport(install(resolveTarget(args)));
    break;
  case 'uninstall':
    if (args.includes('--global')) { printGlobalReport(uninstallGlobal({ home: globalHome(args) })); break; }
    printReport(uninstall(resolveTarget(args), { removeContext: args.includes('--remove-context') }));
    break;
  case 'backfill': {
    const root = resolveTarget(args);
    ensureContextFile(root);
    refreshDeterministic(root);
    console.log('Backfill protocol for the AI agent working in this repo:');
    console.log('1. Read README* and docs/ if any, the manifests (package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml), and the 2-4 most important source files.');
    console.log('2. Run `git log --oneline -50` to understand the arc of the project.');
    console.log('3. Rewrite context.md Purpose and Key Knowledge with the REAL project purpose, stack decisions, conventions and gotchas. No placeholders.');
    console.log('4. Create an empty file .context/.backfill-done (mkdir -p .context first if needed).');
    console.log('5. context.md refreshed at:', contextPath(root));
    break;
  }
  case 'doctor': {
    const root = resolveTarget(args);
    const results = [];
    const check = (label, ok, info = '') => results.push({ label, ok, info });
    const ctx = contextPath(root);
    const ctxExists = fs.existsSync(ctx);
    check('context.md exists', ctxExists);
    if (ctxExists) {
      const body = fs.readFileSync(ctx, 'utf8');
      const markers = ['context-md:snapshot:start', 'context-md:structure:start', 'context-md:log:start', 'context-md:snapshot:end'];
      const missing = markers.filter((m) => !body.includes(m));
      check('context.md markers intact', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : '');
    }
    for (const rel of ['.context/hooks/session-start.js', '.context/hooks/post-tool.js', '.context/hooks/read-gate.js', '.context/hooks/prompt-gate.js', '.context/hooks/stop-check.js']) {
      check(rel, fs.existsSync(path.join(root, rel)));
    }
    for (const rel of ['.claude/settings.json', '.codex/hooks.json', '.gemini/settings.json', '.cursor/hooks.json']) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) { results.push({ label: rel, ok: true, info: 'not wired (ok if global mode or intentional)' }); continue; }
      const data = readJsonFile(file);
      const holds = data !== null && (JSON.stringify(data).includes('.context/hooks/') || JSON.stringify(data).includes('.context-md/hooks/'));
      check(`${rel} parses + carries context-md hooks`, data !== null && holds, data === null ? 'invalid JSON' : '');
    }
    let failed = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.info ? `  — ${r.info}` : ''}`);
      if (!r.ok) failed++;
    }
    console.log(failed ? `\n${failed} problem(s) found — run \`context-md refresh\` or reinstall.` : '\nAll checks passed.');
    process.exit(failed ? 1 : 0);
    break;
  }
  case 'refresh': {
    const root = resolveTarget(args);
    ensureContextFile(root);
    refreshDeterministic(root);
    console.log(`context.md refreshed: ${contextPath(root)}`);
    break;
  }
  case 'verify': {
    const root = resolveTarget(args);
    const result = verify(root);
    console.log(`${result.ok ? 'OK' : 'STALE'}: ${result.reason}`);
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'status': {
    const root = resolveTarget(args);
    const exists = fs.existsSync(contextPath(root));
    const hooks = ['.claude/settings.json', '.codex/hooks.json', '.gemini/settings.json', '.cursor/hooks.json', '.opencode/plugins/context-md.js']
      .map((rel) => [rel, fs.existsSync(path.join(root, rel))]);
    const homeDir = os.homedir();
    let globalRuntime = fs.existsSync(path.join(homeDir, '.context-md', 'hooks', 'session-start.js'));
    let globalHook = false;
    try {
      globalHook = JSON.stringify(readJsonFile(path.join(homeDir, '.claude', 'settings.json')) ?? {}).includes('.context-md/hooks/');
    } catch { /* unreadable */ }
    console.log(`root:       ${root}`);
    console.log(`context.md: ${exists ? 'present' : 'MISSING'}`);
    for (const [rel, ok] of hooks) console.log(`${ok ? 'wired  ' : 'missing'} ${rel}`);
    console.log(`global:     ${globalRuntime ? 'runtime present (~/.context-md)' : 'runtime absent'} · ${globalHook ? 'global hooks wired' : 'global hooks not wired'}`);
    console.log('global off/on: `context-md uninstall --global` / `context-md install --global`');
    process.exit(exists ? 0 : 1);
    break;
  }
  case '--version':
  case '-v':
    console.log(VERSION);
    break;
  case '--help':
  case '-h':
  case undefined:
    usage();
    break;
  default:
    console.error(`unknown command: ${command}\n`);
    usage();
    process.exit(2);
}
