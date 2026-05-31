# RPP-0570 session user identity binding, variant 4

Date: 2026-05-31

Status: local/generated support evidence only. Final release remains **NO-GO**
until checked production-owned release evidence exists.

## Claim

`verify:release` carries exactly one `authSessionUserIdentity` summary with one
`routeEvidence` summary for the same authenticated user identity bound to the
push session and dry-run receipt. The support proof stays hash-only and excludes
raw identity, route, session, request, storage, and secret material.

## Proof Surface

The focused regression adds generated support coverage for:

- source-level inclusion of exactly one session-user-identity release summary
  and exactly one route-evidence summary;
- a positive generated envelope where issued/readback session and
  user-identity hashes match the dry-run receipt binding; and
- negative generated envelopes where readback identity drift, dry-run receipt
  identity drift, or missing hash evidence blocks release movement.

## Proven Behavior

- The required route evidence remains exactly the issued/readback session hashes
  and issued/readback user-identity hashes.
- The generated positive envelope binds the same issued/readback hashes to the
  dry-run receipt session-user binding and push-session issue binding.
- The route-evidence summary count is one in the generated support envelope.
- Missing hash evidence reports incomplete route evidence and stays blocked.
- Identity drift across readback or dry-run receipt binding stays blocked even
  when a summary object is present.
- Release movement remains disallowed for every generated support envelope.
- The support evidence is hash-only and contains no raw credentials, usernames,
  source URLs, sessions, signing keys, idempotency keys, nonces, request bodies,
  tokens, file paths, row values, journal payloads, or secrets.

## Validation

Recorded validation coverage:

- syntax check for the focused RPP-0570 regression;
- focused RPP-0570 test-name run;
- adjacent RPP-0550 route-evidence regression run;
- adjacent RPP-0530 release-summary regression run;
- base session-user-identity regression run;
- scoped artifact redaction scan for this evidence note;
- unstaged and staged whitespace checks.

Observed result: all listed validations exited 0. The focused RPP-0570 run
reported 4 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is support-only and NO-GO scoped. It does not use live endpoints,
production credentials, network-dependent evidence, remote tunnels, or
checklist/progress surfaces. Integration should treat it as generated executor
auth route evidence until a separate checked production-owned release proof
exists.
