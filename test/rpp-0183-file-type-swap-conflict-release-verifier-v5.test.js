import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { enumerateResources, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const target = Object.freeze({
  coverageKey: 'fileTypeSwapConflictReleaseVerifierVariant5',
  family: 'file-type-swap-conflict-release-verifier-v5',
  tag: 'file-type-swap-conflict-release-verifier-v5',
  readyTag: 'file-type-swap-conflict-release-verifier-v5-ready',
  nonReadyTag: 'file-type-swap-conflict-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const expectedStatuses = { conflict: 10, ready: 10 };
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertFileTypeSwapShape(testCase, { conflict }) {
  const marker = conflict ? '/conflict-type-swap-' : '/ready-type-swap-';
  const swapEntries = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory');

  assert.equal(swapEntries.length, 1, `${testCase.id} should seed one type-swap target`);

  const [path] = swapEntries[0];
  assert.deepEqual(testCase.base.files[path], { type: 'directory' });
  assert.deepEqual(testCase.remote.files[path], { type: 'directory' });
  assert.equal(testCase.local.files[path]?.type, 'file', `${testCase.id} local target should become a file`);
  assert.match(testCase.local.files[path]?.content, /^local type swap /);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((remotePath) => remotePath.startsWith(`${path}/`));
  assert.equal(
    remoteDescendants.length,
    conflict ? 1 : 0,
    `${testCase.id} remote descendant presence should match readiness`,
  );

  for (const descendantPath of remoteDescendants) {
    assert.equal(Object.hasOwn(testCase.base.files, descendantPath), false);
    assert.equal(Object.hasOwn(testCase.local.files, descendantPath), false);
  }

  const remoteDescendantResource = remoteDescendants.length > 0
    ? { type: 'file', path: remoteDescendants[0] }
    : null;

  return {
    targetPath: path,
    targetResource: { type: 'file', path },
    targetResourceKey: `file:${path}`,
    remoteDescendantResource,
    remoteDescendantResourceKey: remoteDescendantResource ? `file:${remoteDescendantResource.path}` : null,
  };
}

function surfaceEvidence(testCase, shape) {
  return {
    target: {
      resourceKey: shape.targetResourceKey,
      baseHash: resourceHash(testCase.base, shape.targetResource),
      localHash: resourceHash(testCase.local, shape.targetResource),
      remoteHash: resourceHash(testCase.remote, shape.targetResource),
    },
    remoteDescendant: shape.remoteDescendantResource
      ? {
          resourceKey: shape.remoteDescendantResourceKey,
          baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
          localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
          remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
        }
      : null,
  };
}

function readyTypeSwapEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.targetResourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.targetResourceKey);

  assert.ok(mutation, `${testCase.id} should plan the type-swap mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the type-swap mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'type-change');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  const baseHash = resourceHash(testCase.base, shape.targetResource);
  const localHash = resourceHash(testCase.local, shape.targetResource);
  const remoteHash = resourceHash(testCase.remote, shape.targetResource);
  const appliedHash = resourceHash(applied.site, shape.targetResource);

  assert.equal(remoteHash, mutation.remoteBeforeHash, `${testCase.id} remote hash should match mutation preimage`);
  assert.equal(appliedHash, localHash, `${testCase.id} applied target hash should match local file`);

  return {
    resourceKey: shape.targetResourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function unplannedRemotePreservationEvidence({ testCase, plan, applied }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const samples = [];
  let checkedResources = 0;
  let changedUnplannedRemoteResources = 0;

  for (const resource of enumerateResources(testCase.base, testCase.local, testCase.remote, applied.site)) {
    if (mutationResourceKeys.has(resource.key)) {
      continue;
    }

    assert.equal(
      preconditionResourceKeys.has(resource.key),
      false,
      `${testCase.id} should not precondition unplanned resource ${resource.key}`,
    );

    const baseHash = resourceHash(testCase.base, resource);
    const localHash = resourceHash(testCase.local, resource);
    const remoteHash = resourceHash(testCase.remote, resource);
    const appliedHash = resourceHash(applied.site, resource);

    checkedResources += 1;
    assert.equal(appliedHash, remoteHash, `${testCase.id} overwrote unplanned remote ${resource.key}`);

    if (remoteHash !== baseHash || remoteHash !== localHash) {
      changedUnplannedRemoteResources += 1;
      if (samples.length < 3) {
        samples.push({
          resourceKey: resource.key,
          resourceType: resource.type,
          baseHash,
          localHash,
          remoteHash,
          appliedHash,
          plannedMutation: false,
          plannedPrecondition: false,
        });
      }
    }
  }

  assert.ok(checkedResources > 0, `${testCase.id} should check at least one unplanned resource`);

  return {
    checkedResources,
    changedUnplannedRemoteResources,
    overwrittenResources: 0,
    samples,
    proofHash: `sha256:${digest({ checkedResources, changedUnplannedRemoteResources, samples })}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) =>
    entry.resourceKey === shape.targetResourceKey
      && entry.class === 'file-topology-conflict');
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.targetResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.targetResourceKey);

  assert.ok(conflict, `${testCase.id} should report a type-swap topology conflict`);
  assert.equal(conflict.relatedResourceKey, shape.remoteDescendantResourceKey);
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    relatedResourceKey: conflict.relatedResourceKey,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function remoteDescendantEvidence({ testCase, plan, shape }) {
  assert.ok(shape.remoteDescendantResource, `${testCase.id} should include a remote descendant`);

  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);

  assert.ok(decision, `${testCase.id} should keep the remote descendant`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.remoteDescendantResourceKey,
    decision: decision.decision,
    baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
    localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
    remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
    plannedMutation,
    plannedPrecondition,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function refusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} refusal must not mutate remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function caseEvidence(testCase, result) {
  const conflict = testCase.family === 'file-type-swap-conflict';
  const shape = assertFileTypeSwapShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = surfaceEvidence(testCase, shape);
  const common = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const typeSwap = readyTypeSwapEvidence({ testCase, plan, applied, shape });
    const unplannedRemotePreservation = unplannedRemotePreservationEvidence({ testCase, plan, applied });

    assert.equal(conflict, false, `${testCase.id} ready evidence should come from ready type-swap family`);
    assert.equal(testCase.tags.has(target.readyTag), true);
    assert.equal(plan.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true);

    return {
      ...common,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      typeSwap,
      unplannedRemotePreservation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        typeSwap,
        unplannedRemotePreservation,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready evidence should come from type-swap conflict family`);
  assert.equal(testCase.tags.has(target.nonReadyTag), true);
  assert.notEqual(plan.status, 'ready');
  assert.equal(result.applied, false);

  const conflictProof = conflictEvidence({ testCase, plan, shape });
  const remoteDescendant = remoteDescendantEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...common,
    applied: result.applied,
    conflict: conflictProof,
    remoteDescendant,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictProof,
      remoteDescendant,
      refusal,
    })}`,
  };
}

function generatedFileTypeSwapReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  const totals = {
    readyApplied: 0,
    readyUnplannedRemotePreserved: 0,
    readyWithoutUnplannedRemoteOverwrite: 0,
    readyStaleReplayRejected: 0,
    nonReadyApplyRefused: 0,
    nonReadyRemoteUnchanged: 0,
  };
  let totalCases = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';

    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      if (result.applied) totals.readyApplied += 1;
      if (result.unplannedRemotePreserved) totals.readyUnplannedRemotePreserved += 1;
      if (evidence.unplannedRemotePreservation.overwrittenResources === 0) {
        totals.readyWithoutUnplannedRemoteOverwrite += 1;
      }
      if (
        result.staleReplayRejected
        && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
        && result.staleReplayRemoteUnchanged
      ) {
        totals.readyStaleReplayRejected += 1;
      }

      const selected = selectedCases.get('ready');
      if (
        !selected
        || (
          selected.unplannedRemotePreservation.changedUnplannedRemoteResources === 0
          && evidence.unplannedRemotePreservation.changedUnplannedRemoteResources > 0
        )
      ) {
        selectedCases.set('ready', evidence);
      }
      continue;
    }

    if (evidence.refusal.code === 'PLAN_NOT_READY') totals.nonReadyApplyRefused += 1;
    if (evidence.refusal.remoteBeforeHash === evidence.refusal.remoteAfterHash) {
      totals.nonReadyRemoteUnchanged += 1;
    }
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0183 recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0183 recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0183 recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0183 target should select one ready type-swap');
  assert.ok(selectedCases.has('non-ready'), 'RPP-0183 target should select one descendant conflict');

  return {
    target: target.coverageKey,
    family: coverage.family,
    evidenceScope: 'local-generated-release-verifier',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    totals,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

test('RPP-0183 generated harness summary exposes file type-swap release-verifier v5 per-tier counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const cases = targetCases();
  const readyCase = cases.find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = cases.find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing RPP-0183 file type-swap release-verifier target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0183 type-swap target case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0183 type-swap target case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0183 generated file type-swap release-verifier evidence is hash-only and deterministic', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedFileTypeSwapReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedFileTypeSwapReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js',
    caveat: 'Generated local release-verifier evidence only; release remains gated separately.',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);
  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0183 evidence should be deterministic');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, 20);
  assert.equal(firstEvidence.readyCases, 10);
  assert.equal(firstEvidence.nonReadyCases, 10);
  assert.deepEqual(firstEvidence.perTier, expectedPerTier);
  assert.deepEqual(firstEvidence.statuses, expectedStatuses);
  assert.deepEqual(firstEvidence.totals, {
    readyApplied: 10,
    readyUnplannedRemotePreserved: 10,
    readyWithoutUnplannedRemoteOverwrite: 10,
    readyStaleReplayRejected: 10,
    nonReadyApplyRefused: 10,
    nonReadyRemoteUnchanged: 10,
  });
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);

  assert.equal(readyCase.variant, 'ready');
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.typeSwap.action, 'put');
  assert.equal(readyCase.typeSwap.changeKind, 'type-change');
  assert.equal(readyCase.typeSwap.appliedHash, readyCase.typeSwap.localHash);
  assert.equal(readyCase.unplannedRemotePreservation.overwrittenResources, 0);
  assert.ok(readyCase.unplannedRemotePreservation.checkedResources > 0);
  assert.match(readyCase.typeSwap.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.unplannedRemotePreservation.proofHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.surface.remoteDescendant.resourceKey, nonReadyCase.conflict.relatedResourceKey);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.target.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.conflict.plannedPrecondition, false);
  assert.equal(nonReadyCase.remoteDescendant.decision, 'keep-remote');
  assert.equal(nonReadyCase.remoteDescendant.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('local type swap '), false, 'RPP-0183 evidence leaked local payload');
  assert.equal(evidenceText.includes('remote descendant for type swap '), false, 'RPP-0183 evidence leaked remote payload');
  assert.equal(evidenceText.includes('"content":'), false, 'RPP-0183 evidence must not expose raw content fields');
});
