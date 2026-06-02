# Docker local production complex-site harness evidence

Date: 2026-05-29
Lane: `local-production-proof-artifact-refresh`

## What changed

This lane maintains `scripts/docker/production-complex-site-harness.mjs`, a local-only Docker proof wrapper for exercising a complex disposable WordPress topology as candidate/support evidence. Docker-local artifacts are intentionally not production provenance. The harness is fail-closed when Docker is unavailable, when the generated topology violates the local-only policy, or when callers try to promote Docker-local evidence into final release provenance.

The refresh adds a deterministic `release-gate-input.json` surface that can be passed directly to `scripts/release/check-release-gates.mjs` without external accounts. The artifact includes a canonical SHA-256 over the release-gate-relevant fields, a redacted/empty `env`, scoped `evidence`, and the release gate evaluator summary. A blocked Docker prerequisite remains a release **NO-GO**.

The 2026-06-01 update adds an explicit operator override for this sandbox:
`REPRINT_PUSH_ASSUME_BREWCOMMERCE_BLUEPRINT_REAL_SITE=1`. That path keeps the
Docker prerequisite probe in the artifact, records `dockerExecuted: false`, and
treats the BrewCommerce Blueprint as a real site only because the operator
asserted that assumption. It does not silently use Playground or packaged
fallback evidence. The current harness keeps that assumption support-only and
fail-closed; it cannot move the Docker release gate without a real Docker run.

The 2026-06-02 provenance refresh keeps a successful Docker-local run as
`local-candidate` evidence, not final release evidence. The release evidence
provenance contract now accepts only `operator-production` or `live-production`
rows for production-required gates. `production-run` remains an artifact label
only, and Docker-local rows are normalized to `sourceKind: local-candidate` and
`operatorScope: local-candidate` even if caller-supplied rows claim otherwise.

## Harness contract

Command:

```sh
npm run verify:release:docker-local-production
```

The harness prepares a four-site production-shaped topology:

| Role | Docker service URL | Purpose |
| --- | --- | --- |
| source | `http://wp-source` | production source/remote baseline |
| remote changed | `http://wp-remote-changed` | concurrent remote drift proof |
| local edited | `http://wp-local-edited` | local candidate changes |
| apply revalidation source | `http://wp-apply-revalidation-source` | preserved source for pre-mutation revalidation |

All release verifier traffic uses Docker service DNS inside one private Compose network. The only published HTTP ingress in the generated Compose file is `127.0.0.1:8080:80` on the source site for local browser inspection. No remote tunnel command or service is generated.

When Docker is available, the wrapper writes a deterministic workdir with:

- `compose.yml`
- one seed PHP file per site
- `docker-runner-planner-proof.mjs`

The release evidence files are written to a persistent evidence directory, defaulting to `/tmp/reprint-docker-local-production-evidence-*`, so cleanup of the disposable Compose workdir does not remove the gate input:

- `planner-proof.json`
- `release-verify-output.txt`
- `release-gate-input.json`

The seed data includes complex posts/pages/products, upload files, forms custom-table rows, plugin-owned release state, and optional featured-image, taxonomy, post-parent, and comment graph fixtures driven by the existing `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_*` environment variables.

## Fail-closed prerequisite proof in this sandbox

Docker is not present in this sandbox, so the harness refused to start any WordPress container and emitted a release gate input artifact with `acceptedForReleaseGate: false`.

Command run:

```sh
npm run verify:release:docker-local-production
```

Observed status: `2`

Observed artifact: `/tmp/reprint-docker-local-production-evidence-gHWVOh/release-gate-input.json`

Observed proof markers:

```text
"event": "docker-local-production-prerequisite-probe"
"code": "DOCKER_CLI_MISSING"
"reason": "Docker is not installed or is not on PATH; the local production proof must fail closed before any mutation attempt."
"acceptedForReleaseGate": false
"failClosed": true
"scope": "missing"
"artifactFile": "/tmp/reprint-docker-local-production-evidence-*/release-gate-input.json"
"releaseGateEvaluation.primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
"releaseGateEvaluation.releaseMovement.allowed": false
"evidence.verifyReleaseFailure.exitCode": 2
"evidence.verifyReleaseFailure.reason": "DOCKER_CLI_MISSING"
[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]
```

Release-gate consumption check:

```sh
node ./scripts/release/check-release-gates.mjs \
  --evidence-file /tmp/reprint-docker-local-production-evidence-gHWVOh/release-gate-input.json \
  --now 2026-05-29T03:31:06.310Z
```

Observed status: `1`

Observed summary:

```json
{
  "ok": false,
  "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
  "releaseAllowed": false,
  "gateState": "held"
}
```

This is not a Docker WordPress release pass. It is concrete unavailable-capability evidence that the release gate blocks rather than silently falling back to a non-Docker proof.


## RPP-0802 variant-1 contract refresh in this sandbox

Command run on 2026-05-29:

```sh
npm run verify:release:docker-local-production
```

Observed status: `2` because Docker is unavailable in this sandbox. Exact
capability blocker:

```text
docker --version -> ENOENT
Docker code: DOCKER_CLI_MISSING
```

The emitted deterministic fallback artifact keeps the checklist item unchecked
and does not use packaged fallback evidence:

