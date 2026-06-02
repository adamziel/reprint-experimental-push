import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0884-brewcommerce-blueprint-import-v5.md',
);
const defaultBrewcommerceDir = '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce';
const proofId = 'rpp-0884-brewcommerce-blueprint-import-v5';
const variant = 'RPP-0884-variant-5';
const fixedNow = '2026-06-01T00:00:00.000Z';
const releaseVerifierCommand = 'npm run verify:release';
const requiredBlueprintAssets = Object.freeze([
  'blueprint.json',
  'content.xml',
  'database.sql',
  'ensure-media.php',
  'theme.zip',
  'uploads.zip',
]);
const requiredGraphTypes = Object.freeze([
  'featured-image-attachment',
  'category-term-relationship-termmeta',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
]);
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const shaPattern = /^[a-f0-9]{64}$/;
const requiredForRealImportExport = Object.freeze([
  'brewcommerce-real-wordpress-import',
  'wordpress-export-after-import',
  'plugin-and-graph-survival-readback',
  'release-verifier-carry-through',
  'brewcommerce-blueprint-import-v5-production-backed-proof',
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
  capability: 'complete-external-wordpress-topology',
  configurationPresent: false,
  requiredFor: [...requiredForRealImportExport],
});
const requiredProductionTopologyEvidence = Object.freeze({
  topologyClass: 'far-production-topology',
  realImportExportTopologyRequired: true,
  importRouteHashRequired: true,
  exportRouteHashRequired: true,
  sameArtifactBindingHashRequired: true,
  releaseVerifierCarryThroughRequired: true,
  packagedFallbackRejectedRequired: true,
});
const releaseVerifierCarryThroughRequirements = Object.freeze([
  'verify-release-command-recorded',
  'release-verifier-carries-import-export-survival-artifact',
  'same-artifact-plugin-graph-binding-required',
  'packaged-fallback-rejected',
  'release-movement-blocked-for-support-evidence',
]);

