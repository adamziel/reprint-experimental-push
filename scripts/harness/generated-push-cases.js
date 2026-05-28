import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import { ABSENT, deepClone, digest } from '../../src/stable-json.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  resourceHash,
  setResource,
} from '../../src/resources.js';

export const MIN_GENERATED_PUSH_CASES = 300;
export const DEFAULT_GENERATED_PUSH_CASES = 360;
export const DEFAULT_GENERATED_PUSH_SEED = 0x52706e74;

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';

const scenarioFamilies = Object.freeze([
  'local-file-update',
  'remote-only-post-update',
  'independent-local-and-remote',
  'direct-row-conflict',
  'local-delete',
  'same-independent-content',
  'supported-plugin-option',
  'unsupported-plugin-owned-row',
  'plugin-owner-context-drift',
  'file-topology-conflict',
  'directory-descendant-conflict',
  'same-plan-post-parent-graph',
  'stale-graph-reference',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'supported-forms-lab-table',
  'forms-lab-delete-blocked',
  'atomic-plugin-stack-ready',
  'atomic-plugin-missing-dependency',
  'plugin-file-update',
  'plugin-context-metadata-drift',
  'remote-delete-local-unchanged',
  'local-create',
  'delete-edit-conflict',
  'file-create-update-delete-mix-ready',
  'file-create-update-delete-mix-conflict',
  'file-type-swap-ready',
  'file-type-swap-conflict',
  'row-create-update-delete-mix-ready',
  'row-create-update-delete-mix-conflict',
  'same-plan-user-meta-graph',
]);

const readyPreservingFamilies = new Set([
  'local-file-update',
  'remote-only-post-update',
  'independent-local-and-remote',
  'local-delete',
  'same-independent-content',
  'supported-plugin-option',
  'same-plan-post-parent-graph',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'supported-forms-lab-table',
  'atomic-plugin-stack-ready',
  'plugin-file-update',
  'remote-delete-local-unchanged',
  'local-create',
  'file-create-update-delete-mix-ready',
  'file-type-swap-ready',
  'row-create-update-delete-mix-ready',
  'same-plan-user-meta-graph',
]);

const targetCoverageDefinitions = Object.freeze({
  directoryDescendantConflict: {
    family: 'directory-descendant-conflict',
    tag: 'directory-delete-with-remote-descendant',
  },
});

export function generatePushHarnessCases({
  count = DEFAULT_GENERATED_PUSH_CASES,
  seed = DEFAULT_GENERATED_PUSH_SEED,
} = {}) {
  assert.ok(
    Number.isInteger(count) && count >= MIN_GENERATED_PUSH_CASES,
    `generated push harness needs at least ${MIN_GENERATED_PUSH_CASES} cases`,
  );

  return Array.from({ length: count }, (_, index) => {
    const tier = Math.min(9, Math.floor((index * 10) / count));
    const rng = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    return buildGeneratedCase({ index, tier, rng });
  });
}

export function runGeneratedPushHarness(options = {}) {
  const cases = generatePushHarnessCases(options);
  const summary = emptySummary();

  for (const testCase of cases) {
    const result = validateGeneratedCase(testCase);
    recordSummary(summary, testCase, result);
  }

  summary.totalCases = cases.length;
  summary.featureFamilies = Object.fromEntries(
    Object.entries(summary.featureFamilies).sort(([left], [right]) => left.localeCompare(right)),
  );
  summary.statuses = Object.fromEntries(
    Object.entries(summary.statuses).sort(([left], [right]) => left.localeCompare(right)),
  );
  summary.statusByTier = Object.fromEntries(
    Object.entries(summary.statusByTier)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, tiers]) => [
        status,
        Object.fromEntries(Object.entries(tiers).sort(([left], [right]) => Number(left) - Number(right))),
      ]),
  );
  summary.tiers = Object.fromEntries(
    Object.entries(summary.tiers).sort(([left], [right]) => Number(left) - Number(right)),
  );
  summary.targetCoverage = Object.fromEntries(
    Object.entries(summary.targetCoverage)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, coverage]) => [
        target,
        {
          ...coverage,
          perTier: sortNumericObject(coverage.perTier),
          statuses: sortStringObject(coverage.statuses),
        },
      ]),
  );

  return {
    summary,
    cases: cases.map((testCase) => ({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      tags: [...testCase.tags].sort(),
      complexityScore: testCase.complexityScore,
    })),
  };
}

export function validateGeneratedCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });

  assertPlanContract(testCase, plan);

  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const resourceCount = enumerateResources(testCase.base, testCase.local, testCase.remote).length;
  const result = {
    status: plan.status,
    mutations: plan.mutations.length,
    preconditions: plan.preconditions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    decisions: plan.decisions.length,
    atomicGroups: plan.atomicGroups.length,
    resourceCount,
  };

  if (plan.status === 'ready') {
    const applied = applyPlan(deepClone(testCase.remote), plan);
    assertMergedResultPreservesRemoteUnlessPlanned(testCase, plan, applied.site, mutationKeys);
    const staleReplay = assertReadyPlanRejectsStaleRemote(testCase, plan);
    result.staleReplayRejected = staleReplay.rejected;
    result.staleReplayRejectionCode = staleReplay.code;
    result.staleReplayRemoteUnchanged = staleReplay.remoteUnchanged;
    result.applied = true;
    return result;
  }

  const before = digest(testCase.remote);
  const error = captureError(() => applyPlan(testCase.remote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(testCase.remote), before, `${testCase.id} mutated a non-ready remote`);
  result.applied = false;
  return result;
}

