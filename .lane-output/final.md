2026-05-27 08:37:49 CEST (+0200)

Changed files:
- `test/production-shaped-proof.test.js`

Result:
- Added release-verifier and packaged-smoke runtime regression coverage for a packaged signed-preflight body that still looks healthy through `auth.session` but has a broken top-level `session` envelope after snapshot readiness succeeds.
- Confirmed both runtime helpers fail closed on that shape and classify it as an invalid readiness body instead of letting packaged startup continue past a broken preflight envelope.
- This extends the earlier helper-level fail-closed fix into the actual runtime helper surfaces that reliable consumes.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `ls supervision/lanes`
- `find .lane-output -maxdepth 1 -type f | sort | tail -n 8 | xargs -r -I{} sh -c 'echo "--- {}"; sed -n "1,220p" "{}"'`
- `git log --oneline --decorate -n 12`
- `git log --oneline origin/lane/playground-readiness-code-20260526-1836 -n 8`
- `sed -n '1,260p' scripts/playground/packaged-production-plugin-readiness.js`
- `sed -n '1,320p' scripts/playground/production-shaped-release-verify.mjs`
- `sed -n '1,260p' test/production-shaped-proof.test.js`
- `sed -n '1320,1575p' test/live-playground-readiness.test.js`
- `sed -n '4888,5075p' test/production-shaped-proof.test.js`
- `sed -n '6148,6338p' test/production-shaped-proof.test.js`
- `timeout 60s node --test test/production-shaped-proof.test.js`
- `timeout 60s node --test --test-name-pattern='broken top-level session envelope' test/production-shaped-proof.test.js`
- `git diff --check`
- `git diff --stat`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push from this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` has tracked edits in `test/production-shaped-proof.test.js` and this handoff file.

Next supervisor nudge:
- This lane’s next useful move is to commit and push this runtime regression coverage, then stay parked unless reliable reopens another packaged preflight/runtime readiness divergence.
