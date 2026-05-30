import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256Hex = /^[a-f0-9]{64}$/;
const sha256Evidence = /^sha256:[a-f0-9]{64}$/;
const expectedGeneratedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function focusedBaseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0256-base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'RPP 0256 Base' },
        'option_name:active_plugins': {
          option_name: 'active_plugins',
          option_value: ['forms/forms.php'],
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'RPP 0256 base post', post_status: 'publish' },
      },
    },
  };
}

function planFor(base, local, remote, now = fixedNow) {
  return createPushPlan({ base, local, remote, now });
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
    claimHash: '8'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function sortedObject(object, compare = ([left], [right]) => left.localeCompare(right)) {
  return Object.fromEntries(Object.entries(object).sort(compare));
}

function sortedNumericObject(object) {
  return sortedObject(object, ([left], [right]) => Number(left) - Number(right));
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertPlanSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary does not match emitted evidence`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resourceKey mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope changed`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      mutation.remoteBeforeHash,
      resourceHash(remote, mutation.resource),
      `${label} mutation remoteBeforeHash must bind to the dry-run remote`,
    );
    assert.match(mutation.baseHash, sha256Hex, `${label} mutation ${mutation.resourceKey} baseHash`);
    assert.match(mutation.localHash, sha256Hex, `${label} mutation ${mutation.resourceKey} localHash`);
    assert.match(mutation.remoteBeforeHash, sha256Hex, `${label} mutation ${mutation.resourceKey} remoteBeforeHash`);
  }
}

