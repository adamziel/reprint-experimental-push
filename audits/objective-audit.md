# Objective Audit

## Verdict

- Audited commit: `d9ec5130979968098ac7b16b93220bd0d3fdbe38` (`Preserve live source in release wrapper`)
- Previous audited reliable head: `66afff2b1da3e83018f04d9ece3e42d46cab7f92`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:01:19 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `d9ec5130979968098ac7b16b93220bd0d3fdbe38` (`Preserve live source in release wrapper`)
  - `origin/lane/critic` -> `037e5b55828340e9fc9bfbb42eeb8bff8a525b54` (`Classify reliable head d9ec5130`)
  - `origin/lane/independent-auditor` -> `1b98cdc0d86e929620f46e4fbbbe9f559a09d500` (`Audit reliable head 66afff2b`)
  - `origin/lane/progress-publisher` -> `ff6ada235356b77a1000a790c202d1ab9cc226b0` (`Refresh progress for current reliable head`)
  - `origin/main` -> `fb313455efba84627ca33402dd32e8992e5be904` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | `d9ec5130` adds helper plumbing in [production-shaped-live-release-verify-lib.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/scripts/playground/production-shaped-live-release-verify-lib.js:19) and a new explicit checked-boundary branch in [production-shaped-live-release-verify.mjs](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/scripts/playground/production-shaped-live-release-verify.mjs:68) so caller-supplied live env is preserved instead of being replaced by a local `remote-base` source. That still does not execute or record any new real-endpoint mutation boundary. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Production auth/session lifecycle | The wrapper now passes an explicit `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` through to both checked verify and apply revalidation env builders, and the deterministic test in [production-shaped-proof.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/test/production-shaped-proof.test.js:3700) pins that preservation contract. It still does not show one executable real-endpoint command minting and reading back a live auth session on the exact production-owned `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | No new journal primitive or real-boundary journal artifact was added. The wrapper can now preserve caller-provided live source/session inputs, but the evidence for `ownsJournal: true`, `restartReadable: true`, and stale-claim fencing remains inherited from the broader verifier path rather than a newly proven production-owned boundary. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | `resolveLiveApplyRevalidationEnv()` now preserves an explicit checked-boundary source URL and auth-session source command for the apply revalidation smoke path, and the retained retry test still passes. That improves fidelity of a future live proof, but it does not add a new checked real-endpoint artifact showing apply-time revalidation before the first mutation. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |
| Wrapper preservation proof | The new helpers distinguish explicit checked-boundary requests from the default local Playground branch and keep the local branch unchanged. The focused test proves the wrapper no longer silently synthesizes its own local source when the caller already supplied live boundary inputs. | Proof that this wrapper preservation path is exercised by a production-owned release primitive instead of only a deterministic unit contract. | Support-only |
| Release-boundary proof | Reliable retained verification stays narrow: `node --check` on the three touched files, one focused `node --test --test-name-pattern=...`, and `git diff --check`. I re-ran the syntax checks and focused proof test in the `d9ec5130` reliable clean worktree because these touched files are not present in the auditor checkout. The patch prepares the wrapper for a future direct gate dependency, but it still does not emit the missing single real-endpoint release artifact. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `66afff2b..d9ec5130` diff touches only `scripts/playground/production-shaped-live-release-verify-lib.js`, `scripts/playground/production-shaped-live-release-verify.mjs`, and `test/production-shaped-proof.test.js`.
2. In [production-shaped-live-release-verify-lib.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/scripts/playground/production-shaped-live-release-verify-lib.js:19), the new helper layer detects whether the caller made an explicit checked-boundary request and centralizes env resolution for both checked verify and apply revalidation.
3. In [production-shaped-live-release-verify.mjs](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/scripts/playground/production-shaped-live-release-verify.mjs:54), the wrapper now has three paths: packaged boundary, explicit checked boundary, and the unchanged default local-Playground branch. The explicit checked-boundary path preserves caller-provided `REPRINT_PUSH_SOURCE_URL`, credentials, and `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` instead of replacing them with a local `remote-base` source.
4. In [production-shaped-proof.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/test/production-shaped-proof.test.js:3700), the new deterministic proof asserts that both the checked-verify env and apply-revalidation env preserve the explicit live source and auth-session source command. The existing transient apply revalidation timeout retry test remains intact and passes.
5. This is real progress on wrapper correctness, but it is still support-only. The change preserves inputs for a future production proof; it does not itself produce that proof. No new command output shows the same executable command minting and reading back a live auth session on the real source URL, persisting it durably with lease-fenced ownership, preserving rejected remote evidence, and revalidating before first mutation.
6. Because the supervised release gates depend on that single production-owned artifact, not just on internal wrapper fidelity, the release verdict stays `0/4`.

## Conclusion

`d9ec5130` closes no supervised release gate. It fixes an important release-wrapper correctness issue by preserving caller-provided live source and auth-session command inputs across the explicit checked-boundary path, but it still leaves all four production gates closed because the repo does not yet prove that path on the real Reprint endpoint. The verdict remains `0/4`.

The next exact production primitive that should use this preserved wrapper path is:

- one checked production-owned invocation of `scripts/playground/production-shaped-live-release-verify.mjs` on the real Reprint endpoint
- with explicit `REPRINT_PUSH_SOURCE_URL`, production credentials, and one caller-supplied `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`
- where that same command both mints and reads back a live auth session on the exact source boundary
- persists the session in durable restart-readable journal storage with lease-fenced ownership
- preserves rejected remote evidence for audit
- and performs apply-time revalidation before the first mutation on that same boundary

The next focused regression proof should pin that real-endpoint wrapper invocation directly and fail unless those fields appear together in one release-boundary result.
