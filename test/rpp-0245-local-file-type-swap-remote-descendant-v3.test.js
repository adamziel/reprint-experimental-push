import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const command = 'node --test test/rpp-0245-local-file-type-swap-remote-descendant-v3.test.js';
const caveat = 'Generated local/model evidence only; release remains gated separately.';
const target = Object.freeze({
  coverageKey: 'fileTypeSwapConflictVariant3',
  family: 'file-type-swap-conflict-variant3',
  tag: 'file-type-swap-conflict-v3',
  readyTag: 'file-type-swap-conflict-v3-ready',
  nonReadyTag: 'file-type-swap-conflict-v3-non-ready',
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

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function assertFileTypeSwapShape(testCase, { conflict }) {
  const marker = conflict ? '/conflict-type-swap-' : '/ready-type-swap-';
  const swapEntries = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory');

  assert.equal(swapEntries.length, 1, `${testCase.id} should seed one generated type-swap target`);

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
    `${testCase.id} remote descendant shape should match readiness`,
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
    targetPath: path,
    targetResource: { type: 'file', path },
    targetResourceKey: `file:${path}`,
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

function surfaceEvidence(testCase, shape) {
  return {
    typeSwap: {
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
  const mutation = mutationFor(plan, shape.targetResourceKey);
  const precondition = preconditionFor(plan, shape.targetResourceKey);

  assert.ok(mutation, `${testCase.id} should plan the ready type-swap mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the ready type-swap mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'type-change');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);

  const localHash = resourceHash(testCase.local, shape.targetResource);
  const appliedHash = resourceHash(applied.site, shape.targetResource);
  assert.equal(appliedHash, localHash, `${testCase.id} applied type-swap hash should match local file`);

  return {
    resourceKey: shape.targetResourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash: resourceHash(testCase.base, shape.targetResource),
    localHash,
    remoteHash: resourceHash(testCase.remote, shape.targetResource),
    appliedHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) =>
    entry.resourceKey === shape.targetResourceKey
      && entry.class === 'file-topology-conflict');
  const plannedMutation = Boolean(mutationFor(plan, shape.targetResourceKey));
  const plannedPrecondition = Boolean(preconditionFor(plan, shape.targetResourceKey));

  assert.ok(conflict, `${testCase.id} should report a type-swap topology conflict`);
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(conflict.relatedResourceKey, shape.remoteDescendantResourceKey);
  assert.equal(conflict.change.localChange, 'type-change');
  assert.equal(conflict.change.remoteChange, 'unchanged');
  assert.equal(conflict.relatedChange.localChange, 'unchanged');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    reasonHash: `sha256:${digest(conflict.reason)}`,
    relatedResourceKey: conflict.relatedResourceKey,
    localChange: conflict.change.localChange,
    remoteChange: conflict.change.remoteChange,
    relatedLocalChange: conflict.relatedChange.localChange,
    relatedRemoteChange: conflict.relatedChange.remoteChange,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function remoteDescendantEvidence({ testCase, plan, shape }) {
  assert.ok(shape.remoteDescendantResource, `${testCase.id} should include one live remote descendant`);

  const decision = decisionFor(plan, shape.remoteDescendantResourceKey);
  const plannedMutation = Boolean(mutationFor(plan, shape.remoteDescendantResourceKey));
  const plannedPrecondition = Boolean(preconditionFor(plan, shape.remoteDescendantResourceKey));

  assert.ok(decision, `${testCase.id} should record a keep-remote descendant decision`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(decision.change.localChange, 'unchanged');
  assert.equal(decision.change.remoteChange, 'create');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.remoteDescendantResourceKey,
    decision: decision.decision,
    localChange: decision.change.localChange,
    remoteChange: decision.change.remoteChange,
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
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} refusal should not mutate remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function selectedCaseEvidence(testCase, result) {
  const conflict = testCase.tags.has(target.nonReadyTag);
  const shape = assertFileTypeSwapShape(testCase, { conflict });
  const plan = planFor(testCase);
  const surface = surfaceEvidence(testCase, shape);
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
    assert.equal(testCase.tags.has(target.readyTag), true);
    assert.equal(result.status, 'ready');
    assert.equal(plan.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true);
    assert.equal(shape.remoteDescendantResource, null);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const typeSwap = readyTypeSwapEvidence({ testCase, plan, applied, shape });

    return {
      ...common,
      applied: true,
      unplannedRemotePreserved: true,
      staleReplayRejected: true,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: true,
      typeSwap,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        planSummary: plan.summary,
        surface,
        typeSwap,
      })}`,
    };
  }

  assert.equal(testCase.tags.has(target.nonReadyTag), true);
  assert.equal(testCase.family, 'file-type-swap-conflict');
  assert.equal(result.status, 'conflict');
  assert.equal(plan.status, 'conflict');
  assert.equal(result.applied, false);
  assert.equal(result.nonReadyRemoteUnchanged, true);

  const conflictProof = conflictEvidence({ testCase, plan, shape });
  const remoteDescendant = remoteDescendantEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...common,
    applied: false,
    conflict: conflictProof,
    remoteDescendant,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      planSummary: plan.summary,
      surface,
      conflict: conflictProof,
      remoteDescendant,
      refusal,
    })}`,
  };
}

function generatedCoverageEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const selectedKey = testCase.tags.has(target.readyTag) ? 'ready' : 'non-ready';

    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, selectedCaseEvidence(testCase, result));
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'variant 3 type-swap recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'variant 3 type-swap recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'variant 3 type-swap recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready type-swap case');
  assert.ok(selectedCases.has('non-ready'), 'variant 3 target should select one remote-descendant conflict case');

  const evidence = {
    target: target.coverageKey,
    family: coverage.family,
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

test('RPP-0245 generated summary exposes local file type-swap versus remote descendant variant 3 coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const cases = targetCases();
  const readyCase = cases.find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = cases.find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing RPP-0245 file type-swap variant 3 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0245 type-swap case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0245 type-swap case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0245 generated local file type-swap evidence is hash-only and deterministic', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedCoverageEvidence(coverage);
  const replayEvidence = generatedCoverageEvidence(coverage);
  const evidenceEnvelope = {
    command,
    caveat,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);
  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0245 generated evidence should be deterministic');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, 20);
  assert.equal(firstEvidence.readyCases, 10);
  assert.equal(firstEvidence.nonReadyCases, 10);
  assert.deepEqual(firstEvidence.perTier, expectedPerTier);
  assert.deepEqual(firstEvidence.statuses, expectedStatuses);
  assert.match(firstEvidence.modelProofHash, sha256EvidencePattern);
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);

  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.typeSwap.action, 'put');
  assert.equal(readyCase.typeSwap.changeKind, 'type-change');
  assert.equal(readyCase.typeSwap.appliedHash, readyCase.typeSwap.localHash);
  assert.match(readyCase.typeSwap.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.typeSwap.preconditionHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.status, 'conflict');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.relatedResourceKey, nonReadyCase.remoteDescendant.resourceKey);
  assert.equal(nonReadyCase.conflict.localChange, 'type-change');
  assert.equal(nonReadyCase.conflict.relatedRemoteChange, 'create');
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
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.equal(evidenceText.includes('local type swap '), false, 'RPP-0245 evidence leaked local payload');
  assert.equal(
    evidenceText.includes('remote descendant for type swap '),
    false,
    'RPP-0245 evidence leaked remote descendant payload',
  );
  assert.equal(evidenceText.includes('"content":'), false, 'RPP-0245 evidence must not expose raw content fields');
});

test('RPP-0245 progress log records the focused command and caveat', () => {
  const progressLog = readFileSync(new URL('../docs/progress-log.md', import.meta.url), 'utf8');

  assert.ok(progressLog.includes('RPP-0245'), 'progress log should name RPP-0245');
  assert.ok(progressLog.includes(command), 'progress log should record the focused command');
  assert.ok(progressLog.includes(caveat), 'progress log should record the focused caveat');
});
