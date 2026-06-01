import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectExternalWordPressTopologyProof } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';
import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0834-large-media-library-topology-v2.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const variant = 'RPP-0834-variant-2';
const proofId = 'rpp-0834-large-media-library-topology-v2';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0834',
  resource: 'reprint-push-release-state-row',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const requiredGraphTypes = Object.freeze([
  'featured-image-attachment',
  'attachment-postmeta-round-trip',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
]);
const requiredMediaSurfaces = Object.freeze([
  'wp_posts:attachment',
  'wp_postmeta:attachment-metadata',
  'uploads-file-hash-manifest',
  'large-media-fast-path-lane',
]);
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-large-media-topology-start',
  'real-wordpress-large-media-import-export',
  'plugin-evidence-import-export-readback',
  'graph-evidence-import-export-readback',
]);
const staticTopologyEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/large-media-topology-v2',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/large-media-topology-v2/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/large-media-topology-v2',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/large-media-topology-v2',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/large-media-topology-v2/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/large-media-topology-v2',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/large-media-topology-v2',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/large-media-topology-v2',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/large-media-topology-v2',
});
const forbiddenNeedles = Object.freeze([
  'source.example.test',
  'local.example.test',
  'changed.example.test',
  'large-media-topology-v2',
  'rpp-0834-secret',
  'ngrok-free.app',
]);

