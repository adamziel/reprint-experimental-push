# RPP-0711 remote hash pagination evidence

Evidence for RPP-0711. This slice implements source- and scope-bound remote
hash pagination for the authenticated `snapshot-hashes` route and adds a
deterministic benchmark for remote hash pagination behavior.

## Implementation

The authenticated snapshot hash route now issues page cursors with this shape:

- `snapcursor:{sourceHashPrefix}:{scopeHashPrefix}:{offset}`

Before serving a page, the route validates that a supplied cursor matches the
current remote source hash prefix and the requested comparison scope hash
prefix. Mismatched source, mismatched scope, malformed cursor, out-of-range
offset, and invalid `batch_size` inputs fail with `INVALID_ARGUMENT` before any
page is returned.

The response and receipt include hash-only pagination evidence:

- cursor format and version
- source and scope hash prefixes
- offset, next offset, batch size, page resource count, total resource count
- page hash and snapshot hash-set hash
- planning-only boundary stating that hash pages are read-only and not write
  authority

## Deterministic benchmark

Command:

- `node scripts/bench/remote-hash-pagination.js --resource-count=1205 --batch-size=128`

Observed summary from this sandbox:

- `ok: true`
- mode: `deterministic-no-live-remote`
- duration: `180.27 ms` within the `5000 ms` budget
- heap used: `6887376 bytes` within the `134217728 bytes` budget
- remote hash resources: `1205`
- page count: `10`
- duplicate resource keys: `0`
- cursor count: `9`
- complete page count: `1`
- raw value evidence leaks: `0`

All benchmark gates reported `pass`: complete resource-set pagination,
source/scope-bound cursor validation, configuration bounds, deterministic page
hashes, planning-only authority, hash-only page evidence, and runtime/resource
budget.

## Focused validation

Command:

- `node --test test/remote-hash-pagination.test.js test/production-snapshot-hashes-route.test.js`

Result:

- 8 tests, 8 ok, 0 failed

## Limits

No live remote WordPress service was supplied in this sandbox run. The evidence
proves deterministic pagination, configuration, and error-path coverage plus
the route source contract. It does not claim live production proof, release
verifier carry-through, or unrelated integration-lane coverage.