test('RPP-0884 support report records release-verifier BrewCommerce import scope as support-only evidence', () => {
  const { report, text } = loadSupportReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0884');
  assert.equal(report.variant, 5);
  assert.equal(report.title, 'BrewCommerce blueprint import support report');
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
  assert.match(text, /support-only release-verifier carry-through/);
  assert.match(text, /This is not a production-backed proof\./);
  assert.match(text, /The positive branch is a deterministic contract fixture/);

  assert.deepEqual(report.sourcePattern, {
    importExportContracts: [
      {
        rppId: 'RPP-0804',
        variant: 1,
        evidenceFile: 'docs/evidence/rpp-0804-brewcommerce-blueprint-import-v1.md',
        testFile: 'test/rpp-0804-brewcommerce-blueprint-import-v1.test.js',
      },
      {
        rppId: 'RPP-0824',
        variant: 2,
        evidenceFile: 'docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md',
        testFile: 'test/rpp-0824-brewcommerce-blueprint-import-v2.test.js',
      },
      {
        rppId: 'RPP-0844',
        variant: 3,
        evidenceFile: 'docs/evidence/rpp-0844-brewcommerce-blueprint-import-v3.md',
        testFile: 'test/rpp-0844-brewcommerce-blueprint-import-v3.test.js',
      },
      {
        rppId: 'RPP-0864',
        variant: 4,
        evidenceFile: 'docs/evidence/rpp-0864-brewcommerce-blueprint-import-v4.md',
        testFile: 'test/rpp-0864-brewcommerce-blueprint-import-v4.test.js',
      },
    ],
    productionTopologyPattern: {
      evidenceFiles: [
        'docs/evidence/rpp-0863-external-wordpress-topology-v4.md',
        'docs/evidence/rpp-0881-three-site-local-production-topology-v5.md',
      ],
      exactUnavailableCapabilityRequired: true,
      routeHashEvidenceRequired: true,
      releaseVerifierCarryThroughRequired: true,
      packagedFallbackRejectedRequired: true,
    },
    closestTemplates: [
      {
        rppId: 'RPP-0844',
        variant: 3,
        evidenceFile: 'docs/evidence/rpp-0844-brewcommerce-blueprint-import-v3.md',
        testFile: 'test/rpp-0844-brewcommerce-blueprint-import-v3.test.js',
      },
      {
        rppId: 'RPP-0864',
        variant: 4,
        evidenceFile: 'docs/evidence/rpp-0864-brewcommerce-blueprint-import-v4.md',
        testFile: 'test/rpp-0864-brewcommerce-blueprint-import-v4.test.js',
      },
    ],
    contractInherited: true,
  });
  assert.deepEqual(report.focusedRegression, {
    regressionId: 'RPP-0884-release-verifier-same-artifact-plugin-graph-survival',
    variant: 5,
    topologyClass: 'far-production-topology',
    supportOnlyUntilRealImportExportArtifact: true,
    releaseVerifierCarryThroughRequired: true,
    sameArtifactBindingHashRequired: true,
    rejectsSplitSurvivalEvidence: true,
    rejectsPackagedFallbackEvidence: true,
    deterministicAssertions: [
      'real-runtime-only',
      'blueprint-import-and-export-observed',
      'plugin-survives-import-and-export',
      'all-required-graph-types-survive-import-and-export',
      'production-topology-route-hashes-present',
      'release-verifier-carries-same-artifact-binding',
      'packaged-fallback-rejected',
      'same-artifact-binding-hash-matches',
      'placeholder-assets-fail-closed',
    ],
  });
  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0884-brewcommerce-blueprint-import-v5.md',
    'test/rpp-0884-brewcommerce-blueprint-import-v5.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.sharedTopologyModified, false);
  assert.equal(report.writeScope.releaseVerifierModified, false);
  assert.equal(report.writeScope.packageMetadataModified, false);
  assert.equal(report.writeScope.sharedScriptsModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelsAllowed, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.equal(report.currentSandboxObservation.brewcommerceFixtureDir, defaultBrewcommerceDir);
  assert.deepEqual(report.currentSandboxObservation.blueprintAssets['content.xml'], {
    present: true,
    size: 0,
    nonEmpty: false,
  });
  assert.deepEqual(report.currentSandboxObservation.blueprintAssets['database.sql'], {
    present: true,
    size: 0,
    nonEmpty: false,
  });
  assert.deepEqual(report.currentSandboxObservation.missingOrPlaceholderAssets, [
    'content.xml:size=0',
    'database.sql:size=0',
  ]);
  assert.equal(report.currentSandboxObservation.dockerCliUsable, false);
  assert.deepEqual(report.currentSandboxObservation.dockerUnavailableCapability, dockerUnavailableCapability);
  assert.equal(report.currentSandboxObservation.externalWordPressTopologyComplete, false);
  assert.deepEqual(
    report.currentSandboxObservation.externalTopologyUnavailableCapability,
    externalTopologyUnavailableCapability,
  );
  assert.equal(report.currentSandboxObservation.realImportExportArtifactPresent, false);
  assert.equal(
    report.currentSandboxObservation.primaryBlockerCode,
    'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  );
  assert.deepEqual(report.currentSandboxObservation.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology',
    'non-placeholder BrewCommerce import assets',
    'real WordPress import/export survival artifact',
  ]);
  assert.deepEqual(report.currentSandboxObservation.exactUnavailableCapabilities, [
    dockerUnavailableCapability,
    externalTopologyUnavailableCapability,
  ]);

  assert.deepEqual(report.releaseVerifier, {
    command: releaseVerifierCommand,
    carriedThroughByBrewcommerceImportGate: true,
    status: 'blocked-missing-real-import-export-artifact',
    supportOnlyCarryThrough: true,
    acceptedForReleaseGate: false,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    exactBlockerCode: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
    requiredCarryThrough: [...releaseVerifierCarryThroughRequirements],
  });
  assert.deepEqual(report.supportEvidenceBoundary, {
    supportReportIsProductionBackedArtifact: false,
    deterministicPositiveFixtureIsProductionClaim: false,
    realWordPressImportExportArtifactRequiredForGo: true,
    sameArtifactPluginAndGraphSurvivalRequired: true,
    releaseVerifierMayMoveReleaseWithoutArtifact: false,
    packagedFallbackMaySatisfyReleaseVerifier: false,
  });

  assert.equal(report.contractRequirements.runtime, 'real-wordpress-import-export');
  assert.equal(report.contractRequirements.realWordPressRequired, true);
  assert.equal(report.contractRequirements.brewcommerceImportObservedRequired, true);
  assert.equal(report.contractRequirements.wordpressExportAfterImportRequired, true);
  assert.deepEqual(report.contractRequirements.snapshotHashesRequired, [
    'importedSnapshotHash',
    'exportedSnapshotHash',
  ]);
  assert.deepEqual(report.contractRequirements.requiredPluginEvidence, {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKind: 'plugin-driver-row',
    resourceKey: pluginResourceKey,
    importSurvivalRequired: true,
    exportSurvivalRequired: true,
    livePreconditionHashRequired: true,
  });
  assert.deepEqual(report.contractRequirements.requiredGraphEvidence, [...requiredGraphTypes]);
  assert.equal(report.contractRequirements.artifactBindingHashRequired, true);
  assert.deepEqual(
    report.contractRequirements.requiredProductionTopologyEvidence,
    requiredProductionTopologyEvidence,
  );
  assert.deepEqual(report.contractRequirements.releaseVerifierCarryThrough, {
    command: releaseVerifierCommand,
    required: true,
    acceptedForReleaseGateAfterProductionBackedArtifactOnly: true,
    packagedFallbackAllowed: false,
    sameArtifactBindingHashRequired: true,
    releaseMovementAllowedFromSupportEvidence: false,
  });
  assert.equal(report.contractRequirements.actualProductionBackedArtifactRequiredForGo, true);
  assert.equal(report.scopeHash, digest(scopeHashInput(report)));
});

test('RPP-0884 records missing real WordPress import/export capability as fail-closed NO-GO', () => {
  const proof = evaluateBrewcommerceBlueprintImportV5({
    blueprintAssets: collectBlueprintAssetFacts(defaultBrewcommerceDir),
    commandInventory: {
      docker: { present: false, usable: false, missingExecutable: true },
      node: { present: true, usable: true },
      npm: { present: true, usable: true },
      npx: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: ['not configured for this support-only slice'],
    },
    observedImportExport: null,
    releaseVerifierObservation: blockedReleaseVerifierObservation(),
    now: fixedNow,
  });

  assert.equal(proof.event, proofId);
  assert.equal(proof.variant, variant);
  assert.equal(proof.ok, false);
  assert.equal(proof.releaseReadyArtifact, false);
  assert.equal(proof.productionBackedArtifact, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.releaseMovementAllowed, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releasePosture, 'NO-GO');
  assert.equal(proof.blocker.code, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'BREWCOMMERCE_BLUEPRINT_ASSETS_PLACEHOLDER_OR_MISSING'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING'));
  assert.deepEqual(proof.blueprint.missingOrPlaceholderAssets, [
    'content.xml:size=0',
    'database.sql:size=0',
  ]);
  assert.equal(proof.releaseVerifier.carriedThroughByBrewcommerceImportGate, true);
  assert.equal(proof.releaseVerifier.status, 'blocked-missing-real-import-export-artifact');
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(proof.constraints.sandboxIngressPort, 8080);
  assert.equal(proof.constraints.tunnelsProhibited, true);
  assert.deepEqual(proof.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology',
    'non-placeholder BrewCommerce import assets',
    'real WordPress import/export survival artifact',
  ]);
  assert.deepEqual(proof.exactUnavailableCapabilities, [
    dockerUnavailableCapability,
    externalTopologyUnavailableCapability,
  ]);
});

test('RPP-0884 accepts a production-backed artifact only when release verifier carries same-artifact plugin and graph survival', () => {
  const artifact = successfulRealImportExportArtifact();
  const proof = evaluateBrewcommerceBlueprintImportV5({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: [],
    },
    observedImportExport: artifact,
    releaseVerifierObservation: successfulReleaseVerifierObservation(artifact),
    now: fixedNow,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.releaseReadyArtifact, true);
  assert.equal(proof.productionBackedArtifact, true);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.releaseMovementAllowed, false);
  assert.equal(proof.acceptedForReleaseGate, true);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releasePosture, 'production-backed-artifact-candidate-no-release-movement');
  assert.equal(proof.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(proof.importExport.realWordPress, true);
  assert.equal(proof.importExport.importObserved, true);
  assert.equal(proof.importExport.exportObserved, true);
  assert.equal(proof.pluginEvidence.driver, pluginDriver);
  assert.equal(proof.pluginEvidence.owner, pluginOwner);
  assert.equal(proof.pluginEvidence.resourceKey, pluginResourceKey);
  assert.equal(proof.pluginEvidence.survivedImport, true);
  assert.equal(proof.pluginEvidence.survivedExport, true);
  assert.match(proof.pluginEvidence.livePreconditionHash, shaPattern);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.equal(proof.productionTopologyEvidence.topologyClass, 'far-production-topology');
  assert.equal(proof.productionTopologyEvidence.realImportExportTopology, true);
  assert.match(proof.productionTopologyEvidence.importRouteHash, shaPattern);
  assert.match(proof.productionTopologyEvidence.exportRouteHash, shaPattern);
  assert.equal(proof.productionTopologyEvidence.artifactBindingHash, proof.artifactBindingHash);
  assert.equal(proof.productionTopologyEvidence.bindingMatchesArtifact, true);
  assert.equal(proof.releaseVerifier.command, releaseVerifierCommand);
  assert.equal(proof.releaseVerifier.carriedThroughByBrewcommerceImportGate, true);
  assert.equal(proof.releaseVerifier.acceptedForReleaseGate, true);
  assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(proof.releaseVerifier.artifactBindingHash, proof.artifactBindingHash);
  assert.equal(proof.releaseVerifier.bindingMatchesArtifact, true);
  assert.match(proof.releaseVerifier.reportHash, shaPattern);
  assert.match(proof.artifactBindingHash, shaPattern);
  assert.match(proof.artifactHash, shaPattern);
  assert.deepEqual(proof.exactUnavailableCapabilities, []);

  const rejected = successfulRealImportExportArtifact();
  rejected.runtime = 'local-playground-wordpress';
  rejected.pluginEvidence.survivedExport = false;
  rejected.graphEvidence = rejected.graphEvidence.filter((entry) =>
    entry.type !== 'comment-parent-commentmeta');
  const partial = evaluateBrewcommerceBlueprintImportV5({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    observedImportExport: rejected,
    releaseVerifierObservation: successfulReleaseVerifierObservation(rejected),
    now: fixedNow,
  });

  assert.equal(partial.ok, false);
  assert.equal(partial.releaseReadyArtifact, false);
  assert.equal(partial.productionBackedArtifact, false);
  assert.equal(partial.readyForReleaseMovement, false);
  assert.equal(partial.releaseMovementAllowed, false);
  assert.equal(partial.acceptedForReleaseGate, false);
  assert.equal(partial.finalReleaseStatus, 'NO-GO');
  assert.equal(partial.integrationRecommendation, 'NO-GO');
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partial.graphEvidence.missingTypes, ['comment-parent-commentmeta']);
});

