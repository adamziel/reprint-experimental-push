# RPP-0452 direct active_plugins mutation refusal v3 evidence

Date: 2026-05-31
Lane: RPP-0452 direct active_plugins mutation refusal, variant 3
Checklist item: RPP-0452 - Add focused plugin-driver coverage for direct
`active_plugins` mutation refusal, variant 3.

## Scope

This is local/support-only focused regression evidence. It validates existing
planner and apply behavior around the `wp_options` `active_plugins` boundary;
it does not add a production plugin activation driver and does not change the
release posture.

## Proof Surface

`test/rpp-0452-direct-active-plugins-mutation-refusal-v3.test.js` covers:

- direct writes to `row:["wp_options","option_name:active_plugins"]` blocked
  by the planner with class `unsupported-active-plugins-direct-mutation`,
  reason code `DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED`, required driver
  `plugin-activation-driver`, and no active_plugins mutation or precondition;
- direct deletes of the same option row blocked with the same refusal class
  before an otherwise supported plugin-driver mutation can run;
- an explicit checked `wp-option` plugin-driver operation that remains ready
  and applies when `active_plugins` is unchanged;
- stale plugin owner context evidence and forged owner context evidence refused
  before mutation; and
- forged ready plans for direct active_plugins put/delete operations refused by
  `applyPlan()` as `UNSUPPORTED_ACTIVE_PLUGINS_MUTATION` before any mutation
  hook runs.

All proof objects use hash-only summaries. The tests assert local/support-only
labels, `productionBacked=false`, `rawValuesIncluded=false`, unchanged remote
hashes for refused paths, preserved active_plugins hashes, and preserved remote
plugin-owned row hashes.

## Focused Verification Observed Locally

```sh
node --check test/rpp-0452-direct-active-plugins-mutation-refusal-v3.test.js
node --test --test-name-pattern RPP-0452 test/rpp-0452-direct-active-plugins-mutation-refusal-v3.test.js
node --test --test-name-pattern RPP-0472 test/rpp-0472-direct-active-plugins-mutation-refusal-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0452-direct-active-plugins-mutation-refusal-v3.md
git diff --check
```

Observed result: the syntax check exited 0. The focused RPP-0452 test reported
3 subtests ok and zero failures. The adjacent RPP-0472 active_plugins refusal
test reported 3 subtests ok and zero failures. The scoped artifact redaction
scan returned `"ok": true` with no rejected files, and `git diff --check`
exited 0.

## Release Posture

This remains local/support-only plugin-driver regression evidence. It is not
live external production evidence, does not update `progress.html`, and keeps
the broader release gate at NO-GO.
