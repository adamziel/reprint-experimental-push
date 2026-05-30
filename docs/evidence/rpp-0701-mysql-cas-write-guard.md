# RPP-0701 MySQL CAS Write Guard Evidence

Evidence for RPP-0701. This slice implements the MySQL-style single-statement
compare-and-swap write boundary used by guarded row updates and records a
benchmark report with runtime, resource usage, and pass/fail gates.

## Command

- `npm run bench:mysql-cas-write-guard`

The command emits JSON with:

- runtime: elapsed milliseconds, Node/platform metadata, CPU count, and MySQL
  runtime capability status;
- resources: process memory/CPU counters, guarded write totals, logical table
  coverage, compared columns, and SQL shape hashes;
- gates: deterministic guard behavior, applied/stale outcomes, single-statement
  SQL shape checks, hash-only evidence checks, MySQL capability recording, and
  resource-budget checks.

## Guard behavior covered

The deterministic benchmark exercises each allowlisted MySQL row surface:

- `wp_posts`
- `wp_options`
- `wp_postmeta`
- `wp_reprint_push_forms_lab`
- `wp_reprint_push_release_state`

For every surface it runs matching-storage, drifted-storage, and absent-storage
cases. Matching storage yields one guarded row update. Drifted or absent storage
yields zero affected rows with `stale-at-write` evidence and leaves the fixture
row unchanged.

## Focused Validation

Command:

- `node --test test/mysql-cas-write-guard-benchmark.test.js`

Result:

- 6 tests, 6 ok, 0 failed

The focused test covers deterministic guard behavior, single-statement SQL
shapes, hash-only storage evidence, missing connection settings, redacted
connection-probe failure evidence, and a redacted successful probe path that
explicitly states it did not run live CAS DML.

Command:

- `npm run bench:mysql-cas-write-guard -- --iterations 5`

Result summary:

- `ok: true`
- mode: `deterministic-no-mysql-runtime`
- guarded writes attempted: 75
- applied writes: 25
- stale-at-write rejections: 25
- absent-at-write rejections: 25
- gates: deterministic guard behavior, applied/stale outcomes,
  single-statement CAS shapes, hash-only evidence, MySQL runtime capability
  recording, and runtime resource budget

## Sandbox MySQL capability

The validation run in this sandbox recorded the MySQL runtime as unavailable.
The local client probe returned `mysql  Ver 15.1 Distrib 10.11.13-MariaDB, for
Linux (x86_64) using readline 5.1`, but no connection settings were supplied.
The exact unavailable capability reported by the command was
`mysql-runtime-connection-settings`; the exact detail was
`REPRINT_PUSH_MYSQL_CAS_DSN or (REPRINT_PUSH_MYSQL_CAS_HOST or
REPRINT_PUSH_MYSQL_CAS_SOCKET) with REPRINT_PUSH_MYSQL_CAS_DATABASE and
REPRINT_PUSH_MYSQL_CAS_USER not set`.

Because the sandbox did not provide MySQL connection settings, the benchmark did
not run a connection probe against a server and did not run live MySQL CAS DML.
The evidence is deterministic configuration/error-path and fixture-row guard
coverage only, with no live MySQL proof claimed.

## Redaction posture

The report stores table names, column names, counts, statuses, and SHA-256
hashes only. It does not store row payloads, option values, post content, meta
values, connection strings, or credentials. Failed connection-probe output is
redacted before it can enter runtime evidence.
