# Objective Audit

## Verdict

- Audited commit: `2c2adeaf861442837a7584f8848d31ebf72cd228` (`Make auth session source command executable`)
- Previous audited reliable head: `3b0df9c2efd16a4f68c907f6843b804dcbd2bbc8`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 09:24:39 CEST (+0200)
- Audit time: 2026-05-27 09:29:08 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `2c2adeaf861442837a7584f8848d31ebf72cd228` (`Make auth session source command executable`)
  - `origin/lane/critic` -> `b292163ff09930f0cd94bf1e4197eb5f309c0e5a`
  - `origin/lane/independent-auditor` -> `15900a084b2f53f0f49172190b10488dbef57884`
  - `origin/lane/progress-publisher` -> `19889d0dcd0890f4dd0eaa272d97a592806c1e51`
  - `origin/main` -> `5b9b847e6f038585f5425ff30c3cc2652b871888`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Auth-session source command executability | `2c2adeaf` adds `scripts/playground/auth-session-source-command.js` and bounded proof coverage so the auth-session source command is executable from the checked release-verifier path. | A production-owned real-endpoint boundary proving the same release path on the live Reprint source, not just command executability inside the verifier surface. | Support-only |
| Production auth/session lifecycle | The diff still stays in `scripts/playground/*` and `test/production-shaped-proof.test.js`. It does not add a checked live command that visibly mints and then reads back a live auth session on the real `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary, plus expiry/rotation/revocation/cleanup behavior on that live path. | Blocked |
| Durable restart-readable journal ownership | The commit does not add a new production-owned journal primitive or restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The diff does not execute or expose a new real-endpoint mutation boundary. It only makes the auth-session source command executable in the checked proof path. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This remains checked-release harness work inside the packaged verifier path. It improves how the verifier invokes auth-session source commands, but it does not convert that evidence into a production-owned release primitive. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The change is narrow and useful, but it does not add a new command, test, or artifact proving the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `2c2adeaf` diff adds an executable auth-session source command plus release-proof coverage for invoking it from the checked verifier path.
2. The patch improves how the release verifier can consume the source command, but it still does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership, or apply-time revalidation on the production endpoint.
3. This remains support evidence because the new behavior is still expressed inside `scripts/playground/*` and the verifier test harness. It does not itself prove a production-owned real-endpoint boundary on the live Reprint source.
4. The patch adds focused assertions around source-command executability, but not the missing production-owned real-endpoint artifact. That keeps the release verdict at `0/4`.

## Conclusion

`2c2adeaf861442837a7584f8848d31ebf72cd228` closes no supervised release gate. It is a narrow, checked release-verifier support change that makes the auth-session source command executable from the harness, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected-remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
