# RPP-0897 REST Route Matrix Proof Variant 5

Date: 2026-06-01
Lane: RPP-0897 REST route matrix proof release-verifier carry-through, variant 5
Checklist item: RPP-0897 - Carry through the release verifier for REST route matrix proof, variant 5.

## Scope

RPP-0897 records local support evidence that the REST route matrix topology
requires `npm run verify:release` and carries its result through the Docker
local-production harness. Release-ready success is deliberately narrower than
candidate support: `verify:release` must pass on the topology, packaged
fallback must stay disabled, live route receipts must cover the six production
routes, and those receipts must bind to the same release-verifier run.

This sandbox did not start Docker WordPress sites because the Docker CLI is
unavailable. The evidence is fail-closed support evidence only: it records the
exact unavailable capability, the verifier carry-through requirement, the
route matrix, the local-only `8080` ingress policy, and the same-run receipt
binding that remains required. It does not claim live REST route readback,
route receipt bodies, production mutation receipts, or release readiness.

Final release remains **NO-GO**.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0897",
  "variant": 5,
  "title": "REST route matrix proof release-verifier carry-through",
  "coverageMode": "release-verifier-carry-through-local-support-only",
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
      "variantLineage": "RPP-0877-variant-4"
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
      "packagedFallbackAllowed": false,
      "sameRunBindingRequired": true
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
    "verifyReleaseInvokedByThisWorker": false,
    "routeReceiptBodiesStored": false,
    "releaseGatesMoved": false,
    "dashboardUpdated": false
  },
  "candidateScope": {
    "status": "rest-route-matrix-release-verifier-candidate-v5",
    "coverageMode": "release-verifier-carry-through-candidate-vs-release-ready",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0877-route-matrix-v4-plus-rpp-0896-release-verifier-carry-through-pattern",
    "variantLineage": {
      "precedentRppIds": [
        "RPP-0817",
        "RPP-0837",
        "RPP-0857",
        "RPP-0877"
      ],
      "previousVariants": [
        1,
        2,
        3,
        4
      ],
      "unavailableCapabilityPattern": true,
      "deterministicLocalSupportOnly": true,
      "focusedRegressionVariant": true,
      "productionTopologyVariant4Pattern": true,
      "releaseVerifierCarryThroughVariant": true,
      "sameRunBindingVariant": true,
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
      "requiresReleaseVerifierPass": true,
      "requiresSameRunRouteReceipts": true,
      "rawRouteBodiesIncluded": false,
      "liveRestIndexReadbackPerformed": false,
      "routeReceiptReadbackPerformed": false
    },
    "candidateClaims": [
      "route-matrix-contract-validated",
      "route-identity-method-permission-mutation-boundary-recorded",
      "topology-command-startup-or-exact-capability-recorded",
      "release-verifier-carry-through-recorded",
      "variant-5-same-run-binding-requirement-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "verify-release-passed-on-topology",
      "live-rest-index-route-registration-readback",
      "preflight-dry-run-apply-journal-recovery-route-receipts",
      "same-run-live-route-receipts",
      "route-receipt-body-storage",
      "production-backed-mutation-boundary-readback",
      "packaged-fallback-release-proof"
    ]
  },
  "routeMatrix": {
    "contractId": "push-route-proof-matrix-contract-v1",
    "validationOk": true,
    "validationStatus": "satisfied",
    "supportProofMode": "contract-and-release-verifier-carry-through-prerequisite",
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
    "routeReceiptHashesObserved": false,
    "routeReceiptBodiesStored": false,
    "releaseVerifierTopologyPassObserved": false,
    "failClosedPolicy": "missing or contradictory route identity, method, permission, mutation-boundary, live-readback, same-run route receipt, no-packaged-fallback, topology-binding, or verifier-pass evidence blocks release movement",
    "routeMatrixHash": "1c914ff10faa8c25c9a5ddb0d36e532069e0d24c7c408a5ce1eda818128164f0"
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
        "verify-release-passes-without-packaged-fallback",
        "production-backed-route-receipt-proof",
        "same-release-verifier-run-binding",
        "variant-5-release-verifier-carry-through-proof"
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
    "artifactHash": "sha256:8251d34cf8408b1e82cace8224d3573728a2e38463302b90abac5536e27f1d66"
  },
  "releaseVerifier": {
    "command": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "requiredByTopologyCommand": true,
    "carriedThroughByTopologyCommand": true,
    "status": "blocked",
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "verifyReleaseExitCode": 2,
    "verifyReleaseFailure": {
      "exitCode": 2,
      "reason": "DOCKER_CLI_MISSING"
    },
    "mustPassOnTopologyForReleaseReady": true,
    "noPackagedFallback": true,
    "packagedFallbackAllowed": false,
    "packagedFallbackObserved": false,
    "releaseUrlsUseDockerDns": true,
    "topologyValidationOk": true,
    "releaseCommandIsVerifyRelease": true,
    "routeMatrixProofAccepted": false,
    "liveRouteReceiptProofAccepted": false,
    "releaseMovementAllowed": false,
    "productionReadyClaim": "none",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "releaseGateTotals": {
      "gates": 21,
      "passed": 0,
      "candidate": 5,
      "missing": 16,
      "failed": 0,
      "blocking": 21
    },
    "requiredCarryThrough": [
      "npm-run-verify-release-required-by-topology-command",
      "verify-release-result-carried-through-by-topology-artifact",
      "verify-release-must-pass-on-the-topology-for-release-ready",
      "no-packaged-fallback-observed-by-release-verifier",
      "live-route-receipts-bound-to-same-release-verifier-run",
      "stale-or-split-route-receipts-rejected"
    ],
    "requiredRouteIds": [
      "preflight",
      "dry-run",
      "apply",
      "journal",
      "recovery-inspect",
      "recovery-repair"
    ],
    "primaryReleaseUrlEnvKeys": [
      "REPRINT_PUSH_SOURCE_URL",
      "REPRINT_PUSH_REMOTE_CHANGED_URL",
      "REPRINT_PUSH_LOCAL_URL"
    ],
    "supportReleaseUrlEnvKeys": [
      "REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL"
    ],
    "serviceDnsHostCount": 4,
    "runIdentity": {
      "topologyRunId": "rpp-0897-local-support-topology-run",
      "releaseVerifierRunId": "rpp-0897-local-support-topology-run",
      "artifactKind": "docker-local-production-release-gate-input",
      "artifactHash": "sha256:8251d34cf8408b1e82cace8224d3573728a2e38463302b90abac5536e27f1d66",
      "sameRunBindingRequired": true,
      "sameRunBindingObserved": false,
      "staleOrSplitEvidenceAccepted": false
    },
    "topologyBinding": {
      "required": true,
      "artifactHash": "sha256:8251d34cf8408b1e82cace8224d3573728a2e38463302b90abac5536e27f1d66",
      "topologyVariant": "RPP-0802-variant-1",
      "releaseVerifierCommand": "npm run verify:release",
      "sameRunProofRequired": true,
      "sameRunProofObserved": false
    },
    "sameRunBinding": {
      "required": true,
      "observed": false,
      "releaseReadyStatus": "required-not-observed",
      "topologyRunId": "rpp-0897-local-support-topology-run",
      "releaseVerifierRunId": "rpp-0897-local-support-topology-run",
      "liveRouteReceiptRunId": null,
      "sameReleaseVerifierRunRequired": true,
      "staleOrSplitEvidenceAccepted": false,
      "sameRunBindingHash": "sha256:540440dbf5cd91c4d666deeaf87bdf6ddd33b26b0fae019415deabae75cd2bd0"
    },
    "runHash": "sha256:d7108a0227f984a7999043b0496917fad5e430c9308d5d6c95c2135771e778b9"
  },
  "liveRouteReceipts": {
    "status": "not-observed",
    "releaseReadyStatus": "required-not-observed",
    "requiredRouteIds": [
      "preflight",
      "dry-run",
      "apply",
      "journal",
      "recovery-inspect",
      "recovery-repair"
    ],
    "observedRouteIds": [],
    "receiptCount": 0,
    "receiptHashCount": 0,
    "topologyRunId": null,
    "releaseVerifierRunId": null,
    "requiredSameReleaseVerifierRun": true,
    "rawReceiptBodiesStored": false,
    "receipts": [],
    "receiptSetHash": "sha256:f053f862f45c53968c8920d232497e73b62682224e4ce9447d44077b47112d1c"
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
    "widenedNetworkEvidenceObserved": false,
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
      "same-release-verifier-run-live-route-receipts",
      "manage-options-permission-readback-on-each-route",
      "mutation-boundary-receipts-match-route-matrix",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-live-rest-route-readback",
      "no-verify-release-pass-on-topology",
      "no-production-backed-route-receipt-artifact",
      "candidate-does-not-have-same-run-route-receipts",
      "candidate-does-not-have-release-verifier-passed-on-topology",
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
        "route-receipts-cover-all-six-production-routes",
        "route-receipts-bound-to-the-same-release-verifier-run"
      ]
    },
    "readyWhen": "verify-release-passes-on-the-topology-without-packaged-fallback-and-live-route-receipts-match-the-route-matrix-from-the-same-run"
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
    "evidenceSurfaceCount": 12,
    "rejectedSurfaceCount": 0,
    "hashedSurfaceCount": 6,
    "surfaceNames": [
      "route-matrix-contract-validated",
      "route-identity-method-permission-mutation-boundary-recorded",
      "variant-5-release-verifier-carry-through-recorded",
      "live-route-readback-required-not-claimed",
      "per-route-receipts-required-not-stored",
      "topology-binding-required-not-release-ready",
      "same-run-release-verifier-binding-required",
      "release-verifier-no-packaged-fallback-contract-recorded",
      "sandbox-8080-only-no-tunnels-policy-recorded",
      "ambiguous-production-ready-claims-rejected",
      "stale-split-evidence-rejected",
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
        "surface": "variant-5-release-verifier-carry-through-recorded",
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
        "surface": "topology-binding-required-not-release-ready",
        "ok": true,
        "count": 1
      },
      {
        "surface": "same-run-release-verifier-binding-required",
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
        "surface": "ambiguous-production-ready-claims-rejected",
        "ok": true,
        "count": 1
      },
      {
        "surface": "stale-split-evidence-rejected",
        "ok": true,
        "count": 1
      },
      {
        "surface": "final-no-go-release-block-recorded",
        "ok": true,
        "count": 1
      }
    ],
    "surfaceDigest": "sha256:f31ecdeb53b85b11874e23575c0f70f163bb39096f8efb0d60e383470c5084bf"
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
      "releaseVerifier",
      "liveRouteReceipts",
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
    "releaseVerifierCarryThroughRecorded": true,
    "releaseVerifierMustPassForReleaseReady": true,
    "sameRunRouteReceiptsRequired": true,
    "staleSplitEvidenceRejected": true,
    "ambiguousProductionReadyClaimsRejected": true,
    "packagedFallbackDisabled": true,
    "noTunnelUsage": true,
    "onlySandbox8080Ingress": true,
    "liveRouteReadbackNotClaimed": true,
    "routeReceiptBodiesNotStored": true,
    "dashboardNotUpdated": true,
    "productionBackedProofRequiredForGo": true,
    "supportOnlyNoGo": true
  },
  "scopeComparisonHash": "7c41a47b82df611d74c31e7ee9aa98273e8c54949ad33bc45b0edfc1db35cbe8",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0897-rest-route-matrix-proof-v5.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0897 test/rpp-0897-rest-route-matrix-proof-v5.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0897-rest-route-matrix-proof-v5.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check",
        "result": "exit-0"
      }
    ],
    "topologyCommandExpectedOutcome": "verify-release-pass-or-exact-unavailable-capability",
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
fail-closed policy. Variant 5 adds the release-verifier carry-through
requirement and the same-run binding requirement for route receipts.

