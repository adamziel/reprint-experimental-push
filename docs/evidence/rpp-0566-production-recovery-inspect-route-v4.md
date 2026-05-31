# RPP-0566 production recovery inspect route, variant 4

Date: 2026-06-01

Status: sandbox-local live endpoint support evidence only. Final release remains
**NO-GO** until equivalent recovery-inspect proof is checked against
production-owned URL and credential inputs.

## Claim

The production recovery-inspect route must be covered by a real endpoint test
that runs against a live URL. The support proof may use a loopback-only
WordPress Playground fixture, but it must not claim production readiness and it
must fail closed when the required live endpoint is unavailable.

## Proof Surface

`test/rpp-0566-production-recovery-inspect-route-v4.test.js` adds two focused
checks:

- a loopback-only live WordPress Playground fixture exposes
  `POST /wp-json/reprint/v1/push/recovery/inspect`, mints a production-shaped
  auth session through preflight, records a dry-run receipt, and calls recovery
  inspect through the authenticated HTTP client; and
- an unavailable loopback live URL is summarized as
  `LIVE_RECOVERY_INSPECT_ENDPOINT_UNAVAILABLE` with release movement held.

The live fixture binds only to `127.0.0.1`, records `tunnel: none`, and uses no
public ingress, remote tunnel, dashboard service, production credential, or
package/progress/shared-surface edit.

## Proven Behavior

- The REST index exposes the production-shaped recovery-inspect route at
  `/reprint/v1/push/recovery/inspect`.
- The real endpoint test reaches
  `/wp-json/reprint/v1/push/recovery/inspect` through a live loopback HTTP URL.
- The request is authenticated, signed, session-bound, and tied to a
  production-auth-session minted by the same loopback source.
- Recovery inspect returns `old-remote` before mutation, with all plan targets
  classified and trusted journal integrity reporting `ok`.
- The target content surface is unchanged before and after the recovery-inspect
  call.
- The unavailable endpoint path keeps `releaseStatus: NO-GO`,
  `releaseMovement.allowed: false`, `mutationAttempted: false`, and a blocked
  production boundary.
- Support summaries store live URL, route, session, recovery count, and proof
  material as hashes, booleans, counts, or lengths only.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0566-production-recovery-inspect-route-v4.test.js
node --test --test-name-pattern RPP-0566 test/rpp-0566-production-recovery-inspect-route-v4.test.js
node --test --test-name-pattern RPP-0546 test/rpp-0546-production-recovery-inspect-route-v3.test.js
node --test test/release-gate-recovery-inspect-read-only-generated.test.js
node --test test/production-recovery-mutate-route.test.js
node --test --test-name-pattern RPP-0567 test/rpp-0567-production-recovery-mutate-route-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0566-production-recovery-inspect-route-v4.md
git diff --check
git diff --cached --check
```

Observed result: the focused RPP-0566 syntax check and live loopback endpoint
test exited 0. The focused test reported 2 passes / 0 failures. The RPP-0546
recovery-inspect route regression, recovery-inspect release-gate read-only
check, production recovery-mutate route test, and RPP-0567 recovery-mutate
variant-4 regression exited 0. The live test and adjacent generated
release-gate check require approved execution in this sandbox because loopback
socket binding and the nested node checker are blocked by default. The scoped
artifact redaction scan returned `"ok": true`, and whitespace checks returned
no findings.

## Boundary

This is support-only regression coverage for a real live URL inside the
sandbox. It does not prove production durability, external endpoint
reachability, production credential handling, or release readiness. Integration
should keep the release posture **NO-GO** until the same recovery-inspect
behavior is checked against production-owned endpoint and credential inputs.
