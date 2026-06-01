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
  'docs/evidence/rpp-0894-large-media-library-topology-v5.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0894-large-media-library-topology-v5';
const variant = 'RPP-0894-variant-5';
const topologyCommand = 'npm run verify:release:docker-local-production';
const releaseVerifierCommand = 'npm run verify:release';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0894',
  resource: 'reprint-push-release-state-row',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const requiredMediaSurfaces = Object.freeze([
  'wp_posts:attachment',
  'wp_postmeta:attachment-metadata',
  'uploads-file-hash-manifest',
  'large-media-fast-path-lane',
  'wordpress-export-attachment-manifest',
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
  'release-verifier-large-media-topology-v5-carry-through',
  'large-media-library-topology-v5-production-backed-proof',
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
  capability: 'complete-external-wordpress-topology-v5-with-auth',
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
  capability: 'large-media-library-real-wordpress-import-export-survival-artifact-v5',
  artifactProvided: false,
  requiredFor: [
    'large-media-attachment-and-metadata-survival',
    'plugin-evidence-import-export-survival',
    'graph-evidence-import-export-survival',
    'release-verifier-same-artifact-review',
  ],
});

const requiredProductionTopologyEvidence = Object.freeze({
  topologyClass: 'far-production-topology',
  topologyVariant: 'external-wordpress-topology-v5',
  realImportExportTopologyRequired: true,
  importRouteHashRequired: true,
  exportRouteHashRequired: true,
  liveRouteReceiptHashRequired: true,
  sameArtifactBindingHashRequired: true,
  releaseVerifierArtifactHashRequired: true,
  noPackagedFallbackRequired: true,
});

const forbiddenNeedles = Object.freeze([
  'https://',
  'http://',
  'source.example.test',
  'changed.example.test',
  '127.0.0.1',
  'localhost',
  'rpp-0894-application-password-must-not-leak',
  'media-base-payload',
  'media-planned-payload',
  'media-drift-payload',
  'wp-content/uploads',
  'attachment title',
  'metadata value',
  'ngrok',
  'cloudflared',
  'localtunnel',
]);

