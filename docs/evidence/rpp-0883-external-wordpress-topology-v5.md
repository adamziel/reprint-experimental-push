# RPP-0883 external WordPress topology v5 evidence

Date: 2026-06-01
Lane: RPP-0883 external WordPress topology, variant 5
Checklist item: RPP-0883 - Carry through the release verifier for external
WordPress topology, variant 5. Success: source/local/changed URLs are captured
and identity-checked.

## Scope

This slice adds deterministic local support evidence for the variant-5
external WordPress topology proof. It follows the RPP-0863 variant-4 pattern,
the RPP-0843 and RPP-0823 source/local/changed identity patterns, and the
RPP-0803 topology validator while adding a release-verifier carry-through
projection.

The proof remains support-only. It does not contact external WordPress hosts,
start services, open tunnels, collect live route receipts, establish production
auth, mutate a site, publish progress, or move release gates. Final release
status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0883-external-wordpress-topology-v5.test.js` feeds deterministic
topology fixtures into the existing local validator, then emits a variant-5
wrapper proof that stores only:

- role labels;
- captured source/local/changed identity role names;
- role identity hashes and origin hashes;
- route source identity hashes;
- booleans for identity and policy checks;
- counts for role, route, surface, and release-gate coverage;
- named identity-check surfaces;
- release-gate ids and statuses without gate evidence bodies;
- failure codes mapped to surfaces; and
- digest values for role, route, policy, surface, gate-summary, carry-through,
  and whole-scope records.

The variant-5 proof intentionally omits raw URL values, host names, credential
material, query strings, userinfo, tunnel host values, rejected raw inputs,
payload bodies, cookies, route bodies, and raw release-gate evidence.

## Checked Surfaces

The focused test covers these surfaces:

- required source, local edited, and remote changed roles are present;
- all required role values are syntactically valid;
- source, local edited, and remote changed identity hashes are captured;
- source, local edited, and remote changed identities are distinct;
- the optional source alias identity matches source identity;
- preflight, dry-run, apply, journal, and recovery route source identities bind
  back to the source identity;
- the release verifier carries the topology gate ids as local-candidate
  statuses;
- the release verifier carries the route gate ids as local-candidate statuses;
- tunnel-shaped hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- duplicate source/local/changed identities are rejected;
- loopback ingress is limited to the sandbox `8080` port;
- packaged fallback flags are rejected; and
- emitted evidence stays hash/count/surface-only.

## Release Verifier Carry-Through

The variant-5 wrapper evaluates the local release-gate contract and stores only
a sanitized projection: gate ids, status counts, topology gate statuses, route
gate statuses, missing final-release gate ids, and hashes. The accepted fixture
records 15 local-candidate gates out of 20 release gates and keeps the release
state held because final-release evidence is absent.

The carried topology gates are `source-url`, `local-url`,
`remote-changed-url`, `packaged-fallback`, `remote-alias`, and
`same-source-identity`. The carried route gates are
`preflight-route-identity`, `dry-run-route-eligibility`,
`apply-route-pre-mutation`, `journal-route-read-only`, and
`recovery-inspect-read-only`.

The final-release blockers remain: auth source readback, Application Password
binding, manage_options capability, progress timestamp, and agents release-gate
row evidence.

## Redaction Posture

Accepted and rejected inputs are both represented by identity hashes, counts,
surface names, gate ids, statuses, and failure codes. The proof does not retain
raw URL strings or host names even on the accepted path. The negative test
exercises tunnel, secret-shaped, non-`8080` loopback, duplicate identity, route
drift, and packaged fallback inputs, then asserts those raw fixture values are
absent from the proof.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0883-external-wordpress-topology-v5.test.js
node --test --test-name-pattern RPP-0883 test/rpp-0883-external-wordpress-topology-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0883-external-wordpress-topology-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0883-external-wordpress-topology-v5.test.js`: exit 0
- RPP-0883 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0883 release-verifier
carry-through of the external WordPress topology URL identity contract.
Production-backed WordPress reachability, live credentials, final-release
scope, route receipts, durable journal behavior, and live mutation receipts
remain required for promotion.
