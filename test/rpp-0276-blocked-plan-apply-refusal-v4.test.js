import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';

const fixedFocusedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0276 base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:active_plugins': {
          option_name: 'active_plugins',
          option_value: ['forms/forms.php'],
        },
        'option_name:blogname': {
          option_name: 'blogname',
          option_value: 'RPP 0276 Base',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'RPP 0276 base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '7'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedFocusedNow });
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function activePluginsResource() {
  return { type: 'row', table: 'wp_options', id: 'option_name:active_plugins' };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertSha256Hex(value, label) {
  assert.match(value, sha256HexPattern, label);
}

function assertSummaryMatchesPlan(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary must match emitted evidence`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
  }

  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} must emit exactly one live-remote precondition per planned mutation`,
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resourceKey mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition was not live remote`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      mutation.remoteBeforeHash,
      resourceHash(remote, mutation.resource),
      `${label} remoteBeforeHash must bind to the dry-run remote`,
    );
    assertSha256Hex(mutation.baseHash, `${label} mutation ${mutation.resourceKey} baseHash`);
    assertSha256Hex(mutation.localHash, `${label} mutation ${mutation.resourceKey} localHash`);
    assertSha256Hex(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remoteBeforeHash`);
  }
}

function assertNoMutationOrPrecondition(plan, resourceKey, label) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${label} emitted a mutation`);
  assert.equal(preconditionFor(plan, resourceKey), undefined, `${label} emitted a precondition`);
}

function assertBlockedApplyRefusesBeforeMutation({ plan, remote, label }) {
  const applyRemote = cloneJson(remote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  let returnedResult = null;
  const error = captureError(() => {
    returnedResult = applyPlan(applyRemote, plan, {
      durableJournal: durableJournal(journalEvents),
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  });

  assert.ok(error instanceof PushPlanError, `${label} should throw PushPlanError`);
  assert.deepEqual(
    {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    {
      code: 'PLAN_NOT_READY',
      message: 'Refusing to apply a blocked plan.',
      details: { status: 'blocked' },
    },
    `${label} refusal envelope changed`,
  );
  assert.equal(returnedResult, null, `${label} returned an apply result`);
  assert.equal(beforeMutationCalls, 0, `${label} reached the mutation callback`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${label} mutated the remote snapshot`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal evidence before refusal`);

  return {
    error,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEvents,
    beforeMutationCalls,
    appliedMutationCount: 0,
  };
}

function hashOnlyPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey,
      class: blocker.class,
      reasonCode: blocker.reasonCode || null,
      pluginOwner: blocker.pluginOwner || null,
      driver: blocker.driver || null,
      requiredDriver: blocker.requiredDriver || null,
      baseHash: blocker.baseHash || blocker.change?.base?.hash || null,
      localHash: blocker.localHash || blocker.change?.local?.hash || null,
      remoteHash: blocker.remoteHash || blocker.change?.remote?.hash || null,
      blockerHash: `sha256:${digest(blocker)}`,
    })),
  };
}

function generatedBlockedPlanApplyRefusalEvidence() {
  return generatePushHarnessCases()
    .map((testCase) => {
      const plan = createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedGeneratedHarnessNow,
      });

      if (plan.status !== 'blocked') {
        return null;
      }

      assertSummaryMatchesPlan(plan, testCase.id);
      assert.equal(plan.conflicts.length, 0, `${testCase.id} blocked plan must not carry conflicts`);
      assert.ok(plan.blockers.length > 0, `${testCase.id} blocked plan must carry blocker evidence`);
      assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

      const refusal = assertBlockedApplyRefusesBeforeMutation({
        plan,
        remote: testCase.remote,
        label: testCase.id,
      });

      return {
        id: testCase.id,
        family: testCase.family,
        tier: testCase.tier,
        tags: [...testCase.tags].sort(),
        status: plan.status,
        summary: plan.summary,
        plannedMutations: plan.mutations.length,
        plannedPreconditions: plan.preconditions.length,
        blockerClasses: plan.blockers.map((blocker) => blocker.class).sort(),
        mutationResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
        blockerEvidenceHashes: plan.blockers.map((blocker) => `sha256:${digest(blocker)}`).sort(),
        refusal: {
          code: refusal.error.code,
          detailsHash: `sha256:${digest(refusal.error.details)}`,
          beforeRemoteHash: `sha256:${refusal.beforeRemoteHash}`,
          afterRemoteHash: `sha256:${refusal.afterRemoteHash}`,
        },
        appliedMutationCount: refusal.appliedMutationCount,
        durableJournalEventCount: refusal.journalEvents.length,
        beforeMutationCalls: refusal.beforeMutationCalls,
      };
    })
    .filter(Boolean);
}

function aggregateGeneratedBlockedPlanApplyRefusalEvidence(evidence) {
  const aggregate = {
    totalBlockedCases: evidence.length,
    blockedCasesWithMutations: 0,
    totalPlannedMutations: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    families: {},
    blockerClasses: {},
    refusalCodes: {},
  };

  for (const entry of evidence) {
    if (entry.plannedMutations > 0) {
      aggregate.blockedCasesWithMutations += 1;
    }
    aggregate.totalPlannedMutations += entry.plannedMutations;
    aggregate.totalAppliedMutations += entry.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.durableJournalEventCount;
    aggregate.totalBeforeMutationCalls += entry.beforeMutationCalls;
    increment(aggregate.families, entry.family);
    increment(aggregate.refusalCodes, entry.refusal.code);
    for (const blockerClass of entry.blockerClasses) {
      increment(aggregate.blockerClasses, blockerClass);
    }
  }

  aggregate.families = sortedCounts(aggregate.families);
  aggregate.blockerClasses = sortedCounts(aggregate.blockerClasses);
  aggregate.refusalCodes = sortedCounts(aggregate.refusalCodes);
  return aggregate;
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

test('RPP-0276 focused blocked plan refuses before independent mutation and journal writes', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const activePluginsKey = rowKey('wp_options', 'option_name:active_plugins');
  const independentFileKey = 'file:index.php';
  const privateValues = [
    '<?php echo "rpp0276-local-private-file";',
    'rpp0276-local-private-plugin/rpp0276-local-private-plugin.php',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_options['option_name:active_plugins'].option_value = [
    'forms/forms.php',
    privateValues[1],
  ];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const activePluginsBlocker = firstPlan.blockers.find((blocker) => blocker.resourceKey === activePluginsKey);
  const focusedRefusal = assertBlockedApplyRefusesBeforeMutation({
    plan: firstPlan,
    remote,
    label: 'RPP-0276 focused fixture',
  });
  const activeResource = activePluginsResource();
  const evidence = {
    command: 'node --test test/rpp-0276-blocked-plan-apply-refusal-v4.test.js',
    behavior: 'blocked active_plugins plans are refused before independent mutations and durable journal writes',
    focused: hashOnlyPlanEvidence(firstPlan),
    activePluginsHashes: {
      baseHash: `sha256:${resourceHash(base, activeResource)}`,
      localHash: `sha256:${resourceHash(local, activeResource)}`,
      remoteHash: `sha256:${resourceHash(remote, activeResource)}`,
    },
    refusal: {
      code: focusedRefusal.error.code,
      detailsHash: `sha256:${digest(focusedRefusal.error.details)}`,
      beforeRemoteHash: `sha256:${focusedRefusal.beforeRemoteHash}`,
      afterRemoteHash: `sha256:${focusedRefusal.afterRemoteHash}`,
      beforeMutationCalls: focusedRefusal.beforeMutationCalls,
      appliedMutationCount: focusedRefusal.appliedMutationCount,
      durableJournalEventCount: focusedRefusal.journalEvents.length,
    },
  };
  const evidenceText = JSON.stringify({
    ...evidence,
    evidenceHash: `sha256:${digest(evidence)}`,
  });

  assert.equal(firstPlan.status, 'blocked');
  assertSummaryMatchesPlan(firstPlan, 'RPP-0276 focused fixture');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(
    hashOnlyPlanEvidence(firstPlan),
    hashOnlyPlanEvidence(replayPlan),
    'focused blocked refusal evidence should be deterministic across replayed planning inputs',
  );
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, remote, 'RPP-0276 focused fixture');
  assert.equal(mutationFor(firstPlan, independentFileKey).action, 'put');
  assertNoMutationOrPrecondition(firstPlan, activePluginsKey, 'active_plugins direct mutation');
  assert.ok(activePluginsBlocker, 'focused fixture should carry active_plugins blocker evidence');
  assert.equal(activePluginsBlocker.class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(activePluginsBlocker.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(activePluginsBlocker.requiredDriver, 'plugin-activation-driver');
  assert.equal(activePluginsBlocker.change.localChange, 'update');
  assert.equal(activePluginsBlocker.change.remoteChange, 'unchanged');
  assert.deepEqual(
    {
      baseHash: activePluginsBlocker.baseHash,
      localHash: activePluginsBlocker.localHash,
      remoteHash: activePluginsBlocker.remoteHash,
    },
    {
      baseHash: resourceHash(base, activeResource),
      localHash: resourceHash(local, activeResource),
      remoteHash: resourceHash(remote, activeResource),
    },
  );
  assert.equal(focusedRefusal.beforeRemoteHash, focusedRefusal.afterRemoteHash);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(resourceHash(remote, activeResource), resourceHash(base, activeResource));
  assert.match(`sha256:${digest(evidence)}`, sha256EvidencePattern);

  for (const privateValue of privateValues) {
    assert.equal(evidenceText.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
    assert.equal(JSON.stringify(focusedRefusal.error.details).includes(privateValue), false);
  }
});

test('RPP-0276 generated blocked fixtures all refuse before mutation and journal writes', () => {
  const firstEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const replayEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const aggregate = aggregateGeneratedBlockedPlanApplyRefusalEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0276-blocked-plan-apply-refusal-v4.test.js',
    behavior: 'generated blocked plans refuse before mutation callbacks, durable journal writes, or remote changes',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated blocked refusal evidence changed between runs');
  assert.ok(aggregate.totalBlockedCases > 0, 'generated harness must include blocked cases');
  assert.ok(aggregate.blockedCasesWithMutations > 0, 'generated blocked proof must include independent mutations');
  assert.ok(
    Object.keys(aggregate.families).length > 1,
    'generated blocked proof should cover multiple fixture families',
  );
  assert.equal(aggregate.refusalCodes.PLAN_NOT_READY, aggregate.totalBlockedCases);
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalBeforeMutationCalls, 0);
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('local-private'), false);
  assert.equal(evidenceText.includes('remote-private'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('secret-'), false);
  assert.equal(evidenceText.includes('private-token'), false);
  assert.equal(evidenceText.includes('payload'), false);
});
