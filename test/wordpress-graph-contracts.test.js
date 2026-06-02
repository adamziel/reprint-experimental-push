import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS as PLANNER_SUPPORTED_RELATIONSHIPS,
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES as PLANNER_IDENTITY_MAP_SUFFIXES,
  WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES as PLANNER_COLLISION_SURFACES,
} from '../src/planner.js';
import {
  SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
  WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
  WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES,
  WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS,
  WORDPRESS_GRAPH_UNSUPPORTED_SURFACE_CONTRACTS,
  wordpressGraphRelationshipSupportsScalarRewrite,
} from '../src/wordpress-graph-contracts.js';
import { generateGraphMappingInventory } from '../scripts/bench/graph-mapping-inventory.js';

test('WordPress graph relationship contracts are the planner same-plan allowlist', () => {
  const relationshipTypes = WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS.map((contract) => contract.relationshipType);

  assert.equal(new Set(relationshipTypes).size, relationshipTypes.length);
  assert.deepEqual(relationshipTypes, SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS);
  assert.deepEqual(PLANNER_SUPPORTED_RELATIONSHIPS, SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS);
  assert.deepEqual(PLANNER_IDENTITY_MAP_SUFFIXES, SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES);
  assert.deepEqual(PLANNER_COLLISION_SURFACES, WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES);

  for (const contract of WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS) {
    assert.equal(contract.schemaVersion, WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION);
    assert.equal(contract.contractKind, 'wordpress-graph-relationship');
    assert.equal(contract.samePlanSupported, true);
    assert.equal(contract.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
    assert.equal(contract.rawValuesIncluded, false);
    assert.equal(typeof contract.sourceSuffix, 'string');
    assert.ok(contract.sourceFields.length > 0);
    assert.equal(typeof contract.targetSuffix, 'string');
  }
});

test('WordPress graph contracts mark serialized block references as detect-only', () => {
  const serializedContracts = WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS
    .filter((contract) => contract.relationshipType.startsWith('serialized-block-'));
  const featuredImage = WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS
    .find((contract) => contract.relationshipType === 'featured-image-attachment');
  const editLastUser = WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS
    .find((contract) => contract.relationshipType === 'postmeta-edit-last-user');

  assert.deepEqual(
    serializedContracts.map((contract) => contract.relationshipType),
    [
      'serialized-block-attachment',
      'serialized-block-post',
      'serialized-block-reusable-block',
    ],
  );
  for (const contract of serializedContracts) {
    assert.equal(contract.scalarRewriteSupported, false);
    assert.equal(
      wordpressGraphRelationshipSupportsScalarRewrite({
        relationshipType: contract.relationshipType,
      }),
      false,
    );
  }

  assert.equal(featuredImage.scalarRewriteSupported, true);
  assert.equal(featuredImage.sourceCondition, 'meta_key:_thumbnail_id');
  assert.equal(featuredImage.targetValidation, 'post-type:attachment');
  assert.equal(
    wordpressGraphRelationshipSupportsScalarRewrite({
      relationshipType: 'featured-image-attachment',
    }),
    true,
  );
  assert.equal(editLastUser.scalarRewriteSupported, true);
  assert.equal(editLastUser.sourceCondition, 'meta_key:_edit_last');
  assert.equal(editLastUser.targetValidation, 'valid-user-row');
  assert.equal(
    wordpressGraphRelationshipSupportsScalarRewrite({
      relationshipType: 'postmeta-edit-last-user',
    }),
    true,
  );
});

test('WordPress graph contracts bind core targets to primary-row validation', () => {
  const contractsByType = new Map(
    WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS.map((contract) => [contract.relationshipType, contract]),
  );
  const expectedTargetValidationByType = {
    'blog-site': 'valid-site-row',
    'blog-version-blog': 'valid-blog-row',
    'blogmeta-blog': 'valid-blog-row',
    'comment-parent': 'valid-comment-row',
    'comment-post': 'valid-post-row',
    'comment-user': 'valid-user-row',
    'commentmeta-comment': 'valid-comment-row',
    'link-owner': 'valid-user-row',
    'post-author': 'valid-user-row',
    'post-parent': 'valid-post-row',
    'postmeta-edit-last-user': 'valid-user-row',
    'postmeta-post': 'valid-post-row',
    'registration-log-blog': 'valid-blog-row',
    'serialized-block-post': 'valid-post-row',
    'sitemeta-site': 'valid-site-row',
    'term-relationship-object': 'valid-post-row',
    'term-relationship-taxonomy': 'valid-term-taxonomy-row',
    'term-taxonomy-parent': 'valid-term-row',
    'term-taxonomy-term': 'valid-term-row',
    'termmeta-term': 'valid-term-row',
    'usermeta-user': 'valid-user-row',
  };

  for (const [relationshipType, targetValidation] of Object.entries(expectedTargetValidationByType)) {
    assert.equal(contractsByType.get(relationshipType)?.targetValidation, targetValidation);
  }
});

test('graph inventory carries explicit graph contract evidence without raw values', { concurrency: false }, () => {
  const inventory = generateGraphMappingInventory();
  const relationshipContracts = inventory.graphContract.relationshipContracts;
  const unsupportedSurfaceContracts = inventory.graphContract.unsupportedSurfaceContracts;

  assert.equal(inventory.graphContract.schemaVersion, WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION);
  assert.equal(inventory.graphContract.rawValuesIncluded, false);
  assert.deepEqual(
    relationshipContracts.map((contract) => contract.relationshipType),
    SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
  );
  assert.equal(unsupportedSurfaceContracts.length, WORDPRESS_GRAPH_UNSUPPORTED_SURFACE_CONTRACTS.length);
  assert.ok(
    unsupportedSurfaceContracts.some((contract) =>
      contract.surface === 'wp_posts.post_type'
      && contract.unsupportedValues.includes('nav_menu_item')),
  );
  assert.ok(
    unsupportedSurfaceContracts.some((contract) =>
      contract.surface === 'wp_term_taxonomy.taxonomy'
      && contract.supportedValues?.includes('category')),
  );
  for (const contract of relationshipContracts) {
    assert.equal(contract.rawValuesIncluded, false);
  }
});
