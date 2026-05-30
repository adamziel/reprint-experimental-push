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
  coverageKey: 'pluginOwnedOptionChangeReleaseVerifierVariant5',
  family: 'plugin-owned-option-change-release-verifier-v5',
  tag: 'plugin-owned-option-change-release-verifier-v5',
  readyTag: 'plugin-owned-option-change-release-verifier-v5-ready',
  nonReadyTag: 'plugin-owned-option-change-release-verifier-v5-non-ready',
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

function assertPluginOwnedOptionShape(testCase, { conflict }) {
  assert.ok(testCase.tags.has(target.tag));
  assert.equal(testCase.tags.has(target.readyTag), !conflict);
  assert.equal(testCase.tags.has(target.nonReadyTag), conflict);
  assert.ok(testCase.tags.has('plugin-owned-option-change'));
  assert.ok(testCase.tags.has('plugin-owned-option-update'));
  assert.ok(testCase.tags.has('plugin-owned-supported'));

  const optionRows = Object.entries(testCase.local.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_plugin_owned_option_')
      && row.__pluginOwner === 'forms');

  assert.equal(optionRows.length, 1, `${testCase.id} should include one generated plugin-owned option`);
  const [rowId, localRow] = optionRows[0];
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];
  const resource = rowResource('wp_options', rowId);

  assert.ok(baseRow, `${testCase.id} should have a base plugin-owned option row`);
  assert.ok(remoteRow, `${testCase.id} should have a remote plugin-owned option row`);
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.notDeepEqual(localRow.option_value, baseRow.option_value, `${testCase.id} should update option_value locally`);
  assert.match(baseRow.option_value.private_token, /^base-private-plugin-owned-option-token-/);
  assert.match(baseRow.option_value.private_notes, /^base-private-plugin-owned-option-notes-/);
  assert.match(localRow.option_value.private_token, /^local-private-plugin-owned-option-token-/);
  assert.match(localRow.option_value.private_notes, /^local-private-plugin-owned-option-notes-/);

  if (conflict) {
    assert.notDeepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} should drift remotely`);
    assert.notDeepEqual(remoteRow.option_value, localRow.option_value, `${testCase.id} remote drift should be independent`);
    assert.match(remoteRow.option_value.private_token, /^remote-private-plugin-owned-option-token-/);
    assert.match(remoteRow.option_value.private_notes, /^remote-private-plugin-owned-option-notes-/);
  } else {
    assert.deepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote should match base`);
  }

  return {
    rowId,
    resource,
    resourceKey: resource.key,
    baseRow,
    localRow,
    remoteRow,
  };
}

function assertPluginOwnedOptionEvidenceRedacted(testCase, shape, plan) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const relatedConflicts = plan.conflicts.filter((conflict) => conflict.resourceKey === shape.resourceKey);
  const redacted = redactEvidence({
    status: plan.status,
    mutation: mutation ? {
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      pluginOwnedResource: mutation.pluginOwnedResource,
      value: mutation.value,
    } : null,
    conflicts: relatedConflicts,
  });
  const redactedJson = JSON.stringify(redacted);

  if (mutation) {
    assert.equal(redacted.mutation.value.redaction, EVIDENCE_REDACTION_MARKER);
    assert.ok(redactedJson.includes('sha256'), `${testCase.id} redacted evidence should keep hashes`);
  }
  assertPluginOwnedOptionRawValuesAbsent(testCase, shape, redactedJson);

  return {
    mutationValueRedacted: mutation ? redacted.mutation.value.redaction === EVIDENCE_REDACTION_MARKER : null,
    redactedEvidenceHash: `sha256:${digest(redacted)}`,
  };
}

