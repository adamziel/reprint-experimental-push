import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraphMappingInventory,
  generateGraphMappingInventory,
} from '../scripts/bench/graph-mapping-inventory.js';

test('graph mapping inventory emits the expected machine-readable shape', { concurrency: false }, () => {
  const inventory = generateGraphMappingInventory();

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.benchmarkProfile, 'unit');
  assert.deepEqual(inventory.supportedRelationshipTypes, [
    'comment-post',
    'comment-parent',
    'commentmeta-comment',
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
    totalFamilies: 7,
    mappedFamilies: 6,
    unmappedFamilies: 0,
    blockedFamilies: 0,
    guardedFamilies: 1,
    mappedReferences: 31,
    unmappedReferences: 0,
  });
  assert.equal(inventory.blockedFamilies.length, 0);
  assert.deepEqual(
    inventory.guardedFamilies.map((family) => family.id),
    ['unsupportedPluginOwnedSurfaces'],
  );
  assert.equal(inventory.families.length, 7);
  assert.ok(
    inventory.suggestedLaneShards.some((shard) =>
      shard.shardId === 'planner:test/push-planner.test.js'
      && shard.families.includes('postmetaPostRefs')
      && shard.families.includes('unsupportedPluginOwnedSurfaces')),
  );
  assert.ok(
    inventory.suggestedLaneShards.some((shard) =>
      shard.shardId === 'smoke:scripts/playground/push-protocol-smoke.mjs'
      && shard.families.includes('postsParents')
      && shard.families.includes('featuredImagesAttachments')),
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
