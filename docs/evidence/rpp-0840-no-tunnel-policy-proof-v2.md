# RPP-0840 No Tunnel Policy Proof Variant 2

Date: 2026-06-01

## Scope

RPP-0840 records deterministic local support-only evidence for the remote-tunnel
prohibition. It follows the RPP-0820 no-tunnel policy pattern by validating only
in-memory Docker topology plans and storing hash, count, and surface summaries.

This artifact does not update checklist, progress-page, or release-gate
surfaces. It does not start tunnels, install or invoke tunnel tools, expose the
local network, perform live network probes, call WordPress routes, or move
release gates.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0840",
  "proofId": "rpp-0840-no-tunnel-policy-proof-v2",
  "variant": 2,
  "title": "No tunnel policy proof candidate scope variant 2",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "candidateScope": {
    "status": "no-tunnel-policy-candidate-v2",
    "sourcePattern": "RPP-0820-no-tunnel-policy-pattern",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "productionMovementRecorded": false,
    "candidateClaims": [
      "topology-policy-surface-recorded",
      "known-tunnel-command-surfaces-rejected",
      "known-tunnel-domain-surfaces-rejected",
      "sandbox-8080-ingress-only",
      "packaged-fallback-disabled",
      "release-ready-gaps-recorded"
    ],
    "excludedFromCandidate": [
      "live-tunnel-process-scan",
      "live-public-callback-url-observation",
      "docker-backed-release-verifier-pass",
      "release-gate-acceptance",
      "production-readback-of-running-topology"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "productionMovement": {
      "candidatePercentMovement": "none",
      "releaseReadyPercentMovement": "none",
      "finalReleaseReadinessMovement": "none"
    },
    "requiredEvidence": [
      "docker-capable-topology-started",
      "verify-release-passes-without-packaged-fallback",
      "release-gate-artifact-accepted",
      "production-backed-local-only-topology-readback",
      "integration-run-confirms-no-public-tunnel-process-or-url"
    ],
    "blockers": [
      "support-only-local-policy-evidence",
      "no-docker-backed-topology-started-in-this-proof",
      "no-live-network-probes-or-wordpress-route-calls",
      "release-gates-not-moved"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "noTunnelPolicy": {
    "sourcePattern": "RPP-0820-no-tunnel-policy-pattern",
    "topologyVariant": "RPP-0802-variant-1",
    "knownForbiddenSurfaceCount": 8,
    "knownForbiddenSurfaceHash": "sha256:35fbab8a391739392121c8494d674f6021da1041f354950c273c524f04737c5e",
    "commandSurfaceCount": 8,
    "commandSurfaceRejectionCount": 8,
    "domainSurfaceCount": 7,
    "domainSurfaceRejectionCount": 7,
    "rejectionCode": "FORBIDDEN_TUNNEL_REFERENCE",
    "tunnelToolsInstalledOrInvoked": false,
    "tunnelProcessesStarted": false,
    "liveNetworkProbes": false
  },
  "localSandboxIngress": {
    "onlySandbox8080Ingress": true,
    "publishedHttpIngressCount": 1,
    "permittedHost": "127.0.0.1",
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
    ]
  },
  "packagedFallback": {
    "disabled": true,
    "runnerPackagedFallbackAllowed": false,
    "releaseCommand": "npm run verify:release",
    "fallbackFlagRejected": true,
    "fallbackEnvRejectedCount": 3,
    "fallbackRejectionCodes": [
      "DOCKER_PACKAGED_FALLBACK_ENV_ENABLED",
      "DOCKER_PACKAGED_FALLBACK_NOT_DISABLED"
    ]
  },
  "releaseGate": {
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "releaseGatesMoved": false,
    "finalReleaseStatus": "NO-GO",
    "integrationRecommendation": "NO-GO"
  },
  "policySurfaces": {
    "format": "surface-count-hash-only",
    "rawCommandPayloadsIncluded": false,
    "rawUrlPayloadsIncluded": false,
    "acceptedSurfaceCount": 3,
    "rejectedSurfaceCount": 22,
    "surfaceCount": 10,
    "knownForbiddenSurfaceCount": 8,
    "commandSurfaceCount": 8,
    "domainSurfaceCount": 7,
    "ingressRejectedSurfaceCount": 3,
    "packagedFallbackRejectedSurfaceCount": 4,
    "rejectionCodeCount": 5,
    "rejectionCodes": [
      "DOCKER_PACKAGED_FALLBACK_ENV_ENABLED",
      "DOCKER_PACKAGED_FALLBACK_NOT_DISABLED",
      "FORBIDDEN_TUNNEL_REFERENCE",
      "MULTIPLE_PUBLISHED_HTTP_PORTS",
      "NON_LOCAL_OR_NON_8080_PORT"
    ],
    "surfaceNames": [
      "base-topology-allows-sandbox-8080",
      "localhost-alias-allows-sandbox-8080",
      "non-local-ingress-rejected",
      "non-8080-ingress-rejected",
      "multiple-http-ingress-rejected",
      "known-tunnel-command-surfaces-rejected",
      "known-tunnel-domain-surfaces-rejected",
      "packaged-fallback-plan-flag-rejected",
      "packaged-fallback-env-flags-rejected",
      "release-verifier-stays-on-npm-run-verify-release"
    ],
    "surfaceHash": "sha256:cec56a28ebee7c7e44c947f1756db50aadccaca5394fea276e8b92995566eb80"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "payloadsStored": false,
    "rawPayloadCount": 0,
    "rawCommandPayloadsIncluded": false,
    "rawUrlPayloadsIncluded": false,
    "sensitiveSurfaceCount": 0,
    "tunnelToolInvocationCount": 0,
    "liveNetworkProbeCount": 0,
    "wordpressRouteCallCount": 0,
    "surfaceCount": 10,
    "acceptedSurfaceCount": 3,
    "rejectedSurfaceCount": 22,
    "surfaceHash": "sha256:cec56a28ebee7c7e44c947f1756db50aadccaca5394fea276e8b92995566eb80"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawTunnelCommandsIncluded": false,
    "rawTunnelDomainsIncluded": false,
    "rawUrlsIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "noTunnelPolicy",
      "localSandboxIngress",
      "packagedFallback",
      "policySurfaces",
      "releaseGate",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "sha256:aece7d854dd267cca188f3633316a91a94d57ee506e4995864a432d721ed2e85",
  "proofHash": "sha256:f462b1c2714cb05cbacf39753dfbaaecbc62eda8d52ba16d01ad5811d1186d2f"
}
```

## Candidate Scope

Candidate evidence proves the local planner rejects the prohibited tunnel
command and domain surfaces, accepts only sandbox ingress semantics on
`127.0.0.1:8080` or the localhost alias, and keeps packaged fallback disabled.
The report stores only counts, rejection codes, surface names, and hashes.

## Release-Ready Scope

Release-ready evidence still requires a Docker-capable run that starts the
topology, carries `npm run verify:release` without packaged fallback, emits an
accepted release-gate artifact, and confirms the running topology remains
local-only. Until that exists, final release status and integration
recommendation remain **NO-GO**.

## Validation

Required validation commands before commit:

```sh
node --check test/rpp-0840-no-tunnel-policy-proof-v2.test.js
node --test --test-name-pattern RPP-0840 test/rpp-0840-no-tunnel-policy-proof-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0840-no-tunnel-policy-proof-v2.md
git diff --check
```

Observed local results:

- syntax check: exit `0`
- focused RPP-0840 test: exit `0`, `5` tests passed
- redaction scan: exit `0`, no rejected files
- diff whitespace check: exit `0`

## Recommendation

Integration recommendation: **NO-GO** for release movement.
