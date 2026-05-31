# RPP-0592 request signature canonicalization, variant 5

Date: 2026-05-31

Status: local executor-auth support evidence only. Final release remains
**NO-GO** until the same request-signature canonicalization proof is checked
against production-owned endpoint and credential inputs.

## Claim

The release-verifier-shaped support summary carries one hash-only request
signature canonicalization proof. Equivalent signed request shapes are accepted
only when their push signature is computed from the canonical request string.
Malformed, tampered, stale, or drifted signed evidence fails before JSON
parsing, receipt work, mutation-capable work, or release movement.

## Hash-Only Evidence

No raw credentials, user names, source locators, session identifiers, signing
keys, idempotency keys, nonces, request bodies, tokens, row values, durable
payloads, or local paths are recorded in the proof values below.

| Field | SHA-256 |
| --- | --- |
| proofClaimSetHash | fed5d2a952996eeb8b996744ccb1baed518f8479fe5d65cc65606c0c781812e6 |
| coverageArtifactHash | fdc52333d6ee71e195c21a21f6922ea39d83117665783f1d828acb5e87767719 |
| canonicalCaseSetHash | 126498d5d3981362bd6b56fb54a63f12893162f4baffed1191b4957e89faa533 |
| positiveCaseSetHash | 554b818d532be4e4f08c825f2c64e32470e2cc55aaba78d5afe35261044828e0 |
| negativeCaseSetHash | 5116ed8b5ae3a8a1266ab59af489ee86490d12a52905d7a56a1adcaf3cf892ea |
| sourceAssertionSetHash | 36d7025170d2aafac7c4ac2b23e94870bd03670c43de1df5dab13e234553246e |
| releaseVerifierSummaryHash | 106cd81543d70ba3f770661454e4f4b5c17ff51158d201d7f505aa1bf20d1fb8 |
| aggregateSupportHash | fb42f26393985c849f63cbdf6196966940c8ae5814f76dde9178a598cdc90d39 |
| commandSetHash | 811bd662ba8b349c12b1e7a0ed2579015a33c1e8fca552b7caf6035cac1d7d53 |
| outcomeSetHash | ed09e3ff483c71b95784076448ae69dcac9269aa39ea64a27de990d1354189af |

## Proven Counts

| Count | Value |
| --- | ---: |
| canonical equivalence groups | 4 |
| positive support paths | 2 |
| malformed, tampered, stale, or drifted negative cases | 28 |
| route-order assertion groups | 8 |
| release-verifier summaries | 1 |

## Proof Surface

`test/rpp-0592-request-signature-canonicalization-v5.test.js` adds focused
local coverage for:

- query key sorting, empty segment handling, plus-space decoding,
  percent-decoding, RFC3986 re-encoding, empty-value handling, encoded slash
  handling, and duplicate-value sorting;
- dry-run and apply paths that advance JSON, receipt, journal, and mutation
  counters only after signed request verification succeeds;
- malformed, tampered, stale, and drifted signed apply evidence carrying a body
  that would fail if parsed; and
- one `verify:release`-shaped support summary that remains `NO-GO` with
  `releaseMovement.allowed: false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0592-request-signature-canonicalization-v5.test.js
node --test --test-name-pattern RPP-0592 test/rpp-0592-request-signature-canonicalization-v5.test.js
node --test --test-name-pattern RPP-0572 test/rpp-0572-request-signature-canonicalization-v4.test.js
node --test --test-name-pattern RPP-0552 test/rpp-0552-request-signature-canonicalization-v3.test.js
node --test test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0592-request-signature-canonicalization-v5.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0592 run reported
5 passes / 0 failures. The adjacent RPP-0572 run reported 4 passes / 0
failures, and the adjacent RPP-0552 run reported 3 passes / 0 failures. The
authenticated HTTP push client suite reported 135 passes / 0 failures. The
scoped artifact redaction scan returned `"ok": true`; both whitespace checks
returned no findings.

## Boundary

This is deterministic local support evidence. It strengthens the executor-auth
canonicalization contract and release-verifier carry-through shape, but it does
not assert production readiness. Integration should keep release movement
blocked until checked production-owned evidence proves the same behavior.
