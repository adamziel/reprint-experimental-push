import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const targetCoverageKey = 'pluginOwnedResourceRefusalVariant3';
const variantTag = 'plugin-owned-resource-refusal-v3-changed';
const targetOptionPrefix = 'rpp0143_plugin_owned_refusal_v3_changed_';
const privateSentinelPrefixes = [
  'rpp0143-changed-base-private-token',
  'rpp0143-changed-local-private-token',
  'rpp0143-changed-remote-private-token',
];

test('RPP-0248 generated unknown plugin-owned resource refusal variant 3 keeps plan evidence hash-only', () => {
  const first = buildRpp0248GeneratedEvidence();
  const replay = buildRpp0248GeneratedEvidence();

  assert.deepEqual(first.evidence, replay.evidence, 'RPP-0248 generated refusal evidence should be deterministic');
  assert.ok(first.rawPrivateValues.length >= 20, 'generated changed cases should expose base/local private sentinels');

  const evidenceEnvelope = {
    command: 'node --test test/rpp-0248-unknown-plugin-owned-resource-refusal-v3.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(first.evidence)}`,
    evidence: first.evidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assertNoRawPrivateValues(evidenceText, first.rawPrivateValues, 'RPP-0248 aggregate evidence');
  for (const prefix of privateSentinelPrefixes) {
    assert.equal(evidenceText.includes(prefix), false, `RPP-0248 aggregate evidence leaked ${prefix}`);
  }
});

function buildRpp0248GeneratedEvidence() {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[targetCoverageKey];

  assert.ok(coverage, 'missing plugin-owned resource refusal variant 3 target coverage');
  assert.equal(coverage.family, 'plugin-owned-resource-refusal-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-resource-refusal-v3']);
  assert.deepEqual(coverage.statuses, { blocked: 10, conflict: 10, ready: 10 });
  assert.equal(report.summary.featureFamilies[variantTag], 10);

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(variantTag));
  const perTier = {};
  const statuses = {};
  const rawPrivateValues = new Set();
  const caseProofs = [];

  assert.equal(cases.length, 10, 'variant 3 changed sub-surface should include one unknown refusal per tier');
  assert.equal(cases.length, coverage.statuses.blocked, 'changed cases should account for blocked target coverage');

  for (const testCase of cases) {
    const result = validateGeneratedCase(testCase);
    const { evidence, privateValues } = rpp0248CaseEvidence(testCase, result);

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    caseProofs.push(evidence);
    for (const value of privateValues) {
      rawPrivateValues.add(value);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const rawPrivateValueList = [...rawPrivateValues].sort();
  const reportText = JSON.stringify(report);

  assert.deepEqual(sortedPerTier, Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1])));
  assert.deepEqual(sortedStatuses, { blocked: 10 });
  assertNoRawPrivateValues(reportText, rawPrivateValueList, 'serialized generated harness report');

  return {
    evidence: {
      target: targetCoverageKey,
      family: coverage.family,
      variant: 'changed',
      tag: variantTag,
      requirement: 'unknown-plugin-owned-resource-refusal',
      evidenceScope: 'local-generated-model',
      productionBacked: false,
      releaseGate: 'NO-GO',
      targetCoverage: {
        total: coverage.total,
        statuses: coverage.statuses,
        perTier: coverage.perTier,
      },
      generatedUnknownRefusals: cases.length,
      generatedUnknownRefusalsPerTier: sortedPerTier,
      generatedUnknownRefusalStatuses: sortedStatuses,
      changedFeatureCount: report.summary.featureFamilies[variantTag],
      blockerClass: 'unsupported-plugin-owned-resource',
      reasonCode: 'UNKNOWN_PLUGIN_OWNED_RESOURCE',
      rawValuesIncluded: false,
      caseProofs,
      proofHash: `sha256:${digest({
        target: targetCoverageKey,
        variantTag,
        sortedPerTier,
        sortedStatuses,
        caseProofs,
      })}`,
    },
    rawPrivateValues: rawPrivateValueList,
  };
}

