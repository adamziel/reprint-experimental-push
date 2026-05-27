Audited `3ee9908847b2e2b89bad40abc4d0add4acd96731` (`Prioritize checked journal validation before retry proof`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` now evaluates `dbJournalProofIsAcceptable(...)` before it returns missing preserved-remote retry proof, so the checked verifier keeps durable-journal failure ahead of retry-surface evidence.
- When `simulatePreservedRemoteRetryPath` is set but the checked journal is still not acceptable, the summary now returns `DURABLE_JOURNAL_NOT_PROVEN` first and records the retry requirement only as secondary evidence.
- The new tests show the same ordering for auth/session drift on DB-journal readback: a mismatched authenticated identity still fails at `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` before preserved-remote retry proof is considered.

Why it does not move the gate:
- This is support-side release-verifier ordering hardening, not new production-owned endpoint behavior. The diff only changes `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`.
- The new tests prove earlier fail-closed behavior in the harness, but they do not prove a production-owned auth/session issuer, real endpoint-owned journal storage, or restart-readable lease fencing on the live Reprint mutation boundary.
- The diff does not add plugin-driver ownership, preserved rejected-remote evidence, or apply-time revalidation before the first mutation on that same production boundary.

Evidence reviewed:
- `3ee9908847b2e2b89bad40abc4d0add4acd96731:src/authenticated-http-push-client.js`
- `3ee9908847b2e2b89bad40abc4d0add4acd96731:test/authenticated-http-push-client.test.js`
- `c355d08644a767e418fc716ef51c9d3315cfe109` (`Classify reliable head 3ee99088`)

Critic alignment:
- `origin/lane/critic` at `c355d08644a767e418fc716ef51c9d3315cfe109` also keeps `3ee99088` at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
