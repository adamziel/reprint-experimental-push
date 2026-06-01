import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0814-large-media-library-topology-v1.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const variant = 'RPP-0814-variant-1';
const proofId = 'rpp-0814-large-media-library-topology-v1';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const sha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const requiredGraphSurfaces = Object.freeze([
  'featured-image-attachment',
  'attachment-postmeta-round-trip',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
]);
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-large-media-topology-start',
  'real-wordpress-media-import-export',
  'plugin-evidence-import-export-readback',
  'graph-evidence-import-export-readback',
]);

test('RPP-0814 progress report records support-only large media topology scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0814');
  assert.equal(report.variant, 1);
  assert.equal(report.title, 'Large media library topology candidate scope');
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

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.builtOn.mediaBenchmark.rppId, 'RPP-0715');
  assert.equal(report.builtOn.mediaBenchmark.mediaDriver, 'benchmark-media-library-file');
  assert.equal(report.builtOn.mediaBenchmark.fastPathLane, 'large-media-library-fast-path');
  assert.deepEqual(report.builtOn.mediaBenchmark.databaseSurfaces, [
    'wp_posts:attachment',
    'wp_postmeta:attachment-metadata',
  ]);
  assert.equal(report.builtOn.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.topologyCommand.publishedIngressPort, 8080);
  assert.equal(report.builtOn.topologyCommand.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.topologyCommand.packagedFallbackAllowed, false);
  assert.equal(report.builtOn.importExportContract.requiresRealWordPressImportExport, true);
  assert.equal(report.builtOn.importExportContract.requiresPluginAndGraphSurvival, true);

  assert.equal(report.candidateScope.status, 'large-media-library-topology-candidate');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(
    report.candidateScope.sourcePattern,
    'local-support-large-media-benchmark-plus-docker-topology-prerequisite',
  );

  const shape = report.candidateScope.mediaTopologyShape;
  assert.equal(shape.mediaSurface, 'large-media-library');
  assert.equal(shape.importExportRuntimeRequired, 'real-wordpress-import-export');
  assert.equal(shape.mediaDriver, 'benchmark-media-library-file');
  assert.equal(shape.fastPathLane, 'large-media-library-fast-path');
  assert.equal(shape.storageBoundary, 'filesystem-fsync-evidence');
  assert.deepEqual(shape.attachmentRows, ['wp_posts:attachment']);
  assert.deepEqual(shape.attachmentMetadataRows, ['wp_postmeta:attachment-metadata']);
  assert.deepEqual(shape.requiredGraphSurfaces, [...requiredGraphSurfaces]);
  assert.deepEqual(shape.requiredPluginEvidence, {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKind: 'plugin-driver-row',
    importSurvivalRequired: true,
    exportSurvivalRequired: true,
    livePreconditionHashRequired: true,
  });
  assert.equal(shape.benchmarkSupport.sourceRppId, 'RPP-0715');
  assert.equal(shape.benchmarkSupport.profile, 'large-site');
  assert.equal(shape.benchmarkSupport.mediaWritesAttempted, 144);
  assert.equal(shape.benchmarkSupport.fastPathLaneUpdates, 128);
  assert.equal(shape.benchmarkSupport.rowPreconditionsRetained, 720);
  assert.equal(shape.realImportExportObserved, false);
  assert.equal(shape.pluginEvidenceSurvivedImportExport, false);
  assert.equal(shape.graphEvidenceSurvivedImportExport, false);
  assert.equal(shape.rawMediaValuesIncluded, false);

  assert.ok(report.candidateScope.candidateClaims.includes('rpp-0715-benchmark-support-linked'));
  assert.ok(report.candidateScope.candidateClaims.includes('topology-command-fail-closed-capability-recorded'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('real-wordpress-large-media-import-export-run'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('plugin-driver-evidence-import-export-readback'));

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('real-wordpress-large-media-import-observed'));
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'plugin-driver-evidence-survives-import-and-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'attachment-metadata-graph-survives-import-and-export',
    ),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-real-wordpress-large-media-import-export-artifact'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-prove-graph-evidence-survival'));

  assert.match(report.scopeComparisonHash, sha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0814 topology command records exact unavailable capability fail-closed', () => {
  const { report } = loadProgressReport();
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(artifact.commands.runHarness, 'npm run verify:release:docker-local-production');
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(probe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.topology.publishedPorts[0].host, '127.0.0.1');
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);

  assert.equal(report.topologyCommand.command, artifact.commands.runHarness);
  assert.equal(report.topologyCommand.status, artifact.status);
  assert.equal(report.topologyCommand.siteStartupStatus, 'not-started');
  assert.equal(report.topologyCommand.sitesStarted, false);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: probe.checks.dockerCli.missingExecutable,
    requiredFor: [...topologyRequiredFor],
  });
  assert.equal(report.topologyCommand.runtime, artifact.runtime);
  assert.equal(report.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.topologyCommand.siteRoleCount, 4);
  assert.deepEqual(report.topologyCommand.publishedIngress, {
    hostSurface: 'loopback-only',
    port: 8080,
    publishedPortCount: 1,
  });
  assert.deepEqual(report.topologyCommand.policy, {
    remoteTunnelsAllowed: false,
    packagedFallbackAllowed: false,
    releaseVerifierCommand: 'npm run verify:release',
    onlySandbox8080Ingress: true,
  });
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));

  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.acceptedReleaseEvidence, false);
  assert.equal(report.productionImportExportEvidence.blockedReasonCode, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.equal(report.productionImportExportEvidence.exactUnavailableCapability, 'DOCKER_CLI_MISSING');
});