test('RPP-0884 rejects split survival evidence without a release-verifier same-artifact binding', () => {
  const split = successfulRealImportExportArtifact();
  split.artifactBindingHash = sampleHash('split-plugin-and-graph-survival');
  split.productionTopologyEvidence.artifactBindingHash = sampleHash('split-production-topology');

  const proof = evaluateBrewcommerceBlueprintImportV5({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    observedImportExport: split,
    releaseVerifierObservation: successfulReleaseVerifierObservation(split),
    now: fixedNow,
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.releaseReadyArtifact, false);
  assert.equal(proof.productionBackedArtifact, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.releaseMovementAllowed, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.failures.map((failure) => failure.code), [
    'IMPORT_EXPORT_ARTIFACT_BINDING_MISMATCH',
    'PRODUCTION_TOPOLOGY_ARTIFACT_BINDING_MISMATCH',
    'RELEASE_VERIFIER_ARTIFACT_BINDING_MISMATCH',
  ]);
  assert.equal(proof.artifactBindingHash, null);
  assert.equal(proof.productionTopologyEvidence.bindingMatchesArtifact, false);
  assert.equal(proof.releaseVerifier.bindingMatchesArtifact, false);
  assert.equal(proof.exactMissingCapabilities.length, 0);
});

test('RPP-0884 rejects packaged fallback release-verifier evidence even with valid-looking survival signals', () => {
  const artifact = successfulRealImportExportArtifact();
  const packagedFallback = successfulReleaseVerifierObservation(artifact);
  packagedFallback.status = 'packaged-fallback';
  packagedFallback.packagedFallbackObserved = true;
  packagedFallback.acceptedForReleaseGate = false;

  const proof = evaluateBrewcommerceBlueprintImportV5({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    observedImportExport: artifact,
    releaseVerifierObservation: packagedFallback,
    now: fixedNow,
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.releaseReadyArtifact, false);
  assert.equal(proof.productionBackedArtifact, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.releaseMovementAllowed, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'PACKAGED_FALLBACK_REJECTED'));
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, true);
  assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
});

