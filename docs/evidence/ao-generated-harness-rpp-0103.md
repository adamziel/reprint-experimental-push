# AO generated harness evidence for RPP-0103

Date: 2026-05-28
Lane: RPP-0103 generated harness
Checklist item: RPP-0103 — Implement file type-swap conflict, variant 1.

## What changed

- Added deterministic scenario family `file-type-swap-ready` to prove a directory-to-file type change can apply when the live remote still matches the base directory.
- Added deterministic scenario family `file-type-swap-conflict` to prove the same local type change is non-ready when the remote has a descendant file under the directory.
- Both families share `file-type-swap`, `file-topology`, and `type-change` tags so summary output can find this target without exact-shaped fixtures.

## Focused proof

`test/generated-push-harness.test.js` asserts:

- at least one ready generated file type-swap case exists;
- at least one non-ready generated file type-swap case exists;
- the ready type-swap validates as `ready`, has a file mutation, and applies through the generated harness;
- the non-ready type-swap validates as `conflict`, records at least one conflict, and does not apply mutations.

Focused command:

```sh
node --test test/generated-push-harness.test.js
```

Observed summary from `node scripts/harness/generated-push-cases.js` after the change:

```json
{
  "totalCases": 360,
  "statuses": {
    "blocked": 24,
    "conflict": 136,
    "ready": 200
  },
  "featureFamilies": {
    "file-type-swap": 24,
    "file-type-swap-ready": 12,
    "file-type-swap-conflict": 12,
    "type-change": 24
  }
}
```
