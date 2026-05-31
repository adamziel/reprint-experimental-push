# RPP-0821 three-site local production topology v2 evidence

Date: 2026-06-01
Lane: RPP-0821 three-site local production topology, variant 2
Checklist item: RPP-0821 - Prove three-site local production topology.

## Scope

This slice records deterministic local support evidence for the three primary
WordPress site topology. It does not edit progress surfaces, the checklist,
Docker harness code, release gate code, or production runtime code.

Success for this variant follows the RPP-0801 and RPP-0811 unavailable-capability
pattern: the topology command must either start the sites or record the exact
unavailable capability that prevented startup. In this sandbox, it recorded the
exact Docker blocker before any disposable WordPress site could start.

The evidence is hash/count/surface-only. It records commands, role names,
service names, ingress counts, status markers, and stable hashes. It does not
include production payload values, credential values, cookies, or tunnel output.

## Three-Site Contract

Primary production-shaped sites for this variant:

- `source` via service host `wp-source`
- `remote-changed` via service host `wp-remote-changed`
- `local-edited` via service host `wp-local-edited`

The Docker harness also contains `apply-revalidation-source` via service host
`wp-apply-revalidation-source`. RPP-0821 records that role as support surface
for apply revalidation and does not count it as one of the three primary sites.

Required primary capabilities:

- `wordpress-source-site-started`
- `wordpress-remote-changed-site-started`
- `wordpress-local-edited-site-started`

Release-verifier contract:

- topology command: `npm run verify:release:docker-local-production`
- verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- packaged fallback observed: `false`
- primary site count: `3`
- support site count: `1`
- only published HTTP ingress: `127.0.0.1:8080`
- tunnel command count: `0`

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- artifact: `/tmp/reprint-docker-local-production-evidence-wHjNFD/release-gate-input.json`
- artifact canonicalSha256: `11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- primary sites started: `0`
- support sites started: `0`

Exact unavailable capability recorded by the command:

```json
{
  "code": "DOCKER_CLI_MISSING",
  "capability": "docker-cli",
  "command": "docker --version",
  "missingExecutable": true,
  "requiredFor": [
    "three-primary-wordpress-sites-start",
    "release-verifier-three-site-readback",
    "local-production-topology-v2-startup-proof"
  ]
}
```

Because the Docker CLI is missing, this evidence does not claim site startup,
runtime readback, mutation behavior, or production-backed release readiness.
It is accepted only as exact unavailable-capability support evidence.

## Focused Test

`test/rpp-0821-three-site-local-production-topology-v2.test.js` builds a
deterministic RPP-0821 proof from the existing Docker topology artifact helpers.
It verifies:

- the topology command satisfies `sites-started-or-exact-unavailable-capability-recorded`;
- the exact unavailable capability is `DOCKER_CLI_MISSING` for `docker-cli`;
- the three primary site roles are `source`, `remote-changed`, and `local-edited`;
- `apply-revalidation-source` remains support surface and is not counted as primary;
- primary startup count remains `0` when Docker is unavailable;
- only the local `8080` HTTP ingress is permitted;
- tunnel command count remains `0`;
- packaged fallback is not observed;
- evidence mode remains `hash-count-surface-only`; and
- ambiguous non-started topology evidence without a capability code is rejected.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0821-three-site-local-production-topology-v2.test.js
node --test test/rpp-0821-three-site-local-production-topology-v2.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0821-three-site-local-production-topology-v2.md
git diff --check
```

Observed local results before commit:

- syntax check: exit `0`
- focused RPP-0821 test: exit `0`, 3 tests passed
- topology command: exit `2`, exact unavailable capability `DOCKER_CLI_MISSING`
- redaction scan: exit `0`, `ok: true`, 0 rejected files
- diff whitespace check: clean

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by recording the exact
unavailable capability from the topology command. A Docker-capable environment
still needs to start the three primary sites and collect topology readback
before this can become production-backed release evidence.
