import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDocPath = path.join(
  repoRoot,
  'docs/evidence/rpp-0295-keep-remote-decision-release-verifier-v5.md',
);
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const themeStylePath = 'wp-content/themes/reprint/style.css';
const localMutationResourceKey = `file:${themeStylePath}`;
const createdFilePath = 'wp-content/uploads/rpp-0295-remote-created.txt';
const optionRowId = 'option_name:rpp0295_legacy_flag';
const optionResourceKey = 'row:["wp_options","option_name:rpp0295_legacy_flag"]';
const postResourceKey = 'row:["wp_posts","ID:1"]';

const keepRemoteCases = Object.freeze([
  { resourceKey: 'file:index.php', resourceType: 'file', remoteChange: 'update' },
  { resourceKey: `file:${createdFilePath}`, resourceType: 'file', remoteChange: 'create' },
  { resourceKey: 'plugin:forms', resourceType: 'plugin', remoteChange: 'delete' },
  { resourceKey: optionResourceKey, resourceType: 'row', remoteChange: 'delete' },
  { resourceKey: postResourceKey, resourceType: 'row', remoteChange: 'update' },
]);

const privateFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0295-index";',
  '/* base-private-rpp0295-theme */',
  'local-private-rpp0295-theme-edit',
  'remote-private-rpp0295-index-update',
  'remote-private-rpp0295-created-file',
  'Remote private RPP-0295 post update',
  'post-plan-rpp0295-index-drift',
  'post-plan-rpp0295-created-file-drift',
  '9.9.9-rpp0295-plugin-drift',
  'post-plan-rpp0295-option-drift',
  'Post-plan private RPP-0295 post drift',
  'stale-private-rpp0295-theme',
  'stale-private-rpp0295-index-preserved',
  'stale-private-rpp0295-created-file-preserved',
  '8.8.8-rpp0295-plugin-stale-preserved',
  'stale-private-rpp0295-option-preserved',
  'Stale private RPP-0295 post preserved',
  'forged-private-rpp0295-index-overwrite',
  'forged-private-rpp0295-created-file-overwrite',
  '7.7.7-rpp0295-plugin-forged',
  'forged-private-rpp0295-option-overwrite',
  'Forged private RPP-0295 row overwrite',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base-private-rpp0295-index";',
      [themeStylePath]: '/* base-private-rpp0295-theme */',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0295 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: 'rpp0295_legacy_flag',
          option_value: { mode: 'base-private-rpp0295-option' },
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0295 post',
          post_status: 'publish',
        },
      },
    },
  };
}

function focusedFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files[themeStylePath] = 'local-private-rpp0295-theme-edit';
  remote.files['index.php'] = 'remote-private-rpp0295-index-update';
  remote.files[createdFilePath] = 'remote-private-rpp0295-created-file';
  delete remote.plugins.forms;
  delete remote.db.wp_options[optionRowId];
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0295 post update';

  return { base, local, remote };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function incrementCount(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '5'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
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

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
    conflicts: 0,
    blockers: 0,
    atomicGroups: copy.atomicGroups.length,
  };
  return copy;
}

function assertHashOnlyEvidence(value, label) {
  assert.deepEqual(findEvidenceRedactionIssues(value), [], `${label} should be hash-only evidence`);
  const serialized = JSON.stringify(value);

  for (const fixtureValue of privateFixtureValues) {
    assert.equal(serialized.includes(fixtureValue), false, `${label} leaked ${fixtureValue}`);
  }
  for (const rawFieldName of ['option_value', 'post_title']) {
    assert.equal(serialized.includes(rawFieldName), false, `${label} leaked raw field ${rawFieldName}`);
  }
}

