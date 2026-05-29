# RPP-0704 filesystem compare-and-rename write evidence

Evidence for RPP-0704. This slice adds a focused filesystem write guard that
writes planned bytes to a temporary file in the target directory, reads the live
storage descriptor after the temp write, compares the live descriptor with the
expected storage descriptor, and only then renames the temp file into the target
path.

## Guard behavior

The storage adapter reports:

- boundary: `filesystem-compare-rename`
- engine: `filesystem`
- compared fields: `exists`, `type`, `sizeBytes`, `contentHash`
- temp placement: same directory as the target
- visibility boundary: `rename-temp-to-target-after-compare`

Matching update/create storage yields `outcome: applied` and attempts the rename.
Drifted storage yields `outcome: stale-at-write`, does not attempt the rename,
removes the temp file, and preserves the drifted target bytes. Evidence stores
logical paths and SHA-256 hashes only; it does not include file payload bytes or
absolute paths.

## Focused validation

Command:

- `node --test test/filesystem-compare-rename-write.test.js test/filesystem-compare-rename-write-benchmark.test.js`

Result:

- 6 tests, 6 ok, 0 failed

## Large-site budget run

Command:

- `node scripts/bench/filesystem-compare-rename-write.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `8965.29 ms` within the documented `12000 ms` budget
- heap used: `6176960 bytes` within the documented `268435456 bytes` budget
- guarded writes attempted: `160`
- applied writes: `128`
- stale-at-write rejections: `32`
- unsafe rename-on-stale writes: `0`
- temp leaks: `0`
- bytes written to temp files: `41943040`
- bytes compared from live storage: `33554432`
- bytes renamed into targets: `33554432`
- drift-preserved bytes: `8388608`

All benchmark gates reported `pass`: deterministic guard behavior, matching
storage renames, stale storage rejection/preservation, same-directory
compare-before-rename evidence, temp cleanup, hash-only evidence, and large-site
runtime budget.

## Limits

This is focused filesystem compare-and-rename storage evidence. It does not
claim filesystem `fsync` durability, production remote storage receipts,
production row batching, atomic group commit behavior, release-verifier
carry-through, or generic filesystem locking.
