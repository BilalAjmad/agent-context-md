# Contributing

## Dev setup

```bash
git clone <this repo>
cd agent-context-md
npm test          # node --test — no install step needed, zero dependencies
```

## Design constraints (keep these)

- **Zero runtime dependencies.** Plain Node ESM, Node >= 18. No build step.
- **Hooks are best-effort.** Hook failures must never break an agent session —
  swallow errors, print only valid JSON (strict hooks like Gemini parse stdout).
- **Idempotency via markers.** Instruction files use `<!-- context-md:start/end -->`.
  Hook groups are identified by the runtime path tags (`.context/hooks/`,
  `.context-md/hooks/`) — deduplicated to the newest on reinstall.
- **Machine-independent commands.** Repo-local wiring must produce committable
  hook commands (env-root expansions), never absolute paths. Global wiring
  (`install --global`) uses absolute paths by design.
- **JSON configs** may carry a UTF-8 BOM — always strip it when parsing.
- **Tests are end-to-end** against temp git repos, including global mode via
  `--home <tmp>`. Add tests for new behavior.
- `context.md` in this repo is dogfooded: keep it accurate (it is the spec of
  record for contributors and their agents).
