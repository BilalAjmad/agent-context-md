# context-md

**Live `context.md` for every AI agent. One file. Real-time. Zero context loss.**

Install it once into any repository. From then on, every AI agent that opens the
repo — Claude Code, Codex, Cursor, Gemini CLI, opencode, Copilot, and more —
reads a single, always-fresh `context.md` before doing any work, and hooks keep
its change log real-time after every file edit.

```bash
npx github:<your-github-user>/context-md install
```

That's it. Commit `context.md`, and your whole team (and every agent) starts
every session with full context.

## The problem

Every AI coding session starts with amnesia. The agent re-derives the stack,
re-discovers conventions, forgets yesterday's decisions. Instruction files
(`CLAUDE.md`, `AGENTS.md`) say "remember things", but nothing **enforces** it —
agents silently drift, compaction erases working state, and new teammates get
a blank slate.

## How it works

```
npx github:<you>/context-md install
        │
        ├── context.md created (snapshot + structure + purpose + log)
        ├── instruction block injected into AGENTS.md / CLAUDE.md / GEMINI.md /
        │   .github/copilot-instructions.md / .cursor/rules/*.mdc /
        │   .kiro/steering/*.md / .clinerules / .devin/rules / .windsurf/rules
        └── hooks wired into every agent:
             SessionStart  → refresh context.md, tell the agent to read it FIRST
             PreToolUse    → READ GATE: deny file edits until context.md was read this session
             PostToolUse   → append "- <timestamp> edited <file>" to the Change Log
             Stop gate     → BLOCK session end until context.md was updated
                             after the last file edit
```

`context.md` is split into **auto-managed sections** (snapshot, structure,
change log — maintained by hooks, wrapped in `context-md:*` markers) and
**agent-owned sections** (Purpose, Key Knowledge, Current Focus — the agent
keeps these current as it works).

```markdown
## Snapshot
<!-- context-md:snapshot:start -->
- Updated: 2026-11-18T04:33:23Z
- Git: main @ a1b2c3d · 3 uncommitted changes
- Stack: Node.js + TypeScript · Next.js · pnpm
- Files (excl. deps/build): 132 · dependencies: 47
- Scripts: dev=`next dev`, test=`node --test`
<!-- context-md:snapshot:end -->
```

## Install

### Option A — per repository (shared with your team)

From a repository root:

```bash
npx github:<your-github-user>/context-md install
```

(or clone this repo and run `node bin/context-md.js install`)

### Option B — default for your machine (every project, zero setup)

```bash
npx github:<your-github-user>/context-md install --global
```

This creates a standalone runtime at `~/.context-md/` and wires your **user-level**
agent configs (`~/.claude/settings.json`, `~/.codex/hooks.json`,
`~/.gemini/settings.json`, `~/.cursor/hooks.json`, global opencode plugin, and
global instruction files). Afterwards, **any project you open with these agents
gets `context.md` automatically** — no per-repo step. The global runtime only
activates in project-like folders (containing `.git` or a known manifest) and
**defers to a repo's local `.context/` wiring when present** (no double logging).
Set it up once; never think about it again. Remove it with
`context-md uninstall --global`.

Either way, a fresh project can never start work without `context.md`: it is
created automatically on the very first tool call (SessionStart hook, or the
read gate recreating it if hooks were skipped), and the read gate blocks any
file edit until the agent has actually read it. Existing projects get the
one-time backfill on their next session.

Both modes coexist: team repos use Option A (committable), everything else rides on Option B.

Other commands:

```bash
context-md install [dir]          wire a repo (shared with team)
context-md install --global       default for THIS machine, zero setup per project
context-md uninstall [dir]        remove repo wiring (keeps context.md)
context-md uninstall --global     remove machine-wide default wiring + runtime
context-md uninstall --remove-context [dir]   also delete context.md
context-md backfill [dir]         regenerate context.md + print the backfill protocol
context-md refresh [dir]          regenerate auto-managed sections now
context-md verify [dir]           CI check: exits 1 if context.md is stale
context-md doctor [dir]           health check: markers, hook files, agent configs
context-md status [dir]           show what is wired in this repo
```

