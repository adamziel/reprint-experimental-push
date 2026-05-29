# RPP-0208 unknown plugin-owned resource refusal

Status: implemented for variant 1. Release remains NO-GO.

## Scenario

A local change targets a plugin-owned custom-table row that has no explicit supported driver policy. The planner refuses the row as `unsupported-plugin-owned-resource` before emitting a mutation or live-remote precondition for that resource.

The blocker now carries `UNKNOWN_PLUGIN_OWNED_RESOURCE` refusal evidence with `format: hash-only` and `rawValuesIncluded: false`. The evidence records resource identity, plugin owner, state hashes, and change-state metadata only.

## Evidence discipline

The focused node test serializes the planner status, summary, blocker, mutations, preconditions, and forged apply refusal details, then asserts the base/local sentinel values do not appear. The forged ready-plan path still refuses with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE` before mutation and leaves the remote row unchanged.

## Commands

```sh
node --test --test-name-pattern=RPP-0208 test/push-planner.test.js
node --test test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0208-unknown-plugin-owned-resource-refusal.md docs/reprint-push-completion-checklist.md
git diff --check
```