test('RPP-0894 support report records release verifier large media topology variant 5 scope', () => {
  const { report, text } = loadSupportReport();
  const acceptedFixture = successfulRealLargeMediaImportExportArtifact();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0894');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 5);
  assert.equal(report.title, 'Large media library topology variant 5 release verifier support report');
  assert.equal(report.coverageMode, 'release-verifier-carry-through-local-support-only');
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
      rppId: 'RPP-0874',
      variant: 4,
      evidenceFile: 'docs/evidence/rpp-0874-large-media-library-topology-v4.md',
      testFile: 'test/rpp-0874-large-media-library-topology-v4.test.js',
      supportOnly: true,
    },
    variant5ProductionTopologyPatterns: [
      'RPP-0881-three-site-local-production-topology-v5',
      'RPP-0882-docker-wordpress-topology-v5',
      'RPP-0883-external-wordpress-topology-v5',
      'RPP-0896-plugin-update-hooks-topology-v5',
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
    regressionId: 'RPP-0894-same-artifact-large-media-plugin-graph-release-verifier-survival',
    variant: 5,
    topologyClass: 'far-production-topology',
    supportOnlyUntilRealImportExportArtifact: true,
    releaseVerifierCarryThroughRequired: true,
    sameArtifactBindingHashRequired: true,
    componentBindingHashesRequired: true,
    rejectsSplitSurvivalEvidence: true,
    deterministicAssertions: [
      'real-wordpress-import-export-runtime-only',
      'large-media-import-and-export-observed',
      'attachment-and-metadata-counts-preserved',
      'plugin-driver-evidence-survives-import-and-export',
      'all-required-graph-types-survive-import-and-export',
      'production-topology-route-hashes-present',
      'release-verifier-carries-same-artifact-hash',
      'packaged-only-evidence-rejected',
      'same-artifact-component-bindings-match',
      'hash-count-surface-only-evidence',
    ],
  });

  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0894-large-media-library-topology-v5.md',
    'test/rpp-0894-large-media-library-topology-v5.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.sharedTopologyModified, false);
  assert.equal(report.writeScope.releaseVerifierModified, false);
  assert.equal(report.writeScope.packageMetadataModified, false);
  assert.equal(report.writeScope.sharedScriptsModified, false);
  assert.equal(report.writeScope.unrelatedTestsModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelsAllowed, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.equal(report.artifactIdentity.fixtureId, 'rpp-0894-v5-deterministic-same-artifact-contract');
  assert.equal(report.artifactIdentity.fixtureRuntime, 'real-wordpress-import-export');
  assert.equal(report.artifactIdentity.fixtureArtifactHash, digest(sanitizedArtifactFor(acceptedFixture)));
  assert.equal(report.artifactIdentity.fixtureArtifactBindingHash, artifactBindingHashFor(acceptedFixture));
  assert.equal(report.artifactIdentity.realArtifactProvidedInSandbox, false);
  assert.equal(report.artifactIdentity.rawArtifactValuesStored, false);
  assert.equal(report.artifactIdentity.bindingCovers.length, 6);
  assert.ok(report.artifactIdentity.bindingCovers.includes('release-verifier-carry-through'));

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
    'docker runtime or complete external WordPress topology v5',
    'real WordPress large media import/export survival artifact',
    'same-artifact media plugin graph topology and release-verifier binding',
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
    'mediaLibrarySurfaceHash',
  ]);
  assert.deepEqual(report.contractRequirements.requiredPluginEvidence, {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKind: 'plugin-driver-row',
    resourceKeyHash: pluginResourceKeyHash,
    importSurvivalRequired: true,
    exportSurvivalRequired: true,
    livePreconditionHashRequired: true,
    artifactBindingRequired: true,
  });
  assert.deepEqual(report.contractRequirements.requiredGraphEvidence, [...requiredGraphTypes]);
  assert.deepEqual(
    report.contractRequirements.requiredProductionTopologyEvidence,
    requiredProductionTopologyEvidence,
  );
  assert.deepEqual(report.contractRequirements.requiredReleaseVerifierEvidence, {
    command: releaseVerifierCommand,
    topologyCommand,
    carriedThroughByTopologyCommand: true,
    releaseCommandIsVerifyRelease: true,
    topologyValidationOk: true,
    acceptedSameArtifact: true,
    noPackagedFallback: true,
    artifactBindingRequired: true,
  });
  assert.equal(report.contractRequirements.artifactBindingHashRequired, true);
  assert.equal(report.contractRequirements.componentBindingHashesRequired, true);
  assert.equal(report.contractRequirements.actualProductionBackedArtifactRequiredForGo, true);

  assert.equal(report.releaseVerifierCarryThrough.command, releaseVerifierCommand);
  assert.equal(report.releaseVerifierCarryThrough.topologyCommand, topologyCommand);
  assert.equal(report.releaseVerifierCarryThrough.status, 'support-only-contract-fixture');
  assert.equal(report.releaseVerifierCarryThrough.packagedFallbackAllowed, false);
  assert.equal(report.releaseVerifierCarryThrough.packagedFallbackObserved, false);
  assert.equal(report.releaseVerifierCarryThrough.releaseMovementAllowed, false);
  assert.deepEqual(report.releaseVerifierCarryThrough.requiredGuarantees, [
    'same-artifact-binding-hash-present-on-release-verifier-evidence',
    'release-verifier-report-hash-present',
    'topology-validation-ok',
    'no-packaged-fallback-observed',
    'release-status-remains-no-go-until-production-artifact-exists',
  ]);

  assert.equal(report.candidateScope.status, 'large-media-library-topology-candidate-v5');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'rpp-0874-large-media-plus-variant-5-release-verifier-patterns');
  assert.equal(report.candidateScope.mediaRequirements.surfaceCount, requiredMediaSurfaces.length);
  assert.deepEqual(report.candidateScope.mediaRequirements.requiredMediaSurfaces, [...requiredMediaSurfaces]);
  assert.equal(report.candidateScope.mediaRequirements.surfaceDigest, sha256Evidence(requiredMediaSurfaces));
  assert.equal(report.candidateScope.graphRequirements.graphTypeCount, requiredGraphTypes.length);
  assert.deepEqual(report.candidateScope.graphRequirements.requiredGraphTypes, [...requiredGraphTypes]);
  assert.equal(report.candidateScope.graphRequirements.graphDigest, sha256Evidence(requiredGraphTypes));
  assert.deepEqual(report.candidateScope.acceptanceRules, [
    'real-wordpress-import-export-runtime-only',
    'production-backed-artifact-required',
    'external-wordpress-topology-v5-live-route-readback-required',
    'large-media-attachment-and-metadata-hash-count-readback',
    'plugin-driver-evidence-survives-import-and-export',
    'all-required-graph-types-survive-import-and-export',
    'release-verifier-carry-through-required',
    'same-artifact-component-bindings-required',
    'packaged-only-evidence-rejected',
    'artifact-stays-hash-count-surface-only',
  ]);
  assert.ok(report.candidateScope.excludedFromCandidate.includes('final-release-go-decision'));
  assert.ok(report.candidateScope.candidateClaims.includes('rpp-0874-large-media-contract-carried-forward'));
  assert.ok(report.candidateScope.candidateClaims.includes('variant-5-release-verifier-carry-through-recorded'));

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
      'same-artifact-large-media-plugin-graph-topology-release-verifier-binding',
    ),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-real-large-media-import-export-survival-artifact'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-support-final-release-go'));

  assert.match(report.scopeHash, sha256Pattern);
  assert.equal(report.scopeHash, digest(scopeHashInput(report)));
});

