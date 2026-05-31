# RPP-0586 production recovery inspect route release verifier, variant 5

Date: 2026-06-01

Status: release-verifier live-endpoint support evidence only. Final release
remains **NO-GO** until equivalent recovery-inspect proof is checked against
production-owned URL and credential inputs.

## Claim

The RPP-0566 live recovery-inspect route shape is carried through a
release-verifier-shaped envelope, and the positive proof exercises a real live
HTTP endpoint. The endpoint is loopback-only inside the sandbox, so it proves
the release-verifier carry-through shape but cannot move release posture.

## Proof Surface

`test/rpp-0586-production-recovery-inspect-route-release-verifier-v5.test.js`
adds three focused checks:

- source assertions keep the production recovery-inspect route registered as a
  signed authenticated `POST` route and keep combined live verifier output from
  duplicating the recovery-inspect summary in topology evidence;
- a loopback-only HTTP fixture handles the production-shaped recovery-inspect
  path, validates Basic auth plus signed push headers, requires the RPP-0566
  idempotency-bound live shape, and returns an `old-remote` recovery-inspect
  response; and
- missing or malformed recovery-inspect route evidence stays blocked before
  release movement.

No public listener, remote tunnel, production credential, checklist, progress
surface, or shared release-gate surface is changed.

## Proven Behavior

- The positive proof makes a real HTTP request to a live loopback endpoint.
- The verifier envelope carries exactly one `productionRecoveryInspectRoute`
  summary and one matching route-evidence block.
- Recovery inspect returns the RPP-0566 `old-remote` shape with two old targets,
  zero new targets, zero blocked-unknown targets, journal integrity `ok`, and
  stable rows/state across the read.
- The request is signed, session-bound, and idempotency-bound as hash-only
  evidence; route path, endpoint URL, source URL, credential, username, session
  id, nonce, idempotency key, plan, and receipt material are not exposed raw.
- Public verifier evidence is limited to hashes, counts, booleans, lengths, and
  status fields.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0586-production-recovery-inspect-route-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0586 test/rpp-0586-production-recovery-inspect-route-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0566 test/rpp-0566-production-recovery-inspect-route-v4.test.js
node --test --test-name-pattern RPP-0546 test/rpp-0546-production-recovery-inspect-route-v3.test.js
node --test test/release-gate-recovery-inspect-read-only-generated.test.js
node --test test/release-verifier-recovery-inspect-carry-through-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0586-production-recovery-inspect-route-release-verifier-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0586 test
reported 3 passes / 0 failures. The RPP-0566 live loopback recovery-inspect
test reported 2 passes / 0 failures, the RPP-0546 generated support test
reported 1 pass / 0 failures, the generated recovery-inspect release-gate test
reported 2 passes / 0 failures, and the release-verifier recovery-inspect
carry-through regression reported 2 passes / 0 failures. The live endpoint and
nested-checker tests require approved execution in this sandbox because
loopback socket binding and nested Node process spawning are blocked by
default. The scoped artifact redaction scan returned `"ok": true`, and both
whitespace checks returned no findings.

## Boundary

This is support-only release-verifier evidence. The loopback fixture satisfies
the live endpoint requirement for this slice, but it is not a production-owned
endpoint and it does not prove production credential reachability. Integration
should keep the release posture **NO-GO** until the same recovery-inspect
carry-through evidence is checked against production-owned endpoint and
credential inputs.
