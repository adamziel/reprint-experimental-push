import { digest } from './stable-json.js';

export const WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION = 1;
export const WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND = 'wordpress-graph-identity-map';

export const WORDPRESS_GRAPH_TABLE_SUFFIXES = Object.freeze([
  'registration_log',
  'blog_versions',
  'commentmeta',
  'sitemeta',
  'blogmeta',
  'comments',
  'term_relationships',
  'term_taxonomy',
  'postmeta',
  'usermeta',
  'users',
  'termmeta',
  'links',
  'blogs',
  'site',
  'posts',
  'terms',
]);

export const SUPPORTED_CORE_POST_OBJECT_TAXONOMIES = Object.freeze([
  'category',
  'post_tag',
  'post_format',
]);

export const UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACES = Object.freeze([
  'nav_menu_item',
  'revision',
  'wp_navigation',
]);

export const UNSUPPORTED_WORDPRESS_MENU_ITEM_META_KEYS = Object.freeze([
  '_menu_item_object',
  '_menu_item_object_id',
  '_menu_item_menu_item_parent',
  '_menu_item_type',
  'menu_item_parent',
]);

export const SERIALIZED_BLOCK_ATTACHMENT_REFERENCE_RULE_ENTRIES = Object.freeze([
  ['core/audio', Object.freeze(['id'])],
  ['core/cover', Object.freeze(['id'])],
  ['core/file', Object.freeze(['id'])],
  ['core/gallery', Object.freeze(['ids'])],
  ['core/image', Object.freeze(['id'])],
  ['core/media-text', Object.freeze(['mediaId'])],
  ['core/video', Object.freeze(['id'])],
]);

export const SERIALIZED_BLOCK_ATTACHMENT_REFERENCE_RULES = new Map(
  SERIALIZED_BLOCK_ATTACHMENT_REFERENCE_RULE_ENTRIES,
);

export const SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES = Object.freeze([
  'posts',
  'users',
  'comments',
  'terms',
  'term_taxonomy',
  'site',
  'blogs',
]);

const SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIX_SET = new Set(
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
);

export const WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES = Object.freeze([
  'wp_posts.guid',
  'wp_posts.post_type+post_name',
]);

