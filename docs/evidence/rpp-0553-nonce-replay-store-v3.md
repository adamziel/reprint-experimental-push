# RPP-0553 nonce replay store, variant 3

Date: 2026-05-31

Status: local generated support evidence only. Final release remains **NO-GO**
until the same nonce replay and dry-run receipt binding proof is checked
against a production-owned store and production-owned auth inputs.

## Claim

Generated local proof shows that dry-run signed retry attempts do not reuse
nonce evidence, and that replayed nonce evidence cannot mint or validate a
dry-run receipt. Accepted receipts are checked through hash-only envelopes for
session, authenticated identity, scope, and canonical plan hash binding.

## Proof Surface

`test/rpp-0553-nonce-replay-store-v3.test.js` adds two generated checks:

- an accepted dry-run request is disconnected after server-side nonce
  acceptance, then the authenticated client retry signs the same dry-run with a
  regenerated nonce and receives a receipt bound to the final nonce claim; and
- a second request with replayed signed nonce evidence is rejected by the
  generated nonce store before JSON parsing, dry-run work, receipt minting, or
  mutation-capable work. A copied receipt supplied alongside replay evidence is
  still not treated as minted or validated.

The test uses mocked fetch responses and deterministic local/generated cases.
No listener, tunnel, public ingress, live production endpoint, credential, or
network-only evidence is used.

## Proven Behavior

- Retry coverage records two signed dry-run attempts with distinct nonce
  hashes; the final accepted receipt is bound to the regenerated retry nonce.
- The accepted receipt validates its receipt hash, session hash, authenticated
  identity hash, scope hash, subject binding hash, idempotency key hash, and
  canonical plan hash.
- Replay coverage records one accepted nonce claim and one replay rejection.
- Replayed nonce evidence returns `SIGNED_NONCE_REPLAYED` before a second JSON
  parse, dry-run work unit, receipt mint, or mutation-capable work unit.
- Replayed nonce evidence has no validated receipt, even when a copied receipt
  is supplied to the local proof wrapper.
- Support envelopes carry source, auth, nonce, receipt, and replay proof values
  as SHA-256 hashes or hash lengths only.
- Raw nonces, session tokens, credential values, identity values, source URLs,
  idempotency keys, and plan bodies are excluded from support summaries.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0553-nonce-replay-store-v3.test.js
node --test --test-name-pattern RPP-0553 test/rpp-0553-nonce-replay-store-v3.test.js
node --test --test-name-pattern 'nonce|retry' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0553-nonce-replay-store-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0553 test reported
2 passes / 0 failures. The adjacent auth client nonce/retry run exited 0. The
scoped artifact redaction scan returned `"ok": true`, and whitespace checks
returned no findings.

## Boundary

This proof is support-only and does not claim production durability or release
readiness. Promotion requires equivalent proof from a production-owned nonce
store and production-owned dry-run auth inputs; until then the release posture
is **NO-GO**.
