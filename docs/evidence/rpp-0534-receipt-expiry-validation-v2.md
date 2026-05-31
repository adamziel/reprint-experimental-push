# RPP-0534 receipt expiry validation variant 2

RPP-0534 adds support-only variant coverage for executor-auth receipt expiry behavior.

## Scope

- Expired dry-run receipts fail with `AUTH_RECEIPT_EXPIRED` before the executor sends any apply, recovery, replay, or journal request.
- Unexpired receipts still reach apply-time live-source revalidation with `phase: before-first-mutation` and `checkedAgainst: live-remote`.
- Apply-side `AUTH_RECEIPT_EXPIRED` refusals remain pre-mutation failures with `applied: 0`, `freshMutationWork: false`, and no replay or recovery follow-up.
- This is local executor/unit evidence only. Final release remains **NO-GO** until live topology/auth evidence exists.

## Hash and redaction evidence

The variant fixture captures only support hashes in the evidence surface. Raw credential material, authorization headers, and idempotency key values are not recorded here.

```json
{
  "idempotencyKeyHash": "2fb319d3f3e6ca898943aaf8b6bb509f9a2efd4a7600c1937330d8795d3e1a60",
  "userLoginHash": "7f5edcf9050e6218c1b9601ddc7b95656f7cc854f3bdd2e7df4c6def66381f53",
  "activeClaimKeyHash": "8999fa3f5897a7c4e1c176a344844a8a1f55c663d554ac68aad02c026bd1b168",
  "receiptHash": "6093a081e33026de24a9a22493de59b6b162b6d689a826258ff0669120458c0c",
  "planHash": "12394ed7d015cfd82e434525a8de79e0e1b973628cb0df6f99aa1b9cf9ad15f0",
  "mutationSetHash": "ec42514ae12ec1bba813913eed52fab0e3e1a058d29b0b21bfa2ebde2660a56e",
  "preconditionSetHash": "07a4375fdf4ab2f6b14914277c53314f679c2cab4807aa7b2c67ce6f5d140057"
}
```

## Validation

- `node --check test/rpp-0534-receipt-expiry-validation-v2.test.js` - exit 0.
- `node --test --test-name-pattern='RPP-0534' test/rpp-0534-receipt-expiry-validation-v2.test.js` - exit 0, 3 subtests.
- `node --test --test-name-pattern='RPP-0514' test/authenticated-http-push-client.test.js` - exit 0, 3 subtests.
- `node --test --test-name-pattern='RPP-0514|RPP-0534|receipt|expires|expired|session|idempotency|replay' test/authenticated-http-push-client.test.js test/rpp-0534-receipt-expiry-validation-v2.test.js` - exit 0, 72 subtests.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0534-receipt-expiry-validation-v2.md` - exit 0, `allowedHashEvidence: 7`.
- `git diff --check` - exit 0.
- `git diff --cached --check` - exit 0.
