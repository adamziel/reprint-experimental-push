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

function expectedPerTier() {
  return Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
}

function assertDirectoryDeleteDescendantShape(testCase, { conflict }) {
  const marker = conflict ? '/descendant-' : '/descendant-ready-';
  const directories = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory')
    .map(([path]) => path);

  assert.equal(directories.length, 1, `${testCase.id} should seed one generated directory-delete target`);

  const [directory] = directories;
  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((path) => path.startsWith(`${directory}/`));

  assert.equal(Object.hasOwn(testCase.local.files, directory), false, `${testCase.id} should delete the directory locally`);
  assert.equal(testCase.remote.files[directory]?.type, 'directory', `${testCase.id} should keep the live remote directory`);
  assert.equal(
    remoteDescendants.length > 0,
    conflict,
    `${testCase.id} remote descendant shape should match the expected readiness`,
  );

  for (const descendantPath of remoteDescendants) {
    assert.equal(
      Object.hasOwn(testCase.base.files, descendantPath),
      false,
      `${testCase.id} remote descendant should not exist in base`,
    );
    assert.equal(
      Object.hasOwn(testCase.local.files, descendantPath),
      false,
      `${testCase.id} remote descendant should be remote-only`,
    );
  }

  const remoteDescendantPath = remoteDescendants[0] || null;

  return {
    directory,
    directoryResource: { type: 'file', path: directory },
    directoryResourceKey: `file:${directory}`,
    remoteDescendantPath,
    remoteDescendantResource: remoteDescendantPath ? { type: 'file', path: remoteDescendantPath } : null,
    remoteDescendantResourceKey: remoteDescendantPath ? `file:${remoteDescendantPath}` : null,
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

function preconditionForMutation(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function mutationForResource(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionForResource(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function selectedVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.tags.has('directory-descendant-v3-non-ready');
  const shape = assertDirectoryDeleteDescendantShape(testCase, { conflict });
  const plan = planFor(testCase);
  const surface = {
    directory: {
      resourceKey: shape.directoryResourceKey,
      baseHash: resourceHash(testCase.base, shape.directoryResource),
      localHash: resourceHash(testCase.local, shape.directoryResource),
      remoteHash: resourceHash(testCase.remote, shape.directoryResource),
    },
    remoteDescendant: shape.remoteDescendantResource ? {
      resourceKey: shape.remoteDescendantResourceKey,
      baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
      localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
      remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
    } : null,
  };

  const common = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    variant: conflict ? 'non-ready' : 'ready',
    planSummary: plan.summary,
    surface,
  };

  if (!conflict) {
    assert.equal(testCase.tags.has('directory-descendant-v3-ready'), true);
    assert.equal(result.status, 'ready');
    assert.equal(plan.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true);
    assert.equal(shape.remoteDescendantResource, null);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const mutation = mutationForResource(plan, shape.directoryResourceKey);
    assert.ok(mutation, `${testCase.id} should plan the ready directory delete`);
    assert.equal(mutation.action, 'delete');
    assert.equal(mutation.changeKind, 'delete');

    const precondition = preconditionForMutation(plan, mutation);
    assert.ok(precondition, `${testCase.id} should precondition the ready directory delete`);
    assert.equal(precondition.resourceKey, shape.directoryResourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, shape.directoryResource));
    assert.equal(Object.hasOwn(applied.site.files, shape.directory), false, `${testCase.id} apply should remove the directory`);
    assert.equal(
      resourceHash(applied.site, shape.directoryResource),
      resourceHash(testCase.local, shape.directoryResource),
      `${testCase.id} applied directory hash should match local deletion`,
    );

    return {
      ...common,
      applied: true,
      unplannedRemotePreserved: true,
      staleReplayRejected: true,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: true,
      directoryDelete: {
        resourceKey: shape.directoryResourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        mutationRemoteBeforeHash: mutation.remoteBeforeHash,
        preconditionExpectedHash: precondition.expectedHash,
        mutationHash: `sha256:${digest(mutation)}`,
        preconditionHash: `sha256:${digest(precondition)}`,
      },
    };
  }

  assert.equal(testCase.tags.has('directory-descendant-v3-non-ready'), true);
  assert.equal(testCase.family, 'directory-descendant-conflict');
  assert.equal(result.status, 'conflict');
  assert.equal(plan.status, 'conflict');
  assert.equal(result.applied, false);
  assert.equal(result.nonReadyRemoteUnchanged, true);

  const conflictEntry = plan.conflicts.find((entry) => entry.resourceKey === shape.directoryResourceKey);
  assert.ok(conflictEntry, `${testCase.id} should report the unsafe directory delete as a conflict`);
  assert.equal(conflictEntry.class, 'file-topology-conflict');
  assert.equal(conflictEntry.relatedResourceKey, shape.remoteDescendantResourceKey);
  assert.equal(mutationForResource(plan, shape.directoryResourceKey), undefined, 'unsafe directory delete should not emit a mutation');
  assert.equal(preconditionForResource(plan, shape.directoryResourceKey), undefined, 'unsafe directory delete should not emit a precondition');

  const remoteDescendantDecision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  assert.ok(remoteDescendantDecision, `${testCase.id} should keep the live remote descendant`);
  assert.equal(remoteDescendantDecision.decision, 'keep-remote');
  assert.equal(mutationForResource(plan, shape.remoteDescendantResourceKey), undefined, 'remote descendant should not emit a mutation');
  assert.equal(preconditionForResource(plan, shape.remoteDescendantResourceKey), undefined, 'remote descendant should not emit a precondition');

  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const refusal = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  assert.ok(refusal instanceof PushPlanError);
  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} conflict apply should not mutate remote`);

  return {
    ...common,
    applied: false,
    conflict: {
      resourceKey: conflictEntry.resourceKey,
      class: conflictEntry.class,
      relatedResourceKey: conflictEntry.relatedResourceKey,
      plannedMutation: false,
      plannedPrecondition: false,
      conflictHash: `sha256:${digest(conflictEntry)}`,
    },
    remoteDescendant: {
      resourceKey: shape.remoteDescendantResourceKey,
      decision: remoteDescendantDecision.decision,
      baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
      localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
      remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
      plannedMutation: false,
      plannedPrecondition: false,
      decisionHash: `sha256:${digest(remoteDescendantDecision)}`,
    },
    refusal: {
      code: refusal.code,
      detailsHash: `sha256:${digest(refusal.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
  };
}

function generatedCoverageEvidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('directory-descendant-v3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const selectedKey = testCase.tags.has('directory-descendant-v3-ready') ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, selectedVariant3CaseEvidence(testCase, result));
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready directory delete case');
  assert.ok(selectedCases.has('non-ready'), 'variant 3 target should select one remote descendant conflict case');

  const evidence = {
    target: 'directoryDescendantConflictVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [selectedCases.get('ready'), selectedCases.get('non-ready')],
  };

  return {
    ...evidence,
    modelProofHash: `sha256:${digest(evidence)}`,
  };
}

test('RPP-0244 local directory delete versus remote descendant create variant 3 has generated coverage and hash-only proof', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflictVariant3;

  assert.ok(coverage, 'missing directory descendant conflict variant 3 target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, expectedPerTier());
  assert.equal(report.summary.featureFamilies['directory-descendant-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['directory-descendant-v3-non-ready'], 10);

  const firstEvidence = generatedCoverageEvidence(coverage);
  const replayEvidence = generatedCoverageEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 directory descendant evidence should be deterministic');
  assert.match(firstEvidence.modelProofHash, sha256EvidencePattern);
  assert.equal(firstEvidence.target, 'directoryDescendantConflictVariant3');
  assert.equal(firstEvidence.family, 'directory-descendant-conflict-variant3');
  assert.equal(firstEvidence.totalCases, 20);
  assert.equal(firstEvidence.readyCases, 10);
  assert.equal(firstEvidence.nonReadyCases, 10);
  assert.deepEqual(firstEvidence.perTier, expectedPerTier());
  assert.deepEqual(firstEvidence.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(firstEvidence.selectedCases.map((entry) => entry.variant), ['ready', 'non-ready']);

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.directoryDelete.action, 'delete');
  assert.equal(readyCase.directoryDelete.changeKind, 'delete');
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.match(readyCase.directoryDelete.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.directoryDelete.preconditionHash, sha256EvidencePattern);

  assert.equal(nonReadyCase.status, 'conflict');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.relatedResourceKey, nonReadyCase.remoteDescendant.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.conflict.plannedPrecondition, false);
  assert.equal(nonReadyCase.remoteDescendant.decision, 'keep-remote');
  assert.equal(nonReadyCase.remoteDescendant.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteAfterHash, nonReadyCase.refusal.remoteBeforeHash);
  assert.match(nonReadyCase.conflict.conflictHash, sha256EvidencePattern);
  assert.match(nonReadyCase.remoteDescendant.decisionHash, sha256EvidencePattern);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('remote descendant '), false, 'variant 3 evidence leaked remote descendant payload');
});
