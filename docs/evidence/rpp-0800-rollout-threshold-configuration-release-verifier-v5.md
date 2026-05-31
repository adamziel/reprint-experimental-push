# RPP-0800 rollout threshold configuration release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0800 rollout threshold configuration release-verifier carry-through, variant 5
Checklist item: RPP-0800 - Carry through the release verifier for rollout threshold configuration, variant 5.

## Scope

This slice carries the RPP-0780 rollout threshold configuration variant 4
support proof into a deterministic local release-verifier envelope. It keeps
the release-verifier output hash/count-only and verifies that fast-path lane
updates are accepted only after the correctness gates hold.

The proof remains support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, live
production service behavior, production throughput, release approval, or rollout
safety. Final release status and integration recommendation remain **NO-GO**.

## Proof surface

`test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js`
builds a local release-verifier proof around the RPP-0780 variant 4 rollout
threshold configuration. The carried lineage is:

- RPP-0780: rollout threshold configuration variant 4
- RPP-0760: rollout threshold configuration variant 3
- RPP-0740: rollout threshold configuration variant 2

The verifier carries the RPP-0780 threshold sequence of `250`, `500`, `1000`,
`2500`, `5000`, `7500`, `9000`, and `10000` basis points. It also carries the
RPP-0780 local storage/performance shape: 24 storage checks, 24 matched checks,
0 drifted checks, 24 performance samples, p95 decision time `5.0 ms`, and max
decision time `5.4 ms`.

## Variant 5 checks

The focused release-verifier test asserts:

- the built-on RPP-0780 variant 4 source proof and RPP-0760/RPP-0740 lineage
  are present and passed;
- the release-verifier command reports runtime, process resources, and
  pass/fail gate statuses;
- a support-only live HTTP fixture bound to loopback returns a local verifier
  receipt, with only request/response hashes, counts, and statuses retained;
- the carried threshold configuration hash matches the normalized variant 4
  configuration;
- storage and performance evidence hashes match the carried counts;
- eight fast-path lane update hashes are present;
- all fast-path updates record passed correctness gate status before update;
- unsafe updates before gates, failed-gate updates, unknown-threshold updates,
  storage-drift updates, and over-budget updates are all zero; and
- the emitted verifier output contains only hashes, counts, booleans, statuses,
  and release posture.

## Release-verifier gates

The proof recomputes this release-verifier gate vector before emitting output:

1. `release-verifier-runtime-resources-gates-reported`
2. `loopback-live-http-fixture-carried-through`
3. `built-on-rollout-threshold-configuration-v4`
4. `threshold-configuration-v4-carried-through`
5. `storage-performance-thresholds-carried-through`
6. `fast-path-lane-updates-only-after-correctness-gates-hold`
7. `generated-unsafe-threshold-cases-fail-closed`
8. `deterministic-hash-count-only-rollout-evidence`
9. `release-verifier-output-hash-count-only`
10. `support-only-release-no-go`

All ten gates must pass and must be recorded before the release-verifier output
hash is accepted. The accepted output records only gate, source, threshold
configuration, lane evidence, storage/performance, unsafe-case coverage, and
release-posture hashes/counts. The loopback fixture is explicitly local-only
and is not production gate evidence.

## Negative coverage

The fail-closed test mutates otherwise passing release-verifier evidence so each
unsafe shape suppresses output:

- missing runtime reporting blocks on
  `release-verifier-runtime-resources-gates-reported`;
- a bad loopback fixture receipt blocks on
  `loopback-live-http-fixture-carried-through`;
- stale built-on source gate evidence blocks on
  `built-on-rollout-threshold-configuration-v4`;
- threshold sequence drift blocks on
  `threshold-configuration-v4-carried-through`;
- storage drift and p95 budget drift block on
  `storage-performance-thresholds-carried-through`;
- a lane update before gates blocks on
  `fast-path-lane-updates-only-after-correctness-gates-hold`;
- stale unsafe-case coverage blocks on
  `generated-unsafe-threshold-cases-fail-closed`;
- a raw path leak blocks on `release-verifier-output-hash-count-only`; and
- premature pass status without recorded gates blocks on
  `correctness-gates-not-recorded`.

The verifier also carries the RPP-0780 unsafe threshold case coverage: unsafe
lane update before gates, unknown threshold, storage drift, performance budget
drift, mismatched configuration hash, and premature pass status. All six cases
remain blocked with output suppressed.

## Redaction posture

The public proof is hash/count-only. It stores threshold counts, threshold
configuration hashes, lane update hashes, storage/performance evidence hashes,
sample hashes, loopback fixture request/response hashes, gate decision hashes,
blocked case identifiers, and release blocker identifiers. It does not store row
payloads, option values, post content, meta values, media bytes, filesystem
paths, live service configuration, endpoint URLs, or private site values.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0800 test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0780 test/rpp-0780-rollout-threshold-configuration-v4.test.js
node --test --test-name-pattern RPP-0760 test/rpp-0760-rollout-threshold-configuration-v3.test.js
node --test --test-name-pattern RPP-0740 test/rpp-0740-rollout-threshold-configuration-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0800-rollout-threshold-configuration-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js`: exit 0
- RPP-0800 focused proof test with loopback fixture: passed
- RPP-0780 adjacent rollout threshold variant 4 test: passed
- RPP-0760 adjacent rollout threshold variant 3 test: passed
- RPP-0740 predecessor rollout threshold variant 2 test: passed
- Evidence redaction scan: passed
- Diff whitespace check: clean

## Integration recommendation

Integration recommendation: **NO-GO**.

This is deterministic local release-verifier support evidence only. Production
storage receipts, row batch executor evidence, atomic group commit evidence,
live production service evidence, and release approval remain required for
promotion.
