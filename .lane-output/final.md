2026-05-27 07:45:04 CEST (+0200)

Changed files:
- [test/push-remote-rest-plugin.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/test/push-remote-rest-plugin.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/.lane-output/final.md)

This pass closed the remaining checked-summary omission gap for accepted `writerLease` booleans on the producer-side merge path. The JS/PHP harness now proves both recovery-inspect evidence and checked DB-journal attachment fail closed when authoritative checked summaries drop accepted top-level or nested `leaseFence.writerLease` fields `claimKeyUnique`, `fsyncEvidence`, `monotonicSequence`, `restartReadable`, or `staleClaimRejected`.

Commands run:
```bash
git status --short --branch
node --check test/push-remote-rest-plugin.test.js
timeout 120s node --test --test-name-pattern='checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease claim-key uniqueness|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease fsync evidence|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease monotonic sequencing|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease restart readability|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease stale-claim rejection flag|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease claim-key uniqueness|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease fsync evidence|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease monotonic sequencing|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease restart readability|checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease stale-claim rejection flag|checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease claim-key uniqueness|checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease fsync evidence|checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease monotonic sequencing|checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease restart readability|checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease stale-claim rejection flag|checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease claim-key uniqueness|checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease fsync evidence|checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease monotonic sequencing|checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease restart readability|checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease stale-claim rejection flag' test/push-remote-rest-plugin.test.js
git diff --check -- test/push-remote-rest-plugin.test.js
git add test/push-remote-rest-plugin.test.js
git commit -m "Cover checked writer-lease omission drift"
git push origin HEAD:lane/durable-journal-code-20260526-1859
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
git rev-parse --short=9 HEAD
git status --short --branch
```

Push result:
- `570199052` (`Cover checked writer-lease omission drift`) pushed to `origin/lane/durable-journal-code-20260526-1859`.

Worktree status:
- Clean on `lane/durable-journal-code-20260526-1859`.

Next supervisor nudge:
- Have `main:reliable-exec` consume `570199052` with the recent checked-journal omission fences. The producer-side checked contract now explicitly rejects authoritative checked summaries that preserve acceptance while dropping any accepted top-level or nested writer-lease uniqueness, fsync, monotonic-sequence, restart-readability, or stale-claim-rejection evidence on the release-path recovery journal surface.
