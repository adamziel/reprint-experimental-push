# RPP-0721 MySQL CAS write guard variant 2 evidence

Evidence for RPP-0721. This slice is a support-only variant of the RPP-0701
MySQL compare-and-swap write guard proof. It proves the benchmark report
contract without requiring a live external MySQL service.

## Proof behavior

The standalone test `test/rpp-0721-mysql-cas-write-guard-v2.test.js` runs the
RPP-0701 benchmark with deterministic MySQL-unavailable runtime detection and
asserts that the JSON report exposes:

- runtime metadata: benchmark id, generated timestamp, duration, Node version,
  platform, architecture, CPU count, and redacted MySQL capability status;
- resource usage: heap, RSS, CPU, max RSS, guarded write counts, and SQL shape
  counts;
- pass/fail gates: deterministic guard behavior, applied/stale outcomes,
  duplicate-key guard, single-statement CAS shapes, hash-only evidence, MySQL
  capability recording, and runtime resource budget;
- stale-write refusal: every supported surface rejects drifted storage with
  zero affected rows and `stale-at-write` evidence;
- deterministic support evidence: all supported surfaces are exercised with
  matching, stale, absent, and duplicate-key cases where applicable; and
- hash-only evidence: storage observations are represented by SHA-256 hashes
  and shape hashes, with no fixture row payloads in the report.

The variant also runs the same benchmark with an intentionally impossible heap
budget. That proof keeps the deterministic MySQL-unavailable mode, leaves all
guard behavior gates passing, and shows the `runtime-resource-budget` gate
switching to `fail` with measured heap usage.

## Focused validation

Command:

- `node --check test/rpp-0721-mysql-cas-write-guard-v2.test.js`

Result:

- syntax check passed

Command:

- `node --test --test-name-pattern RPP-0721 test/rpp-0721-mysql-cas-write-guard-v2.test.js`

Result:

- 2 tests, 2 ok, 0 failed

Adjacent RPP-0701 validation:

- `node --check scripts/bench/mysql-cas-write-guard.js`
- `node --check test/mysql-cas-write-guard-benchmark.test.js`
- `node --test test/mysql-cas-write-guard-benchmark.test.js`

Result:

- syntax checks passed
- 7 tests, 7 ok, 0 failed

Bounded benchmark command:

- `npm run bench:mysql-cas-write-guard -- --iterations 5`

Observed summary:

- `ok: true`
- mode: `deterministic-no-mysql-runtime`
- guarded writes attempted: 80
- applied writes: 25
- stale-at-write rejections: 25
- absent-at-write rejections: 25
- duplicate-key rejections: 5
- unsafe multiple-match writes: 0
- gates: deterministic guard behavior, applied/stale outcomes, duplicate-key
  guard, single-statement CAS shapes, hash-only evidence, MySQL runtime
  capability recording, and runtime resource budget all passed

Artifact redaction scan:

- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0721-mysql-cas-write-guard-v2.md`

Result:

- `ok: true`, 1 scanned file, 0 rejected files

## Limits

This evidence is deterministic support evidence only. It does not claim live
production MySQL durability, external database rollback behavior, production
connection availability, or live CAS DML against a production-shaped MySQL
server. Final release status remains NO-GO until live production or external
durability evidence exists.

## Redaction posture

The benchmark report stores table names, column names, counts, statuses, and
SHA-256 hashes. It does not store row payloads, option values, post content,
meta values, connection strings, or credentials. Failed connection-probe output
is redacted before entering runtime evidence.
