# RPP-0784 filesystem compare-and-rename write release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0784 filesystem compare-and-rename write release verifier carry-through, variant 5
Checklist item: RPP-0784 - Carry through the release verifier for filesystem compare-and-rename write, variant 5.

## Scope

This slice adds deterministic local release-verifier support evidence for the
existing RPP-0704 filesystem compare-and-rename write guard. It runs the
filesystem benchmark command through Node and projects the command report into
a hash/count-only verifier proof.

The proof is support-only. It does not claim production filesystem durability,
external storage receipts, fsync behavior, cross-process locking, live traffic
behavior, or release eligibility. Final release posture and integration
recommendation remain **NO-GO** until separate production-backed release
evidence exists.

## Proof surface

`test/rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5.test.js`
verifies that the benchmark command reports the data needed by the local
release verifier:

- runtime metadata: benchmark id, generated timestamp, duration, Node version,
  platform, architecture, CPU count, and configured runtime budgets;
- process resources: user CPU, system CPU, max RSS, heap used, and heap delta;
- storage resources: guarded write attempts, applied writes, stale-at-write
  refusals, unsafe rename-on-stale writes, temp leak count, byte counts, and
  compared-field count;
- filesystem atomicity: same-directory temporary files, live descriptor compare
  before rename, and same-directory rename visibility;
- pass/fail benchmark gates: deterministic guard behavior, matching storage
  renames, stale storage rejection and preservation, same-directory
  compare-before-rename evidence, temp cleanup, hash-only evidence, and runtime
  resource budget; and
- release-verifier posture with `supportOnly: true`, `productionBacked: false`,
  `releaseEligible: false`, final release status `NO-GO`, and integration
  recommendation `NO-GO`.

## Pass-gate support run

The focused pass-gate run uses the existing filesystem benchmark command with
local unit-sized inputs:

```sh
node scripts/bench/filesystem-compare-rename-write.js --profile=unit --update-files=5 --create-files=4 --stale-files=4 --file-bytes=4096 --max-duration-ms=5000 --max-heap-used-bytes=268435456
```

The test asserts this command emits a JSON report with:

- 13 guarded write attempts;
- 9 applied writes;
- 4 stale-at-write rejections;
- 0 unsafe rename-on-stale writes;
- 0 temp leaks;
- 53248 bytes written to temporary files;
- 36864 bytes renamed into place;
- 16384 bytes of drifted content preserved;
- all seven benchmark gates passing; and
- a release-verifier support proof whose public evidence stores counts,
  statuses, budget values, blocker posture, and SHA-256 evidence sample hashes.

## Fail-gate coverage

The focused fail-gate run uses an impossible heap budget while keeping the
filesystem guard cases valid:

```sh
node scripts/bench/filesystem-compare-rename-write.js --profile=unit --update-files=2 --create-files=1 --stale-files=1 --file-bytes=1024 --max-duration-ms=5000 --max-heap-used-bytes=1
```

The test asserts the command still emits runtime metadata, resource usage,
storage counts, and the full pass/fail gate vector. Only the
`large-site-runtime-budget` gate fails; deterministic guard behavior, matching
storage renames, stale rejection, temp cleanup, and hash-only evidence remain
passing. The fail-gate proof also stays support-only with final release status
`NO-GO`.

## Redaction posture

The RPP-0784 public verifier projection is hash/count-only. It records no file
payload bytes, temporary filenames, absolute paths, logical filesystem paths,
option values, post content, credentials, cookies, bearer values, live URLs, or
production identifiers. The focused test checks the proof objects with both a
filesystem-specific raw marker scan and the shared evidence redaction checker.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0784 test/rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0764 test/rpp-0764-filesystem-compare-and-rename-write-v4.test.js
node --test --test-name-pattern RPP-0744 test/rpp-0744-filesystem-compare-and-rename-write-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5.test.js`: exit 0
- RPP-0784 proof test: 2 pass, 0 fail
- Adjacent RPP-0764 proof test: 3 pass, 0 fail
- Adjacent RPP-0744 proof test: 3 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Release recommendation

Integration recommendation: **NO-GO**.

This is deterministic local release-verifier support evidence only. It does not
prove live production filesystem storage durability or final release
eligibility.
