import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0750-parallel-snapshot-hashing-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const snapshotHashingBenchmarkId = 'rpp-0710-parallel-snapshot-hashing';
const fastPathLaneId = 'parallel-snapshot-hash-fast-path';
const expectedSnapshotGateIds = Object.freeze([
  'bounded-hash-concurrency',
  'complete-snapshot-hash-set',
  'parallel-matches-sequential',
  'deterministic-hash-set',
  'planning-only-no-write-authority',
  'hash-only-evidence',
]);

test('RPP-0750 variant 3 generated snapshot hash matrix gates fast-path lane updates', () => {
  const cases = generatedSnapshotHashCases();
  const decisions = cases.map((snapshotCase) => {
    const decision = resolveVariant3FastPathLane(snapshotCase.evidence, {
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
      assert.match(decision.outputHash, /^sha256:[a-f0-9]{64}$/, snapshotCase.id);
    } else {
      assert.equal(decision.outputHash, null, snapshotCase.id);
      for (const blocker of snapshotCase.expected.blockedBy) {
        assert.ok(decision.blockedBy.includes(blocker), `${snapshotCase.id} missing ${blocker}`);
      }
    }

    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/, snapshotCase.id);
    assertProjectionHasNoRawSnapshotValues(decision);
    return { ...decision, caseId: snapshotCase.id };
  });
  const summary = generatedMatrixSummary(decisions);

  assert.equal(summary.cases, 9);
  assert.equal(summary.laneUpdates, 1);
  assert.equal(summary.blocked, 8);
  assert.equal(summary.unsafeFastPathOutputs, 0);
  assert.equal(summary.blockerCounts['bounded-hash-concurrency'], 1);
  assert.equal(summary.blockerCounts['complete-snapshot-hash-set'], 1);
  assert.equal(summary.blockerCounts['parallel-matches-sequential'], 1);
  assert.equal(summary.blockerCounts['deterministic-hash-set'], 1);
  assert.equal(summary.blockerCounts['planning-only-no-write-authority'], 1);
  assert.equal(summary.blockerCounts['hash-only-evidence'], 1);
  assert.equal(summary.blockerCounts['correctness-gates-not-recorded'], 1);
  assert.equal(summary.blockerCounts['correctness-gates-not-before-lane'], 1);
});

test('RPP-0750 variant 3 projects local support-only storage performance evidence', {
  concurrency: false,
}, () => {
  const first = runSmallBenchmark();
  const second = runSmallBenchmark();
  const proof = buildVariant3Proof(first, second);

  assert.equal(proof.rppId, 'RPP-0750');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-snapshot-hash-cases');
  assert.equal(proof.generatedCoverage.caseCount, 9);
  assert.equal(proof.generatedCoverage.laneUpdates, 1);
  assert.equal(proof.generatedCoverage.blockedLaneAttempts, 8);
  assert.equal(proof.generatedCoverage.unsafeFastPathOutputs, 0);
  assert.equal(proof.builtOn.rppId, 'RPP-0710');
  assert.equal(proof.builtOn.benchmarkId, snapshotHashingBenchmarkId);
  assert.equal(proof.builtOn.variant, 1);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

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
  assert.equal(proof.correctness.generatedBlockedCasesWithholdLane, true);
  assert.equal(proof.correctness.rolloutGateStatus, 'passed');
  assert.equal(proof.correctness.productionBlockerAbsent, true);

  assert.equal(proof.fastPathLane.id, fastPathLaneId);
  assert.equal(proof.fastPathLane.policy, 'update-only-after-correctness-gates-pass');
  assert.equal(proof.fastPathLane.updated, true);
  assert.equal(proof.fastPathLane.outputEmittedAfterGates, true);
  assert.equal(proof.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true);
  assert.equal(proof.fastPathLane.correctnessGatesHold, true);
  assert.equal(proof.fastPathLane.unsafeFastPathOutputs, 0);
  assert.deepEqual(proof.fastPathLane.blockedBy, []);
  assert.match(proof.fastPathLane.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.fastPathLane.proofDigestHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.performance.localSupportOnly, true);
  assert.equal(proof.performance.budgetStatus, 'passed');
  assert.equal(proof.performance.durationWithinBudget, true);
  assert.equal(proof.performance.heapWithinBudget, true);
  assert.equal(proof.performance.productionThroughput, 'not-claimed');
  assert.equal(proof.performance.speedClaimsAllowed, false);

  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(gateById(proof, 'deterministic-hash-only-projection').metrics.sameProjectionHash, true);
  assert.equal(gateById(proof, 'local-performance-budget-support-only').metrics.speedClaimsAllowed, false);

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(proof.release.productionRowBatchExecutor, 'not-claimed');
  assert.equal(proof.release.productionAtomicGroupCommit, 'not-claimed');
  assert.equal(proof.release.liveTopology, 'not-claimed');
  assert.equal(proof.release.credentials, 'not-claimed');
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawSnapshotValues(proof);

  const failingBudgetProof = buildVariant3Proof(
    runSmallBenchmark({ maxHeapUsedBytes: 1 }),
    runSmallBenchmark({ maxHeapUsedBytes: 1 }),
  );
  assert.equal(failingBudgetProof.status, 'failed');
  assert.equal(gateById(failingBudgetProof, 'local-performance-budget-support-only').status, 'fail');
  assert.equal(failingBudgetProof.performance.budgetStatus, 'failed');
  assert.equal(failingBudgetProof.performance.heapWithinBudget, false);
  assert.equal(failingBudgetProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(failingBudgetProof.release.integrationRecommendation, 'NO-GO');
  assertProjectionHasNoRawSnapshotValues(failingBudgetProof);
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
    tempDir: fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0750-')),
    ...overrides,
  });
}

