# Objective Audit

## Verdict

- Audited commit: `4b4f9393610f86742e41426b9f95b99082adf70f` (`Prove apply revalidation retry boundary`)
- Previous audited reliable head: `f378246a0a06425416c57ac636dfb1a663c8f7af`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:26:59 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `4b4f9393610f86742e41426b9f95b99082adf70f` (`Prove apply revalidation retry boundary`)
  - `origin/lane/critic` -> `5a9151557a72619b287a721ded4d7d38d747a304`
  - `origin/lane/independent-auditor` -> `0e25436192f632c7db81e206cf44bd9675da115a`
  - `origin/lane/progress-publisher` -> `fde9d34e448b019f807f8afa268015511bc173fe`
  - `origin/main` -> `3d37812277ec7512ff724e064fd24a1f6f324632`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | `4b4f9393` pushes the checked release verifier through preserved-remote retry on the apply-revalidation path and now reports the retry boundary as proven inside the verifier. That is stronger checked release evidence, but it still runs inside the verifier surface rather than a production-owned mutation boundary on the real Reprint endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Production auth/session lifecycle | The commit still only demonstrates auth/session evidence within the checked proof and does not show one executable real-endpoint command minting and reading back a live auth session on the exact production-owned `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | The release verifier reports durable-journal details and lease-fence evidence, but the checked path still does not prove durable ownership and restart-readable replay on the real endpoint as a production-owned primitive consumed end to end. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The head now proves apply revalidation and preserved-remote retry together in the checked boundary, but it still does not provide a production-owned end-to-end pre-mutation revalidation proof on the real endpoint. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |
| Preserved-remote retry | Preserved-remote retry is now proven inside the checked verifier boundary, but it remains verifier-surfaced evidence rather than a production-owned checked release primitive on the real endpoint. | Release-path preserved-remote retry evidence consumed by the checked release command. | Blocked |
| Release-boundary proof | The evidence remains narrow: stronger apply-revalidation/auth boundary surfacing, lease-fence details, and preserved-remote retry inside the checked verifier. It still does not emit the single real-endpoint release artifact tying together live auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `4b4f9393` diff touches `scripts/playground/production-shaped-apply-revalidation-smoke.mjs` and `test/production-shaped-proof.test.js`.
2. The release verifier now proves preserved-remote retry together with apply revalidation on the checked path and exposes a narrower remaining blocker.
3. The commit still does not establish the missing production-owned, real-endpoint mutation boundary on the actual Reprint source URL.
4. Because the supervised release gates depend on that production-owned artifact, the release verdict stays `0/4`.

## Conclusion

`4b4f9393` is meaningful release-path evidence, but it closes no supervised release gate. It strengthens apply-revalidation/auth boundary proof, proves preserved-remote retry in the checked verifier, and narrows the remaining gap, yet it still leaves the real production boundary unproven. The verdict remains `0/4`.

The next exact production primitive that should use this preserved wrapper path is:

- one checked production-owned invocation of `scripts/playground/production-shaped-live-release-verify.mjs` on the real Reprint endpoint
- with explicit `REPRINT_PUSH_SOURCE_URL`, production credentials, and one caller-supplied `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`
- where that same command both mints and reads back a live auth session on the exact source boundary
- persists the session in durable restart-readable journal storage with lease-fenced ownership
- preserves rejected remote evidence for audit
- performs apply-time revalidation before the first mutation on that same boundary
- and proves preserved-remote retry on the checked release path instead of only surfacing it in the verifier boundary verdict

The next focused regression proof should pin that real-endpoint wrapper invocation directly and fail unless those fields appear together in one release-boundary result.