function assertPluginOwnedOptionRawValuesAbsent(testCase, shape, serialized) {
  const privateValues = [
    shape.baseRow.option_value.private_token,
    shape.baseRow.option_value.private_notes,
    shape.localRow.option_value.private_token,
    shape.localRow.option_value.private_notes,
    shape.remoteRow.option_value.private_token,
    shape.remoteRow.option_value.private_notes,
    shape.baseRow.option_value.token,
    shape.localRow.option_value.token,
    shape.remoteRow.option_value.token,
    'base-private-plugin-owned-option',
    'local-private-plugin-owned-option',
    'remote-private-plugin-owned-option',
    'plugin-owned-option-local-',
    'plugin-owned-option-remote-',
    'private_token',
    'private_notes',
  ].filter(Boolean).map(String);

  for (const value of privateValues) {
    assert.equal(
      serialized.includes(value),
      false,
      `${testCase.id} redacted plugin-owned option evidence leaked ${value}`,
    );
  }
}

function surfaceEvidence(testCase, shape) {
  return {
    option: {
      resourceKey: shape.resourceKey,
      baseHash: resourceHash(testCase.base, shape.resource),
      localHash: resourceHash(testCase.local, shape.resource),
      remoteHash: resourceHash(testCase.remote, shape.resource),
      optionNameHash: `sha256:${digest(shape.localRow.option_name)}`,
      pluginOwner: shape.localRow.__pluginOwner,
      driver: 'wp-option',
    },
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.resourceKey);
  const localHash = resourceHash(testCase.local, shape.resource);
  const appliedHash = resourceHash(applied.site, shape.resource);

  assert.ok(mutation, `${testCase.id} should plan the plugin-owned option mutation`);
  assert.ok(precondition, `${testCase.id} should precondition ${shape.resourceKey}`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverAuditEvidence?.rawValuesIncluded, false);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply local plugin-owned option value`);

  return {
    resourceKey: shape.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    driver: mutation.pluginOwnedResource.driver,
    ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
    supportsDelete: mutation.pluginOwnedResource.supportsDelete,
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    preconditionCheckedAgainst: precondition.checkedAgainst,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    auditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.auditEvidence)}`,
    driverAuditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverAuditEvidence)}`,
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      driver: mutation.pluginOwnedResource.driver,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })}`,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const driftedRemote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(driftedRemote);
  const rowHashBefore = resourceHash(driftedRemote, shape.resource);
  let beforeMutationCalls = 0;

  driftedRemote.db.wp_options[shape.rowId] = {
    ...driftedRemote.db.wp_options[shape.rowId],
    option_value: {
      mode: 'stale-remote-replay',
      token: `rpp0194-stale-replay-token-${testCase.tier}`,
      private_token: `rpp0194-private-stale-token-${testCase.tier}`,
      private_notes: `rpp0194-private-stale-notes-${testCase.tier}`,
    },
  };

  const staleRowHash = resourceHash(driftedRemote, shape.resource);
  const staleRemoteHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);
  const rowHashAfter = resourceHash(driftedRemote, shape.resource);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale replay should refuse apply`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details?.resourceKey, shape.resourceKey);
  assert.equal(error.details?.expectedHash, rowHashBefore);
  assert.equal(error.details?.actualHash, staleRowHash);
  assert.notEqual(staleRowHash, rowHashBefore, `${testCase.id} stale row should drift before replay`);
  assert.notEqual(staleRemoteHash, remoteBeforeHash, `${testCase.id} stale remote should drift before replay`);
  assert.equal(remoteAfterHash, staleRemoteHash, `${testCase.id} stale replay refusal mutated remote`);
  assert.equal(rowHashAfter, staleRowHash, `${testCase.id} stale replay mutated the plugin-owned option row`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);

  return {
    code: error.code,
    resourceKey: error.details?.resourceKey,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    expectedHash: error.details?.expectedHash,
    actualHash: error.details?.actualHash,
    remoteBeforeHash,
    staleRemoteHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === staleRemoteHash,
    rowHashBefore,
    staleRowHash,
    rowHashAfter,
    rowUnchanged: rowHashAfter === staleRowHash,
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);

  assert.ok(conflict, `${testCase.id} should report a plugin-owned option conflict for ${shape.resourceKey}`);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted plugin-owned option mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the conflicted plugin-owned option`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner,
    resolutionPolicy: conflict.resolutionPolicy,
    plannedMutation,
    plannedPrecondition,
    changeHash: `sha256:${digest(conflict.change)}`,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function refusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} non-ready refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function caseEvidence(testCase, result) {
  const conflict = result.status !== 'ready';
  const shape = assertPluginOwnedOptionShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const redaction = assertPluginOwnedOptionEvidenceRedacted(testCase, shape, plan);
  const surface = surfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'conflict-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
    redaction,
  };

  if (result.status === 'ready') {
    let readyBeforeMutationCalls = 0;
    const applied = applyPlan(cloneJson(testCase.remote), plan, {
      beforeMutation() {
        readyBeforeMutationCalls += 1;
      },
    });
    const optionMutation = readyMutationEvidence({
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

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(readyBeforeMutationCalls, plan.mutations.length, `${testCase.id} ready apply should reach every mutation`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      readyBeforeMutationCalls,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      optionMutation,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        redaction,
        optionMutation,
        staleReplay,
      })}`,
    };
  }

  assert.equal(result.status, 'conflict', `${testCase.id} should validate as conflict`);
  assert.equal(plan.status, 'conflict', `${testCase.id} should plan as conflict`);
  assert.equal(result.applied, false, `${testCase.id} conflict should not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} conflict should leave remote unchanged`);

  const conflictProof = conflictEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictProof,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      redaction,
      conflict: conflictProof,
      refusal,
    })}`,
  };
}

function generatedPluginOwnedOptionReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyStaleReplayRejected = 0;
  let readyStaleReplayBeforeMutation = 0;
  let readyRemoteUnchanged = 0;
  let readyRedacted = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;
  let nonReadyRowsSuppressed = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'conflict-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readyPreconditioned += evidence.optionMutation.plannedPrecondition
        && evidence.optionMutation.preconditionCheckedAgainst === 'live-remote' ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplayRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.beforeMutationCalls === 0 ? 1 : 0;
      readyRemoteUnchanged += evidence.staleReplay.remoteUnchanged && evidence.staleReplay.rowUnchanged ? 1 : 0;
      readyRedacted += evidence.redaction.mutationValueRedacted ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
      nonReadyRowsSuppressed += !evidence.conflict.plannedMutation
        && !evidence.conflict.plannedPrecondition ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0194 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0194 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0194 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0194 target should select one ready plugin-owned option case');
  assert.ok(selectedCases.has('conflict-non-ready'), 'RPP-0194 target should select one conflict case');

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
      readyPreconditioned,
      readyStaleReplayRejected,
      readyStaleReplayBeforeMutation,
      readyRemoteUnchanged,
      readyRedacted,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
      nonReadyRowsSuppressed,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('conflict-non-ready'),
    ],
  };
}

test('RPP-0194 generated harness summary exposes plugin-owned option release-verifier v5 counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));
  const summaryText = JSON.stringify(report);

  assert.ok(coverage, 'missing plugin-owned option release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0194 plugin-owned option case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0194 plugin-owned option case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
  assert.equal(summaryText.includes('private-plugin-owned-option'), false, 'RPP-0194 summary leaked private option value');
  assert.equal(summaryText.includes('plugin-owned-option-local-'), false, 'RPP-0194 summary leaked local token value');
  assert.equal(summaryText.includes('plugin-owned-option-remote-'), false, 'RPP-0194 summary leaked remote token value');
});

