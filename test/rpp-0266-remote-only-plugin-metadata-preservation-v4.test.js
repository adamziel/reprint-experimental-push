import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  resourceHash,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedFocusedNow = new Date('2026-05-30T12:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const generatedPluginName = 'reprint-push-forms-fixture';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256UriPattern = /^sha256:[a-f0-9]{64}$/;

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

function pluginResource(pluginName) {
  return { type: 'plugin', name: pluginName, key: `plugin:${pluginName}` };
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
    claimHash: '7'.repeat(64),
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence += 1;
      return record;
    },
  };
}

function assertPlanSummaryMatches(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary should match emitted plan arrays`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live precondition per mutation`,
  );

  const preconditionByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition source`);
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
    plannedValueHash: `sha256:${digest(deserializeResourceValue(mutation.value))}`,
    change: hashOnlyChangeEvidence(mutation.change),
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
      id: conflict.id,
      class: conflict.class || null,
      resourceKey: conflict.resourceKey,
      relatedResourceKey: conflict.relatedResourceKey || null,
      change: hashOnlyChangeEvidence(conflict.change),
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      class: blocker.class || null,
      resourceKey: blocker.resourceKey || null,
      pluginOwner: blocker.pluginOwner || null,
      driver: blocker.driver || null,
      change: hashOnlyChangeEvidence(blocker.change),
    })),
    atomicGroups: plan.atomicGroups.map((group) => ({
      id: group.id,
      status: group.status,
      resources: group.resources,
      mutationIds: group.mutationIds,
      dependencies: group.dependencies || null,
    })),
  };
}

function stringLeaves(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringLeaves);
  }
  return Object.values(value).flatMap(stringLeaves);
}

function assertNoRawValues(evidence, rawValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const value of rawValues.filter(Boolean)) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw value ${value}`);
  }
}

function assertRemoteOnlyPluginMetadataDecision({ plan, base, local, remote, pluginName, label }) {
  const resource = pluginResource(pluginName);
  const pluginKey = resource.key;
  const pluginDecision = decisionFor(plan, pluginKey);
  const pluginPrecondition = plan.preconditions.find((entry) => entry.resourceKey === pluginKey);
  const baseHash = resourceHash(base, resource);
  const localHash = resourceHash(local, resource);
  const remoteHash = resourceHash(remote, resource);

  assert.ok(pluginDecision, `${label} missing plugin metadata decision`);
  assert.equal(pluginDecision.resource?.type, 'plugin', `${label} decision resource type`);
  assert.equal(pluginDecision.decision, 'keep-remote', `${label} plugin metadata decision`);
  assert.equal(pluginDecision.change.localChange, 'unchanged', `${label} local metadata change`);
  assert.equal(pluginDecision.change.remoteChange, 'update', `${label} remote metadata change`);
  assert.match(pluginDecision.baseHash, sha256Pattern, `${label} base metadata hash`);
  assert.match(pluginDecision.remoteHash, sha256Pattern, `${label} remote metadata hash`);
  assert.equal(localHash, baseHash, `${label} local metadata must match the pull base`);
  assert.notEqual(remoteHash, baseHash, `${label} remote metadata must drift from the pull base`);
  assert.equal(pluginDecision.baseHash, baseHash, `${label} base decision hash`);
  assert.equal(pluginDecision.remoteHash, remoteHash, `${label} remote decision hash`);
  assert.equal(pluginDecision.change.base.hash, baseHash, `${label} change base hash`);
  assert.equal(pluginDecision.change.local.hash, localHash, `${label} change local hash`);
  assert.equal(pluginDecision.change.remote.hash, remoteHash, `${label} change remote hash`);
  assert.equal(mutationFor(plan, pluginKey), undefined, `${label} must not mutate remote-only metadata`);
  assert.equal(pluginPrecondition, undefined, `${label} must not precondition remote-only metadata`);

  return pluginDecision;
}

function assertNoPluginJournalEvents(durableJournal, pluginKey, label) {
  assert.equal(
    durableJournal.events.some((event) => event.resourceKey === pluginKey),
    false,
    `${label} remote-only plugin metadata should not appear in durable mutation events`,
  );
}

