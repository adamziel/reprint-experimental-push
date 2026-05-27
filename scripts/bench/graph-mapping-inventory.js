#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  GRAPH_FAMILY_DEFINITIONS,
  runGuardedExecutorBenchmark,
} from './guarded-executor-benchmark.js';
import { SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS } from '../../src/planner.js';

const DEFAULT_NOW = new Date('2026-05-27T00:00:00.000Z');
const LEGACY_GRAPH_MAPPING_AGGREGATE = Object.freeze({
  mappedReferences: 444,
  totalReferences: 1589,
  origin: 'literal 444/1589 aggregate was not found in repository source; retained as a deterministic planning baseline',
  searchedPatterns: Object.freeze(['444', '1589', '444/1589']),
});

const GRAPH_MAPPING_SNAPSHOT_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'comments',
    family: 'comments',
    relationshipTypes: Object.freeze(['comment-post', 'comment-parent', 'commentmeta-comment']),
    mapped: 84,
    unmapped: 202,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Comment post, parent, and commentmeta references need a dedicated owner shard beyond planner unit coverage.',
  }),
  Object.freeze({
    id: 'postsHierarchyAuthors',
    family: 'posts hierarchy/authors',
    relationshipTypes: Object.freeze(['post-parent', 'post-author']),
    mapped: 72,
    unmapped: 126,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Post parent references have benchmark coverage; author identity proof remains a planner and smoke shard.',
  }),
  Object.freeze({
    id: 'postmetaPostRefs',
    family: 'postmeta/post refs',
    relationshipTypes: Object.freeze(['postmeta-post']),
    mapped: 164,
    unmapped: 248,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/bench/guarded-executor-benchmark.js',
    notes: 'Largest same-plan postmeta reference shard; benchmark coverage proves stable remote post targets only.',
  }),
  Object.freeze({
    id: 'featuredImagesAttachments',
    family: 'featured images/attachments',
    relationshipTypes: Object.freeze(['featured-image-attachment']),
    mapped: 46,
    unmapped: 50,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Attachment row plus _thumbnail_id rewrite has benchmark coverage; remaining cases need smoke expansion.',
  }),
  Object.freeze({
    id: 'termsTaxonomies',
    family: 'terms/taxonomies',
    relationshipTypes: Object.freeze(['term-taxonomy-term', 'term-taxonomy-parent']),
    mapped: 48,
    unmapped: 116,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Term and term_taxonomy closure needs taxonomy-specific owner coverage.',
  }),
  Object.freeze({
    id: 'termRelationships',
    family: 'term relationships',
    relationshipTypes: Object.freeze(['term-relationship-object', 'term-relationship-taxonomy']),
    mapped: 22,
    unmapped: 189,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Object and taxonomy edges have representative benchmark coverage but remain a high-unmapped shard.',
  }),
  Object.freeze({
    id: 'termmeta',
    family: 'termmeta',
    relationshipTypes: Object.freeze(['termmeta-term']),
    mapped: 8,
    unmapped: 79,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    notes: 'Termmeta driver coverage exists; same-plan term identity proof needs a larger shard.',
  }),
  Object.freeze({
    id: 'usersUsermeta',
    family: 'users/usermeta',
    relationshipTypes: Object.freeze(['usermeta-user']),
    mapped: 0,
    unmapped: 73,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    notes: 'Usermeta user identity references are supported by relationship type but have no snapshot coverage.',
  }),
  Object.freeze({
    id: 'unsupportedPluginOwnedSurfaces',
    family: 'unsupported/plugin-owned surfaces',
    relationshipTypes: Object.freeze([]),
    mapped: 0,
    unmapped: 0,
    guarded: 62,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    notes: 'Keep fail-closed until an allowlisted driver and smoke prove safe ownership/mapping.',
  }),
]);

