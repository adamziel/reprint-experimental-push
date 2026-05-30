import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');

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
    claimHash: '6'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function assertSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, label);
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
    `${label} must emit exactly one precondition per planned mutation`,
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
    assertSha256(mutation.baseHash, `${label} mutation ${mutation.resourceKey} baseHash`);
    assertSha256(mutation.localHash, `${label} mutation ${mutation.resourceKey} localHash`);
    assertSha256(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remoteBeforeHash`);
  }
}

function assertNoMutationOrPrecondition(plan, resourceKey) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
    false,
    `${resourceKey} emitted a precondition`,
  );
}

function assertBlockedApplyRefusesBeforeMutation({ plan, remote, label }) {
  const applyRemote = cloneJson(remote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(applyRemote, plan, {
      mutateRemote: true,
      durableJournal: durableJournal(journalEvents),
    });
    appliedMutationCount = result.appliedMutations;
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
  assert.equal(appliedMutationCount, 0, `${label} reported applied mutations`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${label} mutated the remote snapshot`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal evidence before refusal`);

  return {
    error,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEvents,
    appliedMutationCount,
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
      baseHash: blocker.baseHash || blocker.change?.base?.hash || null,
      localHash: blocker.localHash || blocker.change?.local?.hash || null,
      remoteHash: blocker.remoteHash || blocker.change?.remote?.hash || null,
      blockerHash: digest(blocker),
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
        mutationJournalEventCount: refusal.journalEvents
          .filter((event) => event.type.includes('mutation')).length,
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
    totalMutationJournalEvents: 0,
    families: {},
    blockerClasses: {},
    refusalCodes: {},
  };

  for (const entry of evidence) {
    if (entry.plannedMutations > 0) {
      aggregate.blockedCasesWithMutations++;
    }
    aggregate.totalPlannedMutations += entry.plannedMutations;
    aggregate.totalAppliedMutations += entry.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.durableJournalEventCount;
    aggregate.totalMutationJournalEvents += entry.mutationJournalEventCount;
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

test('RPP-0236 focused blocked plan refuses apply before mutation with hash-only evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const blockedResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const independentResourceKey = 'file:index.php';
  const privateValues = [
    '<?php echo "local-private-rpp0236-v2-file";',
    'local-private-rpp0236-v2-option-mode',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[1];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const focusedRefusal = assertBlockedApplyRefusesBeforeMutation({
    plan: firstPlan,
    remote,
    label: 'RPP-0236 focused fixture',
  });
  const evidence = {
    command: 'node --test --test-name-pattern=RPP-0236 test/rpp-0236-blocked-plan-apply-refusal-v2.test.js',
    behavior: 'blocked plans are refused before durable journal events or remote mutation',
    focused: hashOnlyPlanEvidence(firstPlan),
    refusal: {
      code: focusedRefusal.error.code,
      detailsHash: `sha256:${digest(focusedRefusal.error.details)}`,
      beforeRemoteHash: `sha256:${focusedRefusal.beforeRemoteHash}`,
      afterRemoteHash: `sha256:${focusedRefusal.afterRemoteHash}`,
      appliedMutationCount: focusedRefusal.appliedMutationCount,
      durableJournalEventCount: focusedRefusal.journalEvents.length,
    },
  };
  const evidenceText = JSON.stringify({
    ...evidence,
    evidenceHash: `sha256:${digest(evidence)}`,
  });

  assert.equal(firstPlan.status, 'blocked');
  assertSummaryMatchesPlan(firstPlan, 'RPP-0236 focused fixture');
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
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, remote, 'RPP-0236 focused fixture');
  assert.equal(mutationFor(firstPlan, independentResourceKey).action, 'put');
  assertNoMutationOrPrecondition(firstPlan, blockedResourceKey);
  assert.equal(firstPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(firstPlan.blockers[0].reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(firstPlan.blockers[0].resourceKey, blockedResourceKey);
  assert.equal(firstPlan.blockers[0].unknownPluginOwnedResourceRefusalEvidence.format, 'hash-only');
  assert.equal(firstPlan.blockers[0].unknownPluginOwnedResourceRefusalEvidence.rawValuesIncluded, false);
  assert.equal(focusedRefusal.beforeRemoteHash, focusedRefusal.afterRemoteHash);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(
    remote.db.wp_options['option_name:forms_settings'].option_value.mode,
    base.db.wp_options['option_name:forms_settings'].option_value.mode,
  );

  for (const privateValue of privateValues) {
    assert.equal(evidenceText.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
    assert.equal(JSON.stringify(focusedRefusal.error.details).includes(privateValue), false);
  }
});

test('RPP-0236 generated blocked plans all refuse apply before mutation', () => {
  const firstEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const replayEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const aggregate = aggregateGeneratedBlockedPlanApplyRefusalEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0236 test/rpp-0236-blocked-plan-apply-refusal-v2.test.js',
    behavior: 'generated blocked plans refuse apply before durable journal events or remote mutation',
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
  assert.equal(aggregate.totalMutationJournalEvents, 0);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('local-private'), false);
  assert.equal(evidenceText.includes('remote-private'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('secret-'), false);
  assert.equal(evidenceText.includes('payload'), false);
});
