# RPP-0616 different-body idempotency conflict

Status: focused variant-1 implementation added for the recovery boundary.

## Scope

RPP-0616 requires a same idempotency key with a different canonical request body to fail closed while preserving the durable recovery state. This slice keeps the proof separate from same-key rejection replay work and focuses on the conflict path after an original request has durable apply evidence.

## Implementation

- `buildDurableRecoveryJournalReleaseProof()` now requires different-body conflict evidence to include two distinct request hashes and a restart-readable DB-backed recovery state.
- The conflict proof records the original request hash, conflicting request hash, conflict event sequence, no mutation work after the conflict event, and the recovery classification used for the conflict boundary.
- `test/rpp-0616-different-body-idempotency-conflict.test.js` writes the recovery journal to a SQLite table, restarts the table readback, appends an `idempotency-key-conflict` hash-only event, and proves the remote remains `fully-updated-remote` with all planned targets in the `new` bucket.

## Validation

Commands run for this slice:

```sh
node --check scripts/playground/production-shaped-live-release-verify-lib.js
node --check test/rpp-0616-different-body-idempotency-conflict.test.js
node --check test/recovery-journal.test.js
node --check test/production-shaped-proof.test.js
node --test test/rpp-0616-different-body-idempotency-conflict.test.js
node --test --test-name-pattern 'durable recovery journal release proof' test/production-shaped-proof.test.js
node --test test/recovery-journal.test.js
node --test test/recovery-repair.test.js
```

Observed results: the focused SQLite-backed RPP-0616 test passed 1/1; recovery journal passed 28/28; recovery repair passed 5/5; the focused production-shaped proof passed 1/1.

## Residual notes

- The proof uses hash-only request and recovery evidence; it does not serialize request bodies or site payload values.
- This slice does not implement same-key rejection replay behavior for RPP-0615.
