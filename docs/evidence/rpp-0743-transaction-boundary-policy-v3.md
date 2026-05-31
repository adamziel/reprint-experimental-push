# RPP-0743 transaction boundary policy variant 3 evidence

Evidence for RPP-0743. This slice is support-only and builds on the
RPP-0723 transaction boundary policy variant 2 coverage. Final release remains
**NO-GO** because this proof does not provide production storage receipts,
production row batch executor evidence, production atomic group commit evidence,
a live production service, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0743-transaction-boundary-policy-v3.test.js` runs the local guarded
executor unit profile and projects a hash-and-count-only transaction boundary
storage/performance proof.

Variant 3 asserts:

- the source RPP-0703 transaction boundary policy is still passed and carried
  through under the RPP-0723 variant 2 lane;
- durable local chunk receipts cover every staged chunk before transfer resume;
- chunk transfer resume skips only exact receipt-backed chunks;
- resume uploads `0` chunks, writes `0` duplicate chunk bytes, and performs
  `0` duplicate mutation work;
- repeated chunk replay returns existing receipts without duplicate receipt
  records, rewritten bytes, or mutation work;
- mutation apply opens only after file staging finalizes;
- the local unit run stays within documented duration and heap budgets; and
- generated output is blocked until the complete correctness gate vector is
  present and passing.

## Local storage/performance evidence

The variant 3 projection uses support-only local evidence:

- profile: `unit`
- file bytes: `1048576`
- chunk size: `262144`
- chunk count: `4`
- receipt backend: `lab-file-journal-receipts`
- storage proof: `support-only-lab-file-journal`
- production backed: `false`
- exact receipt matches: `4`
- chunks skipped by receipt on resume: `4`
- chunks uploaded on resume: `0`
- bytes uploaded on resume: `0`
- duplicate chunk bytes: `0`
- duplicate mutation work: `0`
- replay attempts: `8`
- duplicate receipt records during replay: `0`
- mutation work replayed before transfer finalization: `0`
- apply opened after transfer finalization: `true`

The public projection hashes plan identity, resource identity, manifest
identity, finalized file identity, replay decisions, and receipt keys. It keeps
counts, budgets, sequence numbers, gate statuses, and decision hashes.

## Variant 3 gates

The proof recomputes this gate vector before emitting output:

1. `built-on-transaction-policy-passed`
2. `durable-local-receipts-complete`
3. `receipt-only-transfer-resume`
4. `chunk-replay-idempotency-retained`
5. `no-duplicate-mutation-work`
6. `apply-opens-after-transfer-finalize`
7. `unit-storage-performance-budget`
8. `hash-only-storage-performance-evidence`
9. `support-only-release-no-go`

The output is emitted only after all nine gates pass. If otherwise passing
evidence is changed to remove receipt coverage, add duplicate mutation work,
open apply before transfer finalization, exceed the runtime budget, or clear
the recorded correctness gates, the resolver blocks output and records the
failing gate.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch executor is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim production storage durability, production throughput,
database rollback behavior, release approval, or rollout safety. It proves only
local support-path transaction boundary behavior, local receipt-backed chunk
resume, zero duplicate mutation work, unit runtime/resource gates, and
fail-closed stale or incomplete transaction-boundary evidence behavior.

## Redaction posture

Transaction boundary storage/performance evidence is hash-and-count-only. It
stores receipt counts, duplicate-work counters, runtime budgets, gate status
vectors, blocker identifiers, and hashes of resource identities, receipts,
replay decisions, and resolver outputs. It does not store logical paths, raw
file content, row payloads, option values, meta values, live service
configuration, credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0743-transaction-boundary-policy-v3.test.js`
- `node --test --test-name-pattern RPP-0743 test/rpp-0743-transaction-boundary-policy-v3.test.js`
- `node --test --test-name-pattern RPP-0723 test/rpp-0723-transaction-boundary-policy-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0743-transaction-boundary-policy-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result after local validation:

- RPP-0743 proof test: 2 pass, 0 fail
- Adjacent RPP-0723 proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
