import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

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

function generatedIndependentRowRemoteFileTargets(testCase) {
  const rowEntry = Object.entries(testCase.local.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent local row '));
  const fileEntry = Object.entries(testCase.remote.files)
    .find(([, value]) => typeof value === 'string' && value.startsWith('independent remote file '));

  assert.ok(rowEntry, `${testCase.id} missing generated independent local row`);
  assert.ok(fileEntry, `${testCase.id} missing generated independent remote file`);

  return {
    rowId: rowEntry[0],
    rowTitle: rowEntry[1].post_title,
    filePath: fileEntry[0],
    fileValue: fileEntry[1],
  };
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function livePreconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
    blockers: 0,
    conflicts: 0,
  };
  return copy;
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: '2'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
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
      changeKind: mutation.changeKind,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: decision.baseHash,
      localHash: decision.localHash || null,
      remoteHash: decision.remoteHash || null,
      change: decision.change,
    })),
  };
}

function assertSerializedEvidenceRedacted(evidence, forbiddenValues) {
  const serialized = JSON.stringify(evidence);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false, `hash-only evidence leaked ${value}`);
  }
}

function assertEveryMutationHasLiveRemotePrecondition(testCase, plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${testCase.id} precondition count mismatch`);
  for (const mutation of plan.mutations) {
    const precondition = livePreconditionFor(plan, mutation);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
  }
}

function forgeRemoteFileMutationPlan({ testCase, plan, filePath, fileKey, forgedValue }) {
  const forgedMutationId = `mutation-rpp-0242-forged-file-overwrite-${testCase.id}`;
  const fileResource = { type: 'file', path: filePath, key: fileKey };
  const remoteHash = resourceHash(testCase.remote, fileResource);

  return tamperReadyPlan(plan, (copy) => {
    copy.mutations.push({
      id: forgedMutationId,
      resource: fileResource,
      resourceKey: fileKey,
      action: 'put',
      value: serializeResourceValue(forgedValue),
      remoteBeforeHash: remoteHash,
      baseHash: resourceHash(testCase.base, fileResource),
      localHash: digest(forgedValue),
      changeKind: 'update',
      change: {
        localChange: 'update',
        remoteChange: 'update',
      },
      atomicGroupId: null,
    });
    copy.preconditions.push({
      mutationId: forgedMutationId,
      resource: fileResource,
      resourceKey: fileKey,
      expectedHash: remoteHash,
      checkedAgainst: 'live-remote',
    });
  });
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

test('RPP-0242 generated independent local row plus remote file edit variant 3 rejects forged and stale mutation attempts', () => {
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-row-remote-file');
  const coverage = {
    target: 'independentLocalRowRemoteFileVariant3',
    family: 'independent-local-row-remote-file',
    total: generatedCases.length,
    perTier: {},
    statuses: {},
    caseProofs: [],
  };

  assert.equal(generatedCases.length, 10, 'expected one generated independent row/file case per tier');

  for (const testCase of generatedCases) {
    assert.ok(testCase.tags.has('independent-merge'), `${testCase.id} missing independent merge tag`);
    assert.ok(testCase.tags.has('independent-row-remote-file'), `${testCase.id} missing row/file tag`);

    const { rowId, rowTitle, filePath, fileValue } = generatedIndependentRowRemoteFileTargets(testCase);
    const rowKey = `row:["wp_posts","${rowId}"]`;
    const fileKey = `file:${filePath}`;
    const plan = planFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const rowMutation = mutationFor(plan, rowKey);
    const fileDecision = decisionFor(plan, fileKey);
    const rowPrecondition = rowMutation ? livePreconditionFor(plan, rowMutation) : null;
    const filePrecondition = plan.preconditions.find((precondition) => precondition.resourceKey === fileKey);
    const planEvidence = hashOnlyPlanEvidence(plan);

    increment(coverage.perTier, testCase.tier);
    increment(coverage.statuses, plan.status);

    assert.equal(plan.status, 'ready', `${testCase.id} generated plan must be ready`);
    assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary mismatch`);
    assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary mismatch`);
    assert.equal(plan.summary.conflicts, 0, `${testCase.id} ready target should not carry conflicts`);
    assert.equal(plan.summary.blockers, 0, `${testCase.id} ready target should not carry blockers`);
    assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic group summary mismatch`);
    assert.ok(plan.summary.mutations >= 1, `${testCase.id} should include at least the row mutation`);
    assert.ok(plan.summary.decisions >= 1, `${testCase.id} should include at least the remote file decision`);
    assert.equal(validation.status, 'ready', `${testCase.id} validation status`);
    assert.equal(validation.applied, true, `${testCase.id} validation apply result`);
    assert.equal(validation.unplannedRemotePreserved, true, `${testCase.id} validation must preserve remote file`);
    assert.equal(validation.staleReplayRejected, true, `${testCase.id} validation must reject stale replay`);
    assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(validation.staleReplayRemoteUnchanged, true, `${testCase.id} stale validation mutated remote`);

    assert.equal(rowMutation?.action, 'put', `${testCase.id} missing row mutation`);
    assert.equal(rowMutation.resourceKey, rowKey);
    assert.equal(rowMutation.change.localChange, 'update');
    assert.equal(rowMutation.change.remoteChange, 'unchanged');
    assert.equal(fileDecision?.decision, 'keep-remote', `${testCase.id} missing file keep-remote decision`);
    assert.equal(fileDecision.change.localChange, 'unchanged');
    assert.equal(fileDecision.change.remoteChange, 'update');
    assert.match(fileDecision.remoteHash, hashPattern);
    assert.equal(fileDecision.change.remote.hash, fileDecision.remoteHash);
    assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === fileKey), false);
    assert.equal(filePrecondition, undefined, `${testCase.id} must not precondition unplanned remote file`);
    assert.equal(rowPrecondition?.expectedHash, rowMutation.remoteBeforeHash);
    assertEveryMutationHasLiveRemotePrecondition(testCase, plan);
    assertSerializedEvidenceRedacted(planEvidence, [rowTitle, fileValue]);
    assertSerializedEvidenceRedacted(fileDecision, [fileValue]);

    const applyEvents = [];
    const result = applyPlan(cloneJson(testCase.remote), plan, {
      durableJournal: claimFencedDurableJournal(applyEvents),
    });
    assert.equal(result.appliedMutations, plan.mutations.length, `${testCase.id} applied mutation count mismatch`);
    assert.equal(result.site.db.wp_posts[rowId].post_title, rowTitle);
    assert.equal(result.site.files[filePath], fileValue);
    const applyTargetEvents = applyEvents
      .filter((event) => ['target-planned', 'mutation-observed'].includes(event.type));
    assert.ok(
      applyTargetEvents.some((event) => event.type === 'target-planned' && event.resourceKey === rowKey),
      `${testCase.id} durable evidence should plan the row mutation`,
    );
    assert.ok(
      applyTargetEvents.some((event) => event.type === 'mutation-observed' && event.resourceKey === rowKey),
      `${testCase.id} durable evidence should observe the row mutation`,
    );
    assert.equal(
      applyTargetEvents.some((event) => event.resourceKey === fileKey),
      false,
      `${testCase.id} durable mutation evidence must not target the remote-only file`,
    );
    assertSerializedEvidenceRedacted(applyEvents, [rowTitle, fileValue]);

    const forgedValue = `rpp0242-forged-remote-file-overwrite-${testCase.id}`;
    const forgedPlan = forgeRemoteFileMutationPlan({ testCase, plan, filePath, fileKey, forgedValue });
    const forgedRemote = cloneJson(testCase.remote);
    const forgedBeforeHash = digest(forgedRemote);
    const forgedEvents = [];
    const forgedError = captureError(() => applyPlan(forgedRemote, forgedPlan, {
      durableJournal: claimFencedDurableJournal(forgedEvents),
    }));

    assert.ok(forgedError instanceof PushPlanError, `${testCase.id} forged apply should throw`);
    assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      forgedError.details.issues.some((issue) =>
        issue.code === 'MUTATION_DECISION_RESOURCE_OVERLAP'
        && issue.resourceKey === fileKey),
      `${testCase.id} forged file overwrite should overlap the keep-remote decision`,
    );
    assert.equal(digest(forgedRemote), forgedBeforeHash, `${testCase.id} forged apply mutated remote`);
    assert.equal(forgedRemote.files[filePath], fileValue);
    assert.deepEqual(forgedEvents, [], `${testCase.id} forged apply wrote durable events`);
    assertSerializedEvidenceRedacted(hashOnlyPlanEvidence(forgedPlan), [rowTitle, fileValue, forgedValue]);
    assertSerializedEvidenceRedacted(forgedError.details, [rowTitle, fileValue, forgedValue]);

    const staleTitle = `rpp0242-stale-local-row-${testCase.id}`;
    const staleRemote = cloneJson(testCase.remote);
    staleRemote.db.wp_posts[rowId].post_title = staleTitle;
    const staleActualHash = resourceHash(staleRemote, rowMutation.resource);
    const staleBeforeHash = digest(staleRemote);
    const staleEvents = [];
    const staleError = captureError(() => applyPlan(staleRemote, plan, {
      durableJournal: claimFencedDurableJournal(staleEvents),
    }));

    assert.notEqual(staleActualHash, rowMutation.remoteBeforeHash, `${testCase.id} stale row did not drift`);
    assert.ok(staleError instanceof PushPlanError, `${testCase.id} stale apply should throw`);
    assert.equal(staleError.code, 'PRECONDITION_FAILED');
    assert.equal(staleError.details.resourceKey, rowKey);
    assert.equal(staleError.details.expectedHash, rowMutation.remoteBeforeHash);
    assert.equal(staleError.details.actualHash, staleActualHash);
    assert.equal(digest(staleRemote), staleBeforeHash, `${testCase.id} stale apply mutated remote`);
    assert.equal(staleRemote.files[filePath], fileValue);
    assert.deepEqual(staleEvents, [], `${testCase.id} stale apply wrote durable events`);
    assertSerializedEvidenceRedacted(staleError.details, [rowTitle, fileValue, staleTitle]);

    coverage.caseProofs.push({
      id: testCase.id,
      tier: testCase.tier,
      rowKey,
      fileKey,
      planHash: digest(planEvidence),
      rowMutationHash: rowMutation.remoteBeforeHash,
      remoteFileDecisionHash: fileDecision.remoteHash,
      applyRemoteHash: digest(result.site),
      forged: {
        code: forgedError.code,
        issueCodes: forgedError.details.issues.map((issue) => issue.code).sort(),
        remoteUnchangedHash: forgedBeforeHash,
      },
      stale: {
        code: staleError.code,
        expectedHash: staleError.details.expectedHash,
        actualHash: staleError.details.actualHash,
        remoteUnchangedHash: staleBeforeHash,
      },
    });
  }

  assert.deepEqual(coverage.perTier, {
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
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.equal(coverage.caseProofs.length, 10);
  assertSerializedEvidenceRedacted(
    coverage,
    generatedCases.flatMap((testCase) => {
      const { rowTitle, fileValue } = generatedIndependentRowRemoteFileTargets(testCase);
      return [rowTitle, fileValue];
    }),
  );
});
