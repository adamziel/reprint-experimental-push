# RPP-0796 large plugin file benchmark release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0796 large plugin file benchmark release-verifier carry-through, variant 5
Checklist item: RPP-0796 - Carry through the release verifier for large plugin file benchmark, variant 5.

## Scope

This slice carries the RPP-0776 large plugin file benchmark variant 4 support
proof into a deterministic local release-verifier envelope. It runs the
existing RPP-0716 benchmark command with the unit workload and verifies that
the command reports runtime metadata, resource usage, and pass/fail gate
statuses before verifier output is accepted.

The proof remains support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, live
production service behavior, production throughput, release approval, or
rollout safety. Final release status and integration recommendation remain
**NO-GO**.

## Proof surface

`test/rpp-0796-large-plugin-file-benchmark-release-verifier-v5.test.js`
verifies the local release-verifier carry-through for:

- RPP-0776 variant 4 as the built-on proof;
- RPP-0716 as the source large plugin file benchmark;
- RPP-0756 variant 3 as the previous support variant;
- command output containing `runtime`, `resources`, and pass/fail `gates`;
- the command object order: `runtime` before `resources`, and `resources`
  before `gates`;
- the runtime resource budget gate present and passing in the support run;
- unit workload counts: 4 plugin files, 229376 plugin-file bytes, 8 chunk
  receipts, 8 guarded writes, 4 staged writes, and 4 committed writes;
- atomic group visibility: no live-visible bytes before commit and all bytes
  visible after commit;
- fsync-backed fast-path lane updates only after gates pass;
- deterministic hash/count-only projections across repeated local runs; and
- final release and integration recommendation fixed at `NO-GO`.

## Benchmark command

The passing verifier run uses:

```sh
node scripts/bench/large-plugin-file-benchmark.js --profile=unit --chunk-size-bytes=32768 --max-duration-ms=5000 --max-heap-used-bytes=134217728
```

The command emits a JSON report with:

- `runtime`: generated timestamp, duration, Node/platform metadata, CPU count,
  and runtime/resource budgets;
- `resources`: workload counts, storage write counts, chunk receipt counts,
  atomic group counts, process CPU/memory counters, temp leak count, and
  runtime budget echo; and
- `gates`: 10 pass/fail benchmark gates.

The support run requires all 10 gates to pass, including
`runtime-resource-budget`.

## Fail-gate coverage

The focused fail-gate run uses an impossible heap budget:

```sh
node scripts/bench/large-plugin-file-benchmark.js --profile=unit --chunk-size-bytes=32768 --max-duration-ms=5000 --max-heap-used-bytes=1
```

That command still emits runtime metadata, resource counters, and the full
pass/fail gate vector. The only expected failed gate is
`runtime-resource-budget`; the deterministic workload, chunk receipts, atomic
group visibility, fsync, temp cleanup, and hash-only gates remain passing. The
fail-gate projection also remains support-only with final release `NO-GO`.

## Release-verifier gates

The proof recomputes this gate vector before emitting hash/count-only output:

1. `release-verifier-benchmark-command-reports-runtime-resources-gates`
2. `release-verifier-benchmark-command-pass-fail-statuses-only`
3. `runtime-resource-budget-reported-and-passing`
4. `built-on-large-plugin-file-benchmark-v4`
5. `workload-resource-counts-carried-through`
6. `storage-receipts-atomic-group-carried-through`
7. `deterministic-hash-count-only-release-verifier-evidence`
8. `support-only-release-no-go`

All eight gates must be recorded and passing before output is accepted.

## Negative coverage

The focused proof mutates otherwise passing local evidence and verifies
fail-closed release-verifier behavior:

- missing runtime reporting blocks on
  `release-verifier-benchmark-command-reports-runtime-resources-gates`;
- missing resource reporting blocks on the same gate;
- missing pass/fail gate reporting blocks on the same gate;
- a non-pass/fail gate status blocks on
  `release-verifier-benchmark-command-pass-fail-statuses-only`;
- a failed runtime resource gate blocks on
  `runtime-resource-budget-reported-and-passing`;
- stale built-on variant metadata blocks on
  `built-on-large-plugin-file-benchmark-v4`;
- raw value leakage blocks on
  `deterministic-hash-count-only-release-verifier-evidence`;
- a production `GO` claim blocks on `support-only-release-no-go`; and
- premature passed status without recorded gates blocks on
  `correctness-gates-not-recorded`.

All unsafe decisions suppress output and record deterministic decision hashes.

## Redaction posture

The RPP-0796 public verifier projection stores counts, byte totals, pass/fail
status counts, budget values, storage hashes, chunk receipt hashes, file hash
counts, storage evidence sample counts, chunk receipt sample counts, output
hashes, and decision hashes. It does not store plugin file payload bytes, raw
fixture tokens, logical plugin paths, absolute filesystem paths, live service
configuration, credentials, cookies, bearer values, or private site values.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- `releaseEligible: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch executor is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `support-only-local-release-verifier`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0796-large-plugin-file-benchmark-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0796 test/rpp-0796-large-plugin-file-benchmark-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0776 test/rpp-0776-large-plugin-file-benchmark-v4.test.js
node --test --test-name-pattern RPP-0756 test/rpp-0756-large-plugin-file-benchmark-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0796-large-plugin-file-benchmark-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0796-large-plugin-file-benchmark-release-verifier-v5.test.js`: exit 0
- RPP-0796 proof test: 3 pass, 0 fail
- RPP-0776 adjacent large plugin file variant 4 test: 2 pass, 0 fail
- RPP-0756 adjacent large plugin file variant 3 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration recommendation

Integration recommendation: **NO-GO**.

This evidence is deterministic local release-verifier support evidence only.
Production-backed storage receipts, row batch executor evidence, atomic group
commit evidence, live production service evidence, and release approval remain
required for promotion.
