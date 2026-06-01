# RPP-0839 Sandbox 8080 Ingress Rule Proof Variant 2

Date: 2026-06-01
Lane: RPP-0839 sandbox 8080 ingress rule proof, variant 2
Final release posture: `NO-GO`

## Scope

RPP-0839 records support-only evidence for the sandbox HTTP ingress rule used
by the Docker local WordPress topology. It follows the RPP-0819 variant 1
pattern and the current production-topology evidence files while keeping the
release-ready target explicit: plugin-driver evidence and graph evidence must
survive a real WordPress import/export cycle while exactly one sandbox `8080`
loopback ingress is enforced.

This slice does not start Docker, run WordPress import/export, call live
routes, start local servers, expose network services, use remote tunnel
tooling, update progress surfaces, move release gates, or claim
production-backed proof. Docker CLI is unavailable in this sandbox, so the
topology proof fails closed with an exact unavailable capability.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0839",
  "proofId": "rpp-0839-sandbox-8080-ingress-rule-proof-v2",
  "variant": 2,
  "title": "Sandbox 8080 ingress rule proof support scope variant 2",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export-while-sandbox-8080-ingress-enforced",
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0839-sandbox-8080-ingress-rule-proof-v2.md",
      "test/rpp-0839-sandbox-8080-ingress-rule-proof-v2.test.js"
    ],
    "progressSurfacesModified": false,
    "releaseGateFilesModified": false,
    "packageMetadataModified": false,
    "sharedScriptsModified": false,
    "outsideScopeFilesModified": false,
    "networkListenersStarted": false,
    "remoteTunnelsStarted": false,
    "sandboxIngressPort": 8080
  },
  "builtOn": {
    "rpp0819Pattern": {
      "rppId": "RPP-0819",
      "proofId": "rpp-0819-sandbox-8080-ingress-rule-proof-v1",
      "variant": 1,
      "contractInherited": true
    },
    "dockerTopology": {
      "rppId": "RPP-0802",
      "topologyVariant": "RPP-0802-variant-1",
      "command": "npm run verify:release:docker-local-production",
      "releaseVerifierCommand": "npm run verify:release",
      "siteRoleCount": 4,
      "publishedIngressPort": 8080,
      "publishedIngressHost": "loopback-only",
      "releaseVerifierTraffic": "docker-service-dns-only",
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    },
    "currentProductionTopologyEvidence": [
      "RPP-0822-docker-wordpress-topology-v2",
      "RPP-0841-three-site-local-production-topology-v3",
      "RPP-0883-external-wordpress-topology-v5"
    ]
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "sandboxIngressRule": {
    "status": "support-only-rule-encoded",
    "onlySandbox8080Ingress": true,
    "publishedHttpIngressCount": 1,
    "permittedHostSurface": "loopback-only",
    "permittedPort": 8080,
    "localhostAliasAccepted": true,
    "publicHostRejected": true,
    "non8080PortRejected": true,
    "multiplePublishedPortsRejected": true,
    "releaseVerifierTraffic": "docker-service-dns-only",
    "releaseUrlsUseDockerDns": true,
    "networkInternal": true,
    "remoteTunnelsAllowed": false,
    "ingressRejectionCodes": [
      "MULTIPLE_PUBLISHED_HTTP_PORTS",
      "NON_LOCAL_OR_NON_8080_PORT"
    ],
    "rawUrlValuesIncluded": false
  },
  "candidateScope": {
    "status": "sandbox-8080-ingress-rule-candidate-v2",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0819-ingress-policy-plus-current-docker-production-topology",
    "topologyShape": {
      "runtime": "docker-local-wordpress",
      "topologyVariant": "RPP-0802-variant-1",
      "siteRoleCount": 4,
      "publishedIngressPort": 8080,
      "publishedIngressHostSurface": "loopback-only",
      "publishedIngressCount": 1,
      "onlySandbox8080Ingress": true,
      "releaseUrlsUseDockerDns": true,
      "networkInternal": true,
      "noTunnelPolicyEnforced": true,
      "packagedFallbackDisabled": true,
      "graphProofFlags": {
        "featuredImageGraph": true,
        "taxonomyGraph": true,
        "postTagTaxonomyGraph": true,
        "postParentGraph": true,
        "commentGraph": true
      },
      "realImportExportObserved": false
    },
    "importExportSurvivalSurface": {
      "runtimeRequired": "real-wordpress-import-export",
      "productionBackedRequired": true,
      "ingressRuleRequired": "sandbox-8080-only",
      "requiredPluginEvidence": {
        "driver": "reprint-push-release-state",
        "owner": "reprint-push",
        "resourceKind": "plugin-driver-row",
        "resourceKeyHash": "7c91f6e3f9d32ed34117b4fd791ae3d93cadb0f071aa10ea47bcf9b07614321c",
        "importSurvivalRequired": true,
        "exportSurvivalRequired": true,
        "livePreconditionHashRequired": true
      },
      "requiredGraphTypes": [
        "featured-image-attachment",
        "category-term-relationship-termmeta",
        "post-tag-taxonomy-relationship",
        "post-parent-page-closure",
        "comment-parent-commentmeta"
      ],
      "requiredGraphSurvival": [
        "survived-import",
        "survived-export",
        "round-trip-hash"
      ],
      "pluginEvidenceSurvivedImportExport": false,
      "graphEvidenceSurvivedImportExport": false,
      "ingressRuleObservedDuringImportExport": false
    },
    "candidateClaims": [
      "sandbox-8080-ingress-rule-encoded",
      "public-and-non-8080-ingress-fail-closed",
      "plugin-and-graph-import-export-success-contract-defined",
      "production-backed-artifact-requirement-recorded",
      "topology-command-exact-unavailable-capability-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "real-wordpress-import-export-run",
      "docker-wordpress-sites-started",
      "plugin-driver-evidence-import-export-readback",
      "graph-evidence-import-export-readback",
      "sandbox-8080-ingress-readback-from-running-topology",
      "production-backed-release-artifact",
      "release-verifier-accepted-ingress-proof"
    ]
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "status": "blocked",
    "exitCode": 2,
    "siteStartupStatus": "not-started",
    "sitesStarted": false,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "probeCommand": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "docker-wordpress-topology-start",
        "sandbox-8080-ingress-readback",
        "real-wordpress-import-export-cycle",
        "plugin-evidence-import-export-readback",
        "graph-evidence-import-export-readback",
        "release-verifier-acceptance-without-packaged-fallback"
      ]
    },
    "runtime": "docker-local-wordpress",
    "topologyVariant": "RPP-0802-variant-1",
    "publishedIngress": {
      "hostSurface": "loopback-only",
      "port": 8080,
      "publishedPortCount": 1
    },
    "policy": {
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false,
      "releaseVerifierCommand": "npm run verify:release",
      "onlySandbox8080Ingress": true,
      "releaseUrlsUseDockerDns": true,
      "networkInternal": true
    },
    "artifactHash": "sha256:f754266d0ef4c8ae95858e853cafd8422ad3359f378d31d94fb190a272df0811"
  },
  "productionArtifactAudit": {
    "status": "no-accepted-production-backed-rpp0839-artifact-found",
    "acceptedProductionBackedArtifactPresent": false,
    "repositoryRpp0839ProductionArtifactPresent": false,
    "actualProductionImportExportReadbackPresent": false,
    "claimAllowed": false,
    "checkedEvidencePatterns": [
      "rpp-0819-sandbox-8080-ingress-rule-proof-v1",
      "rpp-0822-docker-wordpress-topology-v2",
      "rpp-0824-brewcommerce-blueprint-import-v2",
      "rpp-0880-no-tunnel-policy-proof-v4"
    ],
    "primaryGapCode": "PRODUCTION_BACKED_IMPORT_EXPORT_ARTIFACT_MISSING"
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "productionBacked": false,
    "runtime": null,
    "importObserved": false,
    "exportObserved": false,
    "pluginEvidenceSurvivalObserved": false,
    "graphEvidenceSurvivalObserved": false,
    "ingressRuleObservedDuringImportExport": false,
    "blockedReasonCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactUnavailableCapability": "DOCKER_CLI_MISSING"
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "sandbox-8080-ingress-readback-from-running-topology",
      "real-wordpress-import-observed",
      "wordpress-export-after-import-observed",
      "production-backed-import-export-survival-artifact",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "graph-evidence-survives-real-wordpress-import-export",
      "release-verifier-accepts-run-without-packaged-fallback",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-running-topology-ingress-readback",
      "no-real-wordpress-import-export-survival-artifact",
      "no-production-backed-import-export-survival-artifact",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "release-gates-not-moved"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-onlySandbox8080Ingress-true"
  },
  "releaseGate": {
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "releaseGatesMoved": false,
    "finalReleaseStatus": "NO-GO",
    "integrationRecommendation": "NO-GO"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "payloadsStored": false,
    "rawPayloadCount": 0,
    "rawUrlPayloadsIncluded": false,
    "rawHostPayloadsIncluded": false,
    "rawPluginPayloadsIncluded": false,
    "rawGraphPayloadsIncluded": false,
    "credentialMaterialIncluded": false,
    "tunnelOutputIncluded": false,
    "liveNetworkProbeCount": 0,
    "wordpressRouteBodyCount": 0,
    "surfaceCount": 10
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "rawHostValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "rawPluginValuesIncluded": false,
    "rawGraphValuesIncluded": false,
    "tunnelOutputIncluded": false,
    "scopeComparisonHashCovers": [
      "writeScope",
      "builtOn",
      "sandboxIngressRule",
      "candidateScope",
      "topologyCommand",
      "productionArtifactAudit",
      "productionImportExportEvidence",
      "releaseReadyScope",
      "releaseGate",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "sha256:1f4f885a419958c66cd57e8ee0834500bb8c04fea7f8c013a36d907e4e873749",
  "proofHash": "sha256:6c9c3a8b6548c920d04d22ad331d223bfb0e0ae6b53da70e04b8ee3424d761de"
}
```

## Candidate Scope

The candidate records the topology rule, ingress rejection policy, production
artifact requirement, and import/export survival contract as names, counts,
booleans, and hashes only. It does not prove that a running WordPress
import/export cycle occurred under the `8080` ingress rule.

The sandbox capability observation is fail-closed: `docker --version` is not
available here, so the topology command is represented as
`DOCKER_CLI_MISSING` and the report remains support-only.

## Release-Ready Scope

Release-ready RPP-0839 evidence still requires a Docker-capable or equivalent
complete WordPress topology to start, expose only the sandbox `8080` loopback
inspection ingress, run real WordPress import/export, and prove by hash-only
readbacks that plugin-driver evidence and graph evidence survived both import
and export. The proof must be production-backed and accepted by the release
verifier without packaged fallback.

The positive branch is a deterministic contract fixture in the focused test,
not a claim that this sandbox produced real WordPress import/export evidence.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0839-sandbox-8080-ingress-rule-proof-v2.test.js
node --test --test-name-pattern RPP-0839 test/rpp-0839-sandbox-8080-ingress-rule-proof-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0839-sandbox-8080-ingress-rule-proof-v2.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local results are recorded in the worker handoff after validation.

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

Record this as support-only ingress-policy evidence. Keep final release blocked
until production-backed import/export survival proof exists with the sandbox
`8080` ingress rule enforced.