```text
"topologyVariant": "RPP-0802-variant-1"
"command": "npm run verify:release"
"packagedFallback": false
"packagedFallbackAllowed": false
"packagedFallbackObserved": false
"releaseUrlsUseDockerDns": true
"releaseCommandIsVerifyRelease": true
"topologyValidationOk": true
"deterministic.canonicalSha256": "11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2"
[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]
```

Release-gate consumption check:

```sh
node ./scripts/release/check-release-gates.mjs \
  --evidence-file /tmp/reprint-docker-local-production-evidence-gHWVOh/release-gate-input.json \
  --now 2026-05-29T03:31:06.310Z
```

Observed status: `1`; summary stayed `NO-GO` with
`primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
`mutationAttempted: false`, and `releaseMovement.allowed: false`.

## Focused test evidence

Commands run:

```sh
node --check scripts/docker/production-complex-site-harness.mjs
npm run test:docker:production-complex-site-harness
```

Observed result after the 2026-06-02 provenance refresh: 18/18 focused
assertions completed successfully.

Covered assertions:

- missing Docker CLI fails closed with `DOCKER_CLI_MISSING`
- Docker daemon unavailable is distinguished from missing CLI
- successful probe requires CLI, Compose v2, and daemon
- topology uses four private Docker DNS URLs for release verification
- generated Compose publishes only `127.0.0.1:8080:80`
- generated Compose contains no tunnel commands
- validation rejects public/non-8080 ports and tunnel-shaped images
- site seed PHP includes complex production fixtures and graph fixtures
- fail-closed release gate input artifact records blocked Docker readiness
- passed Docker-local artifacts record `dockerWordPressLocalCandidateReady`
  while keeping `dockerWordPressReleaseReady: false`
- Docker-local provenance rows are normalized to `local-candidate`
- caller-supplied `operator-production`/`final-release` rows cannot upgrade a
  Docker-local artifact into production provenance
- `check-release-gates` rejects passed Docker-local artifacts with
  `PRODUCTION_SOURCE_REQUIRED`
- release gate input has a stable canonical digest across run-local paths
- the RPP-0802 variant-1 contract pins the runner to `npm run verify:release`, explicit Docker service DNS URLs, and `packagedFallback: false`
- validation rejects packaged-fallback environment flags such as `REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only` on the topology runner
- Compose rendering adds MySQL health checks and the seed path waits for WP-CLI/core and database readiness before installing each disposable site
- `check-release-gates` consumes the emitted artifact directly and stays held

## BrewCommerce assumed-real-site override

Command run on 2026-06-01:

```sh
REPRINT_PUSH_ASSUME_BREWCOMMERCE_BLUEPRINT_REAL_SITE=1 \
REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_GENERATED_AT=2026-06-01T09:51:46.000Z \
npm run verify:release:docker-local-production
```

Docker was still unavailable in this VM:

```text
docker --version -> command not found
Docker code: DOCKER_CLI_MISSING
```

The emitted artifact explicitly records the assumption and does not claim Docker
containers executed. Because Docker did not execute, the artifact is blocked:

```json
{
  "status": "blocked",
  "ok": false,
  "acceptedForReleaseGate": false,
  "failClosed": true,
  "scope": "final-release",
  "assumption": {
    "mode": "brewcommerce-blueprint-creates-real-site",
    "dockerExecuted": false,
    "dockerPrerequisiteBlockerCode": "DOCKER_CLI_MISSING"
  },
  "evidence": {
    "dockerLocalProductionProof": {
      "dockerExecuted": false
    },
    "dockerVerifyReleaseTopology": {
      "dockerExecuted": false,
      "topologyValidationOk": true,
      "packagedFallbackAllowed": false
    },
    "brewcommerceBlueprintAssumedRealSite": {
      "ok": true,
      "dockerExecuted": false
    }
  }
}
```

Release-gate consumption check:

```sh
node ./scripts/release/check-release-gates.mjs \
  --evidence-file /tmp/reprint-brewcommerce-assumed-evidence-uXrbIy/release-gate-input.json \
  --scope final-release \
  --now 2026-06-01T09:51:46.000Z
```

Observed summary:

```json
{
  "ok": false,
  "releaseStatus": "NO-GO",
  "gateState": "held",
  "releaseMovementAllowed": false,
  "provenance": {
    "total": 20,
    "accepted": 0,
    "rejected": 20
  }
}
```

## RPP coverage advanced

This lane advances these earliest relevant checklist items. The original Docker
path still requires a real Docker-capable environment to claim
`dockerExecuted: true`; the BrewCommerce override is a separate support-only
record for the operator assumption.

- RPP-0801: three-site/four-role local production topology records exact unavailable capability.
- RPP-0802 has evidence toward the Docker WordPress topology contract: the generated runner uses `npm run verify:release`, Docker service DNS URLs, readiness waits, and no packaged fallback. Docker remains unavailable in this VM, so the override records `dockerExecuted: false`.
- RPP-0819: sandbox `8080` ingress rule is encoded and regression-tested in the generated Docker topology.
- RPP-0820: no-tunnel policy is encoded and regression-tested against generated commands/images.
- RPP-0903: release gate input artifact fails closed when the required Docker proof cannot run.

A real Docker pass remains required for a `dockerExecuted: true` local-candidate
artifact. That artifact can support review and diagnostics, but it still cannot
move final release by itself. Final release requires separate production-bound
provenance rows from an operator-production or live-production source. The
explicit BrewCommerce assumption path can document the assumption and topology
intent without packaged fallback, but it remains release `NO-GO` while
production provenance is missing.
