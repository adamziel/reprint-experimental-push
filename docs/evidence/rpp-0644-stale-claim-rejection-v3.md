# RPP-0644 stale claim rejection variant 3 evidence

Date: 2026-05-31
Issue: RPP-0644
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves the
file-backed claim-fenced journal preserves stale claim rejection evidence across
restart/readback and exposes the active lease owner identity in local audit
evidence. Final release status remains NO-GO until equivalent production-owned
durable storage, lease fencing, and audit evidence are checked at the release
boundary.

## Proof added

- Added standalone coverage in
  `test/rpp-0644-stale-claim-rejection-v3.test.js`.
- The proof opens an active production recovery journal claim, then attempts a
  competing claim before the stale threshold. The competing claim appends one
  durable `stale-claim-rejected` audit row and throws `RECOVERY_CLAIM_STALE`.
- After restart/readback, the active claim remains the only
  `recovery-claim-opened` writer, the stale rejection row still carries both the
  rejected writer identity and active lease owner identity, and the persisted
  row includes only hashes, fsync evidence, timestamps, and artifact refs.
- The active lease owner identity is asserted across the production inspection
  surface: `journal.claimId`, `journal.claimHash`, `journal.ownershipRecord`,
  `journal.writerLease`, and `journal.leaseFence.writerLease`. The same
  inspection asserts the filesystem compare/rename lease-fence storage guard.
- The proof inspects a preserved remote-change snapshot and requires
  `blocked-recovery` with three old targets, two unknown changed targets, and
  zero mutation rows. A post-restart stale writer then attempts a
  `mutation-applied` append and is fenced before any row is written.
- Persisted rows, inspection summaries, stale error details, and the raw journal
  file are scanned for the deterministic fixture payloads, and every persisted
  row must satisfy `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0644-stale-claim-rejection-v3.test.js
node --test test/rpp-0644-stale-claim-rejection-v3.test.js
node --test --test-name-pattern 'file-backed journal fences out stale claims on restart|production recovery journal wrapper writes a restart-readable claim-fenced journal|production recovery journal claim expiry advances stale ownership|checked release path consumes the production recovery journal inspection surface|checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence' test/recovery-journal.test.js
node --test test/rpp-0642-journal-ownership-record-v3.test.js test/rpp-0643-single-writer-lease-claim-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0644-stale-claim-rejection-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0644 test passed 1 subtest, 0 failures.
- Adjacent recovery journal stale-claim, ownership, and lease pattern run passed
  5 subtests, 0 failures.
- RPP-0642/RPP-0643 adjacent variant-3 ownership and lease run passed 4
  subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
