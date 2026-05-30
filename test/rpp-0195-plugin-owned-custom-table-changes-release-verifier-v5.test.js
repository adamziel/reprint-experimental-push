import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const target = Object.freeze({
  coverageKey: 'pluginOwnedCustomTableChangesReleaseVerifierVariant5',
  family: 'plugin-owned-custom-table-changes-release-verifier-v5',
  tag: 'plugin-owned-custom-table-changes-release-verifier-v5',
  readyTag: 'plugin-owned-custom-table-changes-release-verifier-v5-ready',
  staleTag: 'plugin-owned-custom-table-changes-release-verifier-v5-stale',
  nonReadyTag: 'plugin-owned-custom-table-changes-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1]));
const expectedStatuses = { conflict: 5, ready: 5 };
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

function fileResource(path) {
  return {
    type: 'file',
    path,
    key: `file:${path}`,
  };
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertCustomTableShape(testCase, { staleTarget }) {
  assert.equal(testCase.family, 'plugin-owned-custom-table-changes');
  assert.ok(testCase.tags.has(target.tag));
  assert.equal(testCase.tags.has(target.readyTag), !staleTarget);
  assert.equal(testCase.tags.has(target.staleTag), staleTarget);
  assert.equal(testCase.tags.has(target.nonReadyTag), staleTarget);
  assert.equal(testCase.tags.has('forms-lab-custom-table-ready'), !staleTarget);
  assert.equal(testCase.tags.has('forms-lab-custom-table-stale'), staleTarget);
  assert.ok(testCase.tags.has('plugin-owned-custom-table-target'));
  assert.ok(testCase.tags.has('plugin-owned-custom-table-variant1'));
  assert.ok(testCase.tags.has('plugin-owned-custom-table-variant3'));
  assert.ok(testCase.tags.has('plugin-owned-custom-table-variant4'));
  assert.ok(testCase.tags.has('plugin-owned-custom-table-update'));
  assert.ok(testCase.tags.has('plugin-owned-custom-table-change'));
  assert.ok(testCase.tags.has('forms-lab-supported'));
  assert.ok(testCase.tags.has('plugin-owned-supported'));
  assert.ok(testCase.tags.has('remote-preserve'));

  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([, row]) => row.payload?.generatedHarnessVariant === 'rpp-0115-variant1');
  const remoteOnlyRows = Object.entries(testCase.remote.files)
    .filter(([path]) => path.includes('custom-table-remote-only-')
      && testCase.base.files[path] === undefined
      && testCase.local.files[path] === undefined);

  assert.equal(rows.length, 1, `${testCase.id} should carry one plugin-owned forms-lab custom-table row`);
  assert.equal(remoteOnlyRows.length, 1, `${testCase.id} should carry one custom-table remote-only file`);

  const [rowId, localRow] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];
  const resourceKey = rowResourceKey('wp_reprint_push_forms_lab', rowId);
  const policy = testCase.local.meta.pluginOwnedResources.allowedResources
    .find((entry) => entry.resourceKey === resourceKey);

  assert.ok(baseRow, `${testCase.id} should seed the target row in base`);
  assert.ok(remoteRow, `${testCase.id} should seed the target row in remote`);
  assert.ok(policy, `${testCase.id} should allowlist the exact custom-table row`);
  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use a deterministic positive-id row`);
  assert.equal(policy.pluginOwner, 'forms');
  assert.equal(policy.driver, 'fixture-forms-lab-table');
  assert.equal(policy.table, 'wp_reprint_push_forms_lab');
  assert.equal(policy.supportsDelete === true, false);
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.equal(localRow.payload.owner, 'forms');
  assert.equal(baseRow.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  assert.equal(localRow.payload.mode, 'local');
  assert.equal(baseRow.payload.mode, 'base');
  assert.equal(remoteRow.payload.mode === 'remote-stale', staleTarget);
  assert.match(baseRow.payload.privateToken, /^rpp0135-private-base-/);
  assert.match(localRow.payload.privateToken, /^rpp0135-private-local-/);

  if (staleTarget) {
    assert.notDeepEqual(remoteRow, baseRow, `${testCase.id} stale row should drift remotely`);
    assert.match(remoteRow.payload.privateToken, /^rpp0135-private-remote-/);
  } else {
    assert.deepEqual(remoteRow, baseRow, `${testCase.id} ready remote row should match base`);
  }

  return {
    rowId,
    resourceKey,
    baseRow,
    localRow,
    remoteRow,
    policy,
    remoteOnlyPath: remoteOnlyRows[0][0],
    remoteOnlyContents: remoteOnlyRows[0][1],
    privateValues: [
      baseRow.payload.privateToken,
      localRow.payload.privateToken,
      remoteRow.payload.privateToken,
      localRow.form_slug,
      baseRow.form_slug,
      remoteRow.form_slug,
      remoteOnlyRows[0][1],
    ].filter(Boolean),
  };
}

function assertCustomTableEvidenceRedacted(testCase, shape, plan) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const relatedConflicts = plan.conflicts.filter((conflict) => conflict.resourceKey === shape.resourceKey);
  const redacted = redactEvidence({
    status: plan.status,
    mutations: mutation ? [{
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      pluginOwnedResource: mutation.pluginOwnedResource,
      value: mutation.value,
    }] : [],
    conflicts: relatedConflicts,
  });
  const redactedJson = JSON.stringify(redacted);

  if (mutation) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact mutation values`);
    assert.ok(redactedJson.includes('sha256'), `${testCase.id} redacted evidence should retain hashes`);
  }

  assertCustomTableRawValuesAbsent(testCase, shape, redactedJson);

  return {
    mutationValueRedacted: mutation ? redactedJson.includes(EVIDENCE_REDACTION_MARKER) : null,
    redactedEvidenceHash: `sha256:${digest(redacted)}`,
  };
}