function buildGeneratedCase({ index, tier, rng }) {
  const id = `generated-push-${String(index + 1).padStart(3, '0')}`;
  const family = scenarioFamilies[index % scenarioFamilies.length];
  const base = buildBaseSite(index, tier);
  const local = deepClone(base);
  const remote = deepClone(base);
  const allocator = createAllocator(index, tier);
  const tags = new Set([`tier-${tier}`]);

  scenarioFamilyBuilders[family]({
    id,
    family,
    tier,
    rng,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  addGeneratedComplexity({
    id,
    family,
    tier,
    rng,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  const complexityScore = enumerateResources(base, local, remote).length
    + (local.pushIntents?.length || 0) * 10
    + tags.size;

  return {
    id,
    index,
    tier,
    family,
    tags,
    complexityScore,
    base,
    local,
    remote,
  };
}

const scenarioFamilyBuilders = {
  'local-file-update': ({ local, allocator, tags }) => {
    const path = allocator.filePath('local');
    local.files[path] = `local file update ${allocator.next()}`;
    tags.add('ready-candidate');
  },
  'remote-only-post-update': ({ remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(remote, postId);
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote editorial ${allocator.next()}`;
    tags.add('remote-preserve');
  },
  'independent-local-and-remote': ({ local, remote, allocator, tags }) => {
    const localPath = allocator.filePath('independent-local');
    const remotePostId = allocator.postId();
    local.files[localPath] = `independent local ${allocator.next()}`;
    ensurePostExists(remote, remotePostId);
    remote.db.wp_posts[`ID:${remotePostId}`].post_title = `Independent remote ${allocator.next()}`;
    tags.add('independent-merge');
  },
  'direct-row-conflict': ({ local, remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(local, postId);
    ensurePostExists(remote, postId);
    local.db.wp_posts[`ID:${postId}`].post_title = `Local conflict ${allocator.next()}`;
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote conflict ${allocator.next()}`;
    tags.add('expected-conflict');
  },
  'local-delete': ({ local, allocator, tags }) => {
    const path = allocator.existingUploadPath();
    delete local.files[path];
    tags.add('delete');
  },
  'same-independent-content': ({ local, remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(local, postId);
    ensurePostExists(remote, postId);
    const title = `Shared independent ${allocator.next()}`;
    local.db.wp_posts[`ID:${postId}`].post_title = title;
    remote.db.wp_posts[`ID:${postId}`].post_title = title;
    tags.add('already-in-sync');
  },
  'supported-plugin-option': ({ base, local, remote, allocator, tags }) => {
    const optionName = `forms_generated_${allocator.next()}`;
    const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
    const row = {
      option_name: optionName,
      option_value: { mode: 'base', ordinal: allocator.next() },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_options', `option_name:${optionName}`, row);
    setRow(remote, 'wp_options', `option_name:${optionName}`, row);
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      ...row,
      option_value: { mode: 'local', ordinal: allocator.next() },
    });
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    tags.add('plugin-owned-supported');
  },
  'unsupported-plugin-owned-row': ({ local, allocator, tags }) => {
    const optionName = `unsafe_generated_${allocator.next()}`;
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      option_name: optionName,
      option_value: { mode: 'local-unsafe' },
      __pluginOwner: 'unknown-owner',
    });
    tags.add('plugin-owned-unsupported');
  },
  'plugin-owner-context-drift': ({ base, local, remote, allocator, tags }) => {
    local.db.wp_options['option_name:forms_settings'].option_value.mode = `local-${allocator.next()}`;
    remote.files['wp-content/plugins/forms/forms.php'] = `<?php /* remote forms ${allocator.next()} */`;
    allowPluginOwned(base, rowKey('wp_options', 'option_name:forms_settings'), 'forms', 'wp-option');
    allowPluginOwned(local, rowKey('wp_options', 'option_name:forms_settings'), 'forms', 'wp-option');
    tags.add('plugin-context-drift');
  },
  'file-topology-conflict': ({ base, local, remote, allocator, tags }) => {
    const directory = `wp-content/uploads/topology-${allocator.next()}`;
    base.files[directory] = { type: 'directory' };
    local.files[directory] = { type: 'directory' };
    remote.files[directory] = { type: 'directory' };
    delete local.files[directory];
    remote.files[`${directory}/remote-child.txt`] = `remote child ${allocator.next()}`;
    tags.add('file-topology');
  },
  'directory-descendant-conflict': ({ base, local, remote, allocator, tags }) => {
    const directory = `wp-content/uploads/descendant-${allocator.next()}`;
    const descendant = `${directory}/remote-child-${allocator.next()}.txt`;
    base.files[directory] = { type: 'directory' };
    local.files[directory] = { type: 'directory' };
    remote.files[directory] = { type: 'directory' };
    delete local.files[directory];
    remote.files[descendant] = `remote descendant ${allocator.next()}`;
    tags.add('file-topology');
    tags.add('directory-descendant');
    tags.add('directory-delete-with-remote-descendant');
  },
  'same-plan-post-parent-graph': ({ local, allocator, tags }) => {
    const parentId = allocator.graphId();
    const childId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${parentId}`, makePost(parentId, `Parent ${parentId}`));
    setRow(local, 'wp_posts', `ID:${childId}`, makePost(childId, `Child ${childId}`, {
      post_type: 'page',
      post_parent: parentId,
    }));
    tags.add('same-plan-graph');
    tags.add('post-parent-graph');
  },
  'stale-graph-reference': ({ local, remote, allocator, tags }) => {
    const remotePostId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(remote, 'wp_posts', `ID:${remotePostId}`, makePost(remotePostId, `Remote graph target ${remotePostId}`));
    setRow(local, 'wp_postmeta', `post_id:${remotePostId}:meta_key:_generated_graph_ref_${metaId}`, {
      post_id: remotePostId,
      meta_key: `_generated_graph_ref_${metaId}`,
      meta_value: 'local-stale-reference',
    });
    tags.add('stale-graph');
  },
  'same-plan-taxonomy-graph': ({ local, allocator, tags }) => {
    const termId = allocator.graphId();
    const taxonomyId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_terms', `term_id:${termId}`, {
      term_id: termId,
      name: `Generated term ${termId}`,
      slug: `generated-term-${termId}`,
      term_group: 0,
    });
    setRow(local, 'wp_term_taxonomy', `term_taxonomy_id:${taxonomyId}`, {
      term_taxonomy_id: taxonomyId,
      term_id: termId,
      taxonomy: 'category',
      parent: 0,
      count: 1,
    });
    setRow(local, 'wp_term_relationships', `object_id:1|term_taxonomy_id:${taxonomyId}`, {
      object_id: 1,
      term_taxonomy_id: taxonomyId,
      term_order: 0,
    });
    setRow(local, 'wp_termmeta', `meta_id:${metaId}`, {
      meta_id: metaId,
      term_id: termId,
      meta_key: '_generated_taxonomy_marker',
      meta_value: `marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('taxonomy-graph');
  },
  'same-plan-comment-graph': ({ local, allocator, tags }) => {
    const parentId = allocator.graphId();
    const childId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_comments', `comment_ID:${parentId}`, makeComment(parentId, {
      comment_post_ID: 1,
      comment_parent: 0,
      user_id: 1,
    }));
    setRow(local, 'wp_comments', `comment_ID:${childId}`, makeComment(childId, {
      comment_post_ID: 1,
      comment_parent: parentId,
      user_id: 1,
    }));
    setRow(local, 'wp_commentmeta', `meta_id:${metaId}`, {
      meta_id: metaId,
      comment_id: childId,
      meta_key: '_generated_comment_marker',
      meta_value: `comment-marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('comment-graph');
  },
  'supported-forms-lab-table': ({ base, local, remote, allocator, tags }) => {
    const id = allocator.formsLabId();
    const rowId = `id:${id}`;
    const row = {
      id,
      payload: { mode: 'base', token: `forms-lab-${id}` },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(local, 'wp_reprint_push_forms_lab', rowId, {
      ...row,
      payload: { mode: 'local', token: `forms-lab-${id}` },
    });
    allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
      table: 'wp_reprint_push_forms_lab',
    });
    tags.add('forms-lab-supported');
  },
  'forms-lab-delete-blocked': ({ base, local, remote, allocator, tags }) => {
    const id = allocator.formsLabId();
    const rowId = `id:${id}`;
    const row = {
      id,
      payload: { mode: 'base', token: `delete-blocked-${id}` },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
    deleteRow(local, 'wp_reprint_push_forms_lab', rowId);
    allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
      table: 'wp_reprint_push_forms_lab',
    });
    tags.add('forms-lab-delete-blocked');
  },
  'atomic-plugin-stack-ready': ({ local, tags }) => {
    installAtomicStack(local);
    tags.add('atomic-ready');
  },
  'atomic-plugin-missing-dependency': ({ local, tags }) => {
    local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* generated dependent */';
    local.plugins[atomicDependentPlugin] = {
      version: '1.0.0',
      active: true,
      requires: [atomicDependencyPlugin],
    };
    local.pushIntents = [
      {
        id: 'install-generated-dependent-without-dependency',
        kind: 'plugin-install',
        requireAtomic: true,
        resources: [
          `file:${pluginMainFile(atomicDependentPlugin)}`,
          `plugin:${atomicDependentPlugin}`,
        ],
        dependencies: { plugins: [atomicDependencyPlugin] },
      },
    ];
    tags.add('atomic-blocked');
  },
  'plugin-file-update': ({ local, allocator, tags }) => {
    local.files['wp-content/plugins/forms/forms.php'] = `<?php /* local forms ${allocator.next()} */`;
    tags.add('plugin-context-ready');
  },
  'plugin-context-metadata-drift': ({ local, remote, allocator, tags }) => {
    local.files['wp-content/plugins/forms/forms.php'] = `<?php /* local forms ${allocator.next()} */`;
    remote.plugins.forms.version = `1.${allocator.next()}.0`;
    tags.add('plugin-context-drift');
  },
  'remote-delete-local-unchanged': ({ remote, allocator, tags }) => {
    delete remote.files[allocator.existingUploadPath()];
    deleteRow(remote, 'wp_posts', 'ID:2');
    tags.add('remote-preserve');
    tags.add('remote-delete');
  },
  'local-create': ({ local, allocator, tags }) => {
    const postId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Generated post ${postId}`));
    local.files[allocator.filePath('create')] = `created ${allocator.next()}`;
    tags.add('local-create');
  },
  'delete-edit-conflict': ({ local, remote, allocator, tags }) => {
    const rowId = `ID:${allocator.postId()}`;
    deleteRow(local, 'wp_posts', rowId);
    ensurePostExists(remote, Number(rowId.slice(3)));
    remote.db.wp_posts[rowId].post_title = `Remote edit while local deletes ${allocator.next()}`;
    tags.add('expected-conflict');
    tags.add('delete-edit');
  },
  'file-create-update-delete-mix-ready': ({ local, allocator, tags }) => {
    addFileCreateUpdateDeleteMix(local, null, allocator, tags, {
      conflict: false,
      prefix: 'ready-file-mix',
    });
    tags.add('ready-candidate');
  },
  'file-create-update-delete-mix-conflict': ({ local, remote, allocator, tags }) => {
    addFileCreateUpdateDeleteMix(local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-file-mix',
    });
    tags.add('expected-conflict');
  },
  'file-type-swap-ready': ({ base, local, remote, allocator, tags }) => {
    addFileTypeSwap(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-type-swap',
    });
    tags.add('ready-candidate');
  },
  'file-type-swap-conflict': ({ base, local, remote, allocator, tags }) => {
    addFileTypeSwap(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-type-swap',
    });
    tags.add('expected-conflict');
  },
  'row-create-update-delete-mix-ready': ({ base, local, remote, allocator, tags }) => {
    addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-row-mix',
    });
    tags.add('ready-candidate');
  },
  'row-create-update-delete-mix-conflict': ({ base, local, remote, allocator, tags }) => {
    addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-row-mix',
    });
    tags.add('expected-conflict');
  },
  'same-plan-user-meta-graph': ({ local, allocator, tags }) => {
    const userId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_users', `ID:${userId}`, makeUser(userId));
    setRow(local, 'wp_usermeta', `umeta_id:${metaId}`, {
      umeta_id: metaId,
      user_id: userId,
      meta_key: '_generated_user_marker',
      meta_value: `user-marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('user-meta-graph');
  },
};

function buildBaseSite(index, tier) {
  const files = {
    'index.php': '<?php echo "base";',
    'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    'wp-content/uploads/shared-1.txt': 'base shared 1',
    'wp-content/uploads/shared-2.txt': 'base shared 2',
  };
  for (let i = 0; i < Math.max(1, Math.floor(tier / 2)); i++) {
    files[`wp-content/uploads/base-${index}-${i}.txt`] = `base file ${index}:${i}`;
  }

  const posts = {};
  const postCount = 3 + tier;
  for (let id = 1; id <= postCount; id++) {
    posts[`ID:${id}`] = makePost(id, `Base post ${id}`);
  }

  return {
    files,
    plugins: {
      forms: { version: '1.0.0', active: true },
      'reprint-push-forms-fixture': { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Generated Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base', index },
          __pluginOwner: 'forms',
        },
      },
      wp_users: {
        'ID:1': makeUser(1),
      },
      wp_posts: posts,
      wp_postmeta: {},
      wp_comments: {},
      wp_commentmeta: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
      wp_usermeta: {},
      wp_reprint_push_forms_lab: {},
    },
    meta: {
      pluginOwnedResources: {
        allowedResources: [
          allowedPluginOwnedResource(
            rowKey('wp_options', 'option_name:forms_settings'),
            'forms',
            'wp-option',
          ),
        ],
      },
    },
  };
}

function addGeneratedComplexity({
  family,
  tier,
  rng,
  base,
  local,
  remote,
  allocator,
  tags,
}) {
  const operationCount = Math.max(0, tier * 2 + randomInt(rng, 0, tier + 2));
  const preserveReady = readyPreservingFamilies.has(family);
  for (let i = 0; i < operationCount; i++) {
    if (preserveReady) {
      addReadyPreservingComplexityOperation({ tier, rng, base, local, remote, allocator, tags, index: i });
      continue;
    }
    const choice = randomInt(rng, 0, tier >= 7 ? 12 : 9);
    if (choice === 0) {
      const path = allocator.filePath(`bulk-${i}`);
      base.files[path] = `base bulk ${i}`;
      local.files[path] = `local bulk ${i}-${allocator.next()}`;
      remote.files[path] = base.files[path];
      tags.add('bulk-local-update');
    } else if (choice === 1) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      remote.db.wp_posts[`ID:${postId}`].post_title = `Remote bulk ${allocator.next()}`;
      tags.add('bulk-remote-preserve');
    } else if (choice === 2) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      local.db.wp_posts[`ID:${postId}`].post_title = `Local bulk conflict ${allocator.next()}`;
      remote.db.wp_posts[`ID:${postId}`].post_title = `Remote bulk conflict ${allocator.next()}`;
      tags.add('expected-conflict');
    } else if (choice === 3) {
      const optionName = `forms_bulk_${allocator.next()}`;
      const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
      const row = {
        option_name: optionName,
        option_value: { mode: 'base' },
        __pluginOwner: 'forms',
      };
      setRow(base, 'wp_options', `option_name:${optionName}`, row);
      setRow(local, 'wp_options', `option_name:${optionName}`, {
        ...row,
        option_value: { mode: 'local', bulk: i },
      });
      setRow(remote, 'wp_options', `option_name:${optionName}`, row);
      allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
      tags.add('plugin-owned-supported');
    } else if (choice === 4) {
      const postId = allocator.graphId();
      const metaId = allocator.graphId();
      setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Bulk graph post ${postId}`));
      setRow(local, 'wp_postmeta', `post_id:${postId}:meta_key:_bulk_graph_${metaId}`, {
        post_id: postId,
        meta_key: `_bulk_graph_${metaId}`,
        meta_value: `bulk-graph-${metaId}`,
      });
      tags.add('same-plan-graph');
    } else if (choice === 5 && tier >= 4) {
      const remotePostId = allocator.graphId();
      setRow(remote, 'wp_posts', `ID:${remotePostId}`, makePost(remotePostId, `Remote bulk graph ${remotePostId}`));
      setRow(local, 'wp_postmeta', `post_id:${remotePostId}:meta_key:_bulk_stale_graph`, {
        post_id: remotePostId,
        meta_key: '_bulk_stale_graph',
        meta_value: `stale-${remotePostId}`,
      });
      tags.add('stale-graph');
    } else if (choice === 6 && tier >= 5) {
      const directory = `wp-content/uploads/bulk-topology-${allocator.next()}`;
      base.files[directory] = { type: 'directory' };
      local.files[directory] = { type: 'file', content: `local type swap ${i}` };
      remote.files[directory] = { type: 'directory' };
      remote.files[`${directory}/remote-only.txt`] = `remote only ${i}`;
      tags.add('file-topology');
    } else if (choice === 7 && tier >= 6) {
      const optionName = `unsafe_bulk_${allocator.next()}`;
      setRow(local, 'wp_options', `option_name:${optionName}`, {
        option_name: optionName,
        option_value: { mode: 'unsafe-bulk' },
        __pluginOwner: 'unsafe-bulk-owner',
      });
      tags.add('plugin-owned-unsupported');
    } else if (choice === 8 && tier >= 7) {
      addCommentGraph(local, allocator);
      tags.add('same-plan-graph');
      tags.add('comment-graph');
    } else if (choice === 9 && tier >= 8) {
      addTaxonomyGraph(local, allocator);
      tags.add('same-plan-graph');
      tags.add('taxonomy-graph');
    } else if (choice === 10 && tier >= 8) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      deleteRow(local, 'wp_posts', `ID:${postId}`);
      tags.add('delete');
    } else if (choice === 11 && tier >= 9) {
      const id = allocator.formsLabId();
      const rowId = `id:${id}`;
      const row = {
        id,
        payload: { mode: 'base', generated: i },
        __pluginOwner: 'forms',
      };
      setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
      setRow(local, 'wp_reprint_push_forms_lab', rowId, {
        ...row,
        payload: { mode: 'local', generated: i },
      });
      setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
      allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
        table: 'wp_reprint_push_forms_lab',
      });
      tags.add('forms-lab-supported');
    }
  }
}

