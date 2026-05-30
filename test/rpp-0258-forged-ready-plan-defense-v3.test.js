import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  getResource,
  resourceHash,
  serializeResourceValue,
  setResource,
} from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const expectedReadyCandidateTierCounts = {
  0: 18,
  1: 16,
  2: 18,
  3: 16,
  4: 18,
  5: 16,
  6: 18,
  7: 16,
  8: 18,
  9: 16,
};

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

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
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
    atomicGroups: copy.atomicGroups.length,
  };
  return copy;
}

function claimOpenedDurableJournal(events) {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: '5'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function increment(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

function issueCodes(error) {
  return (error.details.issues || []).map((issue) => issue.code).sort();
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function valueType(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function hashFieldEvidence(value) {
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: sha256Evidence(value),
    valueType: valueType(value),
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHash(mutation) {
  try {
    return digest(deserializeResourceValue(mutation.value));
  } catch {
    return { state: 'unreadable-planned-value' };
  }
}

function changeHashEvidence(change = {}) {
  return {
    localChange: change.localChange || null,
    remoteChange: change.remoteChange || null,
    baseHash: hashFieldEvidence(change.base?.hash),
    localHash: hashFieldEvidence(change.local?.hash),
    remoteHash: hashFieldEvidence(change.remote?.hash),
  };
}

function hashOnlyPlanEvidence({
  label,
  testCase,
  plan,
  error = null,
  journalEvents = [],
  remoteBefore,
  remoteAfter,
  appliedMutationCount = 0,
}) {
  const evidence = {
    rpp: 'RPP-0258',
    label,
    case: {
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      tags: [...testCase.tags].sort(),
    },
    status: plan.status,
    summary: plan.summary,
    planHash: sha256Evidence(plan),
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind || null,
      baseHash: hashFieldEvidence(mutation.baseHash),
      localHash: hashFieldEvidence(mutation.localHash),
      remoteBeforeHash: hashFieldEvidence(mutation.remoteBeforeHash),
      plannedValueHash: plannedValueHash(mutation),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: hashFieldEvidence(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: hashFieldEvidence(decision.baseHash || decision.change?.base?.hash),
      localHash: hashFieldEvidence(decision.localHash || decision.change?.local?.hash),
      remoteHash: hashFieldEvidence(decision.remoteHash || decision.change?.remote?.hash),
      change: changeHashEvidence(decision.change),
    })),
    refusal: error
      ? {
          code: error.code,
          issueCodes: issueCodes(error),
          detailsHash: sha256Evidence(error.details),
        }
      : null,
    remoteBeforeHash: sha256Evidence(remoteBefore),
    remoteAfterHash: sha256Evidence(remoteAfter),
    journalEventTypes: journalEvents.map((event) => event.type),
    targetOrMutationJournalEvents: journalEvents.filter(
      (event) => event.type === 'target-planned' || event.type.includes('mutation'),
    ).length,
    appliedMutationCount,
  };

  return {
    ...evidence,
    evidenceHash: sha256Evidence(evidence),
  };
}

const identityFields = new Set([
  'ID',
  'comment_ID',
  'comment_parent',
  'comment_post_ID',
  'driver',
  'key',
  'meta_key',
  'meta_id',
  'object_id',
  'option_name',
  'pluginOwner',
  'policySource',
  'post_author',
  'post_id',
  'post_parent',
  'resourceKey',
  'term_id',
  'term_taxonomy_id',
  'type',
  'umeta_id',
  'user_id',
]);

function collectPrivateStrings(value, output = new Set(), key = '') {
  if (value === ABSENT || value === undefined || value === null) {
    return output;
  }
  if (typeof value === 'string') {
    if (isPrivateValueString(value, key)) {
      output.add(value);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPrivateStrings(item, output, key);
    }
    return output;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (identityFields.has(childKey)) {
        continue;
      }
      collectPrivateStrings(childValue, output, childKey);
    }
  }
  return output;
}

function isPrivateValueString(value, key) {
  if (identityFields.has(key)) {
    return false;
  }
  if (value.length < 10) {
    return false;
  }
  if (sha256HexPattern.test(value) || value.startsWith('sha256:')) {
    return false;
  }
  if (value.startsWith('row:[') || value.startsWith('file:') || value.startsWith('plugin:')) {
    return false;
  }
  return /base|bulk|comment|file|generated|independent|local|option|post|private|ready|remote|rpp|secret|stale|term|token|user/i.test(value);
}

function privateValuesForPlan(testCase, plan, extraValues = []) {
  const values = new Set(extraValues);
  for (const mutation of plan.mutations) {
    collectPrivateStrings(deserializeResourceValue(mutation.value), values);
    collectPrivateStrings(getResource(testCase.base, mutation.resource), values);
    collectPrivateStrings(getResource(testCase.local, mutation.resource), values);
    collectPrivateStrings(getResource(testCase.remote, mutation.resource), values);
  }
  for (const decision of plan.decisions) {
    collectPrivateStrings(getResource(testCase.base, decision.resource), values);
    collectPrivateStrings(getResource(testCase.local, decision.resource), values);
    collectPrivateStrings(getResource(testCase.remote, decision.resource), values);
  }
  return [...values].sort();
}

function assertSerializedEvidenceRedacted(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(
      serialized.includes(privateValue),
      false,
      `${label} leaked raw private value ${privateValue}`,
    );
  }
}

function assertEveryMutationHasLiveRemotePrecondition(testCase, plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${testCase.id} precondition count mismatch`);
  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${testCase.id} duplicate precondition ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }
  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
  }
}

function forgePrivateValueForResource(resource, current, rawValue) {
  if (resource.type === 'file') {
    return { type: 'file', content: rawValue };
  }
  if (resource.type === 'plugin') {
    return {
      ...(current && current !== ABSENT && typeof current === 'object' ? current : {}),
      version: `9.9.9-${rawValue}`,
      active: true,
    };
  }
  if (current && current !== ABSENT && typeof current === 'object') {
    if (resource.table === 'wp_posts') {
      return { ...current, post_title: rawValue };
    }
    if (resource.table === 'wp_comments') {
      return { ...current, comment_content: rawValue };
    }
    if (resource.table === 'wp_options') {
      return {
        ...current,
        option_value: current.option_value && typeof current.option_value === 'object'
          ? { ...current.option_value, rpp0258PrivateValue: rawValue }
          : rawValue,
      };
    }
    if (Object.hasOwn(current, 'meta_value')) {
      return { ...current, meta_value: rawValue };
    }
    if (Object.hasOwn(current, 'name')) {
      return { ...current, name: rawValue };
    }
    return { ...current, rpp0258PrivateValue: rawValue };
  }
  return { rpp0258PrivateValue: rawValue };
}

function forgePrivatePayload(testCase, mutation, rawValue) {
  return forgePrivateValueForResource(
    mutation.resource,
    getResource(testCase.local, mutation.resource),
    rawValue,
  );
}

function setStalePrivateRemoteValue(remote, mutation, rawValue) {
  const current = getResource(remote, mutation.resource);
  setResource(
    remote,
    mutation.resource,
    forgePrivateValueForResource(mutation.resource, current, rawValue),
  );
}

function firstMutation(plan) {
  const mutation = plan.mutations[0];
  assert.ok(mutation, 'generated ready candidate must have at least one mutation');
  return mutation;
}

test('RPP-0258 generated forged ready plan defenses keep serialized evidence hash-only, variant 3', () => {
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('ready-candidate'));
  const coverage = {
    target: 'forgedReadyPlanDefenseVariant3',
    total: generatedCases.length,
    perTier: {},
    families: {},
    statuses: {},
    forgedIssueCodes: {},
  };

  assert.equal(generatedCases.length, 170, 'expected generated ready-candidate coverage set');

  for (const testCase of generatedCases) {
    const plan = planFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const targetMutation = firstMutation(plan);
    const rawForgedHash = `rpp0258-${testCase.id}-forged-raw-private-hash-material`;
    const rawForgedPayload = `rpp0258-${testCase.id}-forged-raw-private-payload`;
    const rawStaleValue = `rpp0258-${testCase.id}-stale-live-remote-private-value`;
    const privateValues = privateValuesForPlan(testCase, plan, [
      rawForgedHash,
      rawForgedPayload,
      rawStaleValue,
    ]);

    increment(coverage.perTier, testCase.tier);
    increment(coverage.families, testCase.family);
    increment(coverage.statuses, plan.status);

    assert.equal(plan.status, 'ready', `${testCase.id} should be ready`);
    assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary`);
    assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary`);
    assert.equal(plan.summary.conflicts, 0, `${testCase.id} ready candidate conflicts`);
    assert.equal(plan.summary.blockers, 0, `${testCase.id} ready candidate blockers`);
    assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic summary`);
    assert.equal(validation.status, 'ready', `${testCase.id} generated validation status`);
    assert.equal(validation.applied, true, `${testCase.id} generated validation apply`);
    assert.equal(validation.unplannedRemotePreserved, true, `${testCase.id} generated validation preservation`);
    assert.equal(validation.staleReplayRejected, true, `${testCase.id} generated validation stale rejection`);
    assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assertEveryMutationHasLiveRemotePrecondition(testCase, plan);

    assertSerializedEvidenceRedacted(
      hashOnlyPlanEvidence({
        label: 'ready generated baseline',
        testCase,
        plan,
        remoteBefore: testCase.remote,
        remoteAfter: testCase.remote,
      }),
      privateValues,
      `${testCase.id} ready baseline`,
    );

    const forgedMissingPrecondition = tamperReadyPlan(plan, (copy) => {
      const mutation = copy.mutations.find((entry) => entry.id === targetMutation.id);
      mutation.remoteBeforeHash = rawForgedHash;
      copy.preconditions = copy.preconditions.filter(
        (precondition) => precondition.mutationId !== targetMutation.id,
      );
    });
    const missingRemote = cloneJson(testCase.remote);
    const missingBefore = cloneJson(missingRemote);
    const missingBeforeHash = digest(missingRemote);
    const missingEvents = [];
    let missingAppliedMutations = 0;
    const missingError = captureError(() => {
      const result = applyPlan(missingRemote, forgedMissingPrecondition, {
        mutateRemote: true,
        durableJournal: claimOpenedDurableJournal(missingEvents),
      });
      missingAppliedMutations = result.appliedMutations;
    });

    assert.ok(missingError instanceof PushPlanError, `${testCase.id} missing precondition error`);
    assert.equal(missingError.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(issueCodes(missingError).includes('REMOTE_BEFORE_HASH_INVALID'));
    assert.ok(issueCodes(missingError).includes('MISSING_LIVE_REMOTE_PRECONDITION'));
    increment(coverage.forgedIssueCodes, 'REMOTE_BEFORE_HASH_INVALID');
    increment(coverage.forgedIssueCodes, 'MISSING_LIVE_REMOTE_PRECONDITION');
    assert.equal(digest(missingRemote), missingBeforeHash, `${testCase.id} missing precondition mutated remote`);
    assert.deepEqual(missingRemote, missingBefore, `${testCase.id} missing precondition changed remote`);
    assert.equal(missingAppliedMutations, 0);
    assert.deepEqual(missingEvents, [], `${testCase.id} missing precondition wrote durable events`);
    assertSerializedEvidenceRedacted(
      hashOnlyPlanEvidence({
        label: 'missing precondition with raw private hash',
        testCase,
        plan: forgedMissingPrecondition,
        error: missingError,
        journalEvents: missingEvents,
        remoteBefore: missingBefore,
        remoteAfter: missingRemote,
        appliedMutationCount: missingAppliedMutations,
      }),
      privateValues,
      `${testCase.id} missing precondition evidence`,
    );
    assertSerializedEvidenceRedacted(missingError.details, privateValues, `${testCase.id} missing details`);

    const forgedDuplicatePrecondition = tamperReadyPlan(plan, (copy) => {
      const precondition = copy.preconditions.find((entry) => entry.mutationId === targetMutation.id);
      copy.preconditions.push(cloneJson(precondition));
    });
    const duplicateRemote = cloneJson(testCase.remote);
    const duplicateBefore = cloneJson(duplicateRemote);
    const duplicateBeforeHash = digest(duplicateRemote);
    const duplicateEvents = [];
    let duplicateAppliedMutations = 0;
    const duplicateError = captureError(() => {
      const result = applyPlan(duplicateRemote, forgedDuplicatePrecondition, {
        mutateRemote: true,
        durableJournal: claimOpenedDurableJournal(duplicateEvents),
      });
      duplicateAppliedMutations = result.appliedMutations;
    });

    assert.ok(duplicateError instanceof PushPlanError, `${testCase.id} duplicate precondition error`);
    assert.equal(duplicateError.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(issueCodes(duplicateError).includes('DUPLICATE_LIVE_REMOTE_PRECONDITION'));
    increment(coverage.forgedIssueCodes, 'DUPLICATE_LIVE_REMOTE_PRECONDITION');
    assert.equal(digest(duplicateRemote), duplicateBeforeHash, `${testCase.id} duplicate precondition mutated remote`);
    assert.deepEqual(duplicateRemote, duplicateBefore, `${testCase.id} duplicate precondition changed remote`);
    assert.equal(duplicateAppliedMutations, 0);
    assert.deepEqual(duplicateEvents, [], `${testCase.id} duplicate precondition wrote durable events`);
    assertSerializedEvidenceRedacted(
      hashOnlyPlanEvidence({
        label: 'duplicate live remote precondition',
        testCase,
        plan: forgedDuplicatePrecondition,
        error: duplicateError,
        journalEvents: duplicateEvents,
        remoteBefore: duplicateBefore,
        remoteAfter: duplicateRemote,
        appliedMutationCount: duplicateAppliedMutations,
      }),
      privateValues,
      `${testCase.id} duplicate precondition evidence`,
    );
    assertSerializedEvidenceRedacted(duplicateError.details, privateValues, `${testCase.id} duplicate details`);

    const forgedPayloadPlan = tamperReadyPlan(plan, (copy) => {
      const mutation = copy.mutations.find((entry) => entry.id === targetMutation.id);
      mutation.value = serializeResourceValue(forgePrivatePayload(testCase, targetMutation, rawForgedPayload));
    });
    const payloadRemote = cloneJson(testCase.remote);
    const payloadBefore = cloneJson(payloadRemote);
    const payloadBeforeHash = digest(payloadRemote);
    const payloadEvents = [];
    let payloadAppliedMutations = 0;
    const payloadError = captureError(() => {
      const result = applyPlan(payloadRemote, forgedPayloadPlan, {
        mutateRemote: true,
        durableJournal: claimOpenedDurableJournal(payloadEvents),
      });
      payloadAppliedMutations = result.appliedMutations;
    });

    assert.ok(payloadError instanceof PushPlanError, `${testCase.id} forged payload error`);
    assert.equal(payloadError.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(issueCodes(payloadError).includes('LOCAL_HASH_MISMATCH'));
    increment(coverage.forgedIssueCodes, 'LOCAL_HASH_MISMATCH');
    assert.equal(digest(payloadRemote), payloadBeforeHash, `${testCase.id} forged payload mutated remote`);
    assert.deepEqual(payloadRemote, payloadBefore, `${testCase.id} forged payload changed remote`);
    assert.equal(payloadAppliedMutations, 0);
    assert.deepEqual(payloadEvents, [], `${testCase.id} forged payload wrote durable events`);
    assertSerializedEvidenceRedacted(
      hashOnlyPlanEvidence({
        label: 'raw private forged payload',
        testCase,
        plan: forgedPayloadPlan,
        error: payloadError,
        journalEvents: payloadEvents,
        remoteBefore: payloadBefore,
        remoteAfter: payloadRemote,
        appliedMutationCount: payloadAppliedMutations,
      }),
      privateValues,
      `${testCase.id} forged payload evidence`,
    );
    assertSerializedEvidenceRedacted(payloadError.details, privateValues, `${testCase.id} payload details`);

    const staleRemote = cloneJson(testCase.remote);
    setStalePrivateRemoteValue(staleRemote, targetMutation, rawStaleValue);
    const staleActualHash = resourceHash(staleRemote, targetMutation.resource);
    const staleBefore = cloneJson(staleRemote);
    const staleBeforeHash = digest(staleRemote);
    const staleEvents = [];
    let staleAppliedMutations = 0;

    assert.notEqual(staleActualHash, targetMutation.remoteBeforeHash, `${testCase.id} stale fixture did not drift`);

    const staleError = captureError(() => {
      const result = applyPlan(staleRemote, plan, {
        mutateRemote: true,
        durableJournal: claimOpenedDurableJournal(staleEvents),
      });
      staleAppliedMutations = result.appliedMutations;
    });

    assert.ok(staleError instanceof PushPlanError, `${testCase.id} stale error`);
    assert.equal(staleError.code, 'PRECONDITION_FAILED');
    assert.equal(staleError.details.resourceKey, targetMutation.resourceKey);
    assert.equal(staleError.details.expectedHash, targetMutation.remoteBeforeHash);
    assert.equal(staleError.details.actualHash, staleActualHash);
    assert.equal(digest(staleRemote), staleBeforeHash, `${testCase.id} stale apply mutated remote`);
    assert.deepEqual(staleRemote, staleBefore, `${testCase.id} stale apply changed remote`);
    assert.equal(staleAppliedMutations, 0);
    assert.deepEqual(staleEvents, [], `${testCase.id} stale apply wrote durable events`);
    assertSerializedEvidenceRedacted(
      hashOnlyPlanEvidence({
        label: 'stale live remote private value',
        testCase,
        plan,
        error: staleError,
        journalEvents: staleEvents,
        remoteBefore: staleBefore,
        remoteAfter: staleRemote,
        appliedMutationCount: staleAppliedMutations,
      }),
      privateValues,
      `${testCase.id} stale evidence`,
    );
    assertSerializedEvidenceRedacted(staleError.details, privateValues, `${testCase.id} stale details`);
  }

  assert.deepEqual(coverage.perTier, expectedReadyCandidateTierCounts);
  assert.equal(Object.keys(coverage.families).length, 18, 'expected broad generated family coverage');
  assert.deepEqual(coverage.statuses, { ready: 170 });
  assert.deepEqual(coverage.forgedIssueCodes, {
    DUPLICATE_LIVE_REMOTE_PRECONDITION: 170,
    LOCAL_HASH_MISMATCH: 170,
    MISSING_LIVE_REMOTE_PRECONDITION: 170,
    REMOTE_BEFORE_HASH_INVALID: 170,
  });
  assertSerializedEvidenceRedacted(coverage, ['raw-private'], 'coverage summary');
});
