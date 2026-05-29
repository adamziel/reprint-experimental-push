import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedFocusedNow = new Date('2026-05-29T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const generatedPluginName = 'reprint-push-forms-fixture';

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'basic' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function capturingDurableJournal() {
  return {
    claimFenced: true,
    claimHash: 'd'.repeat(64),
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one precondition per mutation`,
  );

  const preconditionsByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition source`);
  }
}

function assertNoRawValues(evidence, rawValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const value of rawValues) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw value ${value}`);
  }
}

function hashOnlySideEvidence(side) {
  if (!side) {
    return null;
  }
  return {
    state: side.state,
    hash: side.hash,
    fileType: side.fileType || null,
  };
}

function hashOnlyChangeEvidence(change) {
  if (!change) {
    return null;
  }
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: hashOnlySideEvidence(change.base),
    local: hashOnlySideEvidence(change.local),
    remote: hashOnlySideEvidence(change.remote),
  };
}

function hashOnlyMutationEvidence(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    resourceType: mutation.resource?.type || null,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: digest(mutation.value),
    change: hashOnlyChangeEvidence(mutation.change),
    pluginOwnedResource: mutation.pluginOwnedResource
      ? {
          pluginOwner: mutation.pluginOwnedResource.pluginOwner,
          driver: mutation.pluginOwnedResource.driver || null,
          ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired === true,
          supportsDelete: mutation.pluginOwnedResource.supportsDelete === true,
        }
      : null,
  };
}

function hashOnlyDecisionEvidence(decision) {
  return {
    id: decision.id,
    resourceKey: decision.resourceKey,
    resourceType: decision.resource?.type || null,
    decision: decision.decision,
    baseHash: decision.baseHash || null,
    localHash: decision.localHash || null,
    remoteHash: decision.remoteHash || null,
    targetResourceKey: decision.targetResourceKey || null,
    targetRemoteHash: decision.targetRemoteHash || null,
    change: hashOnlyChangeEvidence(decision.change),
  };
}

function hashOnlyPlanEvidence(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map(hashOnlyMutationEvidence),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    decisions: plan.decisions.map(hashOnlyDecisionEvidence),
    conflicts: plan.conflicts.map((conflict) => ({
      class: conflict.class || null,
      resourceKey: conflict.resourceKey,
      relatedResourceKey: conflict.relatedResourceKey || null,
      change: hashOnlyChangeEvidence(conflict.change),
    })),
    blockers: plan.blockers.map((blocker) => ({
      class: blocker.class || null,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner || null,
      driver: blocker.driver || null,
      change: hashOnlyChangeEvidence(blocker.change),
    })),
    atomicGroups: plan.atomicGroups.map((group) => ({
      id: group.id,
      status: group.status,
      resources: group.resources,
      dependencies: group.dependencies || null,
    })),
  };
}

function assertRemoteOnlyPluginMetadataDecision({ plan, pluginKey, label }) {
  const pluginDecision = decisionFor(plan, pluginKey);
  const pluginPrecondition = plan.preconditions.find((entry) => entry.resourceKey === pluginKey);

  assert.ok(pluginDecision, `${label} missing plugin metadata decision`);
  assert.equal(pluginDecision.decision, 'keep-remote', `${label} plugin metadata decision`);
  assert.equal(pluginDecision.change.localChange, 'unchanged', `${label} local metadata change`);
  assert.equal(pluginDecision.change.remoteChange, 'update', `${label} remote metadata change`);
  assert.match(pluginDecision.baseHash, /^[a-f0-9]{64}$/, `${label} base metadata hash`);
  assert.match(pluginDecision.remoteHash, /^[a-f0-9]{64}$/, `${label} remote metadata hash`);
  assert.equal(
    pluginDecision.change.remote.hash,
    pluginDecision.remoteHash,
    `${label} remote decision hash`,
  );
  assert.equal(mutationFor(plan, pluginKey), undefined, `${label} must not mutate remote-only metadata`);
  assert.equal(pluginPrecondition, undefined, `${label} must not precondition remote-only metadata`);
  return pluginDecision;
}

function generatedRemoteOnlyPluginMetadataTarget(testCase) {
  const baseMetadata = testCase.base.plugins[generatedPluginName];
  const localMetadata = testCase.local.plugins[generatedPluginName];
  const remoteMetadata = testCase.remote.plugins[generatedPluginName];

  assert.ok(baseMetadata, `${testCase.id} missing base plugin metadata`);
  assert.deepEqual(localMetadata, baseMetadata, `${testCase.id} local plugin metadata should be unchanged`);
  assert.notDeepEqual(remoteMetadata, baseMetadata, `${testCase.id} remote plugin metadata should drift`);
  assert.equal(typeof remoteMetadata.channel, 'string', `${testCase.id} missing remote channel`);
  assert.ok(
    remoteMetadata.channel.startsWith('remote-metadata-'),
    `${testCase.id} remote channel should use generated fixture marker`,
  );

  return {
    pluginName: generatedPluginName,
    pluginKey: `plugin:${generatedPluginName}`,
    remoteMetadata,
    privateValues: [remoteMetadata.channel],
  };
}

test('RPP-0226 preserves remote-only plugin metadata with redacted evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateLocalFile = '<?php echo "local-private-rpp0226-independent-file";';
  const privateRemoteVersion = 'remote-private-rpp0226-version-focused';
  const privateRemoteChannel = 'remote-private-rpp0226-channel-focused';
  const privateRemoteNote = 'remote-private-rpp0226-note-focused';

  local.files['index.php'] = privateLocalFile;
  remote.plugins.forms = {
    version: privateRemoteVersion,
    active: false,
    updateChannel: privateRemoteChannel,
    release: {
      note: privateRemoteNote,
    },
  };

  const firstPlan = createPushPlan({ base, local, remote, now: fixedFocusedNow });
  const secondPlan = createPushPlan({
    base: cloneJson(base),
    local: cloneJson(local),
    remote: cloneJson(remote),
    now: fixedFocusedNow,
  });
  const durableJournal = capturingDurableJournal();
  const result = applyPlan(cloneJson(remote), firstPlan, { durableJournal });
  const rawValues = [
    privateLocalFile,
    privateRemoteVersion,
    privateRemoteChannel,
    privateRemoteNote,
  ];
  const evidence = hashOnlyPlanEvidence(firstPlan);
  const pluginDecision = assertRemoteOnlyPluginMetadataDecision({
    plan: firstPlan,
    pluginKey: 'plugin:forms',
    label: 'RPP-0226 focused fixture',
  });
  const localMutation = mutationFor(firstPlan, 'file:index.php');

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(evidence, hashOnlyPlanEvidence(secondPlan), 'focused hash-only evidence should be stable');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, 'RPP-0226 focused fixture');
  assert.equal(localMutation?.action, 'put', 'focused local file mutation action');
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.files['index.php'], privateLocalFile);
  assert.deepEqual(result.site.plugins.forms, remote.plugins.forms);
  assert.equal(
    durableJournal.events.some((event) => event.resourceKey === 'plugin:forms'),
    false,
    'focused remote-only plugin metadata should not appear in mutation journal events',
  );
  assertNoRawValues(evidence, rawValues, 'focused hash-only plan evidence');
  assertNoRawValues(pluginDecision, rawValues, 'focused plugin decision evidence');
  assertNoRawValues(durableJournal.events, rawValues, 'focused durable journal evidence');
});

test('RPP-0226 generated remote-only plugin metadata is preserved with hash-only evidence', () => {
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'remote-only-plugin-metadata');

  assert.deepEqual(
    [...new Set(generatedCases.map((testCase) => testCase.tier))],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'generated remote-only plugin metadata fixtures must cover every tier',
  );

  const generatedEvidence = [];

  for (const generatedCase of generatedCases) {
    const target = generatedRemoteOnlyPluginMetadataTarget(generatedCase);
    const plan = createPushPlan({
      base: generatedCase.base,
      local: generatedCase.local,
      remote: generatedCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const replayPlan = createPushPlan({
      base: cloneJson(generatedCase.base),
      local: cloneJson(generatedCase.local),
      remote: cloneJson(generatedCase.remote),
      now: fixedGeneratedHarnessNow,
    });
    const validation = validateGeneratedCase(generatedCase);
    const durableJournal = capturingDurableJournal();
    const result = applyPlan(cloneJson(generatedCase.remote), plan, { durableJournal });
    const pluginDecision = assertRemoteOnlyPluginMetadataDecision({
      plan,
      pluginKey: target.pluginKey,
      label: `RPP-0226 generated ${generatedCase.id}`,
    });
    const evidence = hashOnlyPlanEvidence(plan);

    assert.ok(generatedCase.tags.has('remote-preserve'), `${generatedCase.id} missing remote-preserve tag`);
    assert.ok(
      generatedCase.tags.has('plugin-metadata-preserve'),
      `${generatedCase.id} missing plugin metadata preserve tag`,
    );
    assert.equal(plan.status, 'ready', `${generatedCase.id} plan status`);
    assert.equal(validation.status, 'ready', `${generatedCase.id} validation status`);
    assert.equal(validation.applied, true, `${generatedCase.id} validation apply result`);
    assert.equal(
      validation.unplannedRemotePreserved,
      true,
      `${generatedCase.id} validation must preserve unplanned remote metadata`,
    );
    assert.equal(validation.staleReplayRejected, true, `${generatedCase.id} stale replay refusal`);
    assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${generatedCase.id} stale code`);
    assert.equal(validation.staleReplayRemoteUnchanged, true, `${generatedCase.id} stale remote unchanged`);
    assert.ok(
      plan.mutations.length > 0,
      `${generatedCase.id} should include independent local mutations with the remote-only metadata`,
    );
    assertEveryMutationHasLiveRemotePrecondition(plan, `RPP-0226 generated ${generatedCase.id}`);
    assert.deepEqual(evidence, hashOnlyPlanEvidence(replayPlan), `${generatedCase.id} evidence stability`);
    assert.equal(result.appliedMutations, plan.mutations.length, `${generatedCase.id} applied mutation count`);
    assert.deepEqual(
      result.site.plugins[target.pluginName],
      target.remoteMetadata,
      `${generatedCase.id} remote-only plugin metadata should be preserved`,
    );
    assert.equal(
      durableJournal.events.some((event) => event.resourceKey === target.pluginKey),
      false,
      `${generatedCase.id} remote-only plugin metadata should not appear in mutation journal events`,
    );
    assertNoRawValues(evidence, target.privateValues, `${generatedCase.id} hash-only plan evidence`);
    assertNoRawValues(pluginDecision, target.privateValues, `${generatedCase.id} plugin decision evidence`);
    assertNoRawValues(durableJournal.events, target.privateValues, `${generatedCase.id} durable journal evidence`);

    generatedEvidence.push({
      id: generatedCase.id,
      tier: generatedCase.tier,
      pluginKey: target.pluginKey,
      status: plan.status,
      summary: plan.summary,
      pluginDecision: hashOnlyDecisionEvidence(pluginDecision),
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      appliedMutations: result.appliedMutations,
      validation: {
        applied: validation.applied,
        unplannedRemotePreserved: validation.unplannedRemotePreserved,
        staleReplayRejected: validation.staleReplayRejected,
        staleReplayRejectionCode: validation.staleReplayRejectionCode,
        staleReplayRemoteUnchanged: validation.staleReplayRemoteUnchanged,
      },
      metadataHash: digest(target.remoteMetadata),
      planEvidenceHash: digest(evidence),
    });
  }

  assertNoRawValues(
    generatedEvidence,
    generatedCases.flatMap((testCase) => [
      testCase.remote.plugins[generatedPluginName].channel,
    ]),
    'generated aggregate evidence',
  );
  assert.match(`sha256:${digest(generatedEvidence)}`, /^sha256:[a-f0-9]{64}$/);
});
