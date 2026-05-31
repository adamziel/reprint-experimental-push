# RPP-0652 blocked recovery classification, variant 3

Date: 2026-05-31
Issue: RPP-0652
Lane: recovery

## Proof added

- Added generated local coverage in
  `test/rpp-0652-blocked-recovery-classification-v3.test.js`.
- The regression writes a claim-fenced JSONL recovery journal from a child
  process, injects a failure after two committed mutations, exits the writer
  process, and reopens the same journal path from the parent process.
- Restart readback proves durable rows are present: target rows, staged and
  dependency rows, the committing boundary, two `mutation-observed` rows, and a
  `blocked-recovery` recovery-state row all retain monotonic sequences and
  fsync evidence.
- Restart inspection classifies the partial remote as `blocked-recovery` with
  `{ old: 2, new: 2, blockedUnknown: 0 }` and reason code
  `BLOCKED_PARTIAL_REMOTE`.
- A deterministic drifted-current readback also classifies as
  `blocked-recovery` with `{ old: 1, new: 2, blockedUnknown: 1 }` and reason
  code `BLOCKED_TARGET_UNKNOWN`, using before/after/observed hashes only.
- The release-shaped proof carries the blocked classification through the
  existing `GATE-2` helper on the same sandbox-local checked journal path.
- Missing, malformed, stale, and drifted blocked classification evidence fail
  closed before the release-shaped proof or manual recovery audit proof can be
  treated as proven.

## Hash-only fixture notes

- Persisted journal rows and recovery proof artifacts contain target hashes,
  claim hashes, deterministic 64-character request hashes, and local
  `artifact://` references only.
- The test scans the JSONL file, parsed journal, recovery inspections, release
  proof, and manual audit proof for fixture payload sentinels and asserts none
  are present.
- No live endpoints, remote tunnel services, bearer tokens, or external network
  dependencies are used.

## Validation run

```bash
node --check test/rpp-0652-blocked-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0652 test/rpp-0652-blocked-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0612 test/rpp-0612-blocked-recovery-classification.test.js
node --test --test-name-pattern RPP-0611 test/rpp-0611-new-remote-recovery-classification.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0652-blocked-recovery-classification-v3.md
git diff --check
git diff --cached --check
```

Observed local result: all commands exited 0 in this worktree.

## Residual scope

This is local support evidence for generated blocked recovery classification
coverage and restart-style durable journal readback. It does not claim final
release readiness and does not cover live endpoints, plugin-driver behavior,
executor-auth replay, storage benchmarks, or progress publishing.
