# RPP-0766 large upload chunk manifest variant 4 evidence

Evidence for RPP-0766. This slice is support-only local generated coverage for
large-upload chunk manifest storage/performance evidence. Final release remains
**NO-GO** because this proof does not supply production storage receipts,
production remote throughput, production row batch execution, production atomic
group commit evidence, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0766-large-upload-chunk-manifest-v4.test.js` exercises the guarded
executor benchmark with a unit-shaped large-upload resource: a 1 MiB staged file
split into four 256 KiB chunks. The benchmark command output is parsed to prove
that it reports runtime, resources, and pass/fail rollout gates.

This variant records lineage from the RPP-0746 variant 3 manifest proof while
still using the RPP-0726/RPP-0706 guarded-transfer manifest benchmark source.

Variant 4 asserts:

- the benchmark command emits parseable JSON with runtime, resources, and
  rollout gate statuses;
- the command reports 12 rollout gates with 9 passed, 3 blocked, and 0 failed;
- the durable `chunk-manifest-finalized` record covers every staged chunk;
- byte ranges are contiguous, non-overlapping, and cover the expected file
  byte count;
- durable chunk receipts cover the manifest exactly once;
- chunk hash verification matches every manifest entry and the finalized file
  hash;
- receipt-only resume and chunk replay remain duplicate-free;
- runtime and heap resource budgets are reported and respected;
- public manifest evidence is hash-only and deterministic across repeated local
  runs; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed benchmark summary

Focused guarded-executor summary from this sandbox:

- profile: `unit`
- generated at: `2026-05-31T00:00:00.000Z`
- file bytes: `1048576`
- chunk size: `262144`
- chunk count: `4`
- bytes moved through staging: `1048576`
- chunk receipts: `4`
- success journal records: `48`
- manifest status: `passed`
- manifest durable record type: `chunk-manifest-finalized`
- byte range coverage: contiguous and non-overlapping, `1048576` of
  `1048576` bytes covered
- hash verification: `passed`, 4 chunks verified, assembled hash matched the
  finalized file hash
- receipt-only resume: 4 chunks skipped by exact receipts, 0 chunks uploaded,
  0 duplicate chunk bytes, 0 duplicate mutation work
- replay proof: 4 replay attempts, 4 idempotent skips, 0 duplicate receipts,
  0 rewritten bytes, 0 duplicate mutation work
- duration: `847.85 ms` within the `30000 ms` budget
- heap used: `7884448 bytes` within the `268435456 bytes` budget
- max RSS: `73863168 bytes`
- CPU: `335.12 ms user`, `29.84 ms system`

The benchmark command reported rollout gate summary:

- passed: `9`
- blocked: `3`
- failed: `0`
- speed claims allowed: `false`
- production throughput: `not-claimed`

The three blocked rollout gates are production-only blockers:

- `production-storage-receipts-not-measured`
- `production-row-batch-executor-not-measured`
- `production-atomic-group-commit-not-measured`

## Variant 4 gates

The RPP-0766 proof recomputes this gate vector from the hash-only manifest
storage/performance projection before emitting output:

1. `benchmark-command-reports-runtime-resources-gates`
2. `complete-large-upload-chunk-manifest`
3. `contiguous-byte-range-coverage`
4. `durable-receipts-cover-manifest`
5. `chunk-hash-verification-passed`
6. `receipt-only-resume-uses-manifest`
7. `duplicate-free-replay-from-manifest`
8. `unit-runtime-resource-budget`
9. `deterministic-manifest-storage-evidence`
10. `hash-only-manifest-storage-evidence`
11. `support-only-release-no-go`

The output is emitted only after all eleven gates pass. If evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Negative coverage

The focused proof mutates otherwise passing manifest evidence and verifies
fail-closed behavior:

- missing manifest evidence clears the finalized manifest record and blocks on
  `complete-large-upload-chunk-manifest`;
- incomplete receipt evidence reduces the receipt count and blocks on
  `durable-receipts-cover-manifest`;
- non-contiguous range evidence shifts one chunk offset and blocks on
  `contiguous-byte-range-coverage`;
- failed hash verification evidence changes a chunk match result and blocks on
  `chunk-hash-verification-passed`;
- over-budget evidence sets duration above the documented maximum and blocks on
  `unit-runtime-resource-budget`; and
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
- production row batch executor is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim production throughput, release approval, or live-site
rollout safety. It proves only local support-path manifest completeness,
runtime/resource gate reporting, hash-only storage evidence, duplicate-free
resume/replay behavior, and fail-closed stale or incomplete manifest evidence
handling.

## Redaction posture

The variant 4 public proof projection stores counts, byte totals, gate status
vectors, budget values, manifest hashes, chunk digest hashes, receipt hashes,
sample decision hashes, and decision hashes. It does not store file payloads,
logical upload paths, absolute filesystem paths, live service configuration,
credentials, cookies, external URLs, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0766-large-upload-chunk-manifest-v4.test.js`
- `node --test --test-name-pattern RPP-0766 test/rpp-0766-large-upload-chunk-manifest-v4.test.js`
- `node --test --test-name-pattern RPP-0746 test/rpp-0746-large-upload-chunk-manifest-v3.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0766-large-upload-chunk-manifest-v4.md`
- `git diff --check`

Observed focused proof result before commit:

- RPP-0766 syntax check: exit 0
- RPP-0766 proof test: 2 pass, 0 fail
- RPP-0746 adjacent proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