**Commit `context.md` and `.context/`** (hooks must travel with the repo). Per-session
runtime state (`.context/session-state.json`, `.context/.last-scan`) is auto-gitignored
by the installer. Hooks back up any config they touch (`*.bak-<timestamp>`) and are
idempotent: re-running install refreshes in place, never duplicates.

## How “real-time, zero context loss” actually works

No tool can force an LLM to retain every thought — but it can make drift
structurally impossible to ignore. **context-md enforces the discipline with five layers**:

1. **SessionStart injection + per-prompt strict rule** — every session begins
   with `context.md: read this first` injected into context, and **every user
   prompt** adds the non-negotiable protocol via `UserPromptSubmit` /
   `BeforeAgent` (Claude Code, Codex, Gemini CLI): read context.md first,
   update it with every decision/change, never finish with it stale — no
   compromise.
2. **Read gate (PreToolUse)** — the agent’s file edits are hard-denied until this
   session has read the real `context.md`. A clear requires a read-ish tool
   touching the file itself, or a shell command with an actual read verb
   (`cat`, `grep`, `Get-Content`…); `echo context.md` does not clear it.
   Advisory enforcement, not a sandbox — but it stops silent "skip the file"
   edits on Claude Code / Codex / Gemini CLI / Cursor.
3. **Per-edit hooks** — every file edit the agent makes is appended to the
   Change Log synchronously (`- 2026-11-18T10:00:00Z edited src/index.ts`), and
   a per-session tracker records that files changed.
4. **Stop gate** — if the agent edited any file this session and did not then
   update `context.md`, the session-end hook **blocks the stop** and forces the
   agent to update Purpose / Key Knowledge / Current Focus (Claude Code `Stop`,
   Codex `Stop`, Gemini CLI `AfterAgent` deny→retry, Cursor `stop`
   followup + loop limit). The agent cannot finish without writing it down.
5. **Verify in CI** — `context-md verify` fails the build if files changed but
   `context.md` was not refreshed. Drift becomes impossible to merge silently.

## First-run backfill (the "pichla saara context" pass)

The first time an agent session opens a project that was never backfilled (any
repo wired before this feature, or a fresh install), the SessionStart hook
injects a **FIRST-RUN BACKFILL** protocol and sets a `backfillPending` flag in
the session tracker:

1. read README/docs/manifests and the 2–4 most important source files,
2. run `git log --oneline -50` to understand the project's arc,
3. rewrite `context.md` **Purpose** and **Key Knowledge** with real facts
   (purpose, stack decisions, conventions, gotchas — no placeholders),
4. create `.context/.backfill-done`.

While `backfillPending` is set, the **stop gate also blocks session end after
any file edit** — the agent cannot "forget" the old context. Once
`.context/.backfill-done` exists, the backfill runs never again for that project.
Manual trigger: `context-md backfill [dir]`.

The deterministic sections (snapshot, structure) are regenerated by the tool
itself; the semantic sections are maintained by the agent under hard rules
written into every instruction file in the repo.

## Agent support matrix

| Agent | Reads context.md first | Read gate (edits blocked) | Per-edit hook | Stop gate | Status |
|---|---|---|---|---|---|
| **Claude Code** | `SessionStart` hook + `CLAUDE.md` | ✅ `PreToolUse` deny | `PostToolUse` | `Stop` hook | ✅ full |
| **Codex (OpenAI)** | `SessionStart` hook (`.codex/hooks.json`) + `AGENTS.md` | ✅ `PreToolUse` deny | `PostToolUse` | `Stop` hook | ✅ full |
| **Gemini CLI** | `SessionStart` hook (`.gemini/settings.json`) + `GEMINI.md` | ✅ `BeforeTool` deny | `AfterTool` | `AfterAgent` deny | ✅ full |
| **Cursor** (1.7+) | `.cursor/hooks.json` + `.cursor/rules/context-md.mdc` | ✅ `preToolUse` deny | `postToolUse` | `stop` hook | ✅ full |
| **opencode** | `.opencode/plugins/context-md.js` + `AGENTS.md` | ❌ (plugin API has no verified block) | `tool.execute.after` | ❌ no turn-end gate | ⚠️ logs+rules only |
| **GitHub Copilot** | `.github/copilot-instructions.md` | ❌ | ❌ (no hook API) | ❌ | ⚠️ instructions only |
| **Kiro** | `.kiro/steering/context-md.md` (`inclusion: always`) | ❌ | ❌ none verified | ❌ | ⚠️ steering only |
| **Windsurf / Devin** | `.devin/rules/context-md.md`, legacy `.windsurf/rules/` | ❌ | ❌ unverified schema | ❌ | ⚠️ rules only |
| **Cline** | `.clinerules` | ❌ | ❌ SDK plugin required | ❌ | ⚠️ rules only |
| **Kilo** | `AGENTS.md` | ❌ | ❌ | ❌ | ⚠️ instructions only |

