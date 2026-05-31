# RPP-0742 SQLite CAS write guard variant 3 evidence

Evidence for RPP-0742. This slice is support-only and extends the local
SQLite compare-and-swap write guard coverage added by RPP-0702 and RPP-0722.
Final release posture remains **NO-GO** unless production-backed storage and
external durability evidence exist.

## Proof scope

The focused test uses local in-memory `node:sqlite` databases only. It does not
use remote endpoints, tunnels, production data, bearer tokens, or raw private
values.

Covered boundary:

- boundary: `sqlite-single-statement-cas`
- adapter: `sqlite-single-statement-cas`
- operation: single `UPDATE` with null-safe `IS ?` compared-column predicates
- surfaces: `wp_posts`, `wp_options`, `wp_postmeta`,
  `wp_reprint_push_forms_lab`, and `wp_reprint_push_release_state`

Variant 3 generates stale storage cases for every non-key compared column on
each covered surface. For each generated stale state, the proof asserts:

- the guarded write is rejected with `applied: false`
- the write reports zero affected rows
- the storage guard outcome is `stale-at-write`
- the existing stale row remains unchanged
- observed storage evidence is represented by a SHA-256 hash only

The proof also covers stale replay after a successful guarded write and absent
storage. A matching write applies exactly once, then replaying the old expected
state is rejected and leaves the committed row unchanged. Absent storage is
rejected without inserting a row.

## Local performance proof

Variant 3 runs the existing SQLite CAS benchmark API with fixed local inputs:

- iterations: 4
- expected guarded writes: `surfaces * iterations * 3`
- expected applied writes: `surfaces * iterations`
- expected stale-at-write rejections: `surfaces * iterations`
- expected absent-at-write rejections: `surfaces * iterations`
- expected unsafe multiple-match writes: 0
- expected in-memory databases opened: one per attempted guarded write

The benchmark gates must all pass for the local proof:

- SQLite runtime available
- deterministic guard behavior
- applied and stale outcomes
- single-statement null-safe CAS shapes
- hash-only evidence
- runtime resource budget

This is support-only performance evidence. It does not establish production
latency, production durability, cross-process locking behavior, external
database persistence, or recovery behavior under live traffic.

## Redaction posture

Storage guard evidence is limited to logical table names, column lists,
outcomes, row counts, SQL shape hashes, and SHA-256 hashes for expected,
planned, and observed state. The proof excludes row payloads, option values,
post content, meta values, serialized private values, credentials, bearer
tokens, external URLs, and raw private data.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0742-sqlite-cas-write-guard-v3.test.js`
- `node --test --test-name-pattern RPP-0742 test/rpp-0742-sqlite-cas-write-guard-v3.test.js`
- `node --test --test-name-pattern RPP-0722 test/rpp-0722-sqlite-cas-write-guard-v2.test.js`
- `node --test test/sqlite-cas-write-guard-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0742-sqlite-cas-write-guard-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed local result:

- RPP-0742 proof test: 3 pass, 0 fail
- RPP-0722 adjacent proof test: 2 pass, 0 fail
- SQLite CAS benchmark test: 3 pass, 0 fail
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
