# Changelog

## 0.1.0 — 2026-11-18

First release.

### Added
- `context-md install [dir]`: wires a repository — creates `context.md`, injects the
  context protocol into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
  `.cursor/rules/context-md.mdc`, `.kiro/steering/context-md.md`, `.clinerules`,
  `.devin/rules/context-md.md`, `.windsurf/rules/context-md.md`, and wires hooks into
  Claude Code (`.claude/settings.json`), Codex (`.codex/hooks.json`), Gemini CLI
  (`.gemini/settings.json`), Cursor (`.cursor/hooks.json`) and opencode
  (`.opencode/plugins/context-md.js`).
- **Live hooks**: `SessionStart` refreshes `context.md` and tells the agent to read it
  first; `PostToolUse` appends every file edit to a timestamped Change Log and
  tracks per-session edits in `.context/session-state.json`.
- **Stop gate**: `Stop` hook (Claude Code / Codex), `AfterAgent` deny→retry
  (Gemini CLI), `stop` hook with followup (Cursor) — blocks turn end until
  `context.md` was updated after the last edit.
- **Read gate**: pre-tool hook hard-denies file edits until `context.md` has
  been read this session (Claude Code / Codex / Gemini CLI / Cursor).
- **Strict prompt injection**: `UserPromptSubmit` / `BeforeAgent` hook injects
  the non-negotiable protocol into every prompt (Claude Code / Codex / Gemini CLI).
- **Auto-create**: a missing `context.md` is recreated on the first tool call
  and at session start — fresh projects can never skip it.
- **`context-md doctor`**: verifies context.md markers, hook files and agent
  configs; exits non-zero on any problem.
- **PUBLISHING.md**: maintainer release + live-verification playbook.
- **Security hardening** (review-driven): symlink-safe, atomic writes everywhere
  (tmp + rename); corrupt agent configs are skipped, never overwritten; unexpected
  `hooks` shapes are left untouched; `git status -z` quote-safe freshness check;
  persistent per-session stop-gate block counter (max 2 then let the turn end);
  read gate clears only on an actual read of the file (read-ish tool or shell
  read verb), never on `echo context.md`; uninstall never deletes
  `~/.opencode/plugins/context-md.js`; git-ignored `*.bak-*` patterns for every
  config the tool backs up; `--home=`/`--home <dir>` both supported with
  directory validation.
- **First-run backfill**: repos wired for the first time get a one-time deep
  backfill — the agent must read README/manifests/key sources and rewrite
  `context.md` Purpose + Key Knowledge with real facts (`.context/.backfill-done`
  marks completion; the stop gate enforces it after any edit).
- `context-md install --global`: machine-wide default — a standalone `~/.context-md`
  runtime + user-level agent hooks, so every project you open gets `context.md`
  automatically (project-like folders only; defers to locally wired repos).
- `context-md verify [dir]`: CI freshness check (fails if files changed but
  `context.md` was not refreshed).
- `context-md backfill [dir]`, `refresh`, `status`, `uninstall` (repo + `--global`),
  BOM-safe JSON merging, idempotent marked-block installs, backups before config writes.
- Machine-independent, committable local hook commands (`${CLAUDE_PROJECT_DIR}`,
  `$GEMINI_PROJECT_DIR`, `$(git rev-parse --show-toplevel)`, `./.context/...`).
- 23 end-to-end tests (`node --test`), GitHub Actions CI on Node 18/20/22.
- Explicit limitation notes: opencode has no verified turn-end hook; Windsurf/Cline
  stop gates untested; hooks are best-effort and never block file edits.
