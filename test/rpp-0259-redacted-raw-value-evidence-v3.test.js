import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  EVIDENCE_REDACTION_MARKER,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const generatedTargets = Object.freeze([
  {
    label: 'serialized-options',
    tag: 'wp-options-serialized-v3',
    expectedStatuses: { conflict: 10, ready: 10 },
  },
  {
    label: 'wp-posts',
    tag: 'wp-posts-create-update-delete-v3',
    expectedStatuses: { conflict: 10, ready: 10 },
  },
  {
    label: 'plugin-owned-options',
    tag: 'plugin-owned-option-change-v3',
    expectedStatuses: { conflict: 10, ready: 10 },
  },
  {
    label: 'users-usermeta-graph',
    tag: 'wp-users-usermeta-graph-v3',
    expectedStatuses: { blocked: 3, conflict: 7, ready: 10 },
  },
]);

const privateNeedlePatterns = Object.freeze([
  /private/i,
  /auth[_-]?token/i,
  /token/i,
  /user_pass/i,
  /generated create content/i,
  /generated update content/i,
  /base update content/i,
  /base delete content/i,
  /remote concurrent wp_posts update/i,
  /Generated wp_posts/i,
  /Base wp_posts/i,
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
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
    now: fixedNow,
  });
}

function expectedPerTier() {
  return Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1;
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

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '9'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function redactedDescriptor(value, label) {
  assert.equal(value.redacted, true, `${label} must be redacted`);
  assert.equal(value.redaction, EVIDENCE_REDACTION_MARKER, `${label} redaction marker`);
  assert.equal(value.reason, 'raw-site-value-field', `${label} redaction reason`);
  assert.match(value.sha256, sha256HexPattern, `${label} digest`);
  assert.equal(Object.hasOwn(value, 'value'), false, `${label} must not carry raw value`);
  return {
    redaction: value.redaction,
    reason: value.reason,
    sha256: value.sha256,
    valueType: value.valueType,
  };
}

function collectRawNeedles(value, needles = new Set()) {
  if (typeof value === 'string') {
    if (privateNeedlePatterns.some((pattern) => pattern.test(value))) {
      needles.add(value);
    }
    return needles;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRawNeedles(item, needles);
    }
    return needles;
  }
  if (!value || typeof value !== 'object') {
    return needles;
  }
  for (const [key, child] of Object.entries(value)) {
    if (privateNeedlePatterns.some((pattern) => pattern.test(key))) {
      needles.add(key);
    }
    collectRawNeedles(child, needles);
  }
  return needles;
}

function serializedIncludes(serialized, needle) {
  return serialized.includes(needle) || serialized.includes(JSON.stringify(needle).slice(1, -1));
}

function assertNoRawNeedles(serialized, needles, label) {
  for (const needle of needles) {
    assert.equal(serializedIncludes(serialized, needle), false, `${label} leaked ${needle}`);
  }
}

function targetCoverageReport(target) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(target.tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, { testCase, result });
    }
  }

  return {
    target,
    totalCases,
    perTier: sortNumericObject(perTier),
    statuses: sortStringObject(statuses),
    selectedCases,
  };
}

function staleRemoteFor(testCase, plan) {
  const staleRemote = cloneJson(testCase.remote);
  const firstMutation = plan.mutations[0];
  const plannedValue = deserializeResourceValue(firstMutation.value);
  const staleValue = plannedValue && typeof plannedValue === 'object' && !Array.isArray(plannedValue)
    ? {
      ...cloneJson(plannedValue),
      rpp0259StalePrivateMarker: `rpp0259-stale-private-generated-${testCase.id}`,
    }
    : { rpp0259StalePrivateMarker: `rpp0259-stale-private-generated-${testCase.id}` };

  setResource(staleRemote, firstMutation.resource, staleValue);
  return staleRemote;
}

