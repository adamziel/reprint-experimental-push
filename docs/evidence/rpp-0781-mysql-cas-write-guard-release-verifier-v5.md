# RPP-0781 MySQL CAS write guard release verifier variant 5 evidence

Date: 2026-05-31
Lane: RPP-0781 MySQL compare-and-swap write guard release verifier carry-through, variant 5
Checklist item: RPP-0781 - Carry through release verifier for MySQL compare-and-swap write guard, variant 5.

## Scope

This slice carries the existing RPP-0701 MySQL compare-and-swap write guard
benchmark into deterministic local release-verifier support evidence. The proof
asserts that the benchmark command reports runtime, process and storage
resources, SQL shape resources, and explicit pass/fail gates.

The proof is support-only. It does not include live production MySQL durability,
production connection availability, live CAS DML against a production-shaped
MySQL server, production throughput, or external release approval. A scoped
search found no existing live production-backed MySQL CAS gate evidence in this
checkout, so final release posture and integration recommendation remain
**NO-GO**.

## Proof surface

`test/rpp-0781-mysql-cas-write-guard-release-verifier-v5.test.js` runs
`scripts/bench/mysql-cas-write-guard.js` through Node with
`REPRINT_PUSH_MYSQL_CAS_*` connection settings unset. It verifies:

- runtime metadata: benchmark id, generated timestamp, duration, Node version,
  platform, architecture, CPU count, and redacted MySQL capability status;
- process resources: RSS, heap, heap delta, external memory, array buffers,
  user CPU, system CPU, and max RSS;
- storage resources: guarded write counts, applied writes, stale-at-write
  refusals, absent-at-write refusals, duplicate-key refusals, unsafe
  multiple-match count, and compared columns by table;
- SQL resources: five single-statement `UPDATE` shapes with null-safe
  predicates and hash-only shape evidence;
- pass/fail benchmark gates: deterministic guard behavior, applied/stale
  outcomes, duplicate-key guard, single-statement CAS shapes, hash-only
  evidence, MySQL runtime capability recording, and runtime resource budget; and
- release-verifier support evidence with `supportOnly: true`,
  `productionBacked: false`, `releaseEligible: false`, final release status
  `NO-GO`, and integration recommendation `NO-GO`.

## Observed pass-gate benchmark summary

Benchmark command, run with MySQL connection settings unset:

```sh
env -i PATH="$PATH" LC_ALL=C LANG=C node scripts/bench/mysql-cas-write-guard.js --iterations 7 --max-duration-ms 5000 --max-heap-used-bytes 268435456
```

Observed report summary from this sandbox:

- exit status: `0`
- `ok: true`
- mode: `deterministic-no-mysql-runtime`
- generated at: `2026-05-29T00:00:00.000Z`
- duration: `38.974 ms` within the `5000 ms` budget
- runtime: Node `v22.20.0`, linux x64, 6 CPUs
- MySQL runtime: unavailable with capability
  `mysql-runtime-connection-settings`
- heap used: `5673720 bytes` within the `268435456 bytes` budget
- RSS: `65118208 bytes`
- heap delta: `361536 bytes`
- CPU: `30.964 ms user`, `3.688 ms system`
- max RSS: `63592 KiB`
- guarded writes attempted: `112`
- applied writes: `35`
- stale-at-write refusals: `35`
- absent-at-write refusals: `35`
- duplicate-key refusals: `7`
- unsafe multiple-match writes: `0`
- SQL single-statement shapes: `5`
- evidence samples: `10`

The pass-gate run reported all seven benchmark gates as `pass`:

- `deterministic-guard-behavior`
- `applied-and-stale-outcomes`
- `duplicate-key-guard`
- `single-statement-cas-shapes`
- `hash-only-evidence`
- `mysql-runtime-capability-recorded`
- `runtime-resource-budget`

## Variant 5 release-verifier support gates

The focused proof recomputes a local release-verifier support gate vector from
the command report:

1. `release-verifier-benchmark-command-reports-runtime-resources-gates`
2. `complete-storage-performance-report`
3. `deterministic-cas-storage-guard-coverage`
4. `hash-only-release-verifier-evidence`
5. `support-only-release-no-go`

All five support gates pass before the local release-verifier proof is
accepted. The proof keeps release posture and integration recommendation at
`NO-GO` because no production-backed MySQL CAS evidence exists.

## Fail-gate coverage

The focused test also runs the benchmark command with an impossible
`--max-heap-used-bytes 1` budget. That command exits non-zero while still
emitting runtime metadata, resource usage, storage counts, SQL shape counts, and
the full pass/fail gate vector.

Fail-gate benchmark command, run with MySQL connection settings unset:

```sh
env -i PATH="$PATH" LC_ALL=C LANG=C node scripts/bench/mysql-cas-write-guard.js --iterations 2 --max-duration-ms 5000 --max-heap-used-bytes 1
```

Observed fail-gate summary:

- exit status: `1`
- `ok: false`
- mode: `deterministic-no-mysql-runtime`
- duration: `29.777 ms`
- heap used: `5561480 bytes`
- max heap budget: `1 byte`
- guarded writes attempted: `32`
- applied writes: `10`
- stale-at-write refusals: `10`
- absent-at-write refusals: `10`
- duplicate-key refusals: `2`
- unsafe multiple-match writes: `0`
- SQL single-statement shapes: `5`
- evidence samples: `10`
- `runtime-resource-budget`: `fail`
- all other benchmark gates: `pass`

This proves the command reports fail gates without suppressing the runtime and
resource evidence needed to diagnose the failure.

## Redaction posture

The benchmark and release-verifier support proof store table names, column
names, counts, statuses, budget values, and SHA-256 hashes. They do not store
row payloads, option values, post content, meta values, connection strings,
credentials, bearer tokens, external URLs, or raw private values. Failed
connection-probe output is redacted before entering runtime evidence.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0781-mysql-cas-write-guard-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0781 test/rpp-0781-mysql-cas-write-guard-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0761 test/rpp-0761-mysql-cas-write-guard-v4.test.js
node --test --test-name-pattern RPP-0741 test/rpp-0741-mysql-cas-write-guard-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0781-mysql-cas-write-guard-release-verifier-v5.md
git diff --check
```

Observed validation result before commit:

- `node --check test/rpp-0781-mysql-cas-write-guard-release-verifier-v5.test.js`: exit 0
- RPP-0781 proof test: 2 pass, 0 fail
- RPP-0761 proof test: 2 pass, 0 fail
- RPP-0741 proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Release recommendation

Integration recommendation: **NO-GO**.

This evidence is deterministic local release-verifier support evidence only. It
does not prove live production MySQL storage durability or production release
eligibility.
