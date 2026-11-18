// context-md — opencode plugin (v1 + v2 compatible)
// Refreshes context.md on session start and after file edits.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function run(hook, input) {
  try {
    execFileSync(process.execPath, [path.join(root, '.context', 'hooks', hook)], {
      input: JSON.stringify(input ?? {}),
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 10000,
    });
  } catch {
    // Hooks are best-effort: never break the agent loop.
  }
}

const v1 = async () => ({
  'session.created': async () => run('session-start.js'),
  'tool.execute.after': async (input) => run('post-tool.js', input),
});

let v2 = null;
try {
  const mod = await import('@opencode/plugin');
  v2 = mod.Plugin.define({
    id: 'context-md',
    setup(ctx) {
      ctx.tool.hook('execute.after', () => run('post-tool.js'));
    },
  });
} catch {
  v2 = { id: 'context-md' }; // @opencode/plugin unavailable — rely on v1 export
}

export default { ...v2, server: v1 };
