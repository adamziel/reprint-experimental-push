# RPP-0831 object cache enabled topology v2 evidence

Date: 2026-06-01
Lane: RPP-0831 object cache enabled topology, variant 2
Checklist item: RPP-0831 - Object cache enabled topology, variant 2.

## Scope

This slice records deterministic local support-only evidence for the
object-cache-enabled topology requirement. It does not edit progress surfaces,
release gates, Docker harness code, or shared helpers.

Success for this variant is fail-closed: the topology command must either start
the disposable WordPress sites or record the exact unavailable capability that
prevented startup. In this sandbox, Docker CLI is unavailable, so no site,
object-cache backend, object-cache runtime readback, or release-verifier
object-cache path is claimed as started.

## Object Cache Requirements

Variant 2 records these required capabilities before object-cache topology
evidence can be accepted as a started-site proof:

- `object-cache-backend-private-network`: a Redis-compatible object-cache
  backend reachable only on the private Docker network, with `0` published host
  ports.
- `wordpress-object-cache-runtime-every-site`: object-cache runtime, drop-in, or
  equivalent runtime support enabled for every WordPress role before seed and
  release verification.
- `object-cache-state-does-not-hide-snapshot-drift`: cache flush or bypass
  boundaries before snapshot and release-verifier reads so stale cache state
  cannot mask remote drift.
- `verify-release-runs-through-object-cache-enabled-sites`: the topology runner
  remains on `npm run verify:release` with no packaged fallback.
- `object-cache-topology-evidence-hash-count-surface-only`: evidence stores only
  requirement hashes, counts, surface names, and service-role surfaces.

The only HTTP ingress remains the sandbox-provided local inspection port
`127.0.0.1:8080`. Remote tunnel commands remain prohibited, and the cache
backend must not expose a host port.

## Deterministic Support Evidence

`test/rpp-0831-object-cache-enabled-topology-v2.test.js` builds an RPP-0831
proof from the existing Docker local-production topology artifact helpers. The
proof is support-only and not release-eligible:

- status: `blocked-exact-unavailable-capability`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`
- expected site roles: `source`, `remote-changed`, `local-edited`,
  `apply-revalidation-source`
- object-cache requirement count: `5`
- site surface count: `4`
- evidence surface count: `9`
- rejected surface count: `0`
- raw payload count: `0`
- sensitive surface count: `0`
- hashed surface count: `4`

The focused test also proves that a non-started topology report without an
exact unavailable capability code is rejected with:

```text
OBJECT_CACHE_TOPOLOGY_V2_UNAVAILABLE_CAPABILITY_NOT_EXACT
```

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result from the final validation run:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- artifact:
  `/tmp/reprint-docker-local-production-evidence-GNyF4U/release-gate-input.json`
- deterministic artifact hash:
  `11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2`
- topology command: `npm run verify:release:docker-local-production`
- release-verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- packaged fallback observed: `false`
- release URLs use Docker DNS: `true`
- local-only topology validation: `true`

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
    "release-verifier-object-cache-path",
    "object-cache-topology-v2-startup-proof"
  ]
}
```

Because Docker CLI is missing, this evidence is accepted only as exact
unavailable-capability support evidence. It does not claim started sites or
per-site object-cache runtime readback.

## Validation

Required validation commands and observed results before commit:

```sh
node --check test/rpp-0831-object-cache-enabled-topology-v2.test.js
node --test test/rpp-0831-object-cache-enabled-topology-v2.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0831-object-cache-enabled-topology-v2.md
git diff --check
```

Observed local results:

- syntax check: exit `0`
- focused RPP-0831 test: exit `0`, `3` tests passed
- topology command: exit `2`, fail-closed exact unavailable capability
  `DOCKER_CLI_MISSING`
- redaction scan: exit `0`, no rejected files
- diff whitespace check: exit `0`

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by recording the exact
unavailable Docker capability from the topology command. A Docker-capable
environment still needs to start the object-cache-enabled topology and collect
per-site object-cache runtime readback before this can become production-backed
release evidence.
