# RPP-0724 filesystem compare-and-rename write variant 2 evidence

Evidence for RPP-0724. This slice is support-only and builds on the RPP-0704
filesystem compare-and-rename write guard. Final release remains **NO-GO**
without production-backed storage receipts, external durability proof, and
release-verifier carry-through.

## Proof scope

The standalone proof test
`test/rpp-0724-filesystem-compare-and-rename-write-v2.test.js` exercises the
existing filesystem guarded write boundary:

- boundary: `filesystem-compare-rename`
- adapter: `filesystem-compare-rename`
- engine: local filesystem
- compared fields: `exists`, `type`, `sizeBytes`, `contentHash`
- temp placement: same directory as the target
- visibility boundary: same-directory rename after live descriptor comparison

Variant 2 asserts:

- a matching update keeps the old target visible while the temp file exists, then
  renames the temp file after the live storage descriptor matches;
- a matching create keeps the target absent while the temp file exists, then
  renames the temp file after the absent descriptor matches;
- stale storage drift after the temp write is rejected before rename;
- stale rejection preserves the drifted target bytes and removes the temp file;
- direct storage guard evidence contains no payload bytes, temp names, or
  absolute filesystem paths; and
- the public RPP-0724 proof projection hashes benchmark evidence samples instead
  of storing logical paths or raw fixture identifiers.

## Benchmark gates

The proof also runs the RPP-0704 benchmark API with fixed unit inputs to verify
deterministic gate behavior:

- repeated passing runs produce the same gate status vector;
- the proof records the RPP-0704 benchmark id and a hash of the public benchmark
  projection;
- stale write counts, drift-preserved counts, temp leak counts, and unsafe
  rename-on-stale counts remain deterministic; and
- an intentionally impossible heap budget fails only the bounded runtime
  resource gate while stale rejection, atomic compare-before-rename evidence,
  gate determinism, hash-only evidence, and support-only release posture still
  pass.

## Support-only release posture

The variant 2 proof keeps this lane out of release readiness:

- `supportOnly: true`;
- `productionBacked: false`;
- production storage receipts are `not-claimed`;
- external filesystem durability is `not-claimed`;
- release-verifier carry-through is `not-claimed`; and
- final release status and integration recommendation remain `NO-GO`.

This evidence does not claim production filesystem durability, fsync coverage,
remote storage receipt durability, database transaction behavior, release
approval, or generic filesystem locking.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0724-filesystem-compare-and-rename-write-v2.test.js`
- `node --test --test-name-pattern RPP-0724 test/rpp-0724-filesystem-compare-and-rename-write-v2.test.js`
- `node --test test/filesystem-compare-rename-write.test.js test/filesystem-compare-rename-write-benchmark.test.js`
- `node scripts/bench/filesystem-compare-rename-write.js --profile=unit --update-files=2 --create-files=1 --stale-files=1 --file-bytes=1024 --max-duration-ms=100000 --max-heap-used-bytes=1073741824`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0724-filesystem-compare-and-rename-write-v2.md`
- `git diff --check`

Observed result after local validation:

- RPP-0724 proof test: 3 pass, 0 fail
- Adjacent RPP-0704 filesystem compare/rename coverage: 6 pass, 0 fail
- Bounded filesystem compare/rename benchmark: `ok: true`
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean

## Redaction posture

The variant 2 proof projection is hash-and-count-only. It stores storage guard
counts, byte counts, gate statuses, runtime budgets, production blocker
identifiers, and hashes of benchmark evidence samples. It does not store file
payloads, temp filenames, absolute paths, logical filesystem paths, plugin
paths, option values, post content, credentials, cookies, or live URLs.
