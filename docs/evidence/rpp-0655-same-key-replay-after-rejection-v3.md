# RPP-0655 same-key replay after rejection, variant 3

Date: 2026-05-31
Issue: RPP-0655
Lane: recovery

## Scope

This is local support evidence for generated same-key replay-after-rejection
coverage. It does not use live endpoints, remote tunnels, or external network
dependencies, and it does not claim final release readiness.

## Proof added

- Added `test/rpp-0655-same-key-replay-after-rejection-v3.test.js`.
- The accepted generated fixture carries only hash-shaped source, path,
  idempotency, request, target, rejection, and proof identities.
- The accepted fixture is passed through
  `buildDurableRecoveryJournalReleaseProof()` and reports `GATE-2`,
  `gateStatus: proven`, `sameReleaseBoundary: true`,
  `sameKeyReplayAfterRejection.proved: true`, and
  `sameKeyReplayAfterRejection.sameCheckedRecoveryPath: true`.
- The local support summary keeps final `releaseMovement.allowed: false` while
  separately recording that the recovery gate movement is allowed for the valid
  local fixture.
- The generated negative matrix rejects missing, malformed, stale, duplicated,
  and drifted rejection replay evidence before recovery gate movement.

## Hash-only fixture notes

- Fixture evidence uses deterministic SHA-256-shaped values for source, checked
  path, boundary, idempotency, request, target, rejection, and proof fields.
- Negative fixtures also remain hash-only. They vary only status type, expiry
  window, replay-row cardinality, request identity, or target hash consistency.
- The proof does not include raw idempotency keys, request bodies, response
  bodies, credentials, bearer values, or private fixture payloads.

## Validation run

```bash
node --check test/rpp-0655-same-key-replay-after-rejection-v3.test.js
node --test --test-name-pattern RPP-0655 test/rpp-0655-same-key-replay-after-rejection-v3.test.js
node --test --test-name-pattern RPP-0615 test/rpp-0615-same-key-replay-after-rejection.test.js
node --test --test-name-pattern RPP-0597 test/rpp-0597-same-key-different-body-conflict-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0655-same-key-replay-after-rejection-v3.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all listed commands exited 0.

## Residual scope

This proof is support-only generated recovery evidence. It does not update
checklist state, progress artifacts, release status, or production boundary
claims. Integration should carry the proof forward only after the lane-level
release verifier accepts the same recovery-gate path.
