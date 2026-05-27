Audited `97790e454633adf887e04db408d8fa0fd59d4346` (`Fail closed on explicit live source fallback`).

Verdict: `0/4`

What changed:
- `scripts/playground/production-shaped-live-release-verify-lib.js` now accepts `allowCredentialFallback` and only synthesizes fallback fixture credentials when that flag is explicitly enabled. The explicit live-source paths now leave `REPRINT_PUSH_USERNAME` and `REPRINT_PUSH_APPLICATION_PASSWORD` blank unless the operator provided real credentials.
- `scripts/playground/production-shaped-live-release-verify.mjs` now fails closed before verify when an explicit live source URL is present without either `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` or an explicit username plus application password, and it emits a structured JSON gate failure instead of silently inheriting lab credentials.
- The wrapper also preserves JSON proof on checked-release failure and only continues into apply revalidation after a successful verify leg. The packaged and default local-fixture paths still enable fallback explicitly, so the change is scoped to explicit live boundaries.
- `test/production-shaped-proof.test.js` adds regression coverage for the new env-resolution rules on explicit live verify and apply-revalidation paths while preserving the local-fixture fallback behavior when `allowCredentialFallback: true`.

Why it does not move the gate:
- This is release-wrapper hardening around Playground-oriented entrypoints, not new production-owned endpoint behavior. The diff does not add a real Reprint endpoint, a live production credential issuer, or a checked live boundary run.
- The new fail-closed guard proves the wrapper no longer silently falls back to lab credentials for explicit live boundaries, which is valuable, but it still does not prove a production-owned auth/session lifecycle on the same boundary.
- The new tests cover helper and wrapper behavior only. They do not prove durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, or apply-time revalidation before the first mutation on a production-owned endpoint.

Evidence reviewed:
- `97790e454633adf887e04db408d8fa0fd59d4346:scripts/playground/production-shaped-live-release-verify-lib.js`
- `97790e454633adf887e04db408d8fa0fd59d4346:scripts/playground/production-shaped-live-release-verify.mjs`
- `97790e454633adf887e04db408d8fa0fd59d4346:test/production-shaped-proof.test.js`
- `2cbb9a3e95c623bfccb9144764e36c4c4edd8515` (`Classify reliable head 97790e45`)

Critic alignment:
- `origin/lane/critic` at `2cbb9a3e95c623bfccb9144764e36c4c4edd8515` also keeps the verdict at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