The topology command is checked at the artifact level. In this sandbox the
Docker CLI is unavailable, so sites were not started and live REST routes were
not read. This is accepted only as fail-closed support evidence because the
exact unavailable capability is recorded and release movement remains blocked.

## Verifier Guarantees

Release-ready REST route matrix proof must show that the topology runs
`npm run verify:release`, that the verifier passes on the topology, that
packaged fallback remains disabled, and that all live route receipts come from
the same release-verifier run as the accepted topology artifact.

The local evaluator rejects missing live route receipts, missing topology
binding, packaged fallback, widened network exposure, ambiguous production-ready
claims, and stale or split evidence that does not prove the same
release-verifier run.

## Release-Ready Scope

Release-ready REST route matrix proof still requires the Docker WordPress
topology to start, `verify:release` to pass without packaged fallback, the live
REST route index to match the matrix, and route receipts for preflight, dry-run,
apply, journal, recovery inspect, and recovery repair to match the expected
permission and mutation boundaries from the same verifier run.

Packaged fallback cannot satisfy this proof.

## Redaction Posture

The evidence is hash/count/surface-only. It records command names, route names,
capability codes, route counts, policy booleans, and stable hashes. It does not
record raw route bodies, receipt bodies, credential material, private site
payloads, hostnames, private URLs, or tunnel output.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only route matrix prerequisite evidence. Do not mark
REST route matrix proof release-ready until the topology command starts the
sites, `verify:release` passes without packaged fallback, and live route
receipts match the matrix from the same verifier run.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0897-rest-route-matrix-proof-v5.test.js
node --test --test-name-pattern RPP-0897 test/rpp-0897-rest-route-matrix-proof-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0897-rest-route-matrix-proof-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0897-rest-route-matrix-proof-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0897 test/rpp-0897-rest-route-matrix-proof-v5.test.js`: exit 0
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
