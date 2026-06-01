# RPP-0857 REST Route Matrix Proof Variant 3

Date: 2026-06-01

## Scope

RPP-0857 records variant 3 support-only evidence for the REST route matrix
proof required by the production topology lane. It follows the RPP-0837 route
matrix proof variant 2 pattern and the current production topology evidence
pattern for exact unavailable capability, hash/count/surface-only evidence,
local-only ingress, and no packaged fallback.

This worker did not start servers and did not invoke the Docker topology
runner. The production-backed artifact needed for release movement is absent in
this sandbox because the Docker CLI is unavailable. The result therefore fails
closed and final release remains **NO-GO**.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0857",
  "variant": 3,
  "title": "REST route matrix proof on production topology variant 3",
  "checkedAt": "2026-06-01T00:00:00.000Z",
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
      "sourceEvidence": "ao-route-proof-matrix",
      "variantLineage": "RPP-0837-variant-2"
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
    "supportProofMode": "contract-and-topology-prerequisite-only",
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
    "failClosedPolicy": "missing or contradictory route identity, method, permission, mutation-boundary, live-readback, receipt, or no-packaged-fallback evidence blocks release movement",
    "routeMatrixHash": "10e67b3b18b7f64715e4658f64feb83331a7f03ef3d78c4b31ad0c8d5789b63f"
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "status": "blocked",
    "siteStartupStatus": "not-started",
    "sitesStarted": false,
    "verifyReleasePassed": false,
    "verifyReleaseExitCode": 2,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "packagedFallbackObserved": false,
    "topologyCommandInvokedByThisWorker": false,
    "topologyVariant": "RPP-0802-variant-1",
    "localPrerequisiteProbe": {
      "command": "command -v docker",
      "exitCode": 1,
      "observedCapability": "docker-cli",
      "result": "missing-executable"
    },
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "probeCommand": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "rest-route-matrix-live-route-readback",
        "verify-release-topology-run",
        "no-packaged-fallback-release-proof",
        "production-backed-route-receipt-proof"
      ]
    },
    "artifactHash": "sha256:a0f86e3016836bc18411af2bf695ab6d8008adeecd1091653e9d522d4e807ab3"
  },
  "localOnlyPolicy": {
    "onlySandbox8080Ingress": true,
    "publishedHttpIngress": {
      "hostSurface": "loopback-only",
      "port": 8080,
      "publishedPortCount": 1
    },
    "noTunnelPolicyEnforced": true,
    "tunnelCommandCount": 0,
    "dockerNetworkInternal": true,
    "releaseUrlsUseDockerDns": true,
    "networkProbePerformed": false,
    "networkServiceStarted": false
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
      "no-production-backed-route-receipt-artifact",
      "route-matrix-contract-is-support-only-until-topology-passes"
    ],
    "readyWhen": "verify-release-passes-on-the-topology-without-packaged-fallback-and-live-route-receipts-match-the-route-matrix"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "payloadsStored": false,
    "rawPayloadCount": 0,
    "rawUrlCount": 0,
    "routeReceiptBodyCount": 0,
    "sensitiveSurfaceCount": 0,
    "routeSurfaceCount": 6,
    "evidenceSurfaceCount": 8,
    "rejectedSurfaceCount": 0,
    "hashedSurfaceCount": 4,
    "surfaceNames": [
      "route-matrix-contract-validated",
      "route-identity-method-permission-mutation-boundary-recorded",
      "live-route-readback-required-not-claimed",
      "per-route-receipts-required-not-stored",
      "topology-command-exact-unavailable-capability-recorded",
      "release-verifier-no-packaged-fallback-contract-recorded",
      "sandbox-8080-only-no-tunnels-policy-recorded",
      "final-no-go-release-block-recorded"
    ],
    "evidenceSurfaces": [
      {
        "surface": "route-matrix-contract-validated",
        "ok": true,
        "count": 6
      },
      {
        "surface": "route-identity-method-permission-mutation-boundary-recorded",
        "ok": true,
        "count": 6
      },
      {
        "surface": "live-route-readback-required-not-claimed",
        "ok": true,
        "count": 0
      },
      {
        "surface": "per-route-receipts-required-not-stored",
        "ok": true,
        "count": 0
      },
      {
        "surface": "topology-command-exact-unavailable-capability-recorded",
        "ok": true,
        "count": 1
      },
      {
        "surface": "release-verifier-no-packaged-fallback-contract-recorded",
        "ok": true,
        "count": 1
      },
      {
        "surface": "sandbox-8080-only-no-tunnels-policy-recorded",
        "ok": true,
        "count": 1
      },
      {
        "surface": "final-no-go-release-block-recorded",
        "ok": true,
        "count": 1
      }
    ],
    "surfaceDigest": "sha256:d2809d8bc1b37af9af3f0731a14df4d59fbb7b5ed17b966bede90c5d0d79ead5"
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
      "localOnlyPolicy",
      "releaseReadyScope",
      "evidenceLimits",
      "integrationRecommendation"
    ]
  },
  "invariants": {
    "routeMatrixValidated": true,
    "topologyCommandStartedSitesOrExactCapabilityRecorded": true,
    "failClosedWhenTopologyUnavailable": true,
    "noPackagedFallback": true,
    "noTunnelUsage": true,
    "onlySandbox8080Ingress": true,
    "liveRouteReadbackNotClaimed": true,
    "productionBackedProofRequiredForGo": true,
    "supportOnlyNoGo": true
  },
  "scopeComparisonHash": "c56da295f74134abd31bc71906b75683d852091b1de6764370ece68a16b72548",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0857-rest-route-matrix-proof-v3.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0857 test/rpp-0857-rest-route-matrix-proof-v3.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0857-rest-route-matrix-proof-v3.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check origin/lane/evidence-integration-20260527...HEAD",
        "result": "exit-0"
      }
    ],
    "topologyCommandObservedOutcome": {
      "commandInvokedByThisWorker": false,
      "sitesStarted": false,
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

The support proof records the six production-shaped push routes: preflight,
dry-run, apply, journal, recovery inspect, and recovery repair. Each route has
an expected method, namespace, permission floor, mutation classification, and
fail-closed policy.

This is not production-backed proof. Live route registration readback, live
route receipts, and mutation-boundary receipts from the same `verify:release`
topology run are still required before release movement.

## Topology Policy

The required topology remains `npm run verify:release:docker-local-production`
with `npm run verify:release` inside the local Docker runner. The only
permitted ingress surface is the sandbox local inspection port `8080`; remote
tunnel commands remain prohibited. This worker did not start network services.

The local prerequisite probe observed that the Docker CLI is not available, so
the topology did not start and the support proof records `DOCKER_CLI_MISSING`.
No packaged fallback is accepted for this lane.

## Release-Ready Scope

Release-ready REST route matrix proof still requires the Docker WordPress
topology to start, `verify:release` to pass without packaged fallback, the live
REST route index to match the matrix, and route receipts for preflight, dry-run,
apply, journal, recovery inspect, and recovery repair to match the expected
mutation boundaries.

Final release remains **NO-GO** until that production-backed artifact exists.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0857-rest-route-matrix-proof-v3.test.js
node --test --test-name-pattern RPP-0857 test/rpp-0857-rest-route-matrix-proof-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0857-rest-route-matrix-proof-v3.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local results before commit:

- syntax check: exit `0`
- focused RPP-0857 test: exit `0`
- redaction scan: exit `0`, no rejected files
- diff whitespace check: exit `0`