test('RPP-0194 plugin-owned option release-verifier evidence rejects stale remote replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedPluginOwnedOptionReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedPluginOwnedOptionReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0194-plugin-owned-option-changes-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0194 plugin-owned option evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 10,
    readyPreconditioned: 10,
    readyStaleReplayRejected: 10,
    readyStaleReplayBeforeMutation: 10,
    readyRemoteUnchanged: 10,
    readyRedacted: 10,
    nonReadyApplyRefused: 10,
    nonReadyBeforeMutation: 10,
    nonReadyRowsSuppressed: 10,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'conflict-non-ready'],
  );

  const [readyCase, conflictCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.readyBeforeMutationCalls, readyCase.planSummary.mutations);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.optionMutation.action, 'put');
  assert.equal(readyCase.optionMutation.changeKind, 'update');
  assert.equal(readyCase.optionMutation.pluginOwner, 'forms');
  assert.equal(readyCase.optionMutation.driver, 'wp-option');
  assert.equal(readyCase.optionMutation.ownerContextRequired, true);
  assert.equal(readyCase.optionMutation.supportsDelete, false);
  assert.equal(readyCase.optionMutation.plannedMutation, true);
  assert.equal(readyCase.optionMutation.plannedPrecondition, true);
  assert.equal(readyCase.optionMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(readyCase.optionMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(readyCase.optionMutation.preconditionExpectedHash, readyCase.optionMutation.remoteBeforeHash);
  assert.equal(readyCase.redaction.mutationValueRedacted, true);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.option.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.optionMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleReplay.remoteUnchanged, true);
  assert.equal(readyCase.staleReplay.rowUnchanged, true);
  assert.match(readyCase.optionMutation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.optionMutation.driverAuditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.optionMutation.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.staleReplay.detailsHash, sha256EvidencePattern);
  assert.match(readyCase.redaction.redactedEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(conflictCase.tags.includes(target.nonReadyTag));
  assert.equal(conflictCase.status, 'conflict');
  assert.equal(conflictCase.applied, false);
  assert.equal(conflictCase.conflict.resourceKey, conflictCase.surface.option.resourceKey);
  assert.equal(conflictCase.conflict.class, 'plugin-data-conflict');
  assert.equal(conflictCase.conflict.pluginOwner, 'forms');
  assert.equal(conflictCase.conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(conflictCase.conflict.plannedMutation, false);
  assert.equal(conflictCase.conflict.plannedPrecondition, false);
  assert.equal(conflictCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(conflictCase.refusal.beforeMutationCalls, 0);
  assert.equal(conflictCase.refusal.preMutationRefusal, true);
  assert.equal(conflictCase.refusal.remoteBeforeHash, conflictCase.refusal.remoteAfterHash);
  assert.match(conflictCase.conflict.changeHash, sha256EvidencePattern);
  assert.match(conflictCase.conflict.conflictHash, sha256EvidencePattern);
  assert.match(conflictCase.refusal.detailsHash, sha256EvidencePattern);
  assert.match(conflictCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('base-private-plugin-owned-option'), false, 'RPP-0194 evidence leaked base option value');
  assert.equal(evidenceText.includes('local-private-plugin-owned-option'), false, 'RPP-0194 evidence leaked local option value');
  assert.equal(evidenceText.includes('remote-private-plugin-owned-option'), false, 'RPP-0194 evidence leaked remote option value');
  assert.equal(evidenceText.includes('plugin-owned-option-local-'), false, 'RPP-0194 evidence leaked local token value');
  assert.equal(evidenceText.includes('plugin-owned-option-remote-'), false, 'RPP-0194 evidence leaked remote token value');
  assert.equal(evidenceText.includes('rpp0194-private-stale'), false, 'RPP-0194 evidence leaked stale replay private value');
  assert.equal(evidenceText.includes('rpp0194-stale-replay-token'), false, 'RPP-0194 evidence leaked stale replay token');
  assert.equal(evidenceText.includes('private_token'), false, 'RPP-0194 evidence leaked private token keys');
  assert.equal(evidenceText.includes('private_notes'), false, 'RPP-0194 evidence leaked private note keys');
});