function assertCustomTableRawValuesAbsent(testCase, shape, serialized) {
  const privateValues = [
    ...shape.privateValues,
    'rpp0135-private',
    'privateToken',
    'generated-rpp-0135',
    'Remote preserved custom table note',
    'rpp0195-private-stale',
    'rpp0195-stale-replay',
  ].filter(Boolean).map(String);

  for (const value of privateValues) {
    assert.equal(
      serialized.includes(value),
      false,
      `${testCase.id} custom-table evidence leaked ${value}`,
    );
  }
}

function surfaceEvidence(testCase, shape) {
  const row = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const remoteOnly = fileResource(shape.remoteOnlyPath);

  return {
    row: {
      resourceKey: row.key,
      table: row.table,
      baseHash: resourceHash(testCase.base, row),
      localHash: resourceHash(testCase.local, row),
      remoteHash: resourceHash(testCase.remote, row),
      rowIdHash: `sha256:${digest(shape.rowId)}`,
      formSlugHash: `sha256:${digest(shape.localRow.form_slug)}`,
      localMarkerHash: `sha256:${digest(shape.localRow.updated_marker)}`,
      remoteMarkerHash: `sha256:${digest(shape.remoteRow.updated_marker)}`,
    },
    remoteOnly: {
      resourceKey: remoteOnly.key,
      baseHash: resourceHash(testCase.base, remoteOnly),
      localHash: resourceHash(testCase.local, remoteOnly),
      remoteHash: resourceHash(testCase.remote, remoteOnly),
      pathHash: `sha256:${digest(shape.remoteOnlyPath)}`,
    },
    owner: shape.localRow.__pluginOwner,
    driver: 'fixture-forms-lab-table',
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const localHash = resourceHash(testCase.local, resource);
  const appliedHash = resourceHash(applied.site, resource);

  assert.ok(mutation, `${testCase.id} should plan the plugin-owned custom-table mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the plugin-owned custom-table mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverAuditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverEvidence?.dryRunValidationEvidence?.rawValuesIncluded, false);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply the local custom-table row`);

  return {
    resourceKey: resource.key,
    action: mutation.action,
    changeKind: mutation.changeKind,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    driver: mutation.pluginOwnedResource.driver,
    supportsDelete: mutation.pluginOwnedResource.supportsDelete,
    ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
    ownerContextResourceKeys: mutation.pluginOwnedResource.ownerContext
      .map((entry) => entry.resourceKey)
      .sort(),
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    preconditionCheckedAgainst: precondition.checkedAgainst,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    auditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.auditEvidence)}`,
    driverAuditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverAuditEvidence)}`,
    driverEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverEvidence)}`,
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      driver: mutation.pluginOwnedResource.driver,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionCheckedAgainst: precondition.checkedAgainst,
    })}`,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const driftedRemote = cloneJson(testCase.remote);
  const staleRow = {
    ...shape.remoteRow,
    payload: {
      ...shape.remoteRow.payload,
      mode: 'stale-replay',
      privateToken: `rpp0195-private-stale-token-${testCase.tier}`,
    },
    updated_marker: `rpp0195-stale-replay-${testCase.tier}`,
  };
  let beforeMutationCalls = 0;

  assert.ok(mutation, `${testCase.id} should have a custom-table mutation for stale replay`);
  assert.ok(precondition, `${testCase.id} should have a custom-table precondition for stale replay`);
  setResource(driftedRemote, resource, staleRow);
  const remoteBeforeHash = digest(driftedRemote);
  const actualHash = resourceHash(driftedRemote, resource);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);
  const rowHashAfter = resourceHash(driftedRemote, resource);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale custom-table replay should fail`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details?.resourceKey, resource.key);
  assert.equal(error.details?.expectedHash, precondition.expectedHash);
  assert.equal(error.details?.actualHash, actualHash);
  assert.notEqual(actualHash, precondition.expectedHash);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated the remote`);
  assert.equal(rowHashAfter, actualHash, `${testCase.id} stale replay changed the drifted row`);
  assert.deepEqual(getResource(driftedRemote, resource), staleRow, `${testCase.id} stale replay rewrote the drifted row`);

  return {
    resourceKey: resource.key,
    code: error.code,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    expectedHash: precondition.expectedHash,
    actualHash,
    remoteBeforeHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
    rowHashAfter,
    rowUnchanged: rowHashAfter === actualHash,
    detailsHash: `sha256:${digest(error.details)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function remoteOnlyPreservationEvidence({ testCase, applied, shape }) {
  const remoteOnly = fileResource(shape.remoteOnlyPath);
  const remoteBeforeHash = resourceHash(testCase.remote, remoteOnly);
  const appliedHash = resourceHash(applied.site, remoteOnly);

  assert.equal(appliedHash, remoteBeforeHash, `${testCase.id} overwrote unplanned custom-table remote-only file`);

  return {
    resourceKey: remoteOnly.key,
    remoteBeforeHash,
    appliedHash,
    preserved: true,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resource.key);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === resource.key);

  assert.equal(mutation, undefined, `${testCase.id} should not plan the stale custom-table mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the stale custom-table mutation`);
  assert.ok(conflict, `${testCase.id} should carry custom-table conflict evidence`);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');

  return {
    resourceKey: resource.key,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner,
    resolutionPolicy: conflict.resolutionPolicy,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    plannedMutation: false,
    plannedPrecondition,
    changeHash: `sha256:${digest(conflict.change)}`,
    conflictHash: `sha256:${digest({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      pluginOwner: conflict.pluginOwner,
      resolutionPolicy: conflict.resolutionPolicy,
      change: conflict.change,
    })}`,
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

  assert.ok(error instanceof PushPlanError, `${testCase.id} conflict plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} conflict refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} conflict refusal mutated remote`);

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
  const staleTarget = testCase.tags.has(target.staleTag);
  const shape = assertCustomTableShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const redaction = assertCustomTableEvidenceRedacted(testCase, shape, plan);
  const surface = surfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
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
    const tableMutation = readyMutationEvidence({
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
    const remoteOnlyPreservation = remoteOnlyPreservationEvidence({
      testCase,
      applied,
      shape,
    });

    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale custom-table target`);
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
      tableMutation,
      staleReplay,
      remoteOnlyPreservation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        redaction,
        tableMutation,
        staleReplay,
        remoteOnlyPreservation,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale custom-table target`);
  assert.equal(result.status, 'conflict', `${testCase.id} should validate as conflict`);
  assert.equal(plan.status, 'conflict', `${testCase.id} should plan as conflict`);
  assert.equal(result.applied, false, `${testCase.id} conflict should not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} conflict should leave remote unchanged`);

  const conflict = conflictEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      redaction,
      conflict,
      refusal,
    })}`,
  };
}

function generatedCustomTableReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyStaleReplayRejected = 0;
  let readyStaleReplayBeforeMutation = 0;
  let readyRemoteUnchanged = 0;
  let readyRemoteOnlyPreserved = 0;
  let readyRedacted = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;
  let nonReadyRowsSuppressed = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readyPreconditioned += evidence.tableMutation.plannedPrecondition
        && evidence.tableMutation.preconditionCheckedAgainst === 'live-remote' ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplayRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.beforeMutationCalls === 0 ? 1 : 0;
      readyRemoteUnchanged += evidence.staleReplay.remoteUnchanged && evidence.staleReplay.rowUnchanged ? 1 : 0;
      readyRemoteOnlyPreserved += evidence.remoteOnlyPreservation.preserved ? 1 : 0;
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

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0195 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0195 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0195 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0195 target should select one ready custom-table case');
  assert.ok(selectedCases.has('stale-non-ready'), 'RPP-0195 target should select one stale non-ready custom-table case');

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
      readyRemoteOnlyPreserved,
      readyRedacted,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
      nonReadyRowsSuppressed,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

test('RPP-0195 generated harness summary exposes plugin-owned custom-table release-verifier v5 counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));
  const summaryText = JSON.stringify(report);

  assert.ok(coverage, 'missing plugin-owned custom-table release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 5);
  assert.equal(report.summary.featureFamilies[target.staleTag], 5);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 5);
  assert.ok(readyCase, 'missing ready RPP-0195 plugin-owned custom-table case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0195 plugin-owned custom-table case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
  assert.equal(summaryText.includes('rpp0135-private'), false, 'RPP-0195 summary leaked custom-table private value');
  assert.equal(summaryText.includes('privateToken'), false, 'RPP-0195 summary leaked custom-table private key');
  assert.equal(summaryText.includes('generated-rpp-0135'), false, 'RPP-0195 summary leaked custom-table slug');
  assert.equal(
    summaryText.includes('Remote preserved custom table note'),
    false,
    'RPP-0195 summary leaked remote-only file contents',
  );
});

