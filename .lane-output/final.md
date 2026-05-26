# Fast Paths Handoff

Timestamp: 2026-05-26 21:47:25 CEST (+0200)

Changed files:
- [test/guarded-executor-benchmark.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/fast-paths-clean-20260526-1530/test/guarded-executor-benchmark.test.js)

Result:
- Added focused rejected-fast-path coverage for one mixed recovery shortcut and four plugin-update shortcuts already modeled in `scripts/bench/performance-model.js`.
- Covered these unsafe shortcuts:
  `compressed-remote-index-and-parallel-chunk-and-row-fanout-skips-large-upload-and-plugin-update-recovery-after-pause`
  `compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause`
  `compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit`
  `compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause`
  `compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause`
- The new assertions pin the fail-closed boundary that compressed planning evidence, wider fan-out, and cached row receipts cannot substitute for paused receipt survival, live compares, plugin preconditions, or atomic-group commit barriers.

Commands:
- `grep -n "compressed-remote-index-and-parallel-chunk-and-row-fanout-skips-large-upload-and-plugin-update-recovery-after-pause\|plugin-update" scripts/bench/performance-model.js test/guarded-executor-benchmark.test.js scripts/bench/guarded-executor-benchmark.js | sed -n '1,260p'`
- `sed -n '2888,2916p' scripts/bench/performance-model.js`
- `sed -n '3124,3160p' scripts/bench/performance-model.js`
- `timeout 30s node --test --test-name-pattern='mixed large-upload and plugin-update recovery shortcuts as rejected|parallel row-batch pause shortcuts as rejected|parallel row-batch commit shortcuts as rejected|cached row-batch receipt commit shortcuts as rejected|cached row-receipt row-batching shortcuts as rejected' test/guarded-executor-benchmark.test.js`
- `git diff --check -- test/guarded-executor-benchmark.test.js`
- `git add test/guarded-executor-benchmark.test.js && git commit -m "Cover rejected mixed recovery shortcuts"`
- `git push origin HEAD:lane/fast-paths`

Push result:
- Pushed successfully to `origin/lane/fast-paths`
- Commit: `7ce18014` (`Cover rejected mixed recovery shortcuts`)

Worktree status:
- Clean tracked worktree on `lane/fast-paths` after push

Next supervisor nudge:
- Keep fast-path work on benchmark/model gaps that could accidentally bless planning-only plugin-update shortcuts as production-safe. The next bounded edge is an unpinned rejected shortcut around cached dependency-graph/plugin-update finalize or activation bypasses, or another mixed backpressure shortcut already present in `scripts/bench/performance-model.js`.
