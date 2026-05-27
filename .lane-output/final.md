2026-05-27 08:31:40 CEST (+0200)

Changed files:
- `test/live-playground-readiness.test.js`
- `.lane-output/final.md`

Result:
- Added a focused packaged-readiness test that pins the fail-closed rule once signed preflight already returns a normal `200` body but the body itself is broken.
- The new coverage proves packaged startup hints must not keep retrying when the preflight body shows a wrong production route profile, a missing auth session, or an expired production session.
- This keeps the lane on readiness-owned helper behavior instead of guessing at the reliable lane's newer verifier refactor.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `find supervision/lanes -maxdepth 1 -type f | sort`
- `find .lane-output -maxdepth 1 -type f | sort`
- `sed -n '1,220p' .lane-output/final.md`
- `for f in $(find .lane-output -maxdepth 1 -name 'final-loop-*.md' | sort | tail -n 4); do ...; done`
- `git log --oneline --decorate -n 8`
- `git diff -- .lane-output/final.md`
- `sed -n '1,260p' /home/claude/.codex/skills/wp-playground/SKILL.md`
- `grep -Rni "waitForPackagedProductionPluginServer\\|WordPress is not ready yet\\|signed-preflight\\|indexTerminal\\|preflight" scripts/playground test | sed -n '1,260p'`
- `git fetch origin lane/reliable-executor`
- `git show --stat --oneline origin/lane/reliable-executor`
- `git diff --stat HEAD..origin/lane/reliable-executor -- scripts/playground/production-shaped-release-verify.mjs scripts/playground/production-plugin-package-smoke.mjs scripts/playground/packaged-production-plugin-readiness.js test/live-playground-readiness.test.js test/production-shaped-proof.test.js`
- `sed -n '1,520p' scripts/playground/packaged-production-plugin-readiness.js`
- `sed -n '1,1425p' test/live-playground-readiness.test.js`
- `git show origin/lane/reliable-executor:scripts/playground/production-shaped-release-verify.mjs | sed -n '1,120p'`
- `grep` checks on helper/test usage sites
- `timeout 60s node --test test/live-playground-readiness.test.js`
- `git diff --check`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push from this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` has tracked edits in `test/live-playground-readiness.test.js` and this handoff file.

Next supervisor nudge:
- This lane now owns a concrete packaged-readiness fail-closed contract for "ready-looking but broken" signed preflight responses. After this commit lands, keep the lane parked unless reliable reintroduces a new packaged-startup divergence or starts consuming a readiness-helper branch that is still unpinned here.
