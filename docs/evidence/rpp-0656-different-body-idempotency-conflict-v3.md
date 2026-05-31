# RPP-0656 different-body idempotency conflict, variant 3

Date: 2026-05-31

Status: local generated support evidence only. This does not claim final release
readiness or widen any release gate.

## Claim

Reusing an idempotency key with a different canonical request body must record a
hash-only conflict in durable recovery storage, preserve the fully-updated
recovery state, and block movement for the rejected body. Missing, malformed,
stale, duplicated, or drifted conflict evidence must fail before checked replay
or recovery proof movement starts.

## Proof Surface

`test/rpp-0656-different-body-idempotency-conflict-v3.test.js` creates a
deterministic SQLite recovery journal table and reads it back through the local
SQLite recovery journal adapter. The journal contains:

- one original idempotency-opened row;
- one apply-started row;
- one mutation-applied row per planned mutation;
- one apply-committed row;
- one same-key same-body apply-replayed row; and
- one same-key different-body idempotency-key-conflict row.

The conflict row carries only hashed key, request, claim, mutation, and target
snapshot evidence. It records status `409`, code
`IDEMPOTENCY_KEY_CONFLICT`, distinct original and conflicting request hashes,
`freshMutationWork: false`, identical before/after target snapshot hashes, and
zero rows after the conflict.

## Proven Behavior

- The SQLite readback reports an intact schema-versioned journal and the
  conflict row passes the recovery journal raw-value guard.
- The production-shaped durable proof accepts the conflict only when the
  recovery state is DB-backed, restart-readable, `fully-updated-remote`, and
  all planned targets are in the `new` bucket.
- The rejected different-body request starts no replay or recovery movement;
  support evidence keeps `releaseMovement.allowed: false`.
- The negative matrix rejects missing conflict evidence, malformed request
  hashes, stale conflict ordering, duplicated conflict rows, request-hash drift,
  and target-snapshot drift before checked replay or recovery proof movement
  starts.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0656-different-body-idempotency-conflict-v3.test.js
node --test --test-name-pattern RPP-0656 test/rpp-0656-different-body-idempotency-conflict-v3.test.js
node --test --test-name-pattern RPP-0616 test/rpp-0616-different-body-idempotency-conflict.test.js
node --test --test-name-pattern RPP-0597 test/rpp-0597-same-key-different-body-conflict-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0656-different-body-idempotency-conflict-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0656 run
reported 2 passes / 0 failures. The adjacent RPP-0616 run reported
1 pass / 0 failures, and the adjacent RPP-0597 run reported
3 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is generated and local. It uses no live endpoints, public ingress,
remote tunnels, production credentials, request bodies, bearer material, or
network-dependent evidence. Integration should keep final release movement
blocked until the broader checked production evidence set is complete.