function addReadyPreservingComplexityOperation({
  tier,
  rng,
  base,
  local,
  remote,
  allocator,
  tags,
  index,
}) {
  const choice = randomInt(rng, 0, tier >= 8 ? 8 : 6);
  if (choice === 0) {
    const path = allocator.filePath(`ready-bulk-${index}`);
    base.files[path] = `base ready bulk ${index}`;
    local.files[path] = `local ready bulk ${index}-${allocator.next()}`;
    remote.files[path] = base.files[path];
    tags.add('bulk-local-update');
    return;
  }
  if (choice === 1) {
    const postId = allocator.postId();
    ensurePostExists(base, postId);
    ensurePostExists(local, postId);
    ensurePostExists(remote, postId);
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote ready preserve ${allocator.next()}`;
    tags.add('bulk-remote-preserve');
    return;
  }
  if (choice === 2) {
    const optionName = `forms_ready_bulk_${allocator.next()}`;
    const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
    const row = {
      option_name: optionName,
      option_value: { mode: 'base', ready: true },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_options', `option_name:${optionName}`, row);
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      ...row,
      option_value: { mode: 'local-ready', index },
    });
    setRow(remote, 'wp_options', `option_name:${optionName}`, row);
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    tags.add('plugin-owned-supported');
    return;
  }
  if (choice === 3) {
    const postId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Ready graph post ${postId}`));
    setRow(local, 'wp_postmeta', `post_id:${postId}:meta_key:_ready_graph_${metaId}`, {
      post_id: postId,
      meta_key: `_ready_graph_${metaId}`,
      meta_value: `ready-graph-${metaId}`,
    });
    tags.add('same-plan-graph');
    return;
  }
  if (choice === 4) {
    addCommentGraph(local, allocator);
    tags.add('same-plan-graph');
    tags.add('comment-graph');
    return;
  }
  if (choice === 5) {
    addTaxonomyGraph(local, allocator);
    tags.add('same-plan-graph');
    tags.add('taxonomy-graph');
    return;
  }
  if (choice === 6) {
    const path = allocator.filePath(`ready-create-${index}`);
    local.files[path] = `ready create ${index}-${allocator.next()}`;
    tags.add('local-create');
    return;
  }
  const postId = allocator.postId();
  ensurePostExists(base, postId);
  ensurePostExists(local, postId);
  ensurePostExists(remote, postId);
  const title = `Ready same content ${allocator.next()}`;
  local.db.wp_posts[`ID:${postId}`].post_title = title;
  remote.db.wp_posts[`ID:${postId}`].post_title = title;
  tags.add('already-in-sync');
}

