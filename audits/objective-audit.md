# Objective Audit

## Verdict

- Audited commit: `8823b710de44ebdba3bf2e3a1c786f21f0d9a86e` (`Accept matching runtime auth session sources`)
- Previous audited reliable head: `6096a2f4c9a771016d12107da4a7a4d7486b5347`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 10:01:55 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `8823b710de44ebdba3bf2e3a1c786f21f0d9a86e` (`Accept matching runtime auth session sources`)
  - `origin/lane/critic` -> `05eab0146687f1c707bd7325a4e5a7101b18b6f4`
  - `origin/lane/independent-auditor` -> `6096a2f4c9a771016d12107da4a7a4d7486b5347`
  - `origin/lane/progress-publisher` -> `c3beb57053dcb991df34df710592bc96407357be`
  - `origin/main` -> `fa1c4bdf82afc26c7b150db4222800a3003defd8`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live-source acceptance boundary | `8823b710` lets the auth-session source loader accept matching explicit live source URLs and reject remote sources that do not match the live boundary. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff widens `scripts/playground/auth-session-source.js` and adjusts release-verifier wiring so matching runtime source URLs override stale env values, but it still only shapes how the checked harness resolves auth source inputs. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change keeps the checked release verifier on the auth-session source path and updates apply-revalidation smoke coverage, but it does not add a new production-owned journal primitive or restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch improves source selection and override behavior for runtime auth-session inputs, but it does not execute a real-endpoint mutation path. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This is still checked-release harness and source-loader logic. It narrows the live boundary, but it does not convert that into a production-owned release primitive. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new tests verify matching runtime auth-session source handling and non-local override behavior, but they do not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `8823b710` is a meaningful release-verifier support change because it accepts matching runtime auth-session sources and rejects mismatched remote ones.
2. It also tightens the checked release path so stale env credentials cannot override a matching explicit live source boundary.
3. The patch still stays inside source-loader and harness wiring. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership, or apply-time revalidation on the production endpoint.
4. The new tests verify the source-resolution behavior in the harness, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`8823b710de44ebdba3bf2e3a1c786f21f0d9a86e` closes no supervised release gate. It is a narrow checked release-verifier support change that accepts matching runtime auth-session sources, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected-remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
