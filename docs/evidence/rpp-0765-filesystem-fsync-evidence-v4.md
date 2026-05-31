# RPP-0765 filesystem fsync evidence variant 4

Evidence for RPP-0765. This variant adds focused local regression coverage for
the filesystem fsync storage boundary. It verifies that the fast-path lane
updates only after correctness gates hold, and keeps final release posture
**NO-GO** because the evidence is local support-only.

## Proof scope

The standalone proof test
`test/rpp-0765-filesystem-fsync-evidence-v4.test.js` exercises the existing
filesystem fsync adapter:

- boundary: `filesystem-fsync-evidence`
- adapter: `filesystem-compare-rename-fsync`
- engine: local filesystem
- fsync strategy: `temp-file-before-rename-and-directory-after-rename`
- visibility boundary: `same-directory-rename-after-temp-fsync`
- fast-path lane: `filesystem-fsync-fast-path`
- lane policy: `update-only-after-correctness-gates-pass`

Variant 4 asserts:

- matching update and create writes enter the fast-path lane only after every
  correctness gate passes;
- stale storage rejects before rename and does not update the lane;
- temp-file fsync failure rejects before rename and does not update the lane;
- target-directory fsync failure records `applied-fsync-incomplete` and still
  withholds the lane update;
- a post-rename descriptor mismatch records `applied-fsync-incomplete` and
  withholds the lane update even when the target-directory fsync gate passes;
- generated benchmark coverage keeps the same lane blockers:
  `live-storage-mismatch`, `temp-file-fsync-missing`, and
  `target-directory-fsync-missing`; and
- the public proof projection is hash-and-count-only and excludes payload
  bytes, absolute paths, temp filenames, logical filesystem paths, option
  values, credentials, cookies, and live URLs.

## Correctness gates before lane updates

The fast-path lane can update only when these gates all pass:

1. `temp-file-fsync-before-live-compare`
2. `live-storage-precondition-match`
3. `rename-after-correct-live-compare`
4. `target-directory-fsync-after-rename`
5. `post-rename-storage-matches-planned`

The focused matrix checks every evidence object with the invariant
`fastPathLane.updated === (outcome === applied && every correctness gate
status is pass)`. Stale, temp-fsync-failed, directory-fsync-incomplete, and
post-rename-mismatch evidence must retain `fastPathLane.updated: false` with a
blocker identifier.

## Local support proof

The focused RPP-0765 local matrix records only counts and hashes:

- guarded writes: `6`
- fast-path lane updates: `2`
- fast-path lane blocks: `4`
- applied fsync-complete writes: `2`
- applied fsync-incomplete writes: `2`
- stale-at-write writes: `1`
- temp-file fsync failure writes: `1`
- focused blockers: `live-storage-mismatch`, `temp-file-fsync-missing`,
  `target-directory-fsync-missing`, and `post-rename-storage-mismatch`

The generated benchmark projection builds on the RPP-0705 filesystem fsync
benchmark with a complete public sample set:

- update files: `4`
- create files: `2`
- stale files: `2`
- temp-file fsync failure files: `1`
- target-directory fsync failure files: `1`
- file bytes: `1024`
- expected guarded writes: `10`
- expected fast-path lane updates: `6`
- expected fast-path lane blocks: `4`

The deterministic projection compares focused projection hashes, benchmark gate
vectors, sanitized benchmark projection hashes, and sanitized evidence sample
hashes across repeated local runs.

## Support-only release posture

The variant 4 release projection remains out of release readiness:

- `supportOnly: true`;
- `productionBacked: false`;
- production storage receipts are `not-claimed`;
- external durability is `not-claimed`;
- release-verifier carry-through is `not-claimed`;
- production throughput is `not-claimed`;
- speed claims are disabled; and
- final release status and integration recommendation remain `NO-GO`.

This evidence does not claim production filesystem durability, remote receipt
durability, database transaction behavior, release approval, or generic
filesystem locking.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0765-filesystem-fsync-evidence-v4.test.js`
- `node --test --test-name-pattern RPP-0765 test/rpp-0765-filesystem-fsync-evidence-v4.test.js`
- `node --test --test-name-pattern RPP-0745 test/rpp-0745-filesystem-fsync-evidence-v3.test.js`
- `node --test --test-name-pattern RPP-0725 test/rpp-0725-filesystem-fsync-evidence-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0765-filesystem-fsync-evidence-v4.md`
- `git diff --check`

Observed result after local validation:

- RPP-0765 syntax check: pass
- RPP-0765 proof test: 2 pass, 0 fail
- Adjacent RPP-0745 proof test: 2 pass, 0 fail
- Adjacent RPP-0725 proof test: 3 pass, 0 fail
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Redaction posture

The public proof projection stores storage counters, gate status vectors,
runtime budgets, release blocker identifiers, and hashes of sanitized evidence
samples. It does not store file payloads, temp filenames, absolute paths,
logical filesystem paths, private option values, post content, credentials,
cookies, bearer tokens, or external URLs.
