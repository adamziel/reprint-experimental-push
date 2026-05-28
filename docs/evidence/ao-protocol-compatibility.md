# AO protocol-compatibility evidence

Date: 2026-05-28
Lane: protocol-compatibility
Primary checklist range: RPP-0518, RPP-0538, RPP-0558, and RPP-0915

## What changed

- Added `src/protocol-compatibility.js`, a fail-closed protocol compatibility evaluator for push version negotiation.
- Added `fixtures/protocol/push-protocol-compatibility-contract.json`, a machine-readable contract for supported versions, exact capability sets, and negative negotiation proofs.
- Added `test/protocol-compatibility.test.js` to prove supported versions negotiate exact capabilities while unknown, downgraded, missing-required, and capability-mismatch offers cannot authorize mutation.

## Covered RPP items with repository evidence

| RPP item | Evidence added |
| --- | --- |
| RPP-0518 | `negotiatePushProtocolCompatibility()` rejects missing auth/journal/lease capabilities with `PUSH_PROTOCOL_REQUIRED_CAPABILITY_MISSING` and `mutationAllowed: false`. |
| RPP-0538 | Fixture-backed negative cases prove downgraded and unknown versions fail closed before preflight, dry-run, apply, journal, or recovery can run. |
| RPP-0558 | The test iterates the contract's required capability groups instead of a single exact-shaped fixture, proving auth, journal, and lease downgrade rejection generically. |
| RPP-0915 | The machine-readable compatibility contract lists supported protocol versions, exact capabilities, fallback policy, and checked command for versioned protocol documentation. |

## Fail-closed behavior proven

- Supported versions `1.0.0` and `1.1.0` negotiate only when their offered capability sets exactly match the contract.
- Protocol version `9.9.9` fails with `PUSH_PROTOCOL_VERSION_UNSUPPORTED`.
- Protocol version `0.9.0` fails with `PUSH_PROTOCOL_VERSION_DOWNGRADED`.
- Missing `auth`, `journal`, or `lease` required capabilities fail with `PUSH_PROTOCOL_REQUIRED_CAPABILITY_MISSING`.
- Extra capabilities or non-required omissions fail with `PUSH_PROTOCOL_CAPABILITY_MISMATCH` so extensions cannot become implicit write authority.
- Multi-version offers fail closed if any offered version is unknown or downgraded; negotiation does not silently fall back to a lower supported version.

## Focused verification

```sh
node --test test/protocol-compatibility.test.js
git diff --check
```

Observed status: `node --test test/protocol-compatibility.test.js` passes (8 tests). `git diff --check` passes.