function readyCaseEvidence(testCase, result) {
  const plan = planFor(testCase);
  assert.equal(plan.status, 'ready', `${testCase.id} should be ready`);
  assert.equal(result.status, 'ready', `${testCase.id} generated validation status`);
  assert.equal(plan.preconditions.length, plan.mutations.length, `${testCase.id} precondition count`);
  assert.ok(plan.mutations.length > 0, `${testCase.id} should have generated mutations`);

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }

  const stagedRemote = cloneJson(testCase.remote);
  const journalError = captureError(() => applyPlan(stagedRemote, plan, { failAfterStaging: true }));
  assert.ok(journalError instanceof PushPlanError);
  assert.equal(journalError.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assert.equal(journalError.details.recovery.artifacts.journal.status, 'staged');
  assert.equal(journalError.details.recovery.artifacts.journal.entries.length, plan.mutations.length);

  const staleRemote = staleRemoteFor(testCase, plan);
  const staleBeforeHash = digest(staleRemote);
  const staleEvents = [];
  const staleError = captureError(() => applyPlan(staleRemote, plan, {
    durableJournal: durableJournal(staleEvents),
  }));
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(digest(staleRemote), staleBeforeHash, `${testCase.id} stale replay mutated the remote`);
  assert.deepEqual(staleEvents.map((event) => event.type), ['recovery-claim-opened']);

  const rawNeedles = Array.from(collectRawNeedles({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
  }));
  const rawEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    generatedResult: result,
    plan,
    staleRefusal: {
      code: staleError.code,
      details: staleError.details,
      detailsHash: sha256Evidence(staleError.details),
      remoteBeforeHash: staleBeforeHash,
      remoteAfterHash: digest(staleRemote),
      durableJournalEventTypes: staleEvents.map((event) => event.type),
    },
    journalFailure: {
      code: journalError.code,
      detailsHash: sha256Evidence(journalError.details),
      journal: journalError.details.recovery.artifacts.journal,
    },
  };
  const rawSerialized = JSON.stringify(rawEvidence);
  const exercisedNeedles = rawNeedles.filter((needle) => serializedIncludes(rawSerialized, needle));
  assert.ok(exercisedNeedles.length > 0, `${testCase.id} should exercise raw generated values before redaction`);
  assert.ok(findEvidenceRedactionIssues(rawEvidence).length > 0, `${testCase.id} raw evidence should report issues`);

  const redactedEvidence = redactEvidence(rawEvidence);
  const redactedSerialized = JSON.stringify(redactedEvidence);
  assert.deepEqual(findEvidenceRedactionIssues(redactedEvidence), []);
  assertNoRawNeedles(redactedSerialized, rawNeedles, `${testCase.id} redacted ready evidence`);
  assertNoRawNeedles(JSON.stringify(staleError.details), rawNeedles, `${testCase.id} stale refusal details`);
  assertNoRawNeedles(JSON.stringify(journalError.details), rawNeedles, `${testCase.id} journal details`);

  const mutationValueProofs = redactedEvidence.plan.mutations.map((mutation) => ({
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    value: redactedDescriptor(mutation.value, `${testCase.id} ${mutation.resourceKey} mutation value`),
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    mutationHash: sha256Evidence(mutation),
  }));
  const journalValueProofs = redactedEvidence.journalFailure.journal.entries.map((entry) => ({
    resourceKey: entry.resourceKey,
    beforeValue: redactedDescriptor(entry.beforeValue, `${testCase.id} ${entry.resourceKey} journal beforeValue`),
    afterValue: redactedDescriptor(entry.afterValue, `${testCase.id} ${entry.resourceKey} journal afterValue`),
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    journalEntryHash: sha256Evidence(entry),
  }));

  for (const proof of mutationValueProofs) {
    assert.match(proof.baseHash, sha256HexPattern);
    assert.match(proof.localHash, sha256HexPattern);
    assert.match(proof.remoteBeforeHash, sha256HexPattern);
    assert.match(proof.mutationHash, sha256EvidencePattern);
  }
  for (const proof of journalValueProofs) {
    assert.match(proof.beforeHash, sha256HexPattern);
    assert.match(proof.afterHash, sha256HexPattern);
    assert.match(proof.journalEntryHash, sha256EvidencePattern);
  }

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    exercisedRawNeedles: exercisedNeedles.length,
    redactionIssueCountBefore: findEvidenceRedactionIssues(rawEvidence).length,
    redactionIssueCountAfter: findEvidenceRedactionIssues(redactedEvidence).length,
    mutationValueProofs,
    journalValueProofs,
    staleRefusal: {
      code: staleError.code,
      resourceKey: staleError.details.resourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      remoteBeforeHash: staleBeforeHash,
      remoteAfterHash: digest(staleRemote),
      durableJournalEventTypes: staleEvents.map((event) => event.type),
    },
    proofHash: sha256Evidence(redactedEvidence),
  };
}