function assertPlanContract(testCase, plan) {
  assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary mismatch`);
  assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary mismatch`);
  assert.equal(plan.summary.conflicts, plan.conflicts.length, `${testCase.id} conflict summary mismatch`);
  assert.equal(plan.summary.blockers, plan.blockers.length, `${testCase.id} blocker summary mismatch`);
  assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic summary mismatch`);
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${testCase.id} status does not match conflicts/blockers`,
  );

  assertUniqueIds(testCase.id, 'mutation', plan.mutations.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'precondition', plan.preconditions.map((entry) => entry.mutationId));
  assertUniqueIds(testCase.id, 'decision', plan.decisions.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'conflict', plan.conflicts.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'blocker', plan.blockers.map((entry) => entry.id));

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
    assert.equal(precondition.checkedAgainst, 'live-remote');
    if (mutation.pluginOwnedResource) {
      assert.ok(mutation.pluginOwnedResource.pluginOwner, `${testCase.id} plugin mutation missing owner`);
      assert.ok(mutation.pluginOwnedResource.driver, `${testCase.id} plugin mutation missing driver`);
    }
  }

  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  for (const conflict of plan.conflicts) {
    assert.equal(
      mutationKeys.has(conflict.resourceKey),
      false,
      `${testCase.id} has mutation for conflicted resource ${conflict.resourceKey}`,
    );
    assert.ok(conflict.resolutionPolicy?.startsWith('preserve-remote'), `${testCase.id} conflict lacks preserve policy`);
  }

  for (const blocker of plan.blockers) {
    if (blocker.resourceKey) {
      assert.equal(
        mutationKeys.has(blocker.resourceKey),
        false,
        `${testCase.id} has mutation for blocked resource ${blocker.resourceKey}`,
      );
    }
  }
}

