# RPP-0873 maintenance mode interaction v4 evidence

Date: 2026-06-01
Lane: RPP-0873 maintenance mode interaction, variant 4
Checklist item: RPP-0873 - Add focused regression coverage for maintenance mode
interaction, variant 4. Success: source/local/changed URLs are captured and
identity-checked.

## Scope

This slice adds deterministic local support evidence for the variant-4
maintenance-mode interaction boundary. It follows the RPP-0853 maintenance-mode
variant-3 pattern, the RPP-0833 and RPP-0813 maintenance-mode identity binding
patterns, and the RPP-0863 redacted variant-4 topology surface.

The proof remains support-only. It does not contact external WordPress hosts,
start services, use a remote tunnel, collect live route receipts, establish
production credentials, mutate a site, publish progress, or move release
gates. Final release status and integration recommendation remain **NO-GO**.

## Proof Surface

`test/rpp-0873-maintenance-mode-interaction-v4.test.js` builds a local
variant-4 wrapper around the existing source/local/changed topology validator.
The wrapper proves URL capture and identity checks using only:

- role labels;
- source, local, and changed identity role names;
- role identity hashes and origin hashes;
- route source identity hashes;
- maintenance surface names and resource key hashes;
- maintenance role-state labels and role-state hashes;
- booleans for identity, redaction, and local-only policy checks;
- counts for role, route, surface, and rejected-surface coverage;
- identity-check surface names and failure-surface mappings; and
- digest values for the role, route, surface, policy, state, and whole-scope
  records.

The proof omits raw URL strings, host names, credential material, query
strings, URL userinfo, fragments, tunnel host values, rejected raw inputs,
payload bodies, cookies, maintenance file contents, option row payloads, and
route bodies.

## Variant 4 Checks

The focused test asserts:

- source, local, and changed URL identities are captured and identity-checked;
- all three accepted role identities have identity hashes and origin hashes;
- source, local, and changed role identities are distinct;
- route source identities are checked for preflight, dry-run, apply, journal,
  and recovery;
- maintenance states are bound to three distinct URL identities;
- the changed maintenance state cannot bypass the changed URL identity;
- tunnel-shaped, credential-shaped, duplicate, and packaged fallback inputs
  fail closed before the maintenance scope is accepted;
- rejected evidence withholds rejected role URL strings while retaining hashes,
  counts, failure codes, and surface names; and
- the maintenance evidence is deterministic and hash/count/surface-only.

## Redaction Posture

Accepted and rejected inputs are represented by identity hashes, origin hashes,
surface names, counts, booleans, failure codes, and digests. The proof does not
retain raw accepted URL values, rejected raw input values, host names, production
service configuration, authentication material, or maintenance payloads.

Variant 4 adds an explicit `source-local-changed-url-identities-captured`
surface before the distinct-identity and route-binding checks, plus a
`maintenance-state-bindings-identity-bound` surface before accepting the
maintenance-mode interaction scope.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0873-maintenance-mode-interaction-v4.test.js
node --test --test-name-pattern RPP-0873 test/rpp-0873-maintenance-mode-interaction-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0873-maintenance-mode-interaction-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0873-maintenance-mode-interaction-v4.test.js`: exit 0
- RPP-0873 focused proof test: 3 subtests passed, 0 failed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0873 URL identity and
maintenance-mode interaction variant-4 scope contract. Production-backed
WordPress reachability, credentials, route receipts, durable journal behavior,
and live mutation receipts remain required for promotion.
