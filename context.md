# context.md — live project context

> Maintained by **context-md**. Every AI agent working in this repo MUST read this file
> BEFORE doing anything, and update it as the project changes.
> Sections between `context-md:*` markers are auto-managed by hooks — do not edit inside them.
> Everything else is yours to keep current: Purpose, Key Knowledge, Current Focus.

## Snapshot

<!-- context-md:snapshot:start -->
- Updated: 2026-11-18T10:30:22.693Z
- Git: main @ 9bb8c34 · 21 uncommitted change(s)
- Stack: Node.js
- Files (excl. deps/build): 13 · dependencies: 0
- Scripts: test=`node --test`
<!-- context-md:snapshot:end -->

## Structure

<!-- context-md:structure:start -->
.github/  (1 files)
src/  (4 files)
test/  (1 files)
AGENTS.md
CLAUDE.md
context.md
GEMINI.md
LICENSE
package.json
README.md
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

- Ship v0.1.0 to GitHub (needs the maintainer's remote).
- Wire the repo itself (done — dogfooding, `.context/` committed).
- Known gap: opencode has no verified turn-end hook, so the stop gate is instruction-only there; Windsurf/Cline stop gates untested.
- Roadmap: `context-md lint` (verify context.md content quality), Cline SDK plugin for stop gate.

## Change Log

<!-- context-md:log:start -->
- 2026-11-18T10:29:08.069Z context.md created by context-md
<!-- context-md:log:end -->
