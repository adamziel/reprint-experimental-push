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
const target = Object.freeze({
  coverageKey: 'directoryDescendantConflictReleaseVerifierVariant5',
  family: 'directory-descendant-conflict-release-verifier-v5',
  tag: 'directory-descendant-release-verifier-v5',
  readyTag: 'directory-descendant-release-verifier-v5-ready',
  nonReadyTag: 'directory-descendant-release-verifier-v5-non-ready',
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

function assertDirectoryDescendantShape(testCase, { conflict }) {
  const marker = conflict ? '/descendant-' : '/descendant-ready-';
  const directories = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory')
    .map(([path]) => path);

  assert.equal(directories.length, 1, `${testCase.id} should seed one directory descendant target`);

  const [directory] = directories;
  assert.equal(Object.hasOwn(testCase.local.files, directory), false, `${testCase.id} should delete locally`);
  assert.equal(testCase.remote.files[directory]?.type, 'directory', `${testCase.id} should keep remote directory`);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((path) => path.startsWith(`${directory}/`));
  assert.equal(remoteDescendants.length > 0, conflict, `${testCase.id} descendant presence should match readiness`);

  for (const path of remoteDescendants) {
    assert.equal(Object.hasOwn(testCase.base.files, path), false, `${testCase.id} descendant must be remote-only`);
    assert.equal(Object.hasOwn(testCase.local.files, path), false, `${testCase.id} descendant must not exist locally`);
  }

  const remoteDescendantResource = remoteDescendants.length > 0
    ? { type: 'file', path: remoteDescendants[0] }
    : null;

  return {
    directory,
    directoryResource: { type: 'file', path: directory },
    directoryResourceKey: `file:${directory}`,
    remoteDescendantResource,
    remoteDescendantResourceKey: remoteDescendantResource ? `file:${remoteDescendantResource.path}` : null,
  };
}

function surfaceEvidence(testCase, shape) {
  return {
    directory: {
      resourceKey: shape.directoryResourceKey,
      baseHash: resourceHash(testCase.base, shape.directoryResource),
      localHash: resourceHash(testCase.local, shape.directoryResource),
      remoteHash: resourceHash(testCase.remote, shape.directoryResource),
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

function readyDirectoryDeleteEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.directoryResourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.directoryResourceKey);

  assert.ok(mutation, `${testCase.id} should plan directory delete`);
  assert.ok(precondition, `${testCase.id} should precondition directory delete`);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(Object.hasOwn(applied.site.files, shape.directory), false, `${testCase.id} should delete directory`);

  const localHash = resourceHash(testCase.local, shape.directoryResource);
  const appliedHash = resourceHash(applied.site, shape.directoryResource);
  assert.equal(appliedHash, localHash, `${testCase.id} applied directory hash should match local deletion`);

  return {
    resourceKey: shape.directoryResourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    appliedHash,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.directoryResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.directoryResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.directoryResourceKey);

  assert.ok(conflict, `${testCase.id} should report directory topology conflict`);
  assert.equal(conflict.class, 'file-topology-conflict');
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
  assert.ok(shape.remoteDescendantResource, `${testCase.id} should include remote descendant`);

  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);

  assert.ok(decision, `${testCase.id} should keep remote descendant`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.remoteDescendantResourceKey,
    decision: decision.decision,
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
  const conflict = testCase.family === 'directory-descendant-conflict';
  const shape = assertDirectoryDescendantShape(testCase, { conflict });
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
    const directoryDelete = readyDirectoryDeleteEvidence({ testCase, plan, applied, shape });

    assert.equal(conflict, false, `${testCase.id} ready evidence should come from ready directory target`);
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
      directoryDelete,
      modelProofHash: `sha256:${digest({ id: testCase.id, status: result.status, surface, directoryDelete })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready evidence should come from descendant conflict family`);
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
      surface,
      conflict: conflictProof,
      remoteDescendant,
      refusal,
    })}`,
  };
}

function generatedDirectoryDescendantReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';

    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0182 recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0182 recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0182 recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0182 target should select one ready directory delete');
  assert.ok(selectedCases.has('non-ready'), 'RPP-0182 target should select one descendant conflict');

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
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

test('RPP-0182 generated harness summary exposes directory descendant release-verifier v5 per-tier counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const cases = targetCases();
  const readyCase = cases.find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = cases.find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing RPP-0182 directory descendant release-verifier target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0182 directory descendant target case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0182 directory descendant target case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0182 generated directory descendant release-verifier evidence is hash-only and deterministic', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedDirectoryDescendantReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedDirectoryDescendantReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0182-directory-descendant-conflict-release-verifier-v5.test.js',
    caveat: 'Generated local release-verifier evidence only; release remains gated separately.',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);
  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0182 evidence should be deterministic');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, 20);
  assert.equal(firstEvidence.readyCases, 10);
  assert.equal(firstEvidence.nonReadyCases, 10);
  assert.deepEqual(firstEvidence.perTier, expectedPerTier);
  assert.deepEqual(firstEvidence.statuses, expectedStatuses);
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);

  assert.equal(readyCase.variant, 'ready');
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.directoryDelete.action, 'delete');
  assert.equal(readyCase.directoryDelete.changeKind, 'delete');
  assert.equal(readyCase.directoryDelete.appliedHash, readyCase.directoryDelete.localHash);
  assert.match(readyCase.directoryDelete.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.surface.remoteDescendant.resourceKey, nonReadyCase.conflict.relatedResourceKey);
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
  assert.equal(evidenceText.includes('remote descendant '), false, 'RPP-0182 evidence leaked remote payload');
  assert.equal(evidenceText.includes('"content":'), false, 'RPP-0182 evidence must not expose raw content fields');
});
