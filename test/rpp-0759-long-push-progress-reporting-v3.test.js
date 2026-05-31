import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LONG_PUSH_PROGRESS_BENCHMARK_ID,
  LONG_PUSH_PROGRESS_POLICY_ID,
  runLongPushProgressReportingBenchmark,
} from '../scripts/bench/rpp-0719-long-push-progress-reporting.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0759-long-push-progress-reporting-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 256 * MIB;
const maxActionsBetweenReports = 8;
const maxUploadBytesBetweenReports = 64 * MIB;
const minOperatorEvents = 32;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const expectedRequiredPhases = Object.freeze([
  'plan-scan',
  'prepare',
  'transfer',
  'publish',
  'database-batch',
  'plugin-metadata',
  'group-finalize',
  'commit',
]);
const expectedGateIds = Object.freeze([
  'benchmark-gates-pass',
  'documented-large-site-budget',
  'progress-policy-v3-support-contract',
  'phase-coverage-complete',
  'monotonic-progress-events',
  'bounded-operator-update-gaps',
  'durable-cursor-hashes-match',
  'completion-after-final-durable-evidence',
  'hash-only-progress-evidence',
  'support-only-release-no-go',
]);
const expectedGeneratedCaseIds = Object.freeze([
  'passing-large-site-progress-budget',
  'over-budget-runtime',
  'missing-progress-event',
  'stale-cursor-hash',
  'missing-phase-coverage',
  'minimum-operator-events-too-high',
  'raw-progress-value-leak',
  'premature-pass-status',
]);

test('RPP-0759 variant 3 generated progress cases gate long-push output', () => {
  const cases = generatedLongPushProgressCases();
  const decisions = cases.map((progressCase) => {
    const decision = resolveLongPushProgressProof(progressCase.evidence);

    assert.equal(decision.updated, progressCase.expected.updated, progressCase.id);
    assert.equal(decision.outputEmitted, progressCase.expected.updated, progressCase.id);
    assert.equal(decision.correctnessGatesHold, progressCase.expected.updated, progressCase.id);
    assert.equal(decision.output === null, !progressCase.expected.updated, progressCase.id);
    assert.deepEqual(decision.recomputedGates.map((gate) => gate.id), expectedGateIds, progressCase.id);

    if (progressCase.expected.updated) {
      assert.deepEqual(decision.blockedBy, [], progressCase.id);
      assert.match(decision.outputHash, sha256Pattern, progressCase.id);
      assert.deepEqual(decision.recomputedGates.map((gate) => gate.status), [
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
      ], progressCase.id);
    } else {
      assert.equal(decision.outputHash, null, progressCase.id);
      assert.equal(decision.attemptedPassBlocked, true, progressCase.id);
      for (const blocker of progressCase.expected.blockedBy) {
        assert.ok(decision.blockedBy.includes(blocker), `${progressCase.id} missing ${blocker}`);
      }
    }

    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/, progressCase.id);
    assertHashOnlyLongPushProgressEvidence(decision);
    return {
      ...decision,
      caseId: progressCase.id,
      expectedUpdated: progressCase.expected.updated,
    };
  });
  const summary = generatedCoverageSummary(decisions);

  assert.deepEqual(summary.caseIds, expectedGeneratedCaseIds);
  assert.equal(summary.caseCount, 8);
  assert.equal(summary.outputEmitted, 1);
  assert.equal(summary.blockedCaseCount, 7);
  assert.equal(summary.unsafeOutputs, 0);
  assert.equal(summary.blockerCounts['documented-large-site-budget'], 1);
  assert.equal(summary.blockerCounts['bounded-operator-update-gaps'], 2);
  assert.equal(summary.blockerCounts['durable-cursor-hashes-match'], 1);
  assert.equal(summary.blockerCounts['phase-coverage-complete'], 1);
  assert.equal(summary.blockerCounts['hash-only-progress-evidence'], 1);
  assert.equal(summary.blockerCounts['correctness-gates-not-recorded'], 1);
});

