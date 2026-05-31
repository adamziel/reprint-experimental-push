import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0740-rollout-threshold-configuration-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const laneId = 'rollout-threshold-configuration-fast-path';
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const configuredThresholdsBps = Object.freeze([1000, 2500, 5000, 10000]);
const decisionSamplesMs = Object.freeze([1.2, 1.4, 1.5, 1.8, 2.0, 2.3, 2.5, 2.9, 3.2, 3.6, 4.1, 4.8]);
const expectedGateIds = Object.freeze([
  'deterministic-threshold-configuration',
  'configured-threshold-sequence',
  'storage-thresholds-within-configuration',
  'performance-thresholds-within-configuration',
  'fast-path-lane-updates-only-after-correctness-gates',
  'threshold-lane-update-counts-match',
  'deterministic-hash-only-rollout-evidence',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);

test('RPP-0740 variant 2 proves rollout thresholds gate fast-path lane updates', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0740');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rolloutSafety.rppId, 'RPP-0720');
  assert.equal(proof.builtOn.storagePerformance.rppId, 'RPP-0735');
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);

  assert.equal(proof.thresholdConfiguration.schemaVersion, 2);
  assert.equal(proof.thresholdConfiguration.variant, 2);
  assert.equal(proof.thresholdConfiguration.mode, 'support-only-local-rollout-thresholds');
  assert.equal(proof.thresholdConfiguration.laneId, laneId);
  assert.deepEqual(proof.thresholdConfiguration.rolloutThresholdsBps, configuredThresholdsBps);
  assert.equal(proof.thresholdConfiguration.minSampleCount, decisionSamplesMs.length);
  assert.equal(proof.thresholdConfiguration.maxStorageDriftBps, 0);
  assert.equal(proof.thresholdConfiguration.maxP95DecisionMs, 6);
  assert.equal(proof.thresholdConfiguration.maxDecisionMs, 8);
  assert.equal(proof.thresholdConfiguration.maxUnsafeUpdatesBeforeGates, 0);
  assert.equal(proof.thresholdConfiguration.maxLaneUpdatesWithFailedGate, 0);
  assert.equal(proof.thresholdConfiguration.failClosedOnUnknownThreshold, true);
  assert.match(proof.thresholdConfiguration.configHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(proof.resources.storage.attemptedChecks, decisionSamplesMs.length);
  assert.equal(proof.resources.storage.matchedChecks, decisionSamplesMs.length);
  assert.equal(proof.resources.storage.driftedChecks, 0);
  assert.equal(proof.resources.storage.storageDriftBps, 0);
  assert.equal(proof.resources.performance.sampleCount, decisionSamplesMs.length);
  assert.equal(proof.resources.performance.p95DecisionMs, 4.8);
  assert.equal(proof.resources.performance.maxDecisionMs, 4.8);
  assert.equal(proof.resources.performance.overP95Budget, false);

  assert.equal(proof.fastPathLaneEvidence.laneId, laneId);
  assert.equal(proof.fastPathLaneEvidence.configHash, proof.thresholdConfiguration.configHash);
  assert.deepEqual(proof.fastPathLaneEvidence.configuredThresholdsBps, configuredThresholdsBps);
  assert.equal(proof.fastPathLaneEvidence.storage.attemptedChecks, decisionSamplesMs.length);
  assert.equal(proof.fastPathLaneEvidence.storage.driftedChecks, 0);
  assert.equal(proof.fastPathLaneEvidence.performance.p95DecisionMs, 4.8);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.thresholdUpdates, configuredThresholdsBps.length);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.blocked, 0);
  assert.deepEqual(proof.fastPathLaneEvidence.fastPathLane.blockedBy, {});
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesWithUnknownThreshold, 0);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesWithStorageDrift, 0);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesOverPerformanceThreshold, 0);
  assert.equal(proof.fastPathLaneEvidence.thresholdUpdates.length, configuredThresholdsBps.length);
  assert.deepEqual(
    proof.fastPathLaneEvidence.thresholdUpdates.map((update) => update.thresholdBps),
    configuredThresholdsBps,
  );
  assert.ok(proof.fastPathLaneEvidence.thresholdUpdates.every((update) =>
    update.correctnessGateStatus === 'passed'));
  assert.ok(proof.fastPathLaneEvidence.thresholdUpdates.every((update) =>
    update.laneUpdateHash.match(/^sha256:[a-f0-9]{64}$/)));
  assert.match(proof.fastPathLaneEvidence.laneEvidenceHash, /^sha256:[a-f0-9]{64}$/);

  assert.deepEqual(proof.correctness.gateIds, expectedGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeLaneEvidence, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeLaneUpdate, true);
  assert.equal(proof.correctness.hashOnlyLaneOutput, true);
  assert.equal(proof.correctness.fastPathLaneOutputEmittedAfterGates, true);
  assert.match(proof.fastPathLaneEvidence.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.unsafeLaneUpdateBeforeGates.updated, false);
  assert.equal(proof.unsafe.unsafeLaneUpdateBeforeGates.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.unsafeLaneUpdateBeforeGates.blockedBy.includes(
    'fast-path-lane-updates-only-after-correctness-gates',
  ));
  assert.equal(proof.unsafe.unknownThresholdUpdate.updated, false);
  assert.equal(proof.unsafe.unknownThresholdUpdate.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.unknownThresholdUpdate.blockedBy.includes('configured-threshold-sequence'));
  assert.equal(proof.unsafe.storageDriftExceeded.updated, false);
  assert.equal(proof.unsafe.storageDriftExceeded.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.storageDriftExceeded.blockedBy.includes(
    'storage-thresholds-within-configuration',
  ));
  assert.equal(proof.unsafe.performanceThresholdExceeded.updated, false);
  assert.equal(proof.unsafe.performanceThresholdExceeded.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.performanceThresholdExceeded.blockedBy.includes(
    'performance-thresholds-within-configuration',
  ));
  assert.equal(proof.unsafe.mismatchedConfigurationHash.updated, false);
  assert.equal(proof.unsafe.mismatchedConfigurationHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mismatchedConfigurationHash.blockedBy.includes(
    'deterministic-threshold-configuration',
  ));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyRolloutEvidence(proof);
});

