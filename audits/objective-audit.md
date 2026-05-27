# Objective Audit

## Verdict

- Audited commit: `2b21b0c9f2ab898c2cb466f021e4bbd0ea237107` (`Allow https release sources`)
- Previous audited reliable head: `d9ec5130979968098ac7b16b93220bd0d3fdbe38`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:03:10 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `2b21b0c9f2ab898c2cb466f021e4bbd0ea237107` (`Allow https release sources`)
  - `origin/lane/critic` -> `ba9480b7752bad1d4f4149d906378f7b0534d4d8` (`Classify reliable head 2b21b0c9`)
  - `origin/lane/independent-auditor` -> `49be3c9a7aa24efc612caca7314ac845416f850a` (`Audit reliable head d9ec5130`)
  - `origin/lane/progress-publisher` -> `ff6ada235356b77a1000a790c202d1ab9cc226b0` (`Refresh progress for current reliable head`)
  - `origin/main` -> `fb313455efba84627ca33402dd32e8992e5be904` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | `2b21b0c9` changes [auth-session-source.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor-current-20260526-1424/scripts/playground/auth-session-source.js:1), [authenticated-http-push-client.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor-current-20260526-1424/src/authenticated-http-push-client.js:1), and the associated tests so `https` release sources are accepted. That is a source-policy adjustment, not a real-endpoint mutation boundary. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Production auth/session lifecycle | The head now allows `https` release sources, but the evidence still stops at source acceptance and client/test plumbing. It does not show one executable real-endpoint command minting and reading back a live auth session on the exact production-owned `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | No new journal primitive or real-boundary journal artifact was added by `2b21b0c9`. The commit does not establish `ownsJournal: true`, `restartReadable: true`, or lease-fenced stale-claim fencing on the real endpoint. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The `https` source allowance does not add a checked real-endpoint artifact showing apply-time revalidation before the first mutation. The wrapper fidelity question remains support-side, not a production gate. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |
| Wrapper preservation proof | The code still preserves the caller-supplied source boundary more consistently, but this head is only a policy expansion for accepted release sources. It does not prove that preservation path is exercised by a production-owned release primitive instead of a deterministic unit contract. | Proof that this wrapper preservation path is exercised by a production-owned release primitive instead of only a deterministic unit contract. | Support-only |
| Release-boundary proof | The evidence remains narrow: source-policy acceptance and focused test coverage. It does not emit the missing single real-endpoint release artifact tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `d9ec5130..2b21b0c9` diff touches `scripts/playground/auth-session-source.js`, `src/authenticated-http-push-client.js`, `test/authenticated-http-push-client.test.js`, and `test/production-shaped-proof.test.js`.
2. In `auth-session-source.js`, the release-source selection now allows `https` release sources instead of rejecting them as unsupported release URLs.
3. In `authenticated-http-push-client.js`, the release-path client accepts the broader release source policy, and the tests now cover that accepted `https` source behavior.
4. The proof is still input-policy and client/test level. It does not show the same executable command minting and reading back a live auth session on the real source URL, persisting it durably with lease-fenced ownership, preserving rejected remote evidence, and revalidating before first mutation.
5. Because the supervised release gates depend on that single production-owned artifact, not just on source-policy acceptance, the release verdict stays `0/4`.

## Conclusion

`2b21b0c9` closes no supervised release gate. It expands accepted release-source policy to `https` inputs and updates the related client/test coverage, but it still leaves all four production gates closed because the repo does not yet prove a real-endpoint production-owned source boundary on the actual Reprint endpoint. The verdict remains `0/4`.

The next exact production primitive that should use this preserved wrapper path is:

- one checked production-owned invocation of `scripts/playground/production-shaped-live-release-verify.mjs` on the real Reprint endpoint
- with explicit `REPRINT_PUSH_SOURCE_URL`, production credentials, and one caller-supplied `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`
- where that same command both mints and reads back a live auth session on the exact source boundary
- persists the session in durable restart-readable journal storage with lease-fenced ownership
- preserves rejected remote evidence for audit
- and performs apply-time revalidation before the first mutation on that same boundary

The next focused regression proof should pin that real-endpoint wrapper invocation directly and fail unless those fields appear together in one release-boundary result.
