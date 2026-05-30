# RPP-0528 short-lived push session proof v2

Date: 2026-05-30

## Scope

RPP-0528 proves the existing production-shaped short-lived push session issue
path and the dry-run receipt binding that ties the receipt to the authenticated
session, identity, scope, and canonical plan hash.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/rpp-0528-short-lived-push-session-v2.test.js` | Focused source route proof | Pins the server-issued session TTL, non-autoloaded session store, dry-run receipt binding fields, receipt hash recomputation, and apply-time recomputation before mutation. |
| `scripts/playground/production-shaped-route-smoke.mjs` | Sandbox-local production-shaped route proof | Exercises preflight plus dry-run on `/wp-json/reprint/v1/push/*` and asserts the live dry-run receipt binding shape before apply/replay/conflict checks. |
| External production endpoint | Not exercised in this worker | The smoke is local-loopback Playground with production-shaped route names and reports `labBacked: true`. |

## Behavior covered

- Preflight rejects caller-supplied push sessions and mints an opaque
  short-lived token with a 300-second TTL.
- Session storage uses a hashed option key and `autoload = no`.
- Dry-run requires the server-issued session before protocol receipt binding.
- The receipt `authBinding` records the authenticated scope, WordPress identity,
  production auth session, push-session issue binding, and plan hash.
- The subject binding hashes scope, identity, auth session, push session, and the
  plan hash; the issue binding hashes session issue facts and carries its own
  issue hash.
- Apply recomputes the subject and issue bindings before the mutation path and
  rejects mismatches with `AUTH_RECEIPT_MISMATCH`.

## Local route smoke observation

The production-shaped route smoke returned:

- route profile: `production-shaped`, namespace `reprint/v1`, prefix `/push`.
- dry-run receipt route: `/push/dry-run`.
- binding scope: `reprint-push-lab:authenticated-http-push`.
- plan hash matched the canonical dry-run plan.
- identity: `reprint_push_admin` with `manage_options: true`.
- session: `production-auth-session`, `active`, same server-issued session as
  preflight, 64-character session hash.
- subject binding hash length: 64.
- issue binding: `short-lived-push-session`, TTL `300`, 64-character issue hash,
  same session hash, same identity hash, and same scope hash.

## Validation observed

```sh
node --check scripts/playground/production-shaped-route-smoke.mjs
node --check test/rpp-0528-short-lived-push-session-v2.test.js
node --test test/rpp-0528-short-lived-push-session-v2.test.js
node --test test/rpp-0528-short-lived-push-session-v2.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/rpp-0510-session-user-identity-binding.test.js test/rpp-0518-capability-downgrade-rejection.test.js
timeout 300s node scripts/playground/production-shaped-route-smoke.mjs
node scripts/release/checklist-completion-lint.mjs --root .
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0528-short-lived-push-session-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: each command exited 0. The focused Node test reported 4
subtests ok and the adjacent auth/session slice reported 15 subtests ok. The
local route smoke exercised the production-shaped preflight, dry-run, apply,
replay, conflict, journal, and recovery paths; the RPP-0528 dry-run receipt
binding summary reported `planHashMatches: true`, `sameSession: true`,
`sameSessionHash: true`, `sameIdentityHash: true`, and `sameScopeHash: true`,
with zero DB mutation rows before valid apply. Checklist lint and scoped
artifact redaction scan returned ok, and the exact credential raw scan found no
raw session, signature, Authorization, or Application Password material in the
touched docs.

## Residual risks

- This is sandbox-local production-shaped evidence rather than an external
  production host proof.
- The route still reports `labBacked: true`; packaged-plugin and non-lab
  production boundary proof remain separate release-gate work.
