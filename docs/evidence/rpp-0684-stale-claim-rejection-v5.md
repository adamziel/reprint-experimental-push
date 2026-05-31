# RPP-0684 stale claim rejection release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0684
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It carries the
stale-claim rejection proof through a release-verifier-shaped durable recovery
gate summary and requires the active lease owner identity to be visible in
hash-only audit evidence. Final release status remains NO-GO until equivalent
production-owned durable storage, lease fencing, and live release-boundary
evidence are checked outside the sandbox.

## Proof added

- Added standalone coverage in
  `test/rpp-0684-stale-claim-rejection-v5.test.js`.
- The proof opens an active production recovery journal claim, then attempts a
  competing claim before the stale threshold. The competing claim appends one
  durable `stale-claim-rejected` audit row and throws `RECOVERY_CLAIM_STALE`.
- The persisted rejection row exposes the rejected writer identity as
  `claimId`/`claimHash` and the active lease owner identity as
  `previousClaimId`/`previousClaimHash`, without creating any mutation rows.
- After restart/readback, the active claim remains the only
  `recovery-claim-opened` writer, the stale rejection row is still durable, and
  the preserved remote snapshot inspects as `blocked-recovery` with three old
  targets, two unknown changed targets, and zero mutation rows.
- The active claim retry exposes the lease owner identity on
  `journal.claimId`, `journal.claimHash`, `journal.ownershipRecord`,
  `journal.writerLease`, and `journal.leaseFence.writerLease`.
- The test builds a release-verifier-shaped durable recovery summary with
  `durableRecoveryJournalBoundary: release-verifier` and `gateStatus: proven`.
  The focused proof requires `checks.leaseOwnerIdentity: true`,
  `checks.staleOwnerFencing: true`, and a manual recovery audit export whose
  lease owner identity matches the active claim, writer lease, lease fence, and
  ownership record.
- Because this variant proves non-expired stale rejection rather than claim
  expiry, the release-shaped proof explicitly keeps `checks.claimExpiryPolicy:
  false` and `claimExpiryPolicy.expired: false`.
- Persisted rows, stale error details, inspection summaries, release-shaped
  proof evidence, explicit audit evidence, and the raw journal file are scanned
  for deterministic fixture payloads. Every persisted row must also satisfy
  `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0684-stale-claim-rejection-v5.test.js
node --test --test-name-pattern RPP-0684 test/rpp-0684-stale-claim-rejection-v5.test.js
node --test --test-name-pattern RPP-0664 test/rpp-0664-stale-claim-rejection-v4.test.js
node --test --test-name-pattern RPP-0644 test/rpp-0644-stale-claim-rejection-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0684-stale-claim-rejection-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0684 test passed 1 subtest, 0 failures.
- RPP-0664 stale claim rejection predecessor passed 1 subtest, 0 failures.
- RPP-0644 stale claim rejection predecessor passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local support evidence only. It does not change release status, does
not claim production-backed release readiness, and keeps final release NO-GO.