export const WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS = Object.freeze([
  graphRelationshipContract({
    relationshipType: 'comment-post',
    sourceSuffix: 'comments',
    sourceField: 'comment_post_ID',
    targetSuffix: 'posts',
    targetValidation: 'valid-post-row',
  }),
  graphRelationshipContract({
    relationshipType: 'comment-parent',
    sourceSuffix: 'comments',
    sourceField: 'comment_parent',
    targetSuffix: 'comments',
    targetValidation: 'valid-comment-row',
  }),
  graphRelationshipContract({
    relationshipType: 'comment-user',
    sourceSuffix: 'comments',
    sourceField: 'user_id',
    targetSuffix: 'users',
    targetValidation: 'valid-user-row',
  }),
  graphRelationshipContract({
    relationshipType: 'commentmeta-comment',
    sourceSuffix: 'commentmeta',
    sourceField: 'comment_id',
    targetSuffix: 'comments',
    targetValidation: 'valid-comment-row',
  }),
  graphRelationshipContract({
    relationshipType: 'link-owner',
    sourceSuffix: 'links',
    sourceField: 'link_owner',
    targetSuffix: 'users',
    targetValidation: 'valid-user-row',
  }),
  graphRelationshipContract({
    relationshipType: 'blog-site',
    sourceSuffix: 'blogs',
    sourceField: 'site_id',
    targetSuffix: 'site',
    targetValidation: 'valid-site-row',
  }),
  graphRelationshipContract({
    relationshipType: 'blogmeta-blog',
    sourceSuffix: 'blogmeta',
    sourceField: 'blog_id',
    targetSuffix: 'blogs',
    targetValidation: 'valid-blog-row',
  }),
  graphRelationshipContract({
    relationshipType: 'blog-version-blog',
    sourceSuffix: 'blog_versions',
    sourceField: 'blog_id',
    targetSuffix: 'blogs',
    targetValidation: 'valid-blog-row',
  }),
  graphRelationshipContract({
    relationshipType: 'sitemeta-site',
    sourceSuffix: 'sitemeta',
    sourceField: 'site_id',
    targetSuffix: 'site',
    targetValidation: 'valid-site-row',
  }),
  graphRelationshipContract({
    relationshipType: 'registration-log-blog',
    sourceSuffix: 'registration_log',
    sourceField: 'blog_id',
    targetSuffix: 'blogs',
    targetValidation: 'valid-blog-row',
  }),
  graphRelationshipContract({
    relationshipType: 'post-parent',
    sourceSuffix: 'posts',
    sourceField: 'post_parent',
    targetSuffix: 'posts',
    targetValidation: 'valid-post-row',
  }),
  graphRelationshipContract({
    relationshipType: 'post-author',
    sourceSuffix: 'posts',
    sourceField: 'post_author',
    targetSuffix: 'users',
    targetValidation: 'valid-user-row',
  }),
  graphRelationshipContract({
    relationshipType: 'postmeta-post',
    sourceSuffix: 'postmeta',
    sourceField: 'post_id',
    targetSuffix: 'posts',
    targetValidation: 'valid-post-row',
  }),
  graphRelationshipContract({
    relationshipType: 'serialized-block-attachment',
    sourceSuffix: 'posts',
    sourceFields: Object.freeze(['post_content', 'post_excerpt']),
    targetSuffix: 'posts',
    scalarRewriteSupported: false,
    targetValidation: 'post-type:attachment',
  }),
  graphRelationshipContract({
    relationshipType: 'serialized-block-post',
    sourceSuffix: 'posts',
    sourceFields: Object.freeze(['post_content', 'post_excerpt']),
    targetSuffix: 'posts',
    scalarRewriteSupported: false,
    targetValidation: 'valid-post-row',
  }),
  graphRelationshipContract({
    relationshipType: 'serialized-block-reusable-block',
    sourceSuffix: 'posts',
    sourceFields: Object.freeze(['post_content', 'post_excerpt']),
    targetSuffix: 'posts',
    scalarRewriteSupported: false,
    targetValidation: 'post-type:wp_block',
  }),
  graphRelationshipContract({
    relationshipType: 'featured-image-attachment',
    sourceSuffix: 'postmeta',
    sourceField: 'meta_value',
    sourceCondition: 'meta_key:_thumbnail_id',
    targetSuffix: 'posts',
    targetValidation: 'post-type:attachment',
  }),
  graphRelationshipContract({
    relationshipType: 'postmeta-edit-last-user',
    sourceSuffix: 'postmeta',
    sourceField: 'meta_value',
    sourceCondition: 'meta_key:_edit_last',
    targetSuffix: 'users',
    targetValidation: 'valid-user-row',
  }),
  graphRelationshipContract({
    relationshipType: 'term-relationship-object',
    sourceSuffix: 'term_relationships',
    sourceField: 'object_id',
    targetSuffix: 'posts',
    targetValidation: 'valid-post-row',
  }),
  graphRelationshipContract({
    relationshipType: 'term-relationship-taxonomy',
    sourceSuffix: 'term_relationships',
    sourceField: 'term_taxonomy_id',
    targetSuffix: 'term_taxonomy',
    targetValidation: 'valid-term-taxonomy-row',
  }),
  graphRelationshipContract({
    relationshipType: 'term-taxonomy-term',
    sourceSuffix: 'term_taxonomy',
    sourceField: 'term_id',
    targetSuffix: 'terms',
    targetValidation: 'valid-term-row',
  }),
  graphRelationshipContract({
    relationshipType: 'term-taxonomy-parent',
    sourceSuffix: 'term_taxonomy',
    sourceField: 'parent',
    targetSuffix: 'terms',
    targetValidation: 'valid-term-row',
  }),
  graphRelationshipContract({
    relationshipType: 'termmeta-term',
    sourceSuffix: 'termmeta',
    sourceField: 'term_id',
    targetSuffix: 'terms',
    targetValidation: 'valid-term-row',
  }),
  graphRelationshipContract({
    relationshipType: 'usermeta-user',
    sourceSuffix: 'usermeta',
    sourceField: 'user_id',
    targetSuffix: 'users',
    targetValidation: 'valid-user-row',
  }),
]);

export const SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS = Object.freeze(
  WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS
    .filter((contract) => contract.samePlanSupported)
    .map((contract) => contract.relationshipType),
);

export const WORDPRESS_GRAPH_UNSUPPORTED_SURFACE_CONTRACTS = Object.freeze([
  Object.freeze({
    surface: 'wp_posts.post_type',
    unsupportedValues: UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACES,
    reasonCode: 'UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACE',
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
  }),
  Object.freeze({
    surface: 'wp_postmeta.meta_key',
    unsupportedValues: UNSUPPORTED_WORDPRESS_MENU_ITEM_META_KEYS,
    reasonCode: 'UNSUPPORTED_WORDPRESS_MENU_ITEM_META_GRAPH_SURFACE',
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
  }),
  Object.freeze({
    surface: 'wp_term_taxonomy.taxonomy',
    unsupportedValues: Object.freeze(['nav_menu']),
    reasonCode: 'UNSUPPORTED_WORDPRESS_NAV_MENU_TAXONOMY_GRAPH_SURFACE',
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
  }),
  Object.freeze({
    surface: 'wp_term_taxonomy.taxonomy',
    supportedValues: SUPPORTED_CORE_POST_OBJECT_TAXONOMIES,
    reasonCode: 'UNSUPPORTED_WORDPRESS_CUSTOM_TAXONOMY_GRAPH_SURFACE',
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
  }),
]);

