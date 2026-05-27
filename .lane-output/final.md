2026-05-27 07:21:15 CEST (+0200)

Changed files:
- `scripts/playground/production-plugin-package-smoke.mjs`
- `scripts/playground/production-shaped-release-verify.mjs`
- `test/production-shaped-proof.test.js`
- `.lane-output/final.md`

Result:
- Fixed the remaining packaged-readiness parity gap when signed preflight turns terminal before snapshot readiness settles, but `/wp-json/` already shows the packaged route is still starting.
- In both packaged callers, the terminal signed-preflight path now probes `/wp-json/` immediately and reclassifies snapshot startup against the current global index instead of waiting for the older route-startup threshold.
- Added focused proof coverage for this exact terminal-preflight packaged-route-startup branch in both the verifier helper and the package smoke helper.

Commands run:
- `find supervision/lanes -maxdepth 1 -type f | sort`
- `sed -n '1,240p' .lane-output/final.md`
- `git diff -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `git log --oneline --decorate -n 8`
- `node --check scripts/playground/production-plugin-package-smoke.mjs`
- `node --check scripts/playground/production-shaped-release-verify.mjs`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged release verifier readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress|packaged production plugin smoke readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress' test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged release verifier readiness helper waits through packaged-route startup after global WordPress readiness|packaged release verifier readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress|packaged production plugin smoke readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress' test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='packaged readiness helpers keep packaged-route startup on the tighter post-global-startup budget|packaged snapshot startup fallback keeps the packaged-route post-global-ready budget after signed preflight turns terminal|packaged release verifier readiness helper waits through packaged-route startup after global WordPress readiness|packaged production plugin smoke readiness helper waits through packaged-route startup after global WordPress readiness|packaged release verifier readiness helper fails closed when packaged-route startup exceeds the post-global-ready budget|packaged production plugin smoke readiness helper fails closed when packaged-route startup exceeds the post-global-ready budget|packaged release verifier readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress|packaged production plugin smoke readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-shaped-proof.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending commit/push from this pass.

Worktree status:
- Branch `lane/playground-readiness-code-20260526-1836` has tracked edits in the two packaged readiness helpers, the proof test, and this handoff file.

Next supervisor nudge:
- Keep this lane on verifier-vs-smoke packaged readiness drift only.
- The next useful follow-up here is another packaged readiness parity mismatch under signed-preflight or `/wp-json/` fallback handling, not auth/journal/replay surface work from reliable.
