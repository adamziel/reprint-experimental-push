# no-data-loss-invariants handoff

Timestamp:
- `2026-05-27 11:50:15 CEST (+0200)`

Current lane evidence:
- Closed one more stale revision/term parity slice in [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js) without changing planner code.
- The deterministic revision term-relationship case now matches the planner's current `unsupported-revision-resource` blocker shape.
- The two missing-taxonomy term-relationship cases now match the planner's current split output: a graph-identity blocker on the local relationship row and a separate unsupported term-taxonomy blocker for the missing remote taxonomy, with no stale `decision` entry assumed for the target row.
- The same-plan parent-term type-swap case now expects the current `unsupported-term-taxonomy-resource` blocker on the taxonomy row instead of the older target-term blocker class.
- The bounded full planner suite improved again from `1142` pass / `85` fail to `1146` pass / `81` fail.
- The earliest remaining failures now begin at tests `484`, `493`, `588`-`590`, `619`-`622`, `625`-`631`, and `686`-`687`, which are still same-plan graph / live-boundary clusters rather than fresh invariants-only parity drift.

Changed files:
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md)

Commands:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `find supervision/lanes -maxdepth 1 -type f -name '*invariants*' -print -exec sed -n '1,240p' {} \;`
- `sed -n '1,260p' .lane-output/final.md`
- `for f in $(ls -1 .lane-output/final-loop-*.md | tail -n 4); do ...; done`
- `git log --oneline --decorate -n 12 -- src/planner.js test/push-planner.test.js`
- `timeout 90s sh -lc 'node --test test/push-planner.test.js > /tmp/ndl-current.log 2>&1'`
- `grep -n '^not ok ' /tmp/ndl-current.log | head -n 40`
- `awk 'NR>=2367 && NR<=2565 {print}' /tmp/ndl-current.log`
- `sed -n '18780,19580p' test/push-planner.test.js`
- `nl -ba test/push-planner.test.js | sed -n '18272,18378p;18946,19145p;19683,19755p'`
- `timeout 60s node --test --test-name-pattern='orders same-plan revision term-relationship references deterministically within the same priority bucket|blocks local term-relationship references when the live remote taxonomy identity disappears|blocks local term-relationship references when the live remote taxonomy identity disappears while preserving remote-only plugin drift|blocks local term-taxonomy parent references to a same-plan created term identity while preserving a matching independent file type swap and remote-only plugin changes' test/push-planner.test.js`
- `node --input-type=module <<'JS' ... createPushPlan(...) ... JS`
- `node --check test/push-planner.test.js`
- `git diff --check -- test/push-planner.test.js`
- `timeout 90s sh -lc 'node --test test/push-planner.test.js > /tmp/ndl-current-after.log 2>&1'`
- `grep -n '^not ok ' /tmp/ndl-current-after.log | head -n 40`
- `git diff --stat -- test/push-planner.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending in this pass.

Verification:
- Focused revision/term slice passed `4/4`.
- `node --check test/push-planner.test.js` passed.
- `git diff --check -- test/push-planner.test.js` passed.
- Full `test/push-planner.test.js` improved to `1146` pass / `81` fail.

Worktree status:
- Dirty tracked files: [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js) and [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md).
- Branch: `lane/cycle-20260525-mainwindows-2349/ndl-invariants-clean-20260526-1530`
- `HEAD`: `431f4fcd7f066f46e247f9ced219d122acbdee34`

Next supervisor nudge:
- Treat the next push as expectation-parity cleanup only, not gate movement.
- The remaining frontier now starts at test `484` and then the nav/attachment/live-boundary graph clusters, so `same-plan-graph` remains the next useful owner unless a new invariants-only mismatch appears behind those graph failures.
