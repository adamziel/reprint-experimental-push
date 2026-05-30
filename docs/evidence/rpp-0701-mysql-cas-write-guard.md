# RPP-0701 MySQL CAS write guard evidence

Evidence for RPP-0701. This slice implements the MySQL-style compare-and-swap
write guard benchmark for allowlisted row updates and reports runtime,
resources, and pass/fail gates from one command.

## Guard behavior

The benchmark builds single-statement `UPDATE` shapes for these MySQL row
surfaces:

- `wp_posts`
- `wp_options`
- `wp_postmeta`
- `wp_reprint_push_forms_lab`
- `wp_reprint_push_release_state`

Each shape uses null-safe `<=> ?` predicates for compared storage columns. The
`wp_postmeta` shape also carries a same-statement duplicate-key guard for the
logical `(post_id, meta_key)` key so ambiguous duplicate rows are rejected
instead of updating an arbitrary row.

For every surface the deterministic coverage exercises matching storage,
drifted storage, and absent storage. Matching storage yields one guarded row
update. Drifted or absent storage yields zero affected rows with
`stale-at-write` evidence. The postmeta duplicate-key case also yields zero
affected rows.

## Focused validation

Command:

- `node --test test/mysql-cas-write-guard-benchmark.test.js`

Result:

- 4 tests, 4 ok, 0 failed

Command:

- `npm run bench:mysql-cas-write-guard -- --iterations 5`

Result summary:

- `ok: true`
- mode: `deterministic-no-mysql-runtime`
- MySQL runtime capability recorded as unavailable because connection settings
  were not supplied; the local client probe returned a MariaDB-compatible
  `mysql` client
- duration: 72.495 ms
- guarded writes attempted: 80
- applied writes: 25
- stale-at-write rejections: 25
- absent-at-write rejections: 25
- duplicate-key rejections: 5
- unsafe multiple-match writes: 0
- gates: deterministic guard behavior, applied/stale outcomes,
  duplicate-key guard, single-statement CAS shapes, hash-only evidence, MySQL
  runtime capability recording, and runtime resource budget

## Redaction posture

The benchmark report stores table names, column names, counters, statuses, and
SHA-256 hashes only. It does not store row payloads, option values, post
content, meta values, connection strings, or credentials.