function generatedRemoteOnlyPluginMetadataTarget(testCase) {
  const baseMetadata = testCase.base.plugins[generatedPluginName];
  const localMetadata = testCase.local.plugins[generatedPluginName];
  const remoteMetadata = testCase.remote.plugins[generatedPluginName];

  assert.ok(baseMetadata, `${testCase.id} missing base plugin metadata`);
  assert.deepEqual(localMetadata, baseMetadata, `${testCase.id} local plugin metadata should be unchanged`);
  assert.notDeepEqual(remoteMetadata, baseMetadata, `${testCase.id} remote plugin metadata should drift`);
  assert.equal(typeof remoteMetadata.channel, 'string', `${testCase.id} missing remote-only metadata channel`);
  assert.ok(
    remoteMetadata.channel.startsWith('remote-metadata-'),
    `${testCase.id} remote channel should use generated fixture marker`,
  );

  return {
    pluginName: generatedPluginName,
    pluginKey: `plugin:${generatedPluginName}`,
    resource: pluginResource(generatedPluginName),
    remoteMetadata,
    rawMetadataValues: stringLeaves(remoteMetadata),
  };
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
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

function generatedRemoteOnlyPluginMetadataVariant4Evidence() {
  const perTier = {};
  const statuses = {};
  const cases = [];
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'remote-only-plugin-metadata');

  assert.equal(generatedCases.length, 10, 'RPP-0266 generated family should expose one case per tier');
  assert.deepEqual(
    [...new Set(generatedCases.map((testCase) => testCase.tier))],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'RPP-0266 generated family must cover tiers 0 through 9',
  );

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
    const applied = applyPlan(cloneJson(generatedCase.remote), plan, { durableJournal });
    const pluginDecision = assertRemoteOnlyPluginMetadataDecision({
      plan,
      base: generatedCase.base,
      local: generatedCase.local,
      remote: generatedCase.remote,
      pluginName: target.pluginName,
      label: `RPP-0266 generated ${generatedCase.id}`,
    });
    const planEvidence = hashOnlyPlanEvidence(plan);

    assert.ok(generatedCase.tags.has('remote-preserve'), `${generatedCase.id} missing remote-preserve tag`);
    assert.ok(
      generatedCase.tags.has('plugin-metadata-preserve'),
      `${generatedCase.id} missing plugin-metadata-preserve tag`,
    );
    assert.equal(plan.status, 'ready', `${generatedCase.id} plan status`);
    assertPlanSummaryMatches(plan, `RPP-0266 generated ${generatedCase.id}`);
    assert.equal(validation.status, 'ready', `${generatedCase.id} validation status`);
    assert.equal(validation.applied, true, `${generatedCase.id} validation applied`);
    assert.equal(
      validation.unplannedRemotePreserved,
      true,
      `${generatedCase.id} generated validation should preserve unplanned remote metadata`,
    );
    assert.equal(validation.staleReplayRejected, true, `${generatedCase.id} generated stale replay refusal`);
    assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${generatedCase.id} stale code`);
    assert.equal(validation.staleReplayRemoteUnchanged, true, `${generatedCase.id} stale remote unchanged`);
    assert.ok(plan.mutations.length > 0, `${generatedCase.id} should retain independent local mutations`);
    assertEveryMutationHasLiveRemotePrecondition(plan, `RPP-0266 generated ${generatedCase.id}`);
    assert.deepEqual(planEvidence, hashOnlyPlanEvidence(replayPlan), `${generatedCase.id} evidence stability`);
    assert.equal(applied.appliedMutations, plan.mutations.length, `${generatedCase.id} applied mutation count`);
    assert.deepEqual(
      applied.site.plugins[target.pluginName],
      target.remoteMetadata,
      `${generatedCase.id} applied site should preserve remote-only plugin metadata`,
    );
    assert.equal(
      resourceHash(applied.site, target.resource),
      resourceHash(generatedCase.remote, target.resource),
      `${generatedCase.id} applied metadata hash should match live remote`,
    );
    assertNoPluginJournalEvents(durableJournal, target.pluginKey, `RPP-0266 generated ${generatedCase.id}`);
    assertNoRawValues(planEvidence, target.rawMetadataValues, `${generatedCase.id} hash-only plan evidence`);
    assertNoRawValues(pluginDecision, target.rawMetadataValues, `${generatedCase.id} plugin decision evidence`);
    assertNoRawValues(durableJournal.events, target.rawMetadataValues, `${generatedCase.id} durable journal evidence`);

    incrementCount(perTier, generatedCase.tier);
    incrementCount(statuses, plan.status);
    cases.push({
      id: generatedCase.id,
      tier: generatedCase.tier,
      family: generatedCase.family,
      status: plan.status,
      tags: [...generatedCase.tags].sort(),
      planSummary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      appliedMutations: applied.appliedMutations,
      validation: {
        applied: validation.applied,
        unplannedRemotePreserved: validation.unplannedRemotePreserved,
        staleReplayRejected: validation.staleReplayRejected,
        staleReplayRejectionCode: validation.staleReplayRejectionCode,
        staleReplayRemoteUnchanged: validation.staleReplayRemoteUnchanged,
      },
      metadata: {
        resourceKey: target.pluginKey,
        baseHash: resourceHash(generatedCase.base, target.resource),
        localHash: resourceHash(generatedCase.local, target.resource),
        remoteHash: resourceHash(generatedCase.remote, target.resource),
        appliedHash: resourceHash(applied.site, target.resource),
        decisionHash: `sha256:${digest(hashOnlyDecisionEvidence(pluginDecision))}`,
        plannedMutation: false,
        plannedPrecondition: false,
      },
      planEvidenceHash: `sha256:${digest(planEvidence)}`,
      modelProofHash: `sha256:${digest({
        metadata: hashOnlyDecisionEvidence(pluginDecision),
        summary: plan.summary,
        validation,
      })}`,
    });
  }

  return {
    target: 'remoteOnlyPluginMetadataPreservationVariant4',
    family: 'remote-only-plugin-metadata',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases: cases.length,
    perTier: sortNumericObject(perTier),
    statuses: sortStringObject(statuses),
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

test('RPP-0266 focused remote-only plugin metadata survives independent local mutations', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateLocalFile = '<?php echo "local-private-rpp0266-independent-file";';
  const privateLocalPostTitle = 'local-private-rpp0266-independent-post-title';
  const privateRemoteMetadata = {
    version: 'remote-private-rpp0266-version-focused',
    active: false,
    updateChannel: 'remote-private-rpp0266-channel-focused',
    release: {
      note: 'remote-private-rpp0266-release-note-focused',
      integrity: 'remote-private-rpp0266-release-integrity-focused',
    },
    rollout: {
      ring: 'remote-private-rpp0266-rollout-ring-focused',
      cohort: 'remote-private-rpp0266-rollout-cohort-focused',
    },
    capabilities: [
      'remote-private-rpp0266-capability-import-focused',
      'remote-private-rpp0266-capability-export-focused',
    ],
  };
  const rawValues = [
    privateLocalFile,
    privateLocalPostTitle,
    ...stringLeaves(privateRemoteMetadata),
  ];

  local.files['index.php'] = privateLocalFile;
  local.db.wp_posts['ID:1'].post_title = privateLocalPostTitle;
  remote.plugins.forms = privateRemoteMetadata;

  const firstPlan = createPushPlan({ base, local, remote, now: fixedFocusedNow });
  const secondPlan = createPushPlan({
    base: cloneJson(base),
    local: cloneJson(local),
    remote: cloneJson(remote),
    now: fixedFocusedNow,
  });
  const durableJournal = capturingDurableJournal();
  const result = applyPlan(cloneJson(remote), firstPlan, { durableJournal });
  const planEvidence = hashOnlyPlanEvidence(firstPlan);
  const pluginDecision = assertRemoteOnlyPluginMetadataDecision({
    plan: firstPlan,
    base,
    local,
    remote,
    pluginName: 'forms',
    label: 'RPP-0266 focused fixture',
  });
  const fileMutation = mutationFor(firstPlan, 'file:index.php');
  const rowMutation = mutationFor(firstPlan, 'row:["wp_posts","ID:1"]');

  assert.equal(firstPlan.status, 'ready');
  assertPlanSummaryMatches(firstPlan, 'RPP-0266 focused fixture');
  assert.deepEqual(firstPlan.summary, {
    mutations: 2,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(planEvidence, hashOnlyPlanEvidence(secondPlan), 'focused hash-only evidence should be stable');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, 'RPP-0266 focused fixture');
  assert.equal(fileMutation?.action, 'put', 'focused local file mutation action');
  assert.equal(rowMutation?.action, 'put', 'focused local row mutation action');
  assert.equal(result.appliedMutations, 2);
  assert.equal(result.site.files['index.php'], privateLocalFile);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, privateLocalPostTitle);
  assert.deepEqual(result.site.plugins.forms, privateRemoteMetadata);
  assert.equal(
    resourceHash(result.site, pluginResource('forms')),
    resourceHash(remote, pluginResource('forms')),
    'focused applied metadata hash should match live remote metadata',
  );
  assertNoPluginJournalEvents(durableJournal, 'plugin:forms', 'RPP-0266 focused fixture');
  assertNoRawValues(planEvidence, rawValues, 'focused hash-only plan evidence');
  assertNoRawValues(pluginDecision, rawValues, 'focused plugin decision evidence');
  assertNoRawValues(durableJournal.events, rawValues, 'focused durable journal evidence');
  assert.match(
    `sha256:${digest({ planEvidence, pluginDecision: hashOnlyDecisionEvidence(pluginDecision) })}`,
    sha256UriPattern,
  );
});

test('RPP-0266 generated remote-only plugin metadata fixtures preserve the live remote object', () => {
  const firstEvidence = generatedRemoteOnlyPluginMetadataVariant4Evidence();
  const replayEvidence = generatedRemoteOnlyPluginMetadataVariant4Evidence();
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0266-remote-only-plugin-metadata-preservation-v4.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 generated evidence changed between runs');
  assert.equal(firstEvidence.target, 'remoteOnlyPluginMetadataPreservationVariant4');
  assert.equal(firstEvidence.family, 'remote-only-plugin-metadata');
  assert.equal(firstEvidence.totalCases, 10);
  assert.deepEqual(firstEvidence.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.deepEqual(firstEvidence.statuses, { ready: 10 });
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} status`);
    assert.equal(entry.tags.includes('remote-preserve'), true, `${entry.id} remote-preserve tag`);
    assert.equal(entry.tags.includes('plugin-metadata-preserve'), true, `${entry.id} plugin metadata tag`);
    assert.ok(entry.mutationCount > 0, `${entry.id} should include independent local mutations`);
    assert.equal(entry.preconditionCount, entry.mutationCount, `${entry.id} precondition count`);
    assert.equal(entry.appliedMutations, entry.mutationCount, `${entry.id} applied mutations`);
    assert.equal(entry.validation.applied, true, `${entry.id} validation applied`);
    assert.equal(entry.validation.unplannedRemotePreserved, true, `${entry.id} unplanned remote preserved`);
    assert.equal(entry.validation.staleReplayRejected, true, `${entry.id} stale replay rejected`);
    assert.equal(entry.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${entry.id} stale code`);
    assert.equal(entry.validation.staleReplayRemoteUnchanged, true, `${entry.id} stale remote unchanged`);
    assert.equal(entry.metadata.resourceKey, `plugin:${generatedPluginName}`, `${entry.id} metadata resource key`);
    assert.equal(entry.metadata.baseHash, entry.metadata.localHash, `${entry.id} local metadata hash`);
    assert.notEqual(entry.metadata.remoteHash, entry.metadata.baseHash, `${entry.id} remote metadata drift`);
    assert.equal(entry.metadata.appliedHash, entry.metadata.remoteHash, `${entry.id} applied metadata hash`);
    assert.equal(entry.metadata.plannedMutation, false, `${entry.id} metadata mutation flag`);
    assert.equal(entry.metadata.plannedPrecondition, false, `${entry.id} metadata precondition flag`);
    assert.match(entry.metadata.decisionHash, sha256UriPattern, `${entry.id} decision hash`);
    assert.match(entry.planEvidenceHash, sha256UriPattern, `${entry.id} plan evidence hash`);
    assert.match(entry.modelProofHash, sha256UriPattern, `${entry.id} model proof hash`);
  }

  assert.match(evidenceEnvelope.evidenceHash, sha256UriPattern);
  assert.equal(evidenceText.includes('remote-metadata-'), false, 'variant 4 evidence leaked metadata channel');
});
