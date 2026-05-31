# RPP-0780 rollout threshold configuration variant 4 evidence

Evidence for RPP-0780. This slice is support-only and models rollout threshold
configuration variant 4 with local hash-only storage and performance evidence.
Final release remains **NO-GO** because this proof does not supply a live
production remote service, production storage receipts, production row batch
execution, production atomic group commit evidence, or release-verifier
carry-through.

## Proof scope

The focused proof test
`test/rpp-0780-rollout-threshold-configuration-v4.test.js` exercises a local
variant-4 rollout threshold configuration for the fast-path lane
`rollout-threshold-configuration-fast-path`.

Variant 4 asserts:

- the configured rollout thresholds are normalized to `250`, `500`, `1000`,
  `2500`, `5000`, `7500`, `9000`, and `10000` basis points;
- storage evidence meets the configured drift threshold with 24 matched checks
  and 0 drifted checks;
- performance evidence meets the configured local decision threshold with p95
  decision time of `5.0 ms` against a `5.1 ms` p95 budget;
- eight threshold lane updates are emitted only after the correctness gate
  vector is present and passing;
- unknown thresholds, storage drift, performance budget violations, mismatched
  configuration hashes, and premature passed status fail closed; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed local support summary

Focused local proof summary from this sandbox:

- threshold configuration schema: `4`
- rollout thresholds: `250`, `500`, `1000`, `2500`, `5000`, `7500`, `9000`,
  `10000` basis points
- storage checks: `24`
- matched storage checks: `24`
- drifted storage checks: `0`
- storage drift: `0` basis points
- performance samples: `24`
- p95 decision time: `5.0 ms`
- max decision time: `5.4 ms`
- fast-path lane updates: `8`
- fast-path lane blocks: `0`
- unsafe updates before gates: `0`
- updates with failed gates: `0`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`

The proof stores threshold counts, storage hashes, performance hashes, sample
hashes, lane update hashes, gate decision hashes, and release blocker
identifiers. It does not store row payloads, option values, post content, meta
values, media bytes, filesystem paths, live service configuration, credentials,
or private site values.

## Variant 4 gates

The RPP-0780 proof recomputes this gate vector from hash-only rollout threshold
evidence before emitting fast-path lane output:

1. `deterministic-threshold-configuration`
2. `configured-threshold-sequence`
3. `storage-thresholds-within-configuration`
4. `performance-thresholds-within-configuration`
5. `fast-path-lane-updates-only-after-correctness-gates`
6. `threshold-lane-update-counts-match`
7. `deterministic-hash-only-rollout-evidence`
8. `runtime-resource-budget`
9. `support-only-release-no-go`

The lane output is emitted only after all nine gates pass and the recorded gate
vector appears before the fast-path lane evidence. If evidence claims `passed`
before the gate vector is present and passing, the resolver blocks output and
records `correctness-gates-not-recorded`.

## Negative coverage

The focused proof mutates otherwise passing rollout threshold evidence and
verifies fail-closed behavior:

- unsafe lane update evidence records a lane update before gates and blocks on
  `fast-path-lane-updates-only-after-correctness-gates`;
- unknown threshold evidence adds an unconfigured `8750` basis point update and
  blocks on `configured-threshold-sequence`;
- storage drift evidence changes the matched/drifted check counts and blocks on
  `storage-thresholds-within-configuration`;
- performance evidence raises p95 decision time above the configured budget and
  blocks on `performance-thresholds-within-configuration`;
- mismatched configuration evidence changes the recorded configuration hash and
  blocks on `deterministic-threshold-configuration`; and
- premature pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`.

All unsafe decisions suppress fast-path output and record deterministic decision
hashes.

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

This proof does not claim production rollout safety, release approval, or
production throughput. It proves only local support behavior for variant-4
rollout threshold configuration, hash-only storage and performance evidence,
and fail-closed fast-path lane gating.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0780-rollout-threshold-configuration-v4.test.js`
- `node --test --test-name-pattern RPP-0780 test/rpp-0780-rollout-threshold-configuration-v4.test.js`
- `node --test --test-name-pattern RPP-0760 test/rpp-0760-rollout-threshold-configuration-v3.test.js`
- `node --test --test-name-pattern RPP-0740 test/rpp-0740-rollout-threshold-configuration-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0780-rollout-threshold-configuration-v4.md`
- `git diff --check`

Observed focused proof result before commit:

- Syntax check: passed
- RPP-0780 proof test: 2 pass, 0 fail
- Adjacent RPP-0760 rollout threshold configuration variant 3 test: 2 pass,
  0 fail
- Adjacent RPP-0740 rollout threshold configuration variant 2 test: 2 pass,
  0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
