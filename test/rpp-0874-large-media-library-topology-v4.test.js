import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0874-large-media-library-topology-v4.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0874-large-media-library-topology-v4';
const variant = 'RPP-0874-variant-4';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0874',
  resource: 'reprint-push-release-state-row',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const requiredMediaSurfaces = Object.freeze([
  'wp_posts:attachment',
  'wp_postmeta:attachment-metadata',
  'uploads-file-hash-manifest',
  'large-media-fast-path-lane',
]);

const requiredGraphTypes = Object.freeze([
  'featured-image-attachment',
  'attachment-postmeta-round-trip',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
]);

const requiredForRealImportExport = Object.freeze([
  'large-media-real-wordpress-import',
  'wordpress-export-after-large-media-import',
  'plugin-and-graph-survival-readback',
  'large-media-library-topology-v4-production-backed-proof',
]);

const dockerUnavailableCapability = Object.freeze({
  code: 'DOCKER_CLI_MISSING',
  capability: 'docker-cli',
  command: 'docker --version',
  missingExecutable: true,
  requiredFor: [...requiredForRealImportExport],
});

const externalTopologyUnavailableCapability = Object.freeze({
  code: 'EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED',
  capability: 'complete-external-wordpress-topology-v4-with-auth',
  configurationPresent: false,
  missingInputs: [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_LOCAL_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_USERNAME',
    'REPRINT_PUSH_APPLICATION_PASSWORD',
  ],
  valuesIncluded: false,
  requiredFor: [...requiredForRealImportExport],
});

const importExportUnavailableCapability = Object.freeze({
  code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  capability: 'large-media-library-real-wordpress-import-export-survival-artifact',
  artifactProvided: false,
  requiredFor: [
    'large-media-attachment-and-metadata-survival',
    'plugin-evidence-import-export-survival',
    'graph-evidence-import-export-survival',
    'same-artifact-release-verifier-review',
  ],
});

const requiredProductionTopologyEvidence = Object.freeze({
  topologyClass: 'far-production-topology',
  topologyVariant: 'external-wordpress-topology-v4',
  realImportExportTopologyRequired: true,
  importRouteHashRequired: true,
  exportRouteHashRequired: true,
  liveRouteReceiptHashRequired: true,
  sameArtifactBindingHashRequired: true,
});

const forbiddenNeedles = Object.freeze([
  'https://',
  'http://',
  'source.example.test',
  'changed.example.test',
  '127.0.0.1',
  'localhost',
  'rpp-0874-application-password-must-not-leak',
  'media-base-payload',
  'media-planned-payload',
  'media-drift-payload',
  'wp-content/uploads',
  'attachment title',
  'metadata value',
]);

