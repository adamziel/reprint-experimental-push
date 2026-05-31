# RPP-0752 dry-run batch sizing variant 3 evidence

Evidence for RPP-0752. This slice is local support-only storage/performance
proof for dry-run batch sizing, variant 3. Final release remains **NO-GO**
because this proof does not include production storage receipts, production row
batch execution, production atomic group commit evidence, live topology,
credentials, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0752-dry-run-batch-sizing-v3.test.js` builds on the existing
RPP-0712 dry-run batch sizing benchmark and the RPP-0732 variant 2 proof
pattern. It exercises a deterministic 42-resource dry-run fixture with
configured batch limits of 8 resources, 24576 estimated bytes, and 8
preconditions per batch.

Variant 3 asserts:

- the RPP-0712 benchmark gates all report `pass`;
- dry-run batch windows stay within resource, byte, and precondition limits;
- every planned resource appears once in hash-only batch window coverage;
- dry-run receipts remain read-only and do not authorize apply;
- a guarded write observes stale live storage state before mutation-capable
  work starts and rejects it as `stale-at-write`;
- rejected stale storage preserves the pre-decision storage state hash; and
- emitted output is hash/count-only and remains support-only with final release
  and integration recommendation set to `NO-GO`.

## Observed benchmark summary

Focused RPP-0712-backed benchmark summary from this sandbox:

- resources: `42`
- preconditions: `42`
- dry-run batches: `6`
- configured batch size: `8`
- batch windows: `[0..7]`, `[8..15]`, `[16..23]`, `[24..31]`, `[32..39]`,
  and `[40..41]`
- largest batch: `8` resources, `17969` estimated bytes, `8` preconditions
- duration: `11.18 ms` within the `5000 ms` budget
- heap used: `4962808 bytes` within the `134217728 bytes` budget
- RSS: `53944320 bytes`
- CPU: `5 ms user`, `3.98 ms system`

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

## Variant 3 gates

The focused proof recomputes this gate vector before emitting storage evidence:

1. `benchmark-gates-pass`
2. `bounded-batch-sizing-gates`
3. `complete-dry-run-batch-coverage`
4. `dry-run-receipts-do-not-authorize-apply`
5. `stale-storage-state-rejected-before-mutation`
6. `storage-state-preserved-after-rejection`
7. `deterministic-storage-performance-evidence`
8. `hash-count-only-evidence`
9. `support-only-release-no-go`

Output is emitted only after all nine gates are recorded and passing.

## Stale storage refusal

The storage guard projection carries the expected storage hash from the
dry-run precondition, observes a different live storage hash before
mutation-capable work starts, and resolves the guarded write as
`stale-at-write`.

Recorded posture:

- guarded write attempted: `true`
- guarded write rejected: `true`
- rejected stale storage state: `true`
- live storage matches dry-run precondition: `false`
- mutation-capable work started: `false`
- mutation applied: `false`
- storage state updated: `false`
- dry-run receipt authorizes mutation: `false`
- guard order: read live storage state, compare live storage hash, reject
  stale state, skip mutation-capable work

## Negative coverage

The focused proof mutates otherwise passing local evidence and verifies
fail-closed behavior:

- stale guard bypass evidence clears the rejection and blocks on
  `stale-storage-state-rejected-before-mutation`;
- mutated storage state evidence changes the post-decision state hash and
  blocks on `storage-state-preserved-after-rejection`;
- oversized batch evidence inflates the largest batch resource count and
  blocks on `bounded-batch-sizing-gates`; and
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

This proof does not claim live production batch sizing, production storage
durability, atomic group commit, release approval, rollout safety, or final
release readiness.

## Redaction posture

Emitted evidence is hash/count-only. It stores counts, limits, sequence bounds,
resource-key hashes, item hashes, receipt hashes, storage-state hashes, gate
hashes, and decision hashes. It does not store row payloads, option values,
post content, meta values, file bytes, paths, live service configuration,
credentials, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0752-dry-run-batch-sizing-v3.test.js`
- `node --test --test-name-pattern RPP-0752 test/rpp-0752-dry-run-batch-sizing-v3.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node --test test/dry-run-batch-sizing.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0752-dry-run-batch-sizing-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result before commit:

- RPP-0752 proof test: 2 pass, 0 fail
- Adjacent RPP-0732 proof test: 2 pass, 0 fail
- Adjacent RPP-0712 dry-run batch sizing benchmark test: 5 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
