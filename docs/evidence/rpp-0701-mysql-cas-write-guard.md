# RPP-0701 MySQL CAS write guard evidence

Evidence toward RPP-0701. The checklist item remains unchecked for the
integration lane. This slice adds a benchmark command for the MySQL-style
single-statement compare-and-swap write boundary used by guarded row updates.

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

## Sandbox MySQL capability

The validation run in this sandbox recorded the MySQL runtime as unavailable
because connection settings were not supplied. The exact unavailable capability
reported by the command was `mysql-runtime-connection-settings`; the local
client version probe returned a MariaDB-compatible `mysql` client. The benchmark
still ran deterministic guard coverage and recorded the unavailable capability
in the JSON report without exposing connection values.

## Redaction posture

The report stores table names, column names, counts, statuses, and SHA-256
hashes only. It does not store row payloads, option values, post content, meta
values, connection strings, or credentials.