export function wordpressGraphRelationshipContractForType(relationshipType) {
  return WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS.find((contract) =>
    contract.relationshipType === relationshipType) || null;
}

export function wordpressGraphRelationshipSupportsScalarRewrite(reference) {
  const contract = wordpressGraphRelationshipContractForType(reference?.relationshipType);
  if (contract && contract.scalarRewriteSupported === false) {
    return false;
  }
  return reference?.rewriteSupported !== false;
}

export function wordpressGraphIdentityMapContractHash({
  sourceResource = null,
  targetResource = null,
  sourceResourceKey = null,
  targetResourceKey = null,
} = {}) {
  const normalized = normalizedWordPressGraphIdentityMapContract({
    sourceResource,
    targetResource,
    sourceResourceKey,
    targetResourceKey,
  });
  return normalized ? digest(normalized) : null;
}

export function normalizeWordPressGraphIdentityMapContract(entry, {
  source = null,
  sourceResource = null,
  targetResource = null,
} = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { explicit: false, valid: true, evidence: null };
  }

  const nestedContract = entry.contract && typeof entry.contract === 'object' && !Array.isArray(entry.contract)
    ? entry.contract
    : null;
  const explicit = hasOwn(entry, 'contractVersion')
    || hasOwn(entry, 'schemaVersion')
    || hasOwn(entry, 'contractKind')
    || entry.kind === WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND
    || nestedContract?.kind === WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND
    || hasOwn(nestedContract || {}, 'schemaVersion');

  if (!explicit) {
    return { explicit: false, valid: true, evidence: null };
  }

  const contractVersion = entry.contractVersion
    ?? entry.schemaVersion
    ?? nestedContract?.schemaVersion
    ?? null;
  const contractKind = entry.contractKind
    ?? entry.kind
    ?? nestedContract?.kind
    ?? null;
  const sourceResourceKey = sourceResource?.key
    || entry.sourceResourceKey
    || entry.localResourceKey
    || entry.fromResourceKey
    || null;
  const targetResourceKey = targetResource?.key
    || entry.targetResourceKey
    || entry.remoteResourceKey
    || entry.toResourceKey
    || null;

  const issues = [];
  if (contractVersion !== WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_UNSUPPORTED_VERSION',
      field: 'contractVersion',
      required: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
      observed: contractVersion ?? null,
    });
  }
  if (!isNonEmptyString(contractKind)) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_MISSING_KIND',
      field: 'contractKind',
      required: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
      observed: contractKind ?? null,
    });
  } else if (contractKind !== WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_UNSUPPORTED_KIND',
      field: 'contractKind',
      required: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
      observed: contractKind ?? null,
    });
  }
  if (hasOwn(entry, 'rawValuesIncluded') && entry.rawValuesIncluded !== false) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_RAW_VALUES_INCLUDED',
      field: 'rawValuesIncluded',
      required: false,
      observed: entry.rawValuesIncluded,
    });
  }
  if (hasOwn(nestedContract, 'rawValuesIncluded') && nestedContract.rawValuesIncluded !== false) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_RAW_VALUES_INCLUDED',
      field: 'contract.rawValuesIncluded',
      required: false,
      observed: nestedContract.rawValuesIncluded,
    });
  }
  if (!sourceResource || sourceResource.type !== 'row') {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_MISSING_SOURCE_RESOURCE',
      field: 'sourceResourceKey',
      required: 'row resource key',
      observed: sourceResourceKey,
    });
  }
  if (!targetResource || targetResource.type !== 'row') {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_MISSING_TARGET_RESOURCE',
      field: 'targetResourceKey',
      required: 'row resource key',
      observed: targetResourceKey,
    });
  }
  if (sourceResource?.key && targetResource?.key && sourceResource.key === targetResource.key) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_SELF_MAPPING',
      field: 'targetResourceKey',
      required: 'different target resource',
      observed: targetResource.key,
    });
  }
  if (sourceResource?.type === 'row' && targetResource?.type === 'row') {
    const sourceSuffix = wordpressGraphTableSuffix(sourceResource.table);
    const targetSuffix = wordpressGraphTableSuffix(targetResource.table);
    const sourceSupported = SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIX_SET.has(sourceSuffix);
    const targetSupported = SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIX_SET.has(targetSuffix);
    if (!sourceSupported || !targetSupported) {
      issues.push({
        reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_UNSUPPORTED_TABLE_SURFACE',
        field: !sourceSupported ? 'sourceTable' : 'targetTable',
        required: [...SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES],
        observed: {
          sourceTable: sourceResource.table,
          sourceSuffix,
          targetTable: targetResource.table,
          targetSuffix,
        },
      });
    } else if (sourceSuffix !== targetSuffix) {
      issues.push({
        reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_CROSS_SURFACE',
        field: 'targetTable',
        required: sourceSuffix,
        observed: targetSuffix,
      });
    }
  }
  const expectedContractHash = sourceResource && targetResource
    ? wordpressGraphIdentityMapContractHash({ sourceResource, targetResource })
    : null;
  const suppliedContractHash = entry.contractHash ?? nestedContract?.contractHash ?? null;
  if (
    suppliedContractHash !== null
    && expectedContractHash !== null
    && suppliedContractHash !== expectedContractHash
  ) {
    issues.push({
      reasonCode: 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_HASH_MISMATCH',
      field: 'contractHash',
      required: expectedContractHash,
      observed: suppliedContractHash,
    });
  }

  const accepted = issues.length === 0;
  const contractHash = accepted ? expectedContractHash : null;
  return {
    explicit: true,
    valid: accepted,
    evidence: {
      schemaVersion: 1,
      operation: 'wordpress-graph-identity-map-contract-validation',
      contractKind: contractKind || null,
      contractVersion: Number.isInteger(contractVersion) ? contractVersion : null,
      outcome: accepted ? 'accepted' : 'refused-before-mutation',
      reasonCode: accepted
        ? 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED'
        : issues[0].reasonCode,
      issueCodes: issues.map((issue) => issue.reasonCode),
      issues,
      source,
      rawValuesIncluded: false,
      contractHash,
      sourceResourceKey: sourceResourceKey || null,
      targetResourceKey: targetResourceKey || null,
      sourceTable: sourceResource?.table || null,
      targetTable: targetResource?.table || null,
      sourceId: sourceResource?.id || null,
      targetId: targetResource?.id || null,
    },
  };
}