test('RPP-0740 variant 2 fails closed for unsafe rollout threshold evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveRolloutThresholdProof(evidence, { repeatedEvidence });
  const unsafeLaneUpdateBeforeGates = withPassedStatus(clone(evidence));
  unsafeLaneUpdateBeforeGates.fastPathLaneEvidence.fastPathLane.unsafeUpdatesBeforeGates = 1;
  unsafeLaneUpdateBeforeGates.fastPathLaneEvidence.fastPathLane.updatesWithFailedGate = 1;
  refreshLaneEvidenceHash(unsafeLaneUpdateBeforeGates);
  const unknownThresholdUpdate = withPassedStatus(clone(evidence));
  appendUnknownThresholdUpdate(unknownThresholdUpdate);
  const storageDriftExceeded = withPassedStatus(clone(evidence));
  storageDriftExceeded.fastPathLaneEvidence.storage.matchedChecks -= 1;
  storageDriftExceeded.fastPathLaneEvidence.storage.driftedChecks = 1;
  storageDriftExceeded.fastPathLaneEvidence.storage.storageDriftBps = basisPoints(
    storageDriftExceeded.fastPathLaneEvidence.storage.driftedChecks,
    storageDriftExceeded.fastPathLaneEvidence.storage.attemptedChecks,
  );
  storageDriftExceeded.fastPathLaneEvidence.fastPathLane.updatesWithStorageDrift = 1;
  refreshStorageEvidenceHash(storageDriftExceeded);
  refreshLaneEvidenceHash(storageDriftExceeded);
  const performanceThresholdExceeded = withPassedStatus(clone(evidence));
  performanceThresholdExceeded.fastPathLaneEvidence.performance.p95DecisionMs = 7.1;
  performanceThresholdExceeded.fastPathLaneEvidence.performance.overP95Budget = true;
  performanceThresholdExceeded.fastPathLaneEvidence.fastPathLane.updatesOverPerformanceThreshold = 1;
  refreshPerformanceEvidenceHash(performanceThresholdExceeded);
  refreshLaneEvidenceHash(performanceThresholdExceeded);
  const mismatchedConfigurationHash = withPassedStatus(clone(evidence));
  mismatchedConfigurationHash.thresholdConfiguration.configHash = sha256(
    'rpp-0740-mismatched-threshold-configuration',
  );
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    unsafeLaneUpdateBeforeGates: resolveRolloutThresholdProof(unsafeLaneUpdateBeforeGates, {
      repeatedEvidence,
    }),
    unknownThresholdUpdate: resolveRolloutThresholdProof(unknownThresholdUpdate, { repeatedEvidence }),
    storageDriftExceeded: resolveRolloutThresholdProof(storageDriftExceeded, { repeatedEvidence }),
    performanceThresholdExceeded: resolveRolloutThresholdProof(performanceThresholdExceeded, {
      repeatedEvidence,
    }),
    mismatchedConfigurationHash: resolveRolloutThresholdProof(mismatchedConfigurationHash, {
      repeatedEvidence,
    }),
    prematurePassStatus: resolveRolloutThresholdProof(prematurePassStatus, { repeatedEvidence }),
  };

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(safeDecision.recomputedGates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(unsafeDecisions.unsafeLaneUpdateBeforeGates.updated, false);
  assert.ok(unsafeDecisions.unsafeLaneUpdateBeforeGates.blockedBy.includes(
    'fast-path-lane-updates-only-after-correctness-gates',
  ));
  assert.equal(unsafeDecisions.unknownThresholdUpdate.updated, false);
  assert.ok(unsafeDecisions.unknownThresholdUpdate.blockedBy.includes(
    'configured-threshold-sequence',
  ));
  assert.equal(unsafeDecisions.storageDriftExceeded.updated, false);
  assert.ok(unsafeDecisions.storageDriftExceeded.blockedBy.includes(
    'storage-thresholds-within-configuration',
  ));
  assert.equal(unsafeDecisions.performanceThresholdExceeded.updated, false);
  assert.ok(unsafeDecisions.performanceThresholdExceeded.blockedBy.includes(
    'performance-thresholds-within-configuration',
  ));
  assert.equal(unsafeDecisions.mismatchedConfigurationHash.updated, false);
  assert.ok(unsafeDecisions.mismatchedConfigurationHash.blockedBy.includes(
    'deterministic-threshold-configuration',
  ));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyRolloutEvidence(decision);
  }
});

