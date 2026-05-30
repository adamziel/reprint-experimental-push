# RPP-0714 large post table benchmark evidence

Evidence for RPP-0714. This slice adds a deterministic benchmark for a large
`wp_posts` table that exercises the real planner/apply path over row mutations,
then records bounded primary-key batch windows around those planned mutations.

## Benchmark behavior

`scripts/bench/large-post-table-benchmark.js` reports:

- benchmark id: `rpp-0714-large-post-table`
- table: `wp_posts`
- storage boundary: `live-remote-hash-precondition-before-apply`
- apply mode: `applyPlan-live-precondition-row-mutations`
- batch order: `primary-key-ascending`
- production throughput claim: `not-claimed`

The benchmark fixture intentionally uses core post fields without graph-reference
columns. That keeps this item focused on large post table size, row
preconditions, apply behavior, and batch-window budgeting; WordPress graph
reference mapping remains covered by the graph-specific evidence items.

Correctness gates:

1. `large-post-table-plan-ready`
2. `wp-posts-live-preconditions`
3. `bounded-primary-key-batches`
4. `apply-result-matches-plan`
5. `hash-only-evidence`
6. `large-site-runtime-budget`

Evidence stores counts, primary-key window bounds, and hashes only. It omits
post titles, post bodies, slugs, URLs, and absolute paths.

## Focused validation

Command:

- `node --test test/rpp-0714-large-post-table-benchmark.test.js`

Result:

- 4 tests, 4 ok, 0 failed

## Large-site budget run

Command:

- `node scripts/bench/large-post-table-benchmark.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `12262.06 ms` within the documented `15000 ms` budget
- heap used: `76137408 bytes` within the documented `268435456 bytes` budget
- table rows: `20000`
- changed `wp_posts` rows: `10000`
- unchanged `wp_posts` rows: `10000`
- planned row mutations: `10000`
- live remote preconditions: `10000`
- batch size: `500` rows
- batch windows: `20`
- max observed batch rows: `500`
- duplicate post ids in batch windows: `0`
- applied mutations: `10000`
- changed rows verified after apply: `10000`
- unchanged sample rows verified after apply: `3`
- verification failures: `0`
- raw value evidence leaks: `0`

Timings:

- fixture: `468.01 ms`
- plan: `1359.99 ms`
- batch window construction: `41.40 ms`
- apply: `10096.81 ms`
- verification: `295.59 ms`
- total: `12262.06 ms`

All benchmark gates reported `pass`: ready plan, one live remote precondition
per changed post row, bounded primary-key batches, apply result matching the
plan, hash-only evidence, and large-site runtime/resource budget.

## Limits

This is focused benchmark evidence for a large `wp_posts` table in the
in-memory planner/apply fixture. It does not claim production database row
executor throughput, production storage receipts, WordPress graph reference
rewrites, media-library transfer performance, plugin-file transfer performance,
or release-verifier carry-through.