function assertMergedResultPreservesRemoteUnlessPlanned(testCase, plan, resultSite, mutationKeys) {
  for (const resource of enumerateResources(testCase.base, testCase.local, testCase.remote, resultSite)) {
    const resultHash = resourceHash(resultSite, resource);
    if (mutationKeys.has(resource.key)) {
      assert.equal(
        resultHash,
        resourceHash(testCase.local, resource),
        `${testCase.id} did not apply planned local value for ${resource.key}`,
      );
    } else {
      assert.equal(
        resultHash,
        resourceHash(testCase.remote, resource),
        `${testCase.id} changed unplanned remote resource ${resource.key}`,
      );
    }
  }

  for (const mutation of plan.mutations) {
    const plannedValue = deserializeResourceValue(mutation.value);
    assert.equal(
      digest(plannedValue),
      resourceHash(resultSite, mutation.resource),
      `${testCase.id} planned mutation payload hash mismatch for ${mutation.resourceKey}`,
    );
  }
}

function assertReadyPlanRejectsStaleRemote(testCase, plan) {
  if (plan.mutations.length === 0) {
    return { rejected: false, code: null, remoteUnchanged: true };
  }
  const mutation = plan.mutations[0];
  const driftedRemote = deepClone(testCase.remote);
  setResource(driftedRemote, mutation.resource, staleValueFor(mutation.resource, getResource(driftedRemote, mutation.resource)));
  const before = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(digest(driftedRemote), before, `${testCase.id} stale apply changed remote state`);
  return { rejected: true, code: error.code, remoteUnchanged: true };
}

