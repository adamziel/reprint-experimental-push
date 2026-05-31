import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarioMatrixPath = path.join(repoRoot, 'docs/scenario-matrix.md');
const fixedNow = new Date('2026-05-31T06:29:40.000Z');
const command = 'node --test test/rpp-0294-already-in-sync-decision-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node release-verifier support proof; release remains gated separately.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const createdFilePath = 'wp-content/uploads/rpp-0294-shared-created.txt';
const optionRowId = 'option_name:rpp_0294_shared_flag';
const postRowId = 'ID:1';
const localMutationKey = 'file:wp-content/themes/reprint/style.css';
const alreadyInSyncKeys = Object.freeze([
  'file:index.php',
  `file:${createdFilePath}`,
  'plugin:forms',
  rowKey('wp_options', optionRowId),
  rowKey('wp_posts', postRowId),
]);

const rawFixtureValues = Object.freeze([
  '<?php echo "rpp0294-base-index-private";',
  '/* rpp0294-base-theme-private */',
  'rpp0294-shared-created-private-payload',
  'rpp0294-shared-option-private-mode',
  'Shared private RPP-0294 post title',
  '/* rpp0294-local-theme-private */',
  '<?php echo "rpp0294-drift-index-private";',
  'rpp0294-drift-created-private-payload',
  '9.9.9-rpp0294-drift-plugin-version',
  'rpp0294-drift-option-private-mode',
  'Drift private RPP-0294 post title',
  'forged-rpp0294-created-private-overwrite',
  '7.7.7-rpp0294-forged-plugin-version',
  'forged-rpp0294-option-private-overwrite',
  'Forged private RPP-0294 post title',
]);

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': rawFixtureValues[0],
      'wp-content/themes/reprint/style.css': rawFixtureValues[1],
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {},
      wp_posts: {
        [postRowId]: {
          ID: 1,
          post_title: 'Base private RPP-0294 post title',
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

  delete local.files['index.php'];
  delete remote.files['index.php'];
  local.files[createdFilePath] = rawFixtureValues[2];
  remote.files[createdFilePath] = rawFixtureValues[2];
  delete local.plugins.forms;
  delete remote.plugins.forms;
  local.db.wp_options[optionRowId] = {
    option_name: 'rpp_0294_shared_flag',
    option_value: { mode: rawFixtureValues[3] },
    autoload: 'no',
  };
  remote.db.wp_options[optionRowId] = cloneJson(local.db.wp_options[optionRowId]);
  local.db.wp_posts[postRowId].post_title = rawFixtureValues[4];
  remote.db.wp_posts[postRowId].post_title = rawFixtureValues[4];
  local.files['wp-content/themes/reprint/style.css'] = rawFixtureValues[5];

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
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
    claimHash: 'a'.repeat(64),
    appendEvent(type, payload) {
      const event = { sequence: events.length + 1, type, ...payload };
      events.push(event);
      return event;
    },
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function decisionProjection(decision, fixture, appliedSite = null) {
  assert.equal(resourceHash(fixture.local, decision.resource), decision.localHash);
  assert.equal(resourceHash(fixture.remote, decision.resource), decision.change.remote.hash);

  return {
    idHash: sha256Evidence(decision.id),
    resourceKey: decision.resourceKey,
    resourceType: decision.resource.type,
    decision: decision.decision,
    baseHash: decision.baseHash,
    localHash: decision.localHash,
    remoteHash: decision.change.remote.hash,
    appliedHash: appliedSite ? resourceHash(appliedSite, decision.resource) : null,
    localChange: decision.change.localChange,
    remoteChange: decision.change.remoteChange,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: sha256Evidence({
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: decision.baseHash,
      localHash: decision.localHash,
      remoteHash: decision.change.remote.hash,
      localChange: decision.change.localChange,
      remoteChange: decision.change.remoteChange,
    }),
  };
}

function comparableDecisionProjection(proof) {
  return {
    resourceKey: proof.resourceKey,
    decision: proof.decision,
    baseHash: proof.baseHash,
    localHash: proof.localHash,
    remoteHash: proof.remoteHash,
    localChange: proof.localChange,
    remoteChange: proof.remoteChange,
    plannedMutation: proof.plannedMutation,
    plannedPrecondition: proof.plannedPrecondition,
  };
}

function assertFocusedAlreadyInSyncDecision({ fixture, plan, decision, appliedSite }) {
  assert.equal(decision.decision, 'already-in-sync', `${decision.resourceKey} decision`);
  assert.match(decision.baseHash, sha256HexPattern, `${decision.resourceKey} base hash`);
  assert.match(decision.localHash, sha256HexPattern, `${decision.resourceKey} local hash`);
  assert.match(decision.change.remote.hash, sha256HexPattern, `${decision.resourceKey} remote hash`);
  assert.equal(decision.localHash, decision.change.local.hash, `${decision.resourceKey} local change hash`);
  assert.equal(decision.localHash, decision.change.remote.hash, `${decision.resourceKey} remote change hash`);
  assert.equal(resourceHash(fixture.base, decision.resource), decision.baseHash, `${decision.resourceKey} base source`);
  assert.equal(resourceHash(fixture.local, decision.resource), decision.localHash, `${decision.resourceKey} local source`);
  assert.equal(resourceHash(fixture.remote, decision.resource), decision.localHash, `${decision.resourceKey} remote source`);
  assert.equal(mutationFor(plan, decision.resourceKey), undefined, `${decision.resourceKey} mutation`);
  assert.equal(preconditionFor(plan, decision.resourceKey), undefined, `${decision.resourceKey} precondition`);

  if (appliedSite) {
    assert.equal(
      resourceHash(appliedSite, decision.resource),
      resourceHash(fixture.remote, decision.resource),
      `${decision.resourceKey} changed during clean apply`,
    );
  }
}

function focusedReleaseVerifierEvidence() {
  const fixture = focusedFixture();
  const firstPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 5,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    firstPlan.decisions.map((decision) => [
      decision.resourceKey,
      decision.decision,
      decision.change.localChange,
      decision.change.remoteChange,
    ]),
    [
      ['file:index.php', 'already-in-sync', 'delete', 'delete'],
      [`file:${createdFilePath}`, 'already-in-sync', 'create', 'create'],
      ['plugin:forms', 'already-in-sync', 'delete', 'delete'],
      [rowKey('wp_options', optionRowId), 'already-in-sync', 'create', 'create'],
      [rowKey('wp_posts', postRowId), 'already-in-sync', 'update', 'update'],
    ],
  );

  const applied = applyPlan(cloneJson(fixture.remote), firstPlan);
  const cleanDecisionProofs = alreadyInSyncKeys.map((resourceKey) => {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.ok(decision, `missing ${resourceKey} decision`);
    assertFocusedAlreadyInSyncDecision({ fixture, plan: firstPlan, decision, appliedSite: applied.site });
    return decisionProjection(decision, fixture, applied.site);
  });

  const applyRemote = cloneJson(fixture.remote);
  applyRemote.files['index.php'] = rawFixtureValues[6];
  applyRemote.files[createdFilePath] = rawFixtureValues[7];
  applyRemote.plugins.forms = { version: rawFixtureValues[8], active: true };
  applyRemote.db.wp_options[optionRowId].option_value.mode = rawFixtureValues[9];
  applyRemote.db.wp_posts[postRowId].post_title = rawFixtureValues[10];

  const driftedDecisionHashes = Object.fromEntries(alreadyInSyncKeys.map((resourceKey) => {
    const decision = decisionFor(firstPlan, resourceKey);
    return [resourceKey, resourceHash(applyRemote, decision.resource)];
  }));
  const durableEvents = [];
  const driftApplyResult = applyPlan(applyRemote, firstPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(durableEvents),
  });

  assert.equal(driftApplyResult.appliedMutations, 1);
  assert.equal(applyRemote.files['wp-content/themes/reprint/style.css'], rawFixtureValues[5]);
  for (const resourceKey of alreadyInSyncKeys) {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.equal(
      resourceHash(applyRemote, decision.resource),
      driftedDecisionHashes[resourceKey],
      `${resourceKey} post-plan remote drift should be preserved`,
    );
  }
  assert.deepEqual(
    durableEvents
      .filter((event) => event.type === 'target-planned')
      .map((event) => event.resourceKey),
    [localMutationKey],
  );
  assert.deepEqual(
    durableEvents
      .filter((event) => event.type === 'mutation-observed')
      .map((event) => event.resourceKey),
    [localMutationKey],
  );
  for (const resourceKey of alreadyInSyncKeys) {
    assert.equal(
      durableEvents.some((event) => event.resourceKey === resourceKey),
      false,
      `${resourceKey} wrote durable mutation evidence`,
    );
  }

  const forgedRefusals = forgedDecisionMutationCases(firstPlan).map((forgedCase) => {
    const forgedPlan = tamperReadyPlan(firstPlan, (plan) => {
      plan.mutations.push(forgedCase.mutation);
      plan.preconditions.push({
        mutationId: forgedCase.mutation.id,
        resource: forgedCase.mutation.resource,
        resourceKey: forgedCase.mutation.resourceKey,
        expectedHash: forgedCase.mutation.remoteBeforeHash,
        checkedAgainst: 'live-remote',
      });
    });
    const forgedRemote = cloneJson(applyRemote);
    const beforeHash = digest(forgedRemote);
    const forgedEvents = [];
    const error = captureError(() => applyPlan(forgedRemote, forgedPlan, {
      mutateRemote: true,
      durableJournal: durableJournal(forgedEvents),
    }));

    assert.ok(error instanceof PushPlanError, `${forgedCase.resourceKey} should refuse as PushPlanError`);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      error.details.issues.some((issue) =>
        issue.code === 'MUTATION_DECISION_RESOURCE_OVERLAP'
        && issue.resourceKey === forgedCase.resourceKey),
      `${forgedCase.resourceKey} did not trip decision-resource overlap defense`,
    );
    assert.equal(digest(forgedRemote), beforeHash, `${forgedCase.resourceKey} forged refusal mutated remote`);
    assert.deepEqual(forgedEvents, [], `${forgedCase.resourceKey} forged refusal wrote durable events`);

    return {
      resourceKey: forgedCase.resourceKey,
      code: error.code,
      issueCodes: error.details.issues.map((issue) => issue.code).sort(),
      remoteHashAfterRefusal: sha256Evidence(forgedRemote),
      durableJournalEventCount: forgedEvents.length,
      detailsHash: sha256Evidence(error.details),
    };
  });

  const firstProjection = {
    status: firstPlan.status,
    summary: firstPlan.summary,
    mutationResourceKeys: firstPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionResourceKeys: firstPlan.preconditions.map((precondition) => precondition.resourceKey),
    decisionProofs: cleanDecisionProofs,
  };
  const replayProjection = {
    status: replayPlan.status,
    summary: replayPlan.summary,
    mutationResourceKeys: replayPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionResourceKeys: replayPlan.preconditions.map((precondition) => precondition.resourceKey),
    decisionProofs: alreadyInSyncKeys.map((resourceKey) => {
      const decision = decisionFor(replayPlan, resourceKey);
      assert.ok(decision, `missing replay ${resourceKey} decision`);
      return decisionProjection(decision, fixture);
    }),
  };

  assert.deepEqual(
    {
      status: firstProjection.status,
      summary: firstProjection.summary,
      mutationResourceKeys: firstProjection.mutationResourceKeys,
      preconditionResourceKeys: firstProjection.preconditionResourceKeys,
      decisionProofs: firstProjection.decisionProofs.map(comparableDecisionProjection),
    },
    {
      status: replayProjection.status,
      summary: replayProjection.summary,
      mutationResourceKeys: replayProjection.mutationResourceKeys,
      preconditionResourceKeys: replayProjection.preconditionResourceKeys,
      decisionProofs: replayProjection.decisionProofs.map(comparableDecisionProjection),
    },
    'focused already-in-sync release-verifier projection changed between deterministic planning runs',
  );

  return {
    label: 'focused create/delete/update already-in-sync release verifier fixture',
    status: firstPlan.status,
    summary: firstPlan.summary,
    decisionCount: firstPlan.decisions.length,
    mutationCount: firstPlan.mutations.length,
    preconditionCount: firstPlan.preconditions.length,
    decisionResourceKeys: alreadyInSyncKeys,
    mutationResourceKeys: firstPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionResourceKeys: firstPlan.preconditions.map((precondition) => precondition.resourceKey),
    cleanDecisionHash: sha256Evidence(cleanDecisionProofs),
    driftPreservationHash: sha256Evidence(driftedDecisionHashes),
    durableMutationEventResourceKeys: durableEvents
      .filter((event) => event.type === 'mutation-observed')
      .map((event) => event.resourceKey),
    forgedRefusals,
    projectionHash: sha256Evidence(firstProjection),
  };
}

