# RPP-0672 blocked recovery classification, variant 4

Date: 2026-05-31
Issue: RPP-0672
Lane: recovery

## Proof added

- Added focused local coverage in
  `test/rpp-0672-blocked-recovery-classification-v4.test.js`.
- The regression writes a claim-fenced JSONL recovery journal from a child
  process, injects a failure after two committed mutations, exits the writer
  process, and reopens the same journal path from the parent process.
- Restart readback proves the original writer rows are durable: the claim row,
  open row, all four target rows, staged and dependency rows, committing
  boundary, two `mutation-observed` rows, and the `blocked-recovery`
  recovery-state row retain monotonic sequences and fsync evidence.
- A production-style retry open advances the expired writer claim and appends
  retry/ownership rows without altering any rows written before the process
  restart.
- Restart inspection classifies the partial remote as `blocked-recovery` with
  `{ old: 2, new: 2, blockedUnknown: 0 }`, reason code
  `BLOCKED_PARTIAL_REMOTE`, and a durable row count matching the reopened
  journal.

## Hash-only fixture notes

- Persisted journal rows and inspection artifacts contain target hashes, claim
  hashes, deterministic request hashes, and local `artifact://` references only.
- The test scans the JSONL file, parsed journal, production retry inspection,
  and restart classification for fixture payload sentinels and asserts none are
  present.
- No live endpoints, remote tunnel services, bearer tokens, or external network
  dependencies are used.

## Validation run

```bash
node --check test/rpp-0672-blocked-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0672 test/rpp-0672-blocked-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0652 test/rpp-0652-blocked-recovery-classification-v3.test.js
node --test --test-name-pattern 'blocked recovery|blocked-recovery|RPP-0632' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0672-blocked-recovery-classification-v4.md
git diff --check
git diff --cached --check
```

Observed local result: all commands exited 0 in this worktree. The shared
recovery-journal run emitted Node's experimental SQLite warning and still
reported 3 pass / 0 fail.

## Residual scope

This evidence is limited to file-backed recovery journal restart readback and
blocked classification for a partial commit. It does not claim final release
readiness and does not cover live endpoints, plugin-driver behavior,
executor-auth replay, storage benchmarks, or progress publishing.
