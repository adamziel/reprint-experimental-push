# RPP-0100 release verifier failure reason carry-through

Evidence toward `RPP-0100` release verifier `verify:release` nonzero failure reason carry-through. Release remains held.

## Scope

Variant 5 pins the release verifier path that fails closed before mutation when `REPRINT_PUSH_SOURCE_URL` is missing, then carries the verifier's nonzero exit code, named reason, and final bracketed status marker into `check-release-gates` as `verifyReleaseFailure` evidence.

No progress.html, checklist, or shared release-verifier implementation files were edited.

## Focused check

- Focused command: `umask 0022 && node --test test/release-verifier-failure-reason-carry-through-focused-regression.test.js`
- Observed status: `pass`; scenarios: `live-missing-source+carried-reason+missing-reason-fail-closed`.
- Verifier marker carried into `verifyReleaseFailure.statusMarker`: `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`

## Evidence captured

- The tmux-visible verifier run exits `1`, does not start a live verifier server, and prints the final bracketed status marker as the last stdout line.
- The release-gate fixture carries `exitCode: 1`, `reason: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `checkedCommand: timeout 300s npm run verify:release`, `mutationAttempted: false`, and the same status marker into the `verify-release-failure-reason` gate.
- The positive carry-through path reaches `20/20` release-gate evidence while the release still reports `NO-GO` until production evidence provenance is supplied.
- The negative carry-through path removes the reason while keeping the nonzero exit and marker, and `check-release-gates` fails closed with `VERIFY_RELEASE_FAILURE_REASON_REQUIRED` at `19/20`.
- The focused assertion confirms the sentinel credential string is absent from verifier and release-gate stdout/stderr.

Focused checks are local evidence for this slice. Checklist item remains unchecked for the integrator.
