# Objective Audit

## Verdict

- Audited commit: `fed870ec97c86fd2c44962c1535a39a1e38903c1` (`Fix checked journal regression precedence`)
- Previous audited reliable head: `83d0fe8507f2b0cfaf5e376ec2501fe3c2266371`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 08:43:59 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `fed870ec97c86fd2c44962c1535a39a1e38903c1` (`Fix checked journal regression precedence`)
  - `origin/lane/critic` -> `16e404155d01c6c34c80c2da4a684b947af9b4a5`
  - `origin/lane/progress-publisher` -> `60212c512bb2fd8c49bb4a0939e265a4ce2399df`
  - `origin/main` -> `284547696df8133a9648ee642e69af739320007d`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked journal regression precedence | `fed870ec` changes only `src/authenticated-http-push-client.js`. It introduces a checked-boundary precedence path via `dbJournalCheckedBoundaryIsAcceptable()`, normalizes checked boundary journal ownership data, and adjusts how journal proof acceptance is evaluated when production auth/session or preserved-retry conditions are in play. | A production-owned real-endpoint boundary proving those precedence rules on the live Reprint source, not just in the client summary logic. | Support-only |
| Production auth/session lifecycle | The current diff remains inside the authenticated HTTP push client. It does not add a checked live command that visibly mints and then reads back a live auth session on the real `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary, plus expiry/rotation/revocation/cleanup behavior on that live path. | Blocked |
| Durable restart-readable journal ownership | The commit strengthens how checked journal evidence is interpreted, but it still lives in the client-side acceptance path. No new production-owned journal primitive or restart-readable live artifact was added. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The diff does not execute or expose a new real-endpoint mutation boundary. It only changes precedence and normalization rules for already-collected checked journal evidence. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This is still a checked-client regression-precedence fix inside the packaged verifier path. It helps the verifier prefer stricter checked journal evidence when available, but it does not convert that evidence into a production-owned release primitive. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The change is narrow and useful, but it does not add a new command, test, or artifact proving the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `83d0fe85..fed870ec` diff touches only `src/authenticated-http-push-client.js`.
2. The patch changes precedence for checked journal regression handling so the client prefers stricter checked-boundary acceptance when production auth/session or preserved-retry conditions are relevant.
3. The patch also normalizes checked boundary journal ownership data, including claim/lease handling, so the client summary is less likely to misclassify regression precedence.
4. This is legitimate hardening of the checked client surface. It is still support evidence because it does not add a live Reprint release artifact, a production-owned source mutation boundary, or a real checked command that proves auth issuance/readback on the actual source URL.
5. No new tests were added in this commit, and the diff does not show a new end-to-end proof path. That keeps the release verdict at `0/4`.

## Conclusion

`fed870ec97c86fd2c44962c1535a39a1e38903c1` closes no supervised release gate. It is a narrow, checked-client regression-precedence fix that makes the journal boundary more conservative, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected-remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
