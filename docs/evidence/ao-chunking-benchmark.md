# AO Chunking Benchmark Evidence

Date: 2026-05-28
Updated: 2026-05-30 for RPP-0709 chunk replay idempotency.
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
4. `chunk-replay-idempotency`
5. `live-remote-preconditions`
6. `parallel-snapshot-hashing`
7. `durable-journal-integrity`
8. `failure-recovery-classification`
9. `atomic-group-visibility`
10. `production-storage-receipts`
11. `production-row-batch-executor`
12. `production-atomic-group-commit`

The first nine gates pass in the lab benchmark. The last three stay blocked,
which keeps `throughput.productionThroughput` at `not-claimed` until production
storage receipts, a production row batch compare-and-swap executor, and a
production atomic group commit boundary are measured.

## Guarded transfer evidence

A deterministic unit-shaped run was executed with:

```sh
node --input-type=module -e "import { runGuardedExecutorBenchmark } from './scripts/bench/guarded-executor-benchmark.js'; const report = runGuardedExecutorBenchmark({ profile: 'unit', fileBytes: 1048576, chunkSizeBytes: 262144, rowCount: 8, rowPayloadBytes: 64, now: new Date('2026-05-24T00:00:00.000Z') }); const replay = report.evidence.guardedTransfer.replayIdempotency; console.log(JSON.stringify({ profile: report.profile, shape: report.shape, resources: report.resources, rolloutSafetyGates: report.rolloutSafetyGates.summary, gateStatuses: report.rolloutSafetyGates.gates.map(({ id, status, speedClaimBlocker }) => ({ id, status, speedClaimBlocker })), guardedTransfer: { manifestDigest: report.evidence.guardedTransfer.manifest.manifestDigest, manifestComplete: report.evidence.guardedTransfer.manifest.complete, hashVerification: report.evidence.guardedTransfer.hashVerification.status, resume: report.evidence.guardedTransfer.resume, replayIdempotency: { status: replay.status, attemptedReplayCount: replay.attemptedReplayCount, idempotentSkips: replay.idempotentSkips, duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten, bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay, duplicateMutationWork: replay.mutationWork.duplicateMutationWork }, visibility: report.evidence.guardedTransfer.visibility }, productionThroughput: report.claims.productionThroughput }, null, 2));"
```

Observed summary:

- Upload resource: `file:wp-content/uploads/2026/05/catalog-export.bin`.
- Shape: 1,048,576 bytes, 262,144-byte chunks, 4 chunk receipts, 18 mutations.
- Manifest digest: `sha256:9a1fefe0eee3a1f074228b33dfc53f1299018a5a256b2fe0d62843255da11212`.
- Finalized hash: `sha256:812ac11a2a70bdae6ccd775ba131187d334af3e93410a4070c5225ab22c59286`.
- Rollout gate summary: 9 passed, 3 blocked, 0 failed.
- Resume proof: 4 chunks skipped by exact durable receipts, 0 chunks re-uploaded,
  0 duplicate chunk bytes, 0 duplicate mutation work, missing and mismatched
  receipts both block the skip.
- Replay proof: 4 exact chunk replays return the existing durable receipts with
  0 duplicate chunk bytes, 0 duplicate receipt records, and 0 duplicate mutation
  work; missing-receipt and mismatched-idempotency probes fail closed.
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
- RPP-0709: chunk replay idempotency evidence returns existing receipts for
  exact replay, blocks mismatched idempotency keys, and keeps duplicate replay
  bytes, duplicate receipt records, and duplicate mutation work at zero inside
  the documented lab budgets.
- RPP-0710: parallel snapshot hashing evidence proves a bounded scheduler,
  complete hash set, deterministic digest, and fast-path lane update only after
  correctness gates pass.
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

Result: guarded benchmark tests passed, including the CLI regression that
parses the benchmark command output and asserts `resources`, `rolloutSafetyGates`,
`timings`, and `throughput` appear in that order. `git diff --check` passed.