export function buildGraphMappingInventory({
  report,
  familyDefinitions = GRAPH_FAMILY_DEFINITIONS,
  supportedRelationshipTypes = SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
} = {}) {
  if (!report || typeof report !== 'object') {
    throw new Error('Graph mapping inventory requires a benchmark report object.');
  }

  const familyReport = report.evidence?.wordpressGraphIdentity?.familyReport;
  const familyCounters = report.evidence?.wordpressGraphIdentity?.familyCounters;
  if (!familyReport || typeof familyReport !== 'object') {
    throw new Error('Graph mapping inventory requires wordpressGraphIdentity.familyReport.');
  }
  if (!familyCounters || typeof familyCounters !== 'object') {
    throw new Error('Graph mapping inventory requires wordpressGraphIdentity.familyCounters.');
  }

  const families = familyDefinitions.map((definition) =>
    inventoryFamilyFromDefinition(definition, familyReport[definition.id]));
  const totals = summarizeFamilies(families);
  const blockedFamilies = families.filter((family) => family.status === 'blocked');
  const guardedFamilies = families.filter((family) => family.status === 'planner-guarded');

  return {
    schemaVersion: 1,
    inventoryKind: 'benchmark-report',
    generatedAt: report.generatedAt || DEFAULT_NOW.toISOString(),
    benchmarkProfile: report.profile || 'unknown',
    source: {
      type: 'guarded-executor-benchmark',
    },
    supportedRelationshipTypes: [...supportedRelationshipTypes],
    mappedFamilyCounters: {
      ...totals,
      ...familyCounters,
      guardedReferences: totals.guardedReferences,
      totalReferences: totals.totalReferences,
      actionableReferences: totals.actionableReferences,
      mappedPercent: totals.mappedPercent,
    },
    totals,
    blockedFamilies,
    unmappedFamilies: families.filter((family) => family.unmapped > 0),
    guardedFamilies,
    families,
    suggestedLaneShards: buildSuggestedLaneShards(families),
  };
}

export function buildGraphMappingSnapshotInventory({
  familySnapshot = GRAPH_MAPPING_SNAPSHOT_FAMILIES,
  legacyAggregate = LEGACY_GRAPH_MAPPING_AGGREGATE,
  generatedAt = DEFAULT_NOW.toISOString(),
  supportedRelationshipTypes = SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
} = {}) {
  const families = familySnapshot.map((family) =>
    inventoryFamilyFromSnapshot(family, supportedRelationshipTypes));
  const totals = summarizeFamilies(families);
  assertSnapshotMatchesLegacyAggregate({ totals, legacyAggregate });

  return {
    schemaVersion: 1,
    inventoryKind: 'deterministic-snapshot',
    generatedAt,
    benchmarkProfile: 'snapshot',
    source: {
      type: 'deterministic-fixture',
      legacyAggregate: {
        mappedReferences: legacyAggregate.mappedReferences,
        totalReferences: legacyAggregate.totalReferences,
        origin: legacyAggregate.origin,
        searchedPatterns: [...legacyAggregate.searchedPatterns],
      },
    },
    supportedRelationshipTypes: [...supportedRelationshipTypes],
    mappedFamilyCounters: totals,
    totals,
    blockedFamilies: families.filter((family) => family.status === 'blocked'),
    unmappedFamilies: families.filter((family) => family.unmapped > 0),
    guardedFamilies: families.filter((family) => family.status === 'planner-guarded'),
    families,
    suggestedLaneShards: buildSuggestedLaneShards(families),
  };
}

export function generateGraphMappingInventory(options = {}) {
  if (options.source === 'benchmark' || options.report) {
    const report = options.report || runGuardedExecutorBenchmark({
      profile: 'unit',
      now: DEFAULT_NOW,
      ...options,
    });
    return buildGraphMappingInventory({ report });
  }
  if (options.source && options.source !== 'snapshot') {
    throw new Error(`Unknown graph mapping inventory source: ${options.source}`);
  }
  return buildGraphMappingSnapshotInventory(options);
}

export function generateBenchmarkGraphMappingInventory(options = {}) {
  const report = runGuardedExecutorBenchmark({
    profile: 'unit',
    now: DEFAULT_NOW,
    ...options,
  });
  return buildGraphMappingInventory({ report });
}

function inventoryFamilyFromDefinition(definition, family) {
  if (!definition?.id || !definition?.label) {
    throw new Error('Graph family definition is missing id or label.');
  }
  if (!definition.plannerOwner || !definition.smokeOwner) {
    throw new Error(`Graph family ${definition.id} is missing plannerOwner or smokeOwner.`);
  }
  if (!family || typeof family !== 'object') {
    throw new Error(`Graph family ${definition.id} is missing benchmark report coverage.`);
  }
  if (!family.status) {
    throw new Error(`Graph family ${definition.id} is missing benchmark status.`);
  }

  return {
    id: definition.id,
    family: family.family || definition.label,
    status: family.status,
    mapped: numberOrZero(family.mapped),
    unmapped: numberOrZero(family.unmapped),
    guarded: numberOrZero(family.guarded),
    total: numberOrZero(family.mapped) + numberOrZero(family.unmapped) + numberOrZero(family.guarded),
    blockers: Array.isArray(family.blockers) ? [...family.blockers] : [],
    plannerOwner: definition.plannerOwner,
    smokeOwner: definition.smokeOwner,
    ownerFiles: ownerFilesForFamily(definition, definition.id),
    relationshipTypes: Array.isArray(definition.relationshipTypes) ? [...definition.relationshipTypes] : [],
    notes: definition.notes || '',
    ...(typeof family.targets === 'number' ? { targets: family.targets } : {}),
  };
}

