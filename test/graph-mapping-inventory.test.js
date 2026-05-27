import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraphMappingInventory,
  buildGraphMappingSnapshotInventory,
  generateGraphMappingInventory,
} from '../scripts/bench/graph-mapping-inventory.js';

test('graph mapping inventory emits a deterministic actionable snapshot', { concurrency: false }, () => {
  const inventory = generateGraphMappingInventory();

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.inventoryKind, 'deterministic-snapshot');
  assert.equal(inventory.benchmarkProfile, 'snapshot');
  assert.deepEqual(inventory.source.legacyAggregate, {
    mappedReferences: 444,
    totalReferences: 1589,
    origin: 'literal 444/1589 aggregate was not found in repository source; retained as a deterministic planning baseline',
    searchedPatterns: ['444', '1589', '444/1589'],
  });
  assert.deepEqual(inventory.supportedRelationshipTypes, [
    'comment-post',
    'comment-parent',
    'comment-user',
    'commentmeta-comment',
    'link-owner',
    'blog-site',
    'blogmeta-blog',
    'blog-version-blog',
    'sitemeta-site',
    'registration-log-blog',
    'post-parent',
    'post-author',
    'postmeta-post',
    'featured-image-attachment',
    'term-relationship-object',
    'term-relationship-taxonomy',
    'term-taxonomy-term',
    'term-taxonomy-parent',
    'termmeta-term',
    'usermeta-user',
  ]);
  assert.deepEqual(inventory.mappedFamilyCounters, {
    totalFamilies: 9,
    mappedFamilies: 0,
    partiallyMappedFamilies: 7,
    unmappedFamilies: 1,
    blockedFamilies: 0,
    guardedFamilies: 1,
    familiesWithUnmappedReferences: 8,
    mappedReferences: 444,
    unmappedReferences: 1083,
    guardedReferences: 62,
    totalReferences: 1589,
    actionableReferences: 1145,
    mappedPercent: 27.94,
  });
  assert.deepEqual(inventory.totals, inventory.mappedFamilyCounters);
  assert.equal(inventory.blockedFamilies.length, 0);
  assert.deepEqual(
    inventory.guardedFamilies.map((family) => family.id),
    ['unsupportedPluginOwnedSurfaces'],
  );
  assert.deepEqual(
    inventory.unmappedFamilies.map((family) => family.id),
    [
      'comments',
      'postsHierarchyAuthors',
      'postmetaPostRefs',
      'featuredImagesAttachments',
      'termsTaxonomies',
      'termRelationships',
      'termmeta',
      'usersUsermeta',
    ],
  );
  assert.equal(inventory.families.length, 9);
  assert.deepEqual(inventory.families.find((family) => family.id === 'comments'), {
    id: 'comments',
    family: 'comments',
    status: 'partially-mapped',
    mapped: 84,
    unmapped: 202,
    guarded: 0,
    total: 286,
    relationshipTypes: ['comment-post', 'comment-parent', 'commentmeta-comment'],
    blockers: ['202 relationship reference(s) need owner-file mapping coverage'],
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    ownerFiles: {
      planner: 'test/push-planner.test.js',
      smoke: 'scripts/playground/push-protocol-smoke.mjs',
    },
    notes: 'Comment post, parent, and commentmeta references need a dedicated owner shard beyond planner unit coverage.',
  });
  assert.ok(
    inventory.suggestedLaneShards.some((shard) =>
      shard.shardId === 'planner:test/push-planner.test.js'
      && shard.ownerFile === 'test/push-planner.test.js'
      && shard.families.includes('postmetaPostRefs')
      && shard.families.includes('unsupportedPluginOwnedSurfaces')
      && shard.totals.mappedReferences === 444
      && shard.totals.unmappedReferences === 1083
      && shard.totals.guardedReferences === 62
      && shard.totals.totalReferences === 1589),
  );
  assert.ok(
    inventory.suggestedLaneShards.some((shard) =>
      shard.shardId === 'smoke:scripts/playground/push-protocol-smoke.mjs'
      && shard.families.includes('comments')
      && shard.families.includes('featuredImagesAttachments')
      && shard.totals.actionableReferences === 683),
  );
});

test('graph mapping snapshot fails closed when the fixture drifts', { concurrency: false }, () => {
  const familySnapshot = [{
    id: 'comments',
    family: 'comments',
    relationshipTypes: ['comment-post'],
    mapped: 1,
    unmapped: 0,
    guarded: 0,
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
  }];

  assert.throws(
    () => buildGraphMappingSnapshotInventory({
      familySnapshot,
      legacyAggregate: {
        mappedReferences: 2,
        totalReferences: 1,
        origin: 'test',
        searchedPatterns: [],
      },
    }),
    /mapped references 1 do not match legacy aggregate 2/,
  );

  assert.throws(
    () => buildGraphMappingSnapshotInventory({
      familySnapshot: [{
        ...familySnapshot[0],
        relationshipTypes: ['unknown-relationship'],
      }],
      legacyAggregate: {
        mappedReferences: 1,
        totalReferences: 1,
        origin: 'test',
        searchedPatterns: [],
      },
    }),
    /unsupported relationship types: unknown-relationship/,
  );
});

test('graph mapping inventory fails closed when a family is missing ownership or status', { concurrency: false }, () => {
  const report = {
    generatedAt: '2026-05-24T00:00:00.000Z',
    profile: 'unit',
    evidence: {
      wordpressGraphIdentity: {
        familyCounters: {
          totalFamilies: 1,
          mappedFamilies: 0,
          unmappedFamilies: 0,
          blockedFamilies: 1,
          guardedFamilies: 0,
          mappedReferences: 0,
          unmappedReferences: 1,
        },
        familyReport: {
          postsParents: {
            family: 'posts/parents',
            mapped: 0,
            unmapped: 1,
            blockers: ['blocked'],
          },
        },
      },
    },
  };

  assert.throws(
    () => buildGraphMappingInventory({
      report,
      familyDefinitions: [{
        id: 'postsParents',
        label: 'posts/parents',
        plannerOwner: 'planner:test/push-planner.test.js',
        smokeOwner: '',
      }],
    }),
    /missing plannerOwner or smokeOwner/,
  );

  assert.throws(
    () => buildGraphMappingInventory({
      report,
      familyDefinitions: [{
        id: 'postsParents',
        label: 'posts/parents',
        plannerOwner: 'planner:test/push-planner.test.js',
        smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
      }],
    }),
    /missing benchmark status/,
  );
});
