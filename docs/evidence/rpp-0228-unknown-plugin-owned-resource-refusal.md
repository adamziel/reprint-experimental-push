# RPP-0228 unknown plugin-owned resource refusal

Status: focused planner/apply proof added for variant 2. Release remains NO-GO.

## Scenario

A local change targets a plugin-owned custom table row that has no supported resource driver policy. The planner emits an `unsupported-plugin-owned-resource` blocker, zero mutations, and zero live-remote preconditions for that resource.

The apply proof covers two refusal paths:

1. applying the blocked plan is refused with `PLAN_NOT_READY` before mutation;
2. a forged ready plan that tries to mutate the unknown plugin-owned row is refused with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE` before mutation.

In both cases, the remote plugin-owned row remains unchanged.

## Evidence discipline

The serialized evidence includes planner status, summary totals, deterministic planner envelope data, reason codes, resource keys, plugin owner identifiers, and hashes. It intentionally excludes row values. The focused test asserts local and base sentinel values are absent from serialized refusal evidence.

## Commands

```sh
node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0228 test/push-planner.test.js
node --test test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0228-unknown-plugin-owned-resource-refusal.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
git diff --check
```
