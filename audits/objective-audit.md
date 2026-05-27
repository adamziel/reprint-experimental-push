# Objective Audit

## Verdict

- Audited commit: `3ee9908847b2e2b89bad40abc4d0add4acd96731` (`Prioritize checked journal validation before retry proof`)
- Previous audited reliable head: `f28ff529e542875510e9343f0314366f5526cd8d`
- Latest reliable diff reviewed: `f28ff529e542875510e9343f0314366f5526cd8d..3ee9908847b2e2b89bad40abc4d0add4acd96731`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `c355d08644a767e418fc716ef51c9d3315cfe109`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 08:02:21 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `3ee9908847b2e2b89bad40abc4d0add4acd96731` (`Prioritize checked journal validation before retry proof`)
  - `origin/lane/critic` -> `c355d08644a767e418fc716ef51c9d3315cfe109` (`Classify reliable head 3ee99088`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked journal validation ordering | `src/authenticated-http-push-client.js` now computes checked-journal acceptability before returning `PRESERVED_REMOTE_RETRY_REQUIRED`, so missing preserved-remote retry evidence cannot outrank an unproven checked journal or auth/session boundary. | A production-owned checked release path that proves the same ordering against the real Reprint mutation boundary, not only the client verifier. | Support-only |
| Durable journal boundary precedence | When preserved-remote retry evidence is missing, the verifier now returns `DURABLE_JOURNAL_NOT_PROVEN` first if journal proof is still not acceptable, and only reports the retry requirement after journal proof is already acceptable. | Live durable-journal ownership, restart readability, and lease fencing on the real endpoint being audited. | Support-only |
| Auth/session drift precedence | The new regression test keeps malformed or drifted DB-journal auth/session readback ahead of preserved-remote retry proof, so checked release verification fails closed on the earlier auth/session boundary. | Production-owned auth/session issuance, readback, expiry or rotation, and same-boundary stale-session refusal. | Support-only |
| Production-owned auth/session lifecycle | `3ee99088` improves support-side ordering in the checked verifier, but it does not add a production auth/session issuer, session store, or live endpoint-owned session readback on the real mutation boundary. | One checked live run on the real endpoint proving auth/session issuance, readback, expiry or rotation handling, and stale-session refusal on that same boundary. | Blocked |
| Durable journal ownership with lease fencing and restart-readable replay | The commit strengthens failure ordering around `dbJournalProofIsAcceptable(...)`, but it does not add production-owned journal storage, lease fencing, or restart-readable replay evidence on the real endpoint. | Real endpoint proof that the durable journal is production-owned, lease-fenced, crash-readable after restart, and tied to the same live boundary being audited. | Blocked |
| Plugin-driver ownership, preserved rejected-remote evidence, and first-mutation revalidation | No plugin-driver contract, preserved rejected-remote artifact, or apply-time same-boundary revalidation primitive changed in `3ee99088`. | One checked live run on the real endpoint proving plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same production boundary. | Blocked |

## Release Blockers

1. `3ee99088` is useful support-side ordering hardening: checked journal validation now stays ahead of preserved-remote retry proof, and auth/session drift on DB-journal readback still fails before retry proof is considered.
2. The diff is still limited to `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. It does not create a production-owned auth/session lifecycle, a real endpoint-owned durable journal, plugin-driver ownership, preserved rejected-remote evidence, or apply-time revalidation before first mutation on that same boundary.
3. The current critic lane is aligned for this head and independently keeps `3ee99088` at `0/4`.
4. The required checked live release primitive is unchanged: one run on the real Reprint endpoint must prove auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.

## Critic Alignment

The current critic verdict at `c355d08644a767e418fc716ef51c9d3315cfe109` remains aligned with this audit. Both lanes treat `3ee99088` as useful checked-journal and auth/session ordering hardening while keeping the overall release-gate verdict at `0/4`.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
