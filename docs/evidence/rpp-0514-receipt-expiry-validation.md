# RPP-0514 receipt expiry validation evidence

RPP-0514 adds executor-side receipt-expiry validation for authenticated HTTP push receipts.

## Scope

- The authenticated executor now inspects dry-run receipt expiry metadata before it can build or send an apply request.
- Expired receipt metadata fails closed with `AUTH_RECEIPT_EXPIRED`, a `receiptExpiry` evidence object, and no apply/replay/recovery/journal mutation-path calls.
- Apply-side `AUTH_RECEIPT_EXPIRED` refusals are surfaced as receipt-expiry failures instead of a generic durable-journal boundary, preserving the server's pre-mutation refusal evidence.
- The unexpired receipt path still requires apply-time live-source revalidation evidence with `phase: before-first-mutation` and `checkedAgainst: live-remote`.

## Validation

- `node --check src/authenticated-http-push-client.js test/authenticated-http-push-client.test.js` — exit 0.
- `node --test --test-name-pattern='RPP-0514' test/authenticated-http-push-client.test.js` — exit 0, 3 subtests.
- `node --test test/authenticated-http-push-client.test.js` — exit 0, 131 subtests.
- `node --test --test-name-pattern='RPP-0514|expires|expired|session|idempotency|replay' test/authenticated-http-push-client.test.js` — exit 0, 68 subtests.

## Notes

- `npm run test:playground:authenticated-http-push` was attempted as an adjacent smoke check but failed before the receipt-expiry case at the existing Basic-auth db-journal assertion (`401 !== 200`); no code in this slice changes that route/smoke behavior.
- This slice is local executor/unit evidence only. Final release remains **NO-GO** until a live production proof covers the authenticated receipt-expiry path.
