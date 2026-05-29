# RPP-0096 release verifier releaseMovement carry-through

Status: Evidence toward `RPP-0096` release verifier releaseMovement carry-through. Release remains held.

## Scope

Variant 5 checks that the release verifier's machine-readable `releaseMovement`
summary is preserved when the verifier denies movement before any mutation, and
that the release-gate CLI still carries both denied and allowed summaries into
its top-level `releaseMovement` and `summary.releaseMovement` surfaces.

No progress.html, checklist, or shared release-verifier implementation files were edited.

## Focused evidence

- Denied verifier path: the checked `npm run verify:release` scenario injects
  same-source route drift using placeholder source, local, and changed-remote
  boundaries. It exits `1`, emits
  `[verify-release:held exit=1 reason=SAME_SOURCE_IDENTITY_REQUIRED mutationAttempted=false]`,
  records `releaseMovement.allowed=false`, records `gates=0/4`, and preserves
  the same object under `topologyEvidence.releaseMovement`.
- Release-gate carry-through for denied movement: the focused fixture feeds the
  verifier's same-source evidence into `check-release-gates`, which reports
  `SAME_SOURCE_IDENTITY_REQUIRED`, `final=19/20`, `mutationAttempted=false`, and
  an identical denied object under `summary.releaseMovement`.
- Release-gate carry-through for allowed movement: the complete final-release
  fixture reports `releaseMovement.allowed=true`, `finalGates=20/20`, and a
  matching `summary.releaseMovement` while release status remains `NO-GO` until
  production evidence provenance is supplied.
- Redaction checks assert that the sentinel credential value is absent from the
  verifier and release-gate stdout/stderr.

## Verification

- Command: `node --test test/release-verifier-release-movement-summary-carry-through-focused-regression.test.js`
- Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=SAME_SOURCE_IDENTITY_REQUIRED mutationAttempted=false]`; denied summary: `releaseMovement.allowed=false`; allowed summary: `releaseMovement.allowed=true`; release status: `NO-GO`.

Caveat: this is focused local Node evidence for the RPP-0096 slice. The release
remains governed by the integration lane's checklist, progress publication, and
full release verification workflow.
