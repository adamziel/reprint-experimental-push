# Critic Verdict

Fetched reliable ref today:

- `origin/lane/reliable-executor` no longer points at
  `b8f2b23af24c3bc3ab6faa91c490a2bb550d53a8`; after `git fetch` it resolves to
  `66afff2b1da3e83018f04d9ece3e42d46cab7f92`
  (`Narrow packaged driver proof helper`).
- Reliable's retained lane output still shows that `b8f2b23af` was the pushed
  remote head immediately before that follow-up advanced the branch, so this
  note classifies `b8f2b23af24c3bc3ab6faa91c490a2bb550d53a8`
  (`Pin live apply timeout retry`) directly.

Previous classified reliable head: `a1ca1eff94781e79d000e27ddcdac68c3c4a1cb0`
(`Retry transient apply revalidation timeouts`).

Verdict for `b8f2b23af24c3bc3ab6faa91c490a2bb550d53a8`: `0/4`

Reason:

- The `a1ca1eff..b8f2b23a` diff is narrow and entirely verifier-side:
  it extracts `applyRevalidationRetryable()` into
  `scripts/playground/production-shaped-live-release-verify-lib.js`,
  removes the identical inline helper from
  `scripts/playground/production-shaped-live-release-verify.mjs`, and adds one
  focused positive/negative unit test in
  `test/production-shaped-proof.test.js`.
- The new test pins exactly one already-claimed wrapper behavior: a nonzero
  apply-revalidation child is retryable when output proves it reached
  `apply-revalidation: apply /apply` and then aborted with
  `TimeoutError: The operation was aborted due to timeout`; a bare timeout
  without that apply-step marker is not retryable.
- Reliable's retained verification for `b8f2b23a` matches that limited scope:
  `node --check` on the two verifier files and the touched test file,
  `git diff --check`, and the focused
  `node --test --test-name-pattern='production-shaped live release verify retries transient apply revalidation timeouts after the apply step starts'`
  run. That is a regression pin, not a new boundary proof.
- The only broader support evidence remains the earlier `a1ca1eff` bounded
  combined wrapper run. Reliable's retained logs still show the pre-patch
  direct bounded wrapper failed after about `149s` once the child reached
  `apply-revalidation: apply /apply` and aborted with that timeout, while the
  patched bounded `timeout 210s ... production-shaped-live-release-verify.mjs`
  run exited `0` and emitted `PACKAGED_RELEASE_BOUNDARY_OK`,
  `replayAndRetry.retryAttempts: 2`, `authSessionType:
  "production-auth-session"`, durable-journal ownership,
  `restartReadable: true`, `staleClaimRejected: true`, and the expected
  apply-revalidation `PRECONDITION_FAILED` recovery block.
- That means `b8f2b23a` closes no new supervised release gate beyond
  hardening the packaged combined wrapper's retry rule. It does not add a
  production-owned source-boundary primitive, does not move proof onto the
  real Reprint endpoint, and does not turn the packaged verifier evidence into
  one rerunnable non-lab-backed checked release boundary.
- So the verdict stays `0/4`: `b8f2b23a` is a narrow regression test for the
  already-classified `a1ca1eff` wrapper retry behavior, not a new production
  boundary crossing.

Next exact reliable-owned primitive:

- One production-owned, non-lab-backed checked release command on the real
  Reprint endpoint where the same executable command string and same live
  `REPRINT_PUSH_SOURCE_URL` visibly mint and then read back a live auth session
  on that real source URL, persist it in durable restart-readable journal
  storage with lease-fenced ownership, preserve the rejected remote evidence
  for audit, and perform apply-time revalidation before the first mutation on
  that same boundary.

Next focused regression test after that primitive exists:

- A focused non-lab-backed checked-release test that proves the real-endpoint
  command can restart from durable journal state after an injected
  post-dry-run / pre-first-mutation interruption, reread the same live auth
  session and lease-fenced journal ownership, revalidate `/apply` before any
  mutation, reject the stale preserved remote with retained audit evidence, and
  classify recovery as replayed or blocked without fresh mutation work.