test('RPP-0834 support report records fail-closed large media topology variant 2 scope', () => {
  const { report, text } = loadSupportReport();
  const externalTopology = buildExternalTopologyVariant2SupportSummary();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0834');
  assert.equal(report.variant, 2);
  assert.equal(report.title, 'Large media library topology variant 2 support scope');
  assert.equal(report.status, 'blocked-support-only');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(
    report.successTarget,
    'plugin-and-graph-evidence-survive-real-wordpress-import-export',
  );

  assert.equal(report.builtOn.largeMediaTopologyVariant1.rppId, 'RPP-0814');
  assert.equal(report.builtOn.largeMediaTopologyVariant1.variant, 1);
  assert.equal(report.builtOn.mediaBenchmark.rppId, 'RPP-0715');
  assert.equal(report.builtOn.mediaBenchmark.mediaDriver, 'benchmark-media-library-file');
  assert.equal(report.builtOn.mediaBenchmark.fastPathLane, 'large-media-library-fast-path');
  assert.equal(report.builtOn.externalTopologyVariant2.rppId, 'RPP-0823');
  assert.equal(report.builtOn.externalTopologyVariant2.variant, 2);
  assert.equal(report.builtOn.externalTopologyVariant2.sourceLocalChangedUrlCapture, true);
  assert.equal(report.builtOn.externalTopologyVariant2.roleIdentityHashOnly, true);
  assert.deepEqual(report.builtOn.externalTopologyVariant2.routeSourceIdentityChecks, [...routeOrder]);
  assert.equal(report.builtOn.externalTopologyVariant2.networkProbePerformed, false);
  assert.equal(report.builtOn.dockerTopology.rppId, 'RPP-0802');
  assert.equal(report.builtOn.dockerTopology.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.dockerTopology.publishedIngressPort, 8080);
  assert.equal(report.builtOn.dockerTopology.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.dockerTopology.packagedFallbackAllowed, false);

  assert.equal(report.supportReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.supportReport.variantFocus, 'large-media-real-wordpress-import-export-survival-contract');
  assert.equal(report.supportReport.candidateLabel, 'support-candidate');
  assert.equal(report.supportReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.supportReport.percentMovement, 'none');
  assert.equal(report.supportReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  const shape = report.candidateScope.mediaTopologyShape;
  assert.equal(report.candidateScope.status, 'large-media-library-topology-v2-support-candidate');
  assert.equal(report.candidateScope.failClosed, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(shape.mediaSurface, 'large-media-library');
  assert.equal(shape.topologyVariant, 'external-wordpress-topology-v2');
  assert.equal(shape.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(shape.roleIdentityHashesOnly, true);
  assert.deepEqual(shape.roleIdentityHashes, externalTopology.roleIdentityHashes);
  assert.equal(shape.roleIdentitiesDistinct, true);
  assert.equal(shape.sourceAliasAndRouteSourceIdentitiesMatch, true);
  assert.equal(shape.routeSourceIdentityCheckCount, routeOrder.length);
  assert.equal(shape.identitySurfaceCount, 9);
  assert.deepEqual(shape.identitySurfaceNames, externalTopology.identitySurfaceNames);
  assert.equal(shape.externalTopologyV2ScopeHash, externalTopology.scopeHash);
  assert.equal(shape.networkProbePerformed, false);
  assert.equal(shape.sandboxIngressPort, 8080);
  assert.equal(shape.remoteTunnelsAllowed, false);
  assert.equal(shape.importExportObserved, false);
  assert.deepEqual(shape.requiredMediaSurfaces, [...requiredMediaSurfaces]);
  assert.equal(shape.benchmarkSupport.sourceRppId, 'RPP-0715');
  assert.equal(shape.benchmarkSupport.mediaWritesAttempted, 144);
  assert.equal(shape.benchmarkSupport.attachmentRowsPreconditioned, 144);
  assert.equal(shape.benchmarkSupport.metadataRowsPreconditioned, 576);

  assert.equal(
    report.candidateScope.importExportSurvivalSurface.runtimeRequired,
    'real-wordpress-import-export',
  );
  assert.equal(report.candidateScope.importExportSurvivalSurface.productionBackedRequired, true);
  assert.equal(report.candidateScope.importExportSurvivalSurface.largeMediaRequired, true);
  assert.equal(report.candidateScope.importExportSurvivalSurface.pluginDriver, pluginDriver);
  assert.equal(report.candidateScope.importExportSurvivalSurface.pluginOwner, pluginOwner);
  assert.equal(
    report.candidateScope.importExportSurvivalSurface.pluginResourceKeyHash,
    pluginResourceKeyHash,
  );
  assert.deepEqual(report.candidateScope.importExportSurvivalSurface.requiredGraphTypes, [
    ...requiredGraphTypes,
  ]);
  assert.ok(report.candidateScope.acceptanceRules.includes('real-wordpress-import-export-runtime-only'));
  assert.ok(report.candidateScope.acceptanceRules.includes('production-backed-artifact-required'));
  assert.ok(
    report.candidateScope.candidateClaims.includes(
      'rpp-0823-external-topology-v2-identity-surface-linked',
    ),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes(
      'production-bound-large-media-import-export',
    ),
  );

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'plugin-driver-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'featured-image-attachment-attachment-metadata-post-parent-comment-graph-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-missing'));
  assert.ok(report.releaseReadyScope.blockers.includes('external-wordpress-live-topology-not-configured'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-real-large-media-import-export-survival-artifact'));

  assert.match(report.scopeComparisonHash, sha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0834 records exact unavailable topology capabilities and stays NO-GO', () => {
  const { report } = loadSupportReport();
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);
  const capabilities = Object.fromEntries(
    report.currentObservation.exactUnavailableCapabilities.map((entry) => [entry.code, entry]),
  );

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(report.currentObservation.dockerCliUsable, false);
  assert.equal(report.currentObservation.externalWordPressStaticIdentityProofAvailable, true);
  assert.equal(report.currentObservation.externalWordPressLiveTopologyComplete, false);
  assert.equal(report.currentObservation.realImportExportArtifactPresent, false);
  assert.equal(report.currentObservation.primaryBlockerCode, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');

  assert.equal(capabilities.DOCKER_CLI_MISSING.capability, 'docker-cli');
  assert.equal(capabilities.DOCKER_CLI_MISSING.command, probe.checks.dockerCli.command);
  assert.equal(capabilities.DOCKER_CLI_MISSING.missingExecutable, true);
  assert.deepEqual(capabilities.DOCKER_CLI_MISSING.requiredFor, [...topologyRequiredFor]);

  assert.equal(
    capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.capability,
    'complete-external-wordpress-topology-with-auth',
  );
  assert.deepEqual(capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.missingInputs, [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_LOCAL_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_USERNAME',
    'REPRINT_PUSH_APPLICATION_PASSWORD',
  ]);
  assert.equal(capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.valuesIncluded, false);
  assert.ok(
    capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.requiredFor.includes(
      'production-backed-survival-artifact',
    ),
  );

  assert.equal(
    capabilities.REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING.capability,
    'large-media-library-import-export-survival-artifact',
  );
  assert.equal(capabilities.REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING.artifactProvided, false);

  assert.equal(report.currentObservation.topologyCommand.command, artifact.commands.runHarness);
  assert.equal(report.currentObservation.topologyCommand.status, artifact.status);
  assert.equal(report.currentObservation.topologyCommand.siteStartupStatus, 'not-started');
  assert.equal(report.currentObservation.topologyCommand.sitesStarted, false);
  assert.equal(report.currentObservation.topologyCommand.failClosed, true);
  assert.equal(report.currentObservation.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.currentObservation.topologyCommand.releaseMovementAllowed, false);
  assert.deepEqual(
    report.currentObservation.topologyCommand.exactUnavailableCapability,
    capabilities.DOCKER_CLI_MISSING,
  );
  assert.equal(report.currentObservation.topologyCommand.runtime, artifact.runtime);
  assert.equal(report.currentObservation.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.deepEqual(report.currentObservation.topologyCommand.publishedIngress, {
    hostSurface: 'loopback-only',
    port: 8080,
    publishedPortCount: 1,
  });
  assert.deepEqual(report.currentObservation.topologyCommand.policy, {
    remoteTunnelsAllowed: false,
    packagedFallbackAllowed: false,
    onlySandbox8080Ingress: true,
  });
  assert.match(report.currentObservation.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(
    report.currentObservation.topologyCommand.artifactHash,
    topologyArtifactHash(artifact, probe),
  );
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0834 accepts only production-backed real WordPress large media survival proof', () => {
  const proof = evaluateLargeMediaLibraryTopologyV2(successfulRealLargeMediaImportExportArtifact());

  assert.equal(proof.ok, true);
  assert.equal(proof.successTargetSatisfied, true);
  assert.equal(proof.acceptedForSupportContract, true);
  assert.equal(proof.releaseVerifierReviewRequired, true);
  assert.equal(proof.finalReleaseDecision, 'requires-release-verifier-review');
  assert.equal(proof.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(proof.importExport.realWordPress, true);
  assert.equal(proof.importExport.productionBacked, true);
  assert.equal(proof.importExport.importObserved, true);
  assert.equal(proof.importExport.exportObserved, true);
  assert.equal(proof.importExport.attachmentRowsObserved, 144);
  assert.equal(proof.importExport.attachmentMetadataRowsObserved, 576);
  assert.equal(proof.topology.largeMediaLibrary, true);
  assert.equal(proof.topology.topologyVariant, 'external-wordpress-topology-v2');
  assert.equal(proof.topology.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(proof.topology.roleIdentityHashesOnly, true);
  assert.equal(proof.topology.roleIdentitiesDistinct, true);
  assert.equal(proof.topology.routeSourceIdentitiesMatch, true);
  assert.match(proof.topology.mediaLibrarySurfaceHash, sha256Pattern);
  assert.match(proof.topology.liveRouteReceiptsHash, sha256Pattern);
  assert.equal(proof.pluginEvidence.driver, pluginDriver);
  assert.equal(proof.pluginEvidence.owner, pluginOwner);
  assert.equal(proof.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(proof.pluginEvidence.survivedImport, true);
  assert.equal(proof.pluginEvidence.survivedExport, true);
  assert.match(proof.pluginEvidence.preconditionHash, sha256Pattern);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.match(proof.artifactHash, sha256Pattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0834 accepted contract fixture',
  }));
});

test('RPP-0834 rejects missing, playground, non-production, and partial survival evidence', () => {
  const missingProof = evaluateLargeMediaLibraryTopologyV2(null);

  assert.equal(missingProof.ok, false);
  assert.equal(missingProof.successTargetSatisfied, false);
  assert.equal(missingProof.acceptedForSupportContract, false);
  assert.equal(missingProof.finalReleaseDecision, 'NO-GO');
  assert.deepEqual(missingProof.failures.map((failure) => failure.code), [
    'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  ]);

  const observed = successfulRealLargeMediaImportExportArtifact();
  observed.runtime = 'local-playground-wordpress';
  observed.importExport.productionBacked = false;
  observed.importExport.attachmentRowsObserved = 12;
  observed.topology.topologyVariant = 'external-wordpress-topology-v1';
  observed.topology.routeSourceIdentitiesMatch = false;
  observed.pluginEvidence.survivedExport = false;
  observed.graphEvidence = observed.graphEvidence.filter((entry) =>
    entry.type !== 'attachment-postmeta-round-trip');

  const proof = evaluateLargeMediaLibraryTopologyV2(observed);

  assert.equal(proof.ok, false);
  assert.equal(proof.successTargetSatisfied, false);
  assert.equal(proof.acceptedForSupportContract, false);
  assert.equal(proof.finalReleaseDecision, 'NO-GO');
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'PRODUCTION_BACKED_ARTIFACT_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'EXTERNAL_TOPOLOGY_V2_LIVE_READBACK_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'LARGE_MEDIA_SURFACE_INSUFFICIENT'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(proof.graphEvidence.missingTypes, ['attachment-postmeta-round-trip']);
  assertNoNeedles(proof, forbiddenNeedles);
});

test('RPP-0834 evidence remains hash/count/surface only and scoped to support', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0834 large media topology support report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawMediaValuesIncluded, false);
  assert.equal(report.redaction.pluginRawValuesIncluded, false);
  assert.equal(report.redaction.graphRawValuesIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'currentObservation',
    'releaseReadyScope',
    'integrationRecommendation',
    'successTarget',
  ]);
  assert.deepEqual(report.validation.commands.map((entry) => entry.command), [
    'node --check test/rpp-0834-large-media-library-topology-v2.test.js',
    'node --test --test-name-pattern RPP-0834 test/rpp-0834-large-media-library-topology-v2.test.js',
    'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0834-large-media-library-topology-v2.md',
    'git diff --check origin/lane/evidence-integration-20260527...HEAD',
  ]);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /media-(?:base|planned|drift)-payload|wp-content\/uploads|Bearer\s+|Basic\s+|attachment title|metadata value|customer secret/i,
  );
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailsail|tailscale funnel/i,
  );
  assert.doesNotMatch(text, /"productionBacked": true/);
  assert.doesNotMatch(text, /"releaseEligible": true/);
  assert.doesNotMatch(text, /"integrationRecommendation": "GO"/);
  assertNoNeedles(report, forbiddenNeedles);
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0834 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildExternalTopologyVariant2SupportSummary() {
  const topologyProof = collectExternalWordPressTopologyProof({
    env: staticTopologyEnv,
    now: new Date(fixedNow),
  });
  const identitySurfaces = buildIdentitySurfaces(topologyProof);
  const routeSourceIdentities = buildRouteSourceIdentities(topologyProof);
  const roleIdentityHashes = {
    source: topologyProof.urlCapture.source.identityHash,
    localEdited: topologyProof.urlCapture.localEdited.identityHash,
    remoteChanged: topologyProof.urlCapture.remoteChanged.identityHash,
  };
  const core = {
    proofScope: 'external-wordpress-topology-v2-static-identity-support',
    roleIdentityHashes,
    routeSourceIdentities,
    identitySurfaces,
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    acceptedStaticIdentity: topologyProof.ok === true,
  };

  return {
    acceptedStaticIdentity: topologyProof.ok === true,
    roleIdentityHashes,
    roleIdentityHashesOnly: true,
    roleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
    sourceAliasAndRouteSourceIdentitiesMatch:
      topologyProof.identityChecks.remoteAliasMatchesSource.ok
      && topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
    routeSourceIdentityCheckCount: routeSourceIdentities.length,
    identitySurfaceCount: identitySurfaces.length,
    identitySurfaceNames: identitySurfaces.map((entry) => entry.surface),
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    scopeHash: `sha256:${digest(core)}`,
  };
}

function buildIdentitySurfaces(topologyProof) {
  return [
    { surface: 'required-role-urls-present', ok: topologyProof.identityChecks.requiredUrlsPresent.ok },
    { surface: 'required-role-urls-valid', ok: topologyProof.identityChecks.requiredUrlsValid.ok },
    {
      surface: 'source-local-changed-url-identities-distinct',
      ok: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
    },
    { surface: 'remote-source-alias-matches-source', ok: topologyProof.identityChecks.remoteAliasMatchesSource.ok },
    { surface: 'route-source-identities-match-source', ok: topologyProof.identityChecks.sameSourceAcrossRoutes.ok },
    { surface: 'no-forbidden-tunnel-hosts', ok: topologyProof.identityChecks.noTunnelHosts.ok },
    { surface: 'no-url-userinfo-query-or-fragment', ok: topologyProof.identityChecks.noUrlSecrets.ok },
    { surface: 'loopback-limited-to-sandbox-8080', ok: topologyProof.identityChecks.localLoopbackIngress.ok },
    { surface: 'packaged-fallback-disabled', ok: topologyProof.identityChecks.packagedFallbackDisabled.ok },
  ];
}

function buildRouteSourceIdentities(topologyProof) {
  const routes = topologyProof.identityChecks.sameSourceAcrossRoutes.routes;
  return routeOrder.map((route) => {
    const routeCheck = routes[route] || {};
    return {
      route,
      configured: routeCheck.configured === true,
      sameSource: routeCheck.sameSource === true,
      sourceIdentityHash: routeCheck.sourceIdentityHash || topologyProof.urlCapture.source.identityHash || '',
      routeIdentityHash:
        routeCheck.routeIdentityHash
        || routeCheck.sourceIdentityHash
        || topologyProof.urlCapture.source.identityHash
        || '',
    };
  });
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0834-docker-work',
    evidenceDir: '/tmp/rpp-0834-docker-evidence',
    env: {},
  });
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'blocked',
    verify: { status: 2, signal: null },
    generatedAt: fixedNow,
  });

  return { artifact, plan, probe };
}

function evaluateLargeMediaLibraryTopologyV2(observed) {
  const validation = validateObservedImportExportSurvival(observed);
  const successTargetSatisfied = validation.failures.length === 0;

  return {
    event: proofId,
    variant,
    ok: successTargetSatisfied,
    successTargetSatisfied,
    acceptedForSupportContract: successTargetSatisfied,
    releaseVerifierReviewRequired: successTargetSatisfied,
    finalReleaseDecision: successTargetSatisfied
      ? 'requires-release-verifier-review'
      : 'NO-GO',
    topology: validation.topology,
    importExport: validation.importExport,
    pluginEvidence: validation.pluginEvidence,
    graphEvidence: validation.graphEvidence,
    artifactHash: validation.sanitizedArtifact
      ? digest(validation.sanitizedArtifact)
      : null,
    failures: validation.failures,
  };
}

function validateObservedImportExportSurvival(observed) {
  if (!observed) {
    return {
      topology: missingTopologyEvidence(),
      importExport: missingImportExportEvidence(),
      pluginEvidence: missingPluginEvidence(),
      graphEvidence: missingGraphEvidence(),
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress large media import/export survival artifact was provided.',
      }],
    };
  }

  const topology = observed.topology || {};
  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphTypes.includes(entry?.type)
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphTypes.filter((type) => !survivedGraphTypes.includes(type));
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0834 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_ARTIFACT_REQUIRED',
      reason: 'RPP-0834 variant 2 remains support-only until production-backed proof is supplied.',
    });
  }
  if (
    topology.largeMediaLibrary !== true
    || topology.topologyVariant !== 'external-wordpress-topology-v2'
    || topology.sourceLocalChangedRoleIdentitiesCaptured !== true
    || topology.roleIdentityHashesOnly !== true
    || topology.roleIdentitiesDistinct !== true
    || topology.routeSourceIdentitiesMatch !== true
    || !isSha256(topology.mediaLibrarySurfaceHash)
    || !isSha256(topology.liveRouteReceiptsHash)
  ) {
    failures.push({
      code: 'EXTERNAL_TOPOLOGY_V2_LIVE_READBACK_REQUIRED',
      reason: 'The artifact must prove external topology v2 role identities and live route receipts by hash.',
    });
  }
  if (
    importExport.importObserved !== true
    || importExport.exportObserved !== true
    || importExport.attachmentRowsObserved < 144
    || importExport.attachmentMetadataRowsObserved < 576
  ) {
    failures.push({
      code: 'LARGE_MEDIA_SURFACE_INSUFFICIENT',
      reason: 'The artifact must show large media import, export, attachment rows, and attachment metadata rows.',
    });
  }
  if (![importExport.importedSnapshotHash, importExport.exportedSnapshotHash].every(isSha256)) {
    failures.push({
      code: 'IMPORT_EXPORT_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only imported and exported snapshot evidence.',
    });
  }
  if (
    plugin.driver !== pluginDriver
    || plugin.owner !== pluginOwner
    || plugin.resourceKeyHash !== pluginResourceKeyHash
  ) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_DRIVER_MISMATCH',
      reason: 'The artifact does not carry the required reprint-push plugin driver evidence.',
    });
  }
  if (plugin.survivedImport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_IMPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after import.',
    });
  }
  if (plugin.survivedExport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after export.',
    });
  }
  if (!isSha256(plugin.preconditionHash)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_HASH_MISSING',
      reason: 'Plugin evidence must include a hash-only live precondition.',
    });
  }
  if (missingGraphTypes.length > 0) {
    failures.push({
      code: 'GRAPH_EVIDENCE_SURVIVAL_MISSING',
      reason: `Missing graph survival evidence for: ${missingGraphTypes.join(', ')}`,
    });
  }

  return {
    topology: {
      largeMediaLibrary: topology.largeMediaLibrary === true,
      topologyVariant: topology.topologyVariant || null,
      sourceLocalChangedRoleIdentitiesCaptured:
        topology.sourceLocalChangedRoleIdentitiesCaptured === true,
      roleIdentityHashesOnly: topology.roleIdentityHashesOnly === true,
      roleIdentitiesDistinct: topology.roleIdentitiesDistinct === true,
      routeSourceIdentitiesMatch: topology.routeSourceIdentitiesMatch === true,
      mediaLibrarySurfaceHash: isSha256(topology.mediaLibrarySurfaceHash)
        ? topology.mediaLibrarySurfaceHash
        : null,
      liveRouteReceiptsHash: isSha256(topology.liveRouteReceiptsHash)
        ? topology.liveRouteReceiptsHash
        : null,
    },
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      productionBacked: importExport.productionBacked === true,
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
        ? importExport.importedSnapshotHash
        : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
        ? importExport.exportedSnapshotHash
        : null,
      attachmentRowsObserved: Number.isInteger(importExport.attachmentRowsObserved)
        ? importExport.attachmentRowsObserved
        : 0,
      attachmentMetadataRowsObserved: Number.isInteger(importExport.attachmentMetadataRowsObserved)
        ? importExport.attachmentMetadataRowsObserved
        : 0,
    },
    pluginEvidence: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphTypes],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    sanitizedArtifact: {
      runtime: observed.runtime || null,
      topology: {
        largeMediaLibrary: topology.largeMediaLibrary === true,
        topologyVariant: topology.topologyVariant || null,
        sourceLocalChangedRoleIdentitiesCaptured:
          topology.sourceLocalChangedRoleIdentitiesCaptured === true,
        roleIdentityHashesOnly: topology.roleIdentityHashesOnly === true,
        roleIdentitiesDistinct: topology.roleIdentitiesDistinct === true,
        routeSourceIdentitiesMatch: topology.routeSourceIdentitiesMatch === true,
        mediaLibrarySurfaceHash: isSha256(topology.mediaLibrarySurfaceHash)
          ? topology.mediaLibrarySurfaceHash
          : null,
        liveRouteReceiptsHash: isSha256(topology.liveRouteReceiptsHash)
          ? topology.liveRouteReceiptsHash
          : null,
      },
      importExport: {
        realWordPress: importExport.realWordPress === true,
        productionBacked: importExport.productionBacked === true,
        importObserved: importExport.importObserved === true,
        exportObserved: importExport.exportObserved === true,
        importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
          ? importExport.importedSnapshotHash
          : null,
        exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
          ? importExport.exportedSnapshotHash
          : null,
        attachmentRowsObserved: Number.isInteger(importExport.attachmentRowsObserved)
          ? importExport.attachmentRowsObserved
          : 0,
        attachmentMetadataRowsObserved: Number.isInteger(importExport.attachmentMetadataRowsObserved)
          ? importExport.attachmentMetadataRowsObserved
          : 0,
      },
      plugin: {
        driver: plugin.driver || null,
        owner: plugin.owner || null,
        resourceKeyHash: plugin.resourceKeyHash || null,
        survivedImport: plugin.survivedImport === true,
        survivedExport: plugin.survivedExport === true,
        preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
      },
      graph: graphEntries.map((entry) => ({
        type: entry?.type || null,
        survivedImport: entry?.survivedImport === true,
        survivedExport: entry?.survivedExport === true,
        preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
        roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
      })),
    },
    failures,
  };
}

