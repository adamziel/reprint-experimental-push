# RPP-0843 external WordPress topology v3 evidence

Date: 2026-06-01
Lane: RPP-0843 external WordPress topology, variant 3
Checklist item: RPP-0843 - Prove external WordPress topology, variant 3.

## Scope

This slice adds deterministic local support evidence for the variant-3
external WordPress topology proof. It follows the RPP-0823 wrapper pattern and
the RPP-0803 topology validator while tightening the emitted proof surface.

The proof remains support-only. It does not contact external WordPress hosts,
start services, open tunnels, collect live route receipts, establish production
auth, mutate a site, publish progress, or move release gates. Final release
status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0843-external-wordpress-topology-v3.test.js` feeds deterministic
topology fixtures into the existing local validator, then emits a variant-3
wrapper proof that stores only:

- role labels;
- role identity hashes and origin hashes;
- route source identity hashes;
- booleans for identity and policy checks;
- counts for role, route, and surface coverage;
- named identity-check surfaces;
- failure codes mapped to those surfaces; and
- digest values for the role, route, policy, surface, and whole-scope records.

The variant-3 proof intentionally omits raw URL values, host names, credential
material, query strings, userinfo, tunnel host values, rejected raw inputs,
payload bodies, cookies, and route bodies.

## Checked Surfaces

The focused test covers these surfaces:

- required source, local edited, and remote changed roles are present;
- all required role values are syntactically valid;
- source, local edited, and remote changed identities are distinct;
- the optional source alias identity matches source identity;
- preflight, dry-run, apply, journal, and recovery route source identities bind
  back to the source identity;
- tunnel-shaped hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- loopback ingress is limited to the sandbox `8080` port;
- packaged fallback flags are rejected; and
- emitted evidence stays hash/count/surface-only.

## Redaction Posture

Accepted and rejected inputs are both represented by identity hashes, counts,
surface names, and failure codes. The proof does not retain raw URL strings or
host names even on the accepted path. The negative test exercises tunnel,
secret-shaped, non-`8080` loopback, route drift, and packaged fallback inputs,
then asserts those raw fixture values are absent from the proof.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0843-external-wordpress-topology-v3.test.js
node --test --test-name-pattern RPP-0843 test/rpp-0843-external-wordpress-topology-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0843-external-wordpress-topology-v3.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0843-external-wordpress-topology-v3.test.js`: exit 0
- RPP-0843 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0843 URL identity and
external topology variant-3 scope contract. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required for promotion.
