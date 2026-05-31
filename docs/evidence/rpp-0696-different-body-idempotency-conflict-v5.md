# RPP-0696 different-body idempotency conflict release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0696
Lane: recovery release-verifier carry-through

## Scope

This is local SQLite-backed recovery support evidence. It proves that a
same-key different-body idempotency conflict can carry a hash-only
`fully-updated-remote` recovery state through the release-verifier-shaped
durable recovery proof. It does not claim production-owned durable storage or
final release readiness. Final release posture remains NO-GO.

## Proof added

- Added focused coverage in
  `test/rpp-0696-different-body-idempotency-conflict-v5.test.js`.
- The test builds a deterministic four-target push plan with one remote-only
  preserved file outside the mutation and precondition sets.
- It writes a production-shaped completed recovery journal, mirrors the
  hash-only rows into a local SQLite `recovery_journal` table, appends
  idempotency event rows for original apply, same-body replay, and a same-key
  different-body `idempotency-key-conflict`, then closes and reopens SQLite.
- SQLite readback proves monotonic schema-versioned rows, restart-readable
  completed state, one conflict row, one replay row, one committed row,
  one mutation-applied event per planned mutation, no mutation events after the
  conflict, and no raw fixture payloads.
- Restart inspection over the SQLite journal and fully applied current snapshot
  proves `fully-updated-remote`, `remoteRecoveryClassification.kind:
  "new-remote"`, SQLite storage, restart readability, and all targets in the
  `new` bucket.
- The release-verifier-shaped proof carries the SQLite-backed conflict recovery
  state through `buildDurableRecoveryJournalReleaseProof()` with `GATE-2`,
  `durableRecoveryJournalBoundary: "release-verifier"`,
  `checks.sameKeyDifferentBodyConflict: true`,
  `checks.recoveryInspectAfterRestart: true`, old/new/blocked recovery states,
  same-key replay after rejection, preserved rejected remote evidence, and a
  hash-only manual recovery audit export.
- Missing, malformed, stale, duplicated, post-conflict mutation, request-hash
  drift, target-snapshot drift, recovery-count drift, and checked-path drift
  are rejected before release-verifier or replay proof movement starts.

## Hash-only fixture notes

Persisted rows and support evidence contain deterministic hashes, claim hashes,
event names, counts, local artifact references, and a checked-path hash. The
test asserts that journal rows, SQLite readback, recovery inspections, release
summary, release proof, and support evidence do not include fixture payloads,
request bodies, bearer material, credentials, external URLs, or remote tunnel
evidence.

## Validation run

```bash
node --check test/rpp-0696-different-body-idempotency-conflict-v5.test.js
node --test --test-name-pattern RPP-0696 test/rpp-0696-different-body-idempotency-conflict-v5.test.js
node --test --test-name-pattern RPP-0676 test/rpp-0676-different-body-idempotency-conflict-v4.test.js
node --test --test-name-pattern RPP-0656 test/rpp-0656-different-body-idempotency-conflict-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0696-different-body-idempotency-conflict-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0696 release-verifier carry-through proof passed 2 subtests, 0
  failures.
- Adjacent RPP-0676 different-body conflict proof passed 2 subtests, 0
  failures.
- Adjacent RPP-0656 different-body conflict proof passed 2 subtests, 0
  failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local SQLite-backed support only. Integration should keep
release movement blocked until equivalent production-backed durable journal and
live release-boundary evidence exists.
