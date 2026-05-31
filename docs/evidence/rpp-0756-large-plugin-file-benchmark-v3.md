# RPP-0756 large plugin file benchmark variant 3 evidence

Evidence for RPP-0756. This slice is deterministic local support-only coverage
for the large plugin file benchmark, variant 3. Final release remains
**NO-GO** because this proof does not include live production storage receipts,
production remote throughput, production row batch execution, production atomic
group commit evidence, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0756-large-plugin-file-benchmark-v3.test.js` builds on the RPP-0716
large plugin file benchmark and the RPP-0736 variant 2 proof pattern. It
exercises the unit benchmark profile with 4 plugin files, 8 chunk receipts,
8 guarded filesystem writes, and a 32 KiB chunk size.

Variant 3 asserts:

- the benchmark command emits parseable JSON with `runtime`, `resources`, and
  pass/fail `gates`;
- generated coverage is recorded as counts and hashes only;
- generated coverage matches the benchmark workload, chunk receipt, filesystem
  evidence, and command gate counts;
- staged and committed filesystem writes match expected guarded write counts;
- chunk receipts cover the full plugin-file byte set exactly once;
- plugin files remain invisible until the atomic group commit;
- fsync evidence gates pass before the fast-path lane is considered updated;
- runtime, heap, and upload backpressure budgets are reported and respected;
- public storage-performance evidence is deterministic across repeated local
  runs; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed benchmark summary

Focused benchmark-command summary from this sandbox:

- command: `node scripts/bench/large-plugin-file-benchmark.js --profile=unit --chunk-size-bytes=32768 --max-duration-ms=5000 --max-heap-used-bytes=134217728`
- command report shape: runtime present, resources present, gates present
- command object order: runtime before resources before gates
- gate status vector: 10 pass, 0 fail
- plugin files: 4
- total plugin file bytes: 229376
- largest plugin file bytes: 131072
- chunk receipts: 8
- staged writes: 4
- committed writes: 4
- guarded writes: 8
- storage evidence samples: 8
- chunk receipt samples: 8
- group finalize records: 1
- atomic group commits: 1
- live-visible bytes before commit: 0
- live-visible bytes after commit: 229376
- raw value evidence leaks: 0

The benchmark command reported the runtime resource budget gate and all other
benchmark gates as `pass`.

## Variant 3 gates

The focused proof recomputes this gate vector before emitting generated
coverage and storage evidence:

1. `benchmark-command-reports-runtime-resources-gates`
2. `generated-large-plugin-coverage-complete`
3. `complete-storage-performance-report`
4. `chunk-receipts-cover-large-plugin-files`
5. `atomic-group-visibility-order`
6. `filesystem-fsync-before-fast-path-lane`
7. `backpressure-runtime-resource-budget`
8. `deterministic-storage-performance-evidence`
9. `hash-count-only-storage-performance-evidence`
10. `support-only-release-no-go`

Output is emitted only after all ten gates are recorded and passing.

## Generated coverage projection

Generated coverage stores:

- source benchmark identifiers and variant lineage;
- workload counts and byte counts;
- command report shape booleans;
- pass/fail gate counts;
- file hash counts;
- storage evidence sample counts;
- chunk receipt sample counts;
- hash-set hashes for generated workload, files, storage evidence, and chunk
  receipts; and
- the generated coverage hash.

It does not store plugin payload bytes, logical plugin paths, absolute
filesystem paths, live service configuration, credentials, cookies, or private
site values.

## Negative coverage

The focused proof mutates otherwise passing local evidence and verifies
fail-closed behavior:

- incomplete generated storage coverage reduces the generated storage evidence
  sample count and blocks on `generated-large-plugin-coverage-complete`;
- incomplete receipt evidence reduces the observed receipt set and blocks on
  `chunk-receipts-cover-large-plugin-files`;
- pre-commit visibility evidence marks live bytes visible before the atomic
  group commit and blocks on `atomic-group-visibility-order`;
- failed fsync evidence changes a sample fsync status and blocks on
  `filesystem-fsync-before-fast-path-lane`; and
- premature pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`.

All unsafe decisions suppress output and record deterministic decision hashes.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch execution is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim production storage durability, production throughput,
release approval, rollout safety, or final release readiness.

## Redaction posture

Emitted evidence is hash/count-only. It stores counts, pass/fail status counts,
budget presence, storage hashes, receipt hashes, sample hashes, and decision
hashes. It does not store plugin file payload bytes, raw fixture tokens, logical
plugin paths, absolute filesystem paths, live service configuration,
credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0756-large-plugin-file-benchmark-v3.test.js`
- `node --test --test-name-pattern RPP-0756 test/rpp-0756-large-plugin-file-benchmark-v3.test.js`
- `node --test --test-name-pattern RPP-0736 test/rpp-0736-large-plugin-file-benchmark-v2.test.js`
- `node --test test/large-plugin-file-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0756-large-plugin-file-benchmark-v3.md`
- `git diff --check`

Observed focused proof result before commit:

- RPP-0756 syntax check: exit 0
- RPP-0756 proof test: 2 pass, 0 fail
- Adjacent RPP-0736 proof test: 2 pass, 0 fail
- Adjacent RPP-0716 large plugin file benchmark test: 5 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
