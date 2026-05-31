# RPP-0643 single-writer lease claim variant 3 evidence

Date: 2026-05-31
Issue: RPP-0643
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves the
file-backed claim-fenced journal preserves single-writer lease behavior across
restart/readback and fails closed for superseded writers. Final release status
remains NO-GO until the checked release boundary carries equivalent
production-owned durable storage, lease fencing, and restart evidence.

## Proof added

- Added standalone coverage in
  `test/rpp-0643-single-writer-lease-claim-v3.test.js`.
- The competing-claim case opens an active claim-fenced production recovery
  journal, then attempts a second claim before the stale threshold. The second
  claim appends durable `stale-claim-rejected` evidence and throws
  `RECOVERY_CLAIM_STALE`; after restart, the active claim remains the only
  `recovery-claim-opened` writer and a lower-level stale writer append is still
  fenced before any mutation row can be written.
- The expired-lease case opens a retry claim after the stale threshold. The
  journal appends exactly one `stale-claim-advanced` row, writes a new
  claim-scoped ownership record, exposes a restart-readable
  `claim-fenced-single-writer` writer lease for the retry claim, and fences the
  prior claim on a post-restart append attempt.
- Both cases inspect a preserved remote-change snapshot and require
  `blocked-recovery` with two unknown changed targets and zero mutation rows,
  proving the generated retry coverage does not authorize overwriting preserved
  remote changes.
- Evidence assertions check only claim hashes, journal identity hashes, observed
  snapshot hashes, fsync markers, storage guards, and restart-readable lease
  contracts. The tests scan persisted rows and inspection summaries for the
  deterministic fixture payloads and require
  `assertJournalRecordHasNoRawValues()` to accept every journal record.

## Validation run

```bash
node --check test/rpp-0643-single-writer-lease-claim-v3.test.js
node --test test/rpp-0643-single-writer-lease-claim-v3.test.js
node test/rpp-0643-single-writer-lease-claim-v3.test.js
node --test --test-name-pattern 'file-backed journal fences out stale claims on restart|production recovery journal wrapper writes a restart-readable claim-fenced journal|production recovery journal claim expiry advances stale ownership|checked release path consumes the production recovery journal inspection surface|checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence' test/recovery-journal.test.js
node --test test/rpp-0642-journal-ownership-record-v3.test.js
node test/rpp-0642-journal-ownership-record-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0643-single-writer-lease-claim-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0643 `node --test` run passed 1 file-level test, 0 failures.
- Focused RPP-0643 direct run passed 2 subtests, 0 failures.
- Adjacent recovery journal claim/lease pattern run passed 1 file-level test, 0
  failures.
- RPP-0642 ownership precedent `node --test` run passed 1 file-level test, 0
  failures.
- RPP-0642 direct run passed 2 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
