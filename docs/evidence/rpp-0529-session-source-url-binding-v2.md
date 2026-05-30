# RPP-0529 session source URL binding proof v2

Date: 2026-05-30

## Scope

RPP-0529 proves the production-shaped apply path revalidates the dry-run
receipt's live source URL binding after the apply claim is durably started and
before mutation execution can run.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `scripts/playground/push-remote-rest-plugin.php` | Production-shaped route implementation proof | Apply now preserves rejected apply-revalidation evidence from inside the apply runner, so rejected apply responses include the live source binding that was checked after `apply-started`. |
| `test/rpp-0529-session-source-url-binding-v2.test.js` | Focused source-ordering proof | Pins `apply-started` before live source URL revalidation, live source URL revalidation before the mutation executor, and the fail-closed `AUTH_SOURCE_BINDING_MISMATCH` path before snapshot or mutation work. |
| `scripts/playground/production-shaped-apply-revalidation-smoke.mjs` | Sandbox-local production-shaped endpoint proof | The smoke now asserts the apply response includes `liveSource` hash evidence where the current source URL hash matches the receipt-bound source URL hash, with a DB journal cursor proving the check happened after `apply-started`. |

## Behavior covered

- The short-lived push session and receipt source binding are checked against the
  current live source identity before mutation execution.
- A rejected apply still carries the live source URL binding evidence produced
  inside the apply runner instead of being overwritten by older pre-run accepted
  evidence.
- The local endpoint smoke confirms `sameSourceHash: true`,
  `sameSourceUrlHash: true`, `applied: 0`, and the stale write rejection before
  any planned mutation is applied.

## Validation observed

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --check scripts/playground/production-shaped-apply-revalidation-smoke.mjs
node --check test/rpp-0529-session-source-url-binding-v2.test.js
node --test test/rpp-0529-session-source-url-binding-v2.test.js test/session-source-url-binding.test.js test/short-lived-push-session.test.js test/production-apply-route.test.js test/authenticated-http-push-client.test.js
npm run test:playground:production-shaped-apply-revalidation
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0529-session-source-url-binding-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: each command exited 0. The focused and adjacent Node route/auth
bundle reported 141 subtests ok. The sandbox-local route smoke returned `ok: true` and showed the
apply `liveSourceBinding` source hash and source URL hash both matched the
receipt-bound hashes at the post-`apply-started` DB journal cursor.

## Residual risks

- This is a production-shaped sandbox-local proof, not an external production
  host run.
- The smoke remains backed by the local Playground harness; packaged-plugin and
  release-verifier carry-through remain separate checklist items.
