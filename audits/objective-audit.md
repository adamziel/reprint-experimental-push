# Objective Audit

## Verdict

- Audited commit: `051fe7f44a2dd400d4f1e08c7cff4f745e944a02` (`Use production snapshot export for live source verify`)
- Previous audited reliable head: `4b4f9393610f86742e41426b9f95b99082adf70f`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:33:01 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `051fe7f44a2dd400d4f1e08c7cff4f745e944a02` (`Use production snapshot export for live source verify`)
  - `origin/lane/critic` -> `5a9151557a72619b287a721ded4d7d38d747a304`
  - `origin/lane/independent-auditor` -> `998949bfbf56ed79a81252a0575e55383fdffd65`
  - `origin/lane/progress-publisher` -> `fde9d34e448b019f807f8afa268015511bc173fe`
  - `origin/main` -> `3d37812277ec7512ff724e064fd24a1f6f324632`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | `051fe7f4` makes the checked release verifier choose the production snapshot export when the source URL is explicit. That is a narrower and more realistic wrapper path, but it is still source selection inside the verifier rather than a production-owned mutation boundary on the real Reprint endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Production auth/session lifecycle | The commit improves live-source handling for the verifier, but it still does not show one executable real-endpoint command minting and reading back a live auth session on the exact production-owned `REPRINT_PUSH_SOURCE_URL`. | One checked real-endpoint command proving issuance and readback on the same production-owned source boundary. | Blocked |
| Durable restart-readable journal ownership | The change does not add a production-owned durable journal consumer or restart-readable replay proof on the real endpoint. The journal boundary is still only implied by verifier wiring. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The verifier now prefers the production-shaped snapshot export for explicit live-source runs, but that remains wrapper-level routing rather than an end-to-end production proof that revalidation occurs before the first mutation on the real source boundary. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |
| Preserved-remote retry | The commit does not introduce or consume a preserved-remote retry proof on the real release path. It only makes the verifier pick the production-shaped snapshot route when configured to do so. | Release-path preserved-remote retry evidence consumed by the checked release command. | Blocked |
| Release-boundary proof | The evidence is better aligned with live source selection, but it still does not emit the single real-endpoint artifact tying together live auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, preserved-remote retry, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. The `4b4f9393` diff proved apply-revalidation retry inside the checked verifier, but it was superseded by the later live-source selection work.
2. The `051fe7f4` diff touches `scripts/playground/production-shaped-live-release-verify-lib.js`, `scripts/playground/production-shaped-release-verify.mjs`, and `test/production-shaped-proof.test.js`.
3. The new helper now chooses the production snapshot export for explicit live-source verification, but that is still wrapper-level source selection rather than the production-owned mutation boundary on the actual Reprint source URL.
4. Because the supervised release gates depend on that production-owned artifact, the release verdict stays `0/4`.

## Conclusion

`051fe7f4` is meaningful release-path evidence, but it closes no supervised release gate. It narrows the checked verifier to the production snapshot export for explicit live-source runs, yet it still leaves the real production boundary unproven. The verdict remains `0/4`.

The next exact production primitive that should use this preserved wrapper path is:

- one checked production-owned invocation of `scripts/playground/production-shaped-live-release-verify.mjs` on the real Reprint endpoint
- with explicit `REPRINT_PUSH_SOURCE_URL`, production credentials, and one caller-supplied `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`
- where that same command both mints and reads back a live auth session on the exact source boundary
- persists the session in durable restart-readable journal storage with lease-fenced ownership
- preserves rejected remote evidence for audit
- performs apply-time revalidation before the first mutation on that same boundary
- and proves preserved-remote retry on the checked release path instead of only surfacing it in the verifier boundary verdict

The next focused regression proof should pin that real-endpoint wrapper invocation directly and fail unless those fields appear together in one release-boundary result.
