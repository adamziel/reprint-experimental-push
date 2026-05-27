# Objective Audit

## Verdict

- Audited commit: `75f695689f065cf18cbb93325c481cd615d48cf4` (`Fail fast when live release source is missing`)
- Previous audited reliable head: `45ea450613d972f4901371cbd38b11c53ba5c0b0`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 09:56:26 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `75f695689f065cf18cbb93325c481cd615d48cf4` (`Fail fast when live release source is missing`)
  - `origin/lane/critic` -> `1087b9e7d09795240f68f6635ab47d970f353ff3`
  - `origin/lane/independent-auditor` -> `dba83193770a6c32c65cf6b81654122da03f0b68`
  - `origin/lane/progress-publisher` -> `492fb0c0fd9e61b99aaebdbfb2bcb126d14af06d`
  - `origin/main` -> `5b9b847e6f038585f5425ff30c3cc2652b871888`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live-source fast-fail handling | `75f69568` adds an early `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` branch when both production auth and durable-journal boundaries are required but no live source URL is provided. | A production-owned real-endpoint command proving the checked release path proceeds on an actual live `REPRINT_PUSH_SOURCE_URL`, not just fails fast when it is absent. | Support-only |
| Production auth/session lifecycle | The diff stays in `scripts/playground/production-shaped-release-verify.mjs` and `test/production-shaped-proof.test.js`. It proves the checked verifier can stop before packaged fallback when the live source is missing, but it does not mint or read back a live auth session on the real source. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | The new branch reports durable-journal semantics as required, but it does not add a new production-owned journal primitive or restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The diff explicitly blocks the missing live boundary and emits the `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` code, but it still does not execute a real-endpoint mutation path. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This is still checked-release harness logic. It improves failure discipline by refusing packaged fallback when the live source is absent, but it does not convert that into a production-owned release primitive. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The change makes the missing live-source boundary explicit, but it does not add a new command, test, or artifact proving the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `75f69568` diff adds a fail-fast path for missing live source inputs when the checked release path requires both production auth and durable-journal boundaries.
2. That is a useful safety improvement because it prevents the verifier from silently falling back to packaged behavior when the live source is absent.
3. The patch still does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership, or apply-time revalidation on the production endpoint.
4. The new tests verify the fail-fast behavior in the harness, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`75f695689f065cf18cbb93325c481cd615d48cf4` closes no supervised release gate. It is a narrow checked release-verifier support change that forces the verifier to fail early when a live source is missing, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected-remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