test('RPP-0874 support report records focused regression large media topology variant 4 scope', () => {
  const { report, text } = loadSupportReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0874');
  assert.equal(report.variant, 4);
  assert.equal(report.title, 'Large media library topology variant 4 focused regression support report');
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(
    report.successTarget,
    'plugin-and-graph-evidence-survive-real-wordpress-import-export',
  );
  assert.match(text, /Final release posture: `NO-GO`/);
  assert.match(text, /This is not production-backed release evidence\./);

  assert.deepEqual(report.sourcePattern, {
    largeMediaTopologyPrecedent: {
      rppId: 'RPP-0854',
      variant: 3,
      evidenceFile: 'docs/evidence/rpp-0854-large-media-library-topology-v3.md',
      testFile: 'test/rpp-0854-large-media-library-topology-v3.test.js',
      supportOnly: true,
    },
    variant4ProductionTopologyPatterns: [
      'RPP-0861-three-site-local-production-topology-v4',
      'RPP-0863-external-wordpress-topology-v4',
      'RPP-0864-brewcommerce-blueprint-import-v4',
      'RPP-0876-plugin-update-hooks-topology-v4',
    ],
    mediaBenchmark: {
      rppId: 'RPP-0715',
      profile: 'large-site',
      mediaDriver: 'benchmark-media-library-file',
      fastPathLane: 'large-media-library-fast-path',
      storageBoundary: 'filesystem-fsync-evidence',
    },
    contractInherited: true,
  });

  assert.deepEqual(report.focusedRegression, {
    regressionId: 'RPP-0874-same-artifact-large-media-plugin-graph-survival',
    variant: 4,
    topologyClass: 'far-production-topology',
    supportOnlyUntilRealImportExportArtifact: true,
    sameArtifactBindingHashRequired: true,
    rejectsSplitSurvivalEvidence: true,
    deterministicAssertions: [
      'real-wordpress-import-export-runtime-only',
      'large-media-import-and-export-observed',
      'attachment-and-metadata-counts-preserved',
      'plugin-driver-evidence-survives-import-and-export',
      'all-required-graph-types-survive-import-and-export',
      'production-topology-route-hashes-present',
      'same-artifact-binding-hash-matches',
      'hash-count-surface-only-evidence',
    ],
  });

  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0874-large-media-library-topology-v4.md',
    'test/rpp-0874-large-media-library-topology-v4.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.sharedTopologyModified, false);
  assert.equal(report.writeScope.releaseVerifierModified, false);
  assert.equal(report.writeScope.packageMetadataModified, false);
  assert.equal(report.writeScope.sharedScriptsModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelsAllowed, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.equal(report.currentSandboxObservation.observedAt, fixedNow);
  assert.equal(report.currentSandboxObservation.dockerCliUsable, false);
  assert.deepEqual(report.currentSandboxObservation.dockerUnavailableCapability, dockerUnavailableCapability);
  assert.equal(report.currentSandboxObservation.externalWordPressTopologyComplete, false);
  assert.deepEqual(
    report.currentSandboxObservation.externalTopologyUnavailableCapability,
    externalTopologyUnavailableCapability,
  );
  assert.equal(report.currentSandboxObservation.realImportExportArtifactPresent, false);
  assert.deepEqual(
    report.currentSandboxObservation.realImportExportUnavailableCapability,
    importExportUnavailableCapability,
  );
  assert.equal(
    report.currentSandboxObservation.primaryBlockerCode,
    'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  );
  assert.deepEqual(report.currentSandboxObservation.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology v4',
    'real WordPress large media import/export survival artifact',
    'same-artifact plugin graph and topology survival binding',
  ]);
  assert.deepEqual(report.currentSandboxObservation.exactUnavailableCapabilities, [
    dockerUnavailableCapability,
    externalTopologyUnavailableCapability,
    importExportUnavailableCapability,
  ]);

  assert.deepEqual(report.contractRequirements.requiredMediaSurfaces, [...requiredMediaSurfaces]);
  assert.equal(report.contractRequirements.runtime, 'real-wordpress-import-export');
  assert.equal(report.contractRequirements.realWordPressRequired, true);
  assert.equal(report.contractRequirements.productionBackedRequired, true);
  assert.equal(report.contractRequirements.importObservedRequired, true);
  assert.equal(report.contractRequirements.exportObservedRequired, true);
  assert.equal(report.contractRequirements.minimumAttachmentRowsObserved, 144);
  assert.equal(report.contractRequirements.minimumAttachmentMetadataRowsObserved, 576);
  assert.deepEqual(report.contractRequirements.snapshotHashesRequired, [
    'importedSnapshotHash',
    'exportedSnapshotHash',
    'uploadsManifestHash',
  ]);
  assert.deepEqual(report.contractRequirements.requiredPluginEvidence, {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKind: 'plugin-driver-row',
    resourceKeyHash: pluginResourceKeyHash,
    importSurvivalRequired: true,
    exportSurvivalRequired: true,
    livePreconditionHashRequired: true,
  });
  assert.deepEqual(report.contractRequirements.requiredGraphEvidence, [...requiredGraphTypes]);
  assert.deepEqual(
    report.contractRequirements.requiredProductionTopologyEvidence,
    requiredProductionTopologyEvidence,
  );
  assert.equal(report.contractRequirements.artifactBindingHashRequired, true);
  assert.equal(report.contractRequirements.actualProductionBackedArtifactRequiredForGo, true);

  assert.equal(report.candidateScope.status, 'large-media-library-topology-candidate-v4');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'rpp-0854-large-media-plus-variant-4-production-topology-patterns');
  assert.equal(report.candidateScope.mediaRequirements.surfaceCount, requiredMediaSurfaces.length);
  assert.deepEqual(report.candidateScope.mediaRequirements.requiredMediaSurfaces, [...requiredMediaSurfaces]);
  assert.equal(report.candidateScope.mediaRequirements.surfaceDigest, sha256Evidence(requiredMediaSurfaces));
  assert.equal(report.candidateScope.graphRequirements.graphTypeCount, requiredGraphTypes.length);
  assert.deepEqual(report.candidateScope.graphRequirements.requiredGraphTypes, [...requiredGraphTypes]);
  assert.equal(report.candidateScope.graphRequirements.graphDigest, sha256Evidence(requiredGraphTypes));
  assert.deepEqual(report.candidateScope.acceptanceRules, [
    'real-wordpress-import-export-runtime-only',
    'production-backed-artifact-required',
    'external-wordpress-topology-v4-live-route-readback-required',
    'large-media-attachment-and-metadata-hash-count-readback',
    'plugin-driver-evidence-survives-import-and-export',
    'all-required-graph-types-survive-import-and-export',
    'same-artifact-binding-required',
    'artifact-stays-hash-count-surface-only',
  ]);
  assert.ok(report.candidateScope.excludedFromCandidate.includes('final-release-go-decision'));
  assert.ok(report.candidateScope.candidateClaims.includes('rpp-0854-large-media-contract-carried-forward'));
  assert.ok(report.candidateScope.candidateClaims.includes('variant-4-same-artifact-regression-recorded'));

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'plugin-driver-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'all-required-graph-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'same-artifact-large-media-plugin-graph-topology-binding',
    ),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-real-large-media-import-export-survival-artifact'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-support-final-release-go'));

  assert.match(report.scopeHash, sha256Pattern);
  assert.equal(report.scopeHash, digest(scopeHashInput(report)));
});

