# RPP-0732 dry-run batch sizing variant 2 evidence

Evidence for RPP-0732. This slice is support-only and builds on the RPP-0712
dry-run batch sizing benchmark. Final release remains **NO-GO** because this
proof does not supply a live production remote service, production storage
receipts, production row batch execution, production atomic group commit
evidence, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0732-dry-run-batch-sizing-v2.test.js` exercises deterministic
dry-run batch sizing with a 34-resource fixture and a configured batch size of
7 resources.

Variant 2 asserts:

- the measured RPP-0712 benchmark report includes runtime, process resource
  usage, dry-run resource counts, and pass/fail gates;
- dry-run batch windows are ordered and deterministic: `[0..6]`, `[7..13]`,
  `[14..20]`, `[21..27]`, and `[28..33]`;
- each batch window stays below configured resource, byte, and precondition
  limits;
- every planned resource appears once in the hash-only batch window coverage;
- guarded storage refuses stale live storage before mutation-capable work can
  start;
- emitted output is blocked until the correctness gate vector is present and
  passing; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed benchmark summary

Focused RPP-0712-backed benchmark summary from this sandbox:

- resources: `34`
- preconditions: `34`
- dry-run batches: `5`
- configured batch size: `7`
- largest batch: `7` resources, `13083` estimated bytes, `7` preconditions
- duration: `6.17 ms` within the `5000 ms` budget
- heap used: `4888568 bytes` within the `134217728 bytes` budget
- RSS: `57806848 bytes`
- CPU: `5.41 ms user`, `0.81 ms system`

The underlying RPP-0712 benchmark gates all reported `pass`:

- `dry-run-batches-stay-within-resource-limit`
- `dry-run-batches-stay-within-byte-limit`
- `dry-run-batches-stay-within-precondition-limit`
- `all-resources-covered-once`
- `dry-run-is-read-only-and-not-apply-authority`
- `per-resource-preconditions-carried`
- `final-receipt-requires-all-batches`
- `stale-storage-rejected-after-dry-run`
- `configuration-errors-fail-closed`
- `hash-only-evidence`
- `runtime-resource-budget`

## Variant 2 gates

The RPP-0732 proof recomputes this gate vector from the hash-only batch window
projection before emitting output:

1. `deterministic-batch-size`
2. `ordered-batch-windows`
3. `complete-batch-coverage`
4. `resource-counts-match`
5. `batch-window-hashes-match`
6. `deterministic-batch-evidence`
7. `runtime-resource-budget`
8. `stale-storage-refusal-before-mutation`
9. `hash-only-batch-evidence`
10. `support-only-release-no-go`

The output is emitted only after all ten gates pass. If the evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Stale storage refusal

The stale-storage projection carries one expected storage hash from the dry-run
batch set, observes a different live storage hash before mutation-capable work,
and resolves the guarded write as `stale-at-write`.

Recorded posture:

- guarded write attempted: `true`
- guarded write rejected: `true`
- mutation-capable work started: `false`
- mutation applied: `false`
- dry-run receipt authorizes mutation: `false`
- guard order: compare live storage hash, reject stale state, skip
  mutation-capable work

## Negative coverage

The focused proof mutates otherwise passing batch evidence and verifies
fail-closed behavior:

- stale batch hash evidence changes a recorded batch window hash and blocks on
  `batch-window-hashes-match`;
- missing batch window evidence removes a middle window and blocks on
  `complete-batch-coverage`;
- mismatched resource count evidence changes the recorded total and blocks on
  `resource-counts-match`; and
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

This proof does not claim live production batch sizing, release approval, or
rollout safety. It proves only deterministic dry-run batch windows, hash-only
public evidence, runtime/resource gates, stale storage refusal before mutation,
and fail-closed stale or incomplete batch evidence behavior.

## Redaction posture

Batch evidence is hash-only. It stores sequence bounds, counts, limits,
resource-key hashes, item hashes, receipt hashes, collection hashes, and gate
decision hashes. It does not store row payloads, option values, post content,
meta values, file bytes, paths, live service configuration, or private site
values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node --test --test-name-pattern RPP-0712 test/dry-run-batch-sizing.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0732-dry-run-batch-sizing-v2.md`
- `git diff --check`

Observed focused proof result:

- RPP-0732 proof test: 2 pass, 0 fail
- Adjacent RPP-0712 dry-run batch sizing benchmark test: 5 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