test('RPP-0759 variant 3 proves long-push progress budgets and support-only NO-GO', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0759');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-long-push-progress-cases');
  assert.deepEqual(proof.generatedCoverage.caseIds, expectedGeneratedCaseIds);
  assert.equal(proof.generatedCoverage.caseCount, 8);
  assert.equal(proof.generatedCoverage.outputEmitted, 1);
  assert.equal(proof.generatedCoverage.blockedCaseCount, 7);
  assert.equal(proof.generatedCoverage.unsafeOutputs, 0);
  assert.equal(proof.builtOn.rppId, 'RPP-0719');
  assert.equal(proof.builtOn.benchmark, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.equal(proof.builtOn.policyId, LONG_PUSH_PROGRESS_POLICY_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.equal(proof.builtOn.profile, 'large-site');
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.budgets.profile, 'large-site');
  assert.equal(proof.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, maxHeapUsedBytes);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.workload.uploadBytes >= GIB, true);
  assert.equal(proof.resources.workload.uploadChunks, 206);
  assert.equal(proof.resources.workload.dbRows, 12_620);
  assert.equal(proof.resources.workload.totalActions, 254);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.progressCollection.policy.policyId, LONG_PUSH_PROGRESS_POLICY_ID);
  assert.equal(proof.progressCollection.policy.sourceVariant, 1);
  assert.equal(proof.progressCollection.policy.proofVariant, 3);
  assert.equal(proof.progressCollection.policy.completionRule, '100-percent-only-after-final-durable-commit-evidence');
  assert.equal(proof.progressCollection.durableBoundary, 'durable-plan-receipt-staging-and-commit-evidence');
  assert.equal(proof.progressCollection.operatorOutputBoundary, 'hash-only-progress-events');
  assert.equal(proof.progressCollection.eventCount, 40);
  assert.equal(proof.progressCollection.events.length, 40);
  assert.equal(proof.progressCollection.totals.totalActions, 254);
  assert.equal(proof.progressCollection.totals.uploadBytes, 1_711_276_032);
  assert.equal(proof.progressCollection.totals.dbRows, 12_620);
  assert.deepEqual(proof.progressCollection.requiredPhaseCoverage, expectedRequiredPhases);
  assert.deepEqual(proof.progressCollection.missingRequiredPhases, []);
  assert.equal(proof.progressCollection.observedGaps.maxActionsBetweenReports, maxActionsBetweenReports);
  assert.equal(
    proof.progressCollection.observedGaps.maxUploadBytesBetweenReports,
    maxUploadBytesBetweenReports,
  );
  assert.equal(proof.progressCollection.budgets.minOperatorEvents, minOperatorEvents);
  assert.equal(proof.progressCollection.monotonic.violations.length, 0);
  assert.equal(proof.progressCollection.durableCursorCoverage.completedEvents, 31);
  assert.equal(proof.progressCollection.durableCursorCoverage.chunkEvents, 25);
  assert.deepEqual(proof.progressCollection.durableCursorCoverage.missingEvidenceEvents, []);
  assert.deepEqual(proof.progressCollection.durableCursorCoverage.chunkCursorGapEvents, []);
  assert.match(proof.progressCollection.progressCollectionHash, sha256Pattern);
  assert.match(proof.progressCollection.finalCursorHash, sha256Pattern);
  assert.ok(proof.progressCollection.eventHashes.every((eventHash) => sha256Pattern.test(eventHash)));

  const firstEvent = proof.progressCollection.events[0];
  const finalEvent = proof.progressCollection.events.at(-1);
  assert.equal(firstEvent.kind, 'push-start');
  assert.equal(firstEvent.percentComplete, 0);
  assert.equal(finalEvent.kind, 'push-complete');
  assert.equal(finalEvent.phase, 'commit');
  assert.equal(finalEvent.completedActions, proof.progressCollection.totals.totalActions);
  assert.equal(finalEvent.percentComplete, 100);
  assert.equal(finalEvent.durableCursor.actionType, 'atomic-group-commit');
  assert.equal(finalEvent.durableCursor.evidenceSource, 'atomic-group-commit-record');

  for (const event of proof.progressCollection.events) {
    assert.match(event.eventHash, sha256Pattern);
    assert.equal(event.redaction.rawValuesIncluded, false);
    assert.equal(event.redaction.payloadBytesIncluded, false);
    if (event.durableCursor.actionRefHash) {
      assert.match(event.durableCursor.actionRefHash, sha256Pattern);
    }
  }

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
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyProgressOutput, true);
  assert.equal(proof.correctness.progressOutputEmittedAfterGates, true);
  assert.match(proof.progressCollection.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('documented-large-site-budget'));
  assert.equal(proof.unsafe.missingProgressEvent.updated, false);
  assert.equal(proof.unsafe.missingProgressEvent.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingProgressEvent.blockedBy.includes('bounded-operator-update-gaps'));
  assert.equal(proof.unsafe.staleCursorHash.updated, false);
  assert.equal(proof.unsafe.staleCursorHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleCursorHash.blockedBy.includes('durable-cursor-hashes-match'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyLongPushProgressEvidence(proof);
});

