# Objective Audit

## Verdict

- Audited commit: `37aab99a33dc9a21c78193d9b2d086dfcf1b9368` (`Use release clock for auth session expiry`)
- Previous audited reliable head: `c40affc90c17853bc61a213e6e32fa6ffdfb510c`
- Critic reference: `5a24242476423b7e3740cb5839118d3ece6de7f9` (`Classify reliable head 37aab99a`)
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 12:20:13 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `37aab99a33dc9a21c78193d9b2d086dfcf1b9368` (`Use release clock for auth session expiry`)
  - `origin/lane/critic` -> `5a24242476423b7e3740cb5839118d3ece6de7f9`
  - `origin/lane/independent-auditor` -> `9fd7d0884338695e717fd05fc4fd987e6d5cb311`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Release-clock expiry checks | `37aab99a` threads the release observation clock through checked auth/session expiry and replay-equivalence checks, with focused tests. | A production-owned, non-lab release command that proves this lifecycle behavior on the real `/wp-json/reprint/v1/push/*` boundary. | Support-only |
| Production auth/session lifecycle | The new coverage hardens client-side expiry classification, but it remains mocked/support-side evidence. | Real endpoint proof of auth/session issuance and readback from the same live `REPRINT_PUSH_SOURCE_URL` and executable source. | Blocked |
| Durable restart-readable journal ownership | The commit improves expiry handling across db-journal readback, but it does not create live restart-readable journal proof. | Durable `ownsJournal: true`, `restartReadable: true`, and lease-fenced journal ownership on the release boundary. | Blocked |
| Plugin-driver release ownership | The change does not establish plugin-driver ownership on the release boundary. | Plugin-owned mutation proof using the real release path, including allowlisted semantics, precondition evidence, and audit evidence. | Blocked |
| Rejected remote evidence and apply-time revalidation | The commit does not prove preserved rejected-remote evidence or revalidation before the first mutation on a live endpoint. | Preserved rejected remote evidence plus apply-time revalidation before mutation on the production-owned path. | Blocked |

## Change Assessment

1. `37aab99a` is checked auth/session lifecycle hardening for release-clock expiry behavior.
2. The change is still support evidence in `src/authenticated-http-push-client.js` and focused tests.
3. It does not run the real production-owned source mutation boundary, and it does not prove durable journal ownership, plugin-driver ownership, rejected-remote preservation, or pre-mutation revalidation on that boundary.
4. No release gate moved. The project remains `0/4`.

## Conclusion

`37aab99a33dc9a21c78193d9b2d086dfcf1b9368` improves checked release-clock expiry handling, but it does not prove the missing production-owned, non-lab `REPRINT_PUSH_SOURCE_URL` release boundary. The verdict remains `0/4`.
