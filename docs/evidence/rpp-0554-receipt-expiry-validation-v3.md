# RPP-0554 receipt expiry validation variant 3

Date: 2026-05-31

Status: local generated support evidence only. Final release remains **NO-GO**
until the same receipt-expiry and apply revalidation behavior is checked
against production-owned URL and credential inputs.

## Scope

- Expired dry-run receipts fail closed with `AUTH_RECEIPT_EXPIRED` before any
  apply, recovery, replay, journal, or mutation-path request is sent.
- Unexpired receipts do not satisfy the checked release path unless apply-time
  live-source revalidation evidence is present.
- The accepted generated apply path records live-source revalidation before
  mutation executor entry and before `mutation-applied`.
- This is local executor/unit evidence only. It does not claim production
  durability, live endpoint behavior, or release readiness.

## Hash-only support envelope

The generated fixture keeps raw receipt bodies, session tokens, identities,
URLs, and plan bodies out of this evidence surface. Only hashes, counts, phase
labels, and boolean order checks are recorded here.

```json
{
  "schemaVersion": 1,
  "slice": "RPP-0554",
  "proofClass": "receipt-expiry-validation-v3",
  "evidenceScope": "local-generated-support",
  "releaseStatus": "NO-GO",
  "idempotencyKeyHash": "a9a17837f17c7bfaeb06efec83f3cbd7ec7aabc633d16fc5b2219dbc98480145",
  "sourceUrlHash": "d30a576c0318716717366ab932e3d7dfbc4009a5bc10176403b60892912f070e",
  "userLoginHash": "7f5edcf9050e6218c1b9601ddc7b95656f7cc854f3bdd2e7df4c6def66381f53",
  "sessionIdHash": "d9630c26362796cc585a5c2ed8a9aa31e91cb9092e3503865da5586a65821ad7",
  "activeClaimKeyHash": "1f8aae7c4ad57f8ddf8d830cb6c2dae82cee75c618a5ccb8b9d8f0668fae52f4",
  "receiptHash": "c5f316b10e5a614f63c2ab2eb79f593185a289a6188610f650882e008a56213a",
  "planHash": "5bc723338e8560c51594a588b9e9c2e4ca2974bb8d57d894c271571794905272",
  "mutationSetHash": "1a258f1cd20077cfe6b0cc39f598e87fa923d5efab150ae04f034a0345fcc8fa",
  "preconditionSetHash": "0e9b51a0dcb4a07e88097520c0cf5817e30fa063d9b4a99bad1b9ff3356b6ebf",
  "eventOrderHash": "a38112655a0166b1fcc5ed9b449ca98a172e2fc2508fcbb572c56ba43065d4b4",
  "liveSourceSnapshotHash": "26cfe9f6543ba15dfa0019f9bcadcfe42d1538b9153dde88db0522b7b6fd1e10",
  "liveSourceHash": "80591fdd60790ebdd9d00383f0d86d803670eff7f2d8c3956b2d44147c694196",
  "liveSourceUrlHash": "d30a576c0318716717366ab932e3d7dfbc4009a5bc10176403b60892912f070e",
  "applyRevalidation": {
    "phase": "before-first-mutation",
    "checkedAgainst": "live-remote",
    "liveSourceRevalidatedSequence": 2,
    "firstMutationSequence": 4,
    "beforeFirstMutation": true
  },
  "redaction": {
    "format": "hash-only",
    "rawValuesIncluded": false
  }
}
```

Additional generated refusal hashes:

```json
{
  "expiredReceiptHash": "9fc3d6c3b8da907ab2e4e4bee10e7b5b2edf3eb4cb2718258fd73213bc33549d",
  "expiryRefusalHash": "5a527c7a7c9f4cf449755cb6beb592c0916872177d918212b3895618acb0ff06",
  "missingRevalidationReceiptHash": "5a5438c05c2eea38ff11c7146c9304b0cff6a231d16249221c6667fffddbdda2",
  "missingRevalidationRefusalHash": "9183ebd610c853756d7f6aab1070c09d01c12f9a0e7c09043953fbacfb81ae37"
}
```

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0554-receipt-expiry-validation-v3.test.js
node --test --test-name-pattern RPP-0554 test/rpp-0554-receipt-expiry-validation-v3.test.js
node --test --test-name-pattern RPP-0534 test/rpp-0534-receipt-expiry-validation-v2.test.js
node --test --test-name-pattern 'RPP-0514|receipt|expired' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0554-receipt-expiry-validation-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0554 test
reported 3 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is support-only. Promotion still requires live production-owned
receipt expiry and apply-time source revalidation evidence, including the same
`phase: before-first-mutation` and `checkedAgainst: live-remote` behavior on
the checked release path. Until then, the release posture is **NO-GO**.
