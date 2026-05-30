# RPP-0716 large plugin file benchmark evidence

Evidence for RPP-0716. This slice adds a focused benchmark command for large
plugin files that must be staged, receipted, and committed through an atomic
plugin group boundary before becoming visible at their live plugin paths.

## Benchmark behavior

Command:

- `node scripts/bench/large-plugin-file-benchmark.js --profile=large-site`

The JSON report emits:

- runtime: elapsed milliseconds, Node/platform metadata, CPU count, and the
  documented runtime and heap budgets;
- resources: plugin file counts and bytes, chunk receipt counts, bounded
  in-flight upload bytes, filesystem fsync guarded writes, live precondition
  checks, group finalize records, atomic group commits, temp cleanup, and
  process CPU/memory counters;
- gates: deterministic workload, chunk receipt coverage, invisible plugin files
  before group commit, live precondition rechecks at group finalize, all-files
  atomic group commit visibility, filesystem fsync correctness before fast-path
  lane updates, backpressure budget bounds, temp cleanup, hash-only evidence,
  and runtime resource budget.

## Large-site budget run

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `6007.18 ms` within the documented `15000 ms` budget
- heap used: `9452872 bytes` within the documented `268435456 bytes` budget
- plugin files: `5`
- total plugin file bytes: `19922944`
- largest plugin file: `12582912 bytes`
- chunk receipts: `6`
- staged writes: `5`
- committed writes: `5`
- group finalize records: `1`
- atomic group commits: `1`
- live-visible bytes before commit: `0`
- live-visible bytes after commit: `19922944`
- temp leaks: `0`

All benchmark gates reported `pass`.

## Focused validation

Command:

- `node --test test/large-plugin-file-benchmark.test.js`

Result:

- 5 tests, 5 ok, 0 failed

## Redaction posture

Storage and chunk receipt evidence stores logical filesystem paths only where
the filesystem guard already exposes them, plus SHA-256 hashes, counts, byte
ranges, statuses, and idempotency key hashes. It does not store plugin file
payload bytes, raw fixture tokens, absolute paths, credentials, or private site
values.

## Limits

This is local benchmark evidence for plugin file staging, receipts, fsync-backed
guarded writes, and atomic group visibility. It does not claim production remote
storage receipts, production network throughput, dependency solver correctness,
plugin activation behavior, or release-verifier carry-through.