test('RPP-0759 variant 3 fails closed for over-budget, missing, stale, and premature evidence', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveLongPushProgressProof(evidence);
  const unsafeDecisions = unsafeProgressEvidenceDecisions(evidence);

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
    'pass',
  ]);
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('documented-large-site-budget'));
  assert.equal(unsafeDecisions.missingProgressEvent.updated, false);
  assert.ok(unsafeDecisions.missingProgressEvent.blockedBy.includes('bounded-operator-update-gaps'));
  assert.equal(unsafeDecisions.staleCursorHash.updated, false);
  assert.ok(unsafeDecisions.staleCursorHash.blockedBy.includes('durable-cursor-hashes-match'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyLongPushProgressEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { benchmark, evidence } = buildRecordedEvidence();
  const safeDecision = resolveLongPushProgressProof(evidence);
  const generatedDecisions = generatedLongPushProgressCases().map((progressCase) => ({
    caseId: progressCase.id,
    expectedUpdated: progressCase.expected.updated,
    ...resolveLongPushProgressProof(progressCase.evidence),
  }));
  const generatedCoverage = {
    source: 'local-support-generated-long-push-progress-cases',
    ...generatedCoverageSummary(generatedDecisions),
  };
  const unsafe = projectUnsafeDecisions(unsafeProgressEvidenceDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'progressCollection',
  );
  const benchmarkGatesPass = benchmark.ok && benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-large-site-progress-gates-pass', benchmarkGatesPass
      && benchmark.profile === 'large-site'
      && benchmark.runtime.budgets.profile === 'large-site', {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      profile: benchmark.profile,
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.heapUsedBytes,
    }),
    proofGate('progress-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('generated-progress-evidence-cases-fail-closed',
      generatedCoverage.caseCount === expectedGeneratedCaseIds.length
        && generatedCoverage.outputEmitted === 1
        && generatedCoverage.blockedCaseCount === expectedGeneratedCaseIds.length - 1
        && generatedCoverage.unsafeOutputs === 0, {
      caseIds: generatedCoverage.caseIds,
      blockerCounts: generatedCoverage.blockerCounts,
      decisionHashes: generatedCoverage.decisionHashes,
    }),
    proofGate('unsafe-progress-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0759',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    generatedCoverage,
    builtOn: {
      rppId: 'RPP-0719',
      benchmark: benchmark.benchmark,
      policyId: benchmark.progress.policy.policyId,
      ok: benchmark.ok,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: publicBenchmarkProjection(benchmark),
    progressCollection: {
      ...evidence.progressCollection,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyProgressOutput: safeDecision.hashOnlyProgressOutput,
      progressOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-long-push-progress-events',
      rawValueEvidenceLeaks: longPushProgressEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicProgressEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidence() {
  const benchmark = runLongPushProgressReportingBenchmark({
    profile: 'large-site',
    now: fixedNow,
  });
  const evidence = buildLongPushProgressEvidence({ benchmark });

  recordCorrectnessGates(evidence);
  return { benchmark, evidence };
}

function buildLongPushProgressEvidence({ benchmark }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0759',
    proofId,
    variant: 3,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0719',
      benchmark: benchmark.benchmark,
      policyId: benchmark.progress.policy.policyId,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    benchmark: publicBenchmarkProjection(benchmark),
    correctnessGates: [],
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      process: {
        cpuUserMicros: benchmark.resources.cpuUserMicros,
        cpuSystemMicros: benchmark.resources.cpuSystemMicros,
        heapUsedBytes: benchmark.resources.heapUsedBytes,
        heapDeltaBytes: benchmark.resources.heapDeltaBytes,
        rssBytes: benchmark.resources.rssBytes,
        progressEvents: benchmark.resources.progressEvents,
      },
      workload: benchmark.workload.largeSiteShape,
    },
    progressCollection: collectProgressEventEvidence(benchmark),
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeLongPushProgressProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectProgressEventEvidence(benchmark) {
  const progress = benchmark.progress;
  const events = progress.events.map(progressEventSummary);
  const eventKindCounts = events.reduce((counts, event) => ({
    ...counts,
    [event.kind]: (counts[event.kind] || 0) + 1,
  }), {});
  const finalEvent = events.at(-1);
  const collectionCore = {
    durableBoundary: 'durable-plan-receipt-staging-and-commit-evidence',
    operatorOutputBoundary: 'hash-only-progress-events',
    policy: {
      policyId: progress.policy.policyId,
      sourceVariant: progress.policy.variant,
      proofVariant: 3,
      eventSchemaVersion: progress.policy.eventSchemaVersion,
      reportFrom: progress.policy.reportFrom,
      completionRule: progress.policy.completionRule,
    },
    budgets: progress.budgets,
    totals: progress.totals,
    eventCount: progress.eventCount,
    phasesCovered: progress.phasesCovered,
    requiredPhaseCoverage: progress.policy.requiredPhaseCoverage,
    missingRequiredPhases: progress.policy.requiredPhaseCoverage
      .filter((phase) => !progress.phasesCovered.includes(phase)),
    observedGaps: progress.observedGaps,
    eventKindCounts,
    firstSequence: events[0]?.sequence ?? null,
    finalSequence: finalEvent?.sequence ?? null,
    firstKind: events[0]?.kind ?? null,
    finalKind: finalEvent?.kind ?? null,
    finalPercentComplete: finalEvent?.percentComplete ?? null,
    finalCompletedActions: finalEvent?.completedActions ?? null,
    finalCursorHash: sha256(finalEvent?.durableCursor ?? null),
    monotonic: progressOrderMetrics(events),
    durableCursorCoverage: durableCursorCoverageMetrics(events),
    eventHashes: events.map((event) => event.eventHash),
    events,
  };

  return {
    ...collectionCore,
    progressCollectionHash: sha256(collectionCore),
  };
}

function progressEventSummary(event) {
  const core = {
    sequence: event.sequence,
    kind: event.kind,
    phase: event.phase,
    messageCode: event.messageCode,
    completedActions: event.completedActions,
    totalActions: event.totalActions,
    percentComplete: event.percentComplete,
    counters: event.counters,
    durableCursor: event.durableCursor,
    redaction: event.redaction,
  };

  return {
    ...core,
    eventHash: sha256(core),
  };
}

function resolveLongPushProgressProof(evidence) {
  const recomputedGates = recomputeLongPushProgressProofGates(evidence);
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
        runtimeBudgetHash: sha256({
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
        progressCollectionHash: evidence.progressCollection.progressCollectionHash,
        observedGapBudgetHash: sha256({
          observedGaps: evidence.progressCollection.observedGaps,
          budgets: evidence.progressCollection.budgets,
        }),
        finalCursorHash: evidence.progressCollection.finalCursorHash,
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
    hashOnlyProgressOutput: output ? longPushProgressEvidenceHasNoRawValues(output) : false,
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

function recomputeLongPushProgressProofGates(evidence) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const processResources = resources.process || {};
  const workload = resources.workload || {};
  const collection = evidence.progressCollection || {};
  const events = Array.isArray(collection.events) ? collection.events : [];
  const benchmarkGateStatuses = Array.isArray(evidence.benchmark?.gates)
    ? evidence.benchmark.gates.map((gate) => gate.status)
    : [];
  const benchmarkGatesPass = evidence.benchmark?.ok === true
    && benchmarkGateStatuses.length > 0
    && benchmarkGateStatuses.every((status) => status === 'pass');
  const largeSiteBudgetPass = evidence.benchmark?.profile === 'large-site'
    && runtime.budgets?.profile === 'large-site'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && workload.uploadBytes >= GIB
    && workload.dbRows >= 10_000;
  const policy = policyContractMetrics(collection, events);
  const phases = phaseCoverageMetrics(collection);
  const monotonic = progressOrderMetrics(events);
  const gaps = progressGapBudgetMetrics(collection, events);
  const cursorHashes = durableCursorHashMetrics(collection, events);
  const completion = completionMetrics(collection, events);
  const release = evidence.release || {};

  return [
    proofGate('benchmark-gates-pass', benchmarkGatesPass, {
      benchmarkGateStatuses,
      benchmarkOk: evidence.benchmark?.ok,
    }),
    proofGate('documented-large-site-budget', largeSiteBudgetPass, {
      profile: evidence.benchmark?.profile,
      budgetProfile: runtime.budgets?.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      uploadBytes: workload.uploadBytes,
      minUploadBytes: GIB,
      dbRows: workload.dbRows,
      minDbRows: 10_000,
    }),
    proofGate('progress-policy-v3-support-contract', policy.valid, policy),
    proofGate('phase-coverage-complete', phases.complete, phases),
    proofGate('monotonic-progress-events', monotonic.valid, monotonic),
    proofGate('bounded-operator-update-gaps', gaps.withinBudget, gaps),
    proofGate('durable-cursor-hashes-match', cursorHashes.match, cursorHashes),
    proofGate('completion-after-final-durable-evidence', completion.complete, completion),
    proofGate('hash-only-progress-evidence', longPushProgressEvidenceHasNoRawValues({
      runtime,
      resources,
      progressCollection: collection,
    }), {
      rawValueEvidenceLeaks: longPushProgressEvidenceHasNoRawValues({
        runtime,
        resources,
        progressCollection: collection,
      }) ? 0 : 1,
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

function policyContractMetrics(collection, events) {
  const policy = collection.policy || {};
  const finalEvent = events.at(-1);
  const valid = collection.durableBoundary === 'durable-plan-receipt-staging-and-commit-evidence'
    && collection.operatorOutputBoundary === 'hash-only-progress-events'
    && policy.policyId === LONG_PUSH_PROGRESS_POLICY_ID
    && policy.sourceVariant === 1
    && policy.proofVariant === 3
    && policy.eventSchemaVersion === 1
    && policy.reportFrom === 'durable-plan-and-receipt-evidence'
    && policy.completionRule === '100-percent-only-after-final-durable-commit-evidence'
    && collection.eventCount === events.length
    && collection.firstSequence === 1
    && collection.finalSequence === finalEvent?.sequence
    && collection.firstKind === 'push-start'
    && collection.finalKind === 'push-complete';

  return {
    valid,
    policyId: policy.policyId,
    sourceVariant: policy.sourceVariant,
    proofVariant: policy.proofVariant,
    eventSchemaVersion: policy.eventSchemaVersion,
    eventCount: events.length,
    recordedEventCount: collection.eventCount,
    firstSequence: collection.firstSequence,
    finalSequence: collection.finalSequence,
    finalEventSequence: finalEvent?.sequence ?? null,
    firstKind: collection.firstKind,
    finalKind: collection.finalKind,
  };
}

function phaseCoverageMetrics(collection) {
  const phasesCovered = Array.isArray(collection.phasesCovered) ? collection.phasesCovered : [];
  const required = Array.isArray(collection.requiredPhaseCoverage)
    ? collection.requiredPhaseCoverage
    : [];
  const missing = required.filter((phase) => !phasesCovered.includes(phase));
  const complete = sameArray(required, expectedRequiredPhases)
    && missing.length === 0
    && Array.isArray(collection.missingRequiredPhases)
    && collection.missingRequiredPhases.length === 0;

  return {
    complete,
    required,
    phasesCovered,
    missing,
    recordedMissing: collection.missingRequiredPhases,
  };
}

function progressOrderMetrics(events) {
  const violations = [];
  const sequenceErrors = [];
  const counterFields = [
    'uploadChunksAcked',
    'uploadBytesAcked',
    'dbBatchesCommitted',
    'dbRowsCommitted',
    'filePublishesFinalized',
    'pluginMetadataStaged',
    'groupStagingFinalized',
    'atomicGroupCommits',
  ];

  events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      sequenceErrors.push({ expected: index + 1, actual: event.sequence });
    }
  });

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (current.completedActions < previous.completedActions) {
      violations.push(`sequence ${current.sequence} completedActions regressed`);
    }
    if (current.percentComplete < previous.percentComplete) {
      violations.push(`sequence ${current.sequence} percentComplete regressed`);
    }
    for (const field of counterFields) {
      if (current.counters[field] < previous.counters[field]) {
        violations.push(`sequence ${current.sequence} ${field} regressed`);
      }
    }
  }

  const first = events[0] || null;
  const final = events.at(-1) || null;
  return {
    valid: sequenceErrors.length === 0
      && violations.length === 0
      && first?.percentComplete === 0
      && final?.percentComplete === 100,
    firstPercent: first?.percentComplete ?? null,
    finalPercent: final?.percentComplete ?? null,
    sequenceErrors,
    violations,
  };
}

function progressGapBudgetMetrics(collection, events) {
  const recomputedObservedGaps = observedProgressGaps(events);
  const recordedObservedGaps = collection.observedGaps || {};
  const budgets = collection.budgets || {};
  const recordedMatchesRecomputed = recordedObservedGaps.maxActionsBetweenReports
    === recomputedObservedGaps.maxActionsBetweenReports
    && recordedObservedGaps.maxUploadBytesBetweenReports
    === recomputedObservedGaps.maxUploadBytesBetweenReports;
  const withinBudget = recordedMatchesRecomputed
    && recomputedObservedGaps.maxActionsBetweenReports <= budgets.maxActionsBetweenReports
    && recomputedObservedGaps.maxUploadBytesBetweenReports <= budgets.maxUploadBytesBetweenReports
    && events.length >= budgets.minOperatorEvents;

  return {
    withinBudget,
    recomputedObservedGaps,
    recordedObservedGaps,
    recordedMatchesRecomputed,
    budgets,
    eventCount: events.length,
    minOperatorEvents: budgets.minOperatorEvents,
  };
}

function durableCursorCoverageMetrics(events) {
  const completedEvents = events.filter((event) => event.kind === 'progress' || event.kind === 'push-complete');
  const missingEvidenceEvents = completedEvents
    .filter((event) =>
      !event.durableCursor?.evidenceSource
        || !event.durableCursor?.actionType
        || !event.durableCursor?.actionRefHash,
    )
    .map((event) => event.sequence);
  const chunkEvents = completedEvents.filter((event) => event.durableCursor.actionType === 'chunk-upload');
  const chunkCursorGapEvents = chunkEvents
    .filter((event) =>
      !event.durableCursor.receiptRefHash
        || !event.durableCursor.resumeCursorHash
        || !event.durableCursor.idempotencyKeyHash,
    )
    .map((event) => event.sequence);

  return {
    completedEvents: completedEvents.length,
    missingEvidenceEvents,
    chunkEvents: chunkEvents.length,
    chunkCursorGapEvents,
  };
}

function durableCursorHashMetrics(collection, events) {
  const eventHashMismatches = events
    .filter((event) => event.eventHash !== sha256(progressEventCore(event)))
    .map((event) => event.sequence);
  const invalidHashEvents = events
    .filter((event) => !cursorHashesAreValid(event.durableCursor))
    .map((event) => event.sequence);
  const coverage = durableCursorCoverageMetrics(events);
  const recordedCoverage = collection.durableCursorCoverage || {};
  const collectionHashMatches = collection.progressCollectionHash === sha256(progressCollectionCore(collection));
  const finalCursorHash = sha256(events.at(-1)?.durableCursor ?? null);
  const finalCursorHashMatches = collection.finalCursorHash === finalCursorHash;
  const coverageMatches = recordedCoverage.completedEvents === coverage.completedEvents
    && recordedCoverage.chunkEvents === coverage.chunkEvents
    && sameArray(recordedCoverage.missingEvidenceEvents || [], coverage.missingEvidenceEvents)
    && sameArray(recordedCoverage.chunkCursorGapEvents || [], coverage.chunkCursorGapEvents);

  return {
    match: eventHashMismatches.length === 0
      && invalidHashEvents.length === 0
      && coverage.missingEvidenceEvents.length === 0
      && coverage.chunkCursorGapEvents.length === 0
      && collectionHashMatches
      && finalCursorHashMatches
      && coverageMatches,
    eventHashMismatches,
    invalidHashEvents,
    coverage,
    recordedCoverage,
    coverageMatches,
    collectionHashMatches,
    finalCursorHash,
    recordedFinalCursorHash: collection.finalCursorHash,
    finalCursorHashMatches,
  };
}

function completionMetrics(collection, events) {
  const final = events.at(-1) || null;
  const counters = final?.counters || {};
  const totals = collection.totals || {};
  const failures = [];
  if (final?.kind !== 'push-complete') {
    failures.push('missing push-complete event');
  }
  if (final?.phase !== 'commit') {
    failures.push('final event is not commit phase');
  }
  if (final?.completedActions !== totals.totalActions) {
    failures.push('completed actions do not match total actions');
  }
  if (final?.percentComplete !== 100) {
    failures.push('final percent is not 100');
  }
  if (final?.durableCursor?.actionType !== 'atomic-group-commit') {
    failures.push('final durable cursor is not atomic group commit');
  }
  if (counters.uploadChunksAcked !== totals.uploadChunks) {
    failures.push('upload chunks are incomplete');
  }
  if (counters.uploadBytesAcked !== totals.uploadBytes) {
    failures.push('upload bytes are incomplete');
  }
  if (counters.dbBatchesCommitted !== totals.dbBatches) {
    failures.push('db batches are incomplete');
  }
  if (counters.dbRowsCommitted !== totals.dbRows) {
    failures.push('db rows are incomplete');
  }
  if (counters.filePublishesFinalized !== totals.filePublishes) {
    failures.push('file publishes are incomplete');
  }
  if (counters.pluginMetadataStaged !== totals.pluginMetadataEntries) {
    failures.push('plugin metadata staging is incomplete');
  }
  if (counters.groupStagingFinalized !== totals.groupStagingFinalizes) {
    failures.push('group staging finalization is incomplete');
  }
  if (counters.atomicGroupCommits !== totals.atomicGroupCommits) {
    failures.push('atomic group commits are incomplete');
  }

  return {
    complete: failures.length === 0,
    finalSequence: final?.sequence ?? null,
    finalKind: final?.kind ?? null,
    finalPhase: final?.phase ?? null,
    finalPercent: final?.percentComplete ?? null,
    finalActionType: final?.durableCursor?.actionType ?? null,
    failures,
  };
}

function observedProgressGaps(events) {
  const gaps = events.slice(1).map((event, index) => {
    const previous = events[index];
    return {
      fromSequence: previous.sequence,
      toSequence: event.sequence,
      actions: event.completedActions - previous.completedActions,
      uploadBytes: event.counters.uploadBytesAcked - previous.counters.uploadBytesAcked,
    };
  });

  return {
    maxActionsBetweenReports: Math.max(0, ...gaps.map((gap) => gap.actions)),
    maxUploadBytesBetweenReports: Math.max(0, ...gaps.map((gap) => gap.uploadBytes)),
  };
}

function unsafeProgressEvidenceDecisions(evidence) {
  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const missingProgressEvent = withPassedStatus(clone(evidence));
  missingProgressEvent.progressCollection.events.splice(10, 1);

  const staleCursorHash = withPassedStatus(clone(evidence));
  staleCursorHash.progressCollection.events[12].durableCursor.actionRefHash = sha256('rpp-0759-stale-cursor');

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    overBudget: resolveLongPushProgressProof(overBudget),
    missingProgressEvent: resolveLongPushProgressProof(missingProgressEvent),
    staleCursorHash: resolveLongPushProgressProof(staleCursorHash),
    prematurePassStatus: resolveLongPushProgressProof(prematurePassStatus),
  };
}

function generatedLongPushProgressCases() {
  return [
    generatedProgressCase('passing-large-site-progress-budget', buildGeneratedEvidence(), {
      updated: true,
      blockedBy: [],
    }),
    generatedProgressCase('over-budget-runtime', mutateGeneratedEvidence((evidence) => {
      evidence.runtime.durationMs = evidence.runtime.budgets.maxDurationMs + 1;
    }), {
      updated: false,
      blockedBy: ['documented-large-site-budget'],
    }),
    generatedProgressCase('missing-progress-event', mutateGeneratedEvidence((evidence) => {
      evidence.progressCollection.events.splice(10, 1);
      renumberProgressEvents(evidence.progressCollection.events);
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['bounded-operator-update-gaps'],
    }),
    generatedProgressCase('stale-cursor-hash', mutateGeneratedEvidence((evidence) => {
      evidence.progressCollection.events[12].durableCursor.actionRefHash = sha256('rpp-0759-generated-stale-cursor');
    }), {
      updated: false,
      blockedBy: ['durable-cursor-hashes-match'],
    }),
    generatedProgressCase('missing-phase-coverage', mutateGeneratedEvidence((evidence) => {
      evidence.progressCollection.phasesCovered = evidence.progressCollection.phasesCovered
        .filter((phase) => phase !== 'transfer');
      evidence.progressCollection.missingRequiredPhases = ['transfer'];
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['phase-coverage-complete'],
    }),
    generatedProgressCase('minimum-operator-events-too-high', mutateGeneratedEvidence((evidence) => {
      evidence.progressCollection.budgets = {
        ...evidence.progressCollection.budgets,
        minOperatorEvents: evidence.progressCollection.events.length + 1,
      };
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['bounded-operator-update-gaps'],
    }),
    generatedProgressCase('raw-progress-value-leak', mutateGeneratedEvidence((evidence) => {
      evidence.resources.process.rawValueProbe = 'private option value';
    }), {
      updated: false,
      blockedBy: ['hash-only-progress-evidence'],
    }),
    generatedProgressCase('premature-pass-status', mutateGeneratedEvidence((evidence) => {
      evidence.correctnessGates = [];
    }), {
      updated: false,
      blockedBy: ['correctness-gates-not-recorded'],
    }),
  ];
}

function generatedProgressCase(id, evidence, expected) {
  return { id, evidence, expected };
}

function buildGeneratedEvidence() {
  return buildRecordedEvidence().evidence;
}

function mutateGeneratedEvidence(mutator) {
  const evidence = buildGeneratedEvidence();
  mutator(evidence);
  evidence.status = 'passed';
  return evidence;
}

function generatedCoverageSummary(decisions) {
  const blockerCounts = {};
  for (const decision of decisions) {
    for (const blocker of decision.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }

  return {
    caseIds: decisions.map((decision) => decision.caseId),
    caseCount: decisions.length,
    outputEmitted: decisions.filter((decision) => decision.outputEmitted).length,
    blockedCaseCount: decisions.filter((decision) => !decision.outputEmitted).length,
    unsafeOutputs: decisions.filter((decision) => (
      decision.expectedUpdated === false && decision.outputEmitted
    )).length,
    blockerCounts,
    decisionHashes: decisions.map((decision) => decision.decisionHash),
  };
}

function renumberProgressEvents(events) {
  events.forEach((event, index) => {
    event.sequence = index + 1;
  });
}

function refreshProgressCollectionIntegrity(evidence) {
  const collection = evidence.progressCollection;
  const events = collection.events;
  const finalEvent = events.at(-1);
  collection.eventKindCounts = events.reduce((counts, event) => ({
    ...counts,
    [event.kind]: (counts[event.kind] || 0) + 1,
  }), {});
  collection.eventCount = events.length;
  collection.firstSequence = events[0]?.sequence ?? null;
  collection.finalSequence = finalEvent?.sequence ?? null;
  collection.firstKind = events[0]?.kind ?? null;
  collection.finalKind = finalEvent?.kind ?? null;
  collection.finalPercentComplete = finalEvent?.percentComplete ?? null;
  collection.finalCompletedActions = finalEvent?.completedActions ?? null;
  collection.finalCursorHash = sha256(finalEvent?.durableCursor ?? null);
  collection.monotonic = progressOrderMetrics(events);
  collection.durableCursorCoverage = durableCursorCoverageMetrics(events);

  for (const event of events) {
    event.eventHash = sha256(progressEventCore(event));
  }

  collection.eventHashes = events.map((event) => event.eventHash);
  collection.progressCollectionHash = sha256(progressCollectionCore(collection));
}

function publicBenchmarkProjection(benchmark) {
  return {
    benchmark: benchmark.benchmark,
    profile: benchmark.profile,
    ok: benchmark.ok,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      progressEvents: benchmark.resources.progressEvents,
    },
    workload: benchmark.workload,
    progress: {
      policy: benchmark.progress.policy,
      budgets: benchmark.progress.budgets,
      totals: benchmark.progress.totals,
      eventCount: benchmark.progress.eventCount,
      phasesCovered: benchmark.progress.phasesCovered,
      observedGaps: benchmark.progress.observedGaps,
    },
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
  };
}

function publicProgressEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    progressCollection: evidence.progressCollection,
    release: evidence.release,
  };
}

function progressCollectionCore(collection) {
  return {
    durableBoundary: collection.durableBoundary,
    operatorOutputBoundary: collection.operatorOutputBoundary,
    policy: collection.policy,
    budgets: collection.budgets,
    totals: collection.totals,
    eventCount: collection.eventCount,
    phasesCovered: collection.phasesCovered,
    requiredPhaseCoverage: collection.requiredPhaseCoverage,
    missingRequiredPhases: collection.missingRequiredPhases,
    observedGaps: collection.observedGaps,
    eventKindCounts: collection.eventKindCounts,
    firstSequence: collection.firstSequence,
    finalSequence: collection.finalSequence,
    firstKind: collection.firstKind,
    finalKind: collection.finalKind,
    finalPercentComplete: collection.finalPercentComplete,
    finalCompletedActions: collection.finalCompletedActions,
    finalCursorHash: collection.finalCursorHash,
    monotonic: collection.monotonic,
    durableCursorCoverage: collection.durableCursorCoverage,
    eventHashes: collection.eventHashes,
    events: collection.events,
  };
}

function progressEventCore(event) {
  return {
    sequence: event.sequence,
    kind: event.kind,
    phase: event.phase,
    messageCode: event.messageCode,
    completedActions: event.completedActions,
    totalActions: event.totalActions,
    percentComplete: event.percentComplete,
    counters: event.counters,
    durableCursor: event.durableCursor,
    redaction: event.redaction,
  };
}

function cursorHashesAreValid(cursor) {
  if (!cursor) {
    return false;
  }
  return [
    'actionRefHash',
    'planRefHash',
    'resourceRefHash',
    'receiptRefHash',
    'resumeCursorHash',
    'idempotencyKeyHash',
  ].every((field) => cursor[field] === null || sha256Pattern.test(cursor[field]));
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

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertHashOnlyLongPushProgressEvidence(value) {
  assert.equal(longPushProgressEvidenceHasNoRawValues(value), true);
}

function longPushProgressEvidenceHasNoRawValues(value) {
  return !rawLongPushProgressEvidencePattern().test(JSON.stringify(value));
}

function rawLongPushProgressEvidencePattern() {
  return /wp-content|wp_posts|wp_postmeta|catalog-export|commerce-stack|payments\.php|commerce\.php|row-payload|post_content|option_value|meta_value|Bearer\s+|Basic\s+|https?:\/\/|private option value|customer secret/i;
}

function sha256(value) {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