function recordSummary(summary, testCase, result) {
  increment(summary.tiers, testCase.tier);
  increment(summary.statuses, result.status);
  summary.statusByTier[result.status] ||= {};
  increment(summary.statusByTier[result.status], testCase.tier);
  increment(summary.featureFamilies, testCase.family);
  for (const tag of testCase.tags) {
    increment(summary.featureFamilies, tag);
  }
  recordTargetCoverage(summary, testCase, result);
  summary.maxResourceCount = Math.max(summary.maxResourceCount, result.resourceCount);
  summary.maxMutationCount = Math.max(summary.maxMutationCount, result.mutations);
  if (result.status === 'ready') {
    summary.maxReadyResourceCount = Math.max(summary.maxReadyResourceCount, result.resourceCount);
    summary.maxReadyMutationCount = Math.max(summary.maxReadyMutationCount, result.mutations);
  }
  summary.maxComplexityScore = Math.max(summary.maxComplexityScore, testCase.complexityScore);
  summary.totalMutations += result.mutations;
  summary.totalConflicts += result.conflicts;
  summary.totalBlockers += result.blockers;
  summary.totalDecisions += result.decisions;
}

function emptySummary() {
  return {
    totalCases: 0,
    minCasesRequired: MIN_GENERATED_PUSH_CASES,
    statuses: {},
    statusByTier: {},
    tiers: {},
    featureFamilies: {},
    targetCoverage: {},
    maxResourceCount: 0,
    maxMutationCount: 0,
    maxReadyResourceCount: 0,
    maxReadyMutationCount: 0,
    maxComplexityScore: 0,
    totalMutations: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalDecisions: 0,
  };
}

