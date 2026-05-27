2026-05-27 08:34:06 CEST (+0200)

Changed files:
- `scripts/playground/packaged-production-plugin-readiness.js`
- `test/live-playground-readiness.test.js`
- `.lane-output/final.md`

Result:
- Fixed a packaged-readiness fail-open: signed preflight is no longer considered ready unless the top-level `session` envelope includes a non-empty `session.id` and `session.type === "production-auth-session"`.
- Added focused coverage proving missing top-level session data, missing `session.id`, or the wrong top-level `session.type` all stay terminal instead of being treated as ready or retryable.
- This keeps packaged startup fail-closed when the signed preflight body looks superficially healthy through `auth.session` but is still broken at the session envelope the verifier needs.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,240p' /home/claude/.codex/skills/wp-playground/SKILL.md`
- `git fetch origin lane/reliable-executor`
- `git ls-remote --heads origin refs/heads/lane/reliable-executor refs/heads/lane/playground-readiness-code-20260526-1836`
- `git show --stat --oneline origin/lane/reliable-executor`
- `grep -RniE "waitForPackagedProductionPluginServer|WordPress is not ready yet|signedPreflight|signed-preflight|preflight|routeProfile|authSession" scripts/playground test/live-playground-readiness.test.js test/production-shaped-proof.test.js | sed -n '1,260p'`
- `sed -n '1,260p' scripts/playground/packaged-production-plugin-readiness.js`
- `sed -n '1,260p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '1260,1455p' test/live-playground-readiness.test.js`
- `git diff --stat HEAD..origin/lane/reliable-executor -- scripts/playground/production-shaped-release-verify.mjs scripts/playground/packaged-production-plugin-readiness.js test/live-playground-readiness.test.js test/production-shaped-proof.test.js`
- `node --input-type=module ...` to probe `packagedProductionPluginPreflightReady()` and confirm missing/broken top-level session envelopes were incorrectly accepted as ready before the patch
- `node --input-type=module ...` to probe `packagedProductionPluginPreflightRetryable()` / `packagedProductionPluginPreflightTerminal()` for the broken top-level session case
- `timeout 60s node --test test/live-playground-readiness.test.js`
- `git diff --check`
- `git diff -- scripts/playground/packaged-production-plugin-readiness.js test/live-playground-readiness.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push from this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` has tracked edits in `scripts/playground/packaged-production-plugin-readiness.js`, `test/live-playground-readiness.test.js`, and this handoff file.

Next supervisor nudge:
- This lane now owns the top-level signed-preflight session envelope contract as part of packaged readiness. After this commit lands, keep the lane parked unless reliable reintroduces another packaged-startup divergence between `production-shaped-release-verify.mjs` and these readiness helpers.
