# RPP-0713 apply batch sizing evidence

Evidence for RPP-0713. This slice adds bounded apply batch sizing to the
storage-performance apply path without changing the storage-boundary
compare-and-swap checks for each mutation.

## Behavior

The apply protocol now supports `applyBatchSize` with REST payload aliases
`apply_batch_size` and `applyBatchSize`.

- default batch size: `500`
- accepted configured range: `1` through `500`
- invalid values: rejected with `INVALID_ARGUMENT` before mutation work
- apply start evidence: records `applyBatchSizing` with batch size, batch
  count, mutation count, configuration source, and storage-boundary policy
- batch evidence: records `apply-batch-revalidated` before each batch and
  `apply-batch-committed` after each batch
- revalidation: exports a fresh live snapshot and verifies the batch's planned
  preconditions before mutation work in that batch
- storage boundary: each mutation still reaches the existing
  `storage-boundary-cas` check immediately before the storage write

Batch evidence is hash-and-count oriented: batch id, index, counts, resource
keys, snapshot hash, batch hash, and compact precondition hashes. It does not
store row payloads, file contents, option values, post content, or snapshots.

## Focused validation

Command:

- `node --test test/rpp-0713-apply-batch-sizing.test.js`

Result:

- 3 tests, 3 ok, 0 failed

Covered deterministic cases:

- default and configured batch size handling
- batch partitioning for a five-mutation input at size two
- invalid values `0`, `501`, `1.5`, boolean, and object/array fail closed
- apply loop revalidates each batch before `mutation-prepared`
- batch commit evidence is recorded before final `apply-committed`
- REST payload aliases feed the protocol `applyBatchSize` option
- DB journal callback stores hash-only batch evidence for batch events

## Syntax checks

Commands:

- `php -l scripts/playground/push-remote-lib.php`
- `php -l scripts/playground/push-remote-rest-plugin.php`

Result:

- no syntax errors detected

## Limitation

No live remote WordPress service was exercised for this worker's evidence.
This is deterministic configuration, error-path, and source-path coverage for
the local apply protocol. It does not claim live production throughput,
production remote durability, or production recovery behavior.

Local Playground smokes were attempted but are not used as RPP-0713 proof:

- `npm run test:playground:storage-guarded-file-write` returned HTTP `500`
  with `AUTH_SOURCE_BINDING_MISMATCH` before the apply batch path.
- Parallel attempts of `npm run test:playground:storage-guarded-db-write` and
  `npm run test:playground:storage-guarded-file-write` returned the same
  source-binding mismatch before the apply batch path.
- `npm run test:playground:push-protocol` reached a quiet, CPU-bound
  `wp-playground` apply process and was interrupted rather than used as
  evidence.

## Redaction posture

The new apply batch evidence is limited to counts, resource keys, cursors, and
SHA-256 hashes. The focused test asserts that the batch revalidation and DB
journal evidence paths do not include `currentSnapshot`, `afterSnapshot`,
`beforeSnapshot`, `post_content`, `option_value`, or `meta_value`.
