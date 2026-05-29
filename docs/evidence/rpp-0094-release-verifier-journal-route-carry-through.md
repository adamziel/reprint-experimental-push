# RPP-0094 release verifier journal route carry-through

## Scope

Focused evidence for the Near / release-gates RPP-0094 slice: carry release-verifier-shaped journal route read-only proof into `check-release-gates` without editing shared release-verifier implementation files.

## Evidence added

- `test/release-verifier-journal-route-carry-through-focused-regression.test.js`
  - records a verifier-shaped `JOURNAL_ROUTE_READ_ONLY_REQUIRED` payload for a write-observed journal route proof;
  - carries `journalRouteReadOnly` and `verifyReleaseFailure` into the release-gate CLI;
  - asserts the negative `POST`/row-growth path fails closed with `[release-gates-ci:held final=19/20 candidate=19/20 reason=JOURNAL_ROUTE_READ_ONLY_REQUIRED]`;
  - asserts the positive `GET`/stable-row path passes the journal gate while remaining `NO-GO` only for final production provenance;
  - preserves the negative/positive scenario matrix and asserts the evaluator remains read-only.

## Validation

Local validation in this worktree:

```sh
umask 0022 && node --test test/release-verifier-journal-route-carry-through-focused-regression.test.js test/release-gate-journal-route-read-only-generated.test.js test/release-gate-route-recovery-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js
```

Observed status: pass, 36 tests. The first run without resetting the inherited `0117` umask failed while existing tests tried to write temporary evidence fixtures; rerunning with `umask 0022` restored executable temporary directories and passed.

Additional local checks:

```sh
umask 0022 && node scripts/release/checklist-completion-lint.mjs
umask 0022 && node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
```

Observed status: pass for checklist lint (`ok: true`, no reason codes), artifact redaction scan (`ok: true`, no rejected files), and `git diff --check` (no whitespace errors).

## Residual risk

This slice intentionally avoids shared release-verifier implementation edits while RPP-0093..RPP-0097 workers may overlap that file. The regression proves release-gate carry-through for verifier-shaped journal evidence; a later integrator-owned shared verifier hook can replace the fixture source with a live `npm run verify:release` journal-route simulation if desired.
