2026-05-27 06:50:20 CEST (+0200)

Changed files:
- `.lane-output/final.md`
- `scripts/playground/production-plugin-package-smoke.mjs`
- `scripts/playground/production-shaped-release-verify.mjs`
- `test/production-shaped-proof.test.js`

Result:
- Patched a remaining packaged-readiness context mismatch in the lane-owned timeout-fallback path.
- Both packaged callers now preserve `timeoutFallback: true` when signed preflight times out after snapshot readiness has already responded and `/wp-json/` then turns terminal. Before this patch, that branch carried `invalidReadinessBody` and `snapshotNotReadyProbeCount` but silently dropped the timeout-fallback marker that the parallel snapshot-timeout branch already emitted.
- Tightened proof coverage so both helper sources must keep `timeoutFallback: true` on that exact runtime branch.
- Re-checked current remote heads before editing; reliable is now `e9c9e36980b738f584eadf113ff5599ce885cd39`, so the earlier parked handoff was stale and this readiness fix is the current lane-owned delta.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `find .lane-output -maxdepth 1 -type f \\( -name 'final*.md' -o -name 'final.md' \\) | sort | tail -n 5 | xargs -r -I{} sh -c 'echo "--- {} ---"; sed -n "1,220p" "{}"'`
- `git fetch origin --quiet && git ls-remote origin refs/heads/lane/reliable-executor refs/heads/lane/playground-readiness-code-20260526-1836`
- targeted `grep`, `sed -n`, and a small Python read over `scripts/playground/packaged-production-plugin-readiness.js`, `scripts/playground/production-plugin-package-smoke.mjs`, `scripts/playground/production-shaped-release-verify.mjs`, and `test/production-shaped-proof.test.js`
- `node --check scripts/playground/production-shaped-release-verify.mjs`
- `node --check scripts/playground/production-plugin-package-smoke.mjs`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged readiness helpers distinguish signed preflight timeouts after snapshot responses from snapshot timeouts|packaged release verifier readiness helper fails closed when signed preflight returns an invalid readiness body while snapshot startup is still in progress|packaged readiness timeout fallback classifies global WordPress versus packaged-route startup' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-shaped-release-verify.mjs scripts/playground/production-plugin-package-smoke.mjs test/production-shaped-proof.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending in this handoff; code is verified locally and ready to commit/push on this lane branch.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` is dirty in the three lane-owned code/test files above plus `.lane-output/final.md`.

Next supervisor nudge:
- After this lane pushes, keep it parked unless reliable exposes another packaged startup/preflight mismatch.
- If a new readiness regression appears, target the exact packaged branch that still drops bounded route/status/body fallback context, not another wording-only verifier update.
