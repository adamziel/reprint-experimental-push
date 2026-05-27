# no-data-loss-invariants handoff

Timestamp:
- `2026-05-27 11:53:04 CEST (+0200)`

Current lane evidence:
- Closed one more stale same-plan term expectation in [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js) without changing planner code.
- Test `484` now matches the planner's current split output: the local term-relationship row is blocked as `stale-wordpress-graph-identity`, while the same-plan taxonomy row remains the `unsupported-term-taxonomy-resource`.
- The focused `484` case now passes, and the full planner frontier moves forward to `493`, then `588`-`590`, `619`-`622`, `625`-`631`, `686`-`687`, and later live-boundary cases.
- Those remaining failures are still same-plan graph / nav / attachment / live-boundary clusters, not a new invariants-owned planner drift.

Changed files:
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md)

Commands:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `ls supervision/lanes && for f in supervision/lanes/*invariants*; do ...; done`
- `ls -1t .lane-output/final*.md ...`
- `timeout 90s sh -lc 'node --test test/push-planner.test.js > /tmp/ndl-frontier.log 2>&1'`
- `grep -n '^not ok ' /tmp/ndl-frontier.log | head -n 30`
- `nl -ba test/push-planner.test.js | sed -n '18480,18780p;18880,19180p;19620,19820p'`
- `git log --oneline --decorate -n 8 -- test/push-planner.test.js src/planner.js`
- `timeout 60s node --test --test-name-pattern='blocks local term-relationship references to a same-plan created term-taxonomy identity while preserving a matching independent delete and remote-only plugin changes' test/push-planner.test.js`
- `nl -ba test/push-planner.test.js | sed -n '25260,25560p'`
- `node --check test/push-planner.test.js`
- `git diff --check -- test/push-planner.test.js`
- `timeout 90s sh -lc 'node --test test/push-planner.test.js > /tmp/ndl-frontier-after.log 2>&1'`
- `grep -n '^not ok ' /tmp/ndl-frontier-after.log | head -n 20`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Pending in this pass.

Verification:
- Focused `484` term-relationship / same-plan taxonomy case passed `1/1`.
- `node --check test/push-planner.test.js` passed.
- `git diff --check -- test/push-planner.test.js` passed.
- Full `test/push-planner.test.js` frontier advanced past `484`; the earliest remaining failure is now `493`.

Worktree status:
- Dirty tracked files: [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js) and [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md).
- Branch: `lane/cycle-20260525-mainwindows-2349/ndl-invariants-clean-20260526-1530`
- `HEAD`: `2fd962976bf457f4eef53eefc2d451c320fbe6ff`

Next supervisor nudge:
- Treat the next push as expectation-parity cleanup only, not gate movement.
- The remaining frontier now starts at `493` and then the same graph/nav/attachment/live-boundary clusters, so `same-plan-graph` remains the next useful owner unless a new invariants-only mismatch appears behind those failures.
