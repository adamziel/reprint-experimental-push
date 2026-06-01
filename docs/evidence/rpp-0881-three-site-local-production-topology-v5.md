# RPP-0881 three-site local production topology v5 evidence

Date: 2026-06-01
Lane: RPP-0881 three-site local production topology release-verifier carry-through, variant 5
Checklist item: RPP-0881 - Carry through the release verifier for three-site local production topology, variant 5.

## Scope

This slice adds local support evidence that the three-site local production
topology carries the release verifier command through the Docker topology
harness. It only adds the RPP-0881 test and this evidence file. It does not
edit progress surfaces, the checklist, Docker harness code, release gate code,
or production runtime code.

Success for this variant follows the RPP-0821, RPP-0841, and RPP-0861
exact-unavailable capability pattern: the topology command must either start
the sites or record the exact unavailable capability that prevented startup.
In this sandbox, it recorded the exact Docker blocker before any disposable
WordPress site could start.

The evidence is hash/count/surface-only. It records commands, role names,
service names, ingress counts, status markers, and stable hashes. It does not
include production payload values, credential values, cookies, or tunnel output.

## Three-Site Contract

Primary production-shaped sites for this variant:

- `source` via service host `wp-source`
- `remote-changed` via service host `wp-remote-changed`
- `local-edited` via service host `wp-local-edited`

The Docker harness also contains `apply-revalidation-source` via service host
`wp-apply-revalidation-source`. RPP-0881 records that role as support surface
for apply revalidation and does not count it as one of the three primary sites.

Required primary capabilities:

- `wordpress-source-site-started`
- `wordpress-remote-changed-site-started`
- `wordpress-local-edited-site-started`

Release-verifier carry-through contract:

- topology command: `npm run verify:release:docker-local-production`
- verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- verifier carried through by topology command: `true`
- verifier failure reason when Docker is missing: `DOCKER_CLI_MISSING`
- verifier failure exit code when Docker is missing: `2`
- packaged fallback observed: `false`
- packaged fallback allowed: `false`
- release URLs use Docker DNS service hosts: `true`
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
- artifact: `/tmp/reprint-docker-local-production-evidence-uYPPpT/release-gate-input.json`
- artifact canonicalSha256: `11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2`
- accepted for release gate: `false`
- fail closed: `true`
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
    "local-production-topology-v5-startup-proof"
  ]
}
```

Docker blocker details observed in this sandbox:

- prerequisite check count: `1`
- passed prerequisite checks: `0`
- checked command: `docker --version`
- command status: `null`
- command signal: `null`
- missing executable: `true`
- error code: `ENOENT`
- error message: `spawnSync docker ENOENT`

Because the Docker CLI is missing, this evidence does not claim site startup,
runtime readback, mutation behavior, or production-backed release readiness.
It is accepted only as exact unavailable-capability support evidence.

## Focused Test

`test/rpp-0881-three-site-local-production-topology-v5.test.js` builds a
deterministic RPP-0881 proof from the existing Docker topology artifact helpers.
It verifies:

- the topology command satisfies `sites-started-or-exact-unavailable-capability-recorded`;
- the exact unavailable capability is `DOCKER_CLI_MISSING` for `docker-cli`;
- Docker blocker surface details are recorded without claiming startup;
- the release verifier command is `npm run verify:release`;
- the topology command carries through the release verifier failure with exit `2`;
- `acceptedForReleaseGate` is `false`, `failClosed` is `true`, and release movement is blocked;
- the three primary site roles are `source`, `remote-changed`, and `local-edited`;
- `apply-revalidation-source` remains support surface and is not counted as primary;
- primary startup count remains `0` when Docker is unavailable;
- incomplete primary-site topology reports are rejected;
- non-started topology reports without an exact capability object are rejected;
- release-verifier carry-through gaps are rejected;
- support-only roles widened into the primary set are rejected;
- only the local `8080` HTTP ingress is permitted;
- tunnel command count remains `0`;
- packaged fallback is not observed or allowed;
- packaged fallback or release movement claims are rejected;
- evidence mode remains `hash-count-surface-only`; and
- final release status and integration recommendation remain `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0881-three-site-local-production-topology-v5.test.js
node --test --test-name-pattern RPP-0881 test/rpp-0881-three-site-local-production-topology-v5.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0881-three-site-local-production-topology-v5.md
git diff --check
```

Observed local results before commit:

- topology command: exit `2`, fail-closed exact unavailable capability `DOCKER_CLI_MISSING`
- topology command gate fields: `acceptedForReleaseGate: false`, `failClosed: true`
- syntax check: exit `0`
- focused RPP-0881 test: exit `0`, 6 tests passed
- redaction scan: exit `0`, `ok: true`, 0 rejected files
- diff whitespace check: clean

## Recommendation

Final release status: **NO-GO**.

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by recording the exact
unavailable capability from the topology command. A Docker-capable environment
still needs to start the three primary sites and collect topology readback
before this can become production-backed release evidence.
