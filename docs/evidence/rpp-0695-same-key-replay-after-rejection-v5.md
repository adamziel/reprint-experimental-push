# RPP-0695 same-key replay after rejection release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0695
Lane: recovery release-verifier carry-through

## Scope

This is local support-only evidence for the same-key replay-after-rejection
path. It uses deterministic hash-only fixtures and carries the accepted fixture
through the release-verifier-shaped durable recovery proof. It does not use
live endpoints, remote tunnels, or external network dependencies, and it does
not claim final release readiness.

## Proof added

- Added `test/rpp-0695-same-key-replay-after-rejection-v5.test.js`.
- The accepted generated fixture carries only hash-shaped source, checked-path,
  release-boundary, idempotency, request, target, rejection, and proof
  identities.
- The fixture validates that the initial apply is rejected before the first
  mutation with status 412, the replay uses the same idempotency key and same
  canonical request hash, no fresh mutation work occurs, the target snapshot is
  unchanged, and the journal has exactly one rejected row followed by exactly
  one replay row.
- The accepted fixture is passed through
  `buildDurableRecoveryJournalReleaseProof()` and reports `gate: "GATE-2"`,
  `durableRecoveryJournalBoundary: "release-verifier"`,
  `gateStatus: "proven"`, `sameReleaseBoundary: true`,
  `sameKeyReplayAfterRejection.proved: true`, and
  `sameKeyReplayAfterRejection.sameCheckedRecoveryPath: true`.
- The local support summary records that recovery-gate movement is allowed for
  the valid local fixture while final `releaseMovement.allowed` remains false
  and `releaseStatus` remains `NO-GO`.
- The negative matrix rejects missing, malformed, stale, duplicated, and
  drifted replay evidence before recovery gate movement.

## Hash-only fixture notes

- Fixture evidence uses deterministic SHA-256-shaped values for source,
  checked path, release boundary, idempotency key, request, target, rejection,
  and proof fields.
- Negative fixtures vary only status type, freshness window, replay-row
  cardinality, request identity, or target hash consistency.
- The proof does not include raw idempotency keys, request bodies, response
  bodies, credentials, bearer values, private fixture payloads, external URLs,
  or production-owned values.

## Validation run

```bash
node --check test/rpp-0695-same-key-replay-after-rejection-v5.test.js
node --test --test-name-pattern RPP-0695 test/rpp-0695-same-key-replay-after-rejection-v5.test.js
node --test --test-name-pattern RPP-0675 test/rpp-0675-same-key-replay-after-rejection-v4.test.js
node --test --test-name-pattern RPP-0655 test/rpp-0655-same-key-replay-after-rejection-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0695-same-key-replay-after-rejection-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0695 release-verifier same-key replay-after-rejection proof
  passed locally.
- RPP-0675 predecessor proof passed locally.
- RPP-0655 predecessor proof passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This proof is support-only generated recovery evidence. It proves the recovery
gate is carried through the release verifier on the same checked path, but it
does not update checklist state, progress artifacts, release status, or
production boundary claims. Final release remains NO-GO until equivalent
production-backed durable journal and live release-boundary evidence exists.

Integration recommendation: carry this as local recovery-gate support evidence
only; require production-backed durable journal evidence before release
movement.