function generatedAlreadyInSyncReleaseVerifierEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    taggedCases: 0,
    statuses: {},
    families: {},
    totalAlreadyInSyncDecisions: 0,
    casesWithAlreadyInSync: 0,
    casesWithDecisionMutationOverlap: 0,
    casesWithDecisionPreconditions: 0,
    proofSamples: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });
    const alreadyInSyncDecisions = plan.decisions.filter((decision) => decision.decision === 'already-in-sync');

    if (testCase.tags.has('already-in-sync')) {
      evidence.taggedCases += 1;
      incrementCount(evidence.families, testCase.family);
      incrementCount(evidence.statuses, plan.status);
      assert.ok(alreadyInSyncDecisions.length >= 1, `${testCase.id} should carry already-in-sync evidence`);
    }
    if (alreadyInSyncDecisions.length > 0) {
      evidence.casesWithAlreadyInSync += 1;
    }
    evidence.totalAlreadyInSyncDecisions += alreadyInSyncDecisions.length;

    for (const decision of alreadyInSyncDecisions) {
      assert.equal(mutationFor(plan, decision.resourceKey), undefined, `${testCase.id} ${decision.resourceKey} mutation`);
      assert.equal(
        preconditionFor(plan, decision.resourceKey),
        undefined,
        `${testCase.id} ${decision.resourceKey} precondition`,
      );
      assert.equal(decision.localHash, decision.change.remote.hash, `${testCase.id} ${decision.resourceKey} remote hash`);
      assert.equal(resourceHash(testCase.local, decision.resource), decision.localHash);
      assert.equal(resourceHash(testCase.remote, decision.resource), decision.localHash);
    }

    evidence.casesWithDecisionMutationOverlap += alreadyInSyncDecisions.filter((decision) =>
      mutationFor(plan, decision.resourceKey)).length;
    evidence.casesWithDecisionPreconditions += alreadyInSyncDecisions.filter((decision) =>
      preconditionFor(plan, decision.resourceKey)).length;

    if (testCase.tags.has('already-in-sync') && evidence.proofSamples.length < 10) {
      evidence.proofSamples.push({
        idHash: sha256Evidence(testCase.id),
        family: testCase.family,
        tier: testCase.tier,
        status: plan.status,
        alreadyInSyncDecisionCount: alreadyInSyncDecisions.length,
        decisionResourceKeyHash: sha256Evidence(
          alreadyInSyncDecisions.map((decision) => decision.resourceKey).sort(),
        ),
        planSummaryHash: sha256Evidence(plan.summary),
      });
    }
  }

  return {
    ...evidence,
    statuses: sortObject(evidence.statuses),
    families: sortObject(evidence.families),
  };
}

