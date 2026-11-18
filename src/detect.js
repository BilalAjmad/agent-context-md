// Agent detection: which AI coding agents are present on this machine?
// Detection is read-only: PATH lookup + config-directory existence. Never writes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', cmd: 'claude', config: '.claude' },
  { id: 'codex', label: 'Codex (OpenAI)', cmd: 'codex', config: '.codex' },
  { id: 'gemini-cli', label: 'Gemini CLI', cmd: 'gemini', config: '.gemini' },
  { id: 'cursor', label: 'Cursor', cmd: 'cursor', config: '.cursor' },
  { id: 'opencode', label: 'opencode', cmd: 'opencode', config: '.config/opencode' },
];

function onPath(cmd) {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(finder, [cmd], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export function detectAgents({ home = os.homedir() } = {}) {
  return AGENTS.map((agent) => ({
    ...agent,
    onPath: onPath(agent.cmd),
    configSeen: fs.existsSync(path.join(home, agent.config)),
    detected: onPath(agent.cmd) || fs.existsSync(path.join(home, agent.config)),
  }));
}
