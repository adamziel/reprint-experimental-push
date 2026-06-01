# RPP-0903 release gate 3 final audit

Date: 2026-06-01
Audited local branch: `session/rpp-903`
Audited lane head before this evidence file: `612fb2348a9f4d1c06fa143eee18db72f4e61caf`
Checklist item: RPP-0903 - Implement release gate 3 final audit, variant 1.
Write scope: release-ops audit evidence for GATE-3 only.

## Gate under audit

GATE-3 is the Live Docker/Playground Production Topology gate from
`.agents/RELEASE_GATES.md`. The gate requires the checked release command to
run against a real source, local edited, and remote-changed topology that
represents the production push boundary. Packaged fixture fallback is not
acceptable for release movement.

## Audit verdict

Release movement remains held for GATE-3. The lane has support evidence for a
Docker/Playground-shaped topology contract and a fail-closed Docker prerequisite
artifact, but this audit did not produce production-backed topology evidence.
The final release verdict therefore stays `NO-GO`, GATE-3 remains
`support_only`, and release movement must remain blocked until a
production-backed topology supplies every required proof.

## Exact commands run in this audit

| Purpose | Exact command | Exit | Observed evidence |
| --- | --- | ---: | --- |
| Audited commit | `git rev-parse HEAD` | 0 | `612fb2348a9f4d1c06fa143eee18db72f4e61caf` |
| Focused syntax check | `node --check test/rpp-0903-release-gate-3-final-audit.test.js` | 0 | JavaScript syntax accepted. |
| Focused RPP-0903 test | `node --test --test-name-pattern RPP-0903 test/rpp-0903-release-gate-3-final-audit.test.js` | 0 | TAP summary: `tests 3`, `pass 3`, `fail 0`. |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:26:00.000Z` | 1 | Expected fail-closed `releaseStatus: NO-GO`; `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `statusMarker: [release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]`; `mutationAttempted: false`. |
| Canonical release verifier | `timeout 300s npm run verify:release` | 1 | Expected fail-closed `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`; `releaseMovement.allowed: false`; `gates: 0/4`; source/local/changed service URLs stayed absent. |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0903-release-gate-3-final-audit.md` | 0 | `ok: true`; scanned this evidence file; `rejectedFiles: []`. |
| Diff whitespace check | `git diff --check` | 0 | No whitespace errors. |

## Focused coverage added

`test/rpp-0903-release-gate-3-final-audit.test.js` records three checks:

- A final-release gate input with every non-topology proof present but the
  required local edited topology proof absent exits nonzero, emits
  `REPRINT_PUSH_LOCAL_URL_REQUIRED`, leaves `releaseStatus: NO-GO`, and records
  `mutationAttempted: false`.
- A blocked Docker prerequisite artifact for GATE-3 is consumable by
  `check-release-gates` and remains held with `acceptedForReleaseGate: false`,
  `failClosed: true`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, and no packaged
  fallback.
- The current `.agents/RELEASE_GATES.md` status row still reports
  `release_verdict: 0/4`; GATE-3 title `Live Docker/Playground Production
  Topology`; GATE-3 status `support_only`; and all four release gates
  `support_only`.

## GATE-3 coverage map

| GATE-3 requirement | Current lane evidence | Current audit finding |
| --- | --- | --- |
| Live source topology proof | `REPRINT_PUSH_SOURCE_URL` gate in `check-release-gates`; Docker artifact support evidence | Current final-scope command lacks production-backed live source proof and fails closed before mutation. |
| Local edited topology proof | RPP-0903 focused test with this proof absent | CI blocks release with `REPRINT_PUSH_LOCAL_URL_REQUIRED` even when other final-scope proof fields and operator provenance are present. |
| Remote changed/drift topology proof | `REPRINT_PUSH_REMOTE_CHANGED_URL` gate in `check-release-gates`; Docker topology plan support evidence | Support evidence exists for the contract, but no production-backed final proof is recorded here. |
| Packaged fallback rejection | Docker topology plan pins `npm run verify:release` and `packagedFallbackAllowed: false` | Packaged fixture fallback remains support-only and cannot move GATE-3. |
| Release command fail-closed behavior | `timeout 300s npm run verify:release`; `check-release-gates` focused RPP-0903 test | Required proof failure keeps release `NO-GO` and records no mutation attempt. |

## Caveats and integration recommendation

- This audit records current lane state only. It does not move GATE-3 out of
  `support_only`.
- The focused test is release-ops regression evidence. It is not a substitute
  for a production-backed Docker or Playground run with source, local edited,
  and remote-changed topology proof accepted by the release verifier.
- GATE-3 should remain `support_only`, and final release should remain
  `NO-GO`, until `timeout 300s npm run verify:release` passes on a
  production-backed topology with packaged fallback disabled and fresh operator
  evidence.
