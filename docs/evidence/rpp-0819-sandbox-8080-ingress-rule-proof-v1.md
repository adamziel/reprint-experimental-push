# RPP-0819 Sandbox 8080 Ingress Rule Proof Variant 1

Date: 2026-06-01

## Scope

RPP-0819 records support-only evidence for the sandbox HTTP ingress rule used
by the Docker local WordPress topology. The rule is intentionally narrow: the
candidate topology exposes exactly one loopback HTTP ingress on port `8080` for
inspection while verifier traffic stays on Docker service DNS inside the
private network.

The release-ready target is stricter than this support proof. Plugin-driver
evidence and graph evidence must survive a real WordPress import/export cycle
while the sandbox `8080` ingress rule is enforced by a running topology. This
artifact does not start Docker, run WordPress import/export, call live routes,
start or use remote tunnel tooling, store raw URLs, or move release gates.
Final release remains **NO-GO** without production-backed proof.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0819",
  "proofId": "rpp-0819-sandbox-8080-ingress-rule-proof-v1",
  "variant": 1,
  "title": "Sandbox 8080 ingress rule proof support scope",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export-while-sandbox-8080-ingress-enforced",
  "builtOn": {
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
    "importExportSurvivalContract": {
      "rppId": "RPP-0804",
      "variant": 1,
      "requiresRealWordPressImportExport": true,
      "requiresPluginAndGraphSurvival": true,
      "enforcedIngressRule": "sandbox-8080-only"
    },
    "adjacentPatterns": [
      "RPP-0814-large-media-library-topology-v1",
      "RPP-0880-no-tunnel-policy-proof-v4"
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
    "ingressRejectionCodes": [
      "MULTIPLE_PUBLISHED_HTTP_PORTS",
      "NON_LOCAL_OR_NON_8080_PORT"
    ],
    "rawUrlValuesIncluded": false
  },
  "candidateScope": {
    "status": "sandbox-8080-ingress-rule-candidate",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "docker-local-production-topology-plus-import-export-survival-contract",
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
      "ingressRuleRequired": "sandbox-8080-only",
      "requiredPluginEvidence": {
        "driver": "reprint-push-release-state",
        "owner": "reprint-push",
        "resourceKind": "plugin-driver-row",
        "resourceKeyHash": "abd52a607dbcdbda5bfada1e8ea54a6a919555e790fc5a4b068dfb7dea0b10a0",
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
      "topology-command-exact-unavailable-capability-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "real-wordpress-import-export-run",
      "docker-wordpress-sites-started",
      "plugin-driver-evidence-import-export-readback",
      "graph-evidence-import-export-readback",
      "sandbox-8080-ingress-readback-from-running-topology",
      "release-verifier-accepted-ingress-proof"
    ]
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "status": "blocked",
    "siteStartupStatus": "not-started",
    "sitesStarted": false,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "probeCommand": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "docker-wordpress-topology-start",
        "sandbox-8080-ingress-readback",
        "real-wordpress-import-export-cycle",
        "plugin-evidence-import-export-readback",
        "graph-evidence-import-export-readback"
      ]
    },
    "runtime": "docker-local-wordpress",
    "topologyVariant": "RPP-0802-variant-1",
    "siteRoleCount": 4,
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
    "artifactHash": "sha256:0906a5f3418a1aede9fa66f216468756b69491635e50241fd8d269df75f58381"
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
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
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "graph-evidence-survives-real-wordpress-import-export",
      "release-verifier-accepts-run-without-packaged-fallback",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-running-topology-ingress-readback",
      "no-real-wordpress-import-export-survival-artifact",
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
    "surfaceCount": 9
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
      "sandboxIngressRule",
      "candidateScope",
      "topologyCommand",
      "productionImportExportEvidence",
      "releaseReadyScope",
      "releaseGate",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "ce34cc02f063c3e2789f7b19c113f364da1d0153cdd11f773632781077cb095d"
}
```

## Candidate Scope

The candidate records the topology rule, ingress rejection policy, and
import/export survival contract as names, counts, booleans, and hashes only. It
does not prove that a running WordPress import/export cycle occurred under the
`8080` ingress rule.

The sandbox capability observation is fail-closed: Docker is unavailable here,
so the topology command is represented as an exact unavailable capability and
the report remains support-only.

## Release-Ready Scope

Release-ready RPP-0819 evidence still requires a Docker-capable or equivalent
complete WordPress topology to start, expose only the sandbox `8080` loopback
inspection ingress, run real WordPress import/export, and prove by hash-only
readbacks that plugin-driver evidence and graph evidence survived both import
and export. The release verifier must accept that run without packaged
fallback.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only ingress-policy evidence. Do not move final release
readiness until production-backed import/export survival proof exists with the
sandbox `8080` ingress rule enforced.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0819-sandbox-8080-ingress-rule-proof-v1.test.js
node --test --test-name-pattern RPP-0819 test/rpp-0819-sandbox-8080-ingress-rule-proof-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0819-sandbox-8080-ingress-rule-proof-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0819-sandbox-8080-ingress-rule-proof-v1.test.js`: exit 0
- `node --test --test-name-pattern RPP-0819 test/rpp-0819-sandbox-8080-ingress-rule-proof-v1.test.js`: exit 0
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
