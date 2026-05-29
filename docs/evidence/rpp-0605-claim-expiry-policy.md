# RPP-0605 claim expiry policy evidence

Date: 2026-05-29
Issue: RPP-0605
Lane: recovery

## Proof added

- Production recovery journals now record a bounded claim expiry policy on
  claim-open and stale-claim-advance rows: `claimOpenedAt`, `claimExpiresAt`,
  `staleThresholdMs`, previous-claim timing, and `claimExpired` evidence.
- A different claimant is rejected before the active claim reaches its expiry
  threshold. After the threshold, the new claimant appends
  `stale-claim-advanced`, preserves the existing target envelope, backfills its
  own ownership row, and reopens append-only without truncating previous rows.
- Claim-fenced writers re-read the persisted claim state before appending and
  now fail closed when their own active claim has exceeded the persisted expiry
  threshold.
- The recovery release verifier proof now carries `claimExpiryPolicy` alongside
  lease-owner identity and stale-owner fencing. The focused regression asserts
  the recovery gate reports `GATE-2` as proven on the same release-boundary path
  when the expired claim is advanced.
- The checked Playground DB journal summary exposes hash-only top-level
  `claimExpiry` evidence so the live release verifier can consume the same
  policy without changing the claim, writer-lease, or lease-fence object shapes
  used by existing clients.

## Focused regression

`test/recovery-journal.test.js` now includes
`production recovery journal claim expiry advances stale ownership and release proof stays on the same path`:

1. Opens a production recovery journal with a 1000 ms claim threshold.
2. Attempts a different claim at 500 ms and asserts it is rejected with the
   active claim identity, age, and non-expired decision.
3. Attempts the same different claim at 5000 ms and asserts the journal appends
   `stale-claim-advanced` instead of truncating, with previous claim id/hash,
   previous age, threshold, and previous expiry timestamp.
4. Inspects the restarted journal and verifies the active claim, writer lease,
   and claim expiry evidence agree.
5. Feeds that same inspection into the release verifier helper and asserts the
   durable recovery journal proof reports `GATE-2`, `gateStatus: proven`, and
   `claimExpiryPolicy.proved` on the same release boundary.

## Validation run

```bash
node --test --test-name-pattern 'claim expiry|durable recovery journal release proof binds' test/recovery-journal.test.js test/production-shaped-proof.test.js
node --test test/recovery-journal.test.js
php -l scripts/playground/push-db-journal-lib.php
node --check src/recovery-journal.js
node --check src/authenticated-http-push-client.js
node --check scripts/playground/production-shaped-live-release-verify-lib.js
```

Observed result: focused claim-expiry/release-proof coverage exited 0 with 2
subtests, the recovery journal suite exited 0 with 25 subtests, and syntax
checks exited 0.
