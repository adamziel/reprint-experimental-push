# RPP-0520 production audit event schema

Date: 2026-05-30

## Scope

RPP-0520 implements and proves the production-shaped audit event schema for the
executor-auth route path.

## Behavior covered

- `GET /wp-json/reprint/v1/push/db-journal/schema` remains an authenticated
  production-shaped read route.
- `GET /wp-json/reprint/v1/push/db-journal` now carries
  `dbJournal.auditEventSchema`, so the existing release verifier DB journal
  summary includes the route evidence in one summary.
- Audit rows expose `schemaVersion: 1`, stable sequence/event fields, hash
  evidence fields, append-only `wpdb` storage evidence, and route evidence for
  `/push/db-journal` plus `/push/db-journal/schema`.
- The schema is explicitly hash-only with `rawValuesIncluded: false` and names
  forbidden raw fields such as `option_value`, `post_content`, and `meta_value`.

## Validation observed

```sh
php -l scripts/playground/push-remote-rest-plugin.php
php -l scripts/playground/push-db-journal-lib.php
node --check src/authenticated-http-push-client.js
node --test test/production-audit-event-schema-route.test.js
node --test --test-name-pattern "RPP-0520" test/authenticated-http-push-client.test.js
node scripts/playground/production-shaped-route-smoke.mjs
node --test test/production-audit-event-schema-route.test.js test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/production-recovery-mutate-route.test.js test/authenticated-http-push-client.test.js
```

Observed result: each command exited 0. The focused RPP-0520 route test reported
3 subtests ok. The focused authenticated-client RPP-0520 test reported 1 subtest
ok. The adjacent auth/session/route bundle reported 154 subtests ok.

The local-only production-shaped route smoke exited 0 and reported
`auditEventSchema.schemaVersion: 1`, schema id
`reprint-push-production-audit-event/v1`, route profile `production-shaped`,
namespace `reprint/v1`, journal route `/push/db-journal`, schema route
`/push/db-journal/schema`, `appendOnlyEvents: true`, and
`rawValuesIncluded: false`.

## Residual risks

- This is production-shaped sandbox-local route proof. It does not claim an
  external production host was exercised.
- The route smoke still reports `labBacked: true`; packaged-plugin or external
  production-backed release evidence remains a separate integration concern.
