# RPP-0871 object cache enabled topology v4 evidence

Date: 2026-06-01
Lane: RPP-0871 object cache enabled topology, variant 4
Checklist item: RPP-0871 - Add focused regression coverage for object cache enabled topology, variant 4.

## Scope

This slice adds focused regression support evidence for the
object-cache-enabled topology requirement. It only adds the focused RPP-0871
test and this evidence file. It does not edit progress surfaces, the checklist,
Docker harness code, release gate code, or production runtime code.

Success for this variant is fail-closed: the topology command must either start
the disposable WordPress sites or record the exact unavailable capability that
prevented startup. In this sandbox, Docker CLI is unavailable, so no site,
object-cache backend, object-cache runtime readback, cache content readback, or
release-verifier object-cache path is claimed as started.

The evidence remains hash/count/surface-only. It records role names, service
surfaces, command names, counts, policy booleans, status markers, and stable
hashes. It does not store production payload values, credential values,
cookies, tunnel output, or object-cache contents.

## Object Cache Requirements

Variant 4 carries forward the variant 1, variant 2, and variant 3 object-cache
topology contracts and adds a focused regression guard for the Docker-missing
fail-closed path:

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
- `object-cache-topology-v3-generated-replay-is-deterministic`: replayed
  generated support evidence preserves the exact blocker and NO-GO release
  state.
- `object-cache-topology-v4-focused-regression-fail-closed`: focused regression
  evidence preserves exit `2`, exact blocker `DOCKER_CLI_MISSING`,
  `acceptedForReleaseGate: false`, and fail-closed release movement when Docker
  is unavailable.

The only HTTP ingress remains the sandbox-provided local inspection port
`127.0.0.1:8080`. Remote tunnel commands remain prohibited, and the cache
backend must not expose a host port.

## Focused Regression Evidence

`test/rpp-0871-object-cache-enabled-topology-v4.test.js` builds an RPP-0871
proof from the existing Docker local-production topology artifact helpers. The
proof is support-only and not release-eligible:

- status: `blocked-exact-unavailable-capability`
- coverage mode: `focused-regression-local-support-only`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`
- expected site roles: `source`, `remote-changed`, `local-edited`,
  `apply-revalidation-source`
- object-cache requirement count: `7`
- site surface count: `4`
- evidence surface count: `11`
- generated replay count: `2`
- focused regression surface count: `4`
- rejected surface count: `0`
- raw payload count: `0`
- sensitive surface count: `0`
- hashed surface count: `6`

The focused test proves these fail-closed behaviors:

- a non-started topology report without an exact unavailable capability code is
  rejected with `OBJECT_CACHE_TOPOLOGY_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT`;
- missing Docker blocker readback is rejected with
  `OBJECT_CACHE_TOPOLOGY_V4_DOCKER_BLOCKER_NOT_RECORDED`;
- Docker-unavailable evidence that does not preserve exit `2`,
  `acceptedForReleaseGate: false`, and fail-closed status is rejected with
  `OBJECT_CACHE_TOPOLOGY_V4_DOCKER_UNAVAILABLE_MUST_FAIL_CLOSED`;
- support evidence with packaged fallback or release movement is rejected with
  `OBJECT_CACHE_TOPOLOGY_V4_PACKAGED_FALLBACK_REJECTED` and
  `OBJECT_CACHE_TOPOLOGY_V4_RELEASE_STATUS_MUST_REMAIN_NO_GO`; and
- replayed proofs preserve the same hashes, counts, site surfaces, focused
  regression surfaces, and exact blocker state.

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result from validation:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- artifact:
  `/tmp/reprint-docker-local-production-evidence-ob81Vq/release-gate-input.json`
- deterministic artifact hash:
  `11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2`
- topology command: `npm run verify:release:docker-local-production`
- release-verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- accepted for release gate: `false`
- fail closed: `true`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- packaged fallback observed: `false`
- packaged fallback allowed: `false`
- release URLs use Docker DNS: `true`
- local-only topology validation: `true`
- published HTTP ingress count: `1`
- cache backend published host ports: `0`

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
    "object-cache-topology-v4-startup-proof"
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

Because Docker CLI is missing, this evidence is accepted only as exact
unavailable-capability support evidence. It does not claim started sites,
object-cache backend startup, per-site object-cache runtime readback, cache
content readback, or production-backed release readiness.

## Validation

Required validation commands and observed results before commit:

```sh
node --check test/rpp-0871-object-cache-enabled-topology-v4.test.js
node --test --test-name-pattern RPP-0871 test/rpp-0871-object-cache-enabled-topology-v4.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0871-object-cache-enabled-topology-v4.md
git diff --check
```

Observed local results:

- syntax check: exit `0`
- focused RPP-0871 test: exit `0`, `5` tests passed
- topology command assertion: exit `0`; wrapped command observed
  `npm run verify:release:docker-local-production` exit `2`, exact unavailable
  capability `DOCKER_CLI_MISSING`, `acceptedForReleaseGate: false`, and
  `failClosed: true`
- redaction scan: exit `0`, `ok: true`, 0 rejected files
- diff whitespace check: exit `0`

## Recommendation

Final release status: **NO-GO**.

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by recording the exact
unavailable Docker capability from the topology command. A Docker-capable
environment still needs to start the object-cache-enabled topology and collect
per-site object-cache runtime readback before this can become production-backed
release evidence.
