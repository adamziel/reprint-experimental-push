# RPP-0715 large media library benchmark evidence

Evidence for RPP-0715. This slice adds a focused large media library benchmark
that drives upload-path storage through the existing filesystem fsync guard and
binds each media object to attachment row and metadata row preconditions before
the media fast-path lane can update.

## Benchmark behavior

The benchmark command is:

- `node scripts/bench/large-media-library-benchmark.js --profile=large-site`

The report includes:

- storage boundary: `filesystem-fsync-evidence`
- media file driver: `benchmark-media-library-file`
- fast-path lane: `large-media-library-fast-path`
- lane policy: `update-only-after-storage-and-row-correctness-gates-pass`
- database surfaces: `wp_posts` attachment rows and `wp_postmeta` attachment
  metadata rows
- batch policy: primary-key ordered row batches bounded by `maxDbBatchRows`

For matching update/create media files, the lane updates only after the temp file
fsyncs, the live storage precondition matches, the rename completes, the target
directory fsyncs, the post-rename storage descriptor matches the planned
descriptor, and the attachment plus metadata rows retain per-row expected remote
hashes. Drifted media storage blocks rename and lane update. Temp-file fsync
failure blocks rename and lane update. Target-directory fsync failure may leave
the file applied, but the lane update is withheld.

Evidence stores logical upload paths, counters, statuses, row hashes, and
SHA-256 storage hashes only. It does not store media payload bytes, attachment
titles, metadata values, operator credentials, or raw remote URLs.

## Focused validation

Command:

- `node --test test/large-media-library-benchmark.test.js`

Result:

- 3 tests, 3 ok, 0 failed

The focused test asserts runtime/resource reporting, database batch sizing,
hash-only evidence, blocked stale writes, fsync-failure lane withholding, and
that `gates` appears before `fastPathLane` in the benchmark output.

## Large-site budget run

Command:

- `node scripts/bench/large-media-library-benchmark.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `5039.79 ms` within the documented `12000 ms` budget
- heap used: `5309568 bytes` within the documented `268435456 bytes` budget
- media writes attempted: `144`
- applied media writes: `132`
- fully fsynced applied media writes with lane updates: `128`
- applied media writes withheld from the lane after directory fsync failure: `4`
- stale-at-write media rejections: `8`
- temp-file fsync failures before rename: `4`
- fast-path lane updates: `128`
- fast-path lane blocks: `16`
- lane blockers: `live-storage-mismatch: 8`,
  `target-directory-fsync-missing: 4`, `temp-file-fsync-missing: 4`
- attachment rows preconditioned: `144`
- metadata rows preconditioned: `576`
- total row preconditions retained: `720`
- row preconditions attached to lane updates: `640`
- database batches: `3`
- max rows in any batch: `500`
- batches over limit: `0`
- temp leaks: `0`
- bytes admitted to the fast-path lane: `12582912`

All benchmark gates reported `pass`: deterministic media-library behavior,
fast-path lane updates only after correctness gates, attachment row
preconditions retained, media database batches within budget, stale media
storage blocking, fsync failure blocking/withholding, temp cleanup, hash-only
evidence, and runtime resource budget.

## Limits

This is focused local storage/performance benchmark evidence for a large media
library shape. It does not claim production remote storage receipts, production
row batching, production atomic group commit behavior, topology import/export
coverage, release-verifier carry-through, or generic filesystem locking.
