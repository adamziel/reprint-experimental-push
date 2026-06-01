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
  'docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md',
);
const defaultBrewcommerceDir = '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce';
const proofId = 'rpp-0824-brewcommerce-blueprint-import-v2';
const variant = 'RPP-0824-variant-2';
const fixedNow = '2026-06-01T00:00:00.000Z';
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

test('RPP-0824 support report records support-only BrewCommerce import scope', () => {
  const { report, text } = loadSupportReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0824');
  assert.equal(report.variant, 2);
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
  assert.match(text, /The positive branch is a deterministic contract fixture/);

  assert.deepEqual(report.sourcePattern, {
    rppId: 'RPP-0804',
    variant: 1,
    evidenceFile: 'docs/evidence/rpp-0804-brewcommerce-blueprint-import-v1.md',
    testFile: 'test/rpp-0804-brewcommerce-blueprint-import-v1.test.js',
    contractInherited: true,
  });
  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md',
    'test/rpp-0824-brewcommerce-blueprint-import-v2.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.sharedTopologyModified, false);
  assert.equal(report.writeScope.releaseVerifierModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelsAllowed, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.equal(report.currentSandboxObservation.brewcommerceFixtureDir, defaultBrewcommerceDir);
  assert.deepEqual(report.currentSandboxObservation.missingOrPlaceholderAssets, [
    'content.xml:size=0',
    'database.sql:size=0',
  ]);
  assert.equal(report.currentSandboxObservation.dockerCliUsable, false);
  assert.equal(report.currentSandboxObservation.externalWordPressTopologyComplete, false);
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
  assert.equal(report.scopeHash, digest(scopeHashInput(report)));
});

test('RPP-0824 records missing real WordPress import/export capability as fail-closed NO-GO', () => {
  const proof = evaluateBrewcommerceBlueprintImportV2({
    blueprintAssets: collectBlueprintAssetFacts(defaultBrewcommerceDir),
    commandInventory: {
      docker: { present: false, usable: false },
      node: { present: true, usable: true },
      npm: { present: true, usable: true },
      npx: { present: true, usable: true },
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
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.acceptedForReleaseGate, false);
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
  assert.equal(proof.constraints.sandboxIngressPort, 8080);
  assert.equal(proof.constraints.tunnelsProhibited, true);
  assert.deepEqual(proof.exactMissingCapabilities, [
    'docker runtime or complete external WordPress topology',
    'non-placeholder BrewCommerce import assets',
    'real WordPress import/export survival artifact',
  ]);
});

test('RPP-0824 accepts a real WordPress import/export artifact only when plugin and graph evidence survive', () => {
  const proof = evaluateBrewcommerceBlueprintImportV2({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: [],
    },
    observedImportExport: successfulRealImportExportArtifact(),
    now: fixedNow,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.releaseReady, true);
  assert.equal(proof.readyForReleaseMovement, true);
  assert.equal(proof.acceptedForReleaseGate, true);
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
  assert.match(proof.artifactHash, shaPattern);

  const rejected = successfulRealImportExportArtifact();
  rejected.runtime = 'local-playground-wordpress';
  rejected.pluginEvidence.survivedExport = false;
  rejected.graphEvidence = rejected.graphEvidence.filter((entry) =>
    entry.type !== 'comment-parent-commentmeta');
  const partial = evaluateBrewcommerceBlueprintImportV2({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    observedImportExport: rejected,
    now: fixedNow,
  });

  assert.equal(partial.ok, false);
  assert.equal(partial.releaseReady, false);
  assert.equal(partial.readyForReleaseMovement, false);
  assert.equal(partial.acceptedForReleaseGate, false);
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partial.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partial.graphEvidence.missingTypes, ['comment-parent-commentmeta']);
});

test('RPP-0824 evidence remains redacted and scoped to support-only surfaces', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0824 BrewCommerce support report' }));
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
    'failClosed',
    'integrationRecommendation',
  ]);
  assert.deepEqual(report.failClosed, {
    missingEvidenceReleasePosture: 'NO-GO',
    playgroundSubstituteAccepted: false,
    partialPluginSurvivalAccepted: false,
    partialGraphSurvivalAccepted: false,
    placeholderBlueprintAssetsAccepted: false,
    releaseMovementAllowed: false,
  });
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
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0824 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function evaluateBrewcommerceBlueprintImportV2({
  blueprintAssets,
  commandInventory = {},
  externalWordPressConfig = { complete: false, missing: [] },
  observedImportExport = null,
  now = fixedNow,
} = {}) {
  const blueprint = summarizeBlueprintAssets(blueprintAssets);
  const observedValidation = validateObservedImportExportSurvival(observedImportExport);
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
  ];
  const releaseReady = failures.length === 0;
  const pluginEvidence = observedValidation.pluginEvidence || emptyPluginEvidence();
  const graphEvidence = observedValidation.graphEvidence || emptyGraphEvidence();

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
    artifactHash: observedValidation.sanitizedArtifact
      ? digest(observedValidation.sanitizedArtifact)
      : null,
    failures,
    exactMissingCapabilities: releaseReady ? [] : exactMissingCapabilities({
      blueprint,
      realRuntimeAvailable,
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
        reason: 'No real WordPress import/export survival artifact was provided.',
      }],
    };
  }

  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
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
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0824 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
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
        size: overrides[asset] ?? (2048 + index),
      },
    ])),
  };
}

function successfulRealImportExportArtifact() {
  return {
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

function scopeHashInput(report) {
  return {
    sourcePattern: report.sourcePattern,
    writeScope: report.writeScope,
    currentSandboxObservation: report.currentSandboxObservation,
    contractRequirements: report.contractRequirements,
    failClosed: report.failClosed,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function sampleHash(label) {
  return digest({ rpp: variant, label });
}

function isSha256(value) {
  return typeof value === 'string' && shaPattern.test(value);
}
