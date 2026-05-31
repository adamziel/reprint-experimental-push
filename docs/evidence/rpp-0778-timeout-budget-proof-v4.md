# RPP-0778 timeout budget proof variant 4 evidence

Evidence for RPP-0778. This slice is local support-only regression coverage for
the timeout budget proof. Final release remains **NO-GO** because this proof
does not provide production storage receipts, production row batch executor
evidence, production atomic group commit evidence, live topology, credentials,
or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0778-timeout-budget-proof-v4.test.js` runs the local guarded executor
unit profile and builds replay-resume timeout cases from the existing chunk
transfer timeout proof API.

Variant 4 asserts:

- the RPP-0758 timeout-budget variant 3 lane is carried forward with its
  RPP-0738 and RPP-0718 lineage recorded as hash/count evidence;
- deterministic replay-resume cases cover transfer timeout after 1, 2, 3, and
  4 durable local chunk receipts;
- every generated case times out during chunk transfer before apply opens;
- resume replays the whole manifest but skips chunks with exact pre-timeout
  receipts;
- resume uploads only unreceipted chunks after timeout;
- duplicate chunk bytes and duplicate mutation work are both `0`;
- mutation apply opens only after file staging finalizes;
- output is blocked until the complete correctness gate vector is recorded and
  passing; and
- support-only release and integration recommendation remain `NO-GO`.

## Local storage/performance evidence

The variant 4 projection uses support-only local evidence:

- profile: `unit`
- guarded executor file bytes: `1048576`
- guarded executor chunk size: `262144`
- guarded executor chunk count: `4`
- receipt backend: `lab-file-journal-receipts`
- storage proof: `support-only-lab-file-journal`
- production backed: `false`
- replay-resume case count: `4`
- replay timeout receipt counts: `1`, `2`, `3`, `4`
- replay manifest chunk counts: `4`, `5`, `6`, `7`
- replay unreceipted chunk counts: `3`, `3`, `3`, `3`
- total chunks replayed on resume: `22`
- total chunks skipped by receipt: `10`
- total chunks uploaded after resume: `12`
- duplicate chunk bytes: `0`
- duplicate mutation work: `0`
- mutation work before timeout: `0`
- mutation work before transfer finalization: `0`
- fresh mutation work during transfer resume: `0`
- apply opened after transfer finalization: `true`

The public projection hashes plan identity, resource identity, receipt keys,
manifest identity, finalized file identity, replay case summaries, replay
decisions, and resolver decisions. It keeps counts, budgets, booleans, sequence
numbers, gate statuses, blocker identifiers, and decision hashes.

## Variant 4 gates

The proof recomputes this gate vector before emitting output:

1. `built-on-timeout-budget-v3-passed`
2. `deterministic-replay-resume-cases-covered`
3. `timeout-budget-interrupts-transfer-before-apply`
4. `pre-timeout-receipts-skip-replayed-chunks`
5. `resume-uploads-only-unreceipted-chunks`
6. `no-duplicate-mutation-work`
7. `apply-opens-after-transfer-finalize`
8. `unit-storage-performance-budget`
9. `hash-count-only-timeout-evidence`
10. `support-only-release-no-go`

If otherwise passing evidence loses a receipt match, reuploads a receipted
chunk, records duplicate mutation work, no longer proves timeout before
transfer completion, opens apply before transfer finalization, exceeds the unit
runtime budget, or clears the recorded correctness gates, the resolver blocks
output and records the failing gate identifiers.

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

This proof does not claim production storage durability, production row batch
execution, production atomic group commit, live topology, credentials, release
approval, or rollout safety. It proves only local support-path timeout budget
behavior, exact local receipt skips, upload of only unreceipted chunks after
timeout, zero duplicate mutation work, unit runtime/resource gates, and
fail-closed stale or incomplete evidence behavior.

## Redaction posture

Timeout budget evidence is hash-and-count-only. It stores receipt counts,
duplicate-work counters, replay decision hashes, runtime budgets, gate status
vectors, blocker identifiers, and hashes of resource identities, receipts,
generated case summaries, and resolver outputs. It does not store logical
paths, raw file content, row payloads, option values, meta values, live service
configuration, credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0778-timeout-budget-proof-v4.test.js`
- `node --test --test-name-pattern RPP-0778 test/rpp-0778-timeout-budget-proof-v4.test.js`
- `node --test --test-name-pattern RPP-0758 test/rpp-0758-timeout-budget-proof-v3.test.js`
- `node --test --test-name-pattern RPP-0738 test/rpp-0738-timeout-budget-proof-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0778-timeout-budget-proof-v4.md`
- `git diff --check`

Observed result after local validation:

- syntax check: passed
- RPP-0778 proof test: 2 pass, 0 fail
- Adjacent RPP-0758 timeout-budget proof test: 2 pass, 0 fail
- Adjacent RPP-0738 timeout-budget proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
