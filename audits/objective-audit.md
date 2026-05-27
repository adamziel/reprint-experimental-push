# Objective Audit

## Verdict

- Audited commit: `f378246a0a06425416c57ac636dfb1a663c8f7af` (`Prove apply revalidation auth boundary`)
- Previous audited reliable head: `86384b5ab0c6e4c5fee90aeb24643f04e403beb9`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:21:20 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `f378246a0a06425416c57ac636dfb1a663c8f7af` (`Prove apply revalidation auth boundary`)
  - `origin/lane/critic` -> `8871393b9df8086d0142f132747d631572953c0f`
  - `origin/lane/independent-auditor` -> `62c83358c0e77867dd9ff94f6fd9e42a0b739afb`
  - `origin/lane/progress-publisher` -> `3d14afceed988866aa81616378fddff71afe9b0c`
  - `origin/main` -> `0945804dad8ee0d1872c85e081e3e21f8dadede5`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | `f378246a` pushes the checked release verifier deeper into the apply-revalidation/auth boundary and now exposes a stronger boundary verdict. That is useful release-path evidence, but it still runs inside the checked verifier surface, not a proven production-owned mutation boundary on the real Reprint endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Production auth/session lifecycle | The commit shows `production-auth-session` evidence in the checked proof and distinguishes observed auth state, but it still does not show one executable real-endpoint command minting and reading back a live auth session on the exact production-owned `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | The release verifier now reports durable-journal details and lease-fence evidence, but the checked path still does not prove durable ownership and restart-readable replay on the real endpoint as a production-owned primitive consumed end to end. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The head proves apply revalidation now participates in the checked release boundary and narrows the remaining blocker to replay/preserved-remote retry on the checked path. It still does not provide a production-owned end-to-end pre-mutation revalidation proof on the real endpoint. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |
| Preserved-remote retry | The checked verifier still leaves replay/preserved-remote retry as the first remaining boundary in the boundary verdict. That is still a verifier-surfaced gap, not a production-owned checked release primitive. | Release-path preserved-remote retry evidence consumed by the checked release command. | Blocked |
| Release-boundary proof | The evidence remains narrow: stronger apply-revalidation/auth boundary surfacing, lease-fence details, and production auth-session semantics inside the checked verifier. It still does not emit the single real-endpoint release artifact tying together live auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `f378246a` diff touches `scripts/playground/production-shaped-apply-revalidation-smoke.mjs` and `test/production-shaped-proof.test.js`.
2. The release verifier now proves a stronger apply-revalidation auth boundary and exposes a narrower remaining blocker.
3. The commit still does not establish the missing production-owned, real-endpoint mutation boundary on the actual Reprint source URL.
4. Because the supervised release gates depend on that production-owned artifact, the release verdict stays `0/4`.

## Conclusion

`f378246a` is meaningful release-path evidence, but it closes no supervised release gate. It strengthens apply-revalidation/auth boundary proof and narrows the remaining gap to replay/preserved-remote retry, yet it still leaves the real production boundary unproven. The verdict remains `0/4`.

The next exact production primitive that should use this preserved wrapper path is:

- one checked production-owned invocation of `scripts/playground/production-shaped-live-release-verify.mjs` on the real Reprint endpoint
- with explicit `REPRINT_PUSH_SOURCE_URL`, production credentials, and one caller-supplied `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`
- where that same command both mints and reads back a live auth session on the exact source boundary
- persists the session in durable restart-readable journal storage with lease-fenced ownership
- preserves rejected remote evidence for audit
- performs apply-time revalidation before the first mutation on that same boundary
- and proves preserved-remote retry on the checked release path instead of only surfacing it in the verifier boundary verdict

The next focused regression proof should pin that real-endpoint wrapper invocation directly and fail unless those fields appear together in one release-boundary result.
