# RPP-0705 filesystem fsync evidence

Evidence for RPP-0705. This slice adds a focused filesystem fsync storage
boundary on top of same-directory temp writes: planned bytes are written to a
temp file, the temp file is fsynced before any live storage compare, the live
storage descriptor must still match the expected descriptor before rename, the
target directory is fsynced after rename, and the post-rename storage descriptor
must match the planned descriptor before the fast-path lane records an update.

## Guard behavior

The storage adapter reports:

- boundary: `filesystem-fsync-evidence`
- engine: `filesystem`
- fsync strategy: `temp-file-before-rename-and-directory-after-rename`
- temp placement: same directory as the target
- visibility boundary: `same-directory-rename-after-temp-fsync`
- fast-path lane: `filesystem-fsync-fast-path`
- lane policy: `update-only-after-correctness-gates-pass`

A matching update/create write yields `outcome: applied`, records temp-file and
target-directory fsync status `passed`, re-reads the post-rename descriptor, and
sets `fastPathLane.updated: true` only when every correctness gate has status
`pass`. Drifted storage yields `outcome: stale-at-write`, does not attempt the
rename, removes the temp file, and leaves the lane blocked by
`live-storage-mismatch`. A temp-file fsync failure yields
`outcome: fsync-failed-before-rename`, does not attempt the rename, and blocks
the lane by `temp-file-fsync-missing`. A target-directory fsync failure records
`outcome: applied-fsync-incomplete` but withholds the fast-path lane update via
`target-directory-fsync-missing`.

Correctness gates evaluated before a lane update:

1. `temp-file-fsync-before-live-compare`
2. `live-storage-precondition-match`
3. `rename-after-correct-live-compare`
4. `target-directory-fsync-after-rename`
5. `post-rename-storage-matches-planned`

Evidence stores logical paths, counters, statuses, and SHA-256 hashes only; it
omits file payload bytes and absolute paths.

## Focused validation

Command:

- `node --test test/filesystem-fsync-evidence.test.js test/filesystem-fsync-evidence-benchmark.test.js`

Result:

- 8 tests, 8 ok, 0 failed

## Large-site budget run

Command:

- `node scripts/bench/filesystem-fsync-evidence.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `1292.38 ms` within the documented `12000 ms` budget
- heap used: `6813864 bytes` within the documented `268435456 bytes` budget
- guarded writes attempted: `40`
- applied writes: `34`
- fully fsynced applied writes with lane updates: `32`
- applied writes withheld from the lane after directory fsync failure: `2`
- stale-at-write rejections: `4`
- temp-file fsync failures before rename: `2`
- fast-path lane updates: `32`
- fast-path lane blocks: `8`
- lane blockers: `live-storage-mismatch: 4`, `target-directory-fsync-missing: 2`, `temp-file-fsync-missing: 2`
- temp leaks: `0`

All benchmark gates reported `pass`: deterministic fsync guard behavior,
correctness gates before fast-path lane updates, temp and directory fsync
requirements for lane updates, stale storage rejection, temp fsync failure
blocking, directory fsync failure lane withholding, temp cleanup, hash-only
evidence, and runtime resource budget.

## Limits

This is focused local filesystem fsync storage evidence. It does not claim
production remote storage receipts, production row batching, atomic group commit
behavior, release-verifier carry-through, or generic filesystem locking.
