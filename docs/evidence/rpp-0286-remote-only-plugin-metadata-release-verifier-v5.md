# RPP-0286 remote-only plugin metadata release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0286 remote-only plugin metadata preservation release verifier carry-through, variant 5
Checklist item: RPP-0286 — Carry through the release verifier for remote-only plugin metadata preservation, variant 5.

## Scope

This carries the existing remote-only plugin metadata preservation invariant into
`scripts/playground/production-shaped-release-verify.mjs`. The verifier now emits
a hash-only `mergeInvariants.remoteOnlyPluginMetadata` proof covering both a
focused production-shaped fixture and the generated `remote-only-plugin-metadata`
fixture family.

The proof is local/generated release-verifier support evidence only. It does not
broaden the live production release boundary and remains NO-GO for release gate
credit without separate production-backed evidence.

## Proof surface

`test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js` verifies
that the release verifier:

- records the remote-only plugin metadata as a `keep-remote` decision;
- emits no mutation and no live-remote precondition for the plugin metadata
  resource;
- keeps independent local mutations bound to live-remote preconditions;
- applies the plan while preserving the remote plugin metadata hash;
- rejects stale replay with `PRECONDITION_FAILED` before mutation while the full
  remote hash and plugin metadata hash remain unchanged; and
- proves the same invariant for one generated case in each tier 0 through 9.

## Redaction proof

The focused fixture carries private local file/post content and private remote
plugin metadata strings. The generated fixture proof checks the deterministic
`remote-metadata-` channel family and injected stale replay markers. The emitted
release-verifier proof includes only statuses, resource keys, counts, decisions,
booleans, and SHA-256 evidence. Tests assert that no focused private fixture,
generated metadata channel, generated stale replay marker, or raw evidence field
is present in the proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js
node --test test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0206|RPP-0226|RPP-0246|RPP-0286' test/push-planner.test.js test/remote-only-plugin-metadata-preservation-v2.test.js test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof accepts|RPP-0484|RPP-0499|RPP-0286' test/production-shaped-proof.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0286 test reported 3
subtests ok, 0 failed. Adjacent remote-only plugin metadata and release-verifier
slices also exited 0. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true` for the touched docs.

## Release posture

NO-GO for final release movement from this slice alone. The new
`mergeInvariants.remoteOnlyPluginMetadata` proof is hash-only and explicitly
support-only; live production-backed release evidence remains required for
promotion.
