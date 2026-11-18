// Interactive agent picker (zero dependencies). Only used on a TTY without flags.
import readline from 'node:readline/promises';

export function printDetection(detected) {
  console.log('context-md: detecting agents on this machine…\n');
  for (const [i, a] of detected.entries()) {
    const marks = [a.onPath ? 'command on PATH' : null, a.configSeen ? `config ~/${a.config} seen` : null].filter(Boolean);
    console.log(`  [${i + 1}] ${a.label.padEnd(18)} ${marks.length ? `(${marks.join(', ')})` : '(not detected)'}`);
  }
  console.log('');
}

// Default = all detected (or all agents if nothing detected). Returns ids.
export async function pickAgents(detected) {
  const defaults = detected.filter((a) => a.detected).map((a) => a.id);
  const fallback = defaults.length ? defaults : detected.map((a) => a.id);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Wire hooks into which agents?');
    console.log('  Enter = all detected, numbers like "1,3,5" = pick, "a" = all, "n" = none');
    const answer = (await rl.question('Selection > ')).trim().toLowerCase();

    if (!answer) return fallback;
    if (answer === 'a' || answer === 'all') return detected.map((a) => a.id);
    if (answer === 'n' || answer === 'none') return [];
    const picks = answer.split(/[\s,]+/).filter(Boolean).map((tok) => Number(tok)).filter((n) => Number.isInteger(n));
    const chosen = picks.map((n) => detected[n - 1]?.id).filter(Boolean);
    return chosen.length ? [...new Set(chosen)] : fallback;
  } finally {
    rl.close();
  }
}

// Non-interactive: resolve the selected client list from flags/env/default.
export function resolveClients(args, detected) {
  const eq = args.find((a) => a.startsWith('--clients='));
  const idx = args.indexOf('--clients');
  const raw = eq ? eq.slice('--clients='.length) : idx !== -1 ? args[idx + 1] : null;
  if (raw === 'all' || args.includes('--all')) return detected.map((a) => a.id);
  if (raw) {
    const wanted = raw.split(/[\s,]+/).filter(Boolean);
    const ids = new Set(detected.map((a) => a.id));
    const unknown = wanted.filter((w) => !ids.has(w));
    if (unknown.length) {
      console.error(`error: unknown client(s): ${unknown.join(', ')}. Known: ${detected.map((a) => a.id).join(', ')}`);
      process.exit(2);
    }
    return [...new Set(wanted)];
  }
  // Non-TTY default: wire everything (safe, matches previous behavior).
  return detected.map((a) => a.id);
}
