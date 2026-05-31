# RPP-0664 stale claim rejection variant 4 evidence

Date: 2026-05-31
Issue: RPP-0664
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It proves the
file-backed claim-fenced journal rejects a competing stale writer before the
lease threshold, keeps the stale rejection restart-readable, and exposes the
active lease owner identity in hash-bound audit evidence. Final release status
remains NO-GO until equivalent production-owned durable storage, lease fencing,
and audit evidence are checked at the release boundary.

## Proof added

- Added standalone coverage in
  `test/rpp-0664-stale-claim-rejection-v4.test.js`.
- The proof opens an active production recovery journal claim, then attempts a
  competing claim before the stale threshold. The competing claim appends one
  durable `stale-claim-rejected` audit row and throws `RECOVERY_CLAIM_STALE`.
- The stale rejection audit row exposes the rejected writer identity as
  `claimId`/`claimHash` and the active lease owner identity as
  `previousClaimId`/`previousClaimHash`.
- After restart/readback, the active claim remains the only
  `recovery-claim-opened` writer for the journal, the stale rejection row still
  carries the active lease owner identity, and no mutation rows are present.
- The production inspection surface also exposes the lease owner identity on
  `journal.claimId`, `journal.claimHash`, `journal.ownershipRecord`,
  `journal.writerLease`, and `journal.leaseFence.writerLease`, with the
  filesystem compare/rename lease-fence storage guard intact.
- The proof inspects a preserved remote-change snapshot and requires
  `blocked-recovery` with three old targets, two unknown changed targets, and
  zero mutation rows. A post-restart stale writer then attempts a
  `mutation-applied` append and is fenced before any row is written.
- Persisted rows, inspection summaries, stale error details, and the raw journal
  file are scanned for deterministic fixture payloads, and every persisted row
  must satisfy `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0664-stale-claim-rejection-v4.test.js
node --test --test-name-pattern RPP-0664 test/rpp-0664-stale-claim-rejection-v4.test.js
node --test --test-name-pattern RPP-0644 test/rpp-0644-stale-claim-rejection-v3.test.js
node --test --test-name-pattern 'stale claim|lease fence|durable journal boundary' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0664-stale-claim-rejection-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0664 test passed 1 subtest, 0 failures.
- RPP-0644 stale claim rejection precedent passed 1 subtest, 0 failures.
- Adjacent recovery-journal stale claim, lease fence, and durable boundary run
  passed 2 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
