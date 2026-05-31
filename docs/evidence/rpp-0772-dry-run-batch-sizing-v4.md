# RPP-0772 dry-run batch sizing variant 4 evidence

Evidence for RPP-0772. This slice is deterministic local support-only
regression coverage for dry-run batch sizing, variant 4. Final release remains
**NO-GO** because this proof does not include production storage receipts,
production row batch execution, production atomic group commit evidence, live
topology, credentials, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0772-dry-run-batch-sizing-v4.test.js` builds on the RPP-0712 dry-run
batch sizing benchmark, the RPP-0732 variant 2 proof pattern, and the RPP-0752
variant 3 guarded storage pattern. It exercises a deterministic 50-resource
dry-run fixture with configured batch limits of 9 resources, 28672 estimated
bytes, and 9 preconditions per batch.

Variant 4 asserts:

- the RPP-0712 benchmark gates all report `pass`;
- dry-run batch windows stay within resource, byte, and precondition limits;
- every planned resource appears once in hash-only batch window coverage;
- dry-run receipts remain read-only and do not authorize apply;
- each dry-run batch window has one guarded write attempt;
- every guarded write observes stale live storage state before
  mutation-capable work starts and rejects it as `stale-at-write`;
- rejected stale storage preserves the pre-decision storage state hash for
  every guarded write; and
- emitted output is hash/count-only and remains support-only with final release
  and integration recommendation set to `NO-GO`.

## Observed benchmark summary

Focused RPP-0712-backed benchmark summary from this sandbox:

- resources: `50`
- preconditions: `50`
- dry-run batches: `6`
- configured batch size: `9`
- batch windows: `[0..8]`, `[9..17]`, `[18..26]`, `[27..35]`, `[36..44]`,
  and `[45..49]`
- largest batch: `9` resources, `22663` estimated bytes, `9` preconditions
- duration budget: `5000 ms`
- heap budget: `134217728 bytes`

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

## Variant 4 gates

The focused proof recomputes this gate vector before emitting guarded-write
storage evidence:

1. `benchmark-gates-pass`
2. `bounded-batch-sizing-gates`
3. `complete-dry-run-batch-coverage`
4. `dry-run-receipts-do-not-authorize-apply`
5. `guarded-writes-reject-stale-storage-state`
6. `storage-state-preserved-after-rejected-guarded-writes`
7. `deterministic-guarded-write-evidence`
8. `hash-count-only-evidence`
9. `support-only-release-no-go`

Output is emitted only after all nine gates are recorded and passing.

## Stale storage refusal

The storage guard projection carries hash-only expected storage evidence from
the dry-run preconditions, observes different hash-only live storage evidence
before mutation-capable work starts, and resolves each guarded write as
`stale-at-write`.

Recorded posture:

- guarded writes attempted: `6`
- guarded writes rejected: `6`
- rejected stale storage states: `6`
- live storage matches dry-run precondition: `0`
- mutation-capable work started: `0`
- mutation applied: `0`
- storage state updated: `0`
- dry-run receipt authorizes mutation: `0`
- guard order: read live storage state, compare live storage hash, reject
  stale state, skip mutation-capable work

## Negative coverage

The focused proof mutates otherwise passing local evidence and verifies
fail-closed behavior:

- accepted stale guard evidence clears one stale-state rejection and blocks on
  `guarded-writes-reject-stale-storage-state`;
- mutated storage state evidence changes one post-decision state hash and
  blocks on `storage-state-preserved-after-rejected-guarded-writes`;
- missing guarded write evidence removes one guarded write attempt and blocks
  on `guarded-writes-reject-stale-storage-state`; and
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

- `node --check test/rpp-0772-dry-run-batch-sizing-v4.test.js`
- `node --test --test-name-pattern RPP-0772 test/rpp-0772-dry-run-batch-sizing-v4.test.js`
- `node --test --test-name-pattern RPP-0752 test/rpp-0752-dry-run-batch-sizing-v3.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0772-dry-run-batch-sizing-v4.md`
- `git diff --check`

Observed focused proof result before commit:

- RPP-0772 proof test: 2 pass, 0 fail
- Adjacent RPP-0752 proof test: 2 pass, 0 fail
- Adjacent RPP-0732 proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
