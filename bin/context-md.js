#!/usr/bin/env node
// context-md — live context.md for every AI agent, kept current via hooks.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { install, uninstall, verify } from '../src/install.js';
import { refreshDeterministic, ensureContextFile, contextPath } from '../src/context-file.js';
import { findRoot } from '../src/scan.js';

const VERSION = '0.1.0';

function usage() {
  console.log(`context-md v${VERSION} — live context.md for every AI agent

Usage:
  context-md install [dir]      Wire this repo to context-md (default: cwd / git root)
  context-md uninstall [dir]    Remove instruction blocks + hooks (keeps context.md)
  context-md uninstall --remove-context [dir]   Also delete context.md
  context-md refresh [dir]      Regenerate snapshot/structure sections now
  context-md verify [dir]       Exit 1 if context.md is stale vs git changes (for CI)
  context-md status [dir]       Print install status for this repo
  context-md --version | --help

After install, every supported AI agent will read context.md before work and
hooks keep its change log real-time. Commit context.md to share it with your team.`);
}

function resolveTarget(args) {
  const positional = args.filter((a) => !a.startsWith('-'));
  const dir = positional[0] ? path.resolve(positional[0]) : findRoot(process.cwd());
  if (!fs.existsSync(dir)) {
    console.error(`error: directory not found: ${dir}`);
    process.exit(2);
  }
  return dir;
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

const [command, ...rest] = process.argv.slice(2);
const args = rest;

switch (command) {
  case 'install':
    printReport(install(resolveTarget(args)));
    break;
  case 'uninstall':
    printReport(uninstall(resolveTarget(args), { removeContext: args.includes('--remove-context') }));
    break;
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
    console.log(`root:       ${root}`);
    console.log(`context.md: ${exists ? 'present' : 'MISSING'}`);
    for (const [rel, ok] of hooks) console.log(`${ok ? 'wired  ' : 'missing'} ${rel}`);
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
