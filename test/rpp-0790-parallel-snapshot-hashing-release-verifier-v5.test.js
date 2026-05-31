import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0790-parallel-snapshot-hashing-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const guardedExecutorBenchmarkId = 'guarded-executor-benchmark';
const snapshotHashingBenchmarkId = 'rpp-0710-parallel-snapshot-hashing';
const fastPathLaneId = 'parallel-snapshot-hash-fast-path';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const expectedSnapshotGateIds = Object.freeze([
  'bounded-hash-concurrency',
  'complete-snapshot-hash-set',
  'parallel-matches-sequential',
  'deterministic-hash-set',
  'planning-only-no-write-authority',
  'hash-only-evidence',
]);
const requiredBenchmarkGateIds = Object.freeze([
  'runtime-resource-budget',
  ...expectedSnapshotGateIds,
]);
const releaseVerifierSupportGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'parallel-snapshot-correctness-evidence-carried-through',
  'fast-path-lane-withheld-until-correctness-gates-pass',
  'deterministic-hash-only-release-verifier-evidence',
  'production-speed-claims-disabled',
  'release-verifier-carry-through-claimed-support-only',
  'support-only-release-no-go',
]);

test('RPP-0790 release verifier variant 5 carries parallel snapshot hashing support evidence', {
  concurrency: false,
}, () => {
  const focusedSummary = runReleaseVerifierSnapshotMatrix();
  const repeatedFocusedSummary = runReleaseVerifierSnapshotMatrix();
  const report = runSmallBenchmark({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const repeatedReport = runSmallBenchmark({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const proof = buildReleaseVerifierSupportProof({
    focusedSummary,
    repeatedFocusedSummary,
    report,
    repeatedReport,
  });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0790');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'parallel-snapshot-hashing-release-verifier-v5');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), releaseVerifierSupportGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.releaseVerifier.benchmarkId, snapshotHashingBenchmarkId);
  assert.equal(proof.releaseVerifier.benchmarkRunnerId, guardedExecutorBenchmarkId);
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.carryThrough, 'support-only-claimed');
  assert.deepEqual(proof.releaseVerifier.passGateIds.sort(), [...requiredBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);
  assert.deepEqual(proof.releaseVerifier.correctnessGateIds, expectedSnapshotGateIds);
  assert.equal(proof.releaseVerifier.rolloutGateStatus, 'passed');
  assert.equal(proof.releaseVerifier.productionGateEvidence, 'not-present');

  assert.equal(proof.focusedRegression.source, 'RPP-0790 local release-verifier snapshot matrix');
  assert.equal(proof.focusedRegression.caseCount, 10);
  assert.equal(proof.focusedRegression.fastPathLane.updates, 1);
  assert.equal(proof.focusedRegression.fastPathLane.blocked, 9);
  assert.equal(proof.focusedRegression.fastPathLane.unsafeFastPathOutputs, 0);
  assert.equal(proof.focusedRegression.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(proof.focusedRegression.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.focusedRegression.fastPathLane.updatesOnlyWhenCorrectnessGatesHold, true);
  assert.equal(proof.focusedRegression.correctness.updatedCasesAllGatesPassed, true);
  assert.equal(proof.focusedRegression.correctness.blockedCasesHoldNoLaneUpdate, true);
  assert.match(proof.focusedRegression.projectionHash, sha256HexPattern);
  assert.deepEqual(proof.focusedRegression.fastPathLane.blockedBy, {
    'bounded-hash-concurrency': 1,
    'complete-snapshot-hash-set': 1,
    'correctness-gates-not-before-lane': 1,
    'correctness-gates-not-passed': 8,
    'correctness-gates-not-recorded': 1,
    'deterministic-hash-set': 1,
    'hash-only-evidence': 1,
    'parallel-matches-sequential': 1,
    'planning-only-no-write-authority': 1,
  });

  assert.equal(proof.benchmarkCarryThrough.sourceRppId, 'RPP-0710');
  assert.equal(proof.benchmarkCarryThrough.benchmarkId, snapshotHashingBenchmarkId);
  assert.equal(proof.benchmarkCarryThrough.runnerBenchmarkId, guardedExecutorBenchmarkId);
  assert.equal(proof.benchmarkCarryThrough.shape.snapshotHashResources, 22);
  assert.equal(proof.benchmarkCarryThrough.shape.snapshotHashJobs, 66);
  assert.equal(proof.benchmarkCarryThrough.shape.snapshotHashConcurrency, 2);
  assert.equal(proof.benchmarkCarryThrough.runtime.budgetStatus, 'passed');
  assert.equal(proof.benchmarkCarryThrough.productionThroughput.status, 'blocked');
  assert.equal(proof.benchmarkCarryThrough.productionThroughput.speedClaimsAllowed, false);

  assert.equal(proof.scheduler.maxConcurrency, 2);
  assert.equal(proof.scheduler.maxObservedInFlight <= proof.scheduler.maxConcurrency, true);
  assert.equal(proof.scheduler.bounded, true);
  assert.equal(proof.hashSet.snapshotCount, 3);
  assert.equal(proof.hashSet.resourceCount, 22);
  assert.equal(proof.hashSet.hashCount, proof.hashSet.expectedHashCount);
  assert.equal(proof.hashSet.parallelDigest, proof.hashSet.sequentialDigest);
  assert.equal(proof.hashSet.parallelDigest, proof.hashSet.secondRunDigest);
  assert.equal(proof.hashSet.hashSampleHashes.length, 3);

  assert.deepEqual(proof.correctness.gateIds, expectedSnapshotGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeLane, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeLaneUpdate, true);
  assert.equal(proof.correctness.benchmarkLaneUpdatedOnlyAfterGatesHold, true);
  assert.equal(proof.correctness.focusedBlockedCasesWithholdLane, true);
  assert.equal(proof.correctness.deterministicHashOnlyProjection, true);
  assert.equal(proof.correctness.productionSnapshotBlockerAbsent, true);

  assert.equal(proof.fastPathLane.id, fastPathLaneId);
  assert.equal(proof.fastPathLane.policy, 'update-only-after-correctness-gates-pass');
  assert.equal(proof.fastPathLane.benchmarkUpdated, true);
  assert.equal(proof.fastPathLane.outputEmittedAfterGates, true);
  assert.equal(proof.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true);
  assert.equal(proof.fastPathLane.correctnessGatesHold, true);
  assert.equal(proof.fastPathLane.focusedUpdates, 1);
  assert.equal(proof.fastPathLane.focusedBlocked, 9);
  assert.equal(proof.fastPathLane.unsafeFastPathOutputs, 0);
  assert.equal(proof.fastPathLane.updatesWithFailedGate, 0);
  assert.deepEqual(proof.fastPathLane.blockedBy, []);
  assert.match(proof.fastPathLane.outputHash, sha256EvidencePattern);
  assert.match(proof.fastPathLane.proofDigestHash, sha256HexPattern);

  assert.equal(proof.performance.localSupportOnly, true);
  assert.equal(proof.performance.budgetStatus, 'passed');
  assert.equal(proof.performance.durationWithinBudget, true);
  assert.equal(proof.performance.heapWithinBudget, true);
  assert.equal(proof.performance.productionThroughput, 'not-claimed');
  assert.equal(proof.performance.speedClaimsAllowed, false);

  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, sha256HexPattern);

  assertProjectionHasNoRawSnapshotValues(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0790 parallel snapshot release verifier proof' }));
});

test('RPP-0790 release verifier variant 5 preserves failed support-gate evidence for NO-GO diagnosis', {
  concurrency: false,
}, () => {
  const report = runSmallBenchmark({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  });
  const proof = buildFailGateReleaseVerifierProof(report);

  assert.equal(report.runtime.budgetStatus, 'failed');
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0790');
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'parallel-snapshot-hashing-release-verifier-fail-gate-v5');
  assert.equal(proof.status, 'failed_support_gate');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.runtimeReported, true);
  assert.equal(proof.resourcesReported, true);
  assert.equal(proof.passFailGatesReported, true);
  assert.deepEqual(proof.passGateIds.sort(), [...expectedSnapshotGateIds].sort());
  assert.deepEqual(proof.failGateIds, ['runtime-resource-budget']);
  assert.equal(proof.failedSupportGate.id, 'runtime-resource-budget');
  assert.equal(proof.failedSupportGate.maxHeapUsedBytes, 1);
  assert.equal(proof.failedSupportGate.heapWithinBudget, false);
  assert.ok(proof.failedSupportGate.heapUsedBytes > 1);

  assert.equal(proof.snapshot.status, 'passed');
  assert.equal(proof.snapshot.scheduler.maxConcurrency, 2);
  assert.equal(proof.snapshot.hashSet.resourceCount, 22);
  assert.equal(proof.snapshot.hashSet.hashCount, 66);
  assert.deepEqual(proof.snapshot.correctnessGateStatuses, [
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
  ]);
  assert.equal(proof.fastPathLane.id, fastPathLaneId);
  assert.equal(proof.fastPathLane.updated, true);
  assert.equal(proof.fastPathLane.correctnessGatesHold, true);
  assert.equal(proof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.deepEqual(proof.fastPathLane.blockedBy, []);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, sha256HexPattern);

  assertProjectionHasNoRawSnapshotValues(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0790 parallel snapshot fail-gate proof' }));
});

function runSmallBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
    snapshotHashConcurrency: 2,
    now: fixedNow,
    seed: proofId,
    tempDir: fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0790-')),
    ...overrides,
  });
}

function runReleaseVerifierSnapshotMatrix() {
  const decisions = variant5SnapshotHashCases().map((snapshotCase) => {
    const decision = resolveVariant5FastPathLane(snapshotCase.evidence, {
      attemptedLaneUpdate: true,
    });

    assert.equal(decision.updated, snapshotCase.expected.updated, snapshotCase.id);
    assert.equal(decision.outputEmitted, snapshotCase.expected.updated, snapshotCase.id);
    assert.equal(decision.correctnessGatesHold, snapshotCase.expected.updated, snapshotCase.id);
    assert.equal(decision.attemptedLaneUpdateBlocked, !snapshotCase.expected.updated, snapshotCase.id);
    assert.equal(decision.output === null, !snapshotCase.expected.updated, snapshotCase.id);
    assert.deepEqual(
      decision.recomputedGates.map((gate) => gate.id),
      expectedSnapshotGateIds,
      snapshotCase.id,
    );

    if (snapshotCase.expected.updated) {
      assert.deepEqual(decision.recomputedGates.map((gate) => gate.status), [
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
      ], snapshotCase.id);
      assert.deepEqual(decision.blockedBy, [], snapshotCase.id);
      assert.match(decision.outputHash, sha256EvidencePattern, snapshotCase.id);
    } else {
      assert.equal(decision.outputHash, null, snapshotCase.id);
      for (const blocker of snapshotCase.expected.blockedBy) {
        assert.ok(decision.blockedBy.includes(blocker), `${snapshotCase.id} missing ${blocker}`);
      }
    }

    assert.match(decision.decisionHash, sha256HexPattern, snapshotCase.id);
    assertProjectionHasNoRawSnapshotValues(decision);
    return { ...decision, caseId: snapshotCase.id };
  });

  return summarizeReleaseVerifierSnapshotMatrix(decisions);
}

function buildReleaseVerifierSupportProof({
  focusedSummary,
  repeatedFocusedSummary,
  report,
  repeatedReport,
}) {
  const snapshotEvidence = report.evidence.parallelSnapshotHashing;
  const repeatedSnapshotEvidence = repeatedReport.evidence.parallelSnapshotHashing;
  const firstProjection = publicSnapshotEvidenceProjection(snapshotEvidence);
  const secondProjection = publicSnapshotEvidenceProjection(repeatedSnapshotEvidence);
  const benchmarkProjectionHash = digest(firstProjection);
  const repeatedBenchmarkProjectionHash = digest(secondProjection);
  const safeDecision = resolveVariant5FastPathLane(snapshotEvidence, {
    attemptedLaneUpdate: snapshotEvidence.fastPathLane.updated,
  });
  const repeatedSafeDecision = resolveVariant5FastPathLane(repeatedSnapshotEvidence, {
    attemptedLaneUpdate: repeatedSnapshotEvidence.fastPathLane.updated,
  });
  const supportGateVector = snapshotBenchmarkGateVector(report);
  const repeatedSupportGateVector = snapshotBenchmarkGateVector(repeatedReport);
  const supportGateStatusVector = gateStatuses(supportGateVector);
  const repeatedSupportGateStatusVector = gateStatuses(repeatedSupportGateVector);
  const sameSupportGateVector = JSON.stringify(supportGateStatusVector)
    === JSON.stringify(repeatedSupportGateStatusVector);
  const sameBenchmarkProjectionHash = benchmarkProjectionHash === repeatedBenchmarkProjectionHash;
  const sameFocusedProjectionHash = focusedSummary.projectionHash === repeatedFocusedSummary.projectionHash;
  const sameFastPathDecisionHash = safeDecision.decisionHash === repeatedSafeDecision.decisionHash;
  const correctnessGatesRecordedBeforeLane = objectKeyBefore(
    snapshotEvidence,
    'correctnessGates',
    'fastPathLane',
  );
  const rolloutGate = rolloutSafetyGates(report)
    .find((gate) => gate.id === 'parallel-snapshot-hashing');
  const productionBlockers = productionThroughputBlockers(report);
  const release = supportOnlyReleaseProjection();
  const benchmarkGatesPass = snapshotEvidence.correctnessGates.every((gate) => gate.status === 'passed')
    && safeDecision.recomputedGates.every((gate) => gate.status === 'pass');
  const benchmarkLaneUpdatedOnlyAfterGatesHold = snapshotEvidence.fastPathLane.updated === true
    && safeDecision.updated
    && safeDecision.correctnessGatesHold
    && correctnessGatesRecordedBeforeLane;
  const focusedBlockedCasesWithholdLane = focusedSummary.correctness.blockedCasesHoldNoLaneUpdate
    && focusedSummary.fastPathLane.blocked === 9
    && focusedSummary.fastPathLane.unsafeFastPathOutputs === 0;
  const deterministicHashOnlyProjection = sameFocusedProjectionHash
    && sameSupportGateVector
    && sameBenchmarkProjectionHash
    && sameFastPathDecisionHash
    && parallelSnapshotHashEvidenceHasNoRawValues(firstProjection)
    && parallelSnapshotHashEvidenceHasNoRawValues(secondProjection);
  const productionSnapshotBlockerAbsent = !productionBlockers.includes('missing-parallel-snapshot-hashing-evidence');
  const gates = [
    proofGate('release-verifier-runtime-resources-gates-reported',
      hasRuntimeReport(report) && hasResourceReport(report) && hasPassFailGateReport(report), {
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      supportGateCount: supportGateVector.length,
    }),
    proofGate('parallel-snapshot-correctness-evidence-carried-through',
      benchmarkGatesPass
        && focusedSummary.correctness.updatedCasesAllGatesPassed
        && focusedSummary.correctness.blockedCasesHoldNoLaneUpdate
        && focusedBlockedCasesWithholdLane
        && rolloutGate?.status === 'passed', {
      benchmarkGateStatuses: snapshotEvidence.correctnessGates.map((gate) => gate.status),
      focusedCaseCount: focusedSummary.caseCount,
      rolloutGateStatus: rolloutGate?.status || 'missing',
    }),
    proofGate('fast-path-lane-withheld-until-correctness-gates-pass',
      benchmarkLaneUpdatedOnlyAfterGatesHold
        && focusedSummary.fastPathLane.updatesOnlyAfterCorrectnessGates
        && focusedSummary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold
        && focusedSummary.fastPathLane.unsafeFastPathOutputs === 0
        && focusedSummary.fastPathLane.updatesWithFailedGate === 0, {
      correctnessGatesRecordedBeforeLane,
      benchmarkCorrectnessGatesHold: safeDecision.correctnessGatesHold,
      focusedUpdates: focusedSummary.fastPathLane.updates,
      focusedBlocked: focusedSummary.fastPathLane.blocked,
    }),
    proofGate('deterministic-hash-only-release-verifier-evidence',
      deterministicHashOnlyProjection
        && focusedSummary.redaction.rawValueEvidenceLeaks === 0, {
      sameFocusedProjectionHash,
      sameSupportGateVector,
      sameBenchmarkProjectionHash,
      sameFastPathDecisionHash,
      focusedRawValueEvidenceLeaks: focusedSummary.redaction.rawValueEvidenceLeaks,
      benchmarkRawValueEvidenceLeaks: parallelSnapshotHashEvidenceHasNoRawValues(firstProjection) ? 0 : 1,
    }),
    proofGate('production-speed-claims-disabled',
      report.claims.productionThroughput.status === 'blocked'
        && report.rolloutSafetyGates.summary.speedClaimsAllowed === false
        && release.productionBacked === false
        && productionSnapshotBlockerAbsent, {
      productionThroughputStatus: report.claims.productionThroughput.status,
      remainingProductionBlockers: productionBlockers,
      speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
      productionSnapshotBlockerAbsent,
    }),
    proofGate('release-verifier-carry-through-claimed-support-only',
      release.releaseVerifierCarryThrough === 'support-only-claimed'
        && release.productionBacked === false
        && release.releaseEligible === false, {
      releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
    }),
    proofGate('support-only-release-no-go',
      release.supportOnly === true
        && release.productionBacked === false
        && release.finalReleaseStatus === 'NO-GO'
        && release.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
  const publicEvidence = {
    schemaVersion: 1,
    rppId: 'RPP-0790',
    proofId,
    variant: 5,
    evidenceSource: 'parallel-snapshot-hashing-release-verifier-v5',
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: release.finalReleaseStatus,
    integrationRecommendation: release.integrationRecommendation,
    releaseVerifier: {
      benchmarkId: snapshotEvidence.benchmarkId,
      benchmarkRunnerId: report.runtime.benchmarkId,
      command: 'node --test --test-name-pattern RPP-0790 test/rpp-0790-parallel-snapshot-hashing-release-verifier-v5.test.js',
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      carryThrough: release.releaseVerifierCarryThrough,
      passGateIds: supportGateVector.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
      failGateIds: supportGateVector.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
      requiredBenchmarkGateIds: [...requiredBenchmarkGateIds],
      correctnessGateIds: [...expectedSnapshotGateIds],
      rolloutGateStatus: rolloutGate?.status || 'missing',
      productionGateEvidence: 'not-present',
    },
    focusedRegression: focusedSummary,
    benchmarkCarryThrough: {
      sourceRppId: 'RPP-0710',
      benchmarkId: snapshotEvidence.benchmarkId,
      runnerBenchmarkId: report.runtime.benchmarkId,
      profile: report.profile,
      shape: {
        fileBytes: report.shape.fileBytes,
        chunkSizeBytes: report.shape.chunkSizeBytes,
        chunkCount: report.shape.chunkCount,
        rowCount: report.shape.rowCount,
        rowPayloadBytes: report.shape.rowPayloadBytes,
        snapshotHashResources: report.shape.snapshotHashResources,
        snapshotHashJobs: report.shape.snapshotHashJobs,
        snapshotHashConcurrency: report.shape.snapshotHashConcurrency,
        mutations: report.shape.mutations,
      },
      runtime: {
        budgetStatus: report.runtime.budgetStatus,
        durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
        heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
        maxDurationMs: report.runtime.budgets.maxDurationMs,
        maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      },
      rollout: {
        parallelSnapshotHashingGateStatus: rolloutGate?.status || 'missing',
        passed: report.rolloutSafetyGates.summary.passed,
        blocked: report.rolloutSafetyGates.summary.blocked,
        failed: report.rolloutSafetyGates.summary.failed,
      },
      productionThroughput: {
        status: report.claims.productionThroughput.status,
        blockerCount: report.claims.productionThroughput.blockers.length,
        speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
      },
    },
    scheduler: snapshotEvidence.scheduler,
    hashSet: {
      resourceCount: snapshotEvidence.hashSet.resourceCount,
      snapshotCount: snapshotEvidence.hashSet.snapshotCount,
      hashCount: snapshotEvidence.hashSet.hashCount,
      expectedHashCount: snapshotEvidence.hashSet.expectedHashCount,
      resourceTypeCounts: snapshotEvidence.hashSet.resourceTypeCounts,
      parallelDigest: snapshotEvidence.hashSet.parallelDigest,
      sequentialDigest: snapshotEvidence.hashSet.sequentialDigest,
      secondRunDigest: snapshotEvidence.hashSet.secondRunDigest,
      hashSampleHashes: snapshotEvidence.hashSet.hashSamples.map((sample) => digest(sample)),
    },
    applyBoundary: snapshotEvidence.applyBoundary,
    correctness: {
      gateIds: snapshotEvidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeLane,
      correctnessGatesHoldBeforeLaneUpdate: safeDecision.correctnessGatesHold,
      benchmarkLaneUpdatedOnlyAfterGatesHold,
      focusedBlockedCasesWithholdLane,
      rolloutGateStatus: rolloutGate?.status || 'missing',
      productionSnapshotBlockerAbsent,
      deterministicHashOnlyProjection,
      benchmarkSupportGateVector: supportGateStatusVector,
    },
    fastPathLane: {
      id: snapshotEvidence.fastPathLane.id,
      policy: snapshotEvidence.fastPathLane.policy,
      benchmarkUpdated: snapshotEvidence.fastPathLane.updated,
      outputEmittedAfterGates: safeDecision.outputEmitted,
      correctnessGatesEvaluatedBeforeUpdate: safeDecision.correctnessGatesRecordedBeforeLane
        && safeDecision.recordedGateIdsComplete,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      focusedUpdates: focusedSummary.fastPathLane.updates,
      focusedBlocked: focusedSummary.fastPathLane.blocked,
      blockedBy: safeDecision.blockedBy,
      focusedBlockedBy: focusedSummary.fastPathLane.blockedBy,
      outputHash: safeDecision.outputHash,
      proofDigestHash: digest(snapshotEvidence.fastPathLane.proofDigest),
      unsafeFastPathOutputs: focusedSummary.fastPathLane.unsafeFastPathOutputs,
      updatesWithFailedGate: focusedSummary.fastPathLane.updatesWithFailedGate,
      updatesOnlyAfterCorrectnessGates: focusedSummary.fastPathLane.updatesOnlyAfterCorrectnessGates
        && benchmarkLaneUpdatedOnlyAfterGatesHold,
      updatesOnlyWhenCorrectnessGatesHold: focusedSummary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold
        && safeDecision.correctnessGatesHold,
    },
    performance: {
      localSupportOnly: true,
      budgetStatus: report.runtime.budgetStatus === 'passed' ? 'passed' : 'failed',
      profile: report.profile,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
      jobsScheduled: snapshotEvidence.scheduler.jobsScheduled,
      waveCount: snapshotEvidence.scheduler.waveCount,
      fastPathLaneUpdated: snapshotEvidence.fastPathLane.updated,
      productionThroughput: release.productionThroughput,
      speedClaimsAllowed: release.speedClaimsAllowed,
    },
    gates,
    release,
    redaction: {
      mode: 'hash-count-only-release-verifier-proof',
      rawValuesIncluded: false,
      focusedRawValueEvidenceLeaks: focusedSummary.redaction.rawValueEvidenceLeaks,
      benchmarkRawValueEvidenceLeaks: parallelSnapshotHashEvidenceHasNoRawValues(firstProjection) ? 0 : 1,
      publicSnapshotEvidenceHash: benchmarkProjectionHash,
      repeatedSnapshotEvidenceHash: repeatedBenchmarkProjectionHash,
      focusedProjectionHash: focusedSummary.projectionHash,
      repeatedFocusedProjectionHash: repeatedFocusedSummary.projectionHash,
      focusedDecisionHashes: focusedSummary.redaction.decisionHashes,
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function buildFailGateReleaseVerifierProof(report) {
  const snapshotEvidence = report.evidence.parallelSnapshotHashing;
  const supportGateVector = snapshotBenchmarkGateVector(report);
  const failedGate = supportGateVector.find((gate) => gate.status === 'fail');
  const safeDecision = resolveVariant5FastPathLane(snapshotEvidence, {
    attemptedLaneUpdate: snapshotEvidence.fastPathLane.updated,
  });
  const release = supportOnlyReleaseProjection();
  const proof = {
    schemaVersion: 1,
    rppId: 'RPP-0790',
    variant: 5,
    evidenceSource: 'parallel-snapshot-hashing-release-verifier-fail-gate-v5',
    status: 'failed_support_gate',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: release.finalReleaseStatus,
    integrationRecommendation: release.integrationRecommendation,
    releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    passGateIds: supportGateVector.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
    failGateIds: supportGateVector.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    failedSupportGate: {
      id: failedGate.id,
      durationWithinBudget: failedGate.metrics.durationWithinBudget,
      heapWithinBudget: failedGate.metrics.heapWithinBudget,
      heapUsedBytes: failedGate.metrics.heapUsedBytes,
      maxHeapUsedBytes: failedGate.metrics.maxHeapUsedBytes,
    },
    snapshot: {
      benchmarkId: snapshotEvidence.benchmarkId,
      status: snapshotEvidence.status,
      scheduler: {
        maxConcurrency: snapshotEvidence.scheduler.maxConcurrency,
        maxObservedInFlight: snapshotEvidence.scheduler.maxObservedInFlight,
        bounded: snapshotEvidence.scheduler.bounded,
      },
      hashSet: {
        resourceCount: snapshotEvidence.hashSet.resourceCount,
        snapshotCount: snapshotEvidence.hashSet.snapshotCount,
        hashCount: snapshotEvidence.hashSet.hashCount,
        expectedHashCount: snapshotEvidence.hashSet.expectedHashCount,
        parallelDigest: snapshotEvidence.hashSet.parallelDigest,
        sequentialDigest: snapshotEvidence.hashSet.sequentialDigest,
        secondRunDigest: snapshotEvidence.hashSet.secondRunDigest,
      },
      correctnessGateStatuses: snapshotEvidence.correctnessGates.map((gate) => gate.status),
    },
    fastPathLane: {
      id: snapshotEvidence.fastPathLane.id,
      updated: snapshotEvidence.fastPathLane.updated,
      blockedBy: safeDecision.blockedBy,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      updatesOnlyAfterCorrectnessGates: safeDecision.correctnessGatesRecordedBeforeLane
        && safeDecision.recordedGateIdsComplete
        && safeDecision.correctnessGatesHold
        && snapshotEvidence.fastPathLane.updated === true,
      outputHash: safeDecision.outputHash,
    },
    release,
  };

  return {
    ...proof,
    evidenceHash: digest(proof),
  };
}

function resolveVariant5FastPathLane(evidence, { attemptedLaneUpdate }) {
  const recomputedGates = recomputeSnapshotGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const correctnessGates = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates
    : [];
  const recordedGateIds = correctnessGates.map((gate) => gate.id);
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedSnapshotGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && correctnessGates.every((gate) => gate.status === 'passed');
  const correctnessGatesRecordedBeforeLane = objectKeyBefore(
    evidence,
    'correctnessGates',
    'fastPathLane',
  );
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
    ...(!correctnessGatesRecordedBeforeLane ? ['correctness-gates-not-before-lane'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const updated = Boolean(attemptedLaneUpdate && correctnessGatesHold);
  const output = updated
    ? {
        proofId,
        id: evidence.fastPathLane?.id || fastPathLaneId,
        policy: 'update-only-after-correctness-gates-pass',
        gateVectorHash: sha256Label(recomputedGates),
        hashSetDigest: sha256Label({
          parallelDigest: evidence.hashSet.parallelDigest,
          sequentialDigest: evidence.hashSet.sequentialDigest,
          secondRunDigest: evidence.hashSet.secondRunDigest,
        }),
        schedulerDigest: sha256Label({
          maxConcurrency: evidence.scheduler.maxConcurrency,
          maxObservedInFlight: evidence.scheduler.maxObservedInFlight,
          jobsScheduled: evidence.scheduler.jobsScheduled,
          waveCount: evidence.scheduler.waveCount,
        }),
      }
    : null;
  const publicDecision = {
    updated,
    outputEmitted: Boolean(output),
    attemptedLaneUpdate,
    attemptedLaneUpdateBlocked: Boolean(attemptedLaneUpdate && !correctnessGatesHold),
    correctnessGatesHold,
    correctnessGatesRecordedBeforeLane,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    blockedBy,
    recomputedGates,
    outputHash: output ? sha256Label(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeSnapshotGates(evidence) {
  const scheduler = evidence.scheduler || {};
  const hashSet = evidence.hashSet || {};
  const applyBoundary = evidence.applyBoundary || {};
  const expectedHashCount = hashSet.resourceCount * hashSet.snapshotCount;
  const hashOnlyEvidence = parallelSnapshotHashEvidenceHasNoRawValues(publicSnapshotEvidenceProjection(evidence));

  return [
    proofGate('bounded-hash-concurrency', scheduler.bounded === true
      && scheduler.maxObservedInFlight <= scheduler.maxConcurrency
      && scheduler.maxConcurrency <= scheduler.maxAllowedConcurrency, {
      maxObservedInFlight: scheduler.maxObservedInFlight,
      maxConcurrency: scheduler.maxConcurrency,
      maxAllowedConcurrency: scheduler.maxAllowedConcurrency,
    }),
    proofGate('complete-snapshot-hash-set', hashSet.complete === true
      && hashSet.hashCount === hashSet.expectedHashCount
      && hashSet.expectedHashCount === expectedHashCount, {
      hashCount: hashSet.hashCount,
      expectedHashCount: hashSet.expectedHashCount,
    }),
    proofGate('parallel-matches-sequential', hashSet.parallelMatchesSequential === true
      && hashSet.parallelDigest === hashSet.sequentialDigest, {
      parallelDigest: hashSet.parallelDigest,
      sequentialDigest: hashSet.sequentialDigest,
    }),
    proofGate('deterministic-hash-set', hashSet.deterministicDigestMatches === true
      && hashSet.parallelDigest === hashSet.secondRunDigest, {
      firstRunDigest: hashSet.parallelDigest,
      secondRunDigest: hashSet.secondRunDigest,
    }),
    proofGate('planning-only-no-write-authority', applyBoundary.planningOnly === true
      && applyBoundary.authorizesApply === false
      && applyBoundary.applyMustRevalidate === true
      && applyBoundary.everyMutationHasLiveRemotePrecondition === true, {
      planningOnly: applyBoundary.planningOnly,
      authorizesApply: applyBoundary.authorizesApply,
      applyMustRevalidate: applyBoundary.applyMustRevalidate,
      everyMutationHasLiveRemotePrecondition: applyBoundary.everyMutationHasLiveRemotePrecondition,
    }),
    proofGate('hash-only-evidence', hashOnlyEvidence, {
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
    }),
  ];
}

function variant5SnapshotHashCases() {
  const correctEvidence = syntheticSnapshotEvidence();
  return [
    {
      id: 'bounded-correct-snapshot-hashes',
      evidence: correctEvidence,
      expected: {
        updated: true,
        blockedBy: [],
      },
    },
    {
      id: 'stale-parallel-digest',
      evidence: syntheticSnapshotEvidence({
        hashSet: {
          parallelDigest: sha256Label('rpp-0790-stale-parallel-digest'),
          secondRunDigest: sha256Label('rpp-0790-stale-parallel-digest'),
          parallelMatchesSequential: false,
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['parallel-matches-sequential'],
      },
    },
    {
      id: 'incomplete-snapshot-hash-set',
      evidence: syntheticSnapshotEvidence({
        hashSet: {
          hashCount: 5,
          complete: false,
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['complete-snapshot-hash-set'],
      },
    },
    {
      id: 'unbounded-hash-concurrency',
      evidence: syntheticSnapshotEvidence({
        scheduler: {
          maxObservedInFlight: 3,
          bounded: false,
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['bounded-hash-concurrency'],
      },
    },
    {
      id: 'nondeterministic-second-run-digest',
      evidence: syntheticSnapshotEvidence({
        hashSet: {
          secondRunDigest: sha256Label('rpp-0790-nondeterministic-second-run'),
          deterministicDigestMatches: false,
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['deterministic-hash-set'],
      },
    },
    {
      id: 'unsafe-apply-boundary',
      evidence: syntheticSnapshotEvidence({
        applyBoundary: {
          liveRemoteMutationPreconditions: 0,
          everyMutationHasLiveRemotePrecondition: false,
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['planning-only-no-write-authority'],
      },
    },
    {
      id: 'raw-snapshot-value-leak',
      evidence: syntheticSnapshotEvidence({
        hashSet: {
          hashSamples: [
            {
              snapshot: 'base',
              resourceType: 'row',
              resourceKey: 'row-payload-redaction-sentinel',
              resourceKeyHash: sha256Label('rpp-0790-redaction-key'),
              resourceValueHash: sha256Label('rpp-0790-redaction-value'),
              workerSlot: 0,
              waveIndex: 0,
            },
          ],
        },
      }),
      expected: {
        updated: false,
        blockedBy: ['hash-only-evidence'],
      },
    },
    {
      id: 'premature-lane-attempt-without-recorded-gates',
      evidence: syntheticSnapshotEvidence({
        correctnessGates: [],
      }),
      expected: {
        updated: false,
        blockedBy: ['correctness-gates-not-recorded'],
      },
    },
    {
      id: 'recorded-gate-status-failed',
      evidence: syntheticSnapshotEvidence({
        correctnessGates: expectedSnapshotGateIds.map((id, index) => ({
          id,
          status: index === 0 ? 'failed' : 'passed',
          evidence: {
            gateStatusHash: sha256Label(`rpp-0790-recorded-gate-${id}-${index}`),
          },
        })),
      }),
      expected: {
        updated: false,
        blockedBy: ['correctness-gates-not-passed'],
      },
    },
    {
      id: 'lane-recorded-before-gates',
      evidence: withFastPathLaneBeforeCorrectnessGates(syntheticSnapshotEvidence()),
      expected: {
        updated: false,
        blockedBy: ['correctness-gates-not-before-lane'],
      },
    },
  ];
}

function syntheticSnapshotEvidence(overrides = {}) {
  const hashDigest = sha256Label('synthetic-safe-snapshot-hash-set');
  const scheduler = {
    maxConcurrency: 2,
    maxAllowedConcurrency: 2,
    maxObservedInFlight: 2,
    workerSlotsUsed: 2,
    waveCount: 3,
    jobsScheduled: 6,
    scheduleDigest: sha256Label('synthetic-safe-schedule'),
    bounded: true,
    ...(overrides.scheduler || {}),
  };
  const hashSet = {
    resourceCount: 2,
    snapshotCount: 3,
    hashCount: 6,
    expectedHashCount: 6,
    resourceTypeCounts: { file: 1, plugin: 0, row: 1 },
    parallelDigest: hashDigest,
    sequentialDigest: hashDigest,
    secondRunDigest: hashDigest,
    parallelMatchesSequential: true,
    deterministicDigestMatches: true,
    complete: true,
    hashSamples: [
      {
        snapshot: 'base',
        resourceType: 'file',
        resourceKeyHash: sha256Label('synthetic-file-key'),
        resourceValueHash: sha256Label('synthetic-file-value'),
        workerSlot: 0,
        waveIndex: 0,
      },
    ],
    ...(overrides.hashSet || {}),
  };
  const applyBoundary = {
    planningOnly: true,
    authorizesApply: false,
    applyMustRevalidate: true,
    liveRemoteMutationPreconditions: 2,
    everyMutationHasLiveRemotePrecondition: true,
    ...(overrides.applyBoundary || {}),
  };
  const core = {
    benchmarkId: snapshotHashingBenchmarkId,
    variant: 1,
    scope: 'synthetic-bounded-snapshot-hash-set',
    mode: 'bounded-parallel-scheduler-proof',
    status: overrides.status || 'passed',
    scheduler,
    hashSet,
    applyBoundary,
  };
  const correctnessGates = overrides.correctnessGates ?? recomputeSnapshotGates(core).map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidence: gate.metrics,
  }));
  const fastPathLane = {
    id: fastPathLaneId,
    policy: 'update-only-after-correctness-gates-pass',
    updated: true,
    blockedBy: [],
    proofDigest: sha256Label('synthetic-safe-lane-proof'),
    ...(overrides.fastPathLane || {}),
  };

  return {
    ...core,
    correctnessGates,
    fastPathLane,
  };
}

function withFastPathLaneBeforeCorrectnessGates(evidence) {
  return {
    benchmarkId: evidence.benchmarkId,
    variant: evidence.variant,
    scope: evidence.scope,
    mode: evidence.mode,
    status: evidence.status,
    scheduler: evidence.scheduler,
    hashSet: evidence.hashSet,
    applyBoundary: evidence.applyBoundary,
    fastPathLane: evidence.fastPathLane,
    correctnessGates: evidence.correctnessGates,
  };
}

function summarizeReleaseVerifierSnapshotMatrix(decisions) {
  const blockerCounts = {};
  for (const decision of decisions) {
    for (const blocker of decision.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const updatedCases = decisions.filter((decision) => decision.updated);
  const blockedCases = decisions.filter((decision) => !decision.updated);
  const unsafeFastPathOutputs = decisions.filter((decision) =>
    decision.updated && !decision.correctnessGatesHold
  ).length;
  const updatesWithFailedGate = decisions.filter((decision) =>
    decision.updated && decision.recomputedGates.some((gate) => gate.status !== 'pass')
  ).length;
  const updatesOnlyAfterCorrectnessGates = updatedCases.every((decision) =>
    decision.correctnessGatesRecordedBeforeLane
      && decision.recordedGateIdsComplete
      && decision.recordedGateStatusesHold
  );
  const updatesOnlyWhenCorrectnessGatesHold = decisions.every((decision) =>
    decision.updated === decision.correctnessGatesHold
  );
  const updatedCasesAllGatesPassed = updatedCases.length > 0
    && updatedCases.every((decision) =>
      decision.recomputedGates.every((gate) => gate.status === 'pass')
        && decision.correctnessGatesHold
    );
  const blockedCasesHoldNoLaneUpdate = blockedCases.length > 0
    && blockedCases.every((decision) =>
      decision.updated === false
        && decision.outputEmitted === false
        && decision.attemptedLaneUpdateBlocked === true
        && decision.blockedBy.length > 0
    );
  const redaction = {
    mode: 'hash-count-only-release-verifier-proof',
    rawValueEvidenceLeaks: decisions.filter((decision) =>
      !parallelSnapshotHashEvidenceHasNoRawValues(decision)
    ).length,
    decisionHashes: decisions.map((decision) => decision.decisionHash),
  };
  const summary = {
    source: 'RPP-0790 local release-verifier snapshot matrix',
    caseIds: decisions.map((decision) => decision.caseId),
    caseCount: decisions.length,
    correctness: {
      gateIds: [...expectedSnapshotGateIds],
      updatedCasesAllGatesPassed,
      blockedCasesHoldNoLaneUpdate,
    },
    fastPathLane: {
      id: fastPathLaneId,
      policy: 'update-only-after-correctness-gates-pass',
      updates: updatedCases.length,
      blocked: blockedCases.length,
      blockedBy: sortedObject(blockerCounts),
      updatesOnlyAfterCorrectnessGates,
      updatesOnlyWhenCorrectnessGatesHold,
      unsafeFastPathOutputs,
      updatesWithFailedGate,
    },
    redaction,
  };

  return {
    ...summary,
    projectionHash: digest(summary),
  };
}

function snapshotBenchmarkGateVector(report) {
  return [
    proofGate('runtime-resource-budget', report.runtime.budgetStatus === 'passed', {
      durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
      heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
      heapUsedBytes: report.runtime.budgetEvidence.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
    }),
    ...report.evidence.parallelSnapshotHashing.correctnessGates.map((gate) => ({
      id: gate.id,
      status: gate.status === 'passed' ? 'pass' : 'fail',
      metrics: gate.evidence,
    })),
  ];
}

function gateStatuses(gates) {
  return gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
}

function publicSnapshotEvidenceProjection(evidence) {
  return {
    benchmarkId: evidence.benchmarkId,
    variant: evidence.variant,
    status: evidence.status,
    scheduler: evidence.scheduler,
    hashSet: {
      resourceCount: evidence.hashSet?.resourceCount,
      snapshotCount: evidence.hashSet?.snapshotCount,
      hashCount: evidence.hashSet?.hashCount,
      expectedHashCount: evidence.hashSet?.expectedHashCount,
      resourceTypeCounts: evidence.hashSet?.resourceTypeCounts,
      parallelDigest: evidence.hashSet?.parallelDigest,
      sequentialDigest: evidence.hashSet?.sequentialDigest,
      secondRunDigest: evidence.hashSet?.secondRunDigest,
      parallelMatchesSequential: evidence.hashSet?.parallelMatchesSequential,
      deterministicDigestMatches: evidence.hashSet?.deterministicDigestMatches,
      complete: evidence.hashSet?.complete,
      hashSamples: evidence.hashSet?.hashSamples || [],
    },
    correctnessGates: (evidence.correctnessGates || []).map((gate) => ({
      id: gate.id,
      status: gate.status,
      evidence: gate.evidence,
    })),
    fastPathLane: {
      id: evidence.fastPathLane?.id,
      policy: evidence.fastPathLane?.policy,
      updated: evidence.fastPathLane?.updated,
      blockedBy: evidence.fastPathLane?.blockedBy || [],
      proofDigestHash: digest(evidence.fastPathLane?.proofDigest || null),
    },
    applyBoundary: evidence.applyBoundary,
  };
}

function supportOnlyReleaseProjection() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-claimed',
    releaseVerifierScope: 'local-parallel-snapshot-hashing-support-evidence',
    liveTopology: 'not-claimed',
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-production-gate-not-present',
    ],
  };
}

function hasRuntimeReport(report) {
  return report.runtime
    && report.runtime.benchmarkId === guardedExecutorBenchmarkId
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.process
    && report.shape
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.shape.snapshotHashResources === 'number'
    && typeof report.shape.snapshotHashJobs === 'number'
    && typeof report.shape.snapshotHashConcurrency === 'number';
}

function hasPassFailGateReport(report) {
  const gateVector = snapshotBenchmarkGateVector(report);
  return gateVector.length === requiredBenchmarkGateIds.length
    && gateVector.every((gate) => requiredBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status));
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function rolloutSafetyGates(report) {
  return Array.isArray(report.rolloutSafetyGates)
    ? report.rolloutSafetyGates
    : report.rolloutSafetyGates.gates;
}

function parallelSnapshotHashEvidenceHasNoRawValues(evidence) {
  const serialized = JSON.stringify(evidence);
  return !rawSnapshotValuePattern().test(serialized)
    && !(evidence.hashSet?.hashSamples || []).some((sample) =>
      Object.hasOwn(sample, 'resourceKey') || Object.hasOwn(sample, 'resourceValue')
    );
}

function assertProjectionHasNoRawSnapshotValues(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, rawSnapshotValuePattern());
  assert.equal(serialized.includes('"resourceKey":'), false);
  assert.equal(serialized.includes('"resourceValue":'), false);
}

function rawSnapshotValuePattern() {
  return /row-payload|commerce_bench|catalog identity|Benchmark child post|Benchmark featured attachment|benchmark-topic|catalog-export\.bin|wp-content\/plugins|_thumbnail_id|_benchmark_term_flag|"resourceKey":|"resourceValue":/i;
}

function sha256Label(value) {
  return `sha256:${digest(value)}`;
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

function unique(values) {
  return [...new Set(values)];
}

function sortedObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}
