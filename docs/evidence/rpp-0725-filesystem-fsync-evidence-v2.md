# RPP-0725 filesystem fsync evidence variant 2

Evidence for RPP-0725. This slice is support-only and builds on the RPP-0705
filesystem fsync evidence benchmark. Final release remains **NO-GO** without
production storage receipts, external filesystem durability proof, and
release-verifier carry-through.

## Proof scope

The standalone proof test
`test/rpp-0725-filesystem-fsync-evidence-v2.test.js` exercises the existing
filesystem fsync storage boundary:

- boundary: `filesystem-fsync-evidence`
- adapter: `filesystem-compare-rename-fsync`
- engine: local filesystem
- fsync strategy: `temp-file-before-rename-and-directory-after-rename`
- visibility boundary: `same-directory-rename-after-temp-fsync`
- fast-path lane: `filesystem-fsync-fast-path`
- lane policy: `update-only-after-correctness-gates-pass`

Variant 2 asserts:

- temp-file fsync evidence is recorded before live storage comparison;
- live storage must match the expected descriptor before rename;
- target-directory fsync and post-rename descriptor checks both pass before a
  fast-path lane update is recorded;
- stale storage rejects without rename and without a lane update;
- temp-file fsync failure rejects before rename and without a lane update;
- target-directory fsync failure records `applied-fsync-incomplete` while still
  withholding the lane update; and
- the public proof projection is hash-only and stores counts, gate statuses,
  blocker identifiers, and evidence sample hashes instead of payload bytes,
  absolute paths, temp filenames, or logical filesystem paths.

## Correctness gates before speed claims

The proof keeps the fast-path lane and any throughput wording behind the
existing RPP-0705 correctness gates:

1. `temp-file-fsync-before-live-compare`
2. `live-storage-precondition-match`
3. `rename-after-correct-live-compare`
4. `target-directory-fsync-after-rename`
5. `post-rename-storage-matches-planned`

The variant 2 proof projects these gates into
`fsync-evidence-before-fast-path-lane-update` and
`correctness-gates-before-throughput-claims`. Passing local runs require every
updated evidence sample to have both fsync statuses `passed`, every correctness
gate `pass`, zero unsafe lane updates, and the benchmark gate
`correctness-gates-before-fast-path-lane` still passing.

Production throughput remains `not-claimed`; speed claims remain disabled in
the release projection.

## Stale and unsafe posture

The proof includes stale and unsafe local cases in the same bounded run:

- stale-at-write writes are rejected and preserve the drifted target;
- temp-file fsync failures block rename;
- directory fsync failures do not enter the fast-path lane;
- unsafe rename-on-stale and unsafe rename-after-temp-fsync-failure counters
  remain zero; and
- any runtime-budget failure keeps the proof failed while the support-only
  release posture remains `NO-GO`.

## Support-only release posture

The variant 2 projection keeps this lane out of release readiness:

- `supportOnly: true`;
- `productionBacked: false`;
- production throughput is `not-claimed`;
- speed claims are disabled;
- production storage receipts are `not-claimed`;
- external durability is `not-claimed`;
- release-verifier carry-through is `not-claimed`; and
- final release status and integration recommendation remain `NO-GO`.

This evidence does not claim production filesystem durability, remote receipt
durability, database transaction behavior, release approval, or generic
filesystem locking.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0725-filesystem-fsync-evidence-v2.test.js`
- `node --test --test-name-pattern RPP-0725 test/rpp-0725-filesystem-fsync-evidence-v2.test.js`
- `node --test test/filesystem-fsync-evidence.test.js test/filesystem-fsync-evidence-benchmark.test.js`
- `node scripts/bench/filesystem-fsync-evidence.js --profile=unit --update-files=2 --create-files=1 --stale-files=1 --temp-fsync-failure-files=1 --directory-fsync-failure-files=1 --file-bytes=1024 --max-duration-ms=100000 --max-heap-used-bytes=1073741824`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0725-filesystem-fsync-evidence-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- RPP-0725 proof test: 3 pass, 0 fail
- Adjacent RPP-0705 filesystem fsync coverage: 8 pass, 0 fail
- Bounded filesystem fsync benchmark: `ok: true`
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean

## Redaction posture

The variant 2 public proof projection is hash-and-count-only. It stores storage
guard counts, byte counts, gate status vectors, runtime budgets, release blocker
identifiers, and hashes of benchmark evidence samples. It does not store file
payloads, temp filenames, absolute paths, logical filesystem paths, option
values, post content, credentials, cookies, or live URLs.
