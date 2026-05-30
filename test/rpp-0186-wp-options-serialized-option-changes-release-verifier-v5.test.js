import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const target = Object.freeze({
  coverageKey: 'wpOptionsSerializedChangesReleaseVerifierVariant5',
  family: 'wp-options-serialized-release-verifier-v5',
  tag: 'wp-options-serialized-release-verifier-v5',
  readyTag: 'wp-options-serialized-release-verifier-v5-ready',
  nonReadyTag: 'wp-options-serialized-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const expectedStatuses = { conflict: 10, ready: 10 };
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

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

function incrementCount(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
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

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function isSerializedOptionValue(value) {
  return typeof value === 'string'
    && /^a:\d+:{/.test(value)
    && value.includes('private_notes')
    && value.includes('auth_token');
}

function phpSerializeStringMap(entries) {
  const fields = Object.entries(entries);
  return `a:${fields.length}:{${
    fields
      .map(([key, value]) => {
        const stringValue = String(value);
        return `s:${key.length}:"${key}";s:${stringValue.length}:"${stringValue}";`;
      })
      .join('')
  }}`;
}

function serializedValueKind(value) {
  const match = String(value).match(/s:5:"shape";s:(?:5|6):"(object|array)";/);
  assert.ok(match, 'serialized option value should record object or array shape');
  return match[1];
}

function assertSerializedShape(testCase, { conflict = false } = {}) {
  const serializedRows = Object.entries(testCase.base.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_serialized_')
      && isSerializedOptionValue(row.option_value));

  assert.equal(serializedRows.length, 1, `${testCase.id} should seed one serialized option row`);
  const [rowId, baseRow] = serializedRows[0];
  const localRow = testCase.local.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];
  const valueKind = serializedValueKind(baseRow.option_value);

  assert.ok(localRow, `${testCase.id} missing local serialized option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote serialized option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(baseRow.autoload, 'no');
  assert.equal(localRow.option_name, baseRow.option_name);
  assert.equal(serializedValueKind(localRow.option_value), valueKind);
  assert.ok(isSerializedOptionValue(localRow.option_value), `${testCase.id} local option_value must stay serialized`);
  assert.notEqual(localRow.option_value, baseRow.option_value, `${testCase.id} local serialized option should change`);

  if (conflict) {
    assert.equal(serializedValueKind(remoteRow.option_value), valueKind);
    assert.notEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote serialized option should drift`);
    assert.notEqual(remoteRow.option_value, localRow.option_value, `${testCase.id} remote drift should differ from local`);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote serialized option should stay at base`);
  }

  return {
    rowId,
    resource: rowResource('wp_options', rowId),
    resourceKey: rowResourceKey('wp_options', rowId),
    valueKind,
    autoload: baseRow.autoload,
    baseRow,
    localRow,
    remoteRow,
  };
}

function assertRawValuesAbsent(testCase, shape, serializedEvidence) {
  for (const row of [shape.baseRow, shape.localRow, shape.remoteRow]) {
    assert.equal(
      serializedEvidence.includes(row.option_value),
      false,
      `${testCase.id} evidence leaked serialized option payload`,
    );
  }
  assert.equal(serializedEvidence.includes('base-private-serialized'), false, `${testCase.id} leaked base private value`);
  assert.equal(serializedEvidence.includes('local-private-serialized'), false, `${testCase.id} leaked local private value`);
  assert.equal(serializedEvidence.includes('remote-private-serialized'), false, `${testCase.id} leaked remote private value`);
  assert.equal(serializedEvidence.includes('base-token-'), false, `${testCase.id} leaked base token value`);
  assert.equal(serializedEvidence.includes('local-token-'), false, `${testCase.id} leaked local token value`);
  assert.equal(serializedEvidence.includes('remote-token-'), false, `${testCase.id} leaked remote token value`);
  assert.equal(serializedEvidence.includes('private_notes'), false, `${testCase.id} leaked serialized private key`);
  assert.equal(serializedEvidence.includes('auth_token'), false, `${testCase.id} leaked serialized token key`);
  assert.equal(serializedEvidence.includes('ready-wp-options-serialized'), false, `${testCase.id} leaked ready public label`);
  assert.equal(serializedEvidence.includes('conflict-wp-options-serialized'), false, `${testCase.id} leaked conflict public label`);
  assert.equal(serializedEvidence.includes('rpp-0186-stale-private'), false, `${testCase.id} leaked stale replay private value`);
  assert.equal(serializedEvidence.includes('rpp-0186-stale-token'), false, `${testCase.id} leaked stale replay token value`);
}

function surfaceEvidence(testCase, shape) {
  return {
    option: {
      resourceKey: shape.resourceKey,
      baseHash: resourceHash(testCase.base, shape.resource),
      localHash: resourceHash(testCase.local, shape.resource),
      remoteHash: resourceHash(testCase.remote, shape.resource),
      valueKind: shape.valueKind,
      autoload: shape.autoload,
      pluginOwned: false,
      evidenceMode: 'hash-only',
    },
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.resourceKey);
  const localHash = resourceHash(testCase.local, shape.resource);
  const appliedHash = resourceHash(applied.site, shape.resource);

  assert.ok(mutation, `${testCase.id} should plan a serialized option mutation for ${shape.resourceKey}`);
  assert.ok(precondition, `${testCase.id} should precondition ${shape.resourceKey}`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply local serialized option value`);

  const redactedEvidence = redactEvidence({ mutation: { value: mutation.value } });
  const redactedValue = redactedEvidence.mutation.value;
  const redactedJson = JSON.stringify(redactedEvidence);

  assert.equal(redactedValue.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(redactedValue.sha256, /^[a-f0-9]{64}$/);
  assertRawValuesAbsent(testCase, shape, redactedJson);

  return {
    resourceKey: shape.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    redactedValue: {
      redaction: redactedValue.redaction,
      sha256: redactedValue.sha256,
      valueType: redactedValue.valueType,
    },
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      redactedValueSha256: redactedValue.sha256,
    })}`,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const driftedRemote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(driftedRemote);
  let beforeMutationCalls = 0;

  driftedRemote.db.wp_options[shape.rowId].option_value = phpSerializeStringMap({
    shape: shape.valueKind,
    mode: 'stale',
    public_label: 'rpp-0186-stale-label',
    private_notes: 'rpp-0186-stale-private',
    auth_token: 'rpp-0186-stale-token',
  });

  const staleRemoteHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale replay should refuse apply`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.notEqual(staleRemoteHash, remoteBeforeHash, `${testCase.id} stale remote should drift before replay`);
  assert.equal(remoteAfterHash, staleRemoteHash, `${testCase.id} stale replay refusal mutated remote`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);

  return {
    code: error.code,
    resourceKey: error.details?.resourceKey,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    staleRemoteHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === staleRemoteHash,
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);
  const redactedConflict = redactEvidence({ conflict });

  assert.ok(conflict, `${testCase.id} should report a serialized option conflict for ${shape.resourceKey}`);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted serialized option mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the conflicted serialized option row`);
  assertRawValuesAbsent(testCase, shape, JSON.stringify(redactedConflict));

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: redactedConflict.conflict.change,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(redactedConflict.conflict)}`,
  };
}

