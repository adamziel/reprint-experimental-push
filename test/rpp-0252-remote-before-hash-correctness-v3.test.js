import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash, setResource } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  MIN_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const MIN_REMOTE_BEFORE_HASH_SHAPES = 20;

let generatedMatrixCache = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '5'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function mutationById(plan, mutationId) {
  return plan.mutations.find((mutation) => mutation.id === mutationId);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function mutationShape(mutation) {
  return [
    mutation.resource.type,
    mutation.action,
    mutation.changeKind,
    mutation.resource.table || 'no-table',
  ].join(':');
}

function assertGeneratedMutationBinding(entry) {
  const mutation = entry.mutation;
  const precondition = preconditionFor(entry.plan, mutation);
  const observedRemoteHash = resourceHash(entry.testCase.remote, mutation.resource);

  assert.ok(precondition, `${entry.id} missing live-remote precondition`);
  assert.deepEqual(precondition.resource, mutation.resource);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.match(mutation.remoteBeforeHash, SHA256_HEX_PATTERN);
  assert.equal(mutation.remoteBeforeHash, observedRemoteHash, `${entry.id} mutation remoteBeforeHash`);
  assert.equal(precondition.expectedHash, observedRemoteHash, `${entry.id} precondition expectedHash`);
}

function generatedRemoteBeforeHashMatrix() {
  if (generatedMatrixCache) {
    return generatedMatrixCache;
  }

  const generatedCases = generatePushHarnessCases();
  const selectedByShape = new Map();
  const summary = {
    totalGeneratedCases: generatedCases.length,
    statuses: {},
    totalMutations: 0,
    totalPreconditions: 0,
    readyCasesWithMutations: 0,
    readyMutations: 0,
    resourceTypes: {},
    actions: {},
    changeKinds: {},
    rowTables: {},
  };

  for (const testCase of generatedCases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });

    incrementCount(summary.statuses, plan.status);
    summary.totalMutations += plan.mutations.length;
    summary.totalPreconditions += plan.preconditions.length;

    if (plan.status !== 'ready' || plan.mutations.length === 0) {
      continue;
    }

    summary.readyCasesWithMutations++;
    summary.readyMutations += plan.mutations.length;

    for (const mutation of plan.mutations) {
      const shape = mutationShape(mutation);
      incrementCount(summary.resourceTypes, mutation.resource.type);
      incrementCount(summary.actions, mutation.action);
      incrementCount(summary.changeKinds, mutation.changeKind);
      if (mutation.resource.table) {
        incrementCount(summary.rowTables, mutation.resource.table);
      }
      if (!selectedByShape.has(shape)) {
        const entry = {
          id: `${testCase.id}:${mutation.id}`,
          caseId: testCase.id,
          family: testCase.family,
          tier: testCase.tier,
          shape,
          testCase,
          plan,
          mutation,
        };
        assertGeneratedMutationBinding(entry);
        selectedByShape.set(shape, entry);
      }
    }
  }

  const matrix = [...selectedByShape.values()].sort((left, right) => left.shape.localeCompare(right.shape));
  generatedMatrixCache = { matrix, summary };
  return generatedMatrixCache;
}

function generatedCoverageEvidence(matrix, summary) {
  return {
    totalGeneratedCases: summary.totalGeneratedCases,
    statuses: summary.statuses,
    totalMutations: summary.totalMutations,
    totalPreconditions: summary.totalPreconditions,
    readyCasesWithMutations: summary.readyCasesWithMutations,
    readyMutations: summary.readyMutations,
    selectedShapeCount: matrix.length,
    selectedFamilies: [...new Set(matrix.map((entry) => entry.family))].sort(),
    resourceTypes: summary.resourceTypes,
    actions: summary.actions,
    changeKinds: summary.changeKinds,
    rowTables: summary.rowTables,
    selectedCases: matrix.map((entry) => ({
      caseId: entry.caseId,
      family: entry.family,
      tier: entry.tier,
      shape: entry.shape,
      resourceKey: entry.mutation.resourceKey,
      remoteBeforeHash: entry.mutation.remoteBeforeHash,
      preconditionHash: preconditionFor(entry.plan, entry.mutation).expectedHash,
    })),
  };
}

