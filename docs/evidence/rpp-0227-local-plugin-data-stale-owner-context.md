# RPP-0227 local plugin data with stale owner context

Status: focused proof added for variant 2. Release remains NO-GO.

## Scenario

The focused planner/apply test builds a ready plan for a local update to plugin-owned option data that is allowed only when the owning plugin context still matches the dry-run snapshot. The proof then applies three unsafe variants:

1. the owning plugin file changes on the live remote after planning;
2. the ready plan is forged to remove required owner context evidence;
3. the ready plan is forged with an invalid owner context hash.

Each unsafe variant is rejected before mutation with `STALE_PLUGIN_OWNER_CONTEXT`. The live remote plugin-owned row remains unchanged, and the remote owner file remains owned by the remote side when it drifted.

## Evidence discipline

The test serializes a hash-only evidence envelope containing plan status, summary counts, precondition hashes, mutation hashes, plugin owner identifiers, driver names, owner-context resource keys, and owner-context hashes. It also serializes refusal reason codes and details. Sentinel local and remote private marker values are asserted absent from this evidence envelope.

## Commands

```sh
node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0227 test/push-planner.test.js
node --test test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0227-local-plugin-data-stale-owner-context.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence

git diff --check
```

The full evidence directory scan is expected to pass on the current lane; any future rejection should be treated as a release-artifact redaction regression rather than weakening this proof.
