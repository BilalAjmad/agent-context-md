---
inclusion: always
---

<!-- context-md:start -->
## context.md — live project context (context-md)

This repo is wired to **context-md**. Rules for EVERY AI agent, no exceptions:

1. **BEFORE doing anything**, read `context.md` at the repo root. It holds the live
   project snapshot, structure, agreed purpose, key knowledge, current focus and a
   timestamped change log.
2. **AFTER any meaningful decision or change**, update `context.md` in place:
   - *Purpose* — what this project is, once you know it.
   - *Key Knowledge* — stack/architecture decisions, conventions, gotchas.
   - *Current Focus / Next Steps* — what is being worked on right now.
3. Never delete the `context-md:*` markers or the auto-managed sections. Edit only
   the agent-owned sections by hand; hooks maintain the rest.
4. If `context.md` is missing, run `node .context/hooks/session-start.js` or
   `npx context-md refresh` to regenerate it, then read it.
5. **Strict gates (agent-dependent):** on Claude Code / Codex / Gemini CLI /
   Cursor, hooks BLOCK edits until context.md is read, and BLOCK turn end
   until context.md is updated. On opencode and agents without turn-end
   hooks, the rule is the same but enforced by you: read first, update always.
6. `context.md` is meant to be committed — it is the shared brain of the team.

Hooks installed by context-md keep a change log on every file edit and refresh the
snapshot at session start. The file can drift between sessions — re-read it; do not
trust your memory over it.
<!-- context-md:end -->