function assertNoTargetOrMutationJournalEvents(events, label) {
  assert.deepEqual(
    events
      .filter((event) => event.type === 'target-planned' || event.type.includes('mutation'))
      .map((event) => event.type),
    [],
    `${label} wrote target or mutation journal evidence before refusal`,
  );
}

function alternateHash(actualHash) {
  const forged = '0'.repeat(64);
  return forged === actualHash ? '1'.repeat(64) : forged;
}

function staleValueFor(resource, current, marker) {
  if (resource.type === 'file') {
    return { type: 'file', content: marker };
  }

  if (resource.type === 'plugin') {
    if (current === ABSENT) {
      return { version: `0.0.0-${marker}`, active: false };
    }
    return {
      ...cloneJson(current),
      version: `${current.version || '0.0.0'}-${marker}`,
      __rpp0252StaleMarker: marker,
    };
  }

  if (resource.type === 'row') {
    if (current === ABSENT || current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { __rpp0252StaleMarker: marker };
    }
    return {
      ...cloneJson(current),
      __rpp0252StaleMarker: marker,
    };
  }

  throw new Error(`No stale value helper for ${resource.type}`);
}

function staleRemoteFor(entry, marker) {
  const staleRemote = cloneJson(entry.testCase.remote);
  const current = getResource(staleRemote, entry.mutation.resource);
  setResource(staleRemote, entry.mutation.resource, staleValueFor(entry.mutation.resource, current, marker));
  return staleRemote;
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0252 generated matrix binds remoteBeforeHash to generated live-remote preconditions', () => {
  const { matrix, summary } = generatedRemoteBeforeHashMatrix();
  const evidence = generatedCoverageEvidence(matrix, summary);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0252-remote-before-hash-correctness-v3.test.js',
    evidenceHash: `sha256:${digest(evidence)}`,
    evidence,
  };

  assert.ok(summary.totalGeneratedCases >= MIN_GENERATED_PUSH_CASES);
  assert.equal(summary.totalPreconditions, summary.totalMutations);
  assert.ok(summary.statuses.ready > 0, 'generated coverage needs ready cases');
  assert.ok(summary.statuses.conflict > 0, 'generated coverage needs conflict cases');
  assert.ok(summary.statuses.blocked > 0, 'generated coverage needs blocked cases');
  assert.ok(matrix.length >= MIN_REMOTE_BEFORE_HASH_SHAPES);
  assert.ok(matrix.some((entry) => entry.mutation.resource.type === 'file'));
  assert.ok(matrix.some((entry) => entry.mutation.resource.type === 'row'));
  assert.ok(matrix.some((entry) => entry.mutation.resource.type === 'plugin'));
  assert.ok(matrix.some((entry) => entry.mutation.action === 'put'));
  assert.ok(matrix.some((entry) => entry.mutation.action === 'delete'));

  for (const entry of matrix) {
    assertGeneratedMutationBinding(entry);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
});