test('RPP-0884 evidence remains redacted, support-only, and production-backed claims stay blocked', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0884 BrewCommerce support report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawPayloadValuesIncluded, false);
  assert.equal(report.redaction.rawGraphValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.equal(report.redaction.largeRawPayloadsIncluded, false);
  assert.deepEqual(report.redaction.scopeHashCovers, [
    'sourcePattern',
    'writeScope',
    'currentSandboxObservation',
    'contractRequirements',
    'releaseVerifier',
    'supportEvidenceBoundary',
    'failClosed',
    'focusedRegression',
    'integrationRecommendation',
  ]);
  assert.deepEqual(report.failClosed, {
    missingEvidenceReleasePosture: 'NO-GO',
    missingDockerOrLiveTopologyReleasePosture: 'NO-GO',
    playgroundSubstituteAccepted: false,
    partialPluginSurvivalAccepted: false,
    partialGraphSurvivalAccepted: false,
    placeholderBlueprintAssetsAccepted: false,
    splitSurvivalArtifactAccepted: false,
    packagedFallbackAccepted: false,
    releaseVerifierWithoutSameArtifactBindingAccepted: false,
    productionTopologyWithoutRouteHashesAccepted: false,
    topologyClaimWithoutBindingAccepted: false,
    productionBackedClaimWithoutArtifactAccepted: false,
    releaseMovementAllowed: false,
  });
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.doesNotMatch(
    text,
    /https?:\/\/|Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|wordpress_logged_in|application[_ -]?password|client[_ -]?secret|access[_ -]?token/i,
  );
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel/i,
  );
  assert.doesNotMatch(
    text,
    /"raw"\s*:|"payload"\s*:|"body"\s*:|"content"\s*:|"value"\s*:|"values"\s*:/i,
  );
  assert.doesNotMatch(text, /"productionBacked": true|"finalReleaseStatus": "GO"/);
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0884 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function evaluateBrewcommerceBlueprintImportV5({
  blueprintAssets,
  commandInventory = {},
  externalWordPressConfig = { complete: false, missing: [] },
  observedImportExport = null,
  releaseVerifierObservation = null,
  now = fixedNow,
} = {}) {
  const blueprint = summarizeBlueprintAssets(blueprintAssets);
  const observedValidation = validateObservedImportExportSurvival(observedImportExport);
  const releaseVerifierValidation = validateReleaseVerifierCarryThrough(
    releaseVerifierObservation,
    observedValidation,
  );
  const realRuntimeAvailable = Boolean(
    observedValidation.realWordPress
      || commandInventory.docker?.usable === true
      || externalWordPressConfig.complete === true,
  );
  const failures = [
    ...(realRuntimeAvailable ? [] : [{
      code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
      reason: 'No usable Docker runtime, complete external WordPress topology, or real import/export artifact is present.',
    }]),
    ...(blueprint.assetsReady ? [] : [{
      code: 'BREWCOMMERCE_BLUEPRINT_ASSETS_PLACEHOLDER_OR_MISSING',
      reason: 'One or more BrewCommerce blueprint assets are missing or zero-byte placeholders.',
    }]),
    ...observedValidation.failures,
    ...releaseVerifierValidation.failures,
  ];
  const releaseReadyArtifact = failures.length === 0;
  const pluginEvidence = observedValidation.pluginEvidence || emptyPluginEvidence();
  const graphEvidence = observedValidation.graphEvidence || emptyGraphEvidence();

  return {
    event: proofId,
    variant,
    checkedAt: now,
    ok: releaseReadyArtifact,
    releaseReadyArtifact,
    productionBackedArtifact: releaseReadyArtifact && observedValidation.realWordPress,
    readyForReleaseMovement: false,
    acceptedForReleaseGate: releaseReadyArtifact && releaseVerifierValidation.acceptedForReleaseGate,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    releasePosture: releaseReadyArtifact ? 'production-backed-artifact-candidate-no-release-movement' : 'NO-GO',
    blocker: releaseReadyArtifact ? null : failures.find((failure) =>
      failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING') || failures[0],
    constraints: {
      sandboxIngressPort: 8080,
      loopbackOnlyAdditionalPorts: true,
      tunnelsProhibited: true,
    },
    runtime: {
      dockerUsable: commandInventory.docker?.usable === true,
      externalWordPressConfigComplete: externalWordPressConfig.complete === true,
      externalWordPressConfigMissing: externalWordPressConfig.missing || [],
    },
    blueprint,
    importExport: observedValidation.importExport,
    pluginEvidence,
    graphEvidence,
    productionTopologyEvidence: observedValidation.productionTopologyEvidence || emptyProductionTopologyEvidence(),
    releaseVerifier: releaseVerifierValidation.releaseVerifier,
    artifactBindingHash: observedValidation.artifactBindingHash,
    artifactHash: observedValidation.sanitizedArtifact
      ? digest(observedValidation.sanitizedArtifact)
      : null,
    failures,
    exactMissingCapabilities: releaseReadyArtifact ? [] : exactMissingCapabilities({
      blueprint,
      realRuntimeAvailable,
      observedValidation,
    }),
    exactUnavailableCapabilities: releaseReadyArtifact ? [] : exactUnavailableCapabilities({
      commandInventory,
      externalWordPressConfig,
      realRuntimeAvailable,
    }),
  };
}

function validateObservedImportExportSurvival(observed) {
  if (!observed) {
    return {
      realWordPress: false,
      importExport: {
        runtime: null,
        realWordPress: false,
        importObserved: false,
        exportObserved: false,
      },
      pluginEvidence: emptyPluginEvidence(),
      graphEvidence: emptyGraphEvidence(),
      productionTopologyEvidence: emptyProductionTopologyEvidence(),
      artifactBindingHash: null,
      expectedArtifactBindingHash: null,
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress import/export survival artifact was provided.',
      }],
    };
  }

  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const productionTopology = observed.productionTopologyEvidence || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const graphTypes = graphEntries
    .filter((entry) =>
      requiredGraphTypes.includes(entry?.type)
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphTypes.filter((type) => !graphTypes.includes(type));
  const expectedBindingHash = expectedArtifactBindingHash(observed);
  const artifactBindingHash = isSha256(observed.artifactBindingHash)
    && observed.artifactBindingHash === expectedBindingHash
    ? observed.artifactBindingHash
    : null;
  const productionTopologyBindingHash = isSha256(productionTopology.artifactBindingHash)
    ? productionTopology.artifactBindingHash
    : null;
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0884 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (importExport.importedFromBrewcommerceBlueprint !== true) {
    failures.push({
      code: 'BREWCOMMERCE_BLUEPRINT_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show BrewCommerce blueprint import completion.',
    });
  }
  if (importExport.exportedAfterImport !== true) {
    failures.push({
      code: 'WORDPRESS_EXPORT_AFTER_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show a WordPress export after import.',
    });
  }
  if (![importExport.importedSnapshotHash, importExport.exportedSnapshotHash].every(isSha256)) {
    failures.push({
      code: 'IMPORT_EXPORT_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only imported and exported snapshot evidence.',
    });
  }
  if (plugin.driver !== pluginDriver || plugin.owner !== pluginOwner || plugin.resourceKey !== pluginResourceKey) {
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
  if (productionTopology.topologyClass !== requiredProductionTopologyEvidence.topologyClass
    || productionTopology.realImportExportTopology !== true) {
    failures.push({
      code: 'PRODUCTION_TOPOLOGY_EVIDENCE_MISSING',
      reason: 'The artifact does not carry the required far production-topology evidence.',
    });
  }
  if (![productionTopology.importRouteHash, productionTopology.exportRouteHash].every(isSha256)) {
    failures.push({
      code: 'PRODUCTION_TOPOLOGY_ROUTE_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only import and export route evidence.',
    });
  }
  if (!artifactBindingHash) {
    failures.push({
      code: 'IMPORT_EXPORT_ARTIFACT_BINDING_MISMATCH',
      reason: 'The artifact binding hash does not match the import/export, plugin, graph, and topology evidence.',
    });
  }
  if (productionTopologyBindingHash !== expectedBindingHash) {
    failures.push({
      code: 'PRODUCTION_TOPOLOGY_ARTIFACT_BINDING_MISMATCH',
      reason: 'The production topology evidence is not bound to the same import/export survival artifact.',
    });
  }

  return {
    realWordPress: observed.runtime === 'real-wordpress-import-export' && importExport.realWordPress === true,
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      importObserved: importExport.importedFromBrewcommerceBlueprint === true,
      exportObserved: importExport.exportedAfterImport === true,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash) ? importExport.importedSnapshotHash : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash) ? importExport.exportedSnapshotHash : null,
    },
    pluginEvidence: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKey: plugin.resourceKey || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      livePreconditionHash: isSha256(plugin.livePreconditionHash) ? plugin.livePreconditionHash : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphTypes],
      survivedTypes: graphTypes,
      missingTypes: missingGraphTypes,
    },
    productionTopologyEvidence: {
      topologyClass: productionTopology.topologyClass || null,
      realImportExportTopology: productionTopology.realImportExportTopology === true,
      importRouteHash: isSha256(productionTopology.importRouteHash) ? productionTopology.importRouteHash : null,
      exportRouteHash: isSha256(productionTopology.exportRouteHash) ? productionTopology.exportRouteHash : null,
      artifactBindingHash: productionTopologyBindingHash,
      bindingMatchesArtifact: productionTopologyBindingHash === expectedBindingHash,
    },
    artifactBindingHash,
    expectedArtifactBindingHash: expectedBindingHash,
    sanitizedArtifact: {
      runtime: observed.runtime || null,
      importExport: {
        realWordPress: importExport.realWordPress === true,
        importedFromBrewcommerceBlueprint: importExport.importedFromBrewcommerceBlueprint === true,
        exportedAfterImport: importExport.exportedAfterImport === true,
        importedSnapshotHash: isSha256(importExport.importedSnapshotHash) ? importExport.importedSnapshotHash : null,
        exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash) ? importExport.exportedSnapshotHash : null,
      },
      plugin: {
        driver: plugin.driver || null,
        owner: plugin.owner || null,
        resourceKey: plugin.resourceKey || null,
        survivedImport: plugin.survivedImport === true,
        survivedExport: plugin.survivedExport === true,
        livePreconditionHash: isSha256(plugin.livePreconditionHash) ? plugin.livePreconditionHash : null,
      },
      productionTopology: {
        topologyClass: productionTopology.topologyClass || null,
        realImportExportTopology: productionTopology.realImportExportTopology === true,
        importRouteHash: isSha256(productionTopology.importRouteHash) ? productionTopology.importRouteHash : null,
        exportRouteHash: isSha256(productionTopology.exportRouteHash) ? productionTopology.exportRouteHash : null,
        artifactBindingHash: productionTopologyBindingHash,
      },
      artifactBindingHash: isSha256(observed.artifactBindingHash) ? observed.artifactBindingHash : null,
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

