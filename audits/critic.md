# Critic Verdict

Current reliable head: `a1ca1eff94781e79d000e27ddcdac68c3c4a1cb0`
(`Retry transient apply revalidation timeouts`).

Previous classified reliable head: `c2a70e1f3c7dd7f38faa8b27332e62ff0a65c874`
(`Reuse auth session source in release proofs`).

Verdict: `0/4`

Reason:

- I repolled `origin/lane/reliable-executor` and confirmed it points at
  `a1ca1eff94781e79d000e27ddcdac68c3c4a1cb0`.
- The `c2a70e1f..a1ca1eff` delta is limited to
  `scripts/playground/production-shaped-live-release-verify.mjs`.
- The only code change broadens the live wrapper retry rule from startup-only
  readiness failures to one more bounded transient case: if the child reaches
  `apply-revalidation: apply /apply` and then aborts with
  `TimeoutError: The operation was aborted due to timeout`, the wrapper
  respawns the apply-revalidation proof instead of failing the outer bounded
  run immediately.
- Reliable's retained evidence shows exactly that support win: the old bounded
  direct wrapper run died after about `149s` on the apply-timeout path, while
  the patched bounded command
  `timeout 210s env REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION=1 REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL=1 REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH=/snapshot NODE_NO_WARNINGS=1 node scripts/playground/production-shaped-live-release-verify.mjs`
  exited `0` and emitted `PACKAGED_RELEASE_BOUNDARY_OK`,
  `replayAndRetry.retryAttempts: 2`, `authSessionType:
  "production-auth-session"`, durable-journal `ownsJournal: true`,
  `restartReadable: true`, `staleClaimRejected: true`, and the expected
  apply-revalidation `PRECONDITION_FAILED` recovery block.
- That closes a verifier-wrapper timeout hole, but it still closes no
  supervised production release gate. The proof remains the same packaged
  combined wrapper path as before, still scoped to verifier/package-mode
  evidence rather than one production-owned, non-lab-backed checked release
  boundary on the real Reprint endpoint.
- So the verdict remains `0/4`: `a1ca1eff` proves the packaged combined
  wrapper can retry through a transient apply-revalidation timeout and finish
  the retained proof, but it still does not supply the missing real-endpoint
  executor/auth/session/durable-journal/preserved-remote boundary.

Next exact reliable-owned primitive:

- One production-owned, non-lab-backed checked release command on the real
  Reprint endpoint where the exact executable command string and exact live
  `REPRINT_PUSH_SOURCE_URL` are visible, that same executable command mints
  and then reads back a live auth session on the real source URL, persists it
  in durable restart-readable journal storage with lease-fenced ownership,
  preserves the rejected remote evidence for audit, and performs apply-time
  revalidation before the first mutation on that same live boundary.
