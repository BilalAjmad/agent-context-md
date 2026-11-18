# Publishing (maintainer)

## 1. Pre-flight

```bash
npm test                  # 23/23 must pass
npm pack --dry-run        # 8 files, ~22 kB — no dev junk
git status                # clean tree
```

CI (.github/workflows/test.yml) runs the same tests on Node 18/20/22 on every push.

## 2. Push to GitHub

```bash
git remote add origin https://github.com/<YOUR_USER>/context-md.git
git push -u origin main
```

## 3a. GitHub-only release (no npm account needed)

Users install with:

```bash
npx github:<YOUR_USER>/context-md install
npx github:<YOUR_USER>/context-md install --global   # machine-wide default
```

## 3b. npm publish (optional, cleanest `npx context-md` UX)

```bash
npm login
npm publish               # MIT, public, files: bin + src
npx context-md install    # anywhere, works after publish
```

## 4. Verify live (once agents have credits)

```bash
mkdir /tmp/ctx-live-test && cd /tmp/ctx-live-test && git init -b main
echo '{"name":"ctx-live-test"}' > package.json && git add -A && git commit -m init
npx github:<YOUR_USER>/context-md install .
claude -p "Create hello.txt containing 'hello'" --permission-mode acceptEdits
cat context.md                # template + fresh doctor pass
npx github:<YOUR_USER>/context-md doctor
```

Expected: the first `Edit` is denied by the read gate; the agent reads
`context.md`; the edit lands; the stop gate forces a `context.md` update;
`context-md doctor` reports all green.

## 5. Post-publish checklist

- [ ] Tag `v0.1.0` and push the tag; create a GitHub Release from CHANGELOG.md.
- [ ] README badges (optional): CI status.
- [ ] Monitor issues for hook-format drift in agent updates (Cursor `1.x` hook
      APIs and Gemini `BeforeAgent` are the fastest-moving surfaces).

## Troubleshooting

- **Codex hooks don't fire** → Codex requires trust review: open `/hooks`, review
  and trust the context-md entries, or restart Codex.
- **"API 402 / insufficient credits"** when live-testing → that is the model
  account's credits, not the tool; hooks can only be verified at their
  stdin/stdout contract level without a working model account.
- **Windows BOM** — all config edits backed up as `*.bak-<timestamp>`; restore
  those if anything looks wrong, then re-run `context-md install .` (idempotent).