function assertDecisionOnly(plan, resourceKey, label) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${label} emitted mutation`);
  assert.equal(preconditionFor(plan, resourceKey), undefined, `${label} emitted live-remote precondition`);
}

function assertKeepRemoteDecision({ fixture, plan, resourceKey, remoteChange }) {
  const decision = decisionFor(plan, resourceKey);
  assert.ok(decision, `missing keep-remote decision for ${resourceKey}`);
  assert.equal(decision.resource?.key, resourceKey, `${resourceKey} resource key`);
  assert.equal(decision.decision, 'keep-remote', `${resourceKey} decision`);
  assert.equal(decision.change.localChange, 'unchanged', `${resourceKey} local change`);
  assert.equal(decision.change.remoteChange, remoteChange, `${resourceKey} remote change`);
  assert.match(decision.baseHash, sha256HexPattern, `${resourceKey} base hash`);
  assert.match(decision.remoteHash, sha256HexPattern, `${resourceKey} remote hash`);
  assert.equal(decision.change.base.hash, decision.baseHash, `${resourceKey} base change hash`);
  assert.equal(decision.change.local.hash, decision.baseHash, `${resourceKey} local unchanged hash`);
  assert.equal(decision.change.remote.hash, decision.remoteHash, `${resourceKey} remote changed hash`);
  assert.equal(resourceHash(fixture.base, decision.resource), decision.baseHash, `${resourceKey} base resource hash`);
  assert.equal(resourceHash(fixture.local, decision.resource), decision.baseHash, `${resourceKey} local resource hash`);
  assert.equal(resourceHash(fixture.remote, decision.resource), decision.remoteHash, `${resourceKey} remote resource hash`);
  assert.notEqual(decision.remoteHash, decision.baseHash, `${resourceKey} remote hash should differ from base`);
  assertDecisionOnly(plan, resourceKey, resourceKey);
  assertHashOnlyEvidence(decision, `${resourceKey} keep-remote decision`);

  return {
    resourceKey,
    resourceType: decision.resource.type,
    decision: decision.decision,
    localChange: decision.change.localChange,
    remoteChange: decision.change.remoteChange,
    baseState: decision.change.base.state,
    localState: decision.change.local.state,
    remoteState: decision.change.remote.state,
    baseHash: decision.baseHash,
    localHash: decision.change.local.hash,
    remoteHash: decision.remoteHash,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function assertFocusedPlanSurface(fixture, plan) {
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 5,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(plan.summary, emittedPlannerCounts(plan));
  assert.deepEqual(plan.mutations.map((mutation) => mutation.resourceKey), [localMutationResourceKey]);
  assert.deepEqual(plan.preconditions.map((precondition) => precondition.resourceKey), [localMutationResourceKey]);
  assert.deepEqual(
    plan.decisions.map((decision) => decision.resourceKey),
    keepRemoteCases.map((entry) => entry.resourceKey),
  );

  const mutation = mutationFor(plan, localMutationResourceKey);
  const precondition = preconditionFor(plan, localMutationResourceKey);
  assert.ok(mutation, 'missing independent local mutation');
  assert.ok(precondition, 'missing independent local precondition');
  assert.equal(mutation.action, 'put');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(resourceHash(fixture.remote, mutation.resource), mutation.remoteBeforeHash);
  assert.equal(resourceHash(fixture.local, mutation.resource), mutation.localHash);
}

function focusedApplyPreservation(fixture, plan) {
  const applyRemote = cloneJson(fixture.remote);
  const decisionHashesBefore = {};
  const journalEvents = [];

  applyRemote.files['index.php'] = 'post-plan-rpp0295-index-drift';
  applyRemote.files[createdFilePath] = 'post-plan-rpp0295-created-file-drift';
  applyRemote.plugins.forms = { version: '9.9.9-rpp0295-plugin-drift', active: false };
  applyRemote.db.wp_options[optionRowId] = {
    option_name: 'rpp0295_legacy_flag',
    option_value: { mode: 'post-plan-rpp0295-option-drift' },
  };
  applyRemote.db.wp_posts['ID:1'].post_title = 'Post-plan private RPP-0295 post drift';

  for (const { resourceKey } of keepRemoteCases) {
    const decision = decisionFor(plan, resourceKey);
    decisionHashesBefore[resourceKey] = resourceHash(applyRemote, decision.resource);
  }

  const result = applyPlan(applyRemote, plan, {
    mutateRemote: true,
    durableJournal: durableJournal(journalEvents),
  });

  assert.equal(result.appliedMutations, 1);
  assert.equal(resourceHash(applyRemote, mutationFor(plan, localMutationResourceKey).resource), mutationFor(plan, localMutationResourceKey).localHash);
  for (const { resourceKey } of keepRemoteCases) {
    const decision = decisionFor(plan, resourceKey);
    assert.equal(
      resourceHash(applyRemote, decision.resource),
      decisionHashesBefore[resourceKey],
      `${resourceKey} drift should be preserved by release-verifier keep-remote carry-through`,
    );
  }
  assert.deepEqual(
    journalEvents
      .filter((event) => event.type === 'target-planned')
      .map((event) => event.resourceKey),
    [localMutationResourceKey],
  );
  assert.deepEqual(
    journalEvents
      .filter((event) => event.type === 'mutation-observed')
      .map((event) => event.resourceKey),
    [localMutationResourceKey],
  );
  for (const { resourceKey } of keepRemoteCases) {
    assert.equal(
      journalEvents.some((event) => event.resourceKey === resourceKey),
      false,
      `${resourceKey} wrote durable mutation evidence`,
    );
  }

  return {
    appliedMutations: result.appliedMutations,
    finalSiteHash: `sha256:${digest(result.site)}`,
    decisionResourceHashes: Object.entries(decisionHashesBefore)
      .map(([resourceKey, beforeHash]) => ({
        resourceKey,
        beforeHash,
        afterHash: resourceHash(applyRemote, decisionFor(plan, resourceKey).resource),
      }))
      .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    targetPlannedResourceKeys: journalEvents
      .filter((event) => event.type === 'target-planned')
      .map((event) => event.resourceKey),
    mutationObservedResourceKeys: journalEvents
      .filter((event) => event.type === 'mutation-observed')
      .map((event) => event.resourceKey),
    durableJournalEventTypes: journalEvents.map((event) => event.type),
    noDecisionResourceJournalEvents: keepRemoteCases.every(({ resourceKey }) =>
      !journalEvents.some((event) => event.resourceKey === resourceKey)),
  };
}

function staleReplayRefusal(fixture, plan) {
  const staleRemote = cloneJson(fixture.remote);
  const mutation = mutationFor(plan, localMutationResourceKey);
  const journalEvents = [];

  staleRemote.files[themeStylePath] = 'stale-private-rpp0295-theme';
  staleRemote.files['index.php'] = 'stale-private-rpp0295-index-preserved';
  staleRemote.files[createdFilePath] = 'stale-private-rpp0295-created-file-preserved';
  staleRemote.plugins.forms = { version: '8.8.8-rpp0295-plugin-stale-preserved', active: false };
  staleRemote.db.wp_options[optionRowId] = {
    option_name: 'rpp0295_legacy_flag',
    option_value: { mode: 'stale-private-rpp0295-option-preserved' },
  };
  staleRemote.db.wp_posts['ID:1'].post_title = 'Stale private RPP-0295 post preserved';

  const beforeRemoteHash = digest(staleRemote);
  const staleActualHash = resourceHash(staleRemote, mutation.resource);
  assert.notEqual(staleActualHash, mutation.remoteBeforeHash, 'stale fixture must drift the planned mutation');

  const error = captureError(() => applyPlan(staleRemote, plan, {
    mutateRemote: true,
    durableJournal: durableJournal(journalEvents),
  }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, localMutationResourceKey);
  assert.equal(error.details.expectedHash, mutation.remoteBeforeHash);
  assert.equal(error.details.actualHash, staleActualHash);
  assert.equal(digest(staleRemote), beforeRemoteHash, 'stale replay mutated the remote');
  assert.deepEqual(
    journalEvents
      .filter((event) => event.type === 'target-planned' || event.type.includes('mutation'))
      .map((event) => event.type),
    [],
    'stale keep-remote replay wrote target or mutation evidence before refusal',
  );

  return {
    code: error.code,
    resourceKey: error.details.resourceKey,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    beforeRemoteHash,
    afterRemoteHash: digest(staleRemote),
    detailsHash: `sha256:${digest(error.details)}`,
    durableJournalEventTypes: journalEvents.map((event) => event.type),
  };
}

function forgedOverlapRefusals(fixture, plan) {
  const forgedValues = [
    {
      resourceKey: 'file:index.php',
      value: { type: 'file', content: 'forged-private-rpp0295-index-overwrite' },
      localChange: 'update',
    },
    {
      resourceKey: `file:${createdFilePath}`,
      value: { type: 'file', content: 'forged-private-rpp0295-created-file-overwrite' },
      localChange: 'update',
    },
    {
      resourceKey: 'plugin:forms',
      value: { version: '7.7.7-rpp0295-plugin-forged', active: true },
      localChange: 'create',
    },
    {
      resourceKey: optionResourceKey,
      value: {
        option_name: 'rpp0295_legacy_flag',
        option_value: { mode: 'forged-private-rpp0295-option-overwrite' },
      },
      localChange: 'create',
    },
    {
      resourceKey: postResourceKey,
      value: {
        ID: 1,
        post_title: 'Forged private RPP-0295 row overwrite',
        post_status: 'publish',
      },
      localChange: 'update',
    },
  ];

  return forgedValues.map((forgedCase) => {
    const decision = decisionFor(plan, forgedCase.resourceKey);
    const forgedMutation = {
      id: `mutation-rpp-0295-forged-${decision.resource.type}-${forgedCase.localChange}`,
      resource: decision.resource,
      resourceKey: decision.resourceKey,
      action: 'put',
      value: serializeResourceValue(forgedCase.value),
      baseHash: decision.baseHash,
      localHash: digest(forgedCase.value),
      remoteBeforeHash: decision.remoteHash,
      changeKind: forgedCase.localChange,
      change: {
        localChange: forgedCase.localChange,
        remoteChange: 'unchanged',
      },
    };
    const forgedPlan = tamperReadyPlan(plan, (copy) => {
      copy.mutations.push(forgedMutation);
      copy.preconditions.push({
        mutationId: forgedMutation.id,
        resource: decision.resource,
        resourceKey: decision.resourceKey,
        expectedHash: forgedMutation.remoteBeforeHash,
        checkedAgainst: 'live-remote',
      });
    });
    const forgedRemote = cloneJson(fixture.remote);
    const beforeRemoteHash = digest(forgedRemote);
    const journalEvents = [];
    const error = captureError(() => applyPlan(forgedRemote, forgedPlan, {
      mutateRemote: true,
      durableJournal: durableJournal(journalEvents),
    }));
    const issueCodes = error.details.issues.map((issue) => issue.code).sort();

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      error.details.issues.some((issue) =>
        issue.code === 'MUTATION_DECISION_RESOURCE_OVERLAP'
        && issue.resourceKey === forgedCase.resourceKey),
      `forged ${forgedCase.resourceKey} mutation did not trip decision-overlap defense`,
    );
    assert.equal(digest(forgedRemote), beforeRemoteHash, `${forgedCase.resourceKey} forged refusal mutated remote`);
    assert.deepEqual(journalEvents, []);
    assertHashOnlyEvidence(error.details, `${forgedCase.resourceKey} forged refusal details`);

    return {
      resourceKey: forgedCase.resourceKey,
      code: error.code,
      issueCodes,
      beforeRemoteHash,
      afterRemoteHash: digest(forgedRemote),
      detailsHash: `sha256:${digest(error.details)}`,
      durableJournalEventTypes: journalEvents.map((event) => event.type),
    };
  });
}

function focusedReleaseVerifierEvidence() {
  const fixture = focusedFixture();
  const firstPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });

  assertFocusedPlanSurface(fixture, firstPlan);
  assertFocusedPlanSurface(fixture, replayPlan);

  const firstDecisions = keepRemoteCases.map((entry) =>
    assertKeepRemoteDecision({
      fixture,
      plan: firstPlan,
      resourceKey: entry.resourceKey,
      remoteChange: entry.remoteChange,
    }));
  const replayDecisions = keepRemoteCases.map((entry) =>
    assertKeepRemoteDecision({
      fixture,
      plan: replayPlan,
      resourceKey: entry.resourceKey,
      remoteChange: entry.remoteChange,
    }));
  const evidence = {
    status: firstPlan.status,
    summary: firstPlan.summary,
    emitted: emittedPlannerCounts(firstPlan),
    preconditionCount: firstPlan.preconditions.length,
    mutationResourceKeys: firstPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionResourceKeys: firstPlan.preconditions.map((precondition) => precondition.resourceKey),
    decisions: firstDecisions,
    apply: focusedApplyPreservation(fixture, firstPlan),
    staleReplay: staleReplayRefusal(fixture, firstPlan),
    forgedOverlapRefusals: forgedOverlapRefusals(fixture, firstPlan),
  };
  const replayEvidence = {
    status: replayPlan.status,
    summary: replayPlan.summary,
    emitted: emittedPlannerCounts(replayPlan),
    preconditionCount: replayPlan.preconditions.length,
    mutationResourceKeys: replayPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionResourceKeys: replayPlan.preconditions.map((precondition) => precondition.resourceKey),
    decisions: replayDecisions,
  };

  assert.deepEqual(
    {
      status: evidence.status,
      summary: evidence.summary,
      emitted: evidence.emitted,
      preconditionCount: evidence.preconditionCount,
      mutationResourceKeys: evidence.mutationResourceKeys,
      preconditionResourceKeys: evidence.preconditionResourceKeys,
      decisions: evidence.decisions,
    },
    replayEvidence,
    'RPP-0295 focused keep-remote release-verifier evidence changed between deterministic runs',
  );
  assertHashOnlyEvidence(evidence, 'RPP-0295 focused release-verifier evidence');
  return evidence;
}

function generatedKeepRemoteEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    casesWithKeepRemote: 0,
    readyCasesWithKeepRemote: 0,
    nonReadyCasesWithKeepRemote: 0,
    keepRemoteDecisionCount: 0,
    keepRemoteCaseTiers: {},
    keepRemoteResourceTypes: {},
    keepRemoteLocalChanges: {},
    keepRemoteRemoteChanges: {},
    caseProofs: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });
    const decisions = plan.decisions.filter((decision) => decision.decision === 'keep-remote');

    assert.deepEqual(plan.summary, emittedPlannerCounts(plan), `${testCase.id} planner summary`);
    incrementCount(evidence.statuses, plan.status);

    if (decisions.length === 0) {
      continue;
    }

    evidence.casesWithKeepRemote += 1;
    if (plan.status === 'ready') {
      evidence.readyCasesWithKeepRemote += 1;
    } else {
      evidence.nonReadyCasesWithKeepRemote += 1;
    }
    incrementCount(evidence.keepRemoteCaseTiers, String(testCase.tier));

    const decisionProofs = decisions.map((decision) => {
      assert.equal(decision.change.localChange, 'unchanged', `${testCase.id} ${decision.resourceKey}`);
      assert.ok(
        ['create', 'delete', 'update'].includes(decision.change.remoteChange),
        `${testCase.id} ${decision.resourceKey} remote change`,
      );
      assert.match(decision.baseHash, sha256HexPattern, `${testCase.id} ${decision.resourceKey} base hash`);
      assert.match(decision.remoteHash, sha256HexPattern, `${testCase.id} ${decision.resourceKey} remote hash`);
      assert.equal(
        resourceHash(testCase.base, decision.resource),
        decision.baseHash,
        `${testCase.id} ${decision.resourceKey} base hash binding`,
      );
      assert.equal(
        resourceHash(testCase.local, decision.resource),
        decision.baseHash,
        `${testCase.id} ${decision.resourceKey} local unchanged hash binding`,
      );
      assert.equal(
        resourceHash(testCase.remote, decision.resource),
        decision.remoteHash,
        `${testCase.id} ${decision.resourceKey} remote hash binding`,
      );
      assertDecisionOnly(plan, decision.resourceKey, `${testCase.id} ${decision.resourceKey}`);
      incrementCount(evidence.keepRemoteResourceTypes, decision.resource.type);
      incrementCount(evidence.keepRemoteLocalChanges, decision.change.localChange);
      incrementCount(evidence.keepRemoteRemoteChanges, decision.change.remoteChange);
      evidence.keepRemoteDecisionCount += 1;

      return {
        resourceKey: decision.resourceKey,
        resourceType: decision.resource.type,
        localChange: decision.change.localChange,
        remoteChange: decision.change.remoteChange,
        decisionHash: `sha256:${digest(decision)}`,
      };
    });

    evidence.caseProofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      decisionCount: decisions.length,
      decisionProofHash: `sha256:${digest(decisionProofs)}`,
    });
  }

  return {
    ...evidence,
    statuses: sortedObject(evidence.statuses),
    keepRemoteCaseTiers: sortedNumericObject(evidence.keepRemoteCaseTiers),
    keepRemoteResourceTypes: sortedObject(evidence.keepRemoteResourceTypes),
    keepRemoteLocalChanges: sortedObject(evidence.keepRemoteLocalChanges),
    keepRemoteRemoteChanges: sortedObject(evidence.keepRemoteRemoteChanges),
    caseProofHash: `sha256:${digest(evidence.caseProofs)}`,
  };
}

function aggregateFocusedEvidence(evidence) {
  return {
    totalCases: 1,
    statuses: { [evidence.status]: 1 },
    totalMutations: evidence.summary.mutations,
    totalPreconditions: evidence.preconditionCount,
    totalDecisions: evidence.summary.decisions,
    keepRemoteDecisionCount: evidence.decisions.length,
    totalForgedRefusals: evidence.forgedOverlapRefusals.length,
    totalStaleRefusals: 1,
    decisionResourceTypes: sortedObject(evidence.decisions.reduce((counts, decision) => {
      incrementCount(counts, decision.resourceType);
      return counts;
    }, {})),
    decisionRemoteChanges: sortedObject(evidence.decisions.reduce((counts, decision) => {
      incrementCount(counts, decision.remoteChange);
      return counts;
    }, {})),
  };
}

function assertGeneratedEvidence(evidence) {
  assert.equal(evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.deepEqual(evidence.statuses, {
    blocked: 74,
    conflict: 201,
    ready: 345,
  });
  assert.equal(evidence.casesWithKeepRemote, 533);
  assert.equal(evidence.readyCasesWithKeepRemote, 284);
  assert.equal(evidence.nonReadyCasesWithKeepRemote, 249);
  assert.equal(evidence.keepRemoteDecisionCount, 1575);
  assert.deepEqual(Object.keys(evidence.keepRemoteCaseTiers), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(evidence.keepRemoteResourceTypes, {
    file: 316,
    plugin: 20,
    row: 1239,
  });
  assert.deepEqual(evidence.keepRemoteLocalChanges, { unchanged: 1575 });
  assert.deepEqual(evidence.keepRemoteRemoteChanges, {
    create: 514,
    delete: 20,
    update: 1041,
  });
  assert.match(evidence.caseProofHash, sha256EvidencePattern);
}

test('RPP-0295 release verifier v5 carries keep-remote decisions as decision-only evidence', () => {
  const firstFocusedEvidence = focusedReleaseVerifierEvidence();
  const replayFocusedEvidence = focusedReleaseVerifierEvidence();
  const firstGeneratedEvidence = generatedKeepRemoteEvidence();
  const replayGeneratedEvidence = generatedKeepRemoteEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0295',
    evidenceSource: 'keep-remote-decision-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    focused: focusedAggregate,
    generated: {
      totalCases: firstGeneratedEvidence.totalCases,
      statuses: firstGeneratedEvidence.statuses,
      casesWithKeepRemote: firstGeneratedEvidence.casesWithKeepRemote,
      readyCasesWithKeepRemote: firstGeneratedEvidence.readyCasesWithKeepRemote,
      nonReadyCasesWithKeepRemote: firstGeneratedEvidence.nonReadyCasesWithKeepRemote,
      keepRemoteDecisionCount: firstGeneratedEvidence.keepRemoteDecisionCount,
      keepRemoteResourceTypes: firstGeneratedEvidence.keepRemoteResourceTypes,
      keepRemoteRemoteChanges: firstGeneratedEvidence.keepRemoteRemoteChanges,
    },
    focusedHash: `sha256:${digest(firstFocusedEvidence)}`,
    generatedHash: `sha256:${digest(firstGeneratedEvidence)}`,
    aggregateHash: `sha256:${digest({ focusedAggregate, generated: firstGeneratedEvidence })}`,
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0295 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0295 generated keep-remote evidence changed between runs',
  );
  assert.deepEqual(focusedAggregate, {
    totalCases: 1,
    statuses: {
      ready: 1,
    },
    totalMutations: 1,
    totalPreconditions: 1,
    totalDecisions: 5,
    keepRemoteDecisionCount: 5,
    totalForgedRefusals: 5,
    totalStaleRefusals: 1,
    decisionResourceTypes: {
      file: 2,
      plugin: 1,
      row: 2,
    },
    decisionRemoteChanges: {
      create: 1,
      delete: 2,
      update: 2,
    },
  });
  assertGeneratedEvidence(firstGeneratedEvidence);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence, 'RPP-0295 focused release-verifier envelope');
  assertHashOnlyEvidence(releaseEvidenceEnvelope, 'RPP-0295 release-verifier envelope');
});

test('RPP-0295 evidence note records the progress log command and caveat', () => {
  const note = fs.readFileSync(evidenceDocPath, 'utf8');

  assert.ok(note.includes('# RPP-0295 Keep-Remote Decision Release Verifier V5 Evidence'));
  assert.ok(note.includes('## Progress Log Entry'));
  assert.ok(note.includes(`Command: \`${command}\``));
  assert.ok(note.includes(`Caveat: ${caveat}`));
  assert.ok(note.includes('No shared harness, checklist, progress log, or progress page files were edited.'));
});
