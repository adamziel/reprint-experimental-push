import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const formsOptionResource = {
  type: 'row',
  table: 'wp_options',
  id: 'option_name:forms_settings',
  key: formsOptionResourceKey,
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms base plugin file */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'remote-preserved-option' },
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function assertSha256Evidence(value) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/);
}

function assertEvidenceRedacted(evidence, forbiddenValues) {
  const serialized = JSON.stringify(evidence);
  for (const value of forbiddenValues) {
    assert.equal(
      serialized.includes(value),
      false,
      `RPP-0454 evidence leaked ${value}`,
    );
  }
}

test('stale plugin metadata owner context refuses plugin-owned row before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: false };
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.reason, `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`);
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context[0].resourceKey, formsPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.match(evidence.context[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginResourceKey);
  assert.equal(blockerJson.includes('local-private-option'), false);
  assert.equal(blockerJson.includes('remote-preserved-option'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('stale plugin metadata owner context refuses plugin file mutation before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local private plugin file */';
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: false };
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsPluginFileResourceKey);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsPluginFileResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.equal(blockerJson.includes('local private plugin file'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('allowed plugin driver row update remains ready when owner metadata independently matches remote', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.plugins.forms = { version: '1.1.0', active: true };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-allowed-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: true };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(plan.blockers.length, 0);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-allowed-option');
});

test('RPP-0454 generated stale plugin metadata variants refuse before mutation with hash-only evidence', () => {
  const generatedCases = [
    {
      id: 'planner-stale-owner-metadata-blocks-plugin-owned-row',
      localMode: 'rpp0454-local-private-planner',
      remoteMode: 'rpp0454-remote-private-planner',
      remotePlugin: { version: '1.1.0', active: true },
      proofPath: 'planner-blocker',
    },
    {
      id: 'apply-stale-owner-metadata-revalidates-ready-plan',
      localMode: 'rpp0454-local-private-apply',
      remoteMode: 'rpp0454-remote-private-apply',
      remotePlugin: { version: '1.2.0', active: true },
      proofPath: 'apply-revalidation',
    },
  ];

  const evidence = generatedCases.map((generatedCase) => {
    const base = baseSite();
    base.db.wp_options['option_name:forms_settings'].option_value.mode = generatedCase.remoteMode;
    const local = cloneJson(base);
    local.db.wp_options['option_name:forms_settings'].option_value.mode = generatedCase.localMode;
    local.meta = {
      pushPolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
      ),
    };
    const forbiddenValues = [generatedCase.localMode, generatedCase.remoteMode];

    if (generatedCase.proofPath === 'planner-blocker') {
      const remote = cloneJson(base);
      remote.plugins.forms = generatedCase.remotePlugin;
      const remoteBeforeHash = sha256Evidence(remote);
      const rowBeforeHash = sha256Evidence(resourceHash(remote, formsOptionResource));
      const plan = planFor(base, local, remote);
      const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
      const error = captureError(() => applyPlan(remote, plan));
      const proof = {
        rpp: 'RPP-0454',
        generatedCaseId: generatedCase.id,
        evidenceSource: 'local-focused-plugin-driver-test',
        productionBacked: false,
        releaseGate: 'NO-GO',
        rawValuesIncluded: false,
        result: 'refused-before-mutation',
        refusalCode: error.code,
        blockerClass: blocker.class,
        ownerMetadataReasonCode: blocker.ownerMetadataRefusalEvidence.reasonCode,
        stalePluginMetadataResourceKeys: blocker.ownerMetadataRefusalEvidence.stalePluginMetadataResourceKeys,
        blockerHash: sha256Evidence(blocker),
        ownerMetadataRefusalEvidenceHash: sha256Evidence(blocker.ownerMetadataRefusalEvidence),
        remoteBeforeHash,
        remoteAfterHash: sha256Evidence(remote),
        rowBeforeHash,
        rowAfterHash: sha256Evidence(resourceHash(remote, formsOptionResource)),
      };

      assert.equal(plan.status, 'blocked');
      assert.equal(plan.summary.mutations, 0);
      assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
      assert.equal(blocker.class, 'stale-plugin-owner-context');
      assert.equal(blocker.ownerMetadataRefusalEvidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
      assert.equal(blocker.ownerMetadataRefusalEvidence.operation, 'refuse-before-mutation');
      assert.deepEqual(blocker.ownerMetadataRefusalEvidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
      assert.ok(error instanceof PushPlanError);
      assert.equal(error.code, 'PLAN_NOT_READY');
      assert.equal(proof.remoteBeforeHash, proof.remoteAfterHash);
      assert.equal(proof.rowBeforeHash, proof.rowAfterHash);
      assert.equal(
        remote.db.wp_options['option_name:forms_settings'].option_value.mode,
        generatedCase.remoteMode,
      );
      assertSha256Evidence(proof.blockerHash);
      assertSha256Evidence(proof.ownerMetadataRefusalEvidenceHash);
      assertSha256Evidence(proof.remoteBeforeHash);
      assertSha256Evidence(proof.rowBeforeHash);
      assertEvidenceRedacted({ proof, blocker }, forbiddenValues);
      return proof;
    }

    const dryRunRemote = cloneJson(base);
    const plan = planFor(base, local, dryRunRemote);
    const mutation = mutationFor(plan, formsOptionResourceKey);
    const ownerContext = mutation.pluginOwnedResource.ownerContext.find(
      (context) => context.resourceKey === formsPluginResourceKey,
    );
    const applyRemote = cloneJson(base);
    applyRemote.plugins.forms = generatedCase.remotePlugin;
    const remoteBeforeHash = sha256Evidence(applyRemote);
    const rowBeforeHash = sha256Evidence(resourceHash(applyRemote, formsOptionResource));
    const error = captureError(() => applyPlan(applyRemote, plan));
    const proof = {
      rpp: 'RPP-0454',
      generatedCaseId: generatedCase.id,
      evidenceSource: 'local-focused-plugin-driver-test',
      productionBacked: false,
      releaseGate: 'NO-GO',
      rawValuesIncluded: false,
      result: 'refused-before-mutation',
      refusalCode: error.code,
      contextResourceKey: error.details.contextResourceKey,
      readyPlanHash: sha256Evidence({
        id: plan.id,
        summary: plan.summary,
        mutationIds: plan.mutations.map((entry) => entry.id),
      }),
      mutationAuditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.auditEvidence),
      ownerContextHash: sha256Evidence(mutation.pluginOwnedResource.ownerContext),
      staleOwnerMetadataErrorDetailsHash: sha256Evidence(error.details),
      remoteBeforeHash,
      remoteAfterHash: sha256Evidence(applyRemote),
      rowBeforeHash,
      rowAfterHash: sha256Evidence(resourceHash(applyRemote, formsOptionResource)),
    };

    assert.equal(plan.status, 'ready');
    assert.equal(plan.summary.mutations, 1);
    assert.equal(plan.blockers.length, 0);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
    assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
    assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
    assert.ok(ownerContext);
    assert.match(ownerContext.remoteHash, /^[a-f0-9]{64}$/);
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(error.details.resourceKey, formsOptionResourceKey);
    assert.equal(error.details.contextResourceKey, formsPluginResourceKey);
    assert.equal(proof.remoteBeforeHash, proof.remoteAfterHash);
    assert.equal(proof.rowBeforeHash, proof.rowAfterHash);
    assert.equal(
      applyRemote.db.wp_options['option_name:forms_settings'].option_value.mode,
      generatedCase.remoteMode,
    );
    assertSha256Evidence(proof.readyPlanHash);
    assertSha256Evidence(proof.mutationAuditEvidenceHash);
    assertSha256Evidence(proof.ownerContextHash);
    assertSha256Evidence(proof.staleOwnerMetadataErrorDetailsHash);
    assertSha256Evidence(proof.remoteBeforeHash);
    assertSha256Evidence(proof.rowBeforeHash);
    assertEvidenceRedacted({ proof, mutationAuditEvidence: mutation.pluginOwnedResource.auditEvidence }, forbiddenValues);
    return proof;
  });

  assert.deepEqual(
    evidence.map((entry) => [entry.generatedCaseId, entry.refusalCode, entry.rowBeforeHash === entry.rowAfterHash]),
    [
      ['planner-stale-owner-metadata-blocks-plugin-owned-row', 'PLAN_NOT_READY', true],
      ['apply-stale-owner-metadata-revalidates-ready-plan', 'STALE_PLUGIN_OWNER_CONTEXT', true],
    ],
  );
});