function refusalEvidence(testCase, plan, shape) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remoteBefore);
  const redactedDetails = redactEvidence(error.details);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} non-ready refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);
  assertRawValuesAbsent(testCase, shape, JSON.stringify(redactedDetails));

  return {
    code: error.code,
    detailsHash: `sha256:${digest(redactedDetails)}`,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function caseEvidence(testCase, result) {
  const conflict = result.status !== 'ready';
  const shape = assertSerializedShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = surfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    valueKind: shape.valueKind,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const serializedMutation = readyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = staleReplayEvidence({
      testCase,
      plan,
      shape,
    });
    const evidence = {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      serializedMutation,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        serializedMutation,
        staleReplay,
      })}`,
    };

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);
    assertRawValuesAbsent(testCase, shape, JSON.stringify(evidence));
    return evidence;
  }

  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictProof = conflictEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan, shape);
  const evidence = {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictProof,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictProof,
      refusal,
    })}`,
  };
  assertRawValuesAbsent(testCase, shape, JSON.stringify(evidence));
  return evidence;
}

function generatedSerializedReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyStaleReplayRejected = 0;
  let readyStaleReplayBeforeMutation = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplayRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.beforeMutationCalls === 0 ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0186 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0186 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0186 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0186 target should select one ready serialized option case');
  assert.ok(selectedCases.has('non-ready'), 'RPP-0186 target should select one non-ready serialized option case');

  return {
    target: target.coverageKey,
    family: coverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    aggregate: {
      readyApplied,
      readyStaleReplayRejected,
      readyStaleReplayBeforeMutation,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

test('RPP-0186 generated harness summary exposes wp_options serialized release-verifier v5 per-tier counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing wp_options serialized release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0186 serialized option case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0186 serialized option case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0186 generated serialized option release-verifier evidence remains redacted', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedSerializedReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedSerializedReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0186 serialized option evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 10,
    readyStaleReplayRejected: 10,
    readyStaleReplayBeforeMutation: 10,
    nonReadyApplyRefused: 10,
    nonReadyBeforeMutation: 10,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.serializedMutation.action, 'put');
  assert.equal(readyCase.serializedMutation.changeKind, 'update');
  assert.equal(readyCase.serializedMutation.plannedMutation, true);
  assert.equal(readyCase.serializedMutation.plannedPrecondition, true);
  assert.equal(readyCase.serializedMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(readyCase.serializedMutation.preconditionExpectedHash, readyCase.serializedMutation.remoteBeforeHash);
  assert.equal(readyCase.serializedMutation.redactedValue.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(readyCase.serializedMutation.redactedValue.sha256, /^[a-f0-9]{64}$/);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.option.resourceKey);
  assert.equal(readyCase.staleReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleReplay.remoteUnchanged, true);
  assert.match(readyCase.serializedMutation.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.staleReplay.detailsHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.option.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'row-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.conflict.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.beforeMutationCalls, 0);
  assert.equal(nonReadyCase.refusal.preMutationRefusal, true);
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, sha256EvidencePattern);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('base-private-serialized'), false, 'RPP-0186 evidence leaked base serialized payload');
  assert.equal(evidenceText.includes('local-private-serialized'), false, 'RPP-0186 evidence leaked local serialized payload');
  assert.equal(evidenceText.includes('remote-private-serialized'), false, 'RPP-0186 evidence leaked remote serialized payload');
  assert.equal(evidenceText.includes('ready-wp-options-serialized'), false, 'RPP-0186 evidence leaked ready serialized public label');
  assert.equal(evidenceText.includes('conflict-wp-options-serialized'), false, 'RPP-0186 evidence leaked conflict serialized public label');
  assert.equal(evidenceText.includes('private_notes'), false, 'RPP-0186 evidence leaked serialized private key');
  assert.equal(evidenceText.includes('auth_token'), false, 'RPP-0186 evidence leaked serialized token key');
  assert.equal(evidenceText.includes('rpp-0186-stale-private'), false, 'RPP-0186 evidence leaked stale replay private value');
  assert.equal(evidenceText.includes('rpp-0186-stale-token'), false, 'RPP-0186 evidence leaked stale replay token value');
});