test('RPP-0874 records missing real WordPress import/export evidence as fail-closed NO-GO', () => {
  const proof = evaluateLargeMediaLibraryTopologyV4({
    commandInventory: {
      docker: { present: false, usable: false, missingExecutable: true },
      node: { present: true, usable: true },
      npm: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: ['not configured for this support-only slice'],
    },
    observedImportExport: null,
    now: fixedNow,
  });

  assert.equal(proof.event, proofId);
  assert.equal(proof.variant, variant);
  assert.equal(proof.ok, false);
  assert.equal(proof.successTargetSatisfied, false);
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.blocker.code, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.deepEqual(proof.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology v4',
    'real WordPress large media import/export survival artifact',
    'same-artifact plugin graph and topology survival binding',
  ]);
  assert.ok(proof.failures.some((failure) => failure.code === 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING'));
  assert.equal(proof.constraints.sandboxIngressPort, 8080);
  assert.equal(proof.constraints.remoteTunnelsAllowed, false);
  assert.equal(proof.constraints.packagedFallbackAccepted, false);
  assert.deepEqual(proof.topology, missingTopologyEvidence());
  assert.deepEqual(proof.pluginEvidence, missingPluginEvidence());
  assert.deepEqual(proof.graphEvidence, missingGraphEvidence());
  assert.deepEqual(proof.mediaEvidence.requiredMediaSurfaces, [...requiredMediaSurfaces]);
});

test('RPP-0874 accepts only same-artifact large media, plugin, graph, and topology survival evidence', () => {
  const proof = evaluateLargeMediaLibraryTopologyV4({
    commandInventory: {
      docker: { present: true, usable: true, missingExecutable: false },
    },
    externalWordPressConfig: {
      complete: true,
      missing: [],
    },
    observedImportExport: successfulRealLargeMediaImportExportArtifact(),
    now: fixedNow,
  });

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
  assert.equal(proof.mediaEvidence.attachmentRowsObserved, 144);
  assert.equal(proof.mediaEvidence.attachmentMetadataRowsObserved, 576);
  assert.deepEqual(proof.mediaEvidence.requiredMediaSurfaces, [...requiredMediaSurfaces]);
  assert.match(proof.mediaEvidence.mediaLibrarySurfaceHash, sha256Pattern);
  assert.match(proof.mediaEvidence.uploadsManifestHash, sha256Pattern);
  assert.equal(proof.topology.topologyClass, 'far-production-topology');
  assert.equal(proof.topology.topologyVariant, 'external-wordpress-topology-v4');
  assert.equal(proof.topology.realImportExportTopology, true);
  assert.equal(proof.topology.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(proof.topology.routeSourceIdentitiesMatch, true);
  assert.match(proof.topology.importRouteHash, sha256Pattern);
  assert.match(proof.topology.exportRouteHash, sha256Pattern);
  assert.match(proof.topology.liveRouteReceiptsHash, sha256Pattern);
  assert.equal(proof.pluginEvidence.driver, pluginDriver);
  assert.equal(proof.pluginEvidence.owner, pluginOwner);
  assert.equal(proof.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(proof.pluginEvidence.survivedImport, true);
  assert.equal(proof.pluginEvidence.survivedExport, true);
  assert.match(proof.pluginEvidence.livePreconditionHash, sha256Pattern);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.equal(proof.artifactBinding.matchesArtifact, true);
  assert.equal(proof.artifactBinding.topologyBindingMatchesArtifact, true);
  assert.match(proof.artifactHash, sha256Pattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0874 accepted same-artifact contract fixture',
  }));
});

test('RPP-0874 rejects playground, partial, and split survival evidence', () => {
  const missingProof = evaluateLargeMediaLibraryTopologyV4({
    commandInventory: {
      docker: { present: true, usable: true, missingExecutable: false },
    },
    externalWordPressConfig: {
      complete: true,
      missing: [],
    },
    observedImportExport: null,
    now: fixedNow,
  });

  assert.equal(missingProof.ok, false);
  assert.deepEqual(missingProof.failures.map((failure) => failure.code), [
    'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  ]);

  const partial = successfulRealLargeMediaImportExportArtifact();
  partial.runtime = 'local-playground-wordpress';
  partial.importExport.productionBacked = false;
  partial.importExport.attachmentRowsObserved = 12;
  partial.importExport.attachmentMetadataRowsObserved = 48;
  partial.topology.topologyVariant = 'external-wordpress-topology-v3';
  partial.topology.routeSourceIdentitiesMatch = false;
  partial.pluginEvidence.survivedExport = false;
  partial.graphEvidence = partial.graphEvidence.filter((entry) =>
    entry.type !== 'attachment-postmeta-round-trip');

  const partialProof = evaluateLargeMediaLibraryTopologyV4({
    observedImportExport: partial,
    now: fixedNow,
  });

  assert.equal(partialProof.ok, false);
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'PRODUCTION_BACKED_ARTIFACT_REQUIRED'));
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'EXTERNAL_TOPOLOGY_V4_LIVE_READBACK_REQUIRED'));
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'LARGE_MEDIA_SURFACE_INSUFFICIENT'));
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partialProof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partialProof.graphEvidence.missingTypes, ['attachment-postmeta-round-trip']);
  assertNoNeedles(partialProof, forbiddenNeedles);

  const split = successfulRealLargeMediaImportExportArtifact();
  split.topology.artifactBindingHash = sampleHash('split-production-topology-binding');

  const splitProof = evaluateLargeMediaLibraryTopologyV4({
    observedImportExport: split,
    now: fixedNow,
  });

  assert.equal(splitProof.ok, false);
  assert.equal(splitProof.artifactBinding.matchesArtifact, true);
  assert.equal(splitProof.artifactBinding.topologyBindingMatchesArtifact, false);
  assert.ok(splitProof.failures.some((failure) =>
    failure.code === 'SAME_ARTIFACT_TOPOLOGY_BINDING_REQUIRED'));
});

