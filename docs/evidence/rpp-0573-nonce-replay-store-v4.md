# RPP-0573 nonce replay store, variant 4

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until equivalent behavior is proven against a production-owned nonce
replay store and production-owned auth inputs.

## Claim

Local support proof shows that accepted dry-run receipts bind the accepted
nonce claim to the receipt subject material: short-lived session, authenticated
identity, auth session, requested scope, and canonical plan hash.

## Proof Surface

This slice adds focused regression coverage for variant 4:

- source-order assertions that signed nonce replay checks happen before dry-run
  parsing and that authenticated receipt validation happens before any
  mutation-capable apply path;
- an accepted support path that mints one dry-run receipt and verifies the
  receipt hash, nonce claim hash, session hash, identity hash, auth-session
  hash, scope hash, and canonical plan hash all agree; and
- negative replay and subject-drift matrices that stop before replay JSON
  parsing, before receipt movement, and before mutation-capable work.

No live endpoint, production credential, remote tunnel, external network
dependency, row-value evidence, or journal payload evidence was used.

## Hash-Only Evidence Shape

The support envelopes assert only hashes, counts, booleans, and status markers:

- accepted nonce hash, nonce-claim hash, pre-parse subject hash, and final
  receipt-subject hash;
- receipt hash, canonical plan hash, subject binding hash, dry-run nonce hash,
  dry-run canonical hash, idempotency binding hash, and nonce-claim hash;
- subject hashes for session, identity, auth session, scope, and plan;
- replay refusal hashes for exact replay plus session, identity, scope, and
  canonical-plan drift attempts; and
- movement refusal hashes for session, identity, scope, and canonical-plan drift
  attempts.

The negative envelopes assert that replay attempts keep JSON parse count at the
accepted request only, mint no second receipt, move no receipt, and attempt no
mutation-capable work. Receipt movement drift cases assert zero movement
attempts and zero mutation-capable work attempts.

Raw credentials, usernames, source locations, sessions, signing keys,
idempotency keys, nonces, request bodies, tokens, row values, journal payloads,
secrets, and local paths are excluded from this evidence artifact.

## Validation

Required validation commands were run locally. Command text is represented by
SHA-256 fingerprints to keep this artifact hash-only.

| Check | Command SHA-256 | Result |
| --- | --- | --- |
| focused syntax | `3c1909959baa91fad17f3cd377b72c1a241047299e21aa112f28d993ee39276a` | exit 0 |
| focused regression | `33249880064db168c5faade5a188172ec678b5a231ffc03b730b33178c0c55e8` | 3 pass / 0 fail |
| adjacent nonce replay | `8207556badafb3a03ab5ea5f0b834d068bf08e1d5200b3a6278e45cfdc97d958` | 2 pass / 0 fail |
| adjacent session binding | `ed4d226aac084c2fbc26a6b3b0dd1a52995c52730279b6201e5cace40ced168e` | 3 pass / 0 fail |
| base session binding | `281355a0486fd646cd0b71b92f0a0ac6d0a1b61aaeb2baa86f837181e677a1f0` | 3 pass / 0 fail |
| evidence redaction scan | `edc31a54a54a2f6fd3a767598db1b9659730b240fe30ce9c6c09d55f6f5f280b` | exit 0 |
| unstaged whitespace | `466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b` | exit 0 |
| staged whitespace | `3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd` | exit 0 |

## Boundary

This proof is deterministic, local, and support-only. It does not claim release
readiness or production endpoint coverage. Integration recommendation:
**NO-GO** for release movement from this slice alone.
