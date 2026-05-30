# RPP-0522 production snapshot hashes route proof v2

Date: 2026-05-30

## Scope

RPP-0522 proves the existing production snapshot-hashes route behavior with a
focused source-level route test and a sandbox-local live endpoint smoke run.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/production-snapshot-hashes-route.test.js` | Local focused route proof | Source-level assertions pin `POST /wp-json/reprint/v1/push/snapshot-hashes`, authenticated permission, signed-request ordering before payload parsing, no mutation helpers in the snapshot-hashes helper bodies, and the live smoke script behavior. |
| `scripts/playground/production-snapshot-hashes-route-live-smoke.mjs` | Production-shaped live endpoint proof on sandbox-local loopback | Starts WordPress Playground on `127.0.0.1` with an ephemeral port, discovers `/reprint/v1/push/snapshot-hashes` in the REST index, checks malformed JSON auth/signature failures before payload parsing, checks unauthenticated, unsigned, and invalid-session failures with a payload that would fail route validation if parsed, then sends a signed production-shaped snapshot-hashes request through the authenticated client. |
| External production endpoint | Not live production-backed in this worker | No external production host or remote tunnel was used. |

## Behavior covered

- REST discovery proves the route exists at `/reprint/v1/push/snapshot-hashes`
  with `POST`.
- Unauthenticated requests return `401` with
  `reprint_push_lab_auth_required`.
- Authenticated but unsigned requests return `401` with
  `SIGNED_HEADER_REQUIRED`.
- Signed requests with an invalid push session return `401` with
  `SIGNED_SESSION_INVALID`.
- Six malformed JSON auth/signature cases fail before route JSON parsing:
  missing Basic auth, wrong Basic auth, missing signature headers, missing push
  session, content-hash mismatch, and auth-signature mismatch.
- Each negative case uses a payload that would fail snapshot-hashes route
  validation if parsed, but none returns `INVALID_ARGUMENT`, emits resources, or
  emits snapshot-hash receipt evidence.
- The malformed-body cases do not append protocol journal entries, and the
  signed snapshot-hashes request remains planning-only without appending
  protocol journal entries.
- The sandbox-local smoke compares the filtered route mutation surface before
  and after the negative cases and reports `negativeMutated: false`.
- A signed production-shaped request reaches
  `/wp-json/reprint/v1/push/snapshot-hashes` and returns `mode:
  snapshot-hashes`, `planningOnly.readOnly: true`, `planningOnly.mutates:
  false`, nine live comparison resources, and hash-length-only receipt/session
  evidence.

## Validation observed

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --check scripts/playground/production-snapshot-hashes-route-live-smoke.mjs
node --test test/production-snapshot-hashes-route.test.js
node scripts/playground/production-snapshot-hashes-route-live-smoke.mjs
node --test test/authenticated-http-push-client.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/rpp-0510-session-user-identity-binding.test.js test/rpp-0511-application-password-integration.test.js test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/route-proof-matrix.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0522-production-snapshot-hashes-route-v2.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: each command exited 0. PHP and Node syntax checks passed. The
focused route test reported 7 subtests ok. The adjacent auth/session/route
bundle reported 163 subtests ok. Checklist lint and the scoped artifact
redaction scan returned `ok: true`. The live smoke returned `ok: true`,
loopback-only exposure with `tunnel: none`, malformed JSON auth/signature
failures before payload parsing, no negative-case snapshot hash evidence,
protocol journal fingerprints unchanged, `negativeMutated: false`, a
`production-auth-session`, and 64- or 71-character hash evidence for the signed
snapshot-hashes request and receipt.

## Residual risks

- This is production-shaped, sandbox-local live endpoint proof rather than an
  externally reachable production host proof.
- Packaged-plugin and broader release-verifier carry-through remain separate
  checklist work.
