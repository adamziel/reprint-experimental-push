# RPP-0572 request signature canonicalization, variant 4

Date: 2026-05-31

Status: generated local executor-auth support evidence only. Final release
remains **NO-GO** until the same behavior is proven at the checked production
release boundary.

## Claim

Equivalent signed request shapes canonicalize to the same signed input.
Malformed or tampered signed requests fail before JSON parsing, nonce claim,
receipt work, durable-write setup, append work, or mutation-capable work.

## Hash-Only Evidence

No raw credentials, usernames, source locators, session identifiers, signing
keys, idempotency keys, nonces, request bodies, tokens, row values, durable
payloads, or local paths are recorded in this artifact.

| Field | SHA-256 |
| --- | --- |
| proofClaimSetHash | 65889513acd87c5e7a0881a5405e7e15484247406148b43a6fa2ac89ba84c4ce |
| coverageArtifactHash | b19c949069b0171d9066761f0e9ee75b354971fc4ec6ddd209abd70b0e404e05 |
| canonicalCaseSetHash | c8edbee7609d9578e5cc270c786403192d5f37738e27186d8a923202a4493efb |
| positiveCaseSetHash | 57d8364b3c4f21ae2b1f65e66f3cac3f1f58517350facae29c37e93fa30a2ee2 |
| negativeCaseSetHash | 7c0281b25d3ee8b65ee681ec6ac544a0924e9efe14772dd807e9ccb3abe9fce7 |
| sourceAssertionSetHash | b306e3dd98db159b7d6c47d0b9b690b8b92c331dd4574010fc8f4f5e91e62ca1 |
| aggregateSupportHash | 0902e25aca29892bf1e40c06c98195d9e63419eae7a0e5364bb736da5b1357a4 |
| commandSetHash | f0a8b15605a0b06771cb47e540ae8f7511a5d7ec0e81407fab733efa6cd72668 |
| outcomeSetHash | bcd84b6b86f8ae3e0edd9e71430525ce09d53b05ebda5c8f55d83ed6efdf51dc |

## Proven Counts

| Count | Value |
| --- | ---: |
| canonical equivalence groups | 4 |
| positive support paths | 2 |
| malformed or tampered negative cases | 19 |
| route-order assertion groups | 8 |

## Validation Digests

| Check | commandHash | outcomeHash |
| --- | --- | --- |
| syntax | 4cb2a0cce05a3ae7e244a73f52c1fbce42ded190c49bc742e3de49a14584eac8 | 804cb8b0d0ccd96791ae5eed231de68f307bffbdf3522e93d8bc0ec856db38de |
| focused variant | a86e59ac61a0a852ce882567d3b7b64a16af2188ace4497f9a90ba0ab62c4305 | e547b0ff02a131c7e2ed870cb58e5ff1e40650588b98a0a09f4928c8f8847801 |
| adjacent variant | 420c65b7e774be28a95b2fcc9cda2b44d3ad534fbfc0b70c232d81ce18c8e866 | e267dd36f3317006bce83b8e1e89c60b5e761f806e2d13a85a2b84bf0995c1dc |
| client canonical subset | 30e18220dad762c74a898ec9e5395843befa49e07b8da7443cfc9b8516bc0222 | 735cf1bb8cbc705dfdec2453be0effc7415740adf2080a5cb66161f22f7038cd |
| redaction scan | b514cfc22ca7ceecee42746c2a4925ebe2a5e8de6f040e35d35153b96dac0044 | b96d21d4f1994c8e501aea790e23494dd01bd403b553b7c222a9ab3d48114966 |
| unstaged whitespace | 466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b | 49ae5b0ab80dc7be8480165407fc06e4ba5e3a36327832e60f3013786638eb06 |
| staged whitespace | 3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd | 49ae5b0ab80dc7be8480165407fc06e4ba5e3a36327832e60f3013786638eb06 |

Observed result: all validation commands exited successfully. The focused
variant reported 4 passes and 0 failures. The adjacent variant reported 3
passes and 0 failures. The client canonical subset reported 1 pass and 0
failures. The redaction scan reported an allowed hash-only artifact.

## Boundary

This is deterministic local support evidence. It strengthens the executor-auth
canonicalization contract, but it does not change the release posture.
Promotion remains **NO-GO** until checked production-owned evidence covers the
same behavior.
