# RPP-0593 nonce replay store, variant 5

Date: 2026-05-31

Status: local release-verifier support evidence only. Final release remains
**NO-GO** until equivalent nonce replay store behavior is proven with
production-owned verifier inputs, production-owned authentication material, and
production-owned replay storage.

## Claim

Local support proof shows that the release verifier can carry a deterministic
nonce replay store summary where an accepted dry-run receipt binds the accepted
nonce claim to the current session, authenticated identity, requested scope,
and canonical plan hash before any receipt movement or release movement.

## Proof Surface

This slice adds focused regression coverage for variant 5:

- source-order assertions that required signed nonce evidence, timestamp
  freshness, nonce format, signature verification, and nonce claiming all
  precede dry-run JSON parsing;
- an accepted dry-run path that carries one release-verifier summary and checks
  receipt hash, nonce-claim hash, session hash, identity hash, auth-session
  hash, scope hash, and canonical plan hash; and
- negative matrices for missing, malformed, stale, replayed, and drifted nonce
  evidence that stop before JSON parsing, receipt work, receipt movement,
  mutation-capable work, or release movement.

No live endpoint, production credential, public tunnel, external network
dependency, row-value evidence, bearer token, or journal payload evidence was
used.

## Hash-Only Evidence Shape

The support envelopes assert only hashes, counts, booleans, status markers, and
deterministic result codes:

- accepted nonce hash, nonce-claim hash, pre-parse subject hash, and final
  receipt-subject hash;
- receipt hash, binding hash, dry-run nonce hash, dry-run canonical hash,
  dry-run idempotency-key hash, and canonical plan hash;
- subject hashes for session, identity, auth session, scope, and plan;
- refusal hashes for missing, malformed, stale, exact replay, session drift,
  identity drift, scope drift, and canonical-plan drift cases; and
- receipt-movement refusal hashes for session, identity, scope, and
  canonical-plan drift cases.

The negative envelopes assert that refused nonce evidence does not perform JSON
parsing, dry-run work, receipt minting, receipt movement, release movement, or
mutation-capable work. Receipt movement drift cases assert zero movement,
release, and mutation-capable attempts.

Raw credentials, usernames, source locations, sessions, signing keys,
idempotency keys, nonces, request bodies, tokens, row values, journal payloads,
secrets, and local paths are excluded from this evidence artifact.

## Validation

Required validation commands were run locally. Command text is represented by
SHA-256 fingerprints to keep this artifact hash-only.

| Check | Command SHA-256 | Result |
| --- | --- | --- |
| focused syntax | `bcbedb732b736c9129ba067bae86e543dc6052268102955e805eb56d884e4a71` | exit 0 |
| focused regression | `befdd756723190df9c7fa3abecf90c986876366ae6917649ccb2770c08b153b7` | 3 pass / 0 fail |
| adjacent subject binding | `33249880064db168c5faade5a188172ec678b5a231ffc03b730b33178c0c55e8` | 3 pass / 0 fail |
| adjacent nonce retry | `8207556badafb3a03ab5ea5f0b834d068bf08e1d5200b3a6278e45cfdc97d958` | 2 pass / 0 fail |
| evidence redaction scan | `f29a505564dfed94eb0133ab13d9fba704de34013434d95f044a0777452b1645` | exit 0 |
| unstaged whitespace | `466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b` | exit 0 |
| staged whitespace | `3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd` | exit 0 |

## Boundary

This proof is deterministic, local, and support-only. It does not claim release
readiness, live endpoint coverage, or production replay-store durability.
Integration recommendation: **NO-GO** for release movement from this slice
alone.
