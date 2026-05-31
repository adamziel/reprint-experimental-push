# RPP-0446 wp_termmeta driver semantics v3 evidence

Date: 2026-05-31

## Scope

This is variant-3 focused plugin-driver evidence for `wp_termmeta` resources.
It adds a standalone local Node test and does not change shared harness files,
progress surfaces, or release checklist state.

## Proof surface

`test/rpp-0446-wp-termmeta-driver-semantics-v3.test.js` proves:

- a push-intent policy for owner `forms`, driver `wp-termmeta`, table
  `wp_termmeta`, and one exact `meta_id:<id>` row plans exactly one `put`
  mutation and exactly one `live-remote` precondition for that resource key;
- the planned mutation records the exact `wp_termmeta` row id, `term_id`,
  `meta_key`, owner, policy source, and local-candidate release evidence scope;
- applying the plan mutates only the planned row, while an unplanned sibling
  `wp_termmeta` row with a live remote drift is preserved;
- applying the same plan to a stale live remote value for the planned row
  refuses before mutation with `PRECONDITION_FAILED` and leaves the remote
  object unchanged; and
- driver evidence, planner audit evidence, release-summary evidence, stale
  precondition details, and apply journal entries remain hash-only or identifier
  only. Raw `meta_value` payload fields are not included in those evidence
  surfaces.

The local release-verifier summary for this proof remains support-only:
`releaseGate.status: NO-GO`, `productionBacked: false`, and
`acceptedForReleaseGate: false`. Production-backed `wp_termmeta` handling stays
limited to the separately checked release-verifier path from the existing
RPP-0486 evidence. Final release remains `NO-GO`.

## Focused verification observed locally

```sh
node --check test/rpp-0446-wp-termmeta-driver-semantics-v3.test.js
node --test test/rpp-0446-wp-termmeta-driver-semantics-v3.test.js
node --test test/plugin-driver-termmeta-semantics.test.js test/rpp-0426-wp-termmeta-driver-semantics.test.js test/rpp-0466-wp-termmeta-driver-semantics-v4.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0446-wp-termmeta-driver-semantics-v3.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0446
test reported two subtests ok and zero failures. The adjacent `wp_termmeta`
driver and release-verifier slice reported sixteen subtests ok and zero
failures. The scoped artifact redaction scan returned `"ok": true`, and the
diff check returned no whitespace errors.

## Release posture

This lane is local focused support evidence only. It verifies exact
`wp_termmeta` mutation scoping, live precondition enforcement, stale remote
refusal, and hash-only evidence surfaces, but it does not provide checked
production release evidence. Final release remains `NO-GO`.
