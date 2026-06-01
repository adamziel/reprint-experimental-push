import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0809-multisite-subdirectory-topology-v1.md',
);
const variant = 'RPP-0809-variant-1';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0809',
  resource: 'reprint-push-release-state-row',
});
const requiredGraphTypes = Object.freeze([
  'featured-image-attachment',
  'category-term-relationship-termmeta',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
  'multisite-blog-option-routing',
  'multisite-cross-blog-reference-boundary',
]);

test('RPP-0809 progress report records fail-closed multisite subdirectory scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0809');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'blocked-support-only');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.topologyContract.rppId, 'RPP-0803');
  assert.equal(report.builtOn.topologyContract.sourceLocalChangedUrlCapture, true);
  assert.equal(report.builtOn.topologyContract.identityHashOnly, true);
  assert.equal(report.builtOn.urlIdentityPattern.rppId, 'RPP-0808');
  assert.deepEqual(report.builtOn.urlIdentityPattern.roleIdentities, [
    'source',
    'local-edited',
    'remote-changed',
  ]);
  assert.equal(report.builtOn.urlIdentityPattern.sameSourceAcrossRoutesRequired, true);
  assert.equal(report.builtOn.importExportSurvivalContract.rppId, 'RPP-0804');
  assert.equal(
    report.builtOn.importExportSurvivalContract.successTarget,
    'plugin-and-graph-evidence-survive-real-wordpress-import-export',
  );

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'multisite-subdirectory-topology-candidate');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.failClosed, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.topologyShape.installMode, 'multisite');
  assert.equal(report.candidateScope.topologyShape.addressingMode, 'subdirectory');
  assert.equal(report.candidateScope.topologyShape.pathBasedSites, true);
  assert.equal(report.candidateScope.topologyShape.subdomainModeExcluded, true);
  assert.equal(report.candidateScope.topologyShape.importExportObserved, false);
  assert.equal(report.candidateScope.topologyShape.networkProbePerformed, false);
  assert.equal(report.candidateScope.topologyShape.sandboxIngressPort, 8080);
  assert.equal(report.candidateScope.topologyShape.remoteTunnelsAllowed, false);
  assertRoleIdentityHashes(report.candidateScope.topologyShape.roleIdentityHashes);

  assert.deepEqual(report.candidateScope.networkTables, [
    'wp_site',
    'wp_blogs',
    'wp_sitemeta',
    'wp_blogmeta',
    'wp_blog_versions',
    'wp_registration_log',
  ]);
  assert.deepEqual(report.candidateScope.blogScopedTables, [
    'wp_options',
    'wp_posts',
    'wp_postmeta',
    'wp_2_options',
    'wp_2_posts',
    'wp_2_postmeta',
  ]);
  assert.ok(report.candidateScope.configurationSurface.includes('SUBDOMAIN_INSTALL=false'));
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes(
      'production-bound-multisite-subdirectory-import-export',
    ),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('plugin-evidence-export-survival-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('graph-evidence-export-survival-proof'),
  );

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-bound-wordpress-multisite-subdirectory-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'plugin-driver-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'featured-image-taxonomy-post-parent-comment-graph-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-missing'));
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'no-real-multisite-subdirectory-import-export-survival-artifact',
    ),
  );

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0809 records exact unavailable capabilities and stays NO-GO', () => {
  const { report } = loadProgressReport();
  const capabilities = Object.fromEntries(
    report.currentObservation.exactUnavailableCapabilities.map((entry) => [entry.code, entry]),
  );

  assert.equal(capabilities.DOCKER_CLI_MISSING.capability, 'docker-cli');
  assert.equal(capabilities.DOCKER_CLI_MISSING.command, 'docker --version');
  assert.equal(capabilities.DOCKER_CLI_MISSING.missingExecutable, true);
  assert.ok(
    capabilities.DOCKER_CLI_MISSING.requiredFor.includes(
      'real-wordpress-multisite-subdirectory-runtime',
    ),
  );
  assert.equal(
    capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.capability,
    'complete-external-wordpress-topology',
  );
  assert.deepEqual(capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.missingInputs, [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_LOCAL_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_USERNAME',
    'REPRINT_PUSH_APPLICATION_PASSWORD',
  ]);
  assert.equal(capabilities.EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED.valuesIncluded, false);
  assert.equal(
    capabilities.REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING.capability,
    'multisite-subdirectory-import-export-survival-artifact',
  );
  assert.equal(capabilities.REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING.artifactProvided, false);

  assert.equal(report.failClosed, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.equal(
    report.releaseReadyScope.readyWhen,
    'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true',
  );
});

