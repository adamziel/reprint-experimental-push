# RPP-0747 chunk hash verification variant 3 evidence

Evidence for RPP-0747. This slice is support-only storage/performance evidence
for generated chunk hash verification coverage. Final release remains **NO-GO**
because this proof does not provide production storage receipts, production row
batch execution, production atomic group commit evidence, a live production
service, credentials, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0747-chunk-hash-verification-v3.test.js` runs the local guarded
executor unit profile and projects hash-and-count-only chunk verification
evidence.

Variant 3 asserts:

- the carried-through chunk hash verification gate is still passed;
- every manifest chunk is re-read and verified against the chunk manifest;
- the assembled file hash matches the finalized staging hash;
- generated guard cases cover every chunk in the unit transfer;
- matching generated writes apply only when storage and manifest hashes match;
- stale storage state is rejected for every generated chunk case;
- observed chunk hash mismatch is rejected for every generated chunk case;
- rejected stale and mismatch writes write `0` bytes and perform `0` mutation
  work;
- the local unit run stays within documented duration and heap budgets; and
- generated output is blocked until the complete correctness gate vector is
  present and passing.

## Local storage/performance evidence

The variant 3 projection uses support-only local evidence:

- profile: `unit`
- file bytes: `1048576`
- chunk size: `262144`
- chunk count: `4`
- staging backend: `bench-generated-chunk-staging`
- receipt backend: `lab-file-journal-receipts`
- storage proof: `support-only-lab-file-journal`
- production backed: `false`
- verified chunks: `4`
- total verified bytes: `1048576`
- generated stale storage cases: `4`
- generated hash mismatch cases: `4`
- stale storage rejections: `4`
- hash mismatch rejections: `4`
- unsafe writes applied: `0`
- bytes written by rejected writes: `0`
- mutation work on rejected writes: `0`

The public projection hashes plan identity, resource identity, manifest
identity, finalized file identity, generated guard cases, and resolver
decisions. It keeps counts, byte totals, runtime budgets, gate statuses, blocker
identifiers, and decision hashes.

## Variant 3 gates

The proof recomputes this gate vector before emitting output:

1. `built-on-chunk-hash-verification-passed`
2. `all-manifest-chunks-verified`
3. `generated-stale-storage-coverage`
4. `guarded-writes-reject-stale-storage-state`
5. `hash-mismatch-fails-closed`
6. `no-mutation-work-on-rejected-writes`
7. `unit-storage-performance-budget`
8. `hash-only-storage-performance-evidence`
9. `support-only-release-no-go`

The output is emitted only after all nine gates pass. If otherwise passing
evidence is changed to allow stale storage, allow hash mismatch, remove a
generated case, add mutation work to rejected writes, exceed the runtime budget,
or clear the recorded correctness gates, the resolver blocks output and records
the failing gate.

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
execution, production atomic group commit behavior, live topology, credentials,
release approval, or final release readiness. It proves only local support-path
chunk hash verification, generated stale storage refusal, generated hash
mismatch refusal, unit runtime/resource gates, and fail-closed incomplete
evidence behavior.

## Redaction posture

Chunk hash verification storage/performance evidence is hash-and-count-only. It
stores verification counts, byte totals, rejected-write counters, runtime
budgets, gate status vectors, blocker identifiers, and hashes of resource
identities, generated guard cases, and resolver outputs. It does not store
logical paths, raw file content, row payloads, option values, meta values, live
service configuration, credentials, cookies, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0747-chunk-hash-verification-v3.test.js`
- `node --test --test-name-pattern RPP-0747 test/rpp-0747-chunk-hash-verification-v3.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0747-chunk-hash-verification-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result after local validation:

- RPP-0747 proof test: 3 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
