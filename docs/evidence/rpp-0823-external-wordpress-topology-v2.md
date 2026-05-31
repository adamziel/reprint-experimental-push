# RPP-0823 external WordPress topology v2 evidence

Date: 2026-06-01
Lane: RPP-0823 external WordPress topology, variant 2
Checklist item: RPP-0823 - Prove external WordPress topology, variant 2.

## Scope

This slice adds deterministic local support evidence for the variant-2
external WordPress topology proof. It reuses the RPP-0803 topology validator
and follows the source/local/changed URL identity pattern used by the adjacent
RPP-0808 and RPP-0813 support proofs.

The proof remains support-only. It does not contact external WordPress hosts,
start services, use a remote tunnel, collect live route receipts, establish
production credentials, mutate a site, publish progress, or move release
gates. Final release status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0823-external-wordpress-topology-v2.test.js` builds a local
variant-2 wrapper around the existing topology proof. The wrapper records the
source, local edited, and remote changed role URLs only after the topology
identity gates pass. If a topology fails validation, the variant-2 surface
keeps only role labels, hashes, counts, failure codes, and identity-check
surface names.

The topology layer checks:

- required source, local edited, and remote changed role URLs;
- the three role URL identities are distinct;
- optional source alias identity matches the source URL identity;
- per-route source identities match the source URL identity;
- known remote tunnel hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- loopback URLs are limited to the sandbox `8080` ingress; and
- packaged fallback flags are disabled.

## Variant 2 Checks

The focused test asserts:

- source, local edited, and remote changed URLs are captured on the accepted
  path;
- role identity hashes and origin hashes are present for all three roles;
- route source identities are checked for preflight, dry-run, apply, journal,
  and recovery;
- the variant-2 proof scope records role count, route count, identity-check
  surface count, role digest, route digest, and scope hash;
- tunnel-shaped, credential-shaped, and duplicate role identity inputs fail
  closed before the scope is accepted;
- blocked evidence withholds rejected role URL strings while retaining hashes,
  counts, failure codes, and surfaces; and
- the proof is deterministic and hash/count/surface-only beyond accepted role
  URLs.

## Redaction Posture

The public proof stores normalized accepted role URLs, role identity hashes,
origin hashes, route identity hashes, identity-check surface names, counts,
failure codes, booleans, and scope digests. It does not store credential
values, application password material, cookies, bearer values, query strings,
URL userinfo, fragments, route bodies, WordPress payloads, or production
service configuration.

The negative test feeds tunnel and secret-shaped topology inputs into the same
builder and asserts the proof fails closed without retaining raw rejected URL
strings or fixture credential values.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0823-external-wordpress-topology-v2.test.js
node --test --test-name-pattern RPP-0823 test/rpp-0823-external-wordpress-topology-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0823-external-wordpress-topology-v2.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0823-external-wordpress-topology-v2.test.js`: exit 0
- RPP-0823 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0823 URL identity and
external topology variant-2 scope contract. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required for promotion.
