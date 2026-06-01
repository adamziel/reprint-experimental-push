# RPP-0863 external WordPress topology v4 evidence

Date: 2026-06-01
Lane: RPP-0863 external WordPress topology, variant 4
Checklist item: RPP-0863 - Add focused regression coverage for external
WordPress topology, variant 4. Success: source/local/changed URLs are captured
and identity-checked.

## Scope

This slice adds deterministic local support evidence for the variant-4
external WordPress topology proof. It follows the RPP-0843 redacted wrapper
pattern, the RPP-0823 source/local/changed identity pattern, and the RPP-0803
topology validator while keeping the emitted proof surface local-only.

The proof remains support-only. It does not contact external WordPress hosts,
start services, open tunnels, collect live route receipts, establish production
auth, mutate a site, publish progress, or move release gates. Final release
status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0863-external-wordpress-topology-v4.test.js` feeds deterministic
topology fixtures into the existing local validator, then emits a variant-4
wrapper proof that stores only:

- role labels;
- captured source/local/changed identity role names;
- role identity hashes and origin hashes;
- route source identity hashes;
- booleans for identity and policy checks;
- counts for role, route, and surface coverage;
- named identity-check surfaces;
- failure codes mapped to those surfaces; and
- digest values for the role, route, policy, surface, and whole-scope records.

The variant-4 proof intentionally omits raw URL values, host names, credential
material, query strings, userinfo, tunnel host values, rejected raw inputs,
payload bodies, cookies, and route bodies.

## Checked Surfaces

The focused test covers these surfaces:

- required source, local edited, and remote changed roles are present;
- all required role values are syntactically valid;
- source, local edited, and remote changed identity hashes are captured;
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

Variant 4 adds a dedicated `source-local-changed-url-identities-captured`
surface before the distinct-identity and route-binding checks. That keeps the
success criterion explicit without storing source, local, or changed URL
payloads.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0863-external-wordpress-topology-v4.test.js
node --test --test-name-pattern RPP-0863 test/rpp-0863-external-wordpress-topology-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0863-external-wordpress-topology-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0863-external-wordpress-topology-v4.test.js`: exit 0
- RPP-0863 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0863 URL identity and
external topology variant-4 scope contract. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required for promotion.
