# AO release CI gate evidence

Date: 2026-05-28
Lane: release-ci-gates
Primary checklist range: RPP-0001 through RPP-0020, plus release-ops CI blocking proof.

## What changed

- Added `scripts/release/check-release-gates.mjs`, a local CI-style JSON command around the existing fail-closed release gate evaluator.
- Added `npm run check:release-gates` so release checks can call the gate without depending on a human-readable progress report.
- The command exits `0` only when `releaseMovement.allowed` is `true` with `final-release` evidence.
- Missing, failed, or local-candidate-only gates are grouped under `missingProductionEvidenceBuckets` so CI logs name the blocked evidence bucket and gate code.
- Complete local candidate evidence remains a nonzero release check and is reported as missing production evidence rather than release readiness.

## CI command contract

```sh
node ./scripts/release/check-release-gates.mjs
# or, through package scripts without npm's banner:
npm run -s check:release-gates
```

The Node command (and the silent npm wrapper) writes machine-readable JSON on stdout. The top-level fields include:

- `ok` and `exitCode`
- `primaryFailureCode` and `primaryFailureBucket`
- `releaseMovement` and `candidateMovement`
- `statusMarker`
- `missingProductionEvidenceBuckets`
- full `evaluation` from `src/release-gates.js`

With no production evidence, the command is expected to exit `1` and include the named topology bucket entries for:

- `REPRINT_PUSH_SOURCE_URL`
- `REPRINT_PUSH_LOCAL_URL`
- `REPRINT_PUSH_REMOTE_CHANGED_URL`

## Focused verification

Commands run for this lane:

```sh
node --check scripts/release/check-release-gates.mjs
node --test test/release-gate-cli.test.js test/release-gates.test.js
npm run -s check:release-gates
git diff --check
```

Observed results:

- `node --check scripts/release/check-release-gates.mjs`: exit `0`.
- `node --test test/release-gate-cli.test.js test/release-gates.test.js`: 12 pass / 0 fail.
- `npm run -s check:release-gates`: exit `1` with `primaryFailureCode: "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"`; named buckets were `topology`, `auth`, `identity`, `route`, `recovery`, and `operator-proof`.
- `git diff --check`: exit `0`.

Focused behavior covered by `test/release-gate-cli.test.js`:

1. `package.json` wires `check:release-gates` to `scripts/release/check-release-gates.mjs`.
2. Missing production topology evidence exits nonzero with JSON and named missing evidence buckets.
3. Complete `local-candidate` evidence exits nonzero and keeps `releaseMovement.allowed: false`.
4. Complete `final-release` evidence exits zero with no missing production evidence buckets.

## Release posture

This lane does **not** move final readiness. It adds a fail-closed CI command that blocks release movement until production-scoped evidence exists for every release gate.
