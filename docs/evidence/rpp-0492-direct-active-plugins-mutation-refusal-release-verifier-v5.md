# RPP-0492 direct active_plugins mutation refusal release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0492 direct active_plugins mutation refusal release verifier carry-through, variant 5
Checklist item: RPP-0492 — Carry through the release verifier for direct active_plugins mutation refusal, variant 5.

## Scope

This adds release-verifier carry-through for the existing direct
`wp_options.active_plugins` mutation refusal. The verifier now emits
`pluginDriver.directActivePluginsMutationRefusal` beside the existing plugin
driver boundary proofs.

The proof is local release-verifier evidence only. It does not broaden the live
release boundary and is not external production evidence. Release posture
remains NO-GO until separate production-backed release proof satisfies the
broader release boundary.

## Proof surface

`test/rpp-0492-direct-active-plugins-release-verifier-v5.test.js` verifies that
the release verifier:

- carries the three existing direct `active_plugins` generated variants through
  a release-verifier proof envelope;
- keeps the supported plugin-managed `wp_options` path separate from direct
  `active_plugins` mutation;
- exposes the unsupported direct `active_plugins` planner blocker with
  `DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED`;
- rejects a forged ready direct `active_plugins` mutation with
  `UNSUPPORTED_ACTIVE_PLUGINS_MUTATION` before any mutation hook runs; and
- records only hashes, counts, resource keys, reason codes, and proof hashes,
  with no option values or fixture strings in the emitted proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0492-direct-active-plugins-release-verifier-v5.test.js
node --test test/rpp-0492-direct-active-plugins-release-verifier-v5.test.js
node --test test/rpp-0472-direct-active-plugins-mutation-refusal-v4.test.js
node --test test/rpp-0481-driver-registration-api-release-verifier-v5.test.js test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0492-direct-active-plugins-mutation-refusal-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0492
test reported 4 subtests ok, 0 failed. The adjacent RPP-0472 active_plugins
refusal test reported 3 subtests ok, 0 failed. The adjacent plugin-driver
release-verifier slice reported 22 tests ok, 0 failed. Checklist lint
returned `"ok": true`; the scoped artifact redaction scan returned `"ok": true`
for the touched docs.

## Release posture

This is support-only release-verifier evidence. The emitted proof is
productionBacked `false`, releaseEligible `false`, and releaseGate `NO-GO`;
integration should keep RPP-0492 scoped to plugin-driver release-verifier
evidence until a separate checked production release boundary is available.
