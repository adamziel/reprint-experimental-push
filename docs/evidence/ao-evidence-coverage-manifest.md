# AO evidence coverage manifest

Date: 2026-05-28
Lane: evidence-coverage-manifest
Primary checklist IDs: RPP-0918, RPP-0938, RPP-0978

## What changed

Added a deterministic, local-only manifest builder at
`scripts/release/evidence-coverage-manifest.mjs`. It reads the repository
checklist and evidence markdown files without calling GitHub, PR APIs, tunnels,
or external services.

The manifest answers two operator questions:

1. Which checklist IDs have at least one concrete evidence reference in
   `docs/evidence/*.md` or `audits/*.md`?
2. Which checklist IDs remain missing from those evidence sources?

This is evidence toward telemetry-free audit mode (`RPP-0918`), its proof path
(`RPP-0938`), and focused regression coverage for that audit path (`RPP-0978`).
It is not a final release-ready claim; it is a local audit surface that makes
missing evidence visible.

## Operator command

```sh
node scripts/release/evidence-coverage-manifest.mjs
```

The command emits stable JSON to stdout and exits nonzero when it cannot build a
trustworthy manifest. No network access is required.

## Stable JSON fields

- `ok`: `true` only when fail-closed preconditions pass.
- `reasonCodes`: exact machine-readable failure reasons.
- `totals`: counts for checklist IDs, covered IDs, missing IDs, duplicate
  evidence IDs, scanned source files, and unknown evidence IDs.
- `coveredIds`: sorted checklist IDs referenced by scanned evidence sources.
- `missingIds`: sorted checklist IDs with no scanned evidence reference.
- `duplicateEvidenceIds`: sorted IDs cited more than once or in more than one
  evidence source file.
- `duplicateChecklistIds`: sorted duplicate IDs from the checklist, when any.
- `unknownEvidenceIds`: sorted RPP-shaped IDs found in evidence files but absent
  from the checklist.
- `sourceFiles`: sorted source file records with each file's IDs.
- `evidenceById`: sorted ID-to-source-file references.
- `checklistItems`: sorted checklist IDs with parsed labels and checked state.
- `errors`: structured fail-closed details when `ok` is `false`.

## Fail-closed reason codes

| Code | Meaning |
| --- | --- |
| `CHECKLIST_MISSING` | `docs/reprint-push-completion-checklist.md` is absent. |
| `CHECKLIST_READ_FAILED` | The checklist exists but cannot be read. |
| `CHECKLIST_NO_IDS` | The checklist contains no parseable `RPP-0000` style IDs. |
| `CHECKLIST_DUPLICATE_IDS` | The checklist repeats one or more RPP IDs. |
| `EVIDENCE_FILES_NOT_FOUND` | No markdown files exist in `docs/evidence/` or `audits/`. |
| `EVIDENCE_FILE_READ_FAILED` | At least one discovered evidence file cannot be read. |

## Focused verification

```sh
node --check scripts/release/evidence-coverage-manifest.mjs
node --test test/evidence-coverage-manifest.test.js
git diff --check
```

The tests use temporary fixture repositories rather than the live checklist
count. They cover parsing labels, duplicate checklist IDs, deterministic source
references, missing evidence files, and CLI nonzero behavior with exact reason
codes.
