# AO generated harness evidence for RPP-0101

Date: 2026-05-28
Lane: RPP-0101 generated harness
Checklist item: RPP-0101 — Implement file create/update/delete mix, variant 1.

## What changed

- Added deterministic generated scenario family `file-create-update-delete-mix-ready`.
- Added deterministic generated scenario family `file-create-update-delete-mix-conflict`.
- Both families share the tag `file-create-update-delete-mix` plus explicit `file-create`, `file-update`, and `file-delete` tags.
- The ready family creates one new upload file, updates one existing upload file, and deletes another existing upload file while the remote remains unchanged.
- The conflict family performs the same local create/update/delete mix but adds a concurrent remote edit to the updated file, producing a non-ready conflict.

## Focused proof

`test/generated-push-harness.test.js` now asserts:

- at least one ready generated file create/update/delete mix case exists;
- at least one non-ready generated file create/update/delete mix case exists;
- the ready case validates as `ready` with at least three mutations;
- the non-ready case validates as `conflict`, has at least one conflict, and does not apply mutations.

Focused command:

```sh
node --test test/generated-push-harness.test.js
```

Observed summary from `node scripts/harness/generated-push-cases.js` after the change:

```json
{
  "totalCases": 360,
  "statuses": {
    "blocked": 26,
    "conflict": 133,
    "ready": 201
  },
  "featureFamilies": {
    "file-create-update-delete-mix": 26,
    "file-create-update-delete-mix-ready": 13,
    "file-create-update-delete-mix-conflict": 13
  }
}
```