function assertBlockedPlanRefusesBeforeMutation({ plan, remote, label }) {
  const applyRemote = cloneJson(remote);
  const remoteBeforeHash = digest(applyRemote);
  const journalEvents = [];
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(applyRemote, plan, {
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
  assert.equal(digest(applyRemote), remoteBeforeHash, `${label} mutated remote snapshot`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal evidence before refusal`);

  return {
    code: error.code,
    message: error.message,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash: `sha256:${remoteBeforeHash}`,
    remoteAfterHash: `sha256:${digest(applyRemote)}`,
    appliedMutationCount,
    durableJournalEventCount: journalEvents.length,
  };
}

function changeHashOnly(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: { state: change.base.state, hash: change.base.hash },
    local: { state: change.local.state, hash: change.local.hash },
    remote: { state: change.remote.state, hash: change.remote.hash },
  };
}

function blockerHashEvidence(blocker) {
  return {
    id: blocker.id,
    resourceKey: blocker.resourceKey || null,
    class: blocker.class,
    reasonCode: blocker.reasonCode || null,
    pluginOwner: blocker.pluginOwner || null,
    driver: blocker.driver || null,
    requiredDriver: blocker.requiredDriver || null,
    blockerHash: `sha256:${digest(blocker)}`,
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
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      change: changeHashOnly(mutation.change),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    blockers: plan.blockers.map(blockerHashEvidence),
  };
}

function generatedBlockedPlanEvidence() {
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

      const validation = validateGeneratedCase(testCase);
      const refusal = assertBlockedPlanRefusesBeforeMutation({
        plan,
        remote: testCase.remote,
        label: testCase.id,
      });
      const variant3Tags = [...testCase.tags].filter((tag) => tag.includes('-v3')).sort();

      assert.equal(validation.status, 'blocked', `${testCase.id} generated validation status`);
      assert.equal(validation.applied, false, `${testCase.id} generated validation applied`);
      assert.equal(validation.nonReadyRemoteUnchanged, true, `${testCase.id} generated validation mutated remote`);
      assertPlanSummaryMatchesEvidence(plan, testCase.id);
      assert.equal(plan.conflicts.length, 0, `${testCase.id} blocked plan must not carry conflicts`);
      assert.ok(plan.blockers.length > 0, `${testCase.id} blocked plan must carry blocker evidence`);
      assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

      return {
        id: testCase.id,
        family: testCase.family,
        tier: testCase.tier,
        variant3Tags,
        status: plan.status,
        summary: plan.summary,
        validation: {
          status: validation.status,
          applied: validation.applied,
          nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged,
        },
        plannedMutationCount: plan.mutations.length,
        plannedPreconditionCount: plan.preconditions.length,
        blockerClasses: plan.blockers.map((blocker) => blocker.class).sort(),
        blockerEvidenceHashes: plan.blockers.map((blocker) => `sha256:${digest(blocker)}`).sort(),
        mutationResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
        refusal,
      };
    })
    .filter(Boolean);
}

function aggregateGeneratedEvidence(evidence) {
  const aggregate = {
    totalBlockedCases: evidence.length,
    blockedCasesWithMutations: 0,
    totalPlannedMutations: 0,
    totalPlannedPreconditions: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    variant3BlockedCases: 0,
    variant3BlockedCasesWithMutations: 0,
    perTier: {},
    variant3PerTier: {},
    families: {},
    blockerClasses: {},
    refusalCodes: {},
  };

  for (const entry of evidence) {
    const isVariant3 = entry.variant3Tags.length > 0;
    increment(aggregate.perTier, entry.tier);
    increment(aggregate.families, entry.family);
    increment(aggregate.refusalCodes, entry.refusal.code);
    aggregate.totalPlannedMutations += entry.plannedMutationCount;
    aggregate.totalPlannedPreconditions += entry.plannedPreconditionCount;
    aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;

    if (entry.plannedMutationCount > 0) {
      aggregate.blockedCasesWithMutations += 1;
    }
    if (isVariant3) {
      aggregate.variant3BlockedCases += 1;
      increment(aggregate.variant3PerTier, entry.tier);
      if (entry.plannedMutationCount > 0) {
        aggregate.variant3BlockedCasesWithMutations += 1;
      }
    }
    for (const blockerClass of entry.blockerClasses) {
      increment(aggregate.blockerClasses, blockerClass);
    }
  }

  return {
    ...aggregate,
    perTier: sortedNumericObject(aggregate.perTier),
    variant3PerTier: sortedNumericObject(aggregate.variant3PerTier),
    families: sortedObject(aggregate.families),
    blockerClasses: sortedObject(aggregate.blockerClasses),
    refusalCodes: sortedObject(aggregate.refusalCodes),
  };
}

function assertNoRawValues(serializedEvidence, rawValues, label) {
  for (const rawValue of new Set(rawValues)) {
    assert.equal(serializedEvidence.includes(rawValue), false, `${label} leaked raw value ${rawValue}`);
  }
}

test('RPP-0256 focused blocked active_plugins plan refuses apply before independent mutation', () => {
  const base = focusedBaseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const independentFileKey = 'file:index.php';
  const activePluginsKey = 'row:["wp_options","option_name:active_plugins"]';
  const rawFocusedValues = [
    '<?php echo "rpp-0256-local-private-file";',
    'analytics/analytics.php',
  ];

  local.files['index.php'] = rawFocusedValues[0];
  local.db.wp_options['option_name:active_plugins'].option_value = ['forms/forms.php', rawFocusedValues[1]];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const refusal = assertBlockedPlanRefusesBeforeMutation({
    plan: firstPlan,
    remote,
    label: 'RPP-0256 focused active_plugins fixture',
  });
  const focusedEvidence = {
    checklistItem: 'RPP-0256',
    fixture: 'focused-active-plugins-plus-independent-file',
    plan: hashOnlyPlanEvidence(firstPlan),
    refusal,
  };
  const focusedEvidenceText = JSON.stringify({
    ...focusedEvidence,
    evidenceHash: `sha256:${digest(focusedEvidence)}`,
  });

  assert.equal(firstPlan.status, 'blocked');
  assertPlanSummaryMatchesEvidence(firstPlan, 'RPP-0256 focused fixture');
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
    'RPP-0256 focused evidence must be deterministic across replayed planning inputs',
  );
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, remote, 'RPP-0256 focused fixture');

  const fileMutation = mutationFor(firstPlan, independentFileKey);
  const activePluginsPrecondition = preconditionFor(firstPlan, activePluginsKey);
  assert.ok(fileMutation, 'focused fixture should retain the independent file mutation');
  assert.equal(fileMutation.action, 'put');
  assert.equal(preconditionFor(firstPlan, independentFileKey)?.expectedHash, fileMutation.remoteBeforeHash);
  assert.equal(mutationFor(firstPlan, activePluginsKey), undefined, 'blocked active_plugins row emitted a mutation');
  assert.equal(activePluginsPrecondition, undefined, 'blocked active_plugins row emitted a precondition');
  assert.equal(firstPlan.blockers[0].class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(firstPlan.blockers[0].reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(firstPlan.blockers[0].resourceKey, activePluginsKey);
  assert.equal(firstPlan.blockers[0].requiredDriver, 'plugin-activation-driver');

  assert.equal(refusal.remoteAfterHash, refusal.remoteBeforeHash);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.deepEqual(
    remote.db.wp_options['option_name:active_plugins'].option_value,
    base.db.wp_options['option_name:active_plugins'].option_value,
  );
  assert.match(refusal.detailsHash, sha256Evidence);
  assert.deepEqual(findEvidenceRedactionIssues(focusedEvidence), []);
  assertNoRawValues(focusedEvidenceText, rawFocusedValues, 'RPP-0256 focused hash-only evidence');
});

test('RPP-0256 generated blocked plans refuse apply before mutation with variant 3 coverage', () => {
  const firstEvidence = generatedBlockedPlanEvidence();
  const replayEvidence = generatedBlockedPlanEvidence();
  const aggregate = aggregateGeneratedEvidence(firstEvidence);
  const proof = {
    checklistItem: 'RPP-0256',
    evidenceScope: 'local-generated-model',
    invariant: 'blocked generated plans refuse apply before durable journal events or remote mutation',
    aggregate,
    selectedVariant3Cases: firstEvidence
      .filter((entry) => entry.variant3Tags.length > 0)
      .slice(0, 5)
      .map((entry) => ({
        id: entry.id,
        tier: entry.tier,
        family: entry.family,
        variant3Tags: entry.variant3Tags,
        blockerClasses: entry.blockerClasses,
        plannedMutationCount: entry.plannedMutationCount,
        refusalCode: entry.refusal.code,
        refusalDetailsHash: entry.refusal.detailsHash,
        remotePreserved: entry.refusal.remoteAfterHash === entry.refusal.remoteBeforeHash,
      })),
  };
  const proofEnvelope = {
    command: 'node --test test/rpp-0256-blocked-plan-apply-refusal-v3.test.js',
    proof,
    evidenceHash: `sha256:${digest(proof)}`,
  };
  const proofText = JSON.stringify(proofEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated blocked refusal evidence changed between runs');
  assert.ok(aggregate.totalBlockedCases > 0, 'generated harness must include blocked cases');
  assert.ok(aggregate.blockedCasesWithMutations > 0, 'blocked generated proof must include planned mutations');
  assert.equal(aggregate.totalPlannedMutations, aggregate.totalPlannedPreconditions);
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.deepEqual(Object.keys(aggregate.perTier).map(Number), expectedGeneratedTiers);
  assert.deepEqual(Object.keys(aggregate.variant3PerTier).map(Number), expectedGeneratedTiers);
  assert.ok(aggregate.variant3BlockedCases > 0, 'variant 3 generated blocked coverage is missing');
  assert.ok(
    aggregate.variant3BlockedCasesWithMutations > 0,
    'variant 3 generated blocked proof must include planned mutations',
  );
  assert.equal(aggregate.refusalCodes.PLAN_NOT_READY, aggregate.totalBlockedCases);
  assert.ok(aggregate.blockerClasses['unsupported-plugin-owned-resource'] > 0);
  assert.ok(aggregate.blockerClasses['stale-wordpress-graph-identity'] > 0);
  assert.ok(aggregate.blockerClasses['atomic-group-blocker-propagation'] > 0);
  assert.ok(proof.selectedVariant3Cases.length > 0);
  assert.equal(
    proof.selectedVariant3Cases.every((entry) => entry.remotePreserved && entry.refusalCode === 'PLAN_NOT_READY'),
    true,
  );
  assert.match(proofEnvelope.evidenceHash, sha256Evidence);
  assert.deepEqual(findEvidenceRedactionIssues(proofEnvelope), []);
  assert.equal(proofText.includes('local-private'), false);
  assert.equal(proofText.includes('remote-private'), false);
  assert.equal(proofText.includes('<?php'), false);
  assert.equal(proofText.includes('payload'), false);
});