function inventoryFamilyFromSnapshot(family, supportedRelationshipTypes) {
  if (!family?.id || !family?.family) {
    throw new Error('Graph mapping snapshot family is missing id or family.');
  }
  if (!family.plannerOwner || !family.smokeOwner) {
    throw new Error(`Graph mapping snapshot family ${family.id} is missing plannerOwner or smokeOwner.`);
  }
  const mapped = numberOrZero(family.mapped);
  const unmapped = numberOrZero(family.unmapped);
  const guarded = numberOrZero(family.guarded);
  const relationshipTypes = Array.isArray(family.relationshipTypes) ? [...family.relationshipTypes] : [];
  const unsupportedRelationshipTypes = relationshipTypes.filter((relationshipType) =>
    !supportedRelationshipTypes.includes(relationshipType));
  if (unsupportedRelationshipTypes.length > 0) {
    throw new Error(
      `Graph mapping snapshot family ${family.id} has unsupported relationship types: ${unsupportedRelationshipTypes.join(', ')}`,
    );
  }

  return {
    id: family.id,
    family: family.family,
    status: family.status || statusForCounts({ mapped, unmapped, guarded }),
    mapped,
    unmapped,
    guarded,
    total: mapped + unmapped + guarded,
    relationshipTypes,
    blockers: Array.isArray(family.blockers) ? [...family.blockers] : blockersForCounts({ unmapped, guarded }),
    plannerOwner: family.plannerOwner,
    smokeOwner: family.smokeOwner,
    ownerFiles: ownerFilesForFamily(family, family.id),
    notes: family.notes || '',
  };
}

function buildSuggestedLaneShards(families) {
  const shardMap = new Map();
  for (const family of families) {
    addShard(shardMap, family, family.plannerOwner);
    addShard(shardMap, family, family.smokeOwner);
  }
  return [...shardMap.values()]
    .map(finalizeShard)
    .sort((left, right) =>
      right.totals.actionableReferences - left.totals.actionableReferences
      || right.totals.unmappedReferences - left.totals.unmappedReferences
      || left.shardId.localeCompare(right.shardId));
}

function addShard(shardMap, family, ownerTag) {
  const owner = parseOwnerTag(ownerTag, family.id);
  const shardId = `${owner.kind}:${owner.file}`;
  let shard = shardMap.get(shardId);
  if (!shard) {
    shard = {
      shardId,
      ownerKind: owner.kind,
      ownerFile: owner.file,
      familyIds: new Set(),
      families: [],
      familySummaries: [],
      statuses: [],
      relationshipTypes: new Set(),
      totals: zeroReferenceTotals(),
    };
    shardMap.set(shardId, shard);
  }
  if (shard.familyIds.has(family.id)) {
    return;
  }

  shard.familyIds.add(family.id);
  shard.families.push(family.id);
  shard.statuses.push(family.status);
  shard.familySummaries.push({
    id: family.id,
    family: family.family,
    status: family.status,
    mapped: family.mapped,
    unmapped: family.unmapped,
    guarded: family.guarded,
    total: family.total,
  });
  for (const relationshipType of family.relationshipTypes || []) {
    shard.relationshipTypes.add(relationshipType);
  }
  addReferenceTotals(shard.totals, family);
}

function parseOwnerTag(ownerTag, familyId) {
  if (typeof ownerTag !== 'string' || !ownerTag.includes(':')) {
    throw new Error(`Graph family ${familyId} has invalid owner tag ${JSON.stringify(ownerTag)}.`);
  }
  const [kind, ...rest] = ownerTag.split(':');
  const file = rest.join(':');
  if (!kind || !file) {
    throw new Error(`Graph family ${familyId} has invalid owner tag ${JSON.stringify(ownerTag)}.`);
  }
  return { kind, file };
}