function validateReleaseVerifierCarryThrough(releaseVerifier, observedValidation) {
  const artifactExpected = observedValidation.expectedArtifactBindingHash;
  const releaseVerifierArtifactBindingHash = isSha256(releaseVerifier?.artifactBindingHash)
    ? releaseVerifier.artifactBindingHash
    : null;
  const artifactPresent = Boolean(artifactExpected);
  const failures = [];

  if (!releaseVerifier) {
    failures.push({
      code: 'RELEASE_VERIFIER_CARRY_THROUGH_MISSING',
      reason: 'The BrewCommerce import proof must carry release verifier state.',
    });
  }
  if (releaseVerifier?.command !== releaseVerifierCommand) {
    failures.push({
      code: 'RELEASE_VERIFIER_COMMAND_MISMATCH',
      reason: 'The release verifier carry-through must record npm run verify:release.',
    });
  }
  if (releaseVerifier?.carriedThroughByBrewcommerceImportGate !== true) {
    failures.push({
      code: 'RELEASE_VERIFIER_NOT_CARRIED_THROUGH',
      reason: 'The release verifier was not carried through the BrewCommerce import gate.',
    });
  }
  if (releaseVerifier?.packagedFallbackAllowed !== false || releaseVerifier?.packagedFallbackObserved === true) {
    failures.push({
      code: 'PACKAGED_FALLBACK_REJECTED',
      reason: 'Packaged fallback evidence is support-only and cannot satisfy the BrewCommerce release verifier gate.',
    });
  }
  if (releaseVerifier?.releaseMovementAllowed === true || releaseVerifier?.finalReleaseStatus !== 'NO-GO') {
    failures.push({
      code: 'RELEASE_VERIFIER_RELEASE_MOVEMENT_REJECTED',
      reason: 'RPP-0884 keeps final release status NO-GO and does not allow release movement from support evidence.',
    });
  }
  if (artifactPresent) {
    if (releaseVerifier?.acceptedForReleaseGate !== true) {
      failures.push({
        code: 'RELEASE_VERIFIER_ACCEPTANCE_MISSING',
        reason: 'A production-backed artifact requires release verifier acceptance for that same artifact.',
      });
    }
    if (!isSha256(releaseVerifier?.reportHash)) {
      failures.push({
        code: 'RELEASE_VERIFIER_HASH_EVIDENCE_MISSING',
        reason: 'The release verifier carry-through must include a hash-only report surface.',
      });
    }
    if (releaseVerifierArtifactBindingHash !== artifactExpected) {
      failures.push({
        code: 'RELEASE_VERIFIER_ARTIFACT_BINDING_MISMATCH',
        reason: 'The release verifier did not carry the same artifact binding as plugin and graph survival.',
      });
    }
  } else if (releaseVerifier?.status !== 'blocked-missing-real-import-export-artifact'
    || releaseVerifier?.acceptedForReleaseGate !== false
    || releaseVerifier?.exactBlockerCode !== 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING') {
    failures.push({
      code: 'RELEASE_VERIFIER_BLOCKED_STATE_MISMATCH',
      reason: 'Missing import/export evidence must leave the release verifier blocked with the exact blocker.',
    });
  }

  return {
    acceptedForReleaseGate: artifactPresent
      && releaseVerifier?.acceptedForReleaseGate === true
      && failures.length === 0,
    releaseVerifier: {
      command: releaseVerifier?.command || null,
      carriedThroughByBrewcommerceImportGate: releaseVerifier?.carriedThroughByBrewcommerceImportGate === true,
      status: releaseVerifier?.status || null,
      acceptedForReleaseGate: releaseVerifier?.acceptedForReleaseGate === true,
      releaseMovementAllowed: releaseVerifier?.releaseMovementAllowed === true,
      finalReleaseStatus: releaseVerifier?.finalReleaseStatus || null,
      packagedFallbackAllowed: releaseVerifier?.packagedFallbackAllowed === true,
      packagedFallbackObserved: releaseVerifier?.packagedFallbackObserved === true,
      artifactBindingHash: releaseVerifierArtifactBindingHash,
      bindingMatchesArtifact: artifactPresent && releaseVerifierArtifactBindingHash === artifactExpected,
      reportHash: isSha256(releaseVerifier?.reportHash) ? releaseVerifier.reportHash : null,
      requiredCarryThrough: Array.isArray(releaseVerifier?.requiredCarryThrough)
        ? [...releaseVerifier.requiredCarryThrough]
        : [],
    },
    failures,
  };
}

