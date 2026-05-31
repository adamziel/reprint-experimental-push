# RPP-0594 receipt expiry validation variant 5

Date: 2026-05-31

Status: local executor-auth release-verifier support evidence only. Final
release remains **NO-GO**.

## Scope

- Accepted apply support evidence carries receipt-expiry validation through one
  verifier summary and records live-source revalidation after apply start and
  before mutation-capable work.
- Expired, missing, malformed, stale, and drifted receipt-expiry evidence is
  represented as blocked verifier cases with JSON parsing, receipt work,
  mutation-capable work, and release movement all held at zero.
- Dry-run expiry refusals stop before apply transport; apply-side stale and
  drifted refusals stop before mutation setup, executor entry, replay,
  recovery inspect, DB-journal readback, or release movement.
- The evidence uses mocked fetch responses and source-order assertions only.
  No listener, live endpoint, remote tunnel, external network dependency, raw
  request body, production credential, bearer token, session value, or raw
  fixture path is recorded in this artifact.

## Hash-only support envelope

```json
{
  "schemaVersion": 1,
  "sliceHash": "ee58321ede0f967a07772c25053c5dfd29ebf95a1106a4a2bf858591939d2d5e",
  "variant": 5,
  "evidenceSourceHash": "b307218d381d69245bc9a1e0dad7275f8b79dc67e0d2684ee9268c80c7b0dcad",
  "proofClassHash": "2e19a301e54a9d2cb8957ce496e30ed3047bfdf5a1713fd5d1738c53a96622dd",
  "evidenceScopeHash": "c2a7f3346ee7b7f6a2e6b841ae4e187565a3addcfe4f598404a70ad2ac9e26a0",
  "capturedAtHash": "234133e00e46921937847fe31d13e7b5062fc79660f6c383701ebb2138c465c1",
  "releaseStatusHash": "71643de8a49065550b0c08cec4e9842d289f4bae8ec9a7386feb037188ac9e68",
  "formatHash": "990cd70b1bfe9e7b30370699399e3d30281b9f3515533e4629ad2a182c7cdf0a",
  "rawValuesIncluded": false,
  "productionBacked": false,
  "releaseEligible": false,
  "releaseMovementAllowed": false,
  "summaryCount": 1,
  "acceptedApplyRevalidatesLiveSourceBeforeMutation": true,
  "negativeCaseCount": 5,
  "negativeCategoryHashes": [
    "6d749f6d23f2871fcb64b29c68833080ce6d824b9ad25de330d1b881fee49499",
    "60ec9bb7299d85e0cdd35d4058fabd7cb6bdc9b788c6efde44427e9bb9234e13",
    "a03f2386ae06b21109577020844df367857b72c2fcce384c1896fed98a89c82b",
    "fa64ea1e82e1206f828ab2a02917c7e92accb98e3b95881a1b4ad52b914b66e3",
    "ffa63583dfa6706b87d284b86b0d693a161e4840aad2c5cf6b5d27c3b9621f7d"
  ],
  "blockedBeforeJsonParsing": true,
  "blockedBeforeReceiptWork": true,
  "blockedBeforeMutationCapableWork": true,
  "releaseMovementReasonHash": "808035a786bf3c51674c9843f763084364c6148eb7d6a460b9b4903d15cc56e4",
  "remainingBoundaryHash": "ee4f492e12bed2b5940e3ed46465d57bbd89c6a67b64b21a965afdb120f653a8"
}
```

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0594-receipt-expiry-validation-v5.test.js
node --test --test-name-pattern RPP-0594 test/rpp-0594-receipt-expiry-validation-v5.test.js
node --test --test-name-pattern RPP-0574 test/rpp-0574-receipt-expiry-validation-v4.test.js
node --test --test-name-pattern RPP-0554 test/rpp-0554-receipt-expiry-validation-v3.test.js
node --test --test-name-pattern RPP-0534 test/rpp-0534-receipt-expiry-validation-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0594-receipt-expiry-validation-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0594 test
reported 3 passes / 0 failures; adjacent RPP-0574 reported 4 passes / 0
failures; RPP-0554 reported 3 passes / 0 failures; RPP-0534 reported 3 passes
/ 0 failures. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks returned no findings.

## Boundary

This proof is deterministic local support evidence only. It should be
integrated as additional executor-auth verifier coverage, not as release-gating
proof. Integration recommendation: **NO-GO** for release movement from this
slice alone.