function rpp0248CaseEvidence(testCase, result) {
  assert.equal(result.status, 'blocked', `${testCase.id} changed variant should validate as blocked`);
  assert.equal(result.applied, false, `${testCase.id} changed variant must not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} changed variant should preserve remote`);

  const shape = assertRpp0248ChangedTargetShape(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const targetBlocker = plan.blockers.find((blocker) => blocker.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);
  const privateValues = uniquePrivateValues(shape);

  assert.equal(plan.status, 'blocked', `${testCase.id} target plan should be blocked`);
  assert.ok(targetBlocker, `${testCase.id} should block the unknown plugin-owned target`);
  assert.equal(targetBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(targetBlocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(targetBlocker.pluginOwner, 'forms');
  assert.equal(targetBlocker.driver, null);
  assert.equal(plannedMutation, false, `${testCase.id} must not plan a target mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} must not precondition a blocked target`);

  assertUnknownPluginOwnedRefusalEvidence(testCase, targetBlocker);

  const serializedPlanEvidence = {
    status: plan.status,
    summary: plan.summary,
    blockers: plan.blockers,
    conflicts: plan.conflicts,
    decisions: plan.decisions,
    mutations: plan.mutations,
    preconditions: plan.preconditions,
  };
  const serializedPlanEvidenceText = JSON.stringify(serializedPlanEvidence);
  assertNoRawPrivateValues(serializedPlanEvidenceText, privateValues, `${testCase.id} serialized plan evidence`);

  const applyRefusal = assertBlockedPlanApplyRefusal(testCase, plan, privateValues);
  const refusalEvidence = targetBlocker.unknownPluginOwnedResourceRefusalEvidence;
  const resourceHashes = {
    baseHash: resourceHash(testCase.base, shape.resource),
    localHash: resourceHash(testCase.local, shape.resource),
    remoteHash: resourceHash(testCase.remote, shape.resource),
  };

  assert.deepEqual(refusalEvidence.hashes, resourceHashes);
  assert.deepEqual(resourceHashes, {
    baseHash: targetBlocker.baseHash,
    localHash: targetBlocker.localHash,
    remoteHash: targetBlocker.remoteHash,
  });

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    resourceKey: shape.resourceKey,
    pluginOwner: targetBlocker.pluginOwner,
    targetChange: {
      localChange: targetBlocker.change.localChange,
      remoteChange: targetBlocker.change.remoteChange,
    },
    hashes: resourceHashes,
    plannedMutation,
    plannedPrecondition,
    targetBlocker: {
      class: targetBlocker.class,
      reasonCode: targetBlocker.reasonCode,
      driver: targetBlocker.driver,
      policySource: targetBlocker.policySource,
      blockerHash: `sha256:${digest(targetBlocker)}`,
      refusalEvidenceHash: `sha256:${digest(refusalEvidence)}`,
      refusalEvidence: {
        operation: refusalEvidence.operation,
        outcome: refusalEvidence.outcome,
        format: refusalEvidence.format,
        rawValuesIncluded: refusalEvidence.rawValuesIncluded,
        hashes: refusalEvidence.hashes,
      },
    },
    planEvidenceHash: `sha256:${digest(serializedPlanEvidence)}`,
    applyRefusal,
  };

  assertNoRawPrivateValues(JSON.stringify(evidence), privateValues, `${testCase.id} returned case evidence`);

  return {
    evidence: {
      ...evidence,
      modelProofHash: `sha256:${digest(evidence)}`,
    },
    privateValues,
  };
}

function assertRpp0248ChangedTargetShape(testCase) {
  assert.ok(testCase.tags.has('plugin-owned-resource-refusal-v3'));
  assert.ok(testCase.tags.has(variantTag));

  const matches = Object.entries(testCase.local.db.wp_options || {})
    .filter(([, row]) => row?.option_name?.startsWith(targetOptionPrefix));

  assert.equal(matches.length, 1, `${testCase.id} should expose one generated changed target option`);

  const [rowId, localRow] = matches[0];
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];
  const resource = { type: 'row', table: 'wp_options', id: rowId };
  const resourceKey = generatedRowResourceKey('wp_options', rowId);
  const allowedPolicies = [
    ...(testCase.base.meta?.pluginOwnedResources?.allowedResources || []),
    ...(testCase.local.meta?.pluginOwnedResources?.allowedResources || []),
    ...(testCase.remote.meta?.pluginOwnedResources?.allowedResources || []),
  ].filter((entry) => entry.resourceKey === resourceKey && entry.pluginOwner === 'forms');

  assert.ok(baseRow, `${testCase.id} should seed a base target row`);
  assert.ok(remoteRow, `${testCase.id} should seed a remote target row`);
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.notDeepEqual(localRow, baseRow, `${testCase.id} local target should change`);
  assert.deepEqual(remoteRow, baseRow, `${testCase.id} remote target should remain at base`);
  assert.equal(allowedPolicies.length, 0, `${testCase.id} changed target must have no supported driver policy`);

  return {
    resource,
    resourceKey,
    rowId,
    baseRow,
    localRow,
    remoteRow,
  };
}

function assertUnknownPluginOwnedRefusalEvidence(testCase, blocker) {
  const evidence = blocker.unknownPluginOwnedResourceRefusalEvidence;

  assert.ok(evidence, `${testCase.id} blocker should carry unknown plugin-owned refusal evidence`);
  assert.equal(evidence.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(evidence.operation, 'planner-refusal');
  assert.equal(evidence.outcome, 'blocked-before-mutation');
  assert.equal(evidence.format, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.resourceKey, blocker.resourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, null);
  assert.equal(evidence.policySource, null);
  assert.deepEqual(evidence.hashes, {
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
  });

  for (const side of ['base', 'local', 'remote']) {
    assert.equal(
      Object.hasOwn(evidence.change[side], 'value'),
      false,
      `${testCase.id} ${side} refusal evidence should be hash-only`,
    );
    assert.match(evidence.change[side].hash, /^[a-f0-9]{64}$/);
  }
}

function assertBlockedPlanApplyRefusal(testCase, plan, privateValues) {
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));
  const remoteAfterHash = digest(remote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} blocked plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} blocked plan apply mutated remote`);
  assertNoRawPrivateValues(JSON.stringify(error.details || {}), privateValues, `${testCase.id} apply refusal details`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details || {})}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function uniquePrivateValues(shape) {
  return [...new Set([
    shape.baseRow.option_value?.privateToken,
    shape.localRow.option_value?.privateToken,
    shape.remoteRow.option_value?.privateToken,
  ].filter(Boolean))].sort();
}

function assertNoRawPrivateValues(text, privateValues, label) {
  for (const value of privateValues) {
    assert.equal(String(text).includes(value), false, `${label} leaked ${value}`);
  }
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedRowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
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
