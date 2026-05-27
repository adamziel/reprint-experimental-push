Timestamp: `2026-05-27 03:42:07 CEST (+0200)`

Changed files:
- `scripts/bench/guarded-executor-benchmark.js`
- `test/guarded-executor-benchmark.test.js`
- `.lane-output/final.md`

What changed:
- Tightened the rejected fast-path spec for `compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure` so it now carries the direct aligned queue-slack blockers instead of collapsing to the weaker footprint-only pause fallback when the missing evidence is the aligned receipt-cursor queue-slack proof.
- Added the missing direct blockers to that spec:
  `queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack`,
  `queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof`,
  `queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof`,
  and `staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof`.
- Added a focused regression proving the rejected release-bundle backpressure summary now stays fail-closed on those direct aligned queue-slack blockers without fabricating the separate aligned backpressure-proof failure when only queue-slack alignment is hidden.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,240p' supervision/README.md`
- `sed -n '1,240p' supervision/lanes/fast-paths.md`
- `find .lane-output -maxdepth 1 -type f | sort | tail -n 10`
- `sed -n '1,240p' .lane-output/final.md`
- `git log --oneline --decorate -n 12`
- `git diff --stat`
- targeted `grep -n` / `sed -n` inspection on `scripts/bench/guarded-executor-benchmark.js`, `test/guarded-executor-benchmark.test.js`, and `docs/fast-paths.md`
- targeted `node --input-type=module` probes against `runGuardedExecutorBenchmark(...)`, `productionThroughputDetails(...)`, and `productionThroughputBlockers(...)`
- `node --check scripts/bench/guarded-executor-benchmark.js`
- `node --check test/guarded-executor-benchmark.test.js`
- `timeout 60s node --test --test-name-pattern='guarded benchmark carries direct aligned queue-slack proof blockers into rejected release-bundle backpressure summaries' test/guarded-executor-benchmark.test.js`
- `timeout 60s node --test --test-name-pattern='guarded benchmark carries direct aligned queue-slack proof blockers into rejected (replay|release-bundle backpressure) summaries' test/guarded-executor-benchmark.test.js`
- `git diff --check`
- `git rev-parse HEAD`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:
- Not pushed yet in this pass.

Worktree status:
- `git status --short --branch` shows `.lane-output/final.md`, `scripts/bench/guarded-executor-benchmark.js`, and `test/guarded-executor-benchmark.test.js` dirty before commit.

Next supervisor nudge:
- Keep `main:fast-paths` on any remaining rejected retry or replay shortcut whose guarded summary still drops a stricter direct aligned pause blocker and falls back to weaker footprint-only or advisory headroom wording when the missing evidence is a measured-and-aligned receipt-cursor proof bit.
