# RPP-0517 same-key different-body conflict evidence

RPP-0517 covers executor-auth replay/idempotency behavior for reusing one idempotency key with a different canonical apply body.

## Scope

- The authenticated executor durable-journal proof now requires `IDEMPOTENCY_KEY_CONFLICT` responses to include hash-only idempotency evidence: `idempotencyKeyHash` and `requestHash`.
- The focused authenticated HTTP client regression drives apply, replay, and a different-body conflict probe with the same key, then asserts the conflict is `409`, `freshMutationWork: false`, target snapshot unchanged, and no raw key/body/probe fields in the summarized evidence.
- The production-shaped local Playground route smoke now records DB journal counts before the conflict and proves the conflict adds `idempotency-key-conflict` without adding `idempotency-opened`, `apply-started`, or `mutation-applied`.

## Validation

- `node --check src/authenticated-http-push-client.js` — exit 0.
- `node --check test/authenticated-http-push-client.test.js` — exit 0.
- `node --check scripts/playground/production-shaped-route-smoke.mjs` — exit 0.
- `php -l scripts/playground/push-remote-rest-plugin.php && php -l scripts/playground/push-db-journal-lib.php` — exit 0.
- `node --test --test-name-pattern='RPP-0517' test/authenticated-http-push-client.test.js` — exit 0, 1 subtest.
- `node --test --test-name-pattern='idempotency|replay|RPP-0517' test/authenticated-http-push-client.test.js` — exit 0, 27 subtests.
- `npm run test:playground:production-shaped-push` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0517-same-key-different-body-conflict.md` — exit 0.
- `git diff --check` — exit 0.
- `git diff --cached --check` — exit 0.

## Residual Risk

This is local production-shaped Playground and executor proof. It demonstrates the route contract and hash-only evidence shape without a tunnel or live external WordPress target; integration should keep this item behind the checked release verifier until the broader executor-auth release path is assembled.