function summarizeBlueprintAssets(assetFacts) {
  const assets = Object.fromEntries(requiredBlueprintAssets.map((asset) => {
    const fact = assetFacts?.assets?.[asset] || { exists: false, size: 0 };
    return [asset, {
      exists: fact.exists === true,
      size: Number.isInteger(fact.size) ? fact.size : 0,
      nonEmpty: fact.exists === true && fact.size > 0,
    }];
  }));
  const missingOrPlaceholderAssets = Object.entries(assets)
    .filter(([, fact]) => !fact.exists || !fact.nonEmpty)
    .map(([asset, fact]) => fact.exists ? `${asset}:size=${fact.size}` : `${asset}:missing`);

  return {
    dir: assetFacts?.dir || defaultBrewcommerceDir,
    requiredAssets: [...requiredBlueprintAssets],
    assets,
    assetsPresent: Object.values(assets).every((fact) => fact.exists),
    assetsReady: missingOrPlaceholderAssets.length === 0,
    missingOrPlaceholderAssets,
  };
}

function collectBlueprintAssetFacts(dir) {
  const assets = {};
  for (const asset of requiredBlueprintAssets) {
    const fullPath = path.join(dir, asset);
    try {
      const stat = fs.statSync(fullPath);
      assets[asset] = {
        exists: stat.isFile(),
        size: stat.isFile() ? stat.size : 0,
      };
    } catch {
      assets[asset] = {
        exists: false,
        size: 0,
      };
    }
  }
  return { dir, assets };
}

