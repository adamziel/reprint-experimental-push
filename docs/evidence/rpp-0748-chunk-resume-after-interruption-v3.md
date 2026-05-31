# RPP-0748 chunk resume after interruption variant 3 evidence

Evidence for RPP-0748. This slice is local support-only generated coverage for
chunk transfer resume after interruption. Final release remains **NO-GO**
because this proof does not provide production storage receipts, production row
batch executor evidence, production atomic group commit evidence, live
topology, credentials, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0748-chunk-resume-after-interruption-v3.test.js` runs the local
guarded executor unit profile and builds generated interruption cases from the
existing chunk timeout proof API.

Variant 3 asserts:

- the RPP-0738 timeout-budget variant 2 lane is carried forward with its
  RPP-0718 source timeout proof hash;
- generated interruption cases cover resume after 1, 2, 3, and 4 durable local
  chunk receipts;
- every generated case resumes only from exact receipt-backed chunks;
- unacknowledged chunks are uploaded after resume and are not marked complete
  before receipt evidence exists;
- duplicate chunk bytes and duplicate mutation work are both `0`;
- mutation apply opens only after file staging finalizes;
- output is blocked until the complete correctness gate vector is recorded and
  passing; and
- support-only release and integration recommendation remain `NO-GO`.

## Local storage/performance evidence

The variant 3 projection uses support-only local evidence:

- profile: `unit`
- guarded executor file bytes: `1048576`
- guarded executor chunk size: `262144`
- guarded executor chunk count: `4`
- receipt backend: `lab-file-journal-receipts`
- storage proof: `support-only-lab-file-journal`
- production backed: `false`
- generated interruption case count: `4`
- generated interruption points: `1`, `2`, `3`, `4`
- generated total chunks skipped by receipt: `10`
- generated total chunks uploaded after resume: `8`
- generated duplicate chunk bytes: `0`
- generated duplicate mutation work: `0`
- generated mutation work before interruption: `0`
- generated mutation work before transfer finalization: `0`
- apply opened after transfer finalization: `true`

The public projection hashes plan identity, resource identity, receipt keys,
manifest identity, finalized file identity, generated case summaries, and
resolver decisions. It keeps counts, budgets, booleans, sequence numbers, gate
statuses, and decision hashes.

## Variant 3 gates

The proof recomputes this gate vector before emitting output:

1. `built-on-timeout-budget-v2-passed`
2. `generated-interruption-cases-covered`
3. `durable-local-receipts-before-interruption`
4. `receipt-only-resume-after-interruption`
5. `no-duplicate-mutation-work`
6. `apply-opens-after-transfer-finalize`
7. `unit-storage-performance-budget`
8. `hash-count-only-storage-performance-evidence`
9. `support-only-release-no-go`

If otherwise passing evidence loses a receipt match, records duplicate mutation
work, opens apply before transfer finalization, exceeds the unit runtime budget,
or clears the recorded correctness gates, the resolver blocks output and records
the failing gate identifiers.

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
approval, or rollout safety. It proves only local support-path chunk resume
after interruption, exact local receipt skips, zero duplicate mutation work,
unit runtime/resource gates, and fail-closed stale or incomplete evidence
behavior.

## Redaction posture

Chunk resume interruption evidence is hash-and-count-only. It stores receipt
counts, duplicate-work counters, runtime budgets, gate status vectors, blocker
identifiers, and hashes of resource identities, receipts, generated case
summaries, and resolver outputs. It does not store logical paths, raw file
content, row payloads, option values, meta values, live service configuration,
credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0748-chunk-resume-after-interruption-v3.test.js`
- `node --test --test-name-pattern RPP-0748 test/rpp-0748-chunk-resume-after-interruption-v3.test.js`
- `node --test --test-name-pattern RPP-0738 test/rpp-0738-timeout-budget-proof-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0748-chunk-resume-after-interruption-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- syntax check: passed
- RPP-0748 proof test: 2 pass, 0 fail
- Adjacent RPP-0738 timeout-budget proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
