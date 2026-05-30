# RPP-0717 memory ceiling proof evidence

Evidence for RPP-0717. This slice adds a focused filesystem memory-ceiling
storage proof: planned file bytes are generated into a same-directory temporary
file in bounded chunks, the live storage descriptor is read after the streamed
temp write, the live descriptor must still match the expected storage
descriptor, and only then does the write rename the temp file into the target
path.

## Guard behavior

The storage adapter reports:

- boundary: `filesystem-memory-ceiling`
- engine: `filesystem`
- adapter: `filesystem-streaming-compare-rename`
- compared fields: `exists`, `type`, `sizeBytes`, `contentHash`
- memory policy: `planned-payload-streamed-in-bounded-chunks`
- enforcement point: before the live storage compare
- visibility boundary: same-directory rename

Matching update/create storage yields `outcome: applied` and attempts the
rename. Drifted storage yields `outcome: stale-at-write`, does not attempt the
rename, removes the temporary file, and preserves the drifted target bytes. The
memory evidence records total planned bytes, chunk count, chunk size, configured
maximum buffered bytes, and observed maximum buffered bytes. Evidence stores
logical paths and SHA-256 hashes only; it does not include file payload bytes or
absolute paths.

## Focused validation

Command:

- `node --test test/filesystem-memory-ceiling-proof.test.js test/filesystem-memory-ceiling-proof-benchmark.test.js`

Result:

- 7 tests, 7 ok, 0 failed

## Large-site memory ceiling run

Command:

- `node scripts/bench/filesystem-memory-ceiling-proof.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `10152.92 ms` within the documented `12000 ms` budget
- heap used: `12673664 bytes` within the documented `268435456 bytes` budget
- configured maximum buffered planned payload: `65536 bytes`
- maximum observed buffered planned payload: `65536 bytes`
- guarded writes attempted: `40`
- applied writes: `32`
- stale-at-write rejections: `8`
- unsafe rename-on-stale writes: `0`
- temp leaks: `0`
- total planned bytes streamed: `41943040`
- planned payload chunks streamed: `640`

All benchmark gates reported `pass`: deterministic memory-ceiling guard
behavior, memory ceiling held before live compare, matching storage renames,
stale storage rejection/preservation, same-directory compare-before-rename
evidence, temp cleanup, hash-only evidence, and runtime resource budget.

## Limits

This is focused local filesystem storage-performance evidence. It proves bounded
planned-payload buffering for the guarded filesystem write path and stale
storage rejection at the storage boundary. It does not claim production remote
storage receipts, production row batching, timeout budgets, progress reporting,
filesystem `fsync` durability, generic filesystem locking, or release-verifier
carry-through.