Agents without a hook API still get the hard-rules instruction block and the
`context-md verify` CI gate — enforcement is weaker there, but the protocol is
identical.

## Why not just…

| Existing approach | What context-md does differently |
|---|---|
| `CLAUDE.md` / `AGENTS.md` by hand | Enforced reads (SessionStart injection), auto-maintained snapshot, CI freshness gate |
| Cline Memory Bank | Agent-agnostic; deterministic auto-sections, not prompt-compliance only |
| [fockus/skill-memory-bank](https://github.com/fockus/skill-memory-bank) (closest competitor, 8 agents) | Zero-dependency Node (no Python/bash), one file instead of a `.memory-bank/` tree, GitHub `npx` install |
| [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro) | A runnable tool, not a template to copy |
| Repomix / Aider repo-map | Live, committed, shared artifact — not a per-request pack |
| MCP memory servers (agentmemory, ai-memory) | Plain markdown in the repo — committable, reviewable, no server, works for CI and every agent |

## Honest limitations

- **“Zero loss” now means**: nothing gets *lost on disk* (every edit logged,
  every edit forces a context.md update via the stop gate on 4 agents, CI
  blocks stale merges). It still cannot guarantee anything an agent refuses to
  write down, or sessions where **no file is ever edited** (nothing to detect).
  That bound is physics, not tooling.
- Committed `.context/` is **executable code** every clone runs when an agent
  opens the repo — review it like CI, not like docs. See [SECURITY.md](SECURITY.md).
- Gates are advisory deny rules, **not a sandbox**: they exist to stop
  "silently skip the file" drift, and they do that.
- **Strict per-prompt injection** only exists where the prompt hook can inject
  context (Claude Code / Codex `UserPromptSubmit`, Gemini `BeforeAgent`). Cursor's
  `beforeSubmitPrompt` only allows/blocks, so Cursor gets the session start + read
  gate + stop gate but no per-turn reminder.
- Post-edit logging records **that** a file changed and **when** — the
  *reasoning* still lives in the agent’s “Current Focus / Key Knowledge”
  updates, which rely on the agent following the protocol.
- Codex hooks require trust review in `/hooks` before they run (Codex security
  model). opencode plugin requires opencode ≥ 1.18.29 for V1 compat and
  current opencode for the V2 path.
- Config merges are backed up (`*.bak-<timestamp>`) and idempotent, but any
  tool that edits your agent configs deserves a glance at the diff.

## Uninstall

```bash
context-md uninstall          # remove blocks + hooks, keep context.md
context-md uninstall --remove-context
```

## Development

See [SECURITY.md](SECURITY.md) for the threat model (committed `.context/` is
executable code — review it like CI) and [PUBLISHING.md](PUBLISHING.md) for the
maintainer release flow and a live-verification playbook.

```bash
npm test          # node --test — end-to-end tests
```

Layout: `bin/context-md.js` (CLI) · `src/scan.js` (repo scan/detect) ·
`src/context-file.js` (context.md markers) · `src/install.js` (agent
adapters) · `src/templates.js` (instruction block + hook sources) ·
`.context/` (installed runtime, copied into target repos)

## License

MIT
