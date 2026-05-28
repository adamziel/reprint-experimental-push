#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  GRAPH_FAMILY_DEFINITIONS,
  runGuardedExecutorBenchmark,
} from './guarded-executor-benchmark.js';
import {
  SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
  WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES,
} from '../../src/planner.js';

const DEFAULT_NOW = new Date('2026-05-24T00:00:00.000Z');

export function buildGraphMappingInventory({
  report,
  familyDefinitions = GRAPH_FAMILY_DEFINITIONS,
  supportedRelationshipTypes = SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
  identityMapTableSuffixes = SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
  failClosedCollisionSurfaces = WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES,
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
  const blockedFamilies = families.filter((family) => family.status === 'blocked');
  const guardedFamilies = families.filter((family) => family.status === 'planner-guarded');

  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt || DEFAULT_NOW.toISOString(),
    benchmarkProfile: report.profile || 'unknown',
    supportedRelationshipTypes: [...supportedRelationshipTypes],
    identityMapCapabilities: {
      explicitMapTableSuffixes: [...identityMapTableSuffixes],
      failClosedCollisionSurfaces: [...failClosedCollisionSurfaces],
      rewritesRequireEquivalentRemoteTarget: true,
      rewritesRecordHashOnlyEvidence: true,
    },
    mappedFamilyCounters: { ...familyCounters },
    blockedFamilies,
    guardedFamilies,
    families,
    suggestedLaneShards: buildSuggestedLaneShards(families),
  };
}

export function generateGraphMappingInventory(options = {}) {
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
    blockers: Array.isArray(family.blockers) ? [...family.blockers] : [],
    plannerOwner: definition.plannerOwner,
    smokeOwner: definition.smokeOwner,
    notes: definition.notes || '',
    ...(typeof family.targets === 'number' ? { targets: family.targets } : {}),
  };
}

function buildSuggestedLaneShards(families) {
  const shardMap = new Map();
  for (const family of families) {
    addShard(shardMap, family, family.plannerOwner);
    addShard(shardMap, family, family.smokeOwner);
  }
  return [...shardMap.values()].sort((left, right) => left.shardId.localeCompare(right.shardId));
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
      families: [],
      statuses: [],
    };
    shardMap.set(shardId, shard);
  }

  shard.families.push(family.id);
  shard.statuses.push(family.status);
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

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const inventory = generateGraphMappingInventory();
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
