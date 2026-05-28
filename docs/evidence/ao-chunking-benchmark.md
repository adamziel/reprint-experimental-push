# AO Chunking Benchmark Evidence

Date: 2026-05-28
Lane: `chunking-benchmark`
Scope: guarded transfer benchmark evidence and rollout safety gates.

## Safety-before-speed invariant

`scripts/bench/guarded-executor-benchmark.js` now emits deterministic safety
gate names before any throughput fields. Tests assert that `rolloutSafetyGates`
appears before `throughput`, so benchmark review sees gates before speed claims.
The current gate list is:

1. `guarded-transfer-manifest`
2. `chunk-hash-verification`
3. `receipt-only-resume`
4. `live-remote-preconditions`
5. `durable-journal-integrity`
6. `failure-recovery-classification`
7. `atomic-group-visibility`
8. `production-storage-receipts`
9. `production-row-batch-executor`
10. `production-atomic-group-commit`

The first seven gates pass in the lab benchmark. The last three stay blocked,
which keeps `throughput.productionThroughput` at `not-claimed` until production
storage receipts, a production row batch compare-and-swap executor, and a
production atomic group commit boundary are measured.

## Guarded transfer evidence

A deterministic unit-shaped run was executed with:

```sh
node --input-type=module -e "import { runGuardedExecutorBenchmark } from './scripts/bench/guarded-executor-benchmark.js'; const report = runGuardedExecutorBenchmark({ profile: 'unit', fileBytes: 1048576, chunkSizeBytes: 262144, rowCount: 8, rowPayloadBytes: 64, now: new Date('2026-05-24T00:00:00.000Z') }); console.log(JSON.stringify({ profile: report.profile, shape: report.shape, resources: report.resources, rolloutSafetyGates: report.rolloutSafetyGates.summary, gateStatuses: report.rolloutSafetyGates.gates.map(({ id, status, speedClaimBlocker }) => ({ id, status, speedClaimBlocker })), guardedTransfer: { manifestDigest: report.evidence.guardedTransfer.manifest.manifestDigest, manifestComplete: report.evidence.guardedTransfer.manifest.complete, hashVerification: report.evidence.guardedTransfer.hashVerification.status, resume: report.evidence.guardedTransfer.resume, visibility: report.evidence.guardedTransfer.visibility }, productionThroughput: report.claims.productionThroughput }, null, 2));"
```

Observed summary:

- Upload resource: `file:wp-content/uploads/2026/05/catalog-export.bin`.
- Shape: 1,048,576 bytes, 262,144-byte chunks, 4 chunk receipts, 18 mutations.
- Manifest digest: `sha256:8f1090da3b8736101b0040f5261cf41632e9ad3c747d44c3ea1670531267f4b4`.
- Finalized hash: `sha256:812ac11a2a70bdae6ccd775ba131187d334af3e93410a4070c5225ab22c59286`.
- Rollout gate summary: 7 passed, 3 blocked, 0 failed.
- Resume proof: 4 chunks skipped by exact durable receipts, 0 chunks re-uploaded,
  0 duplicate chunk bytes, 0 duplicate mutation work, missing and mismatched
  receipts both block the skip.
- Visibility proof: chunk receipts are not canonical-visible before finalize,
  and the live path changes only after the finalized record is present.

## RPP evidence

- RPP-0706 / RPP-0726: large upload chunk manifest evidence now includes a
  durable `chunk-manifest-finalized` journal record, manifest digest, contiguous
  byte-range coverage, resource counts, runtime timings, and pass/fail rollout
  gates in the benchmark report.
- RPP-0707 / RPP-0727: chunk hash verification re-reads staged bytes, checks
  every chunk digest against the manifest, and checks the assembled hash against
  the finalized file hash. Production speed blockers include
  `missing-chunk-hash-verification` if this evidence is removed.
- RPP-0708 / RPP-0728: resume evidence simulates a receipt-only resume pass and
  proves completed chunks are skipped only from exact durable receipts; missing
  or mismatched receipts fail closed and do not authorize skipped transfer work.
- RPP-0720: rollout safety gates are first-class benchmark output, ordered ahead
  of speed claims, and production throughput remains blocked until production
  storage, row batch, and atomic commit gates are measured.

## Verification

Focused verification runs while preparing this evidence:

```sh
node --test test/guarded-executor-benchmark.test.js
node scripts/bench/guarded-executor-benchmark.js --profile=unit --file-bytes=1048576 --chunk-size-bytes=262144 --row-count=8 --row-payload-bytes=64 > /tmp/guarded-benchmark-report.json
git diff --check
```

Result: 5 guarded benchmark tests passed, the CLI report emitted `resources`,
`rolloutSafetyGates`, `timings`, and `throughput` in that order, and
`git diff --check` passed.