function syntheticBlueprintAssets(overrides = {}) {
  return {
    dir: defaultBrewcommerceDir,
    assets: Object.fromEntries(requiredBlueprintAssets.map((asset, index) => [
      asset,
      {
        exists: true,
        size: overrides[asset] ?? (3072 + index),
      },
    ])),
  };
}

function successfulRealImportExportArtifact() {
  const artifact = {
    runtime: 'real-wordpress-import-export',
    importExport: {
      realWordPress: true,
      importedFromBrewcommerceBlueprint: true,
      exportedAfterImport: true,
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKey: pluginResourceKey,
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
    productionTopologyEvidence: {
      topologyClass: 'far-production-topology',
      realImportExportTopology: true,
      importRouteHash: sampleHash('production-topology-import-route'),
      exportRouteHash: sampleHash('production-topology-export-route'),
    },
  };
  const artifactBindingHash = expectedArtifactBindingHash(artifact);
  artifact.artifactBindingHash = artifactBindingHash;
  artifact.productionTopologyEvidence.artifactBindingHash = artifactBindingHash;
  return artifact;
}

function successfulReleaseVerifierObservation(artifact) {
  return {
    command: releaseVerifierCommand,
    carriedThroughByBrewcommerceImportGate: true,
    status: 'passed',
    acceptedForReleaseGate: true,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    artifactBindingHash: artifact.artifactBindingHash,
    reportHash: sampleHash('release-verifier-report'),
    requiredCarryThrough: [...releaseVerifierCarryThroughRequirements],
  };
}

function blockedReleaseVerifierObservation() {
  return {
    command: releaseVerifierCommand,
    carriedThroughByBrewcommerceImportGate: true,
    status: 'blocked-missing-real-import-export-artifact',
    acceptedForReleaseGate: false,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    exactBlockerCode: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
    requiredCarryThrough: [...releaseVerifierCarryThroughRequirements],
  };
}

function emptyPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKey: pluginResourceKey,
    survivedImport: false,
    survivedExport: false,
    livePreconditionHash: null,
  };
}

function emptyGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphTypes],
    survivedTypes: [],
    missingTypes: [...requiredGraphTypes],
  };
}

function emptyProductionTopologyEvidence() {
  return {
    topologyClass: null,
    realImportExportTopology: false,
    importRouteHash: null,
    exportRouteHash: null,
    artifactBindingHash: null,
    bindingMatchesArtifact: false,
  };
}

function expectedArtifactBindingHash(observed) {
  const importExport = observed?.importExport || {};
  const plugin = observed?.pluginEvidence || {};
  const productionTopology = observed?.productionTopologyEvidence || {};
  const graphEntries = Array.isArray(observed?.graphEvidence) ? observed.graphEvidence : [];

  return digest({
    runtime: observed?.runtime || null,
    importExport: {
      realWordPress: importExport.realWordPress === true,
      importedFromBrewcommerceBlueprint: importExport.importedFromBrewcommerceBlueprint === true,
      exportedAfterImport: importExport.exportedAfterImport === true,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash) ? importExport.importedSnapshotHash : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash) ? importExport.exportedSnapshotHash : null,
    },
    plugin: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKey: plugin.resourceKey || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      livePreconditionHash: isSha256(plugin.livePreconditionHash) ? plugin.livePreconditionHash : null,
    },
    graph: graphEntries.map((entry) => ({
      type: entry?.type || null,
      survivedImport: entry?.survivedImport === true,
      survivedExport: entry?.survivedExport === true,
      preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
      roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
    })),
    productionTopology: {
      topologyClass: productionTopology.topologyClass || null,
      realImportExportTopology: productionTopology.realImportExportTopology === true,
      importRouteHash: isSha256(productionTopology.importRouteHash) ? productionTopology.importRouteHash : null,
      exportRouteHash: isSha256(productionTopology.exportRouteHash) ? productionTopology.exportRouteHash : null,
    },
  });
}

function exactMissingCapabilities({ blueprint, realRuntimeAvailable, observedValidation }) {
  return [
    ...(realRuntimeAvailable ? [] : ['docker runtime or complete external WordPress topology']),
    ...(blueprint.assetsReady ? [] : ['non-placeholder BrewCommerce import assets']),
    ...(observedValidation.failures.some((failure) =>
      failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING')
      ? ['real WordPress import/export survival artifact']
      : []),
  ];
}

function exactUnavailableCapabilities({ commandInventory, externalWordPressConfig, realRuntimeAvailable }) {
  if (realRuntimeAvailable) {
    return [];
  }
  return [
    ...(commandInventory.docker?.usable === true ? [] : [dockerUnavailableCapability]),
    ...(externalWordPressConfig.complete === true ? [] : [externalTopologyUnavailableCapability]),
  ];
}

function scopeHashInput(report) {
  return {
    sourcePattern: report.sourcePattern,
    writeScope: report.writeScope,
    currentSandboxObservation: report.currentSandboxObservation,
    contractRequirements: report.contractRequirements,
    releaseVerifier: report.releaseVerifier,
    supportEvidenceBoundary: report.supportEvidenceBoundary,
    failClosed: report.failClosed,
    focusedRegression: report.focusedRegression,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function sampleHash(label) {
  return digest({ rpp: variant, label });
}

function isSha256(value) {
  return typeof value === 'string' && shaPattern.test(value);
}
