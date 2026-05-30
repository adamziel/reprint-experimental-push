# RPP-0268 unknown plugin-owned resource refusal variant 4

Status: focused variant 4 regression added. Release remains NO-GO.

## Scenario

A local edit changes a plugin-owned custom-table row whose owner plugin is active, but no supported driver policy covers the row. The planner refuses the row as `unsupported-plugin-owned-resource` with `UNKNOWN_PLUGIN_OWNED_RESOURCE`, emits zero mutations, and emits no live-remote precondition for that row.

The focused regression also exercises apply refusal for the blocked plan and for a forged ready plan that attempts to mutate the unknown plugin-owned row. Both paths preserve the remote row.

## Evidence discipline

The serialized plan evidence contains status, summary counts, hash-only blocker fields, reason codes, resource identity, and refusal hashes. It excludes row payload fields and asserts the fixture sentinel strings are absent from the serialized evidence.

## Commands

```sh
node --check test/rpp-0268-unknown-plugin-owned-resource-refusal-v4.test.js
node --test --test-name-pattern=RPP-0268 test/rpp-0268-unknown-plugin-owned-resource-refusal-v4.test.js
node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0208 test/push-planner.test.js
node --test --test-name-pattern=RPP-0228 test/push-planner.test.js
node --test --test-name-pattern=RPP-0143 test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0268-unknown-plugin-owned-resource-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```