function recordTargetCoverage(summary, testCase, result) {
  for (const [target, definition] of Object.entries(targetCoverageDefinitions)) {
    if (testCase.family !== definition.family && !testCase.tags.has(definition.tag)) {
      continue;
    }
    const coverage = summary.targetCoverage[target] ||= {
      family: definition.family,
      total: 0,
      perTier: {},
      statuses: {},
    };
    coverage.total += 1;
    increment(coverage.perTier, testCase.tier);
    increment(coverage.statuses, result.status);
  }
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function installAtomicStack(local) {
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* generated dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* generated dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'generated-installed' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'install-generated-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
        rowKey('wp_options', 'option_name:reprint_push_atomic_fixture_data'),
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: {
        pluginOwnedResources: {
          allowedResources: [
            allowedPluginOwnedResource(
              rowKey('wp_options', 'option_name:reprint_push_atomic_fixture_data'),
              atomicDependentPlugin,
              'wp-option',
            ),
          ],
        },
      },
    },
  ];
}

function addFileCreateUpdateDeleteMix(local, remote, allocator, tags, { conflict, prefix }) {
  const createPath = allocator.filePath(`${prefix}-create`);
  const updatePath = allocator.existingUploadPath();
  const deletePath = updatePath.endsWith('shared-1.txt')
    ? 'wp-content/uploads/shared-2.txt'
    : 'wp-content/uploads/shared-1.txt';

  local.files[createPath] = `generated file mix create ${allocator.next()}`;
  local.files[updatePath] = `generated file mix update ${allocator.next()}`;
  delete local.files[deletePath];

  tags.add('file-create-update-delete-mix');
  tags.add('file-create');
  tags.add('file-update');
  tags.add('file-delete');

  if (conflict && remote) {
    remote.files[updatePath] = `remote concurrent file mix update ${allocator.next()}`;
  }
}

function addFileTypeSwap(base, local, remote, allocator, tags, { conflict, prefix }) {
  const path = `wp-content/uploads/${prefix}-${allocator.next()}`;
  base.files[path] = { type: 'directory' };
  local.files[path] = { type: 'file', content: `local type swap ${allocator.next()}` };
  remote.files[path] = { type: 'directory' };

  tags.add('file-type-swap');
  tags.add('file-topology');
  tags.add('type-change');

  if (conflict) {
    remote.files[`${path}/remote-descendant.txt`] = `remote descendant for type swap ${allocator.next()}`;
    tags.add('type-swap-conflict');
  } else {
    tags.add('type-swap-ready');
  }
}

function addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, { conflict, prefix }) {
  const createId = allocator.graphId();
  const updateId = allocator.graphId();
  const deleteId = allocator.graphId();
  const updateRowId = `ID:${updateId}`;
  const deleteRowId = `ID:${deleteId}`;
  const updateBase = makePost(updateId, `Base row mix update ${updateId}`);
  const deleteBase = makePost(deleteId, `Base row mix delete ${deleteId}`);

  setRow(base, 'wp_posts', updateRowId, updateBase);
  setRow(local, 'wp_posts', updateRowId, updateBase);
  setRow(remote, 'wp_posts', updateRowId, updateBase);
  setRow(base, 'wp_posts', deleteRowId, deleteBase);
  setRow(local, 'wp_posts', deleteRowId, deleteBase);
  setRow(remote, 'wp_posts', deleteRowId, deleteBase);

  setRow(local, 'wp_posts', `ID:${createId}`, makePost(createId, `Generated row mix create ${createId}`));
  setRow(local, 'wp_posts', updateRowId, {
    ...updateBase,
    post_title: `Generated row mix update ${prefix} ${allocator.next()}`,
  });
  deleteRow(local, 'wp_posts', deleteRowId);

  tags.add('row-create-update-delete-mix');
  tags.add('row-create');
  tags.add('row-update');
  tags.add('row-delete');

  if (conflict) {
    remote.db.wp_posts[updateRowId].post_title = `Remote concurrent row mix update ${allocator.next()}`;
  }
}