test('RPP-0809 accepts only real subdirectory import/export where plugin and graph evidence survive', () => {
  const proof = evaluateMultisiteSubdirectoryImportExportV1(
    successfulRealSubdirectoryImportExportArtifact(),
  );

  assert.equal(proof.ok, true);
  assert.equal(proof.releaseReady, true);
  assert.equal(proof.readyForReleaseMovement, true);
  assert.equal(proof.acceptedForReleaseGate, true);
  assert.equal(proof.releasePosture, 'candidate-for-review');
  assert.equal(proof.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(proof.topology.multisite, true);
  assert.equal(proof.topology.addressingMode, 'subdirectory');
  assert.equal(proof.importExport.importObserved, true);
  assert.equal(proof.importExport.exportObserved, true);
  assert.equal(proof.pluginEvidence.driver, pluginDriver);
  assert.equal(proof.pluginEvidence.owner, pluginOwner);
  assert.equal(proof.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(proof.pluginEvidence.survivedImport, true);
  assert.equal(proof.pluginEvidence.survivedExport, true);
  assert.match(proof.pluginEvidence.preconditionHash, hexSha256Pattern);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.match(proof.artifactHash, hexSha256Pattern);
});

test('RPP-0809 rejects playground, subdomain, and partial survival evidence', () => {
  const observed = successfulRealSubdirectoryImportExportArtifact();
  observed.runtime = 'local-playground-wordpress';
  observed.topology.addressingMode = 'subdomain';
  observed.pluginEvidence.survivedExport = false;
  observed.graphEvidence = observed.graphEvidence.filter((entry) =>
    entry.type !== 'multisite-cross-blog-reference-boundary');

  const proof = evaluateMultisiteSubdirectoryImportExportV1(observed);

  assert.equal(proof.ok, false);
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.releasePosture, 'NO-GO');
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'MULTISITE_SUBDIRECTORY_TOPOLOGY_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(proof.graphEvidence.missingTypes, [
    'multisite-cross-blog-reference-boundary',
  ]);
});

test('RPP-0809 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.pluginRawValuesIncluded, false);
  assert.equal(report.redaction.graphRawValuesIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.topologyShape.roleIdentityHashesOnly, true);
  assert.match(report.candidateScope.importExportSurvivalSurface.pluginResourceKeyHash, hexSha256Pattern);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel/i,
  );
});

function evaluateMultisiteSubdirectoryImportExportV1(observed) {
  const validation = validateObservedImportExportSurvival(observed);
  const releaseReady = validation.failures.length === 0;

  return {
    event: 'rpp-0809-multisite-subdirectory-topology-v1',
    variant,
    ok: releaseReady,
    releaseReady,
    readyForReleaseMovement: releaseReady,
    acceptedForReleaseGate: releaseReady,
    releasePosture: releaseReady ? 'candidate-for-review' : 'NO-GO',
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
      topology: {
        multisite: false,
        addressingMode: null,
        networkConstantsReadback: false,
      },
      importExport: {
        runtime: null,
        realWordPress: false,
        importObserved: false,
        exportObserved: false,
      },
      pluginEvidence: missingPluginEvidence(),
      graphEvidence: {
        requiredTypes: [...requiredGraphTypes],
        survivedTypes: [],
        missingTypes: [...requiredGraphTypes],
      },
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress import/export survival artifact was provided.',
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
      reason: 'RPP-0809 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (
    topology.multisite !== true
    || topology.addressingMode !== 'subdirectory'
    || topology.networkConstantsReadback !== true
    || !isSha256(topology.siteSurfaceHash)
    || !isSha256(topology.perSiteRouteReceiptsHash)
  ) {
    failures.push({
      code: 'MULTISITE_SUBDIRECTORY_TOPOLOGY_REQUIRED',
      reason: 'The artifact must prove live multisite subdirectory constants and per-site route receipts by hash.',
    });
  }
  if (importExport.importObserved !== true) {
    failures.push({
      code: 'WORDPRESS_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show WordPress import completion.',
    });
  }
  if (importExport.exportObserved !== true) {
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
      multisite: topology.multisite === true,
      addressingMode: topology.addressingMode || null,
      networkConstantsReadback: topology.networkConstantsReadback === true,
      siteSurfaceHash: isSha256(topology.siteSurfaceHash) ? topology.siteSurfaceHash : null,
      perSiteRouteReceiptsHash: isSha256(topology.perSiteRouteReceiptsHash)
        ? topology.perSiteRouteReceiptsHash
        : null,
    },
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
        ? importExport.importedSnapshotHash
        : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
        ? importExport.exportedSnapshotHash
        : null,
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
        multisite: topology.multisite === true,
        addressingMode: topology.addressingMode || null,
        networkConstantsReadback: topology.networkConstantsReadback === true,
        siteSurfaceHash: isSha256(topology.siteSurfaceHash) ? topology.siteSurfaceHash : null,
        perSiteRouteReceiptsHash: isSha256(topology.perSiteRouteReceiptsHash)
          ? topology.perSiteRouteReceiptsHash
          : null,
      },
      importExport: {
        realWordPress: importExport.realWordPress === true,
        importObserved: importExport.importObserved === true,
        exportObserved: importExport.exportObserved === true,
        importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
          ? importExport.importedSnapshotHash
          : null,
        exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
          ? importExport.exportedSnapshotHash
          : null,
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

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0809 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertRoleIdentityHashes(roleIdentityHashes) {
  assert.match(roleIdentityHashes.source, hexSha256Pattern);
  assert.match(roleIdentityHashes.localEdited, hexSha256Pattern);
  assert.match(roleIdentityHashes.remoteChanged, hexSha256Pattern);
  assert.equal(new Set(Object.values(roleIdentityHashes)).size, 3);
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
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

function successfulRealSubdirectoryImportExportArtifact() {
  return {
    runtime: 'real-wordpress-import-export',
    topology: {
      multisite: true,
      addressingMode: 'subdirectory',
      networkConstantsReadback: true,
      siteSurfaceHash: sampleHash('site-surface'),
      perSiteRouteReceiptsHash: sampleHash('per-site-route-receipts'),
    },
    importExport: {
      realWordPress: true,
      importObserved: true,
      exportObserved: true,
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
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

function sampleHash(label) {
  return digest({ rpp: 'RPP-0809', label });
}

function isSha256(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}