test('RPP-0894 records missing real WordPress import/export evidence as fail-closed NO-GO', () => {
  const proof = evaluateLargeMediaLibraryTopologyV5({
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
  assert.equal(proof.releaseVerifierCarryThroughSatisfied, false);
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.blocker.code, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.deepEqual(proof.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology v5',
    'real WordPress large media import/export survival artifact',
    'same-artifact media plugin graph topology and release-verifier binding',
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
  assert.deepEqual(proof.releaseVerifier, missingReleaseVerifierEvidence());
});

test('RPP-0894 accepts only one same-artifact real WordPress import/export survival proof', () => {
  const proof = evaluateLargeMediaLibraryTopologyV5({
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
  assert.equal(proof.releaseVerifierCarryThroughSatisfied, true);
  assert.equal(proof.releaseVerifierReviewRequired, false);
  assert.equal(proof.finalReleaseDecision, 'NO-GO-support-only-fixture-requires-production-review');
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
  assert.equal(proof.topology.topologyVariant, 'external-wordpress-topology-v5');
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
  assert.equal(proof.releaseVerifier.command, releaseVerifierCommand);
  assert.equal(proof.releaseVerifier.topologyCommand, topologyCommand);
  assert.equal(proof.releaseVerifier.carriedThroughByTopologyCommand, true);
  assert.equal(proof.releaseVerifier.acceptedSameArtifact, true);
  assert.equal(proof.releaseVerifier.noPackagedFallback, true);
  assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
  assert.match(proof.releaseVerifier.releaseVerifierReportHash, sha256Pattern);
  assert.equal(proof.artifactBinding.matchesArtifact, true);
  assert.equal(proof.artifactBinding.allComponentBindingsMatch, true);
  assert.deepEqual(proof.artifactBinding.componentBindingMismatches, []);
  assert.match(proof.artifactHash, sha256Pattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0894 accepted same-artifact contract fixture',
  }));
});

test('RPP-0894 rejects packaged-only, split, missing, and non-surviving evidence', () => {
  const missingProof = evaluateLargeMediaLibraryTopologyV5({
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

  const packagedOnly = successfulRealLargeMediaImportExportArtifact();
  packagedOnly.runtime = 'packaged-release-artifact';
  packagedOnly.importExport.packagedOnly = true;
  packagedOnly.releaseVerifier.packagedFallbackObserved = true;

  const packagedProof = evaluateLargeMediaLibraryTopologyV5({
    observedImportExport: packagedOnly,
    now: fixedNow,
  });

  assert.equal(packagedProof.ok, false);
  assert.ok(packagedProof.failures.some((failure) =>
    failure.code === 'PACKAGED_ONLY_EVIDENCE_REJECTED'));
  assert.ok(packagedProof.failures.some((failure) =>
    failure.code === 'RELEASE_VERIFIER_PACKAGED_FALLBACK_REJECTED'));

  const split = successfulRealLargeMediaImportExportArtifact();
  split.pluginEvidence.artifactBindingHash = sampleHash('split-plugin-evidence-binding');
  split.graphEvidence[1].artifactBindingHash = sampleHash('split-graph-evidence-binding');
  split.releaseVerifier.artifactBindingHash = sampleHash('split-release-verifier-binding');

  const splitProof = evaluateLargeMediaLibraryTopologyV5({
    observedImportExport: split,
    now: fixedNow,
  });

  assert.equal(splitProof.ok, false);
  assert.equal(splitProof.artifactBinding.matchesArtifact, true);
  assert.equal(splitProof.artifactBinding.allComponentBindingsMatch, false);
  assert.deepEqual(splitProof.artifactBinding.componentBindingMismatches, [
    'plugin',
    'graph:attachment-postmeta-round-trip',
    'releaseVerifier',
  ]);
  assert.ok(splitProof.failures.some((failure) =>
    failure.code === 'SAME_ARTIFACT_COMPONENT_BINDING_REQUIRED'));

  const missingComponents = successfulRealLargeMediaImportExportArtifact();
  missingComponents.importExport.attachmentRowsObserved = 0;
  missingComponents.importExport.attachmentMetadataRowsObserved = 0;
  missingComponents.importExport.uploadsManifestHash = null;
  missingComponents.pluginEvidence = null;
  missingComponents.graphEvidence = [];

  const missingComponentProof = evaluateLargeMediaLibraryTopologyV5({
    observedImportExport: missingComponents,
    now: fixedNow,
  });

  assert.equal(missingComponentProof.ok, false);
  assert.ok(missingComponentProof.failures.some((failure) =>
    failure.code === 'LARGE_MEDIA_SURFACE_INSUFFICIENT'));
  assert.ok(missingComponentProof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_MISSING'));
  assert.ok(missingComponentProof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(missingComponentProof.graphEvidence.missingTypes, [...requiredGraphTypes]);

  const nonSurviving = successfulRealLargeMediaImportExportArtifact();
  nonSurviving.importExport.exportObserved = false;
  nonSurviving.pluginEvidence.survivedImport = false;
  nonSurviving.graphEvidence[0].survivedExport = false;
  bindArtifact(nonSurviving);

  const nonSurvivingProof = evaluateLargeMediaLibraryTopologyV5({
    observedImportExport: nonSurviving,
    now: fixedNow,
  });

  assert.equal(nonSurvivingProof.ok, false);
  assert.ok(nonSurvivingProof.failures.some((failure) =>
    failure.code === 'IMPORT_EXPORT_SURVIVAL_NOT_OBSERVED'));
  assert.ok(nonSurvivingProof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_IMPORT_SURVIVAL_MISSING'));
  assert.ok(nonSurvivingProof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(nonSurvivingProof.graphEvidence.missingTypes, ['featured-image-attachment']);
  assertNoNeedles(nonSurvivingProof, forbiddenNeedles);
});

test('RPP-0894 evidence remains redacted, support-only, and release NO-GO', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0894 large media topology v5 support report' }));
  assert.deepEqual(report.redaction, {
    format: 'hash-count-surface-only',
    rawHostValuesIncluded: false,
    rawUrlValuesIncluded: false,
    credentialMaterialIncluded: false,
    rawMediaValuesIncluded: false,
    pluginRawValuesIncluded: false,
    graphRawValuesIncluded: false,
    rawArtifactValuesIncluded: false,
    tunnelOutputIncluded: false,
    scopeHashCovers: [
      'sourcePattern',
      'focusedRegression',
      'artifactIdentity',
      'currentSandboxObservation',
      'contractRequirements',
      'releaseVerifierCarryThrough',
      'candidateScope',
      'releaseReadyScope',
      'failClosed',
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

test('RPP-0894 evidence documents exact validation commands and results', () => {
  const { report } = loadSupportReport();

  assert.deepEqual(report.validation.commands.map((entry) => entry.command), [
    'node --check test/rpp-0894-large-media-library-topology-v5.test.js',
    'node --test --test-name-pattern RPP-0894 test/rpp-0894-large-media-library-topology-v5.test.js',
    'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0894-large-media-library-topology-v5.md',
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

  assert.ok(match?.groups?.json, 'RPP-0894 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function evaluateLargeMediaLibraryTopologyV5({
  commandInventory = {},
  externalWordPressConfig = {},
  observedImportExport = null,
  now = fixedNow,
} = {}) {
  const validation = validateObservedImportExportSurvival(observedImportExport);
  const runtimeAvailable = Boolean(
    validation.importExport.realWordPress
      || commandInventory.docker?.usable === true
      || externalWordPressConfig.complete === true,
  );
  const missingCapabilities = buildExactMissingCapabilities({
    runtimeAvailable,
    observedImportExport,
    validation,
  });
  const failures = [
    ...(!runtimeAvailable && observedImportExport === null
      ? [{
          code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
          reason: 'Docker runtime or complete external WordPress topology v5 is unavailable.',
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
    releaseVerifierCarryThroughSatisfied:
      ok && validation.releaseVerifier.acceptedSameArtifact === true,
    releaseReady: false,
    readyForReleaseMovement: false,
    acceptedForReleaseGate: false,
    acceptedForSupportContract: ok,
    releaseVerifierReviewRequired: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    finalReleaseDecision: ok
      ? 'NO-GO-support-only-fixture-requires-production-review'
      : 'NO-GO',
    releasePosture: 'NO-GO',
    blocker: ok
      ? null
      : { code: primaryFailureCode(failures) },
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
    releaseVerifier: validation.releaseVerifier,
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
      releaseVerifier: missingReleaseVerifierEvidence(),
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
  const releaseVerifier = observed.releaseVerifier || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const expectedArtifactBindingHash = artifactBindingHashFor(observed);
  const componentBindings = componentArtifactBindings({
    observed,
    topology,
    importExport,
    plugin,
    graphEntries,
    releaseVerifier,
    expectedArtifactBindingHash,
  });
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphTypes.includes(entry?.type)
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.roundTripHash)
      && entry.artifactBindingHash === expectedArtifactBindingHash)
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphTypes.filter((type) => !survivedGraphTypes.includes(type));
  const packagedOnly = observed.packagedOnly === true
    || observed.runtime === 'packaged-release-artifact'
    || importExport.packagedOnly === true;
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0894 requires real WordPress import/export, not local Playground, packaged, or synthetic substitute evidence.',
    });
  }
  if (packagedOnly) {
    failures.push({
      code: 'PACKAGED_ONLY_EVIDENCE_REJECTED',
      reason: 'Packaged-only evidence cannot satisfy real WordPress import/export survival.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_ARTIFACT_REQUIRED',
      reason: 'RPP-0894 remains support-only until production-backed proof is supplied.',
    });
  }
  if (
    topology.topologyClass !== 'far-production-topology'
    || topology.topologyVariant !== 'external-wordpress-topology-v5'
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
      code: 'EXTERNAL_TOPOLOGY_V5_LIVE_READBACK_REQUIRED',
      reason: 'The artifact must prove external topology v5 route and media-library readbacks by hash.',
    });
  }
  if (importExport.importObserved !== true || importExport.exportObserved !== true) {
    failures.push({
      code: 'IMPORT_EXPORT_SURVIVAL_NOT_OBSERVED',
      reason: 'Both real WordPress import and export-after-import survival must be observed.',
    });
  }
  if (
    importExport.attachmentRowsObserved < 144
    || importExport.attachmentMetadataRowsObserved < 576
    || !isSha256(importExport.uploadsManifestHash)
    || !isSha256(topology.mediaLibrarySurfaceHash)
  ) {
    failures.push({
      code: 'LARGE_MEDIA_SURFACE_INSUFFICIENT',
      reason: 'The artifact must show large media attachment rows, metadata rows, uploads manifest, and media-library surface hash.',
    });
  }
  if (![importExport.importedSnapshotHash, importExport.exportedSnapshotHash].every(isSha256)) {
    failures.push({
      code: 'IMPORT_EXPORT_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only imported and exported snapshot evidence.',
    });
  }
  if (!observed.pluginEvidence) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_MISSING',
      reason: 'The artifact does not carry plugin-driver evidence.',
    });
  } else if (
    plugin.driver !== pluginDriver
    || plugin.owner !== pluginOwner
    || plugin.resourceKeyHash !== pluginResourceKeyHash
  ) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_DRIVER_MISMATCH',
      reason: 'The artifact does not carry the required reprint-push plugin driver evidence.',
    });
  }
  if (observed.pluginEvidence && plugin.survivedImport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_IMPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after import.',
    });
  }
  if (observed.pluginEvidence && plugin.survivedExport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after export.',
    });
  }
  if (observed.pluginEvidence && !isSha256(plugin.livePreconditionHash)) {
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
  if (!releaseVerifierCarriesSameArtifact(releaseVerifier, expectedArtifactBindingHash)) {
    failures.push({
      code: 'RELEASE_VERIFIER_CARRY_THROUGH_MISSING',
      reason: 'The release verifier must carry the same artifact binding hash without packaged fallback.',
    });
  }
  if (
    releaseVerifier.packagedFallbackAllowed !== false
    || releaseVerifier.packagedFallbackObserved !== false
    || releaseVerifier.noPackagedFallback !== true
  ) {
    failures.push({
      code: 'RELEASE_VERIFIER_PACKAGED_FALLBACK_REJECTED',
      reason: 'Packaged fallback cannot satisfy the large media import/export survival proof.',
    });
  }
  if (componentBindings.rootMatches !== true) {
    failures.push({
      code: 'SAME_ARTIFACT_BINDING_REQUIRED',
      reason: 'The import/export, media, plugin, graph, topology, and release verifier evidence must share one root artifact binding hash.',
    });
  }
  if (componentBindings.allComponentBindingsMatch !== true) {
    failures.push({
      code: 'SAME_ARTIFACT_COMPONENT_BINDING_REQUIRED',
      reason: 'Every component must carry the same artifact binding hash.',
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
      artifactBindingHash: isSha256(topology.artifactBindingHash)
        ? topology.artifactBindingHash
        : null,
    },
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      productionBacked: importExport.productionBacked === true,
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
      packagedOnly,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
        ? importExport.importedSnapshotHash
        : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
        ? importExport.exportedSnapshotHash
        : null,
      artifactBindingHash: isSha256(importExport.artifactBindingHash)
        ? importExport.artifactBindingHash
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
    pluginEvidence: observed.pluginEvidence ? {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      livePreconditionHash: isSha256(plugin.livePreconditionHash)
        ? plugin.livePreconditionHash
        : null,
      artifactBindingHash: isSha256(plugin.artifactBindingHash)
        ? plugin.artifactBindingHash
        : null,
    } : missingPluginEvidence(),
    graphEvidence: {
      requiredTypes: [...requiredGraphTypes],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    releaseVerifier: {
      command: releaseVerifier.command || null,
      topologyCommand: releaseVerifier.topologyCommand || null,
      carriedThroughByTopologyCommand: releaseVerifier.carriedThroughByTopologyCommand === true,
      releaseCommandIsVerifyRelease: releaseVerifier.releaseCommandIsVerifyRelease === true,
      topologyValidationOk: releaseVerifier.topologyValidationOk === true,
      acceptedSameArtifact: releaseVerifier.acceptedSameArtifact === true,
      noPackagedFallback: releaseVerifier.noPackagedFallback === true,
      packagedFallbackAllowed: releaseVerifier.packagedFallbackAllowed === false ? false : true,
      packagedFallbackObserved: releaseVerifier.packagedFallbackObserved === true,
      releaseVerifierReportHash: isSha256(releaseVerifier.releaseVerifierReportHash)
        ? releaseVerifier.releaseVerifierReportHash
        : null,
      artifactBindingHash: isSha256(releaseVerifier.artifactBindingHash)
        ? releaseVerifier.artifactBindingHash
        : null,
    },
    artifactBinding: {
      required: true,
      expectedArtifactBindingHash,
      providedArtifactBindingHash: componentBindings.root,
      matchesArtifact: componentBindings.rootMatches,
      allComponentBindingsMatch: componentBindings.allComponentBindingsMatch,
      componentBindingMismatches: componentBindings.componentBindingMismatches,
    },
    sanitizedArtifact: sanitizedArtifactFor(observed),
    failures,
  };
}

function releaseVerifierCarriesSameArtifact(releaseVerifier, expectedArtifactBindingHash) {
  return releaseVerifier.command === releaseVerifierCommand
    && releaseVerifier.topologyCommand === topologyCommand
    && releaseVerifier.carriedThroughByTopologyCommand === true
    && releaseVerifier.releaseCommandIsVerifyRelease === true
    && releaseVerifier.topologyValidationOk === true
    && releaseVerifier.acceptedSameArtifact === true
    && releaseVerifier.noPackagedFallback === true
    && releaseVerifier.packagedFallbackAllowed === false
    && releaseVerifier.packagedFallbackObserved === false
    && releaseVerifier.artifactBindingHash === expectedArtifactBindingHash
    && isSha256(releaseVerifier.releaseVerifierReportHash);
}

function componentArtifactBindings({
  observed,
  topology,
  importExport,
  plugin,
  graphEntries,
  releaseVerifier,
  expectedArtifactBindingHash,
}) {
  const root = isSha256(observed.artifactBindingHash) ? observed.artifactBindingHash : null;
  const componentEntries = [
    ['topology', topology.artifactBindingHash],
    ['importExport', importExport.artifactBindingHash],
    ['plugin', plugin.artifactBindingHash],
    ...requiredGraphTypes.map((type) => {
      const entry = graphEntries.find((candidate) => candidate?.type === type);
      return [`graph:${type}`, entry?.artifactBindingHash];
    }),
    ['releaseVerifier', releaseVerifier.artifactBindingHash],
  ];
  const componentBindingMismatches = componentEntries
    .filter(([, hash]) => hash !== expectedArtifactBindingHash)
    .map(([name]) => name);

  return {
    root,
    rootMatches: root === expectedArtifactBindingHash,
    allComponentBindingsMatch: componentBindingMismatches.length === 0,
    componentBindingMismatches,
  };
}

function successfulRealLargeMediaImportExportArtifact() {
  const artifact = {
    runtime: 'real-wordpress-import-export',
    packagedOnly: false,
    topology: {
      topologyClass: 'far-production-topology',
      topologyVariant: 'external-wordpress-topology-v5',
      realImportExportTopology: true,
      sourceLocalChangedRoleIdentitiesCaptured: true,
      roleIdentityHashesOnly: true,
      routeSourceIdentitiesMatch: true,
      importRouteHash: sampleHash('production-topology-v5-import-route'),
      exportRouteHash: sampleHash('production-topology-v5-export-route'),
      liveRouteReceiptsHash: sampleHash('production-topology-v5-live-route-receipts'),
      mediaLibrarySurfaceHash: sampleHash('media-library-v5-surface'),
    },
    importExport: {
      realWordPress: true,
      productionBacked: true,
      importObserved: true,
      exportObserved: true,
      packagedOnly: false,
      importedSnapshotHash: sampleHash('imported-snapshot-v5'),
      exportedSnapshotHash: sampleHash('exported-snapshot-v5'),
      uploadsManifestHash: sampleHash('uploads-manifest-v5'),
      attachmentRowsObserved: 144,
      attachmentMetadataRowsObserved: 576,
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      survivedImport: true,
      survivedExport: true,
      livePreconditionHash: sampleHash('plugin-live-precondition-v5'),
    },
    graphEvidence: requiredGraphTypes.map((type) => ({
      type,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition-v5`),
      roundTripHash: sampleHash(`${type}-round-trip-v5`),
    })),
    releaseVerifier: {
      command: releaseVerifierCommand,
      topologyCommand,
      carriedThroughByTopologyCommand: true,
      releaseCommandIsVerifyRelease: true,
      topologyValidationOk: true,
      acceptedSameArtifact: true,
      noPackagedFallback: true,
      packagedFallbackAllowed: false,
      packagedFallbackObserved: false,
      releaseVerifierReportHash: sampleHash('release-verifier-report-v5'),
    },
  };
  return bindArtifact(artifact);
}

function bindArtifact(artifact) {
  const artifactBindingHash = artifactBindingHashFor(artifact);

  artifact.artifactBindingHash = artifactBindingHash;
  artifact.topology.artifactBindingHash = artifactBindingHash;
  artifact.importExport.artifactBindingHash = artifactBindingHash;
  artifact.pluginEvidence.artifactBindingHash = artifactBindingHash;
  artifact.graphEvidence = artifact.graphEvidence.map((entry) => ({
    ...entry,
    artifactBindingHash,
  }));
  artifact.releaseVerifier.artifactBindingHash = artifactBindingHash;

  return artifact;
}

function sanitizedArtifactFor(observed) {
  const topology = observed?.topology || {};
  const importExport = observed?.importExport || {};
  const plugin = observed?.pluginEvidence || {};
  const releaseVerifier = observed?.releaseVerifier || {};
  const graphEntries = Array.isArray(observed?.graphEvidence) ? observed.graphEvidence : [];

  return {
    runtime: observed?.runtime || null,
    packagedOnly: observed?.packagedOnly === true,
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
      packagedOnly: importExport.packagedOnly === true,
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
    releaseVerifier: {
      command: releaseVerifier.command || null,
      topologyCommand: releaseVerifier.topologyCommand || null,
      carriedThroughByTopologyCommand: releaseVerifier.carriedThroughByTopologyCommand === true,
      releaseCommandIsVerifyRelease: releaseVerifier.releaseCommandIsVerifyRelease === true,
      topologyValidationOk: releaseVerifier.topologyValidationOk === true,
      acceptedSameArtifact: releaseVerifier.acceptedSameArtifact === true,
      noPackagedFallback: releaseVerifier.noPackagedFallback === true,
      packagedFallbackAllowed: releaseVerifier.packagedFallbackAllowed === true,
      packagedFallbackObserved: releaseVerifier.packagedFallbackObserved === true,
      releaseVerifierReportHash: isSha256(releaseVerifier.releaseVerifierReportHash)
        ? releaseVerifier.releaseVerifierReportHash
        : null,
    },
  };
}

function artifactBindingHashFor(observed) {
  return digest({
    artifact: sanitizedArtifactFor(observed),
    requiredMediaSurfaces: [...requiredMediaSurfaces],
    requiredGraphTypes: [...requiredGraphTypes],
    productionTopologyEvidence: requiredProductionTopologyEvidence,
    releaseVerifier: {
      command: releaseVerifierCommand,
      topologyCommand,
      noPackagedFallbackRequired: true,
    },
  });
}

function buildExactMissingCapabilities({ runtimeAvailable, observedImportExport, validation }) {
  if (validation.failures.length === 0) {
    return [];
  }

  return [
    ...(!runtimeAvailable
      ? ['docker runtime or complete external WordPress topology v5']
      : []),
    ...(observedImportExport === null
      ? ['real WordPress large media import/export survival artifact']
      : []),
    ...(validation.artifactBinding?.matchesArtifact !== true
      || validation.artifactBinding?.allComponentBindingsMatch !== true
      ? ['same-artifact media plugin graph topology and release-verifier binding']
      : []),
  ];
}

function primaryFailureCode(failures) {
  if (failures.some((failure) => failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING')) {
    return 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING';
  }
  return failures[0]?.code || 'UNKNOWN_RPP_0894_FAILURE';
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
    artifactBindingHash: null,
  };
}

function missingImportExportEvidence() {
  return {
    runtime: null,
    realWordPress: false,
    productionBacked: false,
    importObserved: false,
    exportObserved: false,
    packagedOnly: false,
    importedSnapshotHash: null,
    exportedSnapshotHash: null,
    artifactBindingHash: null,
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
    driver: null,
    owner: null,
    resourceKeyHash: pluginResourceKeyHash,
    survivedImport: false,
    survivedExport: false,
    livePreconditionHash: null,
    artifactBindingHash: null,
  };
}

function missingGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphTypes],
    survivedTypes: [],
    missingTypes: [...requiredGraphTypes],
  };
}

function missingReleaseVerifierEvidence() {
  return {
    command: null,
    topologyCommand: null,
    carriedThroughByTopologyCommand: false,
    releaseCommandIsVerifyRelease: false,
    topologyValidationOk: false,
    acceptedSameArtifact: false,
    noPackagedFallback: false,
    packagedFallbackAllowed: true,
    packagedFallbackObserved: false,
    releaseVerifierReportHash: null,
    artifactBindingHash: null,
  };
}

function missingArtifactBinding() {
  return {
    required: true,
    expectedArtifactBindingHash: null,
    providedArtifactBindingHash: null,
    matchesArtifact: false,
    allComponentBindingsMatch: false,
    componentBindingMismatches: [
      'topology',
      'importExport',
      'plugin',
      ...requiredGraphTypes.map((type) => `graph:${type}`),
      'releaseVerifier',
    ],
  };
}

function scopeHashInput(report) {
  return {
    sourcePattern: report.sourcePattern,
    focusedRegression: report.focusedRegression,
    artifactIdentity: report.artifactIdentity,
    currentSandboxObservation: report.currentSandboxObservation,
    contractRequirements: report.contractRequirements,
    releaseVerifierCarryThrough: report.releaseVerifierCarryThrough,
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    failClosed: report.failClosed,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
    successTarget: report.successTarget,
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function sampleHash(label) {
  return digest({ rpp: 'RPP-0894', label });
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