function successfulRealLargeMediaImportExportArtifact() {
  return {
    runtime: 'real-wordpress-import-export',
    topology: {
      largeMediaLibrary: true,
      topologyVariant: 'external-wordpress-topology-v2',
      sourceLocalChangedRoleIdentitiesCaptured: true,
      roleIdentityHashesOnly: true,
      roleIdentitiesDistinct: true,
      routeSourceIdentitiesMatch: true,
      mediaLibrarySurfaceHash: sampleHash('media-library-surface'),
      liveRouteReceiptsHash: sampleHash('live-route-receipts'),
    },
    importExport: {
      realWordPress: true,
      productionBacked: true,
      importObserved: true,
      exportObserved: true,
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
      attachmentRowsObserved: 144,
      attachmentMetadataRowsObserved: 576,
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash('plugin-precondition'),
    },
    graphEvidence: requiredGraphTypes.map((type) => ({
      type,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
  };
}

function missingTopologyEvidence() {
  return {
    largeMediaLibrary: false,
    topologyVariant: null,
    sourceLocalChangedRoleIdentitiesCaptured: false,
    roleIdentityHashesOnly: false,
    roleIdentitiesDistinct: false,
    routeSourceIdentitiesMatch: false,
    mediaLibrarySurfaceHash: null,
    liveRouteReceiptsHash: null,
  };
}

function missingImportExportEvidence() {
  return {
    runtime: null,
    realWordPress: false,
    productionBacked: false,
    importObserved: false,
    exportObserved: false,
    importedSnapshotHash: null,
    exportedSnapshotHash: null,
    attachmentRowsObserved: 0,
    attachmentMetadataRowsObserved: 0,
  };
}

function missingPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKeyHash: pluginResourceKeyHash,
    survivedImport: false,
    survivedExport: false,
    preconditionHash: null,
  };
}

function missingGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphTypes],
    survivedTypes: [],
    missingTypes: [...requiredGraphTypes],
  };
}

function topologyArtifactHash(artifact, probe) {
  return `sha256:${digest({
    command: artifact.commands.runHarness,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    mediaSurface: 'large-media-library',
    variant: 'external-wordpress-topology-v2',
    requiredFor: [...topologyRequiredFor],
  })}`;
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    currentObservation: report.currentObservation,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
    successTarget: report.successTarget,
  };
}

function sampleHash(label) {
  return digest({ rpp: 'RPP-0834', label });
}

function isSha256(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
