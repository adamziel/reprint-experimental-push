# RPP-0878 TLS HTTPS source proof v4 evidence

Date: 2026-06-01
Lane: RPP-0878 TLS HTTPS source proof, variant 4
Checklist item: RPP-0878 - Add focused regression coverage for TLS/HTTPS source proof, variant 4.

## Scope

This slice adds deterministic local support evidence for the TLS/HTTPS source
URL scope. It independently captures the source, local edited, and remote
changed role surfaces, verifies that all three required role URL surfaces are
HTTPS, and records only hash/count/surface evidence.

The proof remains support-only. It does not contact WordPress hosts, open
sockets, perform a TLS handshake, capture a certificate chain, call WordPress
routes, run live import/export, or move release gates. Final release status and
integration recommendation remain **NO-GO**.

## Proof Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0878",
  "proofId": "rpp-0878-tls-https-source-proof-v4",
  "variant": 4,
  "title": "TLS HTTPS source proof support scope",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "topologyContract": {
      "rppId": "RPP-0803",
      "variant": "RPP-0803-variant-1",
      "sourceLocalChangedUrlCapture": true,
      "staticIdentityChecks": true,
      "tunnelAndSecretUrlRejection": true
    },
    "urlIdentityPattern": {
      "rppId": "RPP-0808",
      "variant": 1,
      "roleIdentities": [
        "source",
        "local-edited",
        "remote-changed"
      ],
      "identityHashOnly": true,
      "sameSourceAcrossRoutesRequired": true
    },
    "patternOnlyReference": {
      "rppId": "RPP-0858",
      "variant": 3,
      "reusesProofArtifact": false,
      "independentVariant": true
    }
  },
  "tlsHttpsSourceScope": {
    "status": "support-only-static-https-url-source-proof",
    "sourceLocalChangedHttpsUrlsCaptured": true,
    "roleSurfaces": [
      "source",
      "local-edited",
      "remote-changed"
    ],
    "capturedRoleUrlCount": 3,
    "validRoleUrlCount": 3,
    "httpsRoleUrlCount": 3,
    "identityHashCount": 3,
    "roleIdentityHashes": {
      "source": "9911c6a29400f5c68ff949a76013ad49d264164d3f5d1f9a5899f232f11a184e",
      "localEdited": "8e3a6de931e9eb4e6c3ea30e6275bc6cff7532b655fd74725367775d44cb4ae4",
      "remoteChanged": "9c007a56364b26623ce70082550e61f25c04475f179deee81c3667727b5e9c64"
    },
    "roleIdentitiesDistinct": true,
    "sourceAliasMatchesSource": true,
    "sameSourceAcrossRoutes": true,
    "identityChecked": true,
    "allRequiredRoleUrlsHttps": true,
    "noTunnelPolicyEnforced": true,
    "noSecretShapedUrlParts": true,
    "secretShapedUrlPartFailureCount": 0,
    "packagedFallbackDisabled": true,
    "networkProbePerformed": false,
    "tlsHandshakePerformed": false,
    "certificateChainCaptured": false,
    "wordpressRouteCallsPerformed": false,
    "liveImportExportPerformed": false,
    "releaseMovement": "none"
  },
  "negativeControls": {
    "tunnelUrlRejected": true,
    "secretShapedUrlRejected": true,
    "secretShapedPathPartRejected": true,
    "httpRoleUrlRejectedBeforeTlsScopeAccepted": true,
    "duplicateRoleUrlRejected": true,
    "packagedFallbackRejected": true,
    "rawRejectedInputsStored": false
  },
  "releaseScope": {
    "finalReleaseStatus": "NO-GO",
    "releaseGateMovement": "none",
    "readyForReleaseMovement": false,
    "blockers": [
      "support-only-static-url-proof",
      "no-production-backed-wordpress-reachability",
      "no-live-tls-handshake-or-certificate-chain-proof",
      "no-route-receipts-or-mutation-receipts"
    ]
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "rawHostValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "routeSourceRawValuesIncluded": false,
    "rejectedInputValuesIncluded": false,
    "secretShapedPartValuesIncluded": false
  },
  "scopeEvidenceHash": "f5845afb5ce57568f1fa8616e7987fe2961005de82ed5b0d642c24634eac92e9"
}
```

## Variant 4 Checks

The focused test asserts:

- source, local edited, and remote changed role URL surfaces are captured;
- all three required role URL surfaces use the HTTPS scheme;
- the three role identities are distinct and stored as identity hashes only;
- source aliases and per-route source identities match the source role;
- known remote tunnel URL inputs fail closed before scope acceptance;
- URL userinfo, query string, fragment, and secret-shaped path inputs fail
  closed before scope acceptance;
- duplicate source/local/changed role identities fail closed before scope
  acceptance;
- packaged fallback evidence is rejected for this scope;
- raw rejected inputs, credentials, hostnames, and URL values are not retained;
- TLS handshake, certificate-chain capture, WordPress route calls, and live
  import/export are out of scope for this local support proof; and
- release movement remains **NO-GO**.

## Redaction Posture

The public artifact stores role names, counts, boolean gate state, identity
hashes, and the scope evidence hash. It does not store raw URLs, hostnames,
credential material, route source values, rejected input values, query strings,
userinfo, tunnel domains, cookies, application password values, or production
service configuration.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0878-tls-https-source-proof-v4.test.js
node --test --test-name-pattern RPP-0878 test/rpp-0878-tls-https-source-proof-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0878-tls-https-source-proof-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0878-tls-https-source-proof-v4.test.js`: exit 0
- `node --test --test-name-pattern RPP-0878 test/rpp-0878-tls-https-source-proof-v4.test.js`: exit 0, 6 tests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0878-tls-https-source-proof-v4.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0878 TLS/HTTPS source
URL scope only. Production-backed WordPress reachability, live TLS handshake or
certificate-chain proof, route receipts, durable journal behavior, and live
mutation receipts remain required before promotion.
