# RPP-0744 filesystem compare-and-rename write variant 3 evidence

Evidence for RPP-0744. This slice is local support-only generated coverage for
the RPP-0704 filesystem compare-and-rename write guard. Final release remains
**NO-GO** without production-backed storage receipts, external filesystem
durability proof, and release-verifier carry-through.

## Proof scope

The standalone proof test
`test/rpp-0744-filesystem-compare-and-rename-write-v3.test.js` exercises the
existing filesystem guarded write boundary:

- boundary: `filesystem-compare-rename`
- adapter: `filesystem-compare-rename`
- engine: local filesystem
- compared fields: `exists`, `type`, `sizeBytes`, `contentHash`
- temp placement: same directory as the target
- visibility boundary: same-directory rename after live descriptor comparison

Variant 3 asserts:

- generated matching update cases keep the previous target visible while the
  temp file exists, then rename after live storage comparison;
- generated matching create cases keep the target absent while the temp file
  exists, then rename after the absent descriptor matches;
- generated stale cases drift after the temp write and reject before rename;
- stale rejection preserves drifted bytes, records no unsafe rename-on-stale
  writes, and removes temporary files;
- public proof projections store counts, gate status vectors, runtime budgets,
  blocker identifiers, and evidence sample hashes instead of payload bytes,
  temp filenames, absolute paths, or logical filesystem paths; and
- the support-only release projection keeps final release status and integration
  recommendation at `NO-GO`.

## Large-site budget proof

The variant 3 proof includes a real local `large-site` run through the existing
RPP-0704 benchmark API. The documented large-site budget is:

- expected writes: `160`
- update writes: `96`
- create writes: `32`
- stale writes: `32`
- file size: `262144 bytes`
- max duration: `12000 ms`
- max heap used: `268435456 bytes`

Passing local evidence requires the `large-site-runtime-budget` benchmark gate
to pass, all storage counts to match the documented workload, zero unsafe
rename-on-stale writes, zero temporary file leaks, and zero raw-value evidence
leaks.

## Support-only release posture

The variant 3 projection keeps this lane out of release readiness:

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

- `node --check test/rpp-0744-filesystem-compare-and-rename-write-v3.test.js`
- `node --test --test-name-pattern RPP-0744 test/rpp-0744-filesystem-compare-and-rename-write-v3.test.js`
- `node --test --test-name-pattern RPP-0724 test/rpp-0724-filesystem-compare-and-rename-write-v2.test.js`
- `node --test test/filesystem-compare-rename-write-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0744-filesystem-compare-and-rename-write-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- RPP-0744 proof test: 3 pass, 0 fail
- Adjacent RPP-0724 proof test: 3 pass, 0 fail
- Adjacent RPP-0704 filesystem benchmark coverage: 3 pass, 0 fail
- Large-site local support run: `ok: true`, `4921.43 ms` within the documented
  `12000 ms` budget, `6523928 bytes` heap used within the documented
  `268435456 bytes` budget
- Large-site storage counts: 160 guarded writes, 128 applied writes, 32
  stale-at-write rejections, 0 unsafe rename-on-stale writes, 0 temp leaks
- Large-site bytes: 33554432 renamed bytes, 8388608 drift-preserved bytes
- Scoped artifact redaction scan: pending local validation
- Diff whitespace checks: pending local validation

## Redaction posture

The variant 3 public proof projection is hash-and-count-only. It stores storage
guard counts, byte counts, gate status vectors, runtime budgets, release blocker
identifiers, and hashes of benchmark evidence samples. It does not store file
payloads, temp filenames, absolute paths, logical filesystem paths, option
values, post content, credentials, cookies, bearer tokens, or live URLs.