test('RPP-0195 plugin-owned custom-table release-verifier evidence rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedCustomTableReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedCustomTableReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0195 custom-table evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 5,
    readyPreconditioned: 5,
    readyStaleReplayRejected: 5,
    readyStaleReplayBeforeMutation: 5,
    readyRemoteUnchanged: 5,
    readyRemoteOnlyPreserved: 5,
    readyRedacted: 5,
    nonReadyApplyRefused: 5,
    nonReadyBeforeMutation: 5,
    nonReadyRowsSuppressed: 5,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
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
  assert.equal(readyCase.tableMutation.action, 'put');
  assert.equal(readyCase.tableMutation.changeKind, 'update');
  assert.equal(readyCase.tableMutation.pluginOwner, 'forms');
  assert.equal(readyCase.tableMutation.driver, 'fixture-forms-lab-table');
  assert.equal(readyCase.tableMutation.supportsDelete, false);
  assert.equal(readyCase.tableMutation.ownerContextRequired, true);
  assert.equal(readyCase.tableMutation.plannedMutation, true);
  assert.equal(readyCase.tableMutation.plannedPrecondition, true);
  assert.equal(readyCase.tableMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(readyCase.tableMutation.appliedHash, readyCase.surface.row.localHash);
  assert.equal(readyCase.tableMutation.preconditionExpectedHash, readyCase.tableMutation.remoteBeforeHash);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.appliedHash, readyCase.surface.remoteOnly.remoteHash);
  assert.equal(readyCase.redaction.mutationValueRedacted, true);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.row.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.tableMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleReplay.remoteUnchanged, true);
  assert.equal(readyCase.staleReplay.rowUnchanged, true);
  assert.match(readyCase.tableMutation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.tableMutation.driverAuditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.tableMutation.driverEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.tableMutation.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.staleReplay.detailsHash, sha256EvidencePattern);
  assert.match(readyCase.staleReplay.preconditionHash, sha256EvidencePattern);
  assert.match(readyCase.redaction.redactedEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(conflictCase.tags.includes(target.staleTag));
  assert.ok(conflictCase.tags.includes(target.nonReadyTag));
  assert.equal(conflictCase.status, 'conflict');
  assert.equal(conflictCase.applied, false);
  assert.equal(conflictCase.conflict.resourceKey, conflictCase.surface.row.resourceKey);
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
  assert.equal(evidenceText.includes('rpp0135-private'), false, 'RPP-0195 evidence leaked custom-table private value');
  assert.equal(evidenceText.includes('privateToken'), false, 'RPP-0195 evidence leaked custom-table private key');
  assert.equal(evidenceText.includes('generated-rpp-0135'), false, 'RPP-0195 evidence leaked custom-table slug');
  assert.equal(evidenceText.includes('Remote preserved custom table note'), false, 'RPP-0195 evidence leaked remote-only file contents');
  assert.equal(evidenceText.includes('rpp0195-private-stale'), false, 'RPP-0195 evidence leaked stale replay private value');
  assert.equal(evidenceText.includes('rpp0195-stale-replay'), false, 'RPP-0195 evidence leaked stale replay marker');
});