function forgedDecisionMutationCases(plan) {
  const forgedValues = new Map([
    ['file:index.php', { action: 'delete', value: ABSENT, localChange: 'delete' }],
    [`file:${createdFilePath}`, {
      action: 'put',
      value: { type: 'file', content: rawFixtureValues[11] },
      localChange: 'update',
    }],
    ['plugin:forms', {
      action: 'put',
      value: { version: rawFixtureValues[12], active: false },
      localChange: 'update',
    }],
    [rowKey('wp_options', optionRowId), {
      action: 'put',
      value: {
        option_name: 'rpp_0294_shared_flag',
        option_value: { mode: rawFixtureValues[13] },
        autoload: 'no',
      },
      localChange: 'update',
    }],
    [rowKey('wp_posts', postRowId), {
      action: 'put',
      value: { ID: 1, post_title: rawFixtureValues[14], post_status: 'publish' },
      localChange: 'update',
    }],
  ]);

  return alreadyInSyncKeys.map((resourceKey) => {
    const decision = decisionFor(plan, resourceKey);
    const forged = forgedValues.get(resourceKey);
    assert.ok(decision, `missing ${resourceKey} decision for forged case`);
    assert.ok(forged, `missing forged case for ${resourceKey}`);

    return {
      resourceKey,
      mutation: {
        id: `mutation-rpp-0294-forged-${decision.resource.type}-${forged.action}`,
        resource: decision.resource,
        resourceKey: decision.resourceKey,
        action: forged.action,
        value: serializeResourceValue(forged.value),
        baseHash: decision.baseHash,
        localHash: digest(forged.value),
        remoteBeforeHash: decision.change.remote.hash,
        changeKind: forged.localChange,
        change: {
          localChange: forged.localChange,
          remoteChange: decision.change.remoteChange,
        },
      },
    };
  });
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.mutations = copy.mutations.length;
  copy.summary.decisions = copy.decisions.length;
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function assertHashOnlyEvidence(value) {
  const serialized = JSON.stringify(value);

  for (const rawValue of rawFixtureValues) {
    assert.equal(serialized.includes(rawValue), false, `hash-only evidence leaked ${rawValue}`);
  }
  for (const rawFieldName of ['"content"', '"option_value"', '"post_title"', '"value"']) {
    assert.equal(serialized.includes(rawFieldName), false, `hash-only evidence leaked raw field ${rawFieldName}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0294 release verifier proof' }));
}

test('RPP-0294 release verifier v5 carries already-in-sync decisions as hash-only support evidence', () => {
  const firstFocusedEvidence = focusedReleaseVerifierEvidence();
  const replayFocusedEvidence = focusedReleaseVerifierEvidence();
  const firstGeneratedEvidence = generatedAlreadyInSyncReleaseVerifierEvidence();
  const replayGeneratedEvidence = generatedAlreadyInSyncReleaseVerifierEvidence();
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0294',
    behavior: 'already-in-sync decision release verifier, variant 5',
    evidenceSource: 'already-in-sync-decision-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    releaseVerifier: {
      checkedBy: command,
      check: 'already-in-sync-decision',
      variant: 'v5',
      deterministicReplay: true,
      decisionOnlyResources: true,
      postPlanRemoteDriftPreserved: true,
      forgedOverlapRefusesBeforeMutation: true,
    },
    focused: {
      status: firstFocusedEvidence.status,
      summary: firstFocusedEvidence.summary,
      decisionCount: firstFocusedEvidence.decisionCount,
      mutationCount: firstFocusedEvidence.mutationCount,
      preconditionCount: firstFocusedEvidence.preconditionCount,
      decisionResourceKeys: firstFocusedEvidence.decisionResourceKeys,
      mutationResourceKeys: firstFocusedEvidence.mutationResourceKeys,
      preconditionResourceKeys: firstFocusedEvidence.preconditionResourceKeys,
      durableMutationEventResourceKeys: firstFocusedEvidence.durableMutationEventResourceKeys,
      forgedRefusalCount: firstFocusedEvidence.forgedRefusals.length,
    },
    generated: {
      totalCases: firstGeneratedEvidence.totalCases,
      taggedCases: firstGeneratedEvidence.taggedCases,
      statuses: firstGeneratedEvidence.statuses,
      familyCount: Object.keys(firstGeneratedEvidence.families).length,
      totalAlreadyInSyncDecisions: firstGeneratedEvidence.totalAlreadyInSyncDecisions,
      casesWithAlreadyInSync: firstGeneratedEvidence.casesWithAlreadyInSync,
      casesWithDecisionMutationOverlap: firstGeneratedEvidence.casesWithDecisionMutationOverlap,
      casesWithDecisionPreconditions: firstGeneratedEvidence.casesWithDecisionPreconditions,
    },
    redaction: {
      format: 'hash-only',
      checkedFixtureCount: rawFixtureValues.length,
      rawValuesIncluded: false,
    },
    focusedHash: sha256Evidence(firstFocusedEvidence),
    generatedHash: sha256Evidence(firstGeneratedEvidence),
  };
  releaseEvidenceEnvelope.proofHash = sha256Evidence({
    releaseVerifier: releaseEvidenceEnvelope.releaseVerifier,
    focused: releaseEvidenceEnvelope.focused,
    generated: releaseEvidenceEnvelope.generated,
    redaction: releaseEvidenceEnvelope.redaction,
    focusedHash: releaseEvidenceEnvelope.focusedHash,
    generatedHash: releaseEvidenceEnvelope.generatedHash,
  });

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0294 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0294 generated release-verifier evidence changed between runs',
  );
  assert.deepEqual(releaseEvidenceEnvelope.focused.summary, {
    mutations: 1,
    decisions: 5,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(releaseEvidenceEnvelope.focused.decisionCount, 5);
  assert.equal(releaseEvidenceEnvelope.focused.mutationCount, 1);
  assert.equal(releaseEvidenceEnvelope.focused.preconditionCount, 1);
  assert.deepEqual(releaseEvidenceEnvelope.focused.decisionResourceKeys, alreadyInSyncKeys);
  assert.deepEqual(releaseEvidenceEnvelope.focused.durableMutationEventResourceKeys, [localMutationKey]);
  assert.equal(releaseEvidenceEnvelope.focused.forgedRefusalCount, alreadyInSyncKeys.length);
  assert.equal(releaseEvidenceEnvelope.generated.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(releaseEvidenceEnvelope.generated.taggedCases, 79);
  assert.deepEqual(releaseEvidenceEnvelope.generated.statuses, { blocked: 8, ready: 71 });
  assert.equal(releaseEvidenceEnvelope.generated.totalAlreadyInSyncDecisions, 232);
  assert.equal(releaseEvidenceEnvelope.generated.casesWithDecisionMutationOverlap, 0);
  assert.equal(releaseEvidenceEnvelope.generated.casesWithDecisionPreconditions, 0);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.proofHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence);
  assertHashOnlyEvidence(firstGeneratedEvidence);
  assertHashOnlyEvidence(releaseEvidenceEnvelope);
});

test('RPP-0294 scenario matrix names the already-in-sync release-verifier behavior and command', () => {
  const scenarioMatrix = fs.readFileSync(scenarioMatrixPath, 'utf8');

  assert.match(
    scenarioMatrix,
    /\| Already-in-sync decision release verifier, variant 5 \|[^|]*release verifier[^|]*`already-in-sync` decisions[^|]*decision-only[^|]*post-plan remote drift[^|]*forged overlapping mutations[^|]*\| `node --test test\/rpp-0294-already-in-sync-decision-release-verifier-v5\.test\.js` \|/,
  );
});
