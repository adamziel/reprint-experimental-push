# AO generated harness evidence for RPP-0104

Date: 2026-05-28
Lane: RPP-0104 generated harness
Checklist item: RPP-0104 — Implement row create/update/delete mix, variant 1.

## What changed

- Added deterministic scenario family `row-create-update-delete-mix-ready`.
- Added deterministic scenario family `row-create-update-delete-mix-conflict`.
- Both families share the tag `row-create-update-delete-mix` plus explicit `row-create`, `row-update`, and `row-delete` tags.
- The ready family creates one new `wp_posts` row, updates one generated base row, and deletes another generated base row while the remote remains unchanged.
- The conflict family performs the same local row create/update/delete mix but adds a concurrent remote edit to the updated row, producing a non-ready conflict.
- Ready validation now reports the deterministic stale replay check result, including `PRECONDITION_FAILED` and unchanged remote state.

## Focused proof

`test/generated-push-harness.test.js` asserts:

- at least one ready generated row create/update/delete mix case exists;
- at least one non-ready generated row create/update/delete mix case exists;
- each sampled row mix case has exactly one generated row create, update, and delete shape before planning;
- the ready row mix validates as `ready` with at least three mutations and applies through the generated harness;
- stale replay for the ready row mix fails with `PRECONDITION_FAILED` while leaving the remote unchanged, proving it fails before mutation;
- the non-ready row mix validates as `conflict`, has at least one conflict, and does not apply mutations.

Focused command:

```sh
node --test test/generated-push-harness.test.js
```

Observed summary from `node scripts/harness/generated-push-cases.js` after the change:

```json
{
  "totalCases": 360,
  "statuses": {
    "blocked": 20,
    "conflict": 148,
    "ready": 192
  },
  "featureFamilies": {
    "row-create-update-delete-mix": 22,
    "row-create-update-delete-mix-ready": 11,
    "row-create-update-delete-mix-conflict": 11,
    "row-create": 22,
    "row-update": 22,
    "row-delete": 22
  }
}
```
