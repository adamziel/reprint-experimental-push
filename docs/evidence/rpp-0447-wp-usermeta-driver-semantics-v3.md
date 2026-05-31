# RPP-0447 wp_usermeta driver semantics variant 3 evidence

Date: 2026-05-31
Lane: RPP-0447 wp_usermeta driver semantics, variant 3
Checklist item: RPP-0447 — Add generated coverage for wp_usermeta driver semantics, variant 3.

## Scope

This is local generated-harness regression coverage for plugin-owned
`wp_usermeta` rows using the `wp-usermeta` driver. It adds a standalone Node
test and does not change shared harness code, progress surfaces, remote release
state, or release checklist state.

## Proof surface

`test/rpp-0447-wp-usermeta-driver-semantics-v3.test.js` proves:

- generated harness target coverage remains present for both
  `usermetaDriverSupported` and `usermetaDriverUnsupported` across all ten
  generated tiers;
- generated supported `wp_usermeta` variants remain `ready`, while generated
  unsupported variants remain `blocked` with zero ready unsupported cases;
- a supported generated `row:["wp_usermeta","umeta_id:<id>"]` row plans exactly
  one `put` mutation and exactly one `live-remote` precondition for the same
  resource key;
- the supported mutation records the exact `wp_usermeta` table, `umeta_id` row
  id, payload `umeta_id`, `user_id`, `meta_key`, owner, driver, no-delete
  support flag, and local-candidate release evidence scope;
- applying the supported plan to a matching live remote mutates the exact row,
  and applying the same plan to a stale live remote refuses before mutation with
  `PRECONDITION_FAILED`;
- unsupported generated rows whose payload `umeta_id` differs from the resource
  id produce no mutation, raise `PLAN_NOT_READY` on apply, and preserve the
  remote snapshot; and
- planner audit evidence, driver-decision evidence, release-summary evidence,
  stale precondition details, blocker evidence, apply journal entries, and proof
  envelopes remain hash-only or identifier-only. Raw `meta_value`/`metaValue`
  payload fields and generated structured payload keys are not included in
  those evidence surfaces.

The local release-verifier summary for this proof remains support-only:
`releaseGate.status: NO-GO`, `productionBacked: false`, and
`acceptedForReleaseGate: false`. Final release remains `NO-GO`.

## Focused verification observed locally

```sh
node --check test/rpp-0447-wp-usermeta-driver-semantics-v3.test.js
node --test test/rpp-0447-wp-usermeta-driver-semantics-v3.test.js
node --test test/plugin-driver-usermeta-semantics.test.js test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js test/rpp-0487-wp-usermeta-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0447-wp-usermeta-driver-semantics-v3.md
git diff --check
git diff --cached --check
```

Observed result before commit: syntax check exited 0. The focused RPP-0447
`node --test` command reported one file-level test ok and zero failures. The
adjacent `wp_usermeta` driver lineage slice reported four file-level tests ok
and zero failures. The scoped artifact redaction scan returned `"ok": true`,
and both diff checks returned no whitespace errors.

## Release posture

This lane is local generated support evidence only. It verifies exact
`wp_usermeta` row identity, live precondition enforcement, stale remote refusal,
unsupported-row fail-closed behavior, and hash-only evidence surfaces, but it
does not provide checked production release evidence. Final release remains
`NO-GO`.