function normalizedWordPressGraphIdentityMapContract({
  sourceResource = null,
  targetResource = null,
  sourceResourceKey = null,
  targetResourceKey = null,
} = {}) {
  const source = normalizeContractResource(sourceResource, sourceResourceKey);
  const target = normalizeContractResource(targetResource, targetResourceKey);
  if (!source || !target || source.key === target.key) {
    return null;
  }
  return {
    schemaVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
    contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
    sourceResourceKey: source.key,
    targetResourceKey: target.key,
    sourceTable: source.table,
    targetTable: target.table,
    sourceId: source.id,
    targetId: target.id,
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
    rawValuesIncluded: false,
  };
}

function normalizeContractResource(resource, resourceKey = null) {
  if (resource?.type === 'row' && isNonEmptyString(resource.table) && isNonEmptyString(resource.id)) {
    return {
      key: resource.key || `row:${JSON.stringify([resource.table, resource.id])}`,
      table: resource.table,
      id: resource.id,
    };
  }
  return parseRowResourceKey(resourceKey);
}

export function parseWordPressGraphRowResourceKey(resourceKey) {
  return parseRowResourceKey(resourceKey);
}

function parseRowResourceKey(resourceKey) {
  if (!isNonEmptyString(resourceKey) || !resourceKey.startsWith('row:')) {
    return null;
  }
  try {
    const [table, id] = JSON.parse(resourceKey.slice('row:'.length));
    if (isNonEmptyString(table) && isNonEmptyString(id)) {
      return {
        key: `row:${JSON.stringify([table, id])}`,
        table,
        id,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function wordpressGraphTableSuffix(table) {
  if (!isNonEmptyString(table)) {
    return null;
  }
  return WORDPRESS_GRAPH_TABLE_SUFFIXES.find((suffix) =>
    table === `wp_${suffix}` || table.endsWith(`_${suffix}`)) || null;
}

function graphRelationshipContract({
  relationshipType,
  sourceSuffix,
  sourceField = null,
  sourceFields = null,
  sourceCondition = null,
  targetSuffix,
  scalarRewriteSupported = true,
  targetValidation = 'row-present',
  samePlanSupported = true,
}) {
  return Object.freeze({
    schemaVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
    contractKind: 'wordpress-graph-relationship',
    relationshipType,
    sourceSuffix,
    sourceFields: Object.freeze(sourceFields || [sourceField]),
    ...(sourceCondition ? { sourceCondition } : {}),
    targetSuffix,
    scalarRewriteSupported,
    targetValidation,
    samePlanSupported,
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
    rawValuesIncluded: false,
  });
}

function hasOwn(value, key) {
  return value && Object.prototype.hasOwnProperty.call(value, key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