test('RPP-0252 executor rejects generated forged remoteBeforeHash attempts before mutation', () => {
  const { matrix, summary } = generatedRemoteBeforeHashMatrix();
  const rejectionProofs = [];

  assert.ok(matrix.length >= MIN_REMOTE_BEFORE_HASH_SHAPES);
  assert.ok(summary.readyMutations > matrix.length, 'generated proof should sample a broad ready mutation pool');

  for (const entry of matrix) {
    const forgedHash = alternateHash(entry.mutation.remoteBeforeHash);
    const forgedPlan = tamperReadyPlan(entry.plan, (plan) => {
      const forgedMutation = mutationById(plan, entry.mutation.id);
      const forgedPrecondition = preconditionFor(plan, forgedMutation);
      forgedMutation.remoteBeforeHash = forgedHash;
      forgedPrecondition.expectedHash = forgedHash;
    });
    const applyRemote = cloneJson(entry.testCase.remote);
    const beforeRemote = JSON.stringify(applyRemote);
    const beforeRemoteHash = digest(applyRemote);
    const journalEvents = [];
    const error = captureError(() => applyPlan(applyRemote, forgedPlan, {
      durableJournal: claimFencedDurableJournal(journalEvents),
    }));
    const actualHash = resourceHash(entry.testCase.remote, entry.mutation.resource);

    assert.ok(error instanceof PushPlanError, entry.id);
    assert.equal(error.code, 'PRECONDITION_FAILED', entry.id);
    assert.equal(error.details.resourceKey, entry.mutation.resourceKey, entry.id);
    assert.equal(error.details.expectedHash, forgedHash, entry.id);
    assert.equal(error.details.actualHash, actualHash, entry.id);
    assert.equal(JSON.stringify(applyRemote), beforeRemote, `${entry.id} mutated remote`);
    assert.equal(digest(applyRemote), beforeRemoteHash, `${entry.id} changed remote hash`);
    assertNoTargetOrMutationJournalEvents(journalEvents, entry.id);

    rejectionProofs.push({
      caseId: entry.caseId,
      family: entry.family,
      tier: entry.tier,
      shape: entry.shape,
      resourceKey: entry.mutation.resourceKey,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash: beforeRemoteHash,
      remoteAfterHash: digest(applyRemote),
      journalEventTypes: journalEvents.map((event) => event.type),
    });
  }

  assert.match(`sha256:${digest(rejectionProofs)}`, /^sha256:[a-f0-9]{64}$/);
});

test('RPP-0252 executor rejects generated stale remote resources before mutation', () => {
  const { matrix } = generatedRemoteBeforeHashMatrix();
  const rejectionProofs = [];
  const privateMarkers = [];

  assert.ok(matrix.length >= MIN_REMOTE_BEFORE_HASH_SHAPES);

  for (const entry of matrix) {
    const privateMarker = `rpp0252-stale-private-${entry.caseId}-${entry.mutation.id}`;
    privateMarkers.push(privateMarker);
    const staleRemote = staleRemoteFor(entry, privateMarker);
    const staleActualHash = resourceHash(staleRemote, entry.mutation.resource);
    const beforeRemote = JSON.stringify(staleRemote);
    const beforeRemoteHash = digest(staleRemote);
    const journalEvents = [];

    assert.notEqual(staleActualHash, entry.mutation.remoteBeforeHash, `${entry.id} stale fixture must drift`);

    const error = captureError(() => applyPlan(staleRemote, entry.plan, {
      durableJournal: claimFencedDurableJournal(journalEvents),
    }));

    assert.ok(error instanceof PushPlanError, entry.id);
    assert.equal(error.code, 'PRECONDITION_FAILED', entry.id);
    assert.equal(error.details.resourceKey, entry.mutation.resourceKey, entry.id);
    assert.equal(error.details.expectedHash, entry.mutation.remoteBeforeHash, entry.id);
    assert.equal(error.details.actualHash, staleActualHash, entry.id);
    assert.equal(JSON.stringify(staleRemote), beforeRemote, `${entry.id} mutated stale remote`);
    assert.equal(digest(staleRemote), beforeRemoteHash, `${entry.id} changed stale remote hash`);
    assertNoTargetOrMutationJournalEvents(journalEvents, entry.id);

    rejectionProofs.push({
      caseId: entry.caseId,
      family: entry.family,
      tier: entry.tier,
      shape: entry.shape,
      resourceKey: entry.mutation.resourceKey,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash: beforeRemoteHash,
      remoteAfterHash: digest(staleRemote),
      journalEventTypes: journalEvents.map((event) => event.type),
    });
  }

  const proofEnvelope = {
    evidenceHash: `sha256:${digest(rejectionProofs)}`,
    rejectionCount: rejectionProofs.length,
    rejectionProofs,
  };

  assert.match(proofEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assertHashOnlyEvidenceRedacted(proofEnvelope, privateMarkers, 'RPP-0252 stale rejection evidence');
});
