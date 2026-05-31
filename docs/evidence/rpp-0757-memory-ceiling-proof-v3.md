# RPP-0757 memory ceiling proof variant 3 evidence

Evidence for RPP-0757. This slice is deterministic local support-only generated
coverage for the existing RPP-0717 filesystem memory-ceiling guarded write
boundary. Final release remains **NO-GO** because this proof does not supply a
live production service, production storage receipts, production row batch
execution, production atomic group commit evidence, or release-verifier
carry-through.

## Proof scope

The focused proof test
`test/rpp-0757-memory-ceiling-proof-v3.test.js` exercises the existing
filesystem memory-ceiling guarded write boundary:

- boundary: `filesystem-memory-ceiling`
- adapter: `filesystem-streaming-compare-rename`
- engine: local filesystem
- compared fields: `exists`, `type`, `sizeBytes`, `contentHash`
- temp placement: same directory as the target
- memory policy: `planned-payload-streamed-in-bounded-chunks`
- enforcement point: before the live storage compare
- visibility boundary: same-directory rename after live descriptor comparison

Variant 3 asserts:

- planned bytes are streamed to a same-directory temp file in bounded chunks;
- the live storage descriptor is read after the temp write and before rename;
- stale target drift resolves as `stale-at-write`;
- stale writes do not attempt rename, remove the temp file, and preserve the
  drifted target state;
- two stale generated samples are rejected under the benchmark-backed proof;
- memory-ceiling counters stay within configured buffered-byte limits before
  the live compare;
- emitted output is blocked until the complete correctness gate vector is
  present and passing; and
- public proof evidence is hash-and-count-only.

## Local proof profile

The variant 3 projection runs the RPP-0717 benchmark API with fixed local unit
inputs:

- update files: `3`
- create files: `2`
- stale files: `2`
- file size: `65536` bytes
- chunk size: `4096` bytes
- maximum buffered planned payload: `4096` bytes
- guarded writes attempted: `7`
- expected applied writes: `5`
- expected stale-at-write rejections: `2`
- expected unsafe rename-on-stale writes: `0`
- expected preserved stale drift bytes: `131072`

The direct stale-write proof also mutates the target after the streamed temp
write and verifies that the guard rejects the stale live descriptor before any
rename is attempted.

## Variant 3 gates

The proof recomputes this gate vector before emitting output:

1. `benchmark-memory-ceiling-gates-pass`
2. `guarded-writes-reject-stale-storage-state`
3. `stale-rejection-preserves-drift`
4. `memory-ceiling-held-before-live-compare`
5. `same-directory-compare-before-rename`
6. `deterministic-hash-only-evidence`
7. `runtime-resource-budget`
8. `support-only-release-no-go`

The output is emitted only after all eight gates pass. If otherwise passing
evidence is changed to remove stale-write counts, claim a rename on stale
storage, breach the memory ceiling, or clear the recorded gate vector, the
resolver blocks output and records the failing gate.

## Stale storage refusal

The success criterion for this slice is guarded-write refusal for stale storage
state. The local proof covers that behavior in two ways:

- a focused write-level case writes planned bytes to temp, changes the target
  before compare, and observes `outcome: stale-at-write`;
- the benchmark-backed projection records two stale writes, two preserved
  drifts, zero unsafe rename-on-stale writes, and zero temp leaks.

The stale evidence stores descriptor hashes, counts, byte totals, gate hashes,
and sample hashes. It does not store file payload bytes, temp filenames,
absolute filesystem paths, live service configuration, credentials, cookies, or
live URLs.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch execution is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim production storage performance, production filesystem
durability, remote receipt durability, database transaction behavior, release
approval, or live-site rollout safety.

## Validation

Required validation commands for this slice:

- `node --check test/rpp-0757-memory-ceiling-proof-v3.test.js`
- `node --test --test-name-pattern RPP-0757 test/rpp-0757-memory-ceiling-proof-v3.test.js`
- `node --test --test-name-pattern RPP-0737 test/rpp-0737-memory-ceiling-proof-v2.test.js`
- `node --test test/filesystem-memory-ceiling-proof.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0757-memory-ceiling-proof-v3.md`
- `git diff --check`

Observed result after local validation:

- RPP-0757 syntax check: exit `0`
- RPP-0757 proof test: 3 pass, 0 fail
- RPP-0737 adjacent proof test: 3 pass, 0 fail
- RPP-0717 filesystem memory-ceiling proof test: 4 pass, 0 fail
- Scoped evidence redaction scan: `ok: true`, scanned files `1`,
  rejected files `0`, allowed hash evidence `0`
- Diff whitespace check: exit `0`

## Redaction posture

The variant 3 public proof projection is hash-and-count-only. It stores storage
guard counts, stale-write sample hashes, byte counts, memory-ceiling counters,
gate status vectors, runtime budgets, release blocker identifiers, and decision
hashes. It does not store file payloads, temp filenames, absolute paths,
logical filesystem paths, option values, post content, credentials, cookies, or
live URLs.