function buildVariant3Proof(report, repeatedReport) {
  const snapshotEvidence = report.evidence.parallelSnapshotHashing;
  const repeatedSnapshotEvidence = repeatedReport.evidence.parallelSnapshotHashing;
  const firstProjection = publicSnapshotEvidenceProjection(snapshotEvidence);
  const secondProjection = publicSnapshotEvidenceProjection(repeatedSnapshotEvidence);
  const deterministicProjection = digest(firstProjection) === digest(secondProjection);
  const safeDecision = resolveVariant3FastPathLane(snapshotEvidence, {
    attemptedLaneUpdate: snapshotEvidence.fastPathLane.updated,
  });
  const generatedDecisions = generatedSnapshotHashCases().map((snapshotCase) => ({
    caseId: snapshotCase.id,
    ...resolveVariant3FastPathLane(snapshotCase.evidence, {
      attemptedLaneUpdate: true,
    }),
  }));
  const generatedCoverage = generatedMatrixSummary(generatedDecisions);
  const supportOnlyRelease = supportOnlyReleasePosture();
  const correctnessGatesRecordedBeforeLane = objectKeyBefore(
    snapshotEvidence,
    'correctnessGates',
    'fastPathLane',
  );
  const rolloutGate = rolloutSafetyGates(report)
    .find((gate) => gate.id === 'parallel-snapshot-hashing');
  const productionBlockers = productionThroughputBlockers(report);
  const productionBlockerAbsent = !productionBlockers.includes('missing-parallel-snapshot-hashing-evidence');
  const benchmarkGatesPass = snapshotEvidence.correctnessGates.every((gate) => gate.status === 'passed')
    && safeDecision.recomputedGates.every((gate) => gate.status === 'pass');
  const benchmarkLaneUpdatedOnlyAfterGatesHold = snapshotEvidence.fastPathLane.updated === true
    && safeDecision.updated
    && safeDecision.correctnessGatesHold
    && correctnessGatesRecordedBeforeLane;
  const generatedBlockedCasesWithholdLane = generatedDecisions
    .filter((decision) => decision.caseId !== 'bounded-correct-snapshot-hashes')
    .every((decision) => (
      decision.updated === false
      && decision.outputEmitted === false
      && decision.attemptedLaneUpdateBlocked === true
    ));
  const gates = [
    proofGate('benchmark-snapshot-hashing-correctness-gates-pass', benchmarkGatesPass, {
      recomputedGateVector: safeDecision.recomputedGates,
      recordedGateStatuses: snapshotEvidence.correctnessGates.map((gate) => gate.status),
    }),
    proofGate('fast-path-lane-after-correctness-gates-hold',
      benchmarkLaneUpdatedOnlyAfterGatesHold
        && safeDecision.outputEmitted
        && generatedCoverage.unsafeFastPathOutputs === 0, {
      correctnessGatesRecordedBeforeLane,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      outputEmitted: safeDecision.outputEmitted,
      unsafeFastPathOutputs: generatedCoverage.unsafeFastPathOutputs,
    }),
    proofGate('generated-unsafe-snapshot-cases-block-lane',
      generatedCoverage.caseCount === 9
        && generatedCoverage.laneUpdates === 1
        && generatedCoverage.blockedLaneAttempts === 8
        && generatedBlockedCasesWithholdLane, {
      caseIds: generatedCoverage.caseIds,
      blockerCounts: generatedCoverage.blockerCounts,
    }),
    proofGate('deterministic-hash-only-projection',
      deterministicProjection
        && parallelSnapshotHashEvidenceHasNoRawValues(firstProjection)
        && parallelSnapshotHashEvidenceHasNoRawValues(secondProjection), {
      firstEvidenceHash: digest(firstProjection),
      secondEvidenceHash: digest(secondProjection),
      sameProjectionHash: deterministicProjection,
    }),
    proofGate('local-performance-budget-support-only',
      report.runtime.budgetStatus === 'passed'
        && supportOnlyRelease.productionThroughput === 'not-claimed'
        && supportOnlyRelease.speedClaimsAllowed === false, {
      budgetStatus: report.runtime.budgetStatus,
      durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
      heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
      productionThroughput: supportOnlyRelease.productionThroughput,
      speedClaimsAllowed: supportOnlyRelease.speedClaimsAllowed,
    }),
    proofGate('production-speed-claims-disabled',
      report.claims.productionThroughput.status === 'blocked'
        && supportOnlyRelease.productionBacked === false
        && productionBlockerAbsent, {
      productionThroughputStatus: report.claims.productionThroughput.status,
      remainingProductionBlockers: productionBlockers,
      productionBlockerAbsent,
    }),
    proofGate('support-only-release-no-go',
      supportOnlyRelease.supportOnly === true
        && supportOnlyRelease.productionBacked === false
        && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
        && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicEvidence = {
    rppId: 'RPP-0750',
    proofId,
    variant: 3,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0710',
      benchmarkId: snapshotEvidence.benchmarkId,
      variant: snapshotEvidence.variant,
      evidenceHash: digest(firstProjection),
    },
    generatedCoverage: {
      source: 'local-support-generated-snapshot-hash-cases',
      caseIds: generatedCoverage.caseIds,
      caseCount: generatedCoverage.caseCount,
      laneUpdates: generatedCoverage.laneUpdates,
      blockedLaneAttempts: generatedCoverage.blockedLaneAttempts,
      blockerCounts: generatedCoverage.blockerCounts,
      unsafeFastPathOutputs: generatedCoverage.unsafeFastPathOutputs,
      decisionHashes: generatedCoverage.decisionHashes,
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
    correctness: {
      gateIds: snapshotEvidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeLane,
      correctnessGatesHoldBeforeLaneUpdate: safeDecision.correctnessGatesHold,
      benchmarkLaneUpdatedOnlyAfterGatesHold,
      generatedBlockedCasesWithholdLane,
      rolloutGateStatus: rolloutGate?.status || 'missing',
      productionBlockerAbsent,
    },
    fastPathLane: {
      id: snapshotEvidence.fastPathLane.id,
      policy: snapshotEvidence.fastPathLane.policy,
      updated: snapshotEvidence.fastPathLane.updated,
      outputEmittedAfterGates: safeDecision.outputEmitted,
      correctnessGatesEvaluatedBeforeUpdate: safeDecision.correctnessGatesRecordedBeforeLane
        && safeDecision.recordedGateIdsComplete,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      blockedBy: safeDecision.blockedBy,
      outputHash: safeDecision.outputHash,
      proofDigestHash: digest(snapshotEvidence.fastPathLane.proofDigest),
      unsafeFastPathOutputs: generatedCoverage.unsafeFastPathOutputs,
    },
    performance: {
      localSupportOnly: true,
      budgetStatus: report.runtime.budgetStatus === 'passed' ? 'passed' : 'failed',
      profile: report.profile,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
      heapUsedBytes: report.runtime.budgetEvidence.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
      jobsScheduled: snapshotEvidence.scheduler.jobsScheduled,
      waveCount: snapshotEvidence.scheduler.waveCount,
      fastPathLaneUpdated: snapshotEvidence.fastPathLane.updated,
      productionThroughput: supportOnlyRelease.productionThroughput,
      speedClaimsAllowed: supportOnlyRelease.speedClaimsAllowed,
    },
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-and-count-only-local-support-proof',
      rawValueEvidenceLeaks: parallelSnapshotHashEvidenceHasNoRawValues(firstProjection) ? 0 : 1,
      publicSnapshotEvidenceHash: digest(firstProjection),
      repeatedSnapshotEvidenceHash: digest(secondProjection),
      generatedDecisionHashes: generatedCoverage.decisionHashes,
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function resolveVariant3FastPathLane(evidence, { attemptedLaneUpdate }) {
  const recomputedGates = recomputeSnapshotGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedSnapshotGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
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
  const output = correctnessGatesHold
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
    updated: correctnessGatesHold,
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

function generatedSnapshotHashCases() {
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
          parallelDigest: sha256Label('rpp-0750-stale-parallel-digest'),
          secondRunDigest: sha256Label('rpp-0750-stale-parallel-digest'),
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
          secondRunDigest: sha256Label('rpp-0750-nondeterministic-second-run'),
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
              resourceKeyHash: sha256Label('rpp-0750-redaction-key'),
              resourceValueHash: sha256Label('rpp-0750-redaction-value'),
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

function generatedMatrixSummary(decisions) {
  const blockerCounts = {};
  for (const decision of decisions) {
    for (const blocker of decision.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const laneUpdates = decisions.filter((decision) => decision.updated).length;

  return {
    caseIds: decisions.map((decision) => decision.caseId),
    cases: decisions.length,
    caseCount: decisions.length,
    laneUpdates,
    blocked: decisions.length - laneUpdates,
    blockedLaneAttempts: decisions.length - laneUpdates,
    unsafeFastPathOutputs: decisions.filter((decision) =>
      decision.updated && !decision.correctnessGatesHold
    ).length,
    blockerCounts: sortedObject(blockerCounts),
    decisionHashes: decisions.map((decision) => decision.decisionHash),
  };
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

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    liveTopology: 'not-claimed',
    credentials: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
      'live-topology-not-measured',
    ],
  };
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

function gateById(proof, id) {
  const gate = proof.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
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
