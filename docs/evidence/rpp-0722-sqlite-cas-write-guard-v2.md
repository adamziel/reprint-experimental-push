# RPP-0722 SQLite CAS write guard variant 2 evidence

Evidence for RPP-0722. This slice is support-only and builds on the RPP-0702
SQLite compare-and-swap write guard. Final release remains **NO-GO** unless
live production and external durability evidence exist.

## Proof scope

The standalone proof test covers the existing SQLite guarded write boundary:

- boundary: `sqlite-single-statement-cas`
- adapter: `sqlite-single-statement-cas`
- runtime: local in-memory `node:sqlite`
- surfaces: `wp_posts`, `wp_options`, `wp_postmeta`,
  `wp_reprint_push_forms_lab`, and `wp_reprint_push_release_state`

For each surface, variant 2 asserts:

- a matching expected storage state applies with exactly one affected row
- replaying the old expected state after a successful guarded write is refused
- independently drifted storage is refused with zero affected rows
- absent storage is refused with zero affected rows and no inserted row
- guard evidence remains hash-only and excludes fixture payload values

## Benchmark gates

The proof also runs the RPP-0702 SQLite benchmark API with fixed inputs to
verify deterministic gate status behavior:

- generous local budgets produce the same all-pass gate vector on repeated runs
- an intentionally impossible heap budget fails only `runtime-resource-budget`
- guarded write counts remain bounded by `surfaces * iterations * 3`
- opened in-memory database counts match the attempted write count
- runtime evidence records process resource counters and SQLite availability
  without adding production, external, or network durability claims

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0722-sqlite-cas-write-guard-v2.test.js`
- `node --test test/rpp-0722-sqlite-cas-write-guard-v2.test.js`
- `node --test test/sqlite-cas-write-guard.test.js test/sqlite-cas-write-guard-benchmark.test.js`
- `npm run bench:sqlite-cas-write-guard -- --iterations 5`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0722-sqlite-cas-write-guard-v2.md`
- `git diff --check`

Observed result after local validation:

- RPP-0722 proof test: 2 pass, 0 fail
- Adjacent RPP-0702 SQLite tests: 6 pass, 0 fail
- Bounded benchmark with 5 iterations: `ok: true`
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
