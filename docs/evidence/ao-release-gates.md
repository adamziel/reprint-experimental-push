# AO release-gates evidence

Date: 2026-05-28
Lane: release-gates
Primary checklist range: RPP-0001 through RPP-0025

## What changed

- Added `src/release-gates.js`, a reusable, machine-readable release gate evaluator.
- The evaluator emits fail-closed `releaseMovement` and `candidateMovement` objects instead of stale percentage claims.
- Local candidate evidence can reach `candidate-for-review`, but `releaseMovement.allowed` stays `false` until every gate has `final-release` scope evidence.
- Blocking gates name exact missing or failed evidence, including the required env key or evidence key.
- Added `formatReleaseGateStatusMarker()` for a tmux-visible final bracketed status marker.

## Covered RPP items with repository evidence

| RPP item | Gate evidence added |
| --- | --- |
| RPP-0001 | `source-url` gate requires `REPRINT_PUSH_SOURCE_URL`; `test/release-gates.test.js` asserts exact missing evidence and fail-closed releaseMovement. |
| RPP-0002 | `local-url` gate requires `REPRINT_PUSH_LOCAL_URL`; test asserts exact reason/evidence object. |
| RPP-0003 | `remote-changed-url` gate requires `REPRINT_PUSH_REMOTE_CHANGED_URL`; test asserts exact missing evidence. |
| RPP-0004 | `packaged-fallback` gate rejects packaged production-plugin fallback even with all other final evidence. |
| RPP-0005 | `remote-alias` gate rejects `REPRINT_PUSH_REMOTE_URL` mismatch without weakening other evidence. |
| RPP-0006 | `auth-source-readback` gate fails closed on issuance/readback source drift with named `PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED`. |
| RPP-0007 | `production-secret` gate fails closed when a live source URL is present without production credentials or an auth session source command. |
| RPP-0016 | Evaluator emits machine-readable `releaseMovement` and `candidateMovement` summaries. |
| RPP-0017 | `formatReleaseGateStatusMarker()` emits a final bracketed stdout marker; focused test asserts marker shape and reason code. |
| RPP-0021 through RPP-0025 | Variant-2 proof coverage is represented by the same reusable evaluator and focused tests for missing source/local/remote, packaged fallback rejection, and wrong remote alias rejection. |

## Focused verification

```sh
node --test test/release-gates.test.js
```

Observed status: pass, 8 tests.

Key assertions:

- Missing topology URLs produce `status: "held"`, `releaseMovement.allowed: false`, and exact evidence objects for `REPRINT_PUSH_SOURCE_URL`, `REPRINT_PUSH_LOCAL_URL`, and `REPRINT_PUSH_REMOTE_CHANGED_URL`.
- Packaged fallback and wrong remote alias each keep `releaseMovement.allowed: false` with `finalGates: "19/20"` when all other final evidence is present.
- Complete local candidate evidence yields `candidateMovement.allowed: true`, `releaseMovement.allowed: false`, and `releaseMovement.gates: "candidate-for-review"`.
- Complete final evidence yields `releaseMovement.allowed: true` and `releaseMovement.gates: "20/20"`.

## Example fail-closed marker

The marker helper produces bracketed tmux-visible output such as:

```text
[release-gates:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]
```

The exact candidate count depends on which non-mutating summary gates can be evaluated from supplied input; release movement remains held until all gates pass with final evidence.
