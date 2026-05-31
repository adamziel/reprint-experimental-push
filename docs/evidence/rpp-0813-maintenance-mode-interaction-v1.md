# RPP-0813 maintenance mode interaction v1 evidence

Date: 2026-06-01
Lane: RPP-0813 maintenance mode interaction, variant 1
Checklist item: RPP-0813 - Implement maintenance mode interaction, variant 1.

## Scope

This slice adds deterministic local support evidence for the maintenance-mode
interaction boundary while reusing the RPP-0803 external topology URL contract.
It records source, local edited, and remote changed role URLs as normalized
identities, proves those identities pass static checks, and only then accepts
the maintenance-mode interaction scope.

The proof remains support-only. It does not contact external WordPress hosts,
start local services, use a remote tunnel, collect route receipts, mutate a
site, or move release gates. Final release status and integration
recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0813-maintenance-mode-interaction-v1.test.js` builds a local proof
around the existing RPP-0803 topology validator. The topology layer checks:

- `REPRINT_PUSH_SOURCE_URL`
- `REPRINT_PUSH_LOCAL_URL`
- `REPRINT_PUSH_REMOTE_CHANGED_URL`
- optional source alias identity
- optional per-route source identity
- forbidden tunnel host rejection
- URL userinfo, query string, and fragment rejection
- sandbox loopback ingress limited to port `8080`
- packaged fallback flags disabled

The maintenance-mode layer records a support-only interaction scope with these
surfaces:

- core `.maintenance` file presence
- maintenance plugin option row identity
- route health status class during the maintenance window

The scope records only role labels, surface names, resource keys, booleans,
state hashes, and a scope hash. It does not store maintenance file contents,
option row payloads, route bodies, credentials, cookies, application password
material, query strings, URL userinfo, or production service configuration.

## Variant 1 Checks

The focused test asserts:

- source, local edited, and remote changed URLs are captured;
- the three URL role identities are distinct;
- source alias and per-route source identities match the source URL identity;
- known remote tunnel hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- credential-shaped URL parts and credential values are absent from the proof;
- maintenance-mode interaction scope is accepted only after topology identity
  checks pass;
- source, local edited, and remote changed maintenance states stay bound to
  their distinct URL identities;
- remote changed maintenance state cannot bypass the changed URL identity; and
- maintenance evidence is hash/surface/boolean-only.

## Redaction Posture

The public proof stores normalized role URL identities, identity hashes,
maintenance surface names, resource keys, role-state labels, state hashes,
scope hash, and boolean gate state. It does not store raw maintenance payloads
or credential material.

The negative test feeds tunnel and secret-shaped topology URLs into the same
proof builder and asserts the proof fails closed before maintenance-mode scope
is accepted, without retaining the raw credential-shaped URL parts.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0813-maintenance-mode-interaction-v1.test.js
node --test --test-name-pattern RPP-0813 test/rpp-0813-maintenance-mode-interaction-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0813-maintenance-mode-interaction-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0813-maintenance-mode-interaction-v1.test.js`: exit 0
- RPP-0813 focused proof test: passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0813 URL identity and
maintenance-mode interaction scope contract. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required for promotion.
