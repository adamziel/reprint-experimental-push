# RPP-0463 custom table allowlist exact match v4 evidence

Date: 2026-05-30

## Scope

This is variant-4 focused plugin-driver evidence for custom-table allowlist exact
matching. It adds a local production-shaped regression that accepts only the
exact `wp_reprint_push_forms_lab` row/owner/driver/table tuple and carries one
real custom-table row mutation through `applyPlan()` with `mutateRemote: true`.

## Proof surface

`test/rpp-0463-custom-table-allowlist-exact-match-v4.test.js` proves:

- the exact allowlist tuple for `row:["wp_reprint_push_forms_lab","id:1"]`,
  owner `forms`, driver `fixture-forms-lab-table`, table
  `wp_reprint_push_forms_lab`, and `supportsDelete: false` plans exactly one
  mutation and one live-remote precondition;
- apply mutates the checked remote object, reports one applied mutation, and
  writes one applied journal entry for the custom-table resource;
- planner audit evidence, driver decision evidence, dry-run driver evidence,
  apply-time driver validation evidence, and the journal stay hash-only for the
  private row sentinels; and
- near misses for wrong owner, wrong table on the exact resource key, a
  suffix-like table name, and a different resource key all block before apply
  with zero mutations and no preconditions.

## Focused verification observed locally

```sh
node --check test/rpp-0463-custom-table-allowlist-exact-match-v4.test.js
node --test test/rpp-0463-custom-table-allowlist-exact-match-v4.test.js
node --test --test-name-pattern 'RPP-0463|RPP-0443|fixture forms lab table|allows plugin-owned custom table rows' test/push-planner.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof enforces exact allowlist owner and driver|production plugin-driver boundary proof blocks a wrong-driver allowlist|production plugin-driver boundary proof rejects extra custom table driver mutations' test/production-shaped-proof.test.js
node --test --test-name-pattern 'complex-site planner proof reports dense counts' test/local-production-complex-site-proof.test.js
node --test --test-name-pattern 'snapshot apply gate allows only exact forms lab custom table rows' test/playground-snapshot-lib.test.js
```

Observed result: every command above exited 0. The new RPP-0463 focused test
reported 6 tests ok, 0 fail; the existing push-planner custom-table slice
reported 8 tests ok, 0 fail; the production-shaped boundary slice reported 3
tests ok, 0 fail; the local production planner proof slice reported 1 test ok,
0 fail; and the snapshot-lib custom-table gate slice reported 1 test ok, 0
fail.

## Release posture

This is local focused plugin-driver regression evidence, not a live external
production release claim. It does not update `progress.html` and does not
broaden accepted plugin-owned resources beyond the exact custom-table driver
allowlist path under test.
