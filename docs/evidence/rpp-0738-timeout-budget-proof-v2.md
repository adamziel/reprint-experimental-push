# RPP-0738 timeout budget proof variant 2 evidence

Evidence for RPP-0738. This slice is support-only and builds on the RPP-0718
timeout budget proof emitted by the guarded executor benchmark. Final release
remains **NO-GO** because this proof does not supply a live production remote
service, production storage receipts, production row batch executor evidence,
production atomic group commit evidence, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0738-timeout-budget-proof-v2.test.js` exercises the local unit
guarded executor workload with a 1 MiB staged file split into four 256 KiB
chunks.

Variant 2 asserts:

- the underlying RPP-0718 timeout proof passed and is carried through as
  hash-only public evidence;
- the simulated timeout expires during chunk transfer before apply can open;
- two durable local chunk receipts exist before timeout and two chunks remain
  unacknowledged;
- transfer resume skips only exact receipt-backed chunks and uploads the
  unacknowledged remainder;
- duplicate chunk bytes and duplicate mutation work are both `0`;
- mutation apply opens only after file staging finalizes;
- the run stays within the documented unit runtime and heap budgets;
- emitted output is blocked until correctness gates are recorded and passing;
  and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed local summary

Focused RPP-0718-backed timeout summary from this sandbox:

- profile: `unit`
- file bytes: `1048576`
- chunk size: `262144`
- chunk count: `4`
- timeout budget: `2500 ms`
- chunk attempt budget: `1000 ms`
- durable receipts before timeout: `2`
- unacknowledged chunks at timeout: `2`
- chunks skipped by receipt on resume: `2`
- chunks uploaded after resume: `2`
- duplicate chunk bytes: `0`
- duplicate mutation work during transfer resume: `0`
- mutation work before timeout: `0`
- mutation work before transfer finalization: `0`
- apply opened after transfer finalization: `true`
- final timeout output was emitted only after correctness gates passed

The public variant-2 projection hashes plan identity, resource identity,
manifest identity, finalized file identity, and receipt keys. It keeps counts,
budgets, booleans, sequence boundaries, gate statuses, and decision hashes.

## Variant 2 gates

The RPP-0738 proof recomputes this gate vector from the hash-only timeout
storage/performance projection before emitting output:

1. `built-on-timeout-proof-passed`
2. `documented-timeout-budget-interrupts-transfer`
3. `durable-local-receipts-before-timeout`
4. `receipt-only-resume-after-timeout`
5. `no-duplicate-mutation-work`
6. `apply-opens-after-transfer-finalize`
7. `unit-runtime-resource-budget`
8. `hash-only-storage-performance-evidence`
9. `support-only-release-no-go`

The output is emitted only after all nine gates pass. If the evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Negative coverage

The focused proof mutates otherwise passing timeout evidence and verifies
fail-closed behavior:

- missing receipt evidence clears one receipt match and blocks on
  `durable-local-receipts-before-timeout`;
- duplicate mutation evidence sets resume/apply duplicate mutation work above
  zero and blocks on `no-duplicate-mutation-work`;
- over-budget evidence sets duration above the documented maximum and blocks
  on `unit-runtime-resource-budget`; and
- premature-pass evidence clears the recorded gate vector while leaving status
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

This proof does not claim live production throughput, release approval, or
rollout safety. It proves only local support-path timeout behavior, local
receipt-backed chunk resume, zero duplicate mutation work, runtime/resource
gates, and fail-closed stale or incomplete timeout evidence behavior.

## Redaction posture

Timeout storage/performance evidence is hash-only for identities and content.
It stores counts, budgets, sequence numbers, receipt-key hashes, manifest and
finalization digests, gate statuses, and decision hashes. It does not store
logical paths, raw file content, row payloads, option values, meta values, live
service configuration, credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0738-timeout-budget-proof-v2.test.js`
- `node --test --test-name-pattern RPP-0738 test/rpp-0738-timeout-budget-proof-v2.test.js`
- `node --test --test-name-pattern RPP-0718 test/rpp-0718-timeout-budget-proof.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0738-timeout-budget-proof-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result after local validation:

- RPP-0738 proof test: 2 pass, 0 fail
- Adjacent RPP-0718 timeout budget proof test: 1 pass, 0 fail
- Adjacent RPP-0732 dry-run batch sizing variant 2 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
