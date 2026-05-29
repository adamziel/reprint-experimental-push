# RPP-0098 release verifier progress timestamp carry-through

RPP-0098 has focused evidence toward the Near / release-gates verifier path for carrying `progress.html` release timestamp proof into the `progress-release-timestamp` release-gate evidence object.

## Focused check

- Focused command: `umask 0022 && node --test test/release-verifier-progress-timestamp-carry-through-focused-regression.test.js test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gate-cli.test.js test/release-gates.test.js`
- Observed status: `pass`; progress timestamp scenarios: `verifier-progress-timestamp+invalid-carried-timestamp`; release status: `NO-GO`.
- Carried progress timestamp: `2026-05-28T03:18:00.000Z` from `progress.html#release-proof-timestamp`.

## Evidence captured

- The verifier-shaped payload preserves the `progressReleaseTimestamp` object under both the top-level verifier report and `topologyEvidence.progressReleaseTimestamp` before it is handed to `check-release-gates`.
- The positive path carries the `progress.html` proof timestamp through the release-gate CLI, passes the `progress-release-timestamp` gate with final-release evidence, and keeps the overall release `NO-GO` only because production provenance is still required.
- The stale/non-ISO carried timestamp path emits `[verify-release:held exit=1 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED mutationAttempted=false]`, fails closed with `[release-gates-ci:held final=19/20 candidate=19/20 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED]`, and records `mutationAttempted: false`.
- The focused assertions confirm the sentinel credential value is absent from verifier-shaped stdout/stderr and release-gate stdout/stderr.

No progress.html, checklist, or shared release-verifier implementation files were edited. Focused checks passed but the checklist item remains unchecked.
