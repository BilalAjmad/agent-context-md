# context.md — live project context

> Maintained by **context-md**. Every AI agent working in this repo MUST read this file
> BEFORE doing anything, and update it as the project changes.
> Sections between `context-md:*` markers are auto-managed by hooks — do not edit inside them.
> Everything else is yours to keep current: Purpose, Key Knowledge, Current Focus.

## Snapshot

<!-- context-md:snapshot:start -->
- Updated: 2026-11-18T15:21:10.710Z
- Git: main @ 5dafdf5 · 7 uncommitted change(s)
- Stack: Node.js
- Files (excl. deps/build): 21 · dependencies: 0
- Scripts: test=`node --test`
<!-- context-md:snapshot:end -->

## Structure

<!-- context-md:structure:start -->
.github/  (2 files)
bin/  (1 files)
src/  (6 files)
test/  (1 files)
AGENTS.md
CHANGELOG.md
CLAUDE.md
context.md
CONTRIBUTING.md
GEMINI.md
LICENSE
package.json
PUBLISHING.md
README.md
SECURITY.md
<!-- context-md:structure:end -->

## Purpose

Zero-dependency Node CLI (`context-md`) that wires **any repository** to live `context.md` maintenance. Every AI agent that opens the repo reads one shared context file before working; hooks keep a real-time change log after every edit, and a stop gate blocks session end until `context.md` was updated. Distributed via GitHub (`npx github:<user>/context-md install`), MIT, Node >= 18.

## Key Knowledge

- Two runtime layouts, ONE codebase: repo-local `<repo>/.context/` (committed, team-shared) and machine-wide `~/.context-md/` (global default, activates only in project-like folders, defers to local wiring to avoid double logging). Hooks detect layout via `path.basename(path.resolve(__dirname, '..'))` (`.context` vs `.context-md`).
- Hook templates in `src/templates.js` are ONE template string per hook — raw backticks or `${}` inside them break compilation. Paths in hook commands are always forward-slash; local installs emit machine-independent, committable commands (`${CLAUDE_PROJECT_DIR}`, `$GEMINI_PROJECT_DIR`, `$(git rev-parse --show-toplevel)`, `./.context/...`); global installs keep absolute paths.
- JSON merge must strip UTF-8 BOM (`readJson`) — Windows tools write BOM-prefixed configs or the user's existing settings silently vanish (backed up as `*.bak-<ts>` regardless).
- Install is idempotent: instruction files use `<!-- context-md:start/end -->` markers; hook groups are deduplicated by keeping the last entry containing `.context/hooks/` or `.context-md/hooks/` (HOOK_TAGS in src/install.js).
- Agents with turn-end hooks get a hard stop gate (Claude `Stop`, Codex `Stop`, Gemini `AfterAgent` deny→retry, Cursor `stop` followup + loop_limit 2). Editing any non-context file sets `pendingEdit: true` in `.context/session-state.json`; only a later context.md edit clears it. `backfillPending` forces a one-time deep backfill per project.
- `context.md` is split into auto-managed marked sections (`context-md:snapshot|structure|log:start/end`) maintained by hooks and agent-owned sections (Purpose / Key Knowledge / Current Focus). Never hand-edit the marked sections.
- Tests are end-to-end `node:test` against temp git repos; the global-mode tests use `--home` to simulate a user machine (`install --global --home <tmp>`).
- Not published to npm yet; installation is `npx github:…` or local `node bin/context-md.js install`.

## Current Focus / Next Steps

- Feature-complete for v0.1.0 (27/27 tests, interactive agent picker, `--clients`,
  `--all`, no API keys, `context-md doctor`, SECURITY.md, PUBLISHING.md, CI workflow).
- Machine scan (read-only): 131 top-level git repos; 5 wired with context.md.
- Global default still available but NOT activated on this machine (maintainer's call):
  `context-md install --global` (interactive picker supported).
- Waiting on maintainer: GitHub remote + push, optional `npm publish`.

## Change Log

<!-- context-md:log:start -->
- 2026-11-18T10:29:08.069Z context.md created by context-md
<!-- context-md:log:end -->