test('RPP-0874 evidence remains redacted, support-only, and release NO-GO', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0874 large media topology v4 support report' }));
  assert.deepEqual(report.redaction, {
    format: 'hash-count-surface-only',
    rawHostValuesIncluded: false,
    rawUrlValuesIncluded: false,
    credentialMaterialIncluded: false,
    rawMediaValuesIncluded: false,
    pluginRawValuesIncluded: false,
    graphRawValuesIncluded: false,
    tunnelOutputIncluded: false,
    scopeHashCovers: [
      'sourcePattern',
      'focusedRegression',
      'currentSandboxObservation',
      'contractRequirements',
      'candidateScope',
      'releaseReadyScope',
      'finalReleaseStatus',
      'integrationRecommendation',
      'successTarget',
    ],
  });
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /127\.0\.0\.1|localhost|source\.example\.test|changed\.example\.test/i);
  assert.doesNotMatch(
    text,
    /media-(?:base|planned|drift)-payload|wp-content\/uploads|Bearer\s+|Basic\s+|attachment title|metadata value/i,
  );
  assert.doesNotMatch(
    text,
    /"productionBacked": true|"releaseEligible": true|"integrationRecommendation": "GO"/,
  );
  assertNoNeedles(report, forbiddenNeedles);
});

test('RPP-0874 evidence documents exact validation commands and results', () => {
  const { report } = loadSupportReport();

  assert.deepEqual(report.validation.commands.map((entry) => entry.command), [
    'node --check test/rpp-0874-large-media-library-topology-v4.test.js',
    'node --test --test-name-pattern RPP-0874 test/rpp-0874-large-media-library-topology-v4.test.js',
    'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0874-large-media-library-topology-v4.md',
    'git diff --check',
  ]);
  assert.ok(report.validation.commands.every((entry) => entry.result === 'exit-0'));
  assert.deepEqual(report.validation.evidenceRedactionScan, {
    ok: true,
    rejectedFiles: 0,
  });
  assert.equal(report.validation.releasePostureAfterValidation, 'NO-GO');
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0874 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function evaluateLargeMediaLibraryTopologyV4({
  commandInventory = {},
  externalWordPressConfig = {},
  observedImportExport = null,
  now = fixedNow,
} = {}) {
  const validation = validateObservedImportExportSurvival(observedImportExport);
  const runtimeAvailable = commandInventory.docker?.usable === true || externalWordPressConfig.complete === true;
  const missingCapabilities = buildExactMissingCapabilities({
    runtimeAvailable,
    observedImportExport,
    validation,
  });
  const failures = [
    ...(!runtimeAvailable && observedImportExport === null
      ? [{
          code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
          reason: 'Docker runtime or complete external WordPress topology v4 is unavailable.',
        }]
      : []),
    ...validation.failures,
  ];
  const ok = failures.length === 0;

  return {
    event: proofId,
    variant,
    observedAt: now,
    ok,
    successTargetSatisfied: ok,
    releaseReady: false,
    readyForReleaseMovement: false,
    acceptedForReleaseGate: false,
    acceptedForSupportContract: ok,
    releaseVerifierReviewRequired: ok,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    finalReleaseDecision: ok ? 'requires-release-verifier-review' : 'NO-GO',
    releasePosture: 'NO-GO',
    blocker: ok
      ? null
      : { code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING' },
    constraints: {
      sandboxIngressPort: 8080,
      remoteTunnelsAllowed: false,
      packagedFallbackAccepted: false,
      productionBackedArtifactRequiredForGo: true,
    },
    exactMissingCapabilities: missingCapabilities,
    topology: validation.topology,
    importExport: validation.importExport,
    mediaEvidence: validation.mediaEvidence,
    pluginEvidence: validation.pluginEvidence,
    graphEvidence: validation.graphEvidence,
    artifactBinding: validation.artifactBinding,
    artifactHash: validation.sanitizedArtifact ? digest(validation.sanitizedArtifact) : null,
    failures,
  };
}

function validateObservedImportExportSurvival(observed) {
  if (!observed) {
    return {
      topology: missingTopologyEvidence(),
      importExport: missingImportExportEvidence(),
      mediaEvidence: missingMediaEvidence(),
      pluginEvidence: missingPluginEvidence(),
      graphEvidence: missingGraphEvidence(),
      artifactBinding: missingArtifactBinding(),
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
  const expectedArtifactBindingHash = artifactBindingHashFor(observed);
  const providedArtifactBindingHash = isSha256(observed.artifactBindingHash)
    ? observed.artifactBindingHash
    : null;
  const providedTopologyBindingHash = isSha256(topology.artifactBindingHash)
    ? topology.artifactBindingHash
    : null;
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0874 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_ARTIFACT_REQUIRED',
      reason: 'RPP-0874 remains support-only until production-backed proof is supplied.',
    });
  }
  if (
    topology.topologyClass !== 'far-production-topology'
    || topology.topologyVariant !== 'external-wordpress-topology-v4'
    || topology.realImportExportTopology !== true
    || topology.sourceLocalChangedRoleIdentitiesCaptured !== true
    || topology.roleIdentityHashesOnly !== true
    || topology.routeSourceIdentitiesMatch !== true
    || !isSha256(topology.importRouteHash)
    || !isSha256(topology.exportRouteHash)
    || !isSha256(topology.liveRouteReceiptsHash)
    || !isSha256(topology.mediaLibrarySurfaceHash)
  ) {
    failures.push({
      code: 'EXTERNAL_TOPOLOGY_V4_LIVE_READBACK_REQUIRED',
      reason: 'The artifact must prove external topology v4 route and media-library readbacks by hash.',
    });
  }
  if (
    importExport.importObserved !== true
    || importExport.exportObserved !== true
    || importExport.attachmentRowsObserved < 144
    || importExport.attachmentMetadataRowsObserved < 576
    || !isSha256(importExport.uploadsManifestHash)
  ) {
    failures.push({
      code: 'LARGE_MEDIA_SURFACE_INSUFFICIENT',
      reason: 'The artifact must show large media import, export, attachment rows, metadata rows, and uploads manifest.',
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
  if (!isSha256(plugin.livePreconditionHash)) {
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
  if (providedArtifactBindingHash !== expectedArtifactBindingHash) {
    failures.push({
      code: 'SAME_ARTIFACT_BINDING_REQUIRED',
      reason: 'The import/export, media, plugin, graph, and topology evidence must share one artifact binding hash.',
    });
  }
  if (providedTopologyBindingHash !== expectedArtifactBindingHash) {
    failures.push({
      code: 'SAME_ARTIFACT_TOPOLOGY_BINDING_REQUIRED',
      reason: 'The production topology route evidence must be bound to the same survival artifact.',
    });
  }

  return {
    topology: {
      topologyClass: topology.topologyClass || null,
      topologyVariant: topology.topologyVariant || null,
      realImportExportTopology: topology.realImportExportTopology === true,
      sourceLocalChangedRoleIdentitiesCaptured:
        topology.sourceLocalChangedRoleIdentitiesCaptured === true,
      roleIdentityHashesOnly: topology.roleIdentityHashesOnly === true,
      routeSourceIdentitiesMatch: topology.routeSourceIdentitiesMatch === true,
      importRouteHash: isSha256(topology.importRouteHash) ? topology.importRouteHash : null,
      exportRouteHash: isSha256(topology.exportRouteHash) ? topology.exportRouteHash : null,
      liveRouteReceiptsHash: isSha256(topology.liveRouteReceiptsHash)
        ? topology.liveRouteReceiptsHash
        : null,
      mediaLibrarySurfaceHash: isSha256(topology.mediaLibrarySurfaceHash)
        ? topology.mediaLibrarySurfaceHash
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
    },
    mediaEvidence: {
      requiredMediaSurfaces: [...requiredMediaSurfaces],
      attachmentRowsObserved: Number.isInteger(importExport.attachmentRowsObserved)
        ? importExport.attachmentRowsObserved
        : 0,
      attachmentMetadataRowsObserved: Number.isInteger(importExport.attachmentMetadataRowsObserved)
        ? importExport.attachmentMetadataRowsObserved
        : 0,
      uploadsManifestHash: isSha256(importExport.uploadsManifestHash)
        ? importExport.uploadsManifestHash
        : null,
      mediaLibrarySurfaceHash: isSha256(topology.mediaLibrarySurfaceHash)
        ? topology.mediaLibrarySurfaceHash
        : null,
    },
    pluginEvidence: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      livePreconditionHash: isSha256(plugin.livePreconditionHash)
        ? plugin.livePreconditionHash
        : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphTypes],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    artifactBinding: {
      required: true,
      expectedArtifactBindingHash,
      providedArtifactBindingHash,
      topologyArtifactBindingHash: providedTopologyBindingHash,
      matchesArtifact: providedArtifactBindingHash === expectedArtifactBindingHash,
      topologyBindingMatchesArtifact: providedTopologyBindingHash === expectedArtifactBindingHash,
    },
    sanitizedArtifact: sanitizedArtifactFor(observed),
    failures,
  };
}

function successfulRealLargeMediaImportExportArtifact() {
  const artifact = {
    runtime: 'real-wordpress-import-export',
    topology: {
      topologyClass: 'far-production-topology',
      topologyVariant: 'external-wordpress-topology-v4',
      realImportExportTopology: true,
      sourceLocalChangedRoleIdentitiesCaptured: true,
      roleIdentityHashesOnly: true,
      routeSourceIdentitiesMatch: true,
      importRouteHash: sampleHash('production-topology-import-route'),
      exportRouteHash: sampleHash('production-topology-export-route'),
      liveRouteReceiptsHash: sampleHash('production-topology-live-route-receipts'),
      mediaLibrarySurfaceHash: sampleHash('media-library-surface'),
    },
    importExport: {
      realWordPress: true,
      productionBacked: true,
      importObserved: true,
      exportObserved: true,
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
      uploadsManifestHash: sampleHash('uploads-manifest'),
      attachmentRowsObserved: 144,
      attachmentMetadataRowsObserved: 576,
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      survivedImport: true,
      survivedExport: true,
      livePreconditionHash: sampleHash('plugin-live-precondition'),
    },
    graphEvidence: requiredGraphTypes.map((type) => ({
      type,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
  };
  const artifactBindingHash = artifactBindingHashFor(artifact);

  artifact.artifactBindingHash = artifactBindingHash;
  artifact.topology.artifactBindingHash = artifactBindingHash;

  return artifact;
}

function sanitizedArtifactFor(observed) {
  const topology = observed?.topology || {};
  const importExport = observed?.importExport || {};
  const plugin = observed?.pluginEvidence || {};
  const graphEntries = Array.isArray(observed?.graphEvidence) ? observed.graphEvidence : [];

  return {
    runtime: observed?.runtime || null,
    topology: {
      topologyClass: topology.topologyClass || null,
      topologyVariant: topology.topologyVariant || null,
      realImportExportTopology: topology.realImportExportTopology === true,
      sourceLocalChangedRoleIdentitiesCaptured:
        topology.sourceLocalChangedRoleIdentitiesCaptured === true,
      roleIdentityHashesOnly: topology.roleIdentityHashesOnly === true,
      routeSourceIdentitiesMatch: topology.routeSourceIdentitiesMatch === true,
      importRouteHash: isSha256(topology.importRouteHash) ? topology.importRouteHash : null,
      exportRouteHash: isSha256(topology.exportRouteHash) ? topology.exportRouteHash : null,
      liveRouteReceiptsHash: isSha256(topology.liveRouteReceiptsHash)
        ? topology.liveRouteReceiptsHash
        : null,
      mediaLibrarySurfaceHash: isSha256(topology.mediaLibrarySurfaceHash)
        ? topology.mediaLibrarySurfaceHash
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
      uploadsManifestHash: isSha256(importExport.uploadsManifestHash)
        ? importExport.uploadsManifestHash
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
      livePreconditionHash: isSha256(plugin.livePreconditionHash)
        ? plugin.livePreconditionHash
        : null,
    },
    graph: graphEntries.map((entry) => ({
      type: entry?.type || null,
      survivedImport: entry?.survivedImport === true,
      survivedExport: entry?.survivedExport === true,
      preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
      roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
    })),
  };
}

function artifactBindingHashFor(observed) {
  return digest({
    artifact: sanitizedArtifactFor(observed),
    requiredMediaSurfaces: [...requiredMediaSurfaces],
    requiredGraphTypes: [...requiredGraphTypes],
    productionTopologyEvidence: requiredProductionTopologyEvidence,
  });
}

function buildExactMissingCapabilities({ runtimeAvailable, observedImportExport, validation }) {
  if (validation.failures.length === 0) {
    return [];
  }

  return [
    ...(!runtimeAvailable
      ? ['docker runtime or complete external WordPress topology v4']
      : []),
    ...(observedImportExport === null
      ? ['real WordPress large media import/export survival artifact']
      : []),
    ...(validation.artifactBinding?.matchesArtifact !== true
      || validation.artifactBinding?.topologyBindingMatchesArtifact !== true
      ? ['same-artifact plugin graph and topology survival binding']
      : []),
  ];
}

function missingTopologyEvidence() {
  return {
    topologyClass: null,
    topologyVariant: null,
    realImportExportTopology: false,
    sourceLocalChangedRoleIdentitiesCaptured: false,
    roleIdentityHashesOnly: false,
    routeSourceIdentitiesMatch: false,
    importRouteHash: null,
    exportRouteHash: null,
    liveRouteReceiptsHash: null,
    mediaLibrarySurfaceHash: null,
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
  };
}

function missingMediaEvidence() {
  return {
    requiredMediaSurfaces: [...requiredMediaSurfaces],
    attachmentRowsObserved: 0,
    attachmentMetadataRowsObserved: 0,
    uploadsManifestHash: null,
    mediaLibrarySurfaceHash: null,
  };
}

function missingPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKeyHash: pluginResourceKeyHash,
    survivedImport: false,
    survivedExport: false,
    livePreconditionHash: null,
  };
}

function missingGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphTypes],
    survivedTypes: [],
    missingTypes: [...requiredGraphTypes],
  };
}

function missingArtifactBinding() {
  return {
    required: true,
    expectedArtifactBindingHash: null,
    providedArtifactBindingHash: null,
    topologyArtifactBindingHash: null,
    matchesArtifact: false,
    topologyBindingMatchesArtifact: false,
  };
}

function scopeHashInput(report) {
  return {
    sourcePattern: report.sourcePattern,
    focusedRegression: report.focusedRegression,
    currentSandboxObservation: report.currentSandboxObservation,
    contractRequirements: report.contractRequirements,
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
    successTarget: report.successTarget,
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function sampleHash(label) {
  return digest({ rpp: 'RPP-0874', label });
}

function isSha256(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function assertNoNeedles(value, needles) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
