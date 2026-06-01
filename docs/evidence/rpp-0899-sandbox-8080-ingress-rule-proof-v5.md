# RPP-0899 Sandbox 8080 Ingress Rule Proof Variant 5

Date: 2026-06-01
Lane: RPP-0899 sandbox 8080 ingress rule proof, variant 5
Final release posture: `NO-GO`

## Scope

RPP-0899 records support-only release-verifier carry-through evidence for the
sandbox HTTP ingress rule used by the Docker local WordPress topology. It
follows the RPP-0879 variant 4 ingress proof and the variant 5 production
topology evidence, then adds a deterministic evaluator for the same-artifact
binding that release-ready evidence must satisfy.

The success target remains release-ready only when plugin-driver evidence and
graph evidence survive a real WordPress import/export cycle while exactly one
sandbox `8080` loopback ingress is enforced. This slice does not start Docker,
run WordPress import/export, call live routes, start local servers, expose
network services, use remote tunnel services, update progress surfaces, move
release gates, or claim production-backed proof.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0899",
  "proofId": "rpp-0899-sandbox-8080-ingress-rule-proof-v5",
  "variant": 5,
  "title": "Sandbox 8080 ingress rule proof release-verifier carry-through variant 5",
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
      "docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md",
      "test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js"
    ],
    "progressSurfacesModified": false,
    "checklistFilesModified": false,
    "packageMetadataModified": false,
    "sharedReleaseCodeModified": false,
    "unrelatedTestsOrDocsModified": false,
    "networkListenersStarted": false,
    "remoteTunnelServicesUsed": false,
    "sandboxIngressPort": 8080
  },
  "builtOn": {
    "closestTemplate": {
      "rppId": "RPP-0879",
      "proofId": "rpp-0879-sandbox-8080-ingress-rule-proof-v4",
      "variant": 4,
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
      "remoteTunnelServicesAllowed": false,
      "packagedFallbackAllowed": false
    },
    "variant5ProductionTopologyPatterns": [
      "RPP-0881-three-site-local-production-topology-v5",
      "RPP-0882-docker-wordpress-topology-v5",
      "RPP-0883-external-wordpress-topology-v5",
      "RPP-0884-brewcommerce-blueprint-import-v5"
    ]
  },
  "fixtureArtifactIdentity": {
    "fixtureNamespace": "RPP-0899-variant-5",
    "artifactIdHash": "19361a983f280a41f5c6217f22d1a593b054097880b952bbadc26989462f507c",
    "pluginDriver": "reprint-push-release-state",
    "pluginOwner": "reprint-push",
    "pluginResourceKeyHash": "4ff074d340d6dc3a1326bf19cd5f95de7fdefd95e63c1a8f021f6f830dff0380",
    "graphSurfaceCount": 5,
    "graphSurfaceSetHash": "34c12d72acdaa1af3c21aa08f2c9f7563e14c5f401b6ce53ec64ccbd48e2fbf4",
    "sameArtifactBindingRequired": true
  },
  "sandboxIngressRule": {
    "status": "support-only-rule-encoded",
    "onlySandbox8080Ingress": true,
    "publishedHttpIngressCount": 1,
    "permittedHostSurface": "loopback-only",
    "permittedPort": 8080,
    "publicIngressRejected": true,
    "non8080IngressRejected": true,
    "multipleHttpIngressRejected": true,
    "releaseVerifierTraffic": "docker-service-dns-only",
    "releaseUrlsUseDockerDns": true,
    "networkInternal": true,
    "remoteTunnelEvidenceRejected": true,
    "rawUrlValuesIncluded": false
  },
  "verifierGuarantees": {
    "releaseVerifierCommand": "npm run verify:release",
    "releaseVerifierCarryThroughRequired": true,
    "sameArtifactRequired": true,
    "productionBackedImportExportRequired": true,
    "realWordPressImportExportRequired": true,
    "rejectsPublicIngress": true,
    "rejectsNon8080Ingress": true,
    "rejectsMultipleHttpIngressSurfaces": true,
    "rejectsRemoteTunnelEvidence": true,
    "rejectsPackagedFallback": true,
    "rejectsSplitEvidence": true,
    "rejectsMissingRealWordPressImportExport": true,
    "acceptedFixtureIsProductionClaim": false
  },
  "requiredSurvivalEvidence": {
    "runtimeRequired": "real-wordpress-import-export",
    "productionBackedRequired": true,
    "ingressRuleRequired": "sandbox-8080-only",
    "requiredPluginEvidence": {
      "driver": "reprint-push-release-state",
      "owner": "reprint-push",
      "resourceKind": "plugin-driver-row",
      "resourceKeyHash": "4ff074d340d6dc3a1326bf19cd5f95de7fdefd95e63c1a8f021f6f830dff0380",
      "importSurvivalRequired": true,
      "exportSurvivalRequired": true,
      "livePreconditionHashRequired": true,
      "sameArtifactBindingRequired": true
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
    "releaseVerifierSameArtifactRequired": true
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
      "remoteTunnelServicesAllowed": false,
      "packagedFallbackAllowed": false,
      "releaseVerifierCommand": "npm run verify:release",
      "onlySandbox8080Ingress": true,
      "releaseUrlsUseDockerDns": true,
      "networkInternal": true
    },
    "artifactHash": "sha256:028f9e28f68f4287203295a54086f135663f4b2fb883fa5d2bbfa0ba6a82c355"
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "productionBacked": false,
    "runtime": null,
    "importObserved": false,
    "exportObserved": false,
    "releaseVerifierCarryThroughObserved": false,
    "pluginEvidenceSurvivalObserved": false,
    "graphEvidenceSurvivalObserved": false,
    "sameArtifactPluginGraphObserved": false,
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
      "same-artifact-release-verifier-carry-through",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "graph-evidence-survives-real-wordpress-import-export",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-running-topology-ingress-readback",
      "no-real-wordpress-import-export-survival-artifact",
      "no-production-backed-import-export-survival-artifact",
      "candidate-does-not-prove-release-verifier-carry-through",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "release-gates-not-moved"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-onlySandbox8080Ingress-true-and-sameArtifactRequired-true"
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
    "surfaceCount": 13
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "rawHostValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "rawPluginValuesIncluded": false,
    "rawGraphValuesIncluded": false,
    "tunnelOutputIncluded": false,
    "scopeHashCovers": [
      "writeScope",
      "builtOn",
      "fixtureArtifactIdentity",
      "sandboxIngressRule",
      "verifierGuarantees",
      "requiredSurvivalEvidence",
      "topologyCommand",
      "productionImportExportEvidence",
      "releaseReadyScope",
      "releaseGate",
      "integrationRecommendation"
    ]
  },
  "validationCommands": [
    "node --check test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js",
    "node --test --test-name-pattern RPP-0899 test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md",
    "git diff --check"
  ],
  "scopeHash": "sha256:031844ba5b7e4d39d62ed4b256d2fe8a3aba308ec8edeff72377b98fe9f20619"
}
```

## Expected Verifier Guarantees

The focused evaluator accepts the positive branch only when a single hashed
artifact identity binds release-verifier output, import/export state,
plugin-driver survival, and every required graph surface. It rejects public
ingress, non-`8080` ingress, multiple HTTP ingress surfaces, remote tunnel
evidence, packaged fallback evidence, split plugin/graph evidence, and missing
real WordPress import/export survival.

The positive branch is a deterministic contract fixture. It is not a claim that
this sandbox produced production-backed WordPress import/export evidence.

## Redaction Posture

Evidence is hash/count/surface-only. The report stores fixture names, booleans,
counts, failure codes, and SHA-256 digests; it omits raw URL values, host
values, plugin payloads, graph payloads, credential material, route bodies, and
remote tunnel output.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js
node --test --test-name-pattern RPP-0899 test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md
git diff --check
```

Observed local results are recorded in the worker handoff after validation.

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

Keep final release blocked until production-backed import/export survival proof
exists with the sandbox `8080` ingress rule enforced and the release verifier
accepting the same artifact that carries both plugin and graph survival.
