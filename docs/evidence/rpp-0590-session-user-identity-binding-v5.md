# RPP-0590 session user identity binding, variant 5

Date: 2026-05-31

Status: local/generated support evidence only. Final release remains **NO-GO**
until checked production-owned release evidence exists.

## Claim

`verify:release` carries exactly one `authSessionUserIdentity` summary with one
`routeEvidence` summary for session-user identity binding. The variant 5 proof
binds that route evidence to the dry-run receipt, authenticated scope hash, and
plan hash before any release movement decision.

## Proof Surface

The focused regression records deterministic support coverage for:

- source-level inclusion of exactly one session-user-identity release summary
  and exactly one route-evidence summary;
- a positive hash-only envelope where issued/readback session and user-identity
  hashes match the dry-run receipt session-user binding and push-session issue
  binding;
- pre-movement binding checks for the dry-run receipt hash, session hash,
  user-identity hash, scope hash, and plan hash; and
- negative envelopes for missing, malformed, stale, and drifted route evidence,
  plus drifted receipt, scope, and plan-hash bindings.

## Proven Behavior

- The generated support envelope records one release summary and one
  session-user identity route-evidence summary.
- The required route evidence remains exactly the issued/readback session
  hashes and issued/readback user-identity hashes.
- The positive envelope binds the same route-evidence hashes to the dry-run
  receipt session-user binding and push-session issue binding.
- Scope and plan-hash binding are checked before release movement.
- Missing hash evidence, malformed route hashes, stale evidence, route identity
  drift, dry-run receipt drift, scope drift, and plan-hash drift all remain
  blocked before movement.
- Release movement remains disallowed for every generated support envelope.
- The support evidence is hash-only and contains no raw credentials, usernames,
  source URLs, sessions, signing keys, idempotency keys, nonces, request bodies,
  bearer material, file paths, row values, journal payloads, or secrets.

## Validation

Recorded validation coverage:

- syntax check for the focused RPP-0590 regression;
- focused RPP-0590 test-name run;
- adjacent RPP-0570, RPP-0550, and RPP-0530 regression runs;
- base session-user-identity regression run;
- scoped artifact redaction scan for this evidence note;
- unstaged and staged whitespace checks.

Observed result: all listed validations exited 0. The focused RPP-0590 run
reported 4 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is support-only and NO-GO scoped. It does not use live endpoints,
production credentials, network-dependent evidence, remote tunnels, or
checklist/progress surfaces. Integration should treat it as generated executor
auth route evidence until a separate checked production-owned release proof
exists.
