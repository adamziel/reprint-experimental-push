import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { digest } from '../src/stable-json.js';

const defaultBrewcommerceDir = '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce';
const variant = 'RPP-0804-variant-1';
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

test('RPP-0804 records missing real WordPress import/export capability as NO-GO', () => {
  const proof = evaluateBrewcommerceBlueprintImportV1({
    blueprintAssets: syntheticBlueprintAssets({
      'content.xml': 0,
      'database.sql': 0,
    }),
    commandInventory: {
      docker: { present: false, usable: false },
      node: { present: true, usable: true },
      npm: { present: true, usable: true },
      npx: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: [
        'REPRINT_PUSH_SOURCE_URL',
        'REPRINT_PUSH_LOCAL_URL',
        'REPRINT_PUSH_REMOTE_CHANGED_URL',
        'production authentication material',
      ],
    },
    observedImportExport: null,
    now: '2026-06-01T00:00:00.000Z',
  });

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

test('RPP-0804 accepts a real WordPress import/export artifact only when plugin and graph evidence survive', () => {
  const proof = evaluateBrewcommerceBlueprintImportV1({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: [],
    },
    observedImportExport: successfulRealImportExportArtifact(),
    now: '2026-06-01T00:00:00.000Z',
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
  assert.match(proof.pluginEvidence.preconditionHash, shaPattern);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.match(proof.artifactHash, shaPattern);
});

test('RPP-0804 rejects Playground substitutes and partial survival evidence', () => {
  const observed = successfulRealImportExportArtifact();
  observed.runtime = 'local-playground-wordpress';
  observed.pluginEvidence.survivedExport = false;
  observed.graphEvidence = observed.graphEvidence.filter((entry) =>
    entry.type !== 'comment-parent-commentmeta');

  const proof = evaluateBrewcommerceBlueprintImportV1({
    blueprintAssets: syntheticBlueprintAssets(),
    commandInventory: {
      docker: { present: true, usable: true },
    },
    observedImportExport: observed,
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(proof.graphEvidence.missingTypes, ['comment-parent-commentmeta']);
});

test('RPP-0804 scans the current BrewCommerce asset surface without treating it as release-ready', () => {
  const proof = evaluateBrewcommerceBlueprintImportV1({
    blueprintAssets: collectBlueprintAssetFacts(defaultBrewcommerceDir),
    commandInventory: {
      docker: { present: false, usable: false },
      node: { present: true, usable: true },
      npm: { present: true, usable: true },
      npx: { present: true, usable: true },
    },
    externalWordPressConfig: {
      complete: false,
      missing: ['not configured for this focused test'],
    },
    observedImportExport: null,
  });

  assert.equal(proof.variant, variant);
  assert.equal(proof.releaseReady, false);
  assert.equal(proof.readyForReleaseMovement, false);
  assert.equal(proof.blueprint.dir, defaultBrewcommerceDir);
  assert.deepEqual(Object.keys(proof.blueprint.assets).sort(), [...requiredBlueprintAssets].sort());
  assert.doesNotMatch(JSON.stringify(proof), /Brewcommerce Shared Production Proof/);
});

function evaluateBrewcommerceBlueprintImportV1({
  blueprintAssets,
  commandInventory = {},
  externalWordPressConfig = { complete: false, missing: [] },
  observedImportExport = null,
  now = '2026-06-01T00:00:00.000Z',
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
  const pluginEvidence = observedValidation.pluginEvidence || {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKey: pluginResourceKey,
    survivedImport: false,
    survivedExport: false,
    preconditionHash: null,
  };
  const graphEvidence = observedValidation.graphEvidence || {
    requiredTypes: [...requiredGraphTypes],
    survivedTypes: [],
    missingTypes: [...requiredGraphTypes],
  };

  return {
    event: 'rpp-0804-brewcommerce-blueprint-import-v1',
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
      reason: 'RPP-0804 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
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
      preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
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
        size: overrides[asset] ?? (1024 + index),
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

function sampleHash(label) {
  return digest({ rpp: variant, label });
}

function isSha256(value) {
  return typeof value === 'string' && shaPattern.test(value);
}
