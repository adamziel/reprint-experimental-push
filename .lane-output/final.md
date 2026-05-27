2026-05-27 03:35:13 CEST (+0200)

Changed files:
- `scripts/playground/production-plugin-package-smoke.mjs`
- `scripts/playground/production-shaped-release-verify.mjs`
- `test/production-shaped-proof.test.js`

Result:
- Fixed the remaining packaged snapshot-startup fallback branch where both packaged callers fetched `/wp-json/` directly and let index-probe timeouts escape raw instead of converting them into bounded fallback probes.
- The smoke path and the checked release verifier now both wrap those snapshot-fallback `/wp-json/` fetches with `buildPackagedTimeoutFallbackProbe('/wp-json/', indexError)`, so the branch keeps the same bounded timeout classification used by the parsed preflight path.
- Added a focused proof test that asserts both packaged callers preserve bounded index-timeout probes during snapshot-startup fallback.

Commands run:
- `git status --short --branch`
- `sed -n '1,240p' .lane-output/final.md`
- `grep` reads across packaged readiness helpers, packaged callers, and `test/production-shaped-proof.test.js`
- `node --check scripts/playground/production-plugin-package-smoke.mjs`
- `node --check scripts/playground/production-shaped-release-verify.mjs`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged readiness helpers preserve bounded index timeout probes during snapshot startup fallback|packaged readiness helpers recompute parsed signed preflight retryability with the current index probe|packaged snapshot probe context preserves timed-out fallback probes' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `git diff --stat -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push for this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` is dirty in the three tracked readiness files above plus this handoff file.

Next supervisor nudge:
- If reliable still hits packaged readiness after consuming `9df91b7d2`, consume this follow-up so snapshot-startup fallback treats `/wp-json/` probe timeouts as bounded readiness evidence instead of uncaught fetch errors.
- The next readiness-owned gap should be a different packaged startup branch than dropped timeout context or raw `/wp-json/` timeout escape during snapshot-startup fallback.
