# RPP-0859 Sandbox 8080 Ingress Rule Proof Variant 3

Date: 2026-06-01
Lane: RPP-0859 sandbox 8080 ingress rule proof, variant 3
Final release posture: `NO-GO`

## Scope

RPP-0859 records generated support-only evidence for the sandbox HTTP ingress
rule used by the Docker local WordPress topology. It uses RPP-0839 variant 2
as the closest template, but this variant 3 report has its own deterministic
fixture namespace, plugin evidence hash, hashes, and checked evidence surface.

The success target remains release-ready only when plugin-driver evidence and
graph evidence survive a real WordPress import/export cycle while exactly one
sandbox `8080` loopback ingress is enforced. This slice does not start Docker,
run WordPress import/export, call live routes, start local servers, expose
network services, use remote tunnel tooling, update progress surfaces, move
release gates, or claim production-backed proof.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0859",
  "proofId": "rpp-0859-sandbox-8080-ingress-rule-proof-v3",
  "variant": 3,
  "title": "Sandbox 8080 ingress rule proof support scope variant 3",
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
      "docs/evidence/rpp-0859-sandbox-8080-ingress-rule-proof-v3.md",
      "test/rpp-0859-sandbox-8080-ingress-rule-proof-v3.test.js"
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
    "closestTemplate": {
      "rppId": "RPP-0839",
      "proofId": "rpp-0839-sandbox-8080-ingress-rule-proof-v2",
      "variant": 2,
      "usedAsTemplateOnly": true
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
      "RPP-0842-docker-wordpress-topology-v3",
      "RPP-0843-external-wordpress-topology-v3",
      "RPP-0861-three-site-local-production-topology-v4"
    ]
  },
  "variant3Distinctives": {
    "closestTemplate": "RPP-0839 variant 2",
    "generatedCoverageVariant": 3,
    "deterministicFixtureNamespace": "RPP-0859-variant-3",
    "supportOnlyUnlessRealTopologyAvailable": true,
    "successCriterionEncodedAsReleaseReadyContract": true,
    "pluginAndGraphSurvivalClaimObserved": false,
    "productionImportExportRequiredForSuccess": true
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
    "status": "sandbox-8080-ingress-rule-candidate-v3",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0839-variant-2-template-plus-rpp-0859-variant-3-generated-contract",
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
        "resourceKeyHash": "82a7f0540198fe8bb3b2916b28b5447dfc2d688bddd02601e1d58cb75d8cbfd3",
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
      "variant-3-plugin-and-graph-survival-contract-defined",
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
    "artifactHash": "sha256:c7b664b1799864d3d4ab7802ae73fadabcf59b4edd76a5db3ea2eaea6c979ca9"
  },
  "productionArtifactAudit": {
    "status": "no-accepted-production-backed-rpp0859-artifact-found",
    "acceptedProductionBackedArtifactPresent": false,
    "repositoryRpp0859ProductionArtifactPresent": false,
    "actualProductionImportExportReadbackPresent": false,
    "claimAllowed": false,
    "checkedEvidencePatterns": [
      "rpp-0839-sandbox-8080-ingress-rule-proof-v2",
      "rpp-0842-docker-wordpress-topology-v3",
      "rpp-0843-external-wordpress-topology-v3",
      "rpp-0860-no-tunnel-policy-proof-v3"
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
    "surfaceCount": 11
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
      "variant3Distinctives",
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
  "scopeComparisonHash": "sha256:081a158b9150249fa2dc2f347202708132f5b038e557ace130e77a8484ac9956",
  "proofHash": "sha256:58823ba16c9f8f24abe373384ca72ec59164229133a65de1d6bedd2a2fa885eb"
}
```

## Candidate Scope

The candidate records the sandbox ingress rule, ingress rejection policy,
production artifact requirement, and import/export survival contract as names,
counts, booleans, and hashes only. It does not prove that a running WordPress
import/export cycle occurred under the `8080` ingress rule.

The local capability observation is fail-closed: Docker is represented as
`DOCKER_CLI_MISSING`, so the topology command remains blocked and the evidence
is support-only.

## Release-Ready Scope

Release-ready RPP-0859 evidence still requires a Docker-capable or equivalent
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
node --check test/rpp-0859-sandbox-8080-ingress-rule-proof-v3.test.js
node --test --test-name-pattern RPP-0859 test/rpp-0859-sandbox-8080-ingress-rule-proof-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0859-sandbox-8080-ingress-rule-proof-v3.md
git diff --check
```

Observed local results are recorded in the worker handoff after validation.

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

Record this as support-only ingress-policy evidence. Keep final release blocked
until production-backed import/export survival proof exists with the sandbox
`8080` ingress rule enforced.
