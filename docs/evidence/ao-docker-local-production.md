# Docker local production complex-site harness evidence

Date: 2026-05-28
Lane: `local-production-proof-artifact-refresh`

## What changed

This lane maintains `scripts/docker/production-complex-site-harness.mjs`, a local-only Docker proof wrapper for treating a complex disposable WordPress topology as production-shaped evidence when Docker is available. The harness is intentionally fail-closed when Docker is unavailable or when the generated topology violates the local-only policy.

The refresh adds a deterministic `release-gate-input.json` surface that can be passed directly to `scripts/release/check-release-gates.mjs` without external accounts. The artifact includes a canonical SHA-256 over the release-gate-relevant fields, a redacted/empty `env`, scoped `evidence`, and the release gate evaluator summary. A blocked Docker prerequisite remains a release **NO-GO**.

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

Observed artifact: `/tmp/reprint-docker-local-production-evidence-WWDomk/release-gate-input.json`

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
  --evidence-file /tmp/reprint-docker-local-production-evidence-WWDomk/release-gate-input.json \
  --now 2026-05-28T00:00:00.000Z
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

## Focused test evidence

Commands run:

```sh
node --check scripts/docker/production-complex-site-harness.mjs
npm run test:docker:production-complex-site-harness
```

Observed result: 10/10 tests passed.

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
- release gate input has a stable canonical digest across run-local paths
- `check-release-gates` consumes the emitted artifact directly and stays held

## RPP coverage advanced

This lane advances these earliest relevant unchecked checklist items without marking Docker release-ready:

- RPP-0801: three-site/four-role local production topology records exact unavailable capability.
- RPP-0819: sandbox `8080` ingress rule is encoded and regression-tested in the generated Docker topology.
- RPP-0820: no-tunnel policy is encoded and regression-tested against generated commands/images.
- RPP-0903: release gate input artifact fails closed when the required Docker proof cannot run.

RPP-0802 remains blocked until a Docker-capable environment runs `npm run verify:release:docker-local-production` and produces a passing `release-gate-input.json` without packaged fallback.
