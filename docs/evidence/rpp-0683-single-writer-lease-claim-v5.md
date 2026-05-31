# RPP-0683 single-writer lease claim variant 5 evidence

Date: 2026-05-31
Issue: RPP-0683
Lane: journal-recovery

## Scope

This is focused local recovery-journal release-verifier carry-through coverage.
It proves the claim-fenced single-writer lease retry path refuses to overwrite
preserved remote changes before mutation, and that the same retry-preservation
evidence reaches the durable recovery journal release proof surface. Final
release status remains NO-GO until equivalent production-owned durable storage,
lease fencing, retry preservation, and release-boundary evidence are checked on
the live release path.

## Proof added

- Added standalone coverage in
  `test/rpp-0683-single-writer-lease-claim-v5.test.js`.
- The proof opens an active claim-fenced production recovery journal, then
  attempts a competing claim before the stale threshold against a preserved
  remote snapshot. The competing claim writes one durable stale-claim rejection,
  never enters the active writer set, and leaves the preserved remote snapshot
  unchanged.
- The proof then advances exactly one expired retry claim on the same persisted
  journal path. The retry claim exposes restart-readable single-writer lease
  and lease-fence evidence, including claim identity, claim hash, fsync
  evidence, monotonic sequence, and bounded claim-expiry metadata.
- Applying the retry against the preserved remote snapshot fails with
  hash-only `PRECONDITION_FAILED` evidence before mutation. The preserved
  remote snapshot remains byte-for-byte unchanged, the journal row count is
  unchanged by the failed apply, and no mutation, commit, or completion row is
  appended.
- Restart/readback classifies the preserved remote snapshot as
  `blocked-recovery` with three old targets and two unknown changed targets,
  while the original base remote still classifies as `old-remote` on the same
  checked journal path.
- The same checked path is carried into
  `buildDurableRecoveryJournalReleaseProof()`. The proof requires `GATE-2`,
  `durableRecoveryJournalBoundary: release-verifier`, `gateStatus: proven`,
  `sameReleaseBoundary: true`, stale-owner fencing, claim-expiry policy,
  old-state evidence, blocked-state evidence, preserved rejected remote
  evidence, and same-key replay-after-rejection evidence with
  `preservedRemoteUnchanged: true` and zero mutations before failure.
- A negative verifier-shaped replay with `preservedRemoteUnchanged: false` and
  one mutation before failure is rejected, proving the release proof does not
  pass if retry preservation is lost.
- Persisted journal rows, stale error details, inspection summaries, release
  proof evidence, and the raw journal file are checked for hash-only content
  with no deterministic fixture payloads.

## Validation run

```bash
node --check test/rpp-0683-single-writer-lease-claim-v5.test.js
node --test --test-name-pattern RPP-0683 test/rpp-0683-single-writer-lease-claim-v5.test.js
node --test --test-name-pattern RPP-0663 test/rpp-0663-single-writer-lease-claim-v4.test.js
node --test --test-name-pattern RPP-0643 test/rpp-0643-single-writer-lease-claim-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0683-single-writer-lease-claim-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0683 run passed 1 subtest, 0 failures.
- Predecessor RPP-0663 run passed 2 subtests, 0 failures.
- Predecessor RPP-0643 run passed 2 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local recovery support evidence only. It does not change release status,
does not claim production-backed release readiness, and keeps final release
NO-GO.
