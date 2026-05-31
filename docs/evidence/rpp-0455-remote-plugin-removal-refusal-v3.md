# RPP-0455 remote plugin removal refusal v3 evidence

Date: 2026-05-31
Lane: RPP-0455 remote plugin removal refusal, variant 3
Checklist item: RPP-0455 - Add generated coverage for remote plugin removal refusal, variant 3.

## Scope

This is local plugin-driver support evidence only. It uses deterministic,
hash-only fixtures and does not use secrets, live URLs, remote tunnels, or
production endpoints.

Final release posture remains `NO-GO`. This slice labels the evidence as
local/support-only and records that checked production-backed release-gate
evidence is still required.

## Proof surface

`test/rpp-0455-remote-plugin-removal-refusal-v3.test.js` proves:

- a plugin-owned `wp_termmeta` row update is blocked with zero mutations when
  the live remote has removed the owner plugin metadata from the pull base;
- the blocker emits `REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT` evidence with
  `operation: refuse-before-mutation`, `format: hash-only`,
  `releaseGateEvidenceScope: local/support-only`, and `productionBacked:
  false`;
- the generated release-gate proof envelope is explicit:
  `releaseGate.status: NO-GO`, `sourceKind: local/support-only`, and a note
  that checked production-backed release-gate evidence is still required;
- blocked plan apply returns `PLAN_NOT_READY` before mutation and preserves the
  remote plugin-owned row and full remote hash; and
- a previously ready checked plugin-driver plan refuses with
  `STALE_PLUGIN_OWNER_CONTEXT` when the live remote owner plugin is removed
  before apply, before the `beforeMutation` hook is reached.

The assertions check resource keys, reason codes, release-gate labels, owner
context hashes, driver audit hashes, blocked apply details hashes, and
before/after remote hashes only. Raw `meta_value` payloads and private fixture
markers are asserted absent from blocker evidence, refusal evidence, apply
error details, and generated proof envelopes.

## Focused verification observed locally

```sh
node --check test/rpp-0455-remote-plugin-removal-refusal-v3.test.js
node --test --test-name-pattern RPP-0455 test/rpp-0455-remote-plugin-removal-refusal-v3.test.js
node --test --test-name-pattern RPP-0475 test/rpp-0475-remote-plugin-removal-refusal-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0455-remote-plugin-removal-refusal-v3.md
git diff --check
git diff --cached --check
```

Observed result before commit: all commands exited 0. The focused RPP-0455
test reported 2 subtests ok and 0 failed. The adjacent RPP-0475 v4 test
reported 2 top-level subtests ok and 0 failed. The scoped artifact redaction
scan returned `"ok": true`; both diff whitespace checks exited 0.

## Release posture

`NO-GO` for release promotion from this slice alone. This evidence is
local/support-only and is not a checked production-backed release run.
