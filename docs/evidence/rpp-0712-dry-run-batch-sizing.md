# RPP-0712 dry-run batch sizing evidence

Evidence for RPP-0712. This slice adds a deterministic dry-run batch sizing
benchmark for storage-performance planning. It sizes `push_plan_dry_run`
validation batches without granting apply authority, carries one expected
storage hash per planned resource, and issues the final dry-run receipt only
after every batch receipt is present.

## Batch sizing behavior

The benchmark report emits:

- benchmark id: `rpp-0712-dry-run-batch-sizing`
- variant: `1`
- mode: `deterministic-dry-run-batch-sizing`
- dry-run stage: `push_plan_dry_run`
- limits: maximum resources, estimated bytes, and preconditions per batch
- receipt rule: final dry-run receipt requires the complete batch set
- authority rule: dry-run batch and final receipts are not locks and do not
  authorize apply

The deterministic unit run covered 62 planned resources, 62 carried
preconditions, and 9 dry-run batches. The largest batch contained 9 resources,
7833 estimated bytes, and 9 preconditions under configured limits of 9
resources, 8192 estimated bytes, and 9 preconditions.

## Guard projection

The stale-storage projection uses a resource from the dry-run batch set, changes
the observed live storage hash before apply, and verifies the projected guarded
write outcome is `stale-at-write`. The dry-run receipt remains read-only:

- guarded write rejected: `true`
- mutation applied: `false`
- dry-run receipt authorizes mutation: `false`
- reason: `live-storage-hash-differs-from-dry-run-precondition`

## Error paths

The benchmark also records deterministic fail-closed probes:

- zero resource limit -> `DRY_RUN_BATCH_LIMIT_INVALID`
- oversized resource envelope -> `DRY_RUN_BATCH_ITEM_EXCEEDS_LIMIT`
- missing precondition hash -> `DRY_RUN_BATCH_ITEM_INVALID`

All probes blocked invalid input before a dry-run receipt could be issued.

## Focused validation

Command:

- `node --test test/dry-run-batch-sizing.test.js`

Result:

- 5 tests, 5 ok, 0 failed

Command:

- `node --check scripts/bench/dry-run-batch-sizing.js`

Result:

- syntax check passed

## Live service limitation

No live remote service was configured or contacted for this scoped
storage-performance batch sizing run. This evidence is deterministic local
configuration, receipt-shape, and stale-write error-path coverage only; it does
not claim live production dry-run proof.

## Redaction posture

Dry-run batch evidence is hash-and-count only. It stores batch ids, counts,
limits, table names, resource-key hashes, expected/planned SHA-256 hashes, and
receipt hashes. It does not store row payloads, option values, post content,
meta values, file bytes, credentials, or private site values.
