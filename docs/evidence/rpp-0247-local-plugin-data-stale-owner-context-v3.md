# RPP-0247 local plugin data stale owner context v3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

The focused proof selects the generated `plugin-owned-option-change-v3-ready` cases, one per generated tier. Each case produces a ready plan with generated local plugin-owned option data and owner context evidence for the owning `forms` plugin.

The proof then exercises unsafe executor paths:

1. the live owner plugin file changes after planning, before apply;
2. a ready plan is forged to remove both owner context evidence and the required-context flag;
3. a ready plan is forged with a valid-looking but wrong owner context hash.

Each unsafe path is rejected with `STALE_PLUGIN_OWNER_CONTEXT` before mutation. The remote snapshot hash and generated plugin-owned row hash remain unchanged.

## Evidence discipline

The test records only hash-oriented evidence: plan status, summary counts, mutation hashes, plugin owner/driver identifiers, owner-context resource keys and hashes, refusal codes, and refusal detail hashes. Generated private marker values and stale owner-file sentinels are asserted absent from the serialized evidence.

The executor now fails closed when a plugin-owned mutation reaches apply without owner context evidence, even if a forged ready plan also removes `ownerContextRequired`.

## Commands

```sh
node --check src/apply.js
node --check test/rpp-0247-local-plugin-data-stale-owner-context-v3.test.js
node --test test/rpp-0247-local-plugin-data-stale-owner-context-v3.test.js
node --test --test-name-pattern='RPP-0207|RPP-0227|blocks plugin-owned data when owner plugin files changed only on remote|allows plugin-owned data when owner plugin context independently matches remote' test/push-planner.test.js
node --test test/plugin-owner-context-metadata-refusal.test.js test/plugin-owner-context-file-refusal.test.js
node --test --test-name-pattern=RPP-0154 test/generated-push-harness.test.js
node --test test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js test/rpp-0434-owner-context-stale-metadata-refusal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0247-local-plugin-data-stale-owner-context-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```