function buildVariant2Proof() {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveRolloutThresholdProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeRolloutThresholdEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeLaneEvidence = objectKeyBefore(
    evidence,
    'correctnessGates',
    'fastPathLaneEvidence',
  );
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('rollout-threshold-configuration-gates-pass', safeDecision.updated
      && safeDecision.recomputedGates.every((gate) => gate.status === 'pass'), {
      recomputedGateVector: safeDecision.recomputedGates.map((gate) => gate.status),
    }),
    proofGate('fast-path-lane-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeLaneEvidence, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeLaneEvidence,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-rollout-threshold-evidence-fails-closed', Object.values(unsafe).every((decision) => (
      decision.updated === false
        && decision.outputEmitted === false
        && decision.attemptedPassBlocked === true
    )), {
      blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0740',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: {
      storage: evidence.fastPathLaneEvidence.storage,
      performance: evidence.fastPathLaneEvidence.performance,
      process: evidence.resources.process,
    },
    thresholdConfiguration: evidence.thresholdConfiguration,
    fastPathLaneEvidence: {
      ...evidence.fastPathLaneEvidence,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeLaneEvidence,
      correctnessGatesHoldBeforeLaneUpdate: safeDecision.correctnessGatesHold,
      hashOnlyLaneOutput: safeDecision.hashOnlyLaneOutput,
      fastPathLaneOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-rollout-threshold-storage-performance-evidence',
      rawValueEvidenceLeaks: rolloutEvidenceHasNoRawValues(evidence.fastPathLaneEvidence) ? 0 : 1,
      publicLaneEvidenceHash: digest(publicRolloutEvidenceProjection(evidence)),
      repeatedLaneEvidenceHash: digest(publicRolloutEvidenceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const evidence = buildRolloutThresholdEvidence();
  const repeatedEvidence = buildRolloutThresholdEvidence();

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { evidence, repeatedEvidence };
}

function buildRolloutThresholdEvidence() {
  const started = performance.now();
  const thresholdConfiguration = normalizedThresholdConfiguration();
  const fastPathLaneEvidence = collectFastPathLaneEvidence(thresholdConfiguration);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0740',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: {
      rolloutSafety: {
        rppId: 'RPP-0720',
        invariant: 'rollout-safety-gates-before-speed-claims',
      },
      storagePerformance: {
        rppId: 'RPP-0735',
        invariant: 'fast-path-lane-updates-only-after-correctness-gates',
      },
      evidenceHash: digest({
        thresholdConfiguration,
        laneEvidenceHash: fastPathLaneEvidence.laneEvidenceHash,
      }),
    },
    thresholdConfiguration,
    correctnessGates: [],
    fastPathLaneEvidence,
    runtime: {
      generatedAt: fixedNow.toISOString(),
      durationMs: elapsedMs(started),
      budgets: {
        maxDurationMs,
        maxHeapUsedBytes,
      },
    },
    resources: {
      process: {
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
    },
    release: supportOnlyReleasePosture(),
  };
}

function normalizedThresholdConfiguration() {
  const core = {
    schemaVersion: 2,
    variant: 2,
    mode: 'support-only-local-rollout-thresholds',
    laneId,
    rolloutThresholdsBps: [...configuredThresholdsBps].sort((left, right) => left - right),
    minSampleCount: decisionSamplesMs.length,
    maxStorageDriftBps: 0,
    maxP95DecisionMs: 6,
    maxDecisionMs: 8,
    maxUnsafeUpdatesBeforeGates: 0,
    maxLaneUpdatesWithFailedGate: 0,
    failClosedOnUnknownThreshold: true,
    requireCorrectnessGateVector: true,
    supportOnly: true,
  };

  return {
    ...core,
    configHash: sha256(core),
  };
}

function collectFastPathLaneEvidence(config) {
  const samples = buildStoragePerformanceSamples(config);
  const storage = storageEvidence(samples, config);
  const performanceEvidence = performanceThresholdEvidence(samples, config);
  const thresholdUpdates = config.rolloutThresholdsBps.map((thresholdBps, index) =>
    thresholdUpdateRecord({
      thresholdBps,
      updateSequence: index,
      configHash: config.configHash,
      storageEvidenceHash: storage.evidenceHash,
      performanceEvidenceHash: performanceEvidence.evidenceHash,
    }));
  const core = {
    evidenceMode: 'support-only-rollout-threshold-configuration-v2',
    laneId: config.laneId,
    configHash: config.configHash,
    configuredThresholdsBps: config.rolloutThresholdsBps,
    expectedGateVectorHash: sha256(expectedGateIds),
    storage,
    performance: performanceEvidence,
    fastPathLane: {
      id: config.laneId,
      updatePolicy: 'update-only-after-correctness-gates-and-thresholds-pass',
      evaluatedBeforeUpdate: true,
      evaluatedAfterGates: true,
      updatesOnlyAfterCorrectnessGates: true,
      thresholdUpdates: thresholdUpdates.length,
      blocked: 0,
      blockedBy: {},
      unsafeUpdatesBeforeGates: 0,
      updatesWithFailedGate: 0,
      updatesWithUnknownThreshold: 0,
      updatesWithStorageDrift: 0,
      updatesOverPerformanceThreshold: 0,
    },
    thresholdUpdates,
    updateHashes: thresholdUpdates.map((update) => update.laneUpdateHash),
    sampleHashes: samples.map((sample) => sample.sampleHash),
  };

  return {
    ...core,
    laneEvidenceHash: sha256(core),
  };
}

function buildStoragePerformanceSamples(config) {
  return decisionSamplesMs.map((decisionMs, index) => {
    const thresholdBps = config.rolloutThresholdsBps[index % config.rolloutThresholdsBps.length];
    const core = {
      sampleIndex: index,
      thresholdBps,
      resourceKeyHash: sha256(`rpp-0740-resource-${index}`),
      expectedStorageHash: sha256(`rpp-0740-storage-before-${index}`),
      actualStorageHash: sha256(`rpp-0740-storage-before-${index}`),
      storageGuardOutcome: 'matched',
      decisionMs,
      decisionBudgetMs: config.maxDecisionMs,
      correctnessGateStatus: 'passed',
    };

    return {
      ...core,
      sampleHash: sha256(core),
    };
  });
}

function storageEvidence(samples, config) {
  const attemptedChecks = samples.length;
  const driftedChecks = samples.filter((sample) =>
    sample.expectedStorageHash !== sample.actualStorageHash).length;
  const core = {
    attemptedChecks,
    matchedChecks: attemptedChecks - driftedChecks,
    driftedChecks,
    storageDriftBps: basisPoints(driftedChecks, attemptedChecks),
    maxStorageDriftBps: config.maxStorageDriftBps,
    sampleCountMeetsThreshold: attemptedChecks >= config.minSampleCount,
    storageOutcomes: countBy(samples, (sample) => sample.storageGuardOutcome),
    sampleHashes: samples.map((sample) => sample.sampleHash),
  };

  return {
    ...core,
    evidenceHash: sha256(core),
  };
}

function performanceThresholdEvidence(samples, config) {
  const sorted = samples.map((sample) => sample.decisionMs).sort((left, right) => left - right);
  const p95DecisionMs = nearestRankPercentile(sorted, 0.95);
  const maxObservedDecisionMs = Math.max(...sorted);
  const core = {
    sampleCount: samples.length,
    minSampleCount: config.minSampleCount,
    p95DecisionMs,
    maxDecisionMs: maxObservedDecisionMs,
    maxAllowedP95DecisionMs: config.maxP95DecisionMs,
    maxAllowedDecisionMs: config.maxDecisionMs,
    overP95Budget: p95DecisionMs > config.maxP95DecisionMs,
    overMaxBudget: maxObservedDecisionMs > config.maxDecisionMs,
    decisionSampleHash: sha256(sorted),
  };

  return {
    ...core,
    evidenceHash: sha256(core),
  };
}

function thresholdUpdateRecord({
  thresholdBps,
  updateSequence,
  configHash,
  storageEvidenceHash,
  performanceEvidenceHash,
}) {
  const core = {
    laneId,
    updateSequence,
    thresholdBps,
    configHash,
    storageEvidenceHash,
    performanceEvidenceHash,
    correctnessGateStatus: 'passed',
    correctnessGateVectorHash: sha256(expectedGateIds),
    updateDecision: 'advance-threshold',
  };

  return {
    ...core,
    laneUpdateHash: sha256(core),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeRolloutThresholdGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveRolloutThresholdProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeRolloutThresholdGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        gateVectorHash: sha256(recomputedGates),
        laneId: evidence.fastPathLaneEvidence.laneId,
        configHash: evidence.thresholdConfiguration.configHash,
        laneEvidenceHash: evidence.fastPathLaneEvidence.laneEvidenceHash,
        thresholdUpdates: evidence.fastPathLaneEvidence.fastPathLane.thresholdUpdates,
        configuredThresholdsHash: sha256(evidence.fastPathLaneEvidence.configuredThresholdsBps),
        storageEvidenceHash: evidence.fastPathLaneEvidence.storage.evidenceHash,
        performanceEvidenceHash: evidence.fastPathLaneEvidence.performance.evidenceHash,
        releaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyLaneOutput: output ? rolloutEvidenceHasNoRawValues(output) : false,
    blockedBy,
    recomputedGates,
    outputHash: output ? sha256(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeRolloutThresholdGates(evidence, repeatedEvidence) {
  const config = evidence.thresholdConfiguration || {};
  const lane = evidence.fastPathLaneEvidence || {};
  const storage = lane.storage || {};
  const performanceEvidence = lane.performance || {};
  const fastPathLane = lane.fastPathLane || {};
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};
  const configuredThresholds = Array.isArray(config.rolloutThresholdsBps)
    ? config.rolloutThresholdsBps
    : [];
  const laneThresholds = Array.isArray(lane.configuredThresholdsBps)
    ? lane.configuredThresholdsBps
    : [];
  const thresholdUpdates = Array.isArray(lane.thresholdUpdates) ? lane.thresholdUpdates : [];
  const thresholdSequenceMatches = sameArray(laneThresholds, configuredThresholds)
    && thresholdUpdates.length === configuredThresholds.length
    && thresholdUpdates.every((update, index) => update.thresholdBps === configuredThresholds[index]);
  const laneUpdateHashMismatches = thresholdUpdates
    .filter((update) => update.laneUpdateHash !== sha256(thresholdUpdateCore(update)))
    .map((update) => update.updateSequence);
  const storageEvidenceHashMatches = storage.evidenceHash === sha256(storageEvidenceCore(storage));
  const performanceEvidenceHashMatches =
    performanceEvidence.evidenceHash === sha256(performanceEvidenceCore(performanceEvidence));
  const laneEvidenceHashMatches = lane.laneEvidenceHash === sha256(laneEvidenceCore(lane));
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicRolloutEvidenceProjection(evidence))
      === digest(publicRolloutEvidenceProjection(repeatedEvidence));
  const hashOnlyEvidence = rolloutEvidenceHasNoRawValues({
    thresholdConfiguration: config,
    fastPathLaneEvidence: lane,
  });

  return [
    proofGate('deterministic-threshold-configuration', config.schemaVersion === 2
      && config.variant === 2
      && config.mode === 'support-only-local-rollout-thresholds'
      && config.laneId === laneId
      && isStrictlyAscending(configuredThresholds)
      && config.configHash === sha256(thresholdConfigurationCore(config))
      && lane.configHash === config.configHash, {
      configHash: config.configHash,
      expectedConfigHash: sha256(thresholdConfigurationCore(config)),
      thresholdCount: configuredThresholds.length,
      laneConfigHash: lane.configHash,
    }),
    proofGate('configured-threshold-sequence', thresholdSequenceMatches
      && fastPathLane.updatesWithUnknownThreshold === 0
      && config.failClosedOnUnknownThreshold === true, {
      configuredThresholds,
      laneThresholds,
      updateThresholds: thresholdUpdates.map((update) => update.thresholdBps),
      updatesWithUnknownThreshold: fastPathLane.updatesWithUnknownThreshold,
    }),
    proofGate('storage-thresholds-within-configuration', storage.attemptedChecks >= config.minSampleCount
      && storage.matchedChecks === storage.attemptedChecks
      && storage.driftedChecks === 0
      && storage.storageDriftBps <= config.maxStorageDriftBps
      && fastPathLane.updatesWithStorageDrift === 0
      && storageEvidenceHashMatches, {
      attemptedChecks: storage.attemptedChecks,
      matchedChecks: storage.matchedChecks,
      driftedChecks: storage.driftedChecks,
      storageDriftBps: storage.storageDriftBps,
      maxStorageDriftBps: config.maxStorageDriftBps,
      updatesWithStorageDrift: fastPathLane.updatesWithStorageDrift,
      storageEvidenceHashMatches,
    }),
    proofGate('performance-thresholds-within-configuration',
      performanceEvidence.sampleCount >= config.minSampleCount
        && performanceEvidence.p95DecisionMs <= config.maxP95DecisionMs
        && performanceEvidence.maxDecisionMs <= config.maxDecisionMs
        && performanceEvidence.overP95Budget === false
        && performanceEvidence.overMaxBudget === false
        && fastPathLane.updatesOverPerformanceThreshold === 0
        && performanceEvidenceHashMatches, {
        sampleCount: performanceEvidence.sampleCount,
        p95DecisionMs: performanceEvidence.p95DecisionMs,
        maxAllowedP95DecisionMs: config.maxP95DecisionMs,
        maxDecisionMs: performanceEvidence.maxDecisionMs,
        maxAllowedDecisionMs: config.maxDecisionMs,
        updatesOverPerformanceThreshold: fastPathLane.updatesOverPerformanceThreshold,
        performanceEvidenceHashMatches,
      }),
    proofGate('fast-path-lane-updates-only-after-correctness-gates',
      fastPathLane.id === laneId
        && fastPathLane.updatesOnlyAfterCorrectnessGates === true
        && fastPathLane.evaluatedBeforeUpdate === true
        && fastPathLane.evaluatedAfterGates === true
        && fastPathLane.unsafeUpdatesBeforeGates <= config.maxUnsafeUpdatesBeforeGates
        && fastPathLane.updatesWithFailedGate <= config.maxLaneUpdatesWithFailedGate
        && thresholdUpdates.every((update) => update.correctnessGateStatus === 'passed'), {
        laneId: fastPathLane.id,
        updatesOnlyAfterCorrectnessGates: fastPathLane.updatesOnlyAfterCorrectnessGates,
        evaluatedBeforeUpdate: fastPathLane.evaluatedBeforeUpdate,
        evaluatedAfterGates: fastPathLane.evaluatedAfterGates,
        unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
        updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
      }),
    proofGate('threshold-lane-update-counts-match',
      fastPathLane.thresholdUpdates === thresholdUpdates.length
        && fastPathLane.thresholdUpdates === configuredThresholds.length
        && fastPathLane.blocked === 0
        && sameArray(lane.updateHashes || [], thresholdUpdates.map((update) => update.laneUpdateHash))
        && laneUpdateHashMismatches.length === 0
        && laneEvidenceHashMatches, {
        thresholdUpdates: fastPathLane.thresholdUpdates,
        thresholdUpdateRecords: thresholdUpdates.length,
        configuredThresholdCount: configuredThresholds.length,
        blocked: fastPathLane.blocked,
        laneUpdateHashMismatches,
        laneEvidenceHashMatches,
      }),
    proofGate('deterministic-hash-only-rollout-evidence', deterministicProjection
      && hashOnlyEvidence, {
      firstEvidenceHash: digest(publicRolloutEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicRolloutEvidenceProjection(repeatedEvidence)) : '',
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes, {
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeRolloutThresholdEvidenceDecisions(evidence, repeatedEvidence) {
  const unsafeLaneUpdateBeforeGates = withPassedStatus(clone(evidence));
  unsafeLaneUpdateBeforeGates.fastPathLaneEvidence.fastPathLane.unsafeUpdatesBeforeGates = 1;
  unsafeLaneUpdateBeforeGates.fastPathLaneEvidence.fastPathLane.updatesWithFailedGate = 1;
  refreshLaneEvidenceHash(unsafeLaneUpdateBeforeGates);

  const unknownThresholdUpdate = withPassedStatus(clone(evidence));
  appendUnknownThresholdUpdate(unknownThresholdUpdate);

  const storageDriftExceeded = withPassedStatus(clone(evidence));
  storageDriftExceeded.fastPathLaneEvidence.storage.matchedChecks -= 1;
  storageDriftExceeded.fastPathLaneEvidence.storage.driftedChecks = 1;
  storageDriftExceeded.fastPathLaneEvidence.storage.storageDriftBps = basisPoints(
    storageDriftExceeded.fastPathLaneEvidence.storage.driftedChecks,
    storageDriftExceeded.fastPathLaneEvidence.storage.attemptedChecks,
  );
  storageDriftExceeded.fastPathLaneEvidence.fastPathLane.updatesWithStorageDrift = 1;
  refreshStorageEvidenceHash(storageDriftExceeded);
  refreshLaneEvidenceHash(storageDriftExceeded);

  const performanceThresholdExceeded = withPassedStatus(clone(evidence));
  performanceThresholdExceeded.fastPathLaneEvidence.performance.p95DecisionMs = 7.1;
  performanceThresholdExceeded.fastPathLaneEvidence.performance.overP95Budget = true;
  performanceThresholdExceeded.fastPathLaneEvidence.fastPathLane.updatesOverPerformanceThreshold = 1;
  refreshPerformanceEvidenceHash(performanceThresholdExceeded);
  refreshLaneEvidenceHash(performanceThresholdExceeded);

  const mismatchedConfigurationHash = withPassedStatus(clone(evidence));
  mismatchedConfigurationHash.thresholdConfiguration.configHash = sha256(
    'rpp-0740-mismatched-threshold-configuration',
  );

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    unsafeLaneUpdateBeforeGates: resolveRolloutThresholdProof(unsafeLaneUpdateBeforeGates, {
      repeatedEvidence,
    }),
    unknownThresholdUpdate: resolveRolloutThresholdProof(unknownThresholdUpdate, { repeatedEvidence }),
    storageDriftExceeded: resolveRolloutThresholdProof(storageDriftExceeded, { repeatedEvidence }),
    performanceThresholdExceeded: resolveRolloutThresholdProof(performanceThresholdExceeded, {
      repeatedEvidence,
    }),
    mismatchedConfigurationHash: resolveRolloutThresholdProof(mismatchedConfigurationHash, {
      repeatedEvidence,
    }),
    prematurePassStatus: resolveRolloutThresholdProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function appendUnknownThresholdUpdate(evidence) {
  const lane = evidence.fastPathLaneEvidence;
  const storageEvidenceHash = lane.storage.evidenceHash;
  const performanceEvidenceHash = lane.performance.evidenceHash;
  const update = thresholdUpdateRecord({
    thresholdBps: 7500,
    updateSequence: lane.thresholdUpdates.length,
    configHash: lane.configHash,
    storageEvidenceHash,
    performanceEvidenceHash,
  });
  lane.thresholdUpdates.push(update);
  lane.updateHashes.push(update.laneUpdateHash);
  lane.fastPathLane.thresholdUpdates += 1;
  lane.fastPathLane.updatesWithUnknownThreshold = 1;
  refreshLaneEvidenceHash(evidence);
}

function publicRolloutEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    thresholdConfiguration: evidence.thresholdConfiguration,
    fastPathLaneEvidence: evidence.fastPathLaneEvidence,
    release: evidence.release,
  };
}

function thresholdConfigurationCore(config) {
  return {
    schemaVersion: config.schemaVersion,
    variant: config.variant,
    mode: config.mode,
    laneId: config.laneId,
    rolloutThresholdsBps: config.rolloutThresholdsBps,
    minSampleCount: config.minSampleCount,
    maxStorageDriftBps: config.maxStorageDriftBps,
    maxP95DecisionMs: config.maxP95DecisionMs,
    maxDecisionMs: config.maxDecisionMs,
    maxUnsafeUpdatesBeforeGates: config.maxUnsafeUpdatesBeforeGates,
    maxLaneUpdatesWithFailedGate: config.maxLaneUpdatesWithFailedGate,
    failClosedOnUnknownThreshold: config.failClosedOnUnknownThreshold,
    requireCorrectnessGateVector: config.requireCorrectnessGateVector,
    supportOnly: config.supportOnly,
  };
}

function laneEvidenceCore(lane) {
  return {
    evidenceMode: lane.evidenceMode,
    laneId: lane.laneId,
    configHash: lane.configHash,
    configuredThresholdsBps: lane.configuredThresholdsBps,
    expectedGateVectorHash: lane.expectedGateVectorHash,
    storage: lane.storage,
    performance: lane.performance,
    fastPathLane: lane.fastPathLane,
    thresholdUpdates: lane.thresholdUpdates,
    updateHashes: lane.updateHashes,
    sampleHashes: lane.sampleHashes,
  };
}

function storageEvidenceCore(storage) {
  return {
    attemptedChecks: storage.attemptedChecks,
    matchedChecks: storage.matchedChecks,
    driftedChecks: storage.driftedChecks,
    storageDriftBps: storage.storageDriftBps,
    maxStorageDriftBps: storage.maxStorageDriftBps,
    sampleCountMeetsThreshold: storage.sampleCountMeetsThreshold,
    storageOutcomes: storage.storageOutcomes,
    sampleHashes: storage.sampleHashes,
  };
}

function performanceEvidenceCore(performanceEvidence) {
  return {
    sampleCount: performanceEvidence.sampleCount,
    minSampleCount: performanceEvidence.minSampleCount,
    p95DecisionMs: performanceEvidence.p95DecisionMs,
    maxDecisionMs: performanceEvidence.maxDecisionMs,
    maxAllowedP95DecisionMs: performanceEvidence.maxAllowedP95DecisionMs,
    maxAllowedDecisionMs: performanceEvidence.maxAllowedDecisionMs,
    overP95Budget: performanceEvidence.overP95Budget,
    overMaxBudget: performanceEvidence.overMaxBudget,
    decisionSampleHash: performanceEvidence.decisionSampleHash,
  };
}

function thresholdUpdateCore(update) {
  return {
    laneId: update.laneId,
    updateSequence: update.updateSequence,
    thresholdBps: update.thresholdBps,
    configHash: update.configHash,
    storageEvidenceHash: update.storageEvidenceHash,
    performanceEvidenceHash: update.performanceEvidenceHash,
    correctnessGateStatus: update.correctnessGateStatus,
    correctnessGateVectorHash: update.correctnessGateVectorHash,
    updateDecision: update.updateDecision,
  };
}

function refreshLaneEvidenceHash(evidence) {
  evidence.fastPathLaneEvidence.laneEvidenceHash = sha256(laneEvidenceCore(evidence.fastPathLaneEvidence));
  return evidence;
}

function refreshStorageEvidenceHash(evidence) {
  const storage = evidence.fastPathLaneEvidence.storage;
  storage.evidenceHash = sha256(storageEvidenceCore(storage));
  return evidence;
}

function refreshPerformanceEvidenceHash(evidence) {
  const performanceEvidence = evidence.fastPathLaneEvidence.performance;
  performanceEvidence.evidenceHash = sha256(performanceEvidenceCore(performanceEvidence));
  return evidence;
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
}

function projectUnsafeDecisions(unsafe) {
  return Object.fromEntries(
    Object.entries(unsafe).map(([name, decision]) => [
      name,
      {
        updated: decision.updated,
        outputEmitted: decision.outputEmitted,
        attemptedPassBlocked: decision.attemptedPassBlocked,
        correctnessGatesHold: decision.correctnessGatesHold,
        blockedBy: decision.blockedBy,
        decisionHash: decision.decisionHash,
      },
    ]),
  );
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function basisPoints(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000);
}

function nearestRankPercentile(sortedValues, percentile) {
  const index = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1);
  return sortedValues[index];
}

function assertHashOnlyRolloutEvidence(value) {
  assert.equal(rolloutEvidenceHasNoRawValues(value), true);
}

function rolloutEvidenceHasNoRawValues(value) {
  return !rawRolloutEvidencePattern().test(JSON.stringify(value));
}

function rawRolloutEvidencePattern() {
  return /https?:\/\/|Bearer\s+|Basic\s+|token|password|wp-content\/uploads|raw payload|post content|meta value|option value|customer secret/i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function elapsedMs(started) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isStrictlyAscending(values) {
  return values.length > 0
    && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function unique(values) {
  return [...new Set(values)];
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
