# RPP-0877 REST Route Matrix Proof Variant 4

Date: 2026-06-01

## Scope

RPP-0877 records focused regression coverage for the REST route matrix proof,
variant 4. It carries forward the RPP-0857 variant 3 route matrix contract and
uses the current variant-4 production-topology pattern: the candidate must keep
candidate scope separate from release-ready scope, record either site startup
or an exact unavailable capability, keep packaged fallback disabled, and leave
release movement blocked when production-backed route readback is absent.

This worker did not start servers and did not invoke the Docker topology
runner. The Docker CLI is unavailable in this sandbox, so this evidence is
support-only and fail-closed. It records the REST route matrix, topology
prerequisite policy, local-only `8080` ingress rule, no-tunnel rule, and the
remaining release-ready gaps. It does not claim live REST route readback,
route receipt bodies, production mutation receipts, or release readiness.

Final release remains **NO-GO**.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0877",
  "variant": 4,
  "title": "REST route matrix proof on production topology variant 4",
  "coverageMode": "focused-regression-local-support-only",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
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
      "variantLineage": "RPP-0857-variant-3"
    },
    "topologyCommand": {
      "command": "npm run verify:release:docker-local-production",
      "releaseVerifierCommand": "npm run verify:release",
      "supportOnlyCriterion": "sites-started-or-exact-unavailable-capability-recorded",
      "releaseReadyCriterion": "verify-release-passes-without-packaged-fallback-on-the-topology",
      "topologyVariant": "RPP-0802-variant-1",
      "publishedIngressPort": 8080,
      "publishedIngressHost": "loopback-only",
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    }
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "operationGuards": {
    "liveWordPressUsed": false,
    "wordpressRoutesCalled": false,
    "networkProbePerformed": false,
    "networkServiceStarted": false,
    "topologyCommandInvokedByThisWorker": false,
    "routeReceiptBodiesStored": false,
    "releaseGatesMoved": false,
    "dashboardUpdated": false
  },
  "candidateScope": {
    "status": "rest-route-matrix-candidate-v4",
    "coverageMode": "focused-regression-candidate-vs-release-ready",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0857-route-matrix-v3-plus-variant-4-production-topology-pattern",
    "variantLineage": {
      "precedentRppIds": [
        "RPP-0817",
        "RPP-0837",
        "RPP-0857"
      ],
      "previousVariants": [
        1,
        2,
        3
      ],
      "unavailableCapabilityPattern": true,
      "deterministicLocalSupportOnly": true,
      "focusedRegressionVariant": true,
      "productionTopologyVariant4Pattern": true,
      "candidateVersusReleaseReadyBoundary": true
    },
    "routeMatrixCandidate": {
      "contractId": "push-route-proof-matrix-contract-v1",
      "routeCount": 6,
      "routeIds": [
        "preflight",
        "dry-run",
        "apply",
        "journal",
        "recovery-inspect",
        "recovery-repair"
      ],
      "methodSurfaceCount": 6,
      "permissionSurfaceCount": 6,
      "mutationBoundarySurfaceCount": 6,
      "permissionFloor": "manage_options",
      "permissionCallback": "reprint_push_lab_rest_authenticated_permission",
      "rawRouteBodiesIncluded": false,
      "liveRestIndexReadbackPerformed": false,
      "routeReceiptReadbackPerformed": false
    },
    "candidateClaims": [
      "route-matrix-contract-validated",
      "route-identity-method-permission-mutation-boundary-recorded",
      "topology-command-startup-or-exact-capability-recorded",
      "docker-topology-policy-surface-recorded",
      "variant-4-candidate-versus-release-ready-boundary-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "live-rest-index-route-registration-readback",
      "preflight-dry-run-apply-journal-recovery-route-receipts",
      "route-receipt-body-storage",
      "production-backed-mutation-boundary-readback",
      "verify-release-accepted-route-matrix-artifact",
      "packaged-fallback-release-proof"
    ]
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
    "failClosedPolicy": "missing or contradictory route identity, method, permission, mutation-boundary, live-readback, receipt, no-packaged-fallback, or variant-4 release-ready-boundary evidence blocks release movement",
    "routeMatrixHash": "1cfd2a2d6291a20249deb5f63796797d364e815e167c87f9bd52400c7e565629"
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "successCriterion": "sites-started-or-exact-unavailable-capability-recorded",
    "releaseReadyCriterion": "verify-release-passes-without-packaged-fallback-on-the-topology",
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
    "runtime": "docker-local-wordpress",
    "topologyVariant": "RPP-0802-variant-1",
    "siteRoleCount": 4,
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
        "production-backed-route-receipt-proof",
        "variant-4-focused-regression-proof"
      ]
    },
    "publishedIngress": {
      "hostSurface": "loopback-only",
      "port": 8080,
      "publishedPortCount": 1
    },
    "policy": {
      "sandboxIngressPort": 8080,
      "onlySandbox8080Ingress": true,
      "remoteTunnelsAllowed": false,
      "tunnelCommandCount": 0,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "releaseUrlsUseDockerDns": true,
      "releaseVerifierCommand": "npm run verify:release"
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]",
    "artifactHash": "sha256:83fdfcfca4324a51482a9e3e530d9b7cd37c81d2cd481eab4d0db6fb57988595"
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
      "preflight-route-receipt",
      "dry-run-route-receipt",
      "apply-route-receipt",
      "journal-route-receipt",
      "recovery-inspect-route-receipt",
      "recovery-repair-route-receipt",
      "manage-options-permission-readback-on-each-route",
      "mutation-boundary-receipts-match-route-matrix",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-live-rest-route-readback",
      "no-verify-release-pass-on-topology",
      "no-production-backed-route-receipt-artifact",
      "candidate-does-not-have-release-verifier-accepted-route-matrix-proof",
      "route-matrix-contract-is-support-only-until-topology-passes"
    ],
    "routeMatrixReleaseGate": {
      "status": "not-satisfied",
      "candidateOnlyReleaseMovement": "blocked",
      "packagedFallbackCanSatisfyRouteMatrixProof": false,
      "releaseMovementBlockedUntil": [
        "docker-wordpress-topology-sites-started",
        "verify-release-docker-local-production-passes-without-packaged-fallback",
        "live-rest-index-route-registration-readback",
        "route-receipts-cover-all-six-production-routes"
      ]
    },
    "readyWhen": "verify-release-passes-on-the-topology-without-packaged-fallback-and-live-route-receipts-match-the-route-matrix"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "payloadsStored": false,
    "rawPayloadCount": 0,
    "rawUrlCount": 0,
    "rawRouteBodyCount": 0,
    "routeReceiptBodyCount": 0,
    "sensitiveSurfaceCount": 0,
    "routeSurfaceCount": 6,
    "evidenceSurfaceCount": 10,
    "rejectedSurfaceCount": 0,
    "hashedSurfaceCount": 5,
    "surfaceNames": [
      "route-matrix-contract-validated",
      "route-identity-method-permission-mutation-boundary-recorded",
      "variant-4-candidate-versus-release-ready-boundary-recorded",
      "live-route-readback-required-not-claimed",
      "per-route-receipts-required-not-stored",
      "topology-command-exact-unavailable-capability-recorded",
      "release-verifier-no-packaged-fallback-contract-recorded",
      "sandbox-8080-only-no-tunnels-policy-recorded",
      "dashboard-not-updated",
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
        "surface": "variant-4-candidate-versus-release-ready-boundary-recorded",
        "ok": true,
        "count": 1
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
        "surface": "dashboard-not-updated",
        "ok": true,
        "count": 0
      },
      {
        "surface": "final-no-go-release-block-recorded",
        "ok": true,
        "count": 1
      }
    ],
    "surfaceDigest": "sha256:a0b6566518b46777611d3426fbd67fa2b3376b149c97543bbf48ec05bc3c0ec0"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "rawRouteBodiesIncluded": false,
    "routeReceiptBodiesIncluded": false,
    "credentialMaterialIncluded": false,
    "tunnelOutputIncluded": false,
    "rawReleaseArtifactsIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "routeMatrix",
      "topologyCommand",
      "localOnlyPolicy",
      "releaseReadyScope",
      "operationGuards",
      "evidenceLimits",
      "finalReleaseStatus",
      "integrationRecommendation"
    ]
  },
  "invariants": {
    "routeMatrixValidated": true,
    "candidateVersusReleaseReadyScopeRecorded": true,
    "topologyCommandStartedSitesOrExactCapabilityRecorded": true,
    "failClosedWhenTopologyUnavailable": true,
    "noPackagedFallback": true,
    "noTunnelUsage": true,
    "onlySandbox8080Ingress": true,
    "liveRouteReadbackNotClaimed": true,
    "routeReceiptBodiesNotStored": true,
    "dashboardNotUpdated": true,
    "productionBackedProofRequiredForGo": true,
    "supportOnlyNoGo": true
  },
  "scopeComparisonHash": "b972be015f1dd0e5392701d4a247499de1e498c78c8a0227cbdc77ecdb6ccb6f",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0877-rest-route-matrix-proof-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0877 test/rpp-0877-rest-route-matrix-proof-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0877-rest-route-matrix-proof-v4.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check",
        "result": "exit-0"
      }
    ],
    "topologyCommandExpectedOutcome": "site-startup-proof-or-exact-unavailable-capability",
    "topologyCommandObservedOutcome": {
      "commandInvokedByThisWorker": false,
      "sitesStarted": false,
      "capabilityCode": "DOCKER_CLI_MISSING",
      "acceptedForReleaseGate": false,
      "failClosed": true,
      "finalMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
    },
    "evidenceRedactionScan": {
      "ok": true,
      "rejectedFiles": 0
    }
  }
}
```

## Candidate Scope

The candidate records the six production-shaped push routes: preflight,
dry-run, apply, journal, recovery inspect, and recovery repair. Each route has
an expected method, namespace, permission floor, mutation classification, and
fail-closed policy. Variant 4 also records that this candidate evidence is not
release-ready evidence.

The topology command contract is checked at the artifact level. In this
sandbox the Docker CLI is unavailable, so sites were not started and live REST
routes were not read. This is accepted only as fail-closed support evidence
because the exact unavailable capability is recorded and release movement
remains blocked.

## Release-Ready Scope

Release-ready REST route matrix proof still requires the Docker WordPress
topology to start, `verify:release` to pass without packaged fallback, the live
REST route index to match the matrix, and route receipts for preflight, dry-run,
apply, journal, recovery inspect, and recovery repair to match the expected
permission and mutation boundaries.

Packaged fallback cannot satisfy this proof.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only route matrix prerequisite evidence. Do not mark
REST route matrix proof release-ready until the topology command starts the
sites, `verify:release` passes without packaged fallback, and live route
receipts match the matrix.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0877-rest-route-matrix-proof-v4.test.js
node --test --test-name-pattern RPP-0877 test/rpp-0877-rest-route-matrix-proof-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0877-rest-route-matrix-proof-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0877-rest-route-matrix-proof-v4.test.js`: exit 0
- `node --test --test-name-pattern RPP-0877 test/rpp-0877-rest-route-matrix-proof-v4.test.js`: exit 0
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
