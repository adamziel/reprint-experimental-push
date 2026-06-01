# RPP-0802 Docker WordPress topology v1 evidence

Date: 2026-06-01

## Scope

RPP-0802 variant 1 covers the Docker WordPress topology boundary for the release verifier. The required release-ready path is a Docker-backed run where the topology runner executes `npm run verify:release` against Docker service DNS URLs and does not use packaged fallback evidence.

This worker did not edit checklist or progress surfaces and did not start a tunnel. The only planned host ingress in the Docker topology is `127.0.0.1:8080:80` for optional local inspection; release verifier traffic stays on the private Docker network.

## Nearby patterns inspected

- RPP-0801/RPP-0819/RPP-0820: `scripts/docker/production-complex-site-harness.mjs`, `test/production-complex-site-harness.test.js`, and `docs/evidence/ao-docker-local-production.md`
- RPP-0803: `scripts/playground/external-wordpress-topology-proof.mjs`, `test/external-wordpress-topology-proof.test.js`, and `docs/evidence/rpp-0803-external-wordpress-topology.md`

## Implemented support evidence

The existing Docker harness already prepares a four-role WordPress topology:

| Role | Release verifier URL |
| --- | --- |
| source | `http://wp-source` |
| remote changed | `http://wp-remote-changed` |
| local edited | `http://wp-local-edited` |
| apply revalidation source | `http://wp-apply-revalidation-source` |

The RPP-0802 focused test in `test/rpp-0802-docker-wordpress-topology-v1.test.js` adds deterministic coverage that:

- records exact Docker prerequisite blockers for missing CLI, missing Compose v2, and missing daemon
- proves a blocked Docker prerequisite produces `acceptedForReleaseGate: false`
- proves `releaseMovement.allowed: false` until a real Docker topology produces a passed artifact
- pins the topology runner to `npm run verify:release`
- rejects packaged-fallback runner state and packaged-fallback environment flags
- verifies the passed-artifact contract uses Docker service DNS URLs with `packagedFallback: false`

No shared release or topology code was changed for this slice.

## Local sandbox run

Command run:

```sh
REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_DIR=/tmp/reprint-rpp-0802-docker-evidence \
REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_WORKDIR=/tmp/reprint-rpp-0802-docker-work \
REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_GENERATED_AT=2026-06-01T00:00:00.000Z \
npm run verify:release:docker-local-production
```

Observed status: `2`

Exact unavailable capability:

```text
docker --version -> ENOENT
Docker blocker: DOCKER_CLI_MISSING
Docker Compose check: not reached
Docker daemon check: not reached
```

Emitted artifact:

```text
/tmp/reprint-rpp-0802-docker-evidence/release-gate-input.json
```

Important artifact fields:

```text
status: blocked
acceptedForReleaseGate: false
failClosed: true
packagedFallback: false
evidence.packagedFallback.observed: false
evidence.dockerVerifyReleaseTopology.topologyVariant: RPP-0802-variant-1
evidence.dockerVerifyReleaseTopology.command: npm run verify:release
evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed: false
evidence.dockerVerifyReleaseTopology.packagedFallbackObserved: false
evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns: true
evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease: true
evidence.dockerVerifyReleaseTopology.topologyValidationOk: true
evidence.verifyReleaseFailure.exitCode: 2
evidence.verifyReleaseFailure.reason: DOCKER_CLI_MISSING
releaseGateEvaluation.releaseMovement.allowed: false
releaseGateEvaluation.primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED
deterministic.canonicalSha256: 11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2
[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]
```

Release-gate consumption check:

```sh
node ./scripts/release/check-release-gates.mjs \
  --evidence-file /tmp/reprint-rpp-0802-docker-evidence/release-gate-input.json \
  --now 2026-06-01T00:00:00.000Z
```

Observed status: `1`. The report stayed `NO-GO` with `mutationAttempted: false`, `releaseMovement.allowed: false`, and `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`.

## Validation

Commands run:

```sh
node --check test/rpp-0802-docker-wordpress-topology-v1.test.js
node --test test/rpp-0802-docker-wordpress-topology-v1.test.js
npm run test:docker:production-complex-site-harness
node ./scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0802-docker-wordpress-topology-v1.md
git diff --check
```

Observed result: all commands exited `0`.

## Integration recommendation

Keep RPP-0802 unchecked for release-ready movement in this sandbox. The topology contract and fallback boundary are covered, but Docker itself is unavailable here, so the required passing `npm run verify:release` run on Docker WordPress has not been observed.
