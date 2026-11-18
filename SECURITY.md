# Security

context-md installs hooks into your repositories and, optionally, your user-level
agent configs. Please read this before using it — the tool **executes code the
next time a supported agent opens the wired repo**.

## Threat model

**What context-md is.** A file walker, a file writer, and a hook runner. It:

- writes `context.md` and keeps it fresh (agent-owned + hook-owned sections),
- injects marked instruction blocks into agent config files (AGENTS.md, …),
- copies a small JS runtime into `<repo>/.context/` and points agent hook
  configs at it,
- optionally (`--global`) writes a standalone runtime at `~/.context-md/` and
  hooks it into your user-level agent configs.

**Executable code you commit.** When you commit `.context/` (the normal flow),
every clone of the repo executes those hook files with your user privileges
whenever a supported agent starts a session, hits a tool call, submits a prompt,
or ends a turn. **Treat `.context/` diffs in pull requests exactly like CI
workflow changes.** A compromised PR that edits `.context/hooks/*.js` is remote
code execution on every contributor's machine.

**Generated configs point at `node "<abs path>" …` (global) or
`node "./.context/hooks/…"` (local).** Local commands are machine-independent and
safe to commit; global commands embed your home directory path and are kept out
of version control.

**context.md is data, not instructions.** The file may contain paths and text
sourced from your repo and tools (branch names, file paths, script names). An
agent reading it must not treat its content as directives. The injected protocol
tells agents exactly that.

## What the tool guarantees

- Zero runtime dependencies, no network calls, no telemetry, no postinstall.
- Writes refuse symlinks (`lstat` check) and are atomic (tmp file + rename).
- Your JSON configs are backed up as `*.bak-<timestamp>` before any change, and
  BOM-prefixed configs are handled on both read and write.
- If an agent config exists but is unreadable/invalid JSON, the adapter **skips
  that agent** instead of overwriting your file.
- If your `hooks` object contains an unexpected shape (non-array value) for one
  of our managed events, the adapter leaves it untouched and reports an error.
- Uninstall removes only hook entries that point at `.context/hooks/` or
  `.context-md/hooks/` (backed up first), the runtime, our instruction blocks
  and the repo's `.context/` — never anything else. `context.md` is kept unless
  you pass `--remove-context`.
- Global mode only activates in project-like folders (containing `.git` or a
  known manifest) and defers to a repo's local wiring when present.

## What it cannot protect you from (honest limits)

- **Agent decisions.** The gates (read gate, stop gate) are advisory deny-lists,
  not a sandbox. A malicious or careless agent can ignore its instruction file,
  and hooks cannot force an LLM to remember anything it refuses to persist.
- **A repo that ships hostile hooks before you install.** Inspect `.context/`
  after first opening an untrusted repo — it is yours to audit, not ours.
- **`--global` blast radius.** User-level wiring applies to every project you
  open, including ones you never intended to wire. Use
  `context-md uninstall --global` to undo.
- **Backup files** (`*.bak-<timestamp>`) contain your pre-edit agent configs,
  which may include MCP server URLs, absolute paths, or API keys if you stored
  them there. They are gitignored in wired repos but must not be committed —
  delete them when you are satisfied with the result.
- Races in `.context/session-state.json` (read-modify-write with no lock) —
  gates may occasionally misfire under heavy parallelism; they are designed to
  fail best-effort, never to destroy data.

## Safe use

1. Run `npx github:<owner>/context-md install` only in repos you trust.
2. Review the diff before committing `.context/`.
3. Review any agent-config diff it produces.
4. Never point `--home` at anything but a real user home directory.
5. In CI, use `context-md verify` as a freshness check, never as a security
  boundary.

## Reporting a vulnerability

Please do **not** open a public issue. Once the project is public, use GitHub's
private vulnerability reporting ("Report a vulnerability" in the Security tab).
Until then, open a minimal issue titled `security contact requested` and the
maintainer will arrange a private channel. Include the file, the trigger, and a
minimal reproduction; do not include secrets.

Supported versions: the latest release only.
