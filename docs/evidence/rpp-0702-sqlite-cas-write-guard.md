# RPP-0702 SQLite CAS write guard evidence

Evidence for RPP-0702. This slice adds a SQLite compare-and-swap write guard
that performs guarded row updates with one `UPDATE` statement whose `WHERE`
clause compares the expected storage state before any write is accepted.

## Guard behavior

The SQLite guard builds a null-safe statement shape:

- boundary: `sqlite-single-statement-cas`
- statement kind: `UPDATE`
- predicate form: compared columns use `IS ?` placeholders
- evidence: table and column names, counters, outcomes, and SHA-256 hashes only

Covered row surfaces:

- `wp_posts`
- `wp_options`
- `wp_postmeta`
- `wp_reprint_push_forms_lab`
- `wp_reprint_push_release_state`

For each surface the focused validation exercises matching storage, drifted
storage, and absent storage. Matching storage updates exactly one row. Drifted
or absent storage records `stale-at-write`, reports zero affected rows, and
leaves the existing row state unchanged.

## Focused validation

Command:

- `node --test test/sqlite-cas-write-guard.test.js test/sqlite-cas-write-guard-benchmark.test.js`

Result:

- 6 tests, 6 ok, 0 failed

Command:

- `npm run bench:sqlite-cas-write-guard -- --iterations 5`

Result summary:

- `ok: true`
- SQLite runtime available through `node:sqlite` with SQLite `3.48.0`
- guarded writes attempted: 75
- applied writes: 25
- stale-at-write rejections: 25
- absent-at-write rejections: 25
- unsafe multiple-match writes: 0
- gates: SQLite runtime available, deterministic guard behavior,
  applied/stale outcomes, single-statement null-safe CAS shapes,
  hash-only evidence, and runtime resource budget

## Redaction posture

The guard and benchmark evidence do not store row payloads, option values, post
content, meta values, or fixture payload strings. Storage evidence stores only
logical table names, column names, outcomes, counts, SQL shape hashes, and
SHA-256 hashes for expected, planned, and observed storage state.
