# RPP-0853 maintenance mode interaction v3 evidence

Date: 2026-06-01
Lane: RPP-0853 maintenance mode interaction, variant 3
Checklist item: RPP-0853 - Add generated coverage for maintenance mode interaction, variant 3.

## Scope

This slice adds deterministic local support evidence for the variant-3
maintenance-mode interaction boundary. It follows the RPP-0813 and RPP-0833 URL
identity pattern by reusing the RPP-0803 source/local/changed topology
validator, then binding maintenance-mode role states to accepted URL identity
hashes.

The proof remains support-only. It does not contact external WordPress hosts,
start services, use a remote tunnel, collect live route receipts, establish
production credentials, mutate a site, publish progress, or move release
gates. Final release status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0853-maintenance-mode-interaction-v3.test.js` builds a local
variant-3 wrapper around the existing topology proof. The wrapper captures the
source, local, and changed role URLs only on the accepted path, after the
topology identity gates pass. Rejected paths retain only role labels, identity
hashes, counts, failure codes, and identity-check surface names.

The topology layer checks:

- required source, local, and changed role URLs;
- the three role URL identities are distinct;
- optional source alias identity matches the source URL identity;
- per-route source identities match the source URL identity;
- known remote tunnel hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- loopback URLs are limited to the sandbox `8080` ingress; and
- packaged fallback flags are disabled.

The maintenance-mode layer records:

- the core maintenance file surface;
- the maintenance plugin option surface;
- the route health status surface;
- source, local, and changed maintenance role states;
- role URL identity digests;
- role-state binding digests;
- surface count, role count, route count, rejected-surface count, and scope
  hash.

## Variant 3 Checks

The focused test asserts:

- source, local, and changed URLs are captured on the accepted path;
- all three role URLs have identity hashes and origin hashes;
- route source identities are checked for preflight, dry-run, apply, journal,
  and recovery;
- maintenance states are bound to three distinct URL identities;
- changed maintenance state cannot bypass the changed URL identity;
- tunnel-shaped, credential-shaped, and duplicate role identity inputs fail
  closed before the maintenance scope is accepted;
- rejected evidence withholds rejected role URL strings while retaining hashes,
  counts, failure codes, and surfaces; and
- the maintenance evidence is deterministic and hash/count/surface-only.

## Redaction Posture

The public proof stores accepted normalized topology URLs, role identity
hashes, origin hashes, maintenance surface names, resource key hashes, role
state labels, role-state hashes, identity-check surface names, counts, failure
codes, booleans, and scope digests. It does not store credential values,
application password material, cookies, bearer values, query strings, URL
userinfo, fragments, route bodies, maintenance file contents, option row
payloads, WordPress payloads, or production service configuration.

The negative test feeds tunnel and secret-shaped topology inputs into the same
builder and asserts the proof fails closed without retaining raw rejected URL
strings or fixture credential values.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0853-maintenance-mode-interaction-v3.test.js
node --test --test-name-pattern RPP-0853 test/rpp-0853-maintenance-mode-interaction-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0853-maintenance-mode-interaction-v3.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0853-maintenance-mode-interaction-v3.test.js`: exit 0
- RPP-0853 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0853 URL identity and
maintenance-mode interaction variant-3 scope contract. Production-backed
WordPress reachability, credentials, route receipts, durable journal behavior,
and live mutation receipts remain required for promotion.
