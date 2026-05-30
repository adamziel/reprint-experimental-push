# RPP-0248 unknown plugin-owned resource refusal variant 3

Status: generated merge-invariant proof added for variant 3. Release remains NO-GO.

## Scenario

The generated harness exposes the `pluginOwnedResourceRefusalVariant3` target
coverage surface. RPP-0248 narrows the proof to its changed/blocked sub-surface:
`plugin-owned-resource-refusal-v3-changed`.

That sub-surface emits 10 deterministic generated cases, one per tier. Each case
changes a `forms`-owned `wp_options` row locally, keeps remote equal to base, and
omits any supported plugin-owned resource driver policy. The planner must fail
closed with an `unsupported-plugin-owned-resource` blocker and
`UNKNOWN_PLUGIN_OWNED_RESOURCE` reason before emitting any mutation or
live-remote precondition for that resource.

## Evidence discipline

`test/rpp-0248-unknown-plugin-owned-resource-refusal-v3.test.js` recounts the
generated changed cases against the target coverage summary, then serializes the
plan evidence for every target case. The serialized evidence contains status,
summary counts, blocker metadata, resource keys, hashes, and apply-refusal hashes
only. It asserts all generated target private values are absent from per-case
plan evidence, aggregate evidence, apply refusal details, and the generated
harness report.

Applying each blocked plan still refuses with `PLAN_NOT_READY` before mutation
and leaves the remote hash unchanged.

## Validation commands

```sh
node --check test/rpp-0248-unknown-plugin-owned-resource-refusal-v3.test.js
node --test test/rpp-0248-unknown-plugin-owned-resource-refusal-v3.test.js
node --test --test-name-pattern='RPP-0143' test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0208|RPP-0228' test/push-planner.test.js
node --test test/evidence-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0248-unknown-plugin-owned-resource-refusal-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```
