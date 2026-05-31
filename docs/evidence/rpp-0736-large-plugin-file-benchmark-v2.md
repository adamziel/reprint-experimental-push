# RPP-0736 large plugin file benchmark variant 2 evidence

Evidence for RPP-0736. This slice is support-only and builds on the RPP-0716
large plugin file benchmark. Final release remains **NO-GO** because this proof
does not supply live production storage receipts, production remote throughput,
production row batch execution, production atomic group commit evidence, or
release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0736-large-plugin-file-benchmark-v2.test.js` exercises the existing
large plugin file benchmark and its CLI report with the unit profile, 4 plugin
files, 8 chunk receipts, and a 32 KiB chunk size.

Variant 2 asserts:

- the benchmark command emits parseable JSON with `runtime`, `resources`, and
  pass/fail `gates`;
- staged and committed filesystem writes match the expected guarded write
  counts;
- chunk receipts cover the full plugin-file byte set exactly once;
- plugin files remain invisible at live paths until the atomic group commit;
- fsync evidence gates pass before the fast-path lane is considered updated;
- runtime, heap, and upload backpressure budgets are reported and respected;
- public storage-performance evidence is hash-only and deterministic across
  repeated local runs; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed benchmark summary

Focused benchmark-command summary from this sandbox:

- command: `node scripts/bench/large-plugin-file-benchmark.js --profile=unit --chunk-size-bytes=32768 --max-duration-ms=5000 --max-heap-used-bytes=134217728`
- `ok: true`
- plugin files: `4`
- total plugin file bytes: `229376`
- largest plugin file: `131072 bytes`
- chunk receipts: `8`
- staged writes: `4`
- committed writes: `4`
- group finalize records: `1`
- atomic group commits: `1`
- live-visible bytes before commit: `0`
- live-visible bytes after commit: `229376`
- duration: `166.58 ms` within the `5000 ms` budget
- heap used: `5850656 bytes` within the `134217728 bytes` budget
- RSS: `70344704 bytes`
- CPU: `93.14 ms user`, `11.76 ms system`

The benchmark command reported all gates as `pass`:

- `deterministic-plugin-file-workload`
- `chunk-receipts-cover-large-plugin-files`
- `plugin-files-invisible-before-group-commit`
- `group-finalize-rechecks-live-preconditions`
- `atomic-group-commit-publishes-all-plugin-files`
- `filesystem-fsync-gates-before-fast-path-lane`
- `backpressure-budgets-bound-in-flight-plugin-bytes`
- `temp-cleanup`
- `hash-only-evidence`
- `runtime-resource-budget`

## Variant 2 gates

The RPP-0736 proof recomputes this gate vector from the hash-only
storage-performance projection before emitting output:

1. `benchmark-command-reports-runtime-resources-gates`
2. `complete-storage-performance-report`
3. `chunk-receipts-cover-large-plugin-files`
4. `atomic-group-visibility-order`
5. `filesystem-fsync-before-fast-path-lane`
6. `backpressure-runtime-resource-budget`
7. `deterministic-storage-performance-evidence`
8. `hash-only-storage-performance-evidence`
9. `support-only-release-no-go`

The output is emitted only after all nine gates pass. If evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Negative coverage

The focused proof mutates otherwise passing storage-performance evidence and
verifies fail-closed behavior:

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
release approval, or live-site rollout safety. It proves only local benchmark
report shape, local storage/chunk/atomic-group gates, budget reporting, hash-only
public evidence, and fail-closed stale or incomplete evidence behavior.

## Redaction posture

The variant 2 public proof projection stores counts, byte totals, gate status
vectors, budget values, storage hashes, receipt hashes, sample hashes, and
decision hashes. It does not store plugin file payload bytes, raw fixture
tokens, logical plugin paths, absolute filesystem paths, live service
configuration, credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0736-large-plugin-file-benchmark-v2.test.js`
- `node --test --test-name-pattern RPP-0736 test/rpp-0736-large-plugin-file-benchmark-v2.test.js`
- `node --test test/large-plugin-file-benchmark.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0736-large-plugin-file-benchmark-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result:

- RPP-0736 proof test: 2 pass, 0 fail
- Adjacent RPP-0716 large plugin file benchmark test: 5 pass, 0 fail
- Adjacent RPP-0732 dry-run batch sizing proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
