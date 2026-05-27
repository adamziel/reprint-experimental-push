2026-05-27 03:56:52 CEST (+0200)

Changed files:
- `scripts/playground/production-plugin-package-smoke.mjs`
- `scripts/playground/production-shaped-release-verify.mjs`
- `test/production-shaped-proof.test.js`

Result:
- Normalized the remaining packaged startup-budget and timeout-fallback failure strings so both helpers describe the signed packaged route consistently as `signed preflight`, not a mix of `signed preflight` and plain `preflight`.
- Extended the proof assertions to pin the corrected signed-preflight wording across the timeout-fallback and post-snapshot timeout branches in both the smoke helper and the checked release verifier.

Commands run:
- `git status --short --branch`
- `git log --oneline --decorate -n 12`
- `sed` / `grep` reads across packaged readiness helpers, shared readiness utilities, and `test/production-shaped-proof.test.js`
- `node --check scripts/playground/production-plugin-package-smoke.mjs`
- `node --check scripts/playground/production-shaped-release-verify.mjs`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged readiness timeout fallback classifies global WordPress versus packaged-route startup|packaged readiness helpers distinguish signed preflight timeouts after snapshot responses from snapshot timeouts' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `git commit -am "Normalize signed preflight startup failures"`
- `git push origin HEAD:lane/playground-readiness-code-20260526-1836`

Push result:
- Pushed `4016c13ce` to `origin/lane/playground-readiness-code-20260526-1836`.

Worktree status:
- Clean on `lane/playground-readiness-code-20260526-1836`.

Next supervisor nudge:
- If reliable still reports another packaged readiness mismatch after `4016c13ce`, the next readiness-owned gap should be a remaining smoke/verifier startup-context divergence or bounded timeout-context branch, not another replay of the same signed-preflight wording surface.
