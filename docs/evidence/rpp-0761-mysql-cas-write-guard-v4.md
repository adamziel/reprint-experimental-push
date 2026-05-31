# RPP-0761 MySQL CAS write guard variant 4 evidence

Evidence for RPP-0761. This slice is support-only storage/performance proof for
the RPP-0701 MySQL compare-and-swap write guard benchmark, variant 4. Final
release remains **NO-GO** because this proof does not include production-backed
MySQL storage durability, production connection availability, live CAS DML, or
release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0761-mysql-cas-write-guard-v4.test.js` runs the benchmark command
through Node with `REPRINT_PUSH_MYSQL_CAS_*` connection settings unset. It
asserts that the emitted JSON report contains:

- runtime metadata: benchmark id, generated timestamp, duration, Node version,
  platform, architecture, CPU count, and redacted MySQL capability status;
- process resources: RSS, heap, heap delta, external memory, array buffers,
  user CPU, system CPU, and max RSS;
- storage resources: guarded write counts, applied writes, stale-at-write
  refusals, absent-at-write refusals, duplicate-key refusals, unsafe
  multiple-match count, and compared columns by table;
- SQL resources: five single-statement `UPDATE` shapes with null-safe
  predicates and hash-only shape evidence; and
- pass/fail gates: deterministic guard behavior, applied/stale outcomes,
  duplicate-key guard, single-statement CAS shapes, hash-only evidence, MySQL
  runtime capability recording, and runtime resource budget.

The variant 4 proof also projects a local support-only storage/performance
evidence object with:

- `supportOnly: true`
- `productionBacked: false`
- `finalReleaseStatus: NO-GO`
- `integrationRecommendation: NO-GO`
- production storage durability: `not-claimed`

## Observed benchmark summary

Benchmark command, run with MySQL connection settings unset:

- `env -i PATH="$PATH" LC_ALL=C LANG=C node scripts/bench/mysql-cas-write-guard.js --iterations 6 --max-duration-ms 5000 --max-heap-used-bytes 268435456`

Observed report summary from this sandbox:

- `ok: true`
- mode: `deterministic-no-mysql-runtime`
- generated at: `2026-05-29T00:00:00.000Z`
- duration: `28.073 ms` within the `5000 ms` budget
- runtime: Node `v22.20.0`, linux x64, 6 CPUs
- MySQL runtime: unavailable with capability
  `mysql-runtime-connection-settings`
- heap used: `5292120 bytes` within the `268435456 bytes` budget
- RSS: `58269696 bytes`
- heap delta: `-20064 bytes`
- CPU: `19.761 ms user`, `3.438 ms system`
- max RSS: `56904 KiB`
- guarded writes attempted: `96`
- applied writes: `30`
- stale-at-write refusals: `30`
- absent-at-write refusals: `30`
- duplicate-key refusals: `6`
- unsafe multiple-match writes: `0`
- SQL single-statement shapes: `5`
- evidence samples: `10`

The benchmark command reported all seven benchmark gates as `pass`:

- `deterministic-guard-behavior`
- `applied-and-stale-outcomes`
- `duplicate-key-guard`
- `single-statement-cas-shapes`
- `hash-only-evidence`
- `mysql-runtime-capability-recorded`
- `runtime-resource-budget`

## Variant 4 support gates

The focused proof recomputes a support-only gate vector from the command report:

1. `benchmark-command-reports-runtime-resources-gates`
2. `complete-storage-performance-report`
3. `deterministic-cas-storage-guard-coverage`
4. `hash-only-storage-performance-evidence`
5. `support-only-release-no-go`

All five gates must pass before the local storage/performance proof is accepted.
The proof keeps release posture and integration recommendation at `NO-GO`
because no production-backed MySQL evidence exists.

## Fail-gate coverage

The focused test also runs the benchmark command with an impossible
`--max-heap-used-bytes 1` budget. That command exits non-zero while still
emitting runtime metadata, resource usage, storage counts, SQL shape counts, and
the full pass/fail gate vector.

Fail-gate benchmark command, run with MySQL connection settings unset:

- `env -i PATH="$PATH" LC_ALL=C LANG=C node scripts/bench/mysql-cas-write-guard.js --iterations 2 --max-duration-ms 5000 --max-heap-used-bytes 1`

Observed fail-gate summary:

- `ok: false`
- mode: `deterministic-no-mysql-runtime`
- duration: `28.33 ms`
- heap used: `5556736 bytes`
- max heap budget: `1 byte`
- `runtime-resource-budget`: `fail`
- all other benchmark gates: `pass`

This proves the command reports fail gates without suppressing the runtime and
resource evidence needed to diagnose the failure.

## Limits

This evidence is deterministic local support evidence only. It does not claim
live production MySQL durability, external database rollback behavior,
production connection availability, live CAS DML against a production-shaped
MySQL server, production throughput, or release approval. Final release status
remains `NO-GO` until production-backed evidence exists.

## Redaction posture

The benchmark report stores table names, column names, counts, statuses, budget
values, and SHA-256 hashes. It does not store row payloads, option values, post
content, meta values, connection strings, credentials, bearer tokens, external
URLs, or raw private values. Failed connection-probe output is redacted before
entering runtime evidence.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0761-mysql-cas-write-guard-v4.test.js`
- `node --test --test-name-pattern RPP-0761 test/rpp-0761-mysql-cas-write-guard-v4.test.js`
- `node --test --test-name-pattern RPP-0741 test/rpp-0741-mysql-cas-write-guard-v3.test.js`
- `node --test --test-name-pattern RPP-0721 test/rpp-0721-mysql-cas-write-guard-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0761-mysql-cas-write-guard-v4.md`
- `git diff --check`

Observed focused proof result before commit:

- `node --check test/rpp-0761-mysql-cas-write-guard-v4.test.js`: exit 0
- RPP-0761 proof test: 2 pass, 0 fail
- RPP-0741 proof test: 2 pass, 0 fail
- RPP-0721 proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
