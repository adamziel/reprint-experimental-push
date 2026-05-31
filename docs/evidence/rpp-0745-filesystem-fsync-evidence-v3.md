# RPP-0745 filesystem fsync evidence variant 3

Evidence for RPP-0745. This variant is local support-only coverage for the
existing filesystem fsync storage boundary. It keeps the fast-path lane behind
correctness gates and keeps final release posture **NO-GO** unless
production-backed storage evidence exists.

## Proof scope

The standalone proof test
`test/rpp-0745-filesystem-fsync-evidence-v3.test.js` exercises generated local
filesystem outcomes against the existing storage adapter:

- boundary: `filesystem-fsync-evidence`
- adapter: `filesystem-compare-rename-fsync`
- engine: local filesystem
- fsync strategy: `temp-file-before-rename-and-directory-after-rename`
- visibility boundary: `same-directory-rename-after-temp-fsync`
- fast-path lane: `filesystem-fsync-fast-path`
- lane policy: `update-only-after-correctness-gates-pass`

Variant 3 asserts:

- matching update and create writes enter the fast-path lane only after all
  correctness gates pass;
- stale storage rejects before rename and does not update the lane;
- temp-file fsync failure rejects before rename and does not update the lane;
- target-directory fsync failure records `applied-fsync-incomplete` and still
  withholds the lane update;
- generated benchmark coverage preserves the same lane blockers:
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

The generated matrix checks every evidence object with the same invariant:
`fastPathLane.updated` must equal `outcome === applied` and every correctness
gate status must be `pass`. Any stale, failed fsync, or incomplete fsync
evidence must retain `fastPathLane.updated: false` with a blocker identifier.

## Local storage and performance proof

The variant 3 projection builds on the RPP-0705 filesystem fsync benchmark with
a generated local workload:

- update files: `3`
- create files: `2`
- stale files: `2`
- temp-file fsync failure files: `1`
- target-directory fsync failure files: `1`
- file bytes: `1024`
- expected guarded writes: `9`
- expected fast-path lane updates: `5`
- expected fast-path lane blocks: `4`

The support proof records local runtime budget status and guarded write counts,
but production throughput remains `not-claimed` and speed claims remain
disabled. Runtime budget failure makes the proof status fail while the release
projection remains `NO-GO`.

## Support-only release posture

The variant 3 release projection remains out of release readiness:

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

- `node --check test/rpp-0745-filesystem-fsync-evidence-v3.test.js`
- `node --test --test-name-pattern RPP-0745 test/rpp-0745-filesystem-fsync-evidence-v3.test.js`
- `node --test --test-name-pattern RPP-0725 test/rpp-0725-filesystem-fsync-evidence-v2.test.js`
- `node --test test/filesystem-fsync-evidence-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0745-filesystem-fsync-evidence-v3.md`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- RPP-0745 proof test: generated storage matrix and support-only performance
  projection pass
- Adjacent RPP-0725 proof test: pass
- Filesystem fsync benchmark test: pass
- Scoped artifact redaction scan: `ok: true`
- Diff whitespace checks: clean

## Redaction posture

The public proof projection stores storage counters, byte counts, gate status
vectors, runtime budgets, release blocker identifiers, and hashes of benchmark
evidence samples. It does not store file payloads, temp filenames, absolute
paths, logical filesystem paths, private option values, post content,
credentials, cookies, bearer tokens, or external URLs.
