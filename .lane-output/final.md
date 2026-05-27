2026-05-27 03:37:52 CEST (+0200)

Changed files:
- `scripts/playground/production-plugin-package-smoke.mjs`
- `scripts/playground/production-shaped-release-verify.mjs`
- `test/production-shaped-proof.test.js`

Result:
- Fixed the remaining malformed snapshot/preflight startup-classification branches where both packaged callers still fetched `/wp-json/` directly and could let index-probe timeouts escape raw instead of converting them into bounded fallback probes.
- The smoke path and the checked release verifier now wrap those two remaining `/wp-json/` startup-classification fetches with `buildPackagedTimeoutFallbackProbe('/wp-json/', indexError)`, so malformed readiness-body branches keep the same bounded timeout classification as the other packaged startup fallbacks.
- Extended the focused proof coverage so both packaged callers assert the guarded timeout-fallback fetch inside the malformed snapshot/preflight classification paths.

Commands run:
- `git status --short --branch`
- `git log --oneline --decorate -n 12`
- `grep` reads across packaged readiness helpers, packaged callers, and `test/production-shaped-proof.test.js`
- `node --check scripts/playground/production-plugin-package-smoke.mjs`
- `node --check scripts/playground/production-shaped-release-verify.mjs`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged smoke readiness helper formats malformed snapshot and preflight bodies as bounded readiness failures|packaged snapshot readiness helper enforces the bounded classifier before retryable preflight loops continue|packaged readiness helpers preserve bounded index timeout probes during snapshot startup fallback' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `git diff --stat -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push for this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` is dirty in the three tracked readiness files above plus this handoff file.

Next supervisor nudge:
- If reliable still hits packaged readiness after `4ba2ebdd`, consume this follow-up so malformed snapshot/preflight startup-classification branches also treat `/wp-json/` probe timeouts as bounded readiness evidence instead of uncaught fetch errors.
- The next readiness-owned gap should be a different packaged startup branch than raw `/wp-json/` timeout escape in startup classification; likely a branch that still misclassifies terminal startup context rather than timing out unboundedly.
