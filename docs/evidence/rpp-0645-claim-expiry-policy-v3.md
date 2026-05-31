# RPP-0645 claim expiry policy variant 3 evidence

Date: 2026-05-31
Issue: RPP-0645
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves the
file-backed claim-fenced journal carries claim expiry policy evidence through
restart/readback and into the release-verifier recovery gate helper on the same
checked recovery path. Final release status remains NO-GO until equivalent
production-owned durable storage, lease fencing, claim expiry, and release
boundary evidence are checked at the live release boundary.

## Proof added

- Added standalone coverage in
  `test/rpp-0645-claim-expiry-policy-v3.test.js`.
- The proof opens an active production recovery journal claim with a bounded
  stale threshold, then attempts a competing claim before expiry. The competing
  claim appends one `stale-claim-rejected` audit row, throws
  `RECOVERY_CLAIM_STALE`, and leaves the original active claim as the only
  `recovery-claim-opened` writer.
- The proof then opens a retry claim after expiry. The journal appends exactly
  one `stale-claim-advanced` row, backfills claim-scoped ownership for the retry
  claim, and preserves restart-readable writer lease and lease-fence evidence
  for the advanced claim.
- Reopening the advanced retry claim does not append another
  `stale-claim-advanced` row, proving the expiry policy advances the expired
  claim once on the persisted path.
- A stale prior writer attempts an `apply-staged` append after being superseded
  and is rejected before any mutation-preparation rows are written. The journal
  still contains zero `apply-staged`, `dependencies-validated`,
  `mutation-observed`, `mutation-applied`, `journal-completed`, or
  `apply-committed` rows.
- The restarted journal is inspected as `old-remote`, then passed into
  `buildDurableRecoveryJournalReleaseProof()`. The proof asserts `GATE-2`,
  `gateStatus: proven`, `sameReleaseBoundary: true`,
  `claimExpiryPolicy.proved: true`, `sameKeyReplayAfterRejection` on the same
  checked recovery path, and the same old-remote counts from restart/readback.
- Persisted rows, stale error details, inspection summaries, release proof
  evidence, and the raw journal file are scanned for deterministic fixture
  payloads. Every persisted row must also satisfy
  `assertJournalRecordHasNoRawValues()`, and the manual recovery audit proof
  target envelope remains hash-only.

## Validation run

```bash
node --check test/rpp-0645-claim-expiry-policy-v3.test.js
node --test test/rpp-0645-claim-expiry-policy-v3.test.js
node --test --test-name-pattern 'production recovery journal claim expiry advances stale ownership|RPP-0625 SQLite claim expiry proof|file-backed journal fences out stale claims on restart|production recovery journal wrapper writes a restart-readable claim-fenced journal|production recovery journal ownership record is durable after restart|checked release path consumes the production recovery journal inspection surface|checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence' test/recovery-journal.test.js
node --test test/rpp-0642-journal-ownership-record-v3.test.js test/rpp-0643-single-writer-lease-claim-v3.test.js test/rpp-0644-stale-claim-rejection-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0645-claim-expiry-policy-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0645 test passed 1 subtest, 0 failures.
- Adjacent recovery-journal claim-expiry, stale-claim, ownership, and lease
  pattern run passed 7 subtests, 0 failures.
- Adjacent RPP-0642/RPP-0643/RPP-0644 variant-3 run passed 5 subtests, 0
  failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local recovery support evidence only. It does not change release status,
does not claim production-backed release readiness, and keeps final release
NO-GO.