test('RPP-0814 accepts only real WordPress import/export with plugin and graph survival', () => {
  const missing = evaluateLargeMediaLibraryTopologyV1({
    topologyStarted: false,
    observedImportExport: null,
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.releaseReady, false);
  assert.equal(missing.acceptedForReleaseGate, false);
  assert.equal(missing.releasePosture, 'NO-GO');
  assert.equal(missing.blocker.code, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.deepEqual(missing.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology',
    'real WordPress large media import/export survival artifact',
    'plugin evidence import/export readback',
    'graph evidence import/export readback',
  ]);

  const accepted = evaluateLargeMediaLibraryTopologyV1({
    topologyStarted: true,
    observedImportExport: successfulRealImportExportArtifact(),
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.releaseReady, true);
  assert.equal(accepted.readyForReleaseMovement, true);
  assert.equal(accepted.acceptedForReleaseGate, true);
  assert.equal(accepted.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(accepted.importExport.importObserved, true);
  assert.equal(accepted.importExport.exportObserved, true);
  assert.equal(accepted.pluginEvidence.driver, pluginDriver);
  assert.equal(accepted.pluginEvidence.owner, pluginOwner);
  assert.equal(accepted.pluginEvidence.resourceKey, pluginResourceKey);
  assert.equal(accepted.pluginEvidence.survivedImport, true);
  assert.equal(accepted.pluginEvidence.survivedExport, true);
  assert.match(accepted.pluginEvidence.livePreconditionHash, sha256Pattern);
  assert.deepEqual(accepted.graphEvidence.requiredTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(accepted.graphEvidence.missingTypes, []);
  assert.deepEqual(accepted.graphEvidence.survivedTypes, [...requiredGraphSurfaces]);
  assert.match(accepted.artifactHash, sha256Pattern);

  const rejected = successfulRealImportExportArtifact();
  rejected.runtime = 'local-playground-wordpress';
  rejected.pluginEvidence.survivedExport = false;
  rejected.graphEvidence = rejected.graphEvidence.filter((entry) =>
    entry.type !== 'attachment-postmeta-round-trip');
  const partial = evaluateLargeMediaLibraryTopologyV1({
    topologyStarted: true,
    observedImportExport: rejected,
  });

  assert.equal(partial.ok, false);
  assert.equal(partial.releaseReady, false);
  assert.ok(partial.failures.some((failure) => failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(partial.failures.some((failure) => failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partial.failures.some((failure) => failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partial.graphEvidence.missingTypes, ['attachment-postmeta-round-trip']);
});

test('RPP-0814 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0814 large media topology progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawMediaValuesIncluded, false);
  assert.equal(report.redaction.rawGraphValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'topologyCommand',
    'productionImportExportEvidence',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.doesNotMatch(
    text,
    /media-(?:base|planned|drift)-payload|large media raw fixture|wp-content\/uploads|https?:\/\/|"logicalPath"\s*:|"plannedContents"\s*:|Bearer\s+|Basic\s+|attachment title|metadata value|customer secret/i,
  );
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel/i,
  );
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0814 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0814-docker-work',
    evidenceDir: '/tmp/rpp-0814-docker-evidence',
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

function evaluateLargeMediaLibraryTopologyV1({
  topologyStarted = false,
  observedImportExport = null,
  now = fixedNow,
} = {}) {
  const observedValidation = validateObservedImportExportSurvival(observedImportExport);
  const failures = [
    ...(topologyStarted ? [] : [{
      code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
      reason: 'No usable Docker runtime, complete external WordPress topology, or real import/export artifact is present.',
    }]),
    ...observedValidation.failures,
  ];
  const releaseReady = failures.length === 0;

  return {
    event: proofId,
    variant,
    checkedAt: now,
    ok: releaseReady,
    releaseReady,
    readyForReleaseMovement: releaseReady,
    acceptedForReleaseGate: releaseReady,
    releasePosture: releaseReady ? 'candidate-for-review' : 'NO-GO',
    blocker: releaseReady ? null : failures.find((failure) =>
      failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING') || failures[0],
    topology: {
      started: topologyStarted,
      sandboxIngressPort: 8080,
      onlySandbox8080Ingress: true,
      remoteTunnelsAllowed: false,
      packagedFallbackAllowed: false,
    },
    importExport: observedValidation.importExport,
    pluginEvidence: observedValidation.pluginEvidence,
    graphEvidence: observedValidation.graphEvidence,
    artifactHash: observedValidation.sanitizedArtifact
      ? digest(observedValidation.sanitizedArtifact)
      : null,
    failures,
    exactMissingCapabilities: releaseReady ? [] : exactMissingCapabilities({
      topologyStarted,
      observedValidation,
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
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress large media import/export survival artifact was provided.',
      }],
    };
  }

  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphSurfaces.includes(entry?.type)
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphSurfaces.filter((type) => !survivedGraphTypes.includes(type));
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0814 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (importExport.largeMediaImportObserved !== true) {
    failures.push({
      code: 'LARGE_MEDIA_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show large media import completion.',
    });
  }
  if (importExport.wordpressExportAfterImportObserved !== true) {
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

  return {
    realWordPress: observed.runtime === 'real-wordpress-import-export' && importExport.realWordPress === true,
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      importObserved: importExport.largeMediaImportObserved === true,
      exportObserved: importExport.wordpressExportAfterImportObserved === true,
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
      requiredTypes: [...requiredGraphSurfaces],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    sanitizedArtifact: {
      runtime: observed.runtime || null,
      importExport: {
        realWordPress: importExport.realWordPress === true,
        largeMediaImportObserved: importExport.largeMediaImportObserved === true,
        wordpressExportAfterImportObserved: importExport.wordpressExportAfterImportObserved === true,
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
    },
    failures,
  };
}

function successfulRealImportExportArtifact() {
  return {
    runtime: 'real-wordpress-import-export',
    importExport: {
      realWordPress: true,
      largeMediaImportObserved: true,
      wordpressExportAfterImportObserved: true,
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
    graphEvidence: requiredGraphSurfaces.map((type) => ({
      type,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
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
    requiredTypes: [...requiredGraphSurfaces],
    survivedTypes: [],
    missingTypes: [...requiredGraphSurfaces],
  };
}

function exactMissingCapabilities({ topologyStarted, observedValidation }) {
  return [
    ...(topologyStarted ? [] : ['docker runtime or complete external WordPress topology']),
    ...(observedValidation.failures.some((failure) =>
      failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING')
      ? ['real WordPress large media import/export survival artifact']
      : []),
    ...(observedValidation.pluginEvidence?.survivedImport === true
      && observedValidation.pluginEvidence?.survivedExport === true
      ? []
      : ['plugin evidence import/export readback']),
    ...(observedValidation.graphEvidence?.missingTypes?.length === 0
      ? []
      : ['graph evidence import/export readback']),
  ];
}

function topologyArtifactHash(report, artifact, probe) {
  return `sha256:${digest({
    command: artifact.commands.runHarness,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    mediaSurface: report.candidateScope.mediaTopologyShape.mediaSurface,
    requiredGraphSurfaces: report.candidateScope.mediaTopologyShape.requiredGraphSurfaces,
    requiredFor: report.topologyCommand.exactUnavailableCapability.requiredFor,
  })}`;
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    topologyCommand: report.topologyCommand,
    productionImportExportEvidence: report.productionImportExportEvidence,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function sampleHash(label) {
  return digest({ rpp: variant, label });
}

function isSha256(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}
