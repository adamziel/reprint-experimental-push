# Critic Verdict

Current reliable head: `c2a70e1f3c7dd7f38faa8b27332e62ff0a65c874`
(`Reuse auth session source in release proofs`).

Previous classified reliable head: `5fcb36c623ddb6eb0e49275cc1890157ed948d91`
(`Bound driver verifier guards in release checks`).

Verdict: `0/4`

Reason:

- I repolled `origin/lane/reliable-executor` and confirmed it points at
  `c2a70e1f3c7dd7f38faa8b27332e62ff0a65c874`.
- The `5fcb36c6..c2a70e1f` diff changes only
  `scripts/playground/production-shaped-apply-revalidation-smoke.mjs`,
  `scripts/playground/production-shaped-live-release-verify.mjs`, and
  `scripts/playground/production-shaped-release-verify.mjs`.
- In `production-shaped-live-release-verify.mjs`, the checked live wrapper now
  forwards `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` into the inline
  apply-revalidation leg and reports `authSessionSource` in the combined proof.
  For the packaged path it now uses the packaged production plugin source
  command, so the apply-revalidation child consumes the same auth-session
  source-command boundary instead of bypassing it with direct credentials.
- In `production-shaped-apply-revalidation-smoke.mjs`, the smoke now resolves
  live source URL and credentials through the shared auth-session-source
  helpers, includes `authSessionSource` in its JSON proof, and fails closed
  with `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` when the required source
  command is invalid.
- In `production-shaped-release-verify.mjs`, the packaged plugin-driver helper
  now runs with `REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only`,
  `REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-verifier-guards`, and a `130_000`
  ms child timeout instead of the stale 45s budget.
- That is real checked-path hardening, but it still does not close a
  supervised release gate under [audits/release-gate.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic-clean-20260526-1530/audits/release-gate.md)
  or [audits/critic-release-gate.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic-clean-20260526-1530/audits/critic-release-gate.md).
  The patch reuses and surfaces an auth-session source command inside the
  Playground/package-mode proof harness; it does not create the missing single
  production-owned, non-lab-backed executable boundary on the real Reprint
  endpoint.
- The reliable lane's retained evidence says the same thing. In
  [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/reliable-executor-clean-20260526-1530/.lane-output/final.md),
  the worker records that the invalid-source check now fails closed, the
  bounded `driver-guard-only` / `driver-verifier-guards` smoke completes, and
  the combined live wrapper still timed out before full completion. The
  worker's own summary calls this "checked-path hardening" and asks critic and
  auditor to classify `c2a70e1f3` as the current head, not as a gate move.
- The still-open blocker is not auth-session-source reuse by itself. The branch
  still does not show one rerunnable real-site command where the same
  executable string mints a live auth session on the exact live
  `REPRINT_PUSH_SOURCE_URL`, reads that session back from durable
  restart-readable journal storage under lease-fenced ownership, preserves the
  rejected remote for audit, and performs apply-time revalidation before the
  first mutation on that same boundary.
- The timeout evidence also remains support-only. The reliable worker's own
  bounded combined run still timed out before completion, and the supervisor's
  direct repro only shows that the env scenario expands to the expected nine
  driver cases while the outer bounded run still ran past
  `driver-receipt-guards` and into `driver-missing-export-guard`. That is worth
  inspecting, but it is not proof that the live checked boundary now completes
  or that any production release gate has closed.
- So the verdict remains `0/4`: `c2a70e1f` improves proof-path consistency and
  removes an obsolete helper budget mismatch, but it still stops short of the
  required live executor/auth/session/durable-journal/preserved-remote
  boundary on the real Reprint endpoint.

Next exact reliable-owned primitive:

- One production-owned, non-lab-backed checked release command on the real
  Reprint endpoint where the exact executable command string and exact live
  `REPRINT_PUSH_SOURCE_URL` are visible, the command mints and then reads back
  a live auth session from durable restart-readable journal storage with
  lease-fenced ownership, preserves the rejected remote evidence for audit, and
  performs apply-time revalidation before the first mutation on that same live
  boundary.
- Separately, if reliable wants to keep reducing support noise, it still needs
  one completed bounded combined proof showing the packaged
  `driver-verifier-guards` helper no longer burns the outer timeout while
  traversing `driver-receipt-guards` into `driver-missing-export-guard`. That
  remains verifier support evidence until the real production-owned boundary
  above exists.
