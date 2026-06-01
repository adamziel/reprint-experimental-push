# RPP-0817 REST Route Matrix Proof Variant 1

Date: 2026-06-01

## Scope

RPP-0817 records the REST route matrix proof required by the production
topology lane. The route contract is satisfied locally, but the release-ready
success target also requires `verify:release` to pass on the topology without
packaged fallback and with live route receipts matching the matrix.

That production-backed topology proof is unavailable in this sandbox because
the Docker CLI is missing. This evidence records the exact unavailable
capability, keeps the result fail-closed, and leaves final release status
**NO-GO**.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0817",
  "variant": 1,
  "title": "REST route matrix proof on production topology",
  "status": "blocked-exact-unavailable-capability",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "routeMatrixContract": {
      "contractId": "push-route-proof-matrix-contract-v1",
      "schemaVersion": 1,
      "routeOrder": [
        "preflight",
        "dry-run",
        "apply",
        "journal",
        "recovery-inspect",
        "recovery-repair"
      ],
      "sourceEvidence": "ao-route-proof-matrix"
    },
    "topologyCommand": {
      "command": "npm run verify:release:docker-local-production",
      "releaseVerifierCommand": "npm run verify:release",
      "topologyVariant": "RPP-0802-variant-1",
      "publishedIngressPort": 8080,
      "publishedIngressHost": "loopback-only",
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    }
  },
  "routeMatrix": {
    "contractId": "push-route-proof-matrix-contract-v1",
    "validationOk": true,
    "validationStatus": "satisfied",
    "routeCount": 6,
    "routeOrder": [
      "preflight",
      "dry-run",
      "apply",
      "journal",
      "recovery-inspect",
      "recovery-repair"
    ],
    "routes": [
      {
        "id": "preflight",
        "stage": "push_preflight",
        "namespace": "reprint/v1",
        "routePath": "/push/preflight",
        "method": "GET",
        "classification": "protocol-state-only",
        "readOnly": false,
        "mutates": false,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      },
      {
        "id": "dry-run",
        "stage": "push_plan_dry_run",
        "namespace": "reprint/v1",
        "routePath": "/push/dry-run",
        "method": "POST",
        "classification": "non-mutating-receipt",
        "readOnly": false,
        "mutates": false,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      },
      {
        "id": "apply",
        "stage": "push_batch_apply",
        "namespace": "reprint/v1",
        "routePath": "/push/apply",
        "method": "POST",
        "classification": "mutating-write",
        "readOnly": false,
        "mutates": true,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      },
      {
        "id": "journal",
        "stage": "push_journal",
        "namespace": "reprint/v1",
        "routePath": "/push/journal",
        "method": "GET",
        "classification": "readOnly",
        "readOnly": true,
        "mutates": false,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      },
      {
        "id": "recovery-inspect",
        "stage": "push_recover inspect",
        "namespace": "reprint/v1",
        "routePath": "/push/recovery/inspect",
        "method": "POST",
        "classification": "readOnly",
        "readOnly": true,
        "mutates": false,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      },
      {
        "id": "recovery-repair",
        "stage": "push_recover auto|finish|rollback",
        "namespace": "reprint/v1",
        "routePath": "/push/recovery/repair",
        "method": "POST",
        "classification": "mutating-repair",
        "readOnly": false,
        "mutates": true,
        "permissionCapability": "manage_options",
        "failClosedPolicyRecorded": true
      }
    ],
    "permissionFloor": "manage_options",
    "permissionCallback": "reprint_push_lab_rest_authenticated_permission",
    "mutatingRouteCount": 2,
    "readOnlyRouteCount": 2,
    "nonMutatingReceiptRouteCount": 2,
    "liveRestRouteReadbackObserved": false,
    "routeRegistrationReadbackObserved": false,
    "routeReceiptBodiesStored": false,
    "releaseVerifierTopologyPassObserved": false,
    "failClosedPolicy": "missing or contradictory route identity, method, permission, or mutation-boundary evidence blocks release movement",
    "routeMatrixHash": "310fd1d9c29b7740c596a8aa0573de0c6d0f0dd1c83a96ef9320460952b3009c"
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "status": "blocked",
    "verifyReleasePassed": false,
    "verifyReleaseExitCode": 2,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "packagedFallbackObserved": false,
    "topologyVariant": "RPP-0802-variant-1",
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "probeCommand": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "rest-route-matrix-live-route-readback",
        "verify-release-topology-run",
        "no-packaged-fallback-release-proof"
      ]
    },
    "artifactHash": "sha256:e5e65083fa05a3feb762774523cbaa44c01fa8e494e84f36c45100969a12ccea"
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "finalReleaseStatus": "NO-GO",
    "releaseGateMovement": "none",
    "requiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "verify-release-docker-local-production-passes-without-packaged-fallback",
      "live-rest-index-route-registration-readback",
      "preflight-dry-run-apply-journal-recovery-route-receipts",
      "manage-options-permission-readback-on-each-route",
      "mutation-boundary-receipts-match-route-matrix",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-live-rest-route-readback",
      "no-verify-release-pass-on-topology",
      "route-matrix-contract-is-support-only-until-topology-passes"
    ],
    "readyWhen": "verify-release-passes-on-the-topology-without-packaged-fallback-and-live-route-receipts-match-the-route-matrix"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "routeReceiptBodiesIncluded": false,
    "credentialMaterialIncluded": false,
    "tunnelOutputIncluded": false,
    "scopeComparisonHashCovers": [
      "routeMatrix",
      "topologyCommand",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "159a7ca4f76abfb2c1af6c7670b171511e845bec66261835a321b870f3e07e0f",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0817-rest-route-matrix-proof-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0817 test/rpp-0817-rest-route-matrix-proof-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0817-rest-route-matrix-proof-v1.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check",
        "result": "exit-0"
      },
      {
        "command": "npm run verify:release:docker-local-production",
        "result": "exit-2-with-exact-unavailable-capability"
      }
    ],
    "topologyCommandObservedOutcome": {
      "exitCode": 2,
      "capabilityCode": "DOCKER_CLI_MISSING",
      "finalMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
    },
    "evidenceRedactionScan": {
      "ok": true,
      "rejectedFiles": 0
    }
  }
}
```

## REST Route Matrix Scope

The local contract covers the six production-shaped push routes: preflight,
dry-run, apply, journal, recovery inspect, and recovery repair. Each route has
an expected method, namespace, permission floor, mutation classification, and
fail-closed policy.

The contract proof is useful support evidence, but it is not enough for
release movement. The live topology still needs route registration readback and
route receipt evidence from the same `verify:release` run.

## Release-Ready Scope

Release-ready RPP-0817 evidence requires the topology command to start the
WordPress sites, run `verify:release`, avoid packaged fallback, and produce
live route receipts that match the local route matrix. None of those
production-backed route receipts were observed in this sandbox.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Keep this as support-only route matrix evidence. Do not mark RPP-0817
release-ready until `verify:release` passes on the topology without packaged
fallback and the live route receipts match the route matrix.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0817-rest-route-matrix-proof-v1.test.js
node --test --test-name-pattern RPP-0817 test/rpp-0817-rest-route-matrix-proof-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0817-rest-route-matrix-proof-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0817-rest-route-matrix-proof-v1.test.js`: exit 0
- `node --test --test-name-pattern RPP-0817 test/rpp-0817-rest-route-matrix-proof-v1.test.js`: exit 0
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0817-rest-route-matrix-proof-v1.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0
- `npm run verify:release:docker-local-production`: exit 2 with `DOCKER_CLI_MISSING` and final fail-closed marker