function ownerFilesForFamily(family, familyId) {
  return {
    planner: parseOwnerTag(family.plannerOwner, familyId).file,
    smoke: parseOwnerTag(family.smokeOwner, familyId).file,
  };
}

function statusForCounts({ mapped, unmapped, guarded }) {
  if (guarded > 0 && mapped === 0 && unmapped === 0) {
    return 'planner-guarded';
  }
  if (mapped > 0 && unmapped === 0 && guarded === 0) {
    return 'mapped';
  }
  if (mapped > 0 && unmapped > 0 && guarded === 0) {
    return 'partially-mapped';
  }
  if (mapped === 0 && unmapped > 0 && guarded === 0) {
    return 'unmapped';
  }
  if (guarded > 0) {
    return 'partially-guarded';
  }
  return 'unknown';
}

function blockersForCounts({ unmapped, guarded }) {
  if (guarded > 0) {
    return ['surface remains intentionally fail-closed outside explicit driver allowlists'];
  }
  if (unmapped > 0) {
    return [`${unmapped} relationship reference(s) need owner-file mapping coverage`];
  }
  return [];
}

function summarizeFamilies(families) {
  const totals = families.reduce((summary, family) => {
    summary.mappedReferences += family.mapped;
    summary.unmappedReferences += family.unmapped;
    summary.guardedReferences += family.guarded;
    return summary;
  }, {
    mappedReferences: 0,
    unmappedReferences: 0,
    guardedReferences: 0,
  });
  const totalReferences = totals.mappedReferences + totals.unmappedReferences + totals.guardedReferences;

  return {
    totalFamilies: families.length,
    mappedFamilies: families.filter((family) => family.status === 'mapped').length,
    partiallyMappedFamilies: families.filter((family) => family.status === 'partially-mapped').length,
    unmappedFamilies: families.filter((family) => family.status === 'unmapped').length,
    blockedFamilies: families.filter((family) => family.status === 'blocked').length,
    guardedFamilies: families.filter((family) => family.status === 'planner-guarded').length,
    familiesWithUnmappedReferences: families.filter((family) => family.unmapped > 0).length,
    mappedReferences: totals.mappedReferences,
    unmappedReferences: totals.unmappedReferences,
    guardedReferences: totals.guardedReferences,
    totalReferences,
    actionableReferences: totals.unmappedReferences + totals.guardedReferences,
    mappedPercent: percentage(totals.mappedReferences, totalReferences),
  };
}

function assertSnapshotMatchesLegacyAggregate({ totals, legacyAggregate }) {
  if (totals.mappedReferences !== legacyAggregate.mappedReferences) {
    throw new Error(
      `Graph mapping snapshot mapped references ${totals.mappedReferences} do not match legacy aggregate ${legacyAggregate.mappedReferences}.`,
    );
  }
  if (totals.totalReferences !== legacyAggregate.totalReferences) {
    throw new Error(
      `Graph mapping snapshot total references ${totals.totalReferences} do not match legacy aggregate ${legacyAggregate.totalReferences}.`,
    );
  }
}

function zeroReferenceTotals() {
  return {
    mappedReferences: 0,
    unmappedReferences: 0,
    guardedReferences: 0,
    totalReferences: 0,
    actionableReferences: 0,
    mappedPercent: 0,
  };
}

function addReferenceTotals(totals, family) {
  totals.mappedReferences += family.mapped;
  totals.unmappedReferences += family.unmapped;
  totals.guardedReferences += family.guarded;
  totals.totalReferences += family.total;
  totals.actionableReferences += family.unmapped + family.guarded;
  totals.mappedPercent = percentage(totals.mappedReferences, totals.totalReferences);
}

function finalizeShard(shard) {
  return {
    shardId: shard.shardId,
    ownerKind: shard.ownerKind,
    ownerFile: shard.ownerFile,
    families: shard.families,
    familySummaries: shard.familySummaries,
    statuses: shard.statuses,
    relationshipTypes: [...shard.relationshipTypes].sort(),
    totals: {
      ...shard.totals,
      mappedPercent: percentage(shard.totals.mappedReferences, shard.totals.totalReferences),
    },
  };
}

function percentage(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function parseCliOptions(argv) {
  const options = {};
  if (argv.includes('--benchmark')) {
    options.source = 'benchmark';
  }
  const profileIndex = argv.indexOf('--profile');
  if (profileIndex !== -1 && argv[profileIndex + 1]) {
    options.profile = argv[profileIndex + 1];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const inventory = generateGraphMappingInventory(parseCliOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
