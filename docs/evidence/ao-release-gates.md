# AO release-gates evidence

Date: 2026-05-28
Lane: release-gates
Primary checklist range: RPP-0001 through RPP-0026, plus RPP-0028, RPP-0030, RPP-0031, RPP-0032, RPP-0033, and RPP-0034

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
| RPP-0008 | `application-password-binding` gate names missing/failed Application Password binding evidence and keeps release movement denied. |
| RPP-0009 | `manage-options-capability` gate names missing/failed `manage_options` proof evidence and keeps release movement denied. |
| RPP-0010 | `same-source-identity` gate names same-source identity evidence and rejects drift across the checked release path. |
| RPP-0011 | `preflight-route-identity` gate names preflight route identity evidence and rejects wrong-route proof. |
| RPP-0012 | `dry-run-route-eligibility` gate names dry-run eligibility evidence and rejects ineligible proof. |
| RPP-0013 | `apply-route-pre-mutation` gate names pre-mutation evidence and rejects mutation-before-rejection proof. |
| RPP-0014 | `journal-route-read-only` gate names journal read-only evidence and rejects write-observed proof. |
| RPP-0015 | `recovery-inspect-read-only` gate names recovery inspect read-only evidence and rejects write-observed proof. |
| RPP-0016 | Evaluator emits machine-readable `releaseMovement` and `candidateMovement` summaries. |
| RPP-0017 | `formatReleaseGateStatusMarker()` emits a final bracketed stdout marker; focused test asserts marker shape and reason code. |
| RPP-0018 | `progress-release-timestamp` gate rejects missing or non-ISO timestamp evidence. |
| RPP-0019 | `agents-release-gates-row` gate rejects missing or stale status-row evidence. |
| RPP-0020 | `verify-release-failure-reason` gate requires nonzero `verify:release` failure evidence with a named reason. |
| RPP-0021 through RPP-0025 | Variant-2 proof coverage is represented by the same reusable evaluator and focused tests for missing source/local/remote, packaged fallback rejection, and wrong remote alias rejection. |
| RPP-0026 | Evidence toward variant-2 auth source command readback drift now runs the `check-release-gates` command from a fixture evidence file and asserts exit `1`, `PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED`, exact drift evidence, and `mutationAttempted: false`. |
| RPP-0028 | Evidence toward variant-2 Application Password credential binding now runs `check-release-gates` from a fixture evidence file and asserts exit `1`, `APPLICATION_PASSWORD_BINDING_REQUIRED`, exact binding-drift evidence, and `mutationAttempted: false`. |
| RPP-0030 | Evidence toward variant-2 same source URL identity now records exact same-source drift evidence and proves the final bracketed status marker reports `SAME_SOURCE_IDENTITY_REQUIRED`; the CLI path exits `1` with `mutationAttempted: false`. |
| RPP-0031 | Evidence toward variant-2 preflight route identity now runs `check-release-gates` from a fixture evidence file and asserts exit `1`, `PREFLIGHT_ROUTE_IDENTITY_REQUIRED`, exact wrong-route evidence, and `mutationAttempted: false`. |
| RPP-0032 | Evidence toward variant-2 dry-run route eligibility now runs `check-release-gates` from a fixture evidence file and asserts exit `1`, `DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED`, exact rejection evidence, and `mutationAttempted: false`. |
| RPP-0033 | Evidence toward variant-2 apply route pre-mutation proof now links `node scripts/playground/production-shaped-apply-revalidation-smoke.mjs` with observed status `412 PRECONDITION_FAILED`; `check-release-gates` preserves that exact evidence and records `mutationAttempted: false`. |
| RPP-0034 | Evidence toward variant-2 journal route read-only proof now records negative and positive `check-release-gates` scenarios: write-observed evidence fails with `JOURNAL_ROUTE_READ_ONLY_REQUIRED`; read-only evidence preserves stable journal row counts and cannot mutate release state. |

## Focused verification

```sh
node --test test/release-gates.test.js test/release-gate-cli.test.js
```

Observed status: pass, 25 tests.

Key assertions:

- Missing topology URLs produce `status: "held"`, `releaseMovement.allowed: false`, and exact evidence objects for `REPRINT_PUSH_SOURCE_URL`, `REPRINT_PUSH_LOCAL_URL`, and `REPRINT_PUSH_REMOTE_CHANGED_URL`.
- Packaged fallback and wrong remote alias each keep `releaseMovement.allowed: false` with `finalGates: "19/20"` when all other final evidence is present.
- Missing/failed auth, route, read-only, operator-proof, and verifier-failure evidence is named per gate and keeps `releaseMovement.allowed: false`.
- Auth source command readback drift has command-level variant-2 coverage: the fixture-backed `check-release-gates` run exits nonzero with `PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED` and records `mutationAttempted: false`.
- Application Password binding drift has command-level variant-2 coverage: the fixture-backed `check-release-gates` run exits nonzero with `APPLICATION_PASSWORD_BINDING_REQUIRED`, exact binding evidence, and `mutationAttempted: false`.
- Same source URL identity drift has variant-2 release-gate and CLI coverage: both paths preserve exact drift evidence, the CLI emits a final bracketed `[release-gates-ci:held ... reason=SAME_SOURCE_IDENTITY_REQUIRED]` marker, and no mutation attempt is recorded.
- Preflight route identity drift has command-level variant-2 coverage: the fixture-backed `check-release-gates` run exits nonzero with `PREFLIGHT_ROUTE_IDENTITY_REQUIRED`, exact wrong-route evidence, and `mutationAttempted: false`.
- Dry-run route eligibility has command-level variant-2 coverage: the fixture-backed `check-release-gates` run exits nonzero with `DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED`, exact rejection evidence, and `mutationAttempted: false`.
- Apply route pre-mutation proof links the smoke command with observed status `412 PRECONDITION_FAILED`, phase `before-first-mutation`, and `appliedBeforeFailure: 0`; the gate passes while the CLI remains `NO-GO` without provenance and records no mutation attempt.
- Journal route read-only proof has command-level variant-2 matrix coverage: the negative case records exact write-observed evidence and the positive case links the journal command, `GET` method, stable row counts, no release-state mutation, and `mutationAttempted: false`.
- Complete local candidate evidence yields `candidateMovement.allowed: true`, `releaseMovement.allowed: false`, and `releaseMovement.gates: "candidate-for-review"`.
- Complete final evidence yields `releaseMovement.allowed: true` and `releaseMovement.gates: "20/20"`.

## Example fail-closed marker

The marker helper produces bracketed tmux-visible output such as:

```text
[release-gates:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]
```

The exact candidate count depends on which non-mutating summary gates can be evaluated from supplied input; release movement remains held until all gates pass with final evidence.
