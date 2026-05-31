# RPP-0665 claim expiry policy variant 4 evidence

Date: 2026-05-31
Issue: RPP-0665
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage only. It proves the
file-backed claim-fenced journal carries claim expiry policy evidence through
restart/readback and into the release-verifier recovery gate helper on the same
checked recovery path. Final release status remains NO-GO until equivalent
production-owned durable storage, lease fencing, claim expiry, and release
boundary evidence are checked at the live release boundary.

## Proof added

- Added standalone coverage in
  `test/rpp-0665-claim-expiry-policy-v4.test.js`.
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
  `durableRecoveryJournalBoundary: release-verifier`, `gateStatus: proven`,
  `sameReleaseBoundary: true`, `claimExpiryPolicy.proved: true`,
  `sameKeyReplayAfterRejection` on the same checked recovery path, and the same
  old-remote counts from restart/readback.
- Persisted rows, stale error details, inspection summaries, release proof
  evidence, and the raw journal file are scanned for deterministic fixture
  payloads. Every persisted row must also satisfy
  `assertJournalRecordHasNoRawValues()`, and the manual recovery audit proof
  target envelope remains hash-only.

## Validation run

```bash
node --check test/rpp-0665-claim-expiry-policy-v4.test.js
node --test --test-name-pattern RPP-0665 test/rpp-0665-claim-expiry-policy-v4.test.js
node --test --test-name-pattern RPP-0645 test/rpp-0645-claim-expiry-policy-v3.test.js
node --test --test-name-pattern 'claim expiry|RPP-0625' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0665-claim-expiry-policy-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0665 test passed 1 subtest, 0 failures.
- Adjacent RPP-0645 variant-3 proof passed 1 subtest, 0 failures.
- Adjacent recovery-journal claim expiry and RPP-0625 run passed all selected
  subtests.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local recovery support evidence only. It does not change release status,
does not claim production-backed release readiness, and keeps final release
NO-GO.
