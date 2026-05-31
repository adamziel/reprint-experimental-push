# RPP-0730 parallel snapshot hashing variant 2 evidence

Evidence for RPP-0730. This slice is support-only and builds on the RPP-0710
bounded parallel snapshot hashing proof. Final release remains **NO-GO**
without production storage receipts, production row batching, production atomic
group commit evidence, and release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0730-parallel-snapshot-hashing-v2.test.js` exercises the existing
guarded executor parallel snapshot hashing evidence and adds a variant 2 public
projection.

Variant 2 asserts:

- bounded parallel hashing covers the base, local, and remote snapshot hash
  sets;
- the parallel digest matches the canonical sequential digest;
- deterministic repeated runs produce the same hash-only projection;
- the fast-path lane output is emitted only after the complete correctness gate
  vector is recorded and holds;
- stale parallel hash mismatches, missing gate records, and unsafe apply
  precondition inputs block attempted lane updates; and
- the public projection stores counts, gate statuses, blocker identifiers, and
  hashes instead of raw resource keys, paths, row payloads, file bytes, plugin
  payloads, credentials, cookies, or live URLs.

## Correctness gates before lane output

The proof keeps the fast-path lane behind the RPP-0710 correctness gates:

1. `bounded-hash-concurrency`
2. `complete-snapshot-hash-set`
3. `parallel-matches-sequential`
4. `deterministic-hash-set`
5. `planning-only-no-write-authority`
6. `hash-only-evidence`

Variant 2 recomputes those gates from the hash-only evidence and requires the
gate record to appear before the fast-path lane field in the benchmark
projection. The lane output is projected only when every gate passes. Attempted
lane updates with a stale parallel digest, missing gate records, or missing live
remote apply preconditions are blocked and emit no fast-path output.

## Support-only release posture

The variant 2 projection keeps this lane out of release readiness:

- `supportOnly: true`;
- `productionBacked: false`;
- production throughput is `not-claimed`;
- speed claims are disabled;
- production storage receipts are `not-claimed`;
- production row batch execution is `not-claimed`;
- production atomic group commit is `not-claimed`;
- release-verifier carry-through is `not-claimed`; and
- final release status and integration recommendation remain `NO-GO`.

This evidence does not claim production snapshot pagination, production storage
durability, production throughput, database transaction behavior, release
approval, or live-site rollout safety.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0730-parallel-snapshot-hashing-v2.test.js`
- `node --test --test-name-pattern RPP-0730 test/rpp-0730-parallel-snapshot-hashing-v2.test.js`
- `node --test --test-name-pattern RPP-0710 test/guarded-executor-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0730-parallel-snapshot-hashing-v2.md`
- `node --input-type=module -e "import fs from 'node:fs'; import { scanArtifactText } from './scripts/release/artifact-redaction-scan.mjs'; const result = scanArtifactText(fs.readFileSync('test/rpp-0730-parallel-snapshot-hashing-v2.test.js', 'utf8')); if (result.reasons.length) { console.error(JSON.stringify(result.reasons, null, 2)); process.exit(1); } console.log(JSON.stringify({ ok: true, allowedHashEvidence: result.allowedHashEvidence }));"`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- RPP-0730 proof test: 2 pass, 0 fail
- Adjacent RPP-0710 guarded executor coverage: 1 pass, 0 fail
- Scoped evidence redaction scan: `ok: true`, 0 rejected files
- Scoped test redaction scan: `ok: true`, 0 rejected reasons
- Diff whitespace checks: clean

## Redaction posture

The variant 2 public proof projection is hash-and-count-only. It stores
scheduler counts, snapshot hash digests, gate status vectors, runtime-free lane
decisions, release blocker identifiers, and hashes of decisions. It does not
store raw resource keys, logical paths, absolute paths, row payloads, file
contents, plugin payloads, option values, post content, credentials, cookies, or
live URLs.