function addCommentGraph(local, allocator) {
  const parentId = allocator.graphId();
  const childId = allocator.graphId();
  setRow(local, 'wp_comments', `comment_ID:${parentId}`, makeComment(parentId, {
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 1,
  }));
  setRow(local, 'wp_comments', `comment_ID:${childId}`, makeComment(childId, {
    comment_post_ID: 1,
    comment_parent: parentId,
    user_id: 1,
  }));
}

function addTaxonomyGraph(local, allocator) {
  const termId = allocator.graphId();
  const taxonomyId = allocator.graphId();
  setRow(local, 'wp_terms', `term_id:${termId}`, {
    term_id: termId,
    name: `Generated term ${termId}`,
    slug: `generated-term-${termId}`,
  });
  setRow(local, 'wp_term_taxonomy', `term_taxonomy_id:${taxonomyId}`, {
    term_taxonomy_id: taxonomyId,
    term_id: termId,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  });
  setRow(local, 'wp_term_relationships', `object_id:1|term_taxonomy_id:${taxonomyId}`, {
    object_id: 1,
    term_taxonomy_id: taxonomyId,
    term_order: 0,
  });
}

function staleValueFor(resource, current) {
  if (current === ABSENT) {
    if (resource.type === 'file') {
      return `stale file ${resource.key}`;
    }
    if (resource.type === 'plugin') {
      return { version: 'stale', active: true };
    }
    return { stale: resource.key };
  }
  if (resource.type === 'file') {
    return { type: 'file', content: `stale drift ${resource.key}` };
  }
  if (resource.type === 'plugin') {
    return { ...current, version: `${current.version || '0.0.0'}-stale` };
  }
  return { ...current, __staleGeneratedHarness: true };
}

function ensurePostExists(site, id) {
  site.db ||= {};
  site.db.wp_posts ||= {};
  site.db.wp_posts[`ID:${id}`] ||= makePost(id, `Base post ${id}`);
}

function makePost(id, title, extra = {}) {
  return {
    ID: id,
    post_title: title,
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 1,
    ...extra,
  };
}

function makeUser(id) {
  return {
    ID: id,
    user_login: `generated-user-${id}`,
    user_email: `generated-user-${id}@example.test`,
    display_name: `Generated User ${id}`,
  };
}

function makeComment(id, extra = {}) {
  return {
    comment_ID: id,
    comment_content: `Generated comment ${id}`,
    comment_approved: '1',
    ...extra,
  };
}

function setRow(site, table, id, value) {
  site.db ||= {};
  site.db[table] ||= {};
  site.db[table][id] = deepClone(value);
}

function deleteRow(site, table, id) {
  site.db ||= {};
  site.db[table] ||= {};
  delete site.db[table][id];
}

function allowPluginOwned(site, resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  site.meta ||= {};
  site.meta.pluginOwnedResources ||= {};
  site.meta.pluginOwnedResources.allowedResources ||= [];
  if (site.meta.pluginOwnedResources.allowedResources.some((entry) =>
    entry.resourceKey === resourceKey && entry.pluginOwner === pluginOwner && entry.driver === driver)) {
    return;
  }
  site.meta.pluginOwnedResources.allowedResources.push(
    allowedPluginOwnedResource(resourceKey, pluginOwner, driver, extra),
  );
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return {
    resourceKey,
    pluginOwner,
    driver,
    ...extra,
  };
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function pluginResource(name) {
  return { type: 'plugin', name, key: `plugin:${name}` };
}

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function createAllocator(index, tier) {
  let counter = 0;
  const base = 10000 + index * 100 + tier * 10;
  return {
    next() {
      counter += 1;
      return counter;
    },
    postId() {
      return 2 + ((counter += 1) % Math.max(1, 2 + tier));
    },
    graphId() {
      counter += 1;
      return base + counter;
    },
    formsLabId() {
      counter += 1;
      return base + counter;
    },
    filePath(prefix) {
      counter += 1;
      return `wp-content/uploads/${prefix}-${base}-${counter}.txt`;
    },
    existingUploadPath() {
      counter += 1;
      return counter % 2 === 0 ? 'wp-content/uploads/shared-1.txt' : 'wp-content/uploads/shared-2.txt';
    },
  };
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}

function assertUniqueIds(caseId, label, values) {
  const seen = new Set();
  for (const value of values) {
    assert.equal(seen.has(value), false, `${caseId} duplicate ${label} id ${value}`);
    seen.add(value);
  }
}

function increment(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
}

function randomInt(rng, min, maxExclusive) {
  return min + Math.floor(rng() * (maxExclusive - min));
}

function mulberry32(seed) {
  return function nextRandom() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = runGeneratedPushHarness();
    console.log(JSON.stringify(report.summary, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