function nonReadyCaseEvidence(testCase, result) {
  const plan = planFor(testCase);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should be non-ready`);
  assert.equal(result.status, plan.status, `${testCase.id} generated validation status`);

  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const refusal = captureError(() => applyPlan(remoteBefore, plan));
  assert.ok(refusal instanceof PushPlanError);
  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), remoteBeforeHash, `${testCase.id} non-ready apply mutated remote`);

  const rawNeedles = Array.from(collectRawNeedles({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
  }));
  const rawEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    generatedResult: result,
    summary: plan.summary,
    mutations: plan.mutations,
    preconditions: plan.preconditions,
    conflicts: plan.conflicts,
    blockers: plan.blockers,
    decisions: plan.decisions,
    refusal: {
      code: refusal.code,
      details: refusal.details,
      detailsHash: sha256Evidence(refusal.details),
      remoteBeforeHash,
      remoteAfterHash: digest(remoteBefore),
    },
  };

  const redactedEvidence = redactEvidence(rawEvidence);
  const redactedSerialized = JSON.stringify(redactedEvidence);
  const redactionIssueCountBefore = findEvidenceRedactionIssues(rawEvidence).length;
  const redactionIssueCountAfter = findEvidenceRedactionIssues(redactedEvidence).length;
  assert.deepEqual(findEvidenceRedactionIssues(redactedEvidence), []);
  assertNoRawNeedles(redactedSerialized, rawNeedles, `${testCase.id} redacted non-ready evidence`);
  assertNoRawNeedles(JSON.stringify(refusal.details), rawNeedles, `${testCase.id} refusal details`);

  const mutationValueProofs = redactedEvidence.mutations.map((mutation) => ({
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    value: redactedDescriptor(mutation.value, `${testCase.id} ${mutation.resourceKey} non-ready mutation value`),
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    mutationHash: sha256Evidence(mutation),
  }));

  for (const proof of mutationValueProofs) {
    assert.match(proof.baseHash, sha256HexPattern);
    assert.match(proof.localHash, sha256HexPattern);
    assert.match(proof.remoteBeforeHash, sha256HexPattern);
    assert.match(proof.mutationHash, sha256EvidencePattern);
  }

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    summary: plan.summary,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    redactionIssueCountBefore,
    redactionIssueCountAfter,
    mutationValueProofs,
    conflictCount: plan.conflicts.length,
    blockerCount: plan.blockers.length,
    decisionCount: plan.decisions.length,
    refusal: {
      code: refusal.code,
      detailsHash: sha256Evidence(refusal.details),
      remoteBeforeHash,
      remoteAfterHash: digest(remoteBefore),
    },
    proofHash: sha256Evidence(redactedEvidence),
  };
}

function generatedRawValueCoverageEvidence() {
  const targetReports = generatedTargets.map(targetCoverageReport);
  const selectedEvidence = [];

  for (const report of targetReports) {
    assert.equal(report.totalCases, 20, `${report.target.label} generated case count`);
    assert.deepEqual(report.perTier, expectedPerTier(), `${report.target.label} per-tier coverage`);
    assert.deepEqual(report.statuses, report.target.expectedStatuses, `${report.target.label} status coverage`);
    assert.ok(report.selectedCases.has('ready'), `${report.target.label} selected ready case`);
    assert.ok(report.selectedCases.has('non-ready'), `${report.target.label} selected non-ready case`);

    const ready = report.selectedCases.get('ready');
    const nonReady = report.selectedCases.get('non-ready');
    selectedEvidence.push({
      target: report.target.label,
      variant: 'ready',
      evidence: readyCaseEvidence(ready.testCase, ready.result),
    });
    selectedEvidence.push({
      target: report.target.label,
      variant: 'non-ready',
      evidence: nonReadyCaseEvidence(nonReady.testCase, nonReady.result),
    });
  }

  const evidence = {
    behavior: 'RPP-0259 redacted raw value evidence variant 3 generated coverage',
    command: 'node --test --test-name-pattern=RPP-0259 test/rpp-0259-redacted-raw-value-evidence-v3.test.js',
    evidenceScope: 'local-generated-harness-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalGeneratedCases: targetReports.reduce((sum, report) => sum + report.totalCases, 0),
    targetCoverage: Object.fromEntries(targetReports.map((report) => [
      report.target.label,
      {
        tag: report.target.tag,
        totalCases: report.totalCases,
        perTier: report.perTier,
        statuses: report.statuses,
      },
    ])),
    selectedEvidence,
  };

  return {
    ...evidence,
    modelProofHash: sha256Evidence(evidence),
  };
}

test('RPP-0259 redacted raw value evidence variant 3 generated cases keep proof hash-only', () => {
  const firstEvidence = generatedRawValueCoverageEvidence();
  const replayEvidence = generatedRawValueCoverageEvidence();
  const serializedEvidence = JSON.stringify(firstEvidence);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated redaction evidence should be deterministic');
  assert.equal(firstEvidence.totalGeneratedCases, 80);
  assert.match(firstEvidence.modelProofHash, sha256EvidencePattern);
  assert.deepEqual(
    Object.keys(firstEvidence.targetCoverage),
    ['serialized-options', 'wp-posts', 'plugin-owned-options', 'users-usermeta-graph'],
  );

  for (const target of Object.values(firstEvidence.targetCoverage)) {
    assert.equal(target.totalCases, 20);
    assert.deepEqual(target.perTier, expectedPerTier());
  }
  for (const entry of firstEvidence.selectedEvidence) {
    assert.match(entry.evidence.proofHash, sha256EvidencePattern);
    if (entry.variant === 'ready') {
      assert.equal(entry.evidence.status, 'ready');
      assert.ok(entry.evidence.mutationCount > 0);
      assert.equal(entry.evidence.preconditionCount, entry.evidence.mutationCount);
      assert.ok(entry.evidence.exercisedRawNeedles > 0);
      assert.ok(entry.evidence.redactionIssueCountBefore > 0);
      assert.equal(entry.evidence.redactionIssueCountAfter, 0);
      assert.equal(entry.evidence.staleRefusal.code, 'PRECONDITION_FAILED');
      assert.equal(entry.evidence.staleRefusal.remoteAfterHash, entry.evidence.staleRefusal.remoteBeforeHash);
      assert.deepEqual(entry.evidence.staleRefusal.durableJournalEventTypes, ['recovery-claim-opened']);
    } else {
      assert.notEqual(entry.evidence.status, 'ready');
      assert.equal(entry.evidence.refusal.code, 'PLAN_NOT_READY');
      assert.equal(entry.evidence.refusal.remoteAfterHash, entry.evidence.refusal.remoteBeforeHash);
    }
  }

  assert.equal(serializedEvidence.includes(EVIDENCE_REDACTION_MARKER), true);
  assert.equal(serializedEvidence.includes('private-token'), false);
  assert.equal(serializedEvidence.includes('private_notes'), false);
  assert.equal(serializedEvidence.includes('auth_token'), false);
  assert.equal(serializedEvidence.includes('generated-private-user-pass'), false);
  assert.equal(serializedEvidence.includes('local-private-usermeta-token'), false);
  assert.equal(serializedEvidence.includes('Generated wp_posts create'), false);
  assert.equal(serializedEvidence.includes('generated create content'), false);
});
