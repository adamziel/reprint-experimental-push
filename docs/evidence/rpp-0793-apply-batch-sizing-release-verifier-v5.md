# RPP-0793 apply batch sizing release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0793 apply batch sizing release-verifier carry-through, variant 5
Checklist item: RPP-0793 - Carry through the release verifier for apply batch sizing, variant 5.

## Scope

This slice carries the RPP-0773 apply batch sizing variant 4 support proof into
a deterministic local release-verifier envelope. It verifies that apply batch
chunks resume from durable local receipts without duplicate mutation work,
including a completed receipt-set replay.

The proof remains support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, live
production service behavior, production throughput, release approval, or rollout
safety. Final release status and integration recommendation remain **NO-GO**.

## Proof surface

`test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js` uses the same
hash/count-only chunk transfer shape as RPP-0773:

- mutations: `17`
- configured apply batch size: `5`
- max apply batch size: `500`
- transfer chunks: `4`
- chunk sizes: `5`, `5`, `5`, and `2`
- first-attempt committed chunks: `2`
- first-attempt applied mutations: `10`
- resumed chunks applied after interruption: `2`
- resumed mutations applied after interruption: `7`
- completed second-resume skipped chunks: `4`
- final replay receipt skips: `4`
- max duration budget: `5000 ms`
- max heap budget: `134217728 bytes`

The public release-verifier proof stores only counts, booleans, statuses,
budget values, blocker identifiers, sequence bounds, and hashes of mutation,
resource, chunk, receipt, output, and decision identities.

## Variant 5 checks

The focused test asserts that release-verifier carry-through includes:

- RPP-0773 variant 4 as the built-on lane;
- RPP-0713 apply batch sizing contract details;
- RPP-0753 variant 3 as the previous local support variant;
- release-verifier runtime, resource, and pass/fail gate reporting;
- deterministic chunk windows with complete mutation coverage;
- exact durable receipts for committed chunks `0` and `1`;
- resume skipping committed chunks with `0` mutation work;
- resume applying only chunks `2` and `3`;
- completed second-resume skipping all chunks with stable receipt-set hash;
- final replay skipping all receipts without opening an apply boundary;
- storage-boundary CAS checks before resumed mutations; and
- generated RPP-0773 unsafe regression coverage carried through.

## Release-verifier gates

The proof recomputes this gate vector before emitting output:

1. `release-verifier-runtime-resources-gates-reported`
2. `built-on-apply-batch-sizing-v4`
3. `deterministic-apply-batch-chunk-windows-carried-through`
4. `receipt-prefix-resume-without-duplicate-mutation-work`
5. `completed-resume-replay-skips-all-chunks`
6. `apply-batch-storage-boundary-cas-carried-through`
7. `generated-unsafe-apply-batch-cases-fail-closed`
8. `rollout-safety-gate-vector-carried-through`
9. `hash-count-only-release-verifier-evidence`
10. `support-only-release-no-go`

All ten gates must pass and must be recorded before the output hash is
accepted. The fail-closed test mutates otherwise passing evidence so missing
runtime reporting, stale generated coverage, duplicate mutation work, completed
resume duplicate work, storage-boundary drift, raw-value leakage, rollout gate
drift, or missing recorded gates block output.

## Generated negative coverage

The carried RPP-0773 generated matrix contains one safe local support case and
nine unsafe cases:

- safe outputs: `1`
- blocked cases: `9`
- unsafe outputs: `0`
- stale or missing committed receipts block on
  `resume-skips-durable-chunks`;
- duplicate mutation counters block on `no-duplicate-mutation-work`;
- completed-resume duplicate work blocks on
  `completed-resume-replay-skips-all-chunks` and
  `no-duplicate-mutation-work`;
- drifted resume storage blocks on
  `storage-boundary-cas-before-resume-mutations`;
- raw-value evidence blocks on `hash-only-chunk-transfer-evidence`;
- out-of-order chunks block on `ordered-transfer-chunks`;
- over-budget runtime blocks on `runtime-resource-budget`; and
- premature passed status blocks on `correctness-gates-not-recorded`.

## Rollout safety carry-through

The verifier carries a support-only rollout gate vector forward:

- passed gates: `9`
- blocked gates: `3`
- failed gates: `0`
- speed claims allowed: `false`
- blocked production gates:
  `production-storage-receipts`,
  `production-row-batch-executor`,
  `production-atomic-group-commit`

The blocked production gates are expected for this slice. They keep the
release posture at `NO-GO` while preserving deterministic local evidence that
chunk transfer resume does not repeat mutation work.

## Redaction posture

The RPP-0793 release-verifier proof is hash/count-only. It does not store raw
row payloads, option values, post content, meta values, private site values,
credentials, cookies, bearer values, production service configuration, external
endpoint values, or raw resource keys. The test checks the public proof with
both an apply-batch-specific raw-value pattern and the shared evidence
redaction assertion.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0793 test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0773 test/rpp-0773-apply-batch-sizing-v4.test.js
node --test --test-name-pattern RPP-0753 test/rpp-0753-apply-batch-sizing-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0793-apply-batch-sizing-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js`: exit 0
- RPP-0793 proof test: 2 pass, 0 fail
- RPP-0773 adjacent apply batch sizing variant 4 test: 2 pass, 0 fail
- RPP-0753 adjacent apply batch sizing variant 3 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration recommendation

Integration recommendation: **NO-GO**.

This evidence is deterministic local release-verifier support evidence only.
Production-backed storage receipts, row batch executor evidence, atomic group
commit evidence, live production service evidence, and release approval remain
required for promotion.
