import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const productionOwnerPlugin = 'rpp-owner-context';
const productionPostmetaRowId = 'meta_id:9413';
const productionPostmetaResourceKey = `row:["wp_postmeta","${productionPostmetaRowId}"]`;
const productionPluginFilePath = `wp-content/plugins/${productionOwnerPlugin}/${productionOwnerPlugin}.php`;
const productionPluginFileResourceKey = `file:${productionPluginFilePath}`;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms base secret code */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base-secret-option' },
          __pluginOwner: 'forms',
        },
      },
    },
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { resourceKey, pluginOwner, driver, ...extra };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function productionOwnerContextSite({ rowMode = 'base', pluginFileMode = 'base' } = {}) {
  return {
    meta: {
      evidenceScope: 'production-backed',
      pluginOwnedResources: {
        evidenceScope: 'production-backed',
        allowedResources: [
          {
            resourceKey: productionPostmetaResourceKey,
            pluginOwner: productionOwnerPlugin,
            driver: 'wp-postmeta',
            evidenceScope: 'production-backed',
          },
        ],
      },
    },
    files: {
      [productionPluginFilePath]: `<?php /* RPP-0413 owner context ${pluginFileMode} */`,
    },
    plugins: {
      [productionOwnerPlugin]: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:413': {
          ID: 413,
          post_title: 'RPP-0413 owner context fixture',
          post_name: 'rpp-0413-owner-context-fixture',
          post_content: 'Stable post row for plugin-owned postmeta proof.',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [productionPostmetaRowId]: {
          meta_id: 9413,
          post_id: 413,
          meta_key: '_rpp_0413_owner_context',
          meta_value: {
            mode: rowMode,
            proof: 'local-production-owner-context',
          },
          __pluginOwner: productionOwnerPlugin,
        },
      },
    },
  };
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

test('stale plugin file owner context refuses plugin-owned row before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote private forms code */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.ownerContextRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.reason, `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`);
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.stalePluginFileResourceKeys, [formsPluginFileResourceKey]);
  assert.equal(evidence.context[0].resourceKey, formsPluginFileResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.match(evidence.context[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(blockerJson.includes('remote private forms code'), false);
  assert.equal(blockerJson.includes('local-private-option'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('stale plugin file context also refuses plugin metadata updates with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.plugins.forms = { version: '1.1.0', active: true };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote private forms code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsPluginResourceKey);
  const evidence = blocker.ownerContextRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsPluginResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.deepEqual(evidence.stalePluginFileResourceKeys, [formsPluginFileResourceKey]);
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.equal(blockerJson.includes('remote private forms code'), false);
});

test('allowed plugin driver row update remains ready when owner plugin file context matches remote', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms shared updated code */';
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-allowed-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms shared updated code */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(plan.blockers.length, 0);
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-allowed-option');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* forms shared updated code */');
});

test('local production owner-context proof carries one real mutation through apply and refuses stale plugin file', () => {
  const source = productionOwnerContextSite();
  const local = productionOwnerContextSite({ rowMode: 'local-apply' });
  const readyRemote = productionOwnerContextSite();
  const staleRemote = productionOwnerContextSite({ pluginFileMode: 'stale-remote' });
  const staleRemoteBefore = JSON.stringify(staleRemote);

  const readyPlan = planFor(source, local, readyRemote);
  const readyMutation = mutationFor(readyPlan, productionPostmetaResourceKey);
  const readyOwnerContextKeys = readyMutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey);
  const applied = applyPlan(readyRemote, readyPlan);
  const appliedRow = applied.site.db.wp_postmeta[productionPostmetaRowId];

  const stalePlan = planFor(source, local, staleRemote);
  const staleBlocker = stalePlan.blockers.find((entry) => entry.resourceKey === productionPostmetaResourceKey);
  const staleEvidence = staleBlocker.ownerFileRefusalEvidence;
  const staleApplyError = captureError(() => applyPlan(staleRemote, readyPlan));
  const proofEnvelope = JSON.stringify({
    ready: {
      status: readyPlan.status,
      mutations: readyPlan.mutations.length,
      preconditions: readyPlan.preconditions.length,
      mutation: {
        resourceKey: readyMutation.resourceKey,
        action: readyMutation.action,
        localHash: readyMutation.localHash,
        remoteBeforeHash: readyMutation.remoteBeforeHash,
        pluginOwnedResource: {
          pluginOwner: readyMutation.pluginOwnedResource.pluginOwner,
          driver: readyMutation.pluginOwnedResource.driver,
          releaseGateEvidenceScope: readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
          ownerContextResourceKeys: readyOwnerContextKeys,
        },
      },
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      appliedResourceKey: productionPostmetaResourceKey,
    },
    stale: {
      status: stalePlan.status,
      blockerClass: staleBlocker.class,
      evidence: staleEvidence,
      applyError: staleApplyError.details,
    },
  });

  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyPlan.mutations.length, 1);
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(readyMutation.resourceKey, productionPostmetaResourceKey);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, productionOwnerPlugin);
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(readyOwnerContextKeys.includes(productionPluginFileResourceKey), true);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(appliedRow.meta_value.mode, 'local-apply');
  assert.equal(applied.site.files[productionPluginFilePath], source.files[productionPluginFilePath]);

  assert.equal(stalePlan.status, 'blocked');
  assert.equal(stalePlan.summary.mutations, 0);
  assert.equal(mutationFor(stalePlan, productionPostmetaResourceKey), undefined);
  assert.equal(staleBlocker.class, 'stale-plugin-owner-context');
  assert.equal(staleEvidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(staleEvidence.operation, 'refuse-before-mutation');
  assert.deepEqual(staleEvidence.stalePluginFileResourceKeys, [productionPluginFileResourceKey]);
  assert.equal(staleEvidence.context[0].resourceKey, productionPluginFileResourceKey);
  assert.equal(staleEvidence.context[0].remoteChange, 'update');
  assert.ok(staleApplyError instanceof PushPlanError);
  assert.equal(staleApplyError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleApplyError.details.resourceKey, productionPostmetaResourceKey);
  assert.equal(staleApplyError.details.pluginOwner, productionOwnerPlugin);
  assert.equal(staleApplyError.details.contextResourceKey, productionPluginFileResourceKey);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBefore);
  assert.equal(proofEnvelope.includes('local-apply'), false);
  assert.equal(proofEnvelope.includes('stale-remote'), false);
});
