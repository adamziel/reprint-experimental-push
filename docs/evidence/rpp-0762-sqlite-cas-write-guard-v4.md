# RPP-0762 SQLite CAS write guard variant 4 evidence

Evidence for RPP-0762. This slice is deterministic local support-only coverage
for the SQLite compare-and-swap write guard. Final release/integration
recommendation remains **NO-GO** unless production-backed storage, external
durability, and live recovery evidence are added.

## Proof scope

The proof uses local in-memory `node:sqlite` databases only. It does not use
remote endpoints, tunnels, production storage, credentials, cookies, bearer
tokens, or raw private values.

Covered local boundary:

- boundary count: 1
- adapter count: 1
- operation count: 1
- surface count: 5
- stale snapshot count: 5
- stale write attempts: 5
- expected applied stale writes: 0
- expected stale rows mutated: 0

Variant 4 creates one stale storage snapshot per covered surface with key
columns preserved and non-key compared columns changed. Each guarded write uses
the original expected storage snapshot and must reject the stale row with:

- `applied` count: 0
- affected row count: 0
- `stale-at-write` outcome count: 5
- unchanged stale row count: 5
- observed stale storage hash count: 5
- SQL shape hash count: 5

The test asserts hash-only storage guard evidence for expected resource,
expected storage, planned storage, observed storage, and SQL shape. It also
asserts that observed stale storage hashes differ from expected snapshot hashes,
without recording raw storage values in this artifact.

## Local benchmark proof

Variant 4 also runs the existing SQLite CAS benchmark API with fixed local
inputs:

- iterations: 3
- surface count: 5
- guarded writes attempted: 45
- applied writes: 15
- stale-at-write rejections: 15
- absent-at-write rejections: 15
- unsafe multiple-match writes: 0
- in-memory database opens: 45
- single-statement SQL shapes: 5
- benchmark gate count: 6
- expected passing benchmark gates: 6

The benchmark-derived coverage digest is computed from counts and SQL shape
hashes only, then checked as a SHA-256 value by the test. The digest is not a
production performance claim and does not prove external durability,
cross-process locking, persistent database recovery, or live traffic behavior.

## Redaction posture

This artifact is count/hash-only. It records no row payloads, option values,
post content, meta values, serialized private values, credentials, bearer
values, cookies, external URLs, or production identifiers.

## Validation

Exact validation commands for this slice:

- `node --check test/rpp-0762-sqlite-cas-write-guard-v4.test.js`
- `node --test --test-name-pattern RPP-0762 test/rpp-0762-sqlite-cas-write-guard-v4.test.js`
- `node --test --test-name-pattern RPP-0742 test/rpp-0742-sqlite-cas-write-guard-v3.test.js`
- `node --test --test-name-pattern RPP-0722 test/rpp-0722-sqlite-cas-write-guard-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0762-sqlite-cas-write-guard-v4.md`
- `git diff --check`
- `git diff --cached --check`

Observed local results:

- RPP-0762 syntax check: exit 0
- RPP-0762 proof test: 2 pass, 0 fail, 0 skipped
- RPP-0742 adjacent proof test: 3 pass, 0 fail, 0 skipped
- RPP-0722 adjacent proof test: 2 pass, 0 fail, 0 skipped
- Scoped artifact redaction scan: `ok: true`, scanned file count 1,
  rejected file count 0
- Diff whitespace check: exit 0, clean
- Staged diff whitespace check: exit 0, clean
