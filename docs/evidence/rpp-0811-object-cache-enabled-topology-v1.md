# RPP-0811 object cache enabled topology v1 evidence

Date: 2026-06-01
Lane: RPP-0811 object cache enabled topology, variant 1
Checklist item: RPP-0811 - Object cache enabled topology.

## Scope

This slice records the object-cache-enabled topology requirements on top of the
existing Docker local-production topology command. It does not edit the
checklist, progress page, Docker harness, or release gates.

Success for this variant is deliberately fail-closed: the topology command must
either start the disposable WordPress sites or record the exact unavailable
capability that prevented startup. In this sandbox, it recorded the exact
Docker capability blocker before any site or cache service could start.

## Object Cache Requirements

Variant 1 requires these capabilities before object-cache topology evidence can
be accepted as a started-site proof:

- `object-cache-backend-private-network`: a Redis-compatible object cache
  backend reachable only on the private Docker network.
- `wordpress-object-cache-runtime-every-site`: object-cache runtime, drop-in,
  or equivalent runtime support enabled for every WordPress role before seed,
  planner proof, and release verification.
- `object-cache-state-does-not-hide-snapshot-drift`: cache flush or bypass
  boundaries before snapshot and release-verifier reads so stale cache state
  cannot mask remote drift.
- `verify-release-runs-through-object-cache-enabled-sites`: the runner remains
  on `npm run verify:release` with no packaged fallback and executes against the
  object-cache-enabled site set.

The cache backend may not publish a host port. The only allowed HTTP ingress
remains the sandbox-provided local inspection port `127.0.0.1:8080` from the
existing Docker topology, and remote tunnels remain prohibited.

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- artifact: `/tmp/reprint-docker-local-production-evidence-BIfMsx/release-gate-input.json`
- topology command: `npm run verify:release:docker-local-production`
- release-verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`

Exact unavailable capability recorded by the command:

```json
{
  "code": "DOCKER_CLI_MISSING",
  "capability": "docker-cli",
  "command": "docker --version",
  "missingExecutable": true,
  "requiredFor": [
    "object-cache-enabled-wordpress-sites-start",
    "object-cache-runtime-readback",
    "release-verifier-object-cache-path"
  ]
}
```

Because Docker CLI was missing, no WordPress site startup, cache backend
startup, object-cache runtime readback, or release-verifier cache-path proof is
claimed here. The evidence is accepted only as exact unavailable-capability
support evidence.

## Focused Test

`test/rpp-0811-object-cache-enabled-topology-v1.test.js` builds a deterministic
RPP-0811 proof from the existing Docker topology artifact helpers. It verifies:

- the object-cache topology requirements are recorded;
- the command outcome satisfies `sites-started-or-exact-unavailable-capability-recorded`;
- the exact unavailable capability is `DOCKER_CLI_MISSING` for `docker-cli`;
- object-cache runtime readback is not claimed when Docker is missing;
- release movement remains blocked and fail-closed;
- only the local `8080` HTTP ingress is permitted;
- cache backend published host ports remain `0`;
- packaged fallback is not observed; and
- ambiguous non-started topology evidence without a capability code is rejected.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0811-object-cache-enabled-topology-v1.test.js
node --test --test-name-pattern RPP-0811 test/rpp-0811-object-cache-enabled-topology-v1.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0811-object-cache-enabled-topology-v1.md
git diff --check
```

Observed local results before commit:

- syntax check: exit `0`
- focused RPP-0811 test: exit `0`
- topology command: exit `2`, exact unavailable capability `DOCKER_CLI_MISSING`
- redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by recording the exact
unavailable capability from the topology command. A Docker-capable environment
still needs to start the object-cache-enabled topology and collect per-site
object-cache runtime readback before this can become production-backed release
evidence.
