import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LONG_PUSH_PROGRESS_BENCHMARK_ID,
  LONG_PUSH_PROGRESS_POLICY_ID,
  runLongPushProgressReportingBenchmark,
} from '../scripts/bench/rpp-0719-long-push-progress-reporting.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0799-long-push-progress-reporting-release-verifier-v5';
const evidenceSource = 'long-push-progress-reporting-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 256 * MIB;
const maxActionsBetweenReports = 8;
const maxUploadBytesBetweenReports = 64 * MIB;
const minOperatorEvents = 32;
const hexSha256Pattern = /^[a-f0-9]{64}$/;
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
const expectedBenchmarkGateIds = Object.freeze([
  'progress-event-schema',
  'phase-coverage',
  'monotonic-progress-counters',
  'bounded-operator-update-gaps',
  'durable-evidence-backed-progress',
  'hash-only-progress-redaction',
  'completion-after-final-durable-evidence',
  'large-site-runtime-budget',
]);
const expectedVariant4GateIds = Object.freeze([
  'benchmark-gates-pass',
  'documented-large-site-budget',
  'progress-policy-v4-support-contract',
  'phase-coverage-complete',
  'monotonic-progress-events',
  'bounded-operator-update-gaps',
  'durable-cursor-hashes-match',
  'completion-after-final-durable-evidence',
  'hash-only-progress-evidence',
  'support-only-release-no-go',
]);
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-long-push-progress-reporting-v4',
  'large-site-progress-budget-carried-through',
  'progress-event-ordering-carried-through',
  'resume-receipt-visibility-carried-through',
  'no-false-completion-carried-through',
  'generated-unsafe-progress-cases-fail-closed',
  'release-verifier-carry-through-claimed',
  'hash-count-only-release-verifier-evidence',
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
const expectedVariant4BlockerCounts = Object.freeze({
  'documented-large-site-budget': 1,
  'bounded-operator-update-gaps': 2,
  'durable-cursor-hashes-match': 1,
  'phase-coverage-complete': 1,
  'hash-only-progress-evidence': 1,
  'correctness-gates-not-recorded': 1,
});
let recordedLargeSiteEvidencePair;

test('RPP-0799 release verifier v5 carries long-push progress reporting variant 4', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0799');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0779');
  assert.equal(proof.builtOn.proofId, 'rpp-0779-long-push-progress-reporting-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceBenchmark.rppId, 'RPP-0719');
  assert.equal(proof.builtOn.sourceBenchmark.benchmark, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.equal(proof.builtOn.sourceBenchmark.ok, true);
  assert.equal(proof.builtOn.sourceBenchmark.profile, 'large-site');
  assert.match(proof.builtOn.sourceBenchmark.evidenceHash, hexSha256Pattern);
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0759');
  assert.equal(proof.builtOn.previousVariant.proofId, 'rpp-0759-long-push-progress-reporting-v3');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.equal(proof.builtOn.previousVariant.status, 'passed');

  assert.equal(
    proof.releaseVerifier.command.invocation,
    'node --test --test-name-pattern RPP-0799 test/rpp-0799-long-push-progress-reporting-release-verifier-v5.test.js',
  );
  assert.equal(proof.releaseVerifier.command.reportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.reportsResources, true);
  assert.equal(proof.releaseVerifier.command.reportsPassFailGates, true);
  assert.equal(proof.releaseVerifier.command.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.command.gateCount, expectedBenchmarkGateIds.length);
  assert.deepEqual(proof.releaseVerifier.command.passGateIds, expectedBenchmarkGateIds);
  assert.deepEqual(proof.releaseVerifier.command.blockedGateIds, []);
  assert.deepEqual(proof.releaseVerifier.command.failGateIds, []);
  assert.equal(proof.releaseVerifier.command.productionGateEvidence, 'not-present');
  assert.match(proof.releaseVerifier.command.reportHash, hexSha256Pattern);
  assert.equal(proof.releaseVerifier.carryThrough.status, 'support-only-local-release-verifier');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0779');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, 'rpp-0779-long-push-progress-reporting-v4');
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(proof.releaseVerifier.carryThrough.checkedSourceGate,
    'generated-progress-evidence-cases-fail-closed');
  assert.equal(proof.releaseVerifier.carryThrough.benchmarkId, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.equal(proof.releaseVerifier.carryThrough.profile, 'large-site');
  assert.equal(proof.releaseVerifier.carryThrough.eventCount, proof.progressCollection.eventCount);
  assert.equal(
    proof.releaseVerifier.carryThrough.progressCollectionHash,
    proof.progressCollection.progressCollectionHash,
  );
  assert.equal(
    proof.releaseVerifier.carryThrough.generatedCoverageHash,
    proof.generatedCoverage.coverageHash,
  );
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'large-site');
  assert.equal(proof.runtime.budgets.profile, 'large-site');
  assert.equal(proof.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, maxHeapUsedBytes);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.localStorageProof, 'support-only-progress-event-hash-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.productionStorageReceipts, 'not-present');
  assert.equal(proof.resources.workload.uploadBytes, 1_711_276_032);
  assert.equal(proof.resources.workload.uploadChunks, 206);
  assert.equal(proof.resources.workload.dbRows, 12_620);
  assert.equal(proof.resources.workload.dbBatches, 27);
  assert.equal(proof.resources.workload.totalActions, 254);

  assert.equal(proof.benchmark.benchmark, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.equal(proof.benchmark.profile, 'large-site');
  assert.equal(proof.benchmark.ok, true);
  assert.deepEqual(proof.benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.progressCollection.policy.policyId, LONG_PUSH_PROGRESS_POLICY_ID);
  assert.equal(proof.progressCollection.policy.sourceVariant, 1);
  assert.equal(proof.progressCollection.policy.proofVariant, 5);
  assert.equal(proof.progressCollection.operatorOutputBoundary, 'hash-count-only-progress-events');
  assert.equal(proof.progressCollection.durableBoundary,
    'durable-plan-receipt-staging-and-commit-evidence');
  assert.equal(proof.progressCollection.eventCount, 40);
  assert.equal(proof.progressCollection.events.length, 40);
  assert.deepEqual(proof.progressCollection.eventKindCounts, {
    'push-start': 1,
    'phase-start': 8,
    progress: 30,
    'push-complete': 1,
  });
  assert.equal(proof.progressCollection.totals.totalActions, 254);
  assert.equal(proof.progressCollection.totals.uploadChunks, 206);
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
  assert.equal(proof.progressCollection.monotonic.valid, true);
  assert.deepEqual(proof.progressCollection.monotonic.violations, []);
  assert.deepEqual(proof.progressCollection.monotonic.sequenceErrors, []);
  assert.equal(proof.progressCollection.durableCursorCoverage.completedEvents, 31);
  assert.equal(proof.progressCollection.durableCursorCoverage.chunkEvents, 25);
  assert.deepEqual(proof.progressCollection.durableCursorCoverage.missingEvidenceEvents, []);
  assert.deepEqual(proof.progressCollection.durableCursorCoverage.chunkCursorGapEvents, []);
  assert.equal(proof.progressCollection.resumeReceiptVisibility.chunkEvents, 25);
  assert.equal(proof.progressCollection.resumeReceiptVisibility.receiptVisibleChunkEvents, 25);
  assert.equal(proof.progressCollection.resumeReceiptVisibility.resumeCursorVisibleChunkEvents, 25);
  assert.equal(proof.progressCollection.resumeReceiptVisibility.idempotencyVisibleChunkEvents, 25);
  assert.deepEqual(proof.progressCollection.resumeReceiptVisibility.missingReceiptSequences, []);
  assert.deepEqual(proof.progressCollection.resumeReceiptVisibility.missingResumeCursorSequences, []);
  assert.deepEqual(proof.progressCollection.resumeReceiptVisibility.missingIdempotencySequences, []);
  assert.equal(proof.progressCollection.noFalseCompletion.complete, true);
  assert.deepEqual(proof.progressCollection.noFalseCompletion.earlyCompletionSequences, []);
  assert.deepEqual(proof.progressCollection.noFalseCompletion.earlyFullPercentSequences, []);
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

  assert.equal(proof.generatedCoverage.sourceRppId, 'RPP-0779');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-long-push-progress-cases');
  assert.equal(proof.generatedCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.generatedCoverage.previousVariant, 'long-push-progress-reporting-v4');
  assert.deepEqual(proof.generatedCoverage.caseIds, expectedGeneratedCaseIds);
  assert.equal(proof.generatedCoverage.caseCount, 8);
  assert.equal(proof.generatedCoverage.outputEmitted, 1);
  assert.equal(proof.generatedCoverage.blockedCaseCount, 7);
  assert.equal(proof.generatedCoverage.unsafeOutputs, 0);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.blockerCounts, expectedVariant4BlockerCounts);
  assert.ok(proof.generatedCoverage.caseHashes.every((hash) => hexSha256Pattern.test(hash)));
  assert.deepEqual(proof.generatedCoverage.caseHashes, proof.generatedCoverage.repeatedCaseHashes);
  assert.match(proof.generatedCoverage.coverageHash, sha256Pattern);

  assert.equal(proof.determinism.sameProjection, true);
  assert.equal(proof.determinism.firstProjectionHash, proof.determinism.secondProjectionHash);
  assert.match(proof.determinism.firstProjectionHash, sha256Pattern);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
    'correctnessGates',
  ]);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.staleProgressOrder.updated, false);
  assert.ok(proof.unsafe.staleProgressOrder.blockedBy
    .includes('progress-event-ordering-carried-through'));
  assert.equal(proof.unsafe.missingReceiptVisibility.updated, false);
  assert.ok(proof.unsafe.missingReceiptVisibility.blockedBy
    .includes('resume-receipt-visibility-carried-through'));
  assert.equal(proof.unsafe.falseCompletion.updated, false);
  assert.ok(proof.unsafe.falseCompletion.blockedBy
    .includes('no-false-completion-carried-through'));
  assert.equal(proof.unsafe.staleGeneratedCoverage.updated, false);
  assert.ok(proof.unsafe.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-progress-cases-fail-closed'));
  assert.equal(proof.unsafe.releaseVerifierNotCarried.updated, false);
  assert.ok(proof.unsafe.releaseVerifierNotCarried.blockedBy
    .includes('release-verifier-carry-through-claimed'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.productionClaim.updated, false);
  assert.ok(proof.unsafe.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.ok(proof.unsafe.overBudget.blockedBy
    .includes('large-site-progress-budget-carried-through'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.release.blockers.includes('release-verifier-carry-through-not-claimed'), false);

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.repeatedEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, hexSha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0799 long-push release verifier proof' }));
});

test('RPP-0799 release verifier v5 blocks stale long-push carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedLargeSiteEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence, repeatedEvidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingRuntimeReport.updated, false);
  assert.ok(unsafeDecisions.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(unsafeDecisions.staleProgressOrder.updated, false);
  assert.ok(unsafeDecisions.staleProgressOrder.blockedBy
    .includes('progress-event-ordering-carried-through'));
  assert.equal(unsafeDecisions.missingReceiptVisibility.updated, false);
  assert.ok(unsafeDecisions.missingReceiptVisibility.blockedBy
    .includes('resume-receipt-visibility-carried-through'));
  assert.equal(unsafeDecisions.falseCompletion.updated, false);
  assert.ok(unsafeDecisions.falseCompletion.blockedBy
    .includes('no-false-completion-carried-through'));
  assert.equal(unsafeDecisions.staleGeneratedCoverage.updated, false);
  assert.ok(unsafeDecisions.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-progress-cases-fail-closed'));
  assert.equal(unsafeDecisions.releaseVerifierNotCarried.updated, false);
  assert.ok(unsafeDecisions.releaseVerifierNotCarried.blockedBy
    .includes('release-verifier-carry-through-claimed'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.productionClaim.updated, false);
  assert.ok(unsafeDecisions.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy
    .includes('large-site-progress-budget-carried-through'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyReleaseVerifierEvidence(decision);
  }
});

function buildReleaseVerifierProof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedLargeSiteEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence, repeatedEvidence));
  const determinism = compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence);
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'progressCollection',
  ) && objectKeyBefore(
    evidence,
    'correctnessGates',
    'generatedCoverage',
  ) && objectKeyBefore(
    evidence,
    'correctnessGates',
    'releaseVerifier',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('release-verifier-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-release-verifier-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
      blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
    }),
    proofGate('hash-count-only-release-verifier-proof',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
      rawValueEvidenceLeaks:
        releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.releaseEligible === false
      && supportOnlyRelease.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0799',
    proofId,
    variant: 5,
    evidenceSource,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
    integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    progressCollection: {
      ...evidence.progressCollection,
      outputHash: safeDecision.outputHash,
    },
    generatedCoverage: evidence.generatedCoverage,
    determinism,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-long-push-progress-release-verifier-v5',
      rawValueEvidenceLeaks:
        releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      repeatedEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedLargeSiteEvidencePair() {
  if (!recordedLargeSiteEvidencePair) {
    recordedLargeSiteEvidencePair = buildRecordedEvidencePair({
      profile: 'large-site',
      now: fixedNow,
    });
  }

  return recordedLargeSiteEvidencePair;
}

function buildRecordedEvidencePair(options) {
  const current = buildPendingEvidence(options);
  const repeated = buildPendingEvidence(options);

  current.evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(current.evidence);
  repeated.evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(repeated.evidence);
  recordCorrectnessGates(current.evidence, repeated.evidence);
  recordCorrectnessGates(repeated.evidence, current.evidence);
  return {
    benchmark: current.benchmark,
    repeatedBenchmark: repeated.benchmark,
    evidence: current.evidence,
    repeatedEvidence: repeated.evidence,
  };
}

function buildPendingEvidence(options) {
  const benchmark = runLongPushProgressReportingBenchmark(options);
  return {
    benchmark,
    evidence: buildReleaseVerifierEvidence({ benchmark }),
  };
}

function buildReleaseVerifierEvidence({ benchmark }) {
  const generatedCoverage = generatedProgressCaseCoverage();
  const release = supportOnlyReleasePosture();

  return {
    schemaVersion: 1,
    rppId: 'RPP-0799',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: longPushProgressReleaseVerifierContract(benchmark),
    command: buildReleaseVerifierCommandProjection(benchmark),
    correctnessGates: [],
    benchmark: publicBenchmarkProjection(benchmark),
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      profile: benchmark.profile,
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
      storage: {
        localStorageProof: 'support-only-progress-event-hash-receipts',
        productionBacked: false,
        productionStorageReceipts: 'not-present',
        durableBoundary: 'durable-plan-receipt-staging-and-commit-evidence',
      },
    },
    progressCollection: collectProgressEventEvidence(benchmark, { proofVariant: 5 }),
    generatedCoverage,
    release,
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeReleaseVerifierGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function buildReleaseVerifierCommandProjection(benchmark) {
  const passGateIds = benchmark.gates
    .filter((gate) => gate.status === 'pass')
    .map((gate) => gate.id);
  const blockedGateIds = benchmark.gates
    .filter((gate) => gate.status === 'blocked')
    .map((gate) => gate.id);
  const failGateIds = benchmark.gates
    .filter((gate) => gate.status === 'fail')
    .map((gate) => gate.id);
  const core = {
    invocation:
      'node --test --test-name-pattern RPP-0799 test/rpp-0799-long-push-progress-reporting-release-verifier-v5.test.js',
    reportsRuntime: hasRuntimeReport(benchmark),
    reportsResources: hasResourceReport(benchmark),
    reportsPassFailGates: hasPassFailGateReport(benchmark),
    passFailStatusesOnly: benchmark.gates.every((gate) => ['pass', 'fail', 'blocked'].includes(gate.status)),
    gateCount: benchmark.gates.length,
    passGateIds,
    blockedGateIds,
    failGateIds,
    productionGateEvidence: 'not-present',
    longPushSummary: {
      profile: benchmark.profile,
      eventCount: benchmark.progress.eventCount,
      totalActions: benchmark.progress.totals.totalActions,
      uploadChunks: benchmark.progress.totals.uploadChunks,
      uploadBytes: benchmark.progress.totals.uploadBytes,
      dbRows: benchmark.progress.totals.dbRows,
      phaseCount: benchmark.progress.phasesCovered.length,
      finalPercentComplete: benchmark.progress.events.at(-1)?.percentComplete ?? null,
      finalActionType: benchmark.progress.events.at(-1)?.durableCursor?.actionType ?? null,
    },
    budgets: benchmark.runtime.budgets,
  };

  return {
    ...core,
    reportHash: digest(core),
  };
}

function buildReleaseVerifierCarryThroughProjection(evidence) {
  const carryThrough = {
    status: 'support-only-local-release-verifier',
    fromRpp: 'RPP-0779',
    sourceProofId: 'rpp-0779-long-push-progress-reporting-v4',
    sourceVariant: 4,
    checkedSourceGate: 'generated-progress-evidence-cases-fail-closed',
    benchmarkId: LONG_PUSH_PROGRESS_BENCHMARK_ID,
    profile: evidence.benchmark.profile,
    eventCount: evidence.progressCollection.eventCount,
    totalActions: evidence.progressCollection.totals.totalActions,
    progressCollectionHash: evidence.progressCollection.progressCollectionHash,
    generatedCoverageHash: evidence.generatedCoverage.coverageHash,
    finalCursorHash: evidence.progressCollection.finalCursorHash,
    receiptVisibleChunkEvents:
      evidence.progressCollection.resumeReceiptVisibility.receiptVisibleChunkEvents,
    deterministicProjectionScope: 'runtime-free-count-hash-only',
    outputAfterCorrectnessGates: true,
    releaseStatus: evidence.release.finalReleaseStatus,
    integrationRecommendation: evidence.release.integrationRecommendation,
  };

  return {
    evidenceSource,
    command: evidence.command,
    carryThrough: {
      ...carryThrough,
      proofHash: sha256(carryThrough),
    },
  };
}

function resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeReleaseVerifierGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedReleaseVerifierGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(recordedGateIdsComplete && !recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        evidenceSource,
        gateVectorHash: sha256(recomputedGates),
        releaseVerifierHash: sha256(evidence.releaseVerifier),
        progressCollectionHash: evidence.progressCollection.progressCollectionHash,
        progressOrderingHash: sha256(evidence.progressCollection.monotonic),
        resumeReceiptVisibilityHash: sha256(evidence.progressCollection.resumeReceiptVisibility),
        noFalseCompletionHash: sha256(evidence.progressCollection.noFalseCompletion),
        generatedCoverageHash: evidence.generatedCoverage.coverageHash,
        deterministicEvidenceHash: sha256(deterministicReleaseVerifierProjection(evidence)),
        deterministicRepeatHash: sha256(deterministicReleaseVerifierProjection(repeatedEvidence)),
        runtimeBudgetHash: sha256({
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
        eventCount: evidence.progressCollection.eventCount,
        totalActions: evidence.progressCollection.totals.totalActions,
        uploadBytes: evidence.progressCollection.totals.uploadBytes,
        dbRows: evidence.progressCollection.totals.dbRows,
        receiptVisibleChunkEvents:
          evidence.progressCollection.resumeReceiptVisibility.receiptVisibleChunkEvents,
        supportOnly: evidence.release.supportOnly,
        productionBacked: evidence.release.productionBacked,
        releaseStatus: evidence.release.finalReleaseStatus,
        integrationRecommendation: evidence.release.integrationRecommendation,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashCountOnlyOutput: output ? releaseVerifierEvidenceHasNoRawValues(output) : false,
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

function recomputeReleaseVerifierGates(evidence, repeatedEvidence) {
  const releaseVerifier = evidence.releaseVerifier || {};
  const command = releaseVerifier.command || {};
  const carryThrough = releaseVerifier.carryThrough || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const processResources = resources.process || {};
  const workload = resources.workload || {};
  const storage = resources.storage || {};
  const collection = evidence.progressCollection || {};
  const events = Array.isArray(collection.events) ? collection.events : [];
  const benchmark = evidence.benchmark || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const ordering = progressEventOrderingMetrics(collection, events);
  const receiptVisibility = receiptVisibilityCarriedMetrics(collection, events);
  const completion = noFalseCompletionMetrics(collection, events);
  const generatedCoverage = generatedProgressCoverageMetrics(evidence.generatedCoverage || {});
  const deterministicEvidence = Boolean(repeatedEvidence)
    && sha256(deterministicReleaseVerifierProjection(evidence))
      === sha256(deterministicReleaseVerifierProjection(repeatedEvidence));
  const benchmarkGatesPass = benchmark.ok === true
    && Array.isArray(benchmark.gates)
    && benchmark.gates.length === expectedBenchmarkGateIds.length
    && sameArray(benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds)
    && benchmark.gates.every((gate) => gate.status === 'pass');
  const releaseVerifierReported = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.passFailStatusesOnly === true
    && command.gateCount === expectedBenchmarkGateIds.length
    && sameArray(command.passGateIds || [], expectedBenchmarkGateIds)
    && Array.isArray(command.blockedGateIds)
    && command.blockedGateIds.length === 0
    && Array.isArray(command.failGateIds)
    && command.failGateIds.length === 0
    && command.productionGateEvidence === 'not-present'
    && isSha256Hex(command.reportHash);
  const runtimeWithinBudget = runtime.profile === 'large-site'
    && runtime.budgets?.profile === 'large-site'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && storage.localStorageProof === 'support-only-progress-event-hash-receipts'
    && storage.productionBacked === false
    && storage.productionStorageReceipts === 'not-present';
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0779'
    && evidence.builtOn?.proofId === 'rpp-0779-long-push-progress-reporting-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && evidence.builtOn?.sourceBenchmark?.rppId === 'RPP-0719'
    && evidence.builtOn?.sourceBenchmark?.benchmark === LONG_PUSH_PROGRESS_BENCHMARK_ID
    && evidence.builtOn?.sourceBenchmark?.ok === true
    && evidence.builtOn?.sourceBenchmark?.profile === 'large-site'
    && isSha256Hex(evidence.builtOn?.sourceBenchmark?.evidenceHash)
    && evidence.builtOn?.previousVariant?.rppId === 'RPP-0759'
    && evidence.builtOn?.previousVariant?.proofId === 'rpp-0759-long-push-progress-reporting-v3'
    && evidence.builtOn?.previousVariant?.variant === 3
    && evidence.builtOn?.previousVariant?.status === 'passed';
  const largeSiteBudget = benchmark.profile === 'large-site'
    && workload.uploadBytes >= GIB
    && workload.uploadChunks === collection.totals?.uploadChunks
    && workload.dbRows >= 10_000
    && workload.totalActions === collection.totals?.totalActions
    && collection.eventCount >= minOperatorEvents
    && runtimeWithinBudget;
  const carryThroughClaimed = releaseVerifier.evidenceSource === evidenceSource
    && carryThrough.status === 'support-only-local-release-verifier'
    && carryThrough.fromRpp === 'RPP-0779'
    && carryThrough.sourceProofId === 'rpp-0779-long-push-progress-reporting-v4'
    && carryThrough.sourceVariant === 4
    && carryThrough.checkedSourceGate === 'generated-progress-evidence-cases-fail-closed'
    && carryThrough.benchmarkId === LONG_PUSH_PROGRESS_BENCHMARK_ID
    && carryThrough.profile === 'large-site'
    && carryThrough.eventCount === collection.eventCount
    && carryThrough.totalActions === collection.totals?.totalActions
    && carryThrough.progressCollectionHash === collection.progressCollectionHash
    && carryThrough.generatedCoverageHash === evidence.generatedCoverage?.coverageHash
    && carryThrough.finalCursorHash === collection.finalCursorHash
    && carryThrough.receiptVisibleChunkEvents
      === collection.resumeReceiptVisibility?.receiptVisibleChunkEvents
    && carryThrough.deterministicProjectionScope === 'runtime-free-count-hash-only'
    && carryThrough.outputAfterCorrectnessGates === true
    && carryThrough.releaseStatus === 'NO-GO'
    && carryThrough.integrationRecommendation === 'NO-GO'
    && carryThrough.proofHash === sha256(carryThroughCore(carryThrough));

  return [
    proofGate('release-verifier-runtime-resources-gates-reported',
      releaseVerifierReported && runtimeWithinBudget && benchmarkGatesPass, {
      benchmark: benchmark.benchmark,
      gateStatuses: Array.isArray(benchmark.gates) ? benchmark.gates.map((gate) => gate.status) : [],
      runtimeReported: command.reportsRuntime,
      resourcesReported: command.reportsResources,
      passFailGatesReported: command.reportsPassFailGates,
      gateCount: command.gateCount,
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
    }),
    proofGate('built-on-long-push-progress-reporting-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceBenchmark: evidence.builtOn?.sourceBenchmark?.benchmark,
      previousVariant: evidence.builtOn?.previousVariant?.rppId,
    }),
    proofGate('large-site-progress-budget-carried-through', largeSiteBudget, {
      profile: benchmark.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      uploadBytes: workload.uploadBytes,
      minUploadBytes: GIB,
      dbRows: workload.dbRows,
      minDbRows: 10_000,
      eventCount: collection.eventCount,
      minOperatorEvents,
    }),
    proofGate('progress-event-ordering-carried-through',
      deterministicEvidence && ordering.complete && ordering.hashesMatch, {
      deterministicEvidence,
      ...ordering,
    }),
    proofGate('resume-receipt-visibility-carried-through',
      receiptVisibility.complete && receiptVisibility.hashesMatch, receiptVisibility),
    proofGate('no-false-completion-carried-through',
      completion.complete && completion.hashesMatch, completion),
    proofGate('generated-unsafe-progress-cases-fail-closed',
      generatedCoverage.pass, generatedCoverage),
    proofGate('release-verifier-carry-through-claimed', carryThroughClaimed, {
      status: carryThrough.status,
      fromRpp: carryThrough.fromRpp,
      sourceVariant: carryThrough.sourceVariant,
      eventCount: carryThrough.eventCount,
      receiptVisibleChunkEvents: carryThrough.receiptVisibleChunkEvents,
    }),
    proofGate('hash-count-only-release-verifier-evidence',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
      rawValueEvidenceLeaks:
        releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.releaseEligible === false
      && release.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function collectProgressEventEvidence(benchmark, { proofVariant }) {
  const progress = benchmark.progress;
  const events = progress.events.map(progressEventSummary);
  const eventKindCounts = events.reduce((counts, event) => ({
    ...counts,
    [event.kind]: (counts[event.kind] || 0) + 1,
  }), {});
  const finalEvent = events.at(-1);
  const collectionCore = {
    durableBoundary: 'durable-plan-receipt-staging-and-commit-evidence',
    operatorOutputBoundary: proofVariant === 5
      ? 'hash-count-only-progress-events'
      : 'hash-only-progress-events',
    policy: {
      policyId: progress.policy.policyId,
      sourceVariant: progress.policy.variant,
      proofVariant,
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
    resumeReceiptVisibility: resumeReceiptVisibilityMetrics(events),
    noFalseCompletion: noFalseCompletionMetrics({ totals: progress.totals }, events),
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

function progressEventOrderingMetrics(collection, events) {
  const monotonic = progressOrderMetrics(events);
  const phases = phaseCoverageMetrics(collection);
  const gaps = progressGapBudgetMetrics(collection, events);
  const cursorHashes = durableCursorHashMetrics(collection, events);
  const recordedMonotonic = collection.monotonic || {};
  const recordedMonotonicMatches = recordedMonotonic.valid === monotonic.valid
    && sameArray(recordedMonotonic.violations || [], monotonic.violations)
    && sameArray(recordedMonotonic.sequenceErrors || [], monotonic.sequenceErrors);

  return {
    complete: monotonic.valid
      && phases.complete
      && gaps.withinBudget
      && collection.eventCount === events.length
      && recordedMonotonicMatches,
    hashesMatch: cursorHashes.eventHashMismatches.length === 0
      && cursorHashes.collectionHashMatches
      && cursorHashes.finalCursorHashMatches,
    monotonic,
    phases,
    gaps,
    recordedMonotonicMatches,
    eventHashMismatches: cursorHashes.eventHashMismatches,
    collectionHashMatches: cursorHashes.collectionHashMatches,
  };
}

function receiptVisibilityCarriedMetrics(collection, events) {
  const visibility = resumeReceiptVisibilityMetrics(events);
  const recorded = collection.resumeReceiptVisibility || {};
  const recordedMatches = recorded.chunkEvents === visibility.chunkEvents
    && recorded.receiptVisibleChunkEvents === visibility.receiptVisibleChunkEvents
    && recorded.resumeCursorVisibleChunkEvents === visibility.resumeCursorVisibleChunkEvents
    && recorded.idempotencyVisibleChunkEvents === visibility.idempotencyVisibleChunkEvents
    && sameArray(recorded.missingReceiptSequences || [], visibility.missingReceiptSequences)
    && sameArray(recorded.missingResumeCursorSequences || [], visibility.missingResumeCursorSequences)
    && sameArray(recorded.missingIdempotencySequences || [], visibility.missingIdempotencySequences);
  const cursorHashes = durableCursorHashMetrics(collection, events);

  return {
    complete: visibility.chunkEvents > 0
      && visibility.missingReceiptSequences.length === 0
      && visibility.missingResumeCursorSequences.length === 0
      && visibility.missingIdempotencySequences.length === 0
      && recordedMatches
      && cursorHashes.coverage.missingEvidenceEvents.length === 0
      && cursorHashes.coverage.chunkCursorGapEvents.length === 0
      && cursorHashes.coverageMatches,
    hashesMatch: cursorHashes.eventHashMismatches.length === 0
      && cursorHashes.invalidHashEvents.length === 0
      && cursorHashes.collectionHashMatches,
    ...visibility,
    recordedMatches,
    invalidHashEvents: cursorHashes.invalidHashEvents,
    coverage: cursorHashes.coverage,
    recordedCoverage: cursorHashes.recordedCoverage,
  };
}

function noFalseCompletionMetrics(collection, events) {
  const totals = collection.totals || {};
  const final = events.at(-1) || null;
  const earlyEvents = events.slice(0, -1);
  const earlyCompletionSequences = earlyEvents
    .filter((event) => event.kind === 'push-complete')
    .map((event) => event.sequence);
  const earlyFullPercentSequences = earlyEvents
    .filter((event) => event.percentComplete >= 100)
    .map((event) => event.sequence);
  const earlyFullActionSequences = earlyEvents
    .filter((event) => event.completedActions >= totals.totalActions)
    .map((event) => event.sequence);
  const completion = completionMetrics(collection, events);
  const recorded = collection.noFalseCompletion || {};
  const recordedMatches = recorded.complete === undefined
    || (
      recorded.complete === (
        completion.complete
          && earlyCompletionSequences.length === 0
          && earlyFullPercentSequences.length === 0
          && earlyFullActionSequences.length === 0
      )
      && sameArray(recorded.earlyCompletionSequences || [], earlyCompletionSequences)
      && sameArray(recorded.earlyFullPercentSequences || [], earlyFullPercentSequences)
      && sameArray(recorded.earlyFullActionSequences || [], earlyFullActionSequences)
    );
  const cursorHashes = durableCursorHashMetrics(collection, events);

  return {
    complete: completion.complete
      && earlyCompletionSequences.length === 0
      && earlyFullPercentSequences.length === 0
      && earlyFullActionSequences.length === 0
      && final?.kind === 'push-complete'
      && final?.percentComplete === 100
      && recordedMatches,
    hashesMatch: cursorHashes.eventHashMismatches.length === 0
      && cursorHashes.collectionHashMatches
      && cursorHashes.finalCursorHashMatches,
    finalSequence: final?.sequence ?? null,
    finalKind: final?.kind ?? null,
    finalPercentComplete: final?.percentComplete ?? null,
    finalActionType: final?.durableCursor?.actionType ?? null,
    earlyCompletionSequences,
    earlyFullPercentSequences,
    earlyFullActionSequences,
    completion,
    recordedMatches,
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

function resumeReceiptVisibilityMetrics(events) {
  const completedEvents = events.filter((event) => event.kind === 'progress' || event.kind === 'push-complete');
  const chunkEvents = completedEvents.filter((event) => event.durableCursor.actionType === 'chunk-upload');
  return {
    completedEvents: completedEvents.length,
    chunkEvents: chunkEvents.length,
    receiptVisibleChunkEvents: chunkEvents.filter((event) => event.durableCursor.receiptRefHash).length,
    resumeCursorVisibleChunkEvents: chunkEvents.filter((event) => event.durableCursor.resumeCursorHash).length,
    idempotencyVisibleChunkEvents: chunkEvents.filter((event) => event.durableCursor.idempotencyKeyHash).length,
    missingReceiptSequences: chunkEvents
      .filter((event) => !event.durableCursor.receiptRefHash)
      .map((event) => event.sequence),
    missingResumeCursorSequences: chunkEvents
      .filter((event) => !event.durableCursor.resumeCursorHash)
      .map((event) => event.sequence),
    missingIdempotencySequences: chunkEvents
      .filter((event) => !event.durableCursor.idempotencyKeyHash)
      .map((event) => event.sequence),
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

function unsafeReleaseVerifierDecisions(evidence, repeatedEvidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.command.reportsRuntime = false;

  const staleProgressOrder = withPassedStatus(clone(evidence));
  staleProgressOrder.progressCollection.events[8].completedActions =
    staleProgressOrder.progressCollection.events[7].completedActions - 1;

  const missingReceiptVisibility = withPassedStatus(clone(evidence));
  const firstChunk = missingReceiptVisibility.progressCollection.events
    .find((event) => event.durableCursor.actionType === 'chunk-upload');
  firstChunk.durableCursor.receiptRefHash = null;

  const falseCompletion = withPassedStatus(clone(evidence));
  falseCompletion.progressCollection.events[6].kind = 'push-complete';
  falseCompletion.progressCollection.events[6].percentComplete = 100;

  const staleGeneratedCoverage = withPassedStatus(clone(evidence));
  staleGeneratedCoverage.generatedCoverage.blockedCaseCount = 6;
  staleGeneratedCoverage.generatedCoverage.blockerCounts['bounded-operator-update-gaps'] = 1;

  const releaseVerifierNotCarried = withPassedStatus(clone(evidence));
  releaseVerifierNotCarried.releaseVerifier.carryThrough.status = 'not-claimed';
  releaseVerifierNotCarried.releaseVerifier.carryThrough.outputAfterCorrectnessGates = false;

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.progressCollection.rawFixtureProbe = 'wp-content/uploads/2026/05/catalog-export.bin';

  const productionClaim = withPassedStatus(clone(evidence));
  productionClaim.release.productionBacked = true;
  productionClaim.release.releaseEligible = true;
  productionClaim.release.finalReleaseStatus = 'GO';
  productionClaim.release.integrationRecommendation = 'GO';

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport, { repeatedEvidence }),
    staleProgressOrder: resolveReleaseVerifierCarryThrough(staleProgressOrder, { repeatedEvidence }),
    missingReceiptVisibility: resolveReleaseVerifierCarryThrough(missingReceiptVisibility, { repeatedEvidence }),
    falseCompletion: resolveReleaseVerifierCarryThrough(falseCompletion, { repeatedEvidence }),
    staleGeneratedCoverage: resolveReleaseVerifierCarryThrough(staleGeneratedCoverage, { repeatedEvidence }),
    releaseVerifierNotCarried: resolveReleaseVerifierCarryThrough(releaseVerifierNotCarried, { repeatedEvidence }),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak, { repeatedEvidence }),
    productionClaim: resolveReleaseVerifierCarryThrough(productionClaim, { repeatedEvidence }),
    overBudget: resolveReleaseVerifierCarryThrough(overBudget, { repeatedEvidence }),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus, { repeatedEvidence }),
  };
}

function generatedProgressCaseCoverage() {
  const decisions = generatedLongPushProgressCases().map((progressCase) => {
    const decision = resolveLongPushProgressProof(progressCase.evidence);
    return {
      caseId: progressCase.id,
      expectedUpdated: progressCase.expected.updated,
      updated: decision.updated,
      outputEmitted: decision.outputEmitted,
      attemptedPassBlocked: decision.attemptedPassBlocked,
      blockedBy: decision.blockedBy,
      decisionHash: decision.decisionHash,
    };
  });
  const blockedCases = decisions.filter((decision) => decision.outputEmitted === false);
  const blockerCounts = {};
  for (const decision of blockedCases) {
    for (const blocker of decision.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const caseHashes = decisions.map((decision) => digest({
    caseId: decision.caseId,
    updated: decision.updated,
    outputEmitted: decision.outputEmitted,
    attemptedPassBlocked: decision.attemptedPassBlocked,
    blockedBy: decision.blockedBy,
  }));
  const core = {
    sourceRppId: 'RPP-0779',
    source: 'local-support-generated-long-push-progress-cases',
    releaseVerifierVariant: evidenceSource,
    previousVariant: 'long-push-progress-reporting-v4',
    caseIds: decisions.map((decision) => decision.caseId),
    caseCount: decisions.length,
    outputEmitted: decisions.filter((decision) => decision.outputEmitted).length,
    blockedCaseCount: blockedCases.length,
    unsafeOutputs: decisions
      .filter((decision) => decision.expectedUpdated === false && decision.outputEmitted)
      .length,
    deterministicCaseVector: true,
    blockerCounts,
    caseHashes,
    repeatedCaseHashes: [...caseHashes],
  };

  return {
    ...core,
    coverageHash: sha256(core),
  };
}

function generatedProgressCoverageMetrics(coverage) {
  const expectedCoverageHash = sha256(generatedProgressCoverageCore(coverage));
  const caseHashes = Array.isArray(coverage.caseHashes) ? coverage.caseHashes : [];
  const repeatedCaseHashes = Array.isArray(coverage.repeatedCaseHashes) ? coverage.repeatedCaseHashes : [];
  const pass = coverage.sourceRppId === 'RPP-0779'
    && coverage.source === 'local-support-generated-long-push-progress-cases'
    && coverage.releaseVerifierVariant === evidenceSource
    && coverage.previousVariant === 'long-push-progress-reporting-v4'
    && sameArray(coverage.caseIds || [], expectedGeneratedCaseIds)
    && coverage.caseCount === expectedGeneratedCaseIds.length
    && coverage.outputEmitted === 1
    && coverage.blockedCaseCount === expectedGeneratedCaseIds.length - 1
    && coverage.unsafeOutputs === 0
    && coverage.deterministicCaseVector === true
    && sameArray(caseHashes, repeatedCaseHashes)
    && caseHashes.every((hash) => hexSha256Pattern.test(hash))
    && expectedBlockerCountsHold(coverage.blockerCounts || {})
    && coverage.coverageHash === expectedCoverageHash;

  return {
    pass,
    sourceRppId: coverage.sourceRppId,
    caseCount: coverage.caseCount,
    outputEmitted: coverage.outputEmitted,
    blockedCaseCount: coverage.blockedCaseCount,
    unsafeOutputs: coverage.unsafeOutputs,
    deterministicCaseVector: coverage.deterministicCaseVector,
    expectedCoverageHash,
    recordedCoverageHash: coverage.coverageHash,
    blockerCounts: coverage.blockerCounts,
  };
}

function generatedProgressCoverageCore(coverage) {
  return {
    sourceRppId: coverage.sourceRppId,
    source: coverage.source,
    releaseVerifierVariant: coverage.releaseVerifierVariant,
    previousVariant: coverage.previousVariant,
    caseIds: coverage.caseIds,
    caseCount: coverage.caseCount,
    outputEmitted: coverage.outputEmitted,
    blockedCaseCount: coverage.blockedCaseCount,
    unsafeOutputs: coverage.unsafeOutputs,
    deterministicCaseVector: coverage.deterministicCaseVector,
    blockerCounts: coverage.blockerCounts,
    caseHashes: coverage.caseHashes,
    repeatedCaseHashes: coverage.repeatedCaseHashes,
  };
}

function generatedLongPushProgressCases() {
  return [
    generatedProgressCase('passing-large-site-progress-budget', buildGeneratedVariant4Evidence(), {
      updated: true,
      blockedBy: [],
    }),
    generatedProgressCase('over-budget-runtime', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.runtime.durationMs = evidence.runtime.budgets.maxDurationMs + 1;
    }), {
      updated: false,
      blockedBy: ['documented-large-site-budget'],
    }),
    generatedProgressCase('missing-progress-event', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.progressCollection.events.splice(10, 1);
      renumberProgressEvents(evidence.progressCollection.events);
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['bounded-operator-update-gaps'],
    }),
    generatedProgressCase('stale-cursor-hash', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.progressCollection.events[12].durableCursor.actionRefHash = sha256('rpp-0799-generated-stale-cursor');
    }), {
      updated: false,
      blockedBy: ['durable-cursor-hashes-match'],
    }),
    generatedProgressCase('missing-phase-coverage', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.progressCollection.phasesCovered = evidence.progressCollection.phasesCovered
        .filter((phase) => phase !== 'transfer');
      evidence.progressCollection.missingRequiredPhases = ['transfer'];
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['phase-coverage-complete'],
    }),
    generatedProgressCase('minimum-operator-events-too-high', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.progressCollection.budgets = {
        ...evidence.progressCollection.budgets,
        minOperatorEvents: evidence.progressCollection.events.length + 1,
      };
      refreshProgressCollectionIntegrity(evidence);
    }), {
      updated: false,
      blockedBy: ['bounded-operator-update-gaps'],
    }),
    generatedProgressCase('raw-progress-value-leak', mutateGeneratedVariant4Evidence((evidence) => {
      evidence.resources.process.rawValueProbe = 'private option value';
    }), {
      updated: false,
      blockedBy: ['hash-only-progress-evidence'],
    }),
    generatedProgressCase('premature-pass-status', mutateGeneratedVariant4Evidence((evidence) => {
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

function buildGeneratedVariant4Evidence() {
  const benchmark = runLongPushProgressReportingBenchmark({
    profile: 'large-site',
    now: fixedNow,
  });
  const evidence = buildVariant4ProgressEvidence({ benchmark });
  recordLongPushCorrectnessGates(evidence);
  return evidence;
}

function mutateGeneratedVariant4Evidence(mutator) {
  const evidence = buildGeneratedVariant4Evidence();
  mutator(evidence);
  evidence.status = 'passed';
  return evidence;
}

function buildVariant4ProgressEvidence({ benchmark }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0779',
    proofId: 'rpp-0779-long-push-progress-reporting-v4',
    variant: 4,
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
    progressCollection: collectProgressEventEvidence(benchmark, { proofVariant: 4 }),
    release: {
      supportOnly: true,
      productionBacked: false,
      productionThroughput: 'not-claimed',
      speedClaimsAllowed: false,
      finalReleaseStatus: 'NO-GO',
      integrationRecommendation: 'NO-GO',
    },
  };
}

function recordLongPushCorrectnessGates(evidence) {
  const gates = recomputeLongPushProgressProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveLongPushProgressProof(evidence) {
  const recomputedGates = recomputeLongPushProgressProofGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedVariant4GateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(recordedGateIdsComplete && !recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId: 'rpp-0779-long-push-progress-reporting-v4',
        gateVectorHash: sha256(recomputedGates),
        progressCollectionHash: evidence.progressCollection.progressCollectionHash,
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
    hashOnlyProgressOutput: output ? releaseVerifierEvidenceHasNoRawValues(output) : false,
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
    proofGate('progress-policy-v4-support-contract', policy.valid, policy),
    proofGate('phase-coverage-complete', phases.complete, phases),
    proofGate('monotonic-progress-events', monotonic.valid, monotonic),
    proofGate('bounded-operator-update-gaps', gaps.withinBudget, gaps),
    proofGate('durable-cursor-hashes-match', cursorHashes.match, cursorHashes),
    proofGate('completion-after-final-durable-evidence', completion.complete, completion),
    proofGate('hash-only-progress-evidence', releaseVerifierEvidenceHasNoRawValues({
      runtime,
      resources,
      progressCollection: collection,
    }), {
      rawValueEvidenceLeaks: releaseVerifierEvidenceHasNoRawValues({
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
    && policy.proofVariant === 4
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
  collection.resumeReceiptVisibility = resumeReceiptVisibilityMetrics(events);
  collection.noFalseCompletion = noFalseCompletionMetrics(collection, events);

  for (const event of events) {
    event.eventHash = sha256(progressEventCore(event));
  }

  collection.eventHashes = events.map((event) => event.eventHash);
  collection.progressCollectionHash = sha256(progressCollectionCore(collection));
}

function longPushProgressReleaseVerifierContract(benchmark) {
  const sourceBenchmark = {
    rppId: 'RPP-0719',
    benchmark: benchmark.benchmark,
    ok: benchmark.ok,
    profile: benchmark.profile,
    evidenceHash: digest(publicBenchmarkProjection(benchmark)),
  };
  const previousVariant = {
    rppId: 'RPP-0759',
    proofId: 'rpp-0759-long-push-progress-reporting-v3',
    variant: 3,
    status: 'passed',
    evidenceHash: digest({
      rppId: 'RPP-0759',
      proofId: 'rpp-0759-long-push-progress-reporting-v3',
      coverage: 'hash-only-long-push-progress-proof',
    }),
  };
  const contract = {
    rppId: 'RPP-0779',
    proofId: 'rpp-0779-long-push-progress-reporting-v4',
    variant: 4,
    status: benchmark.ok ? 'passed' : 'blocked',
    sourceBenchmark,
    previousVariant,
    checkedSourceGate: 'generated-progress-evidence-cases-fail-closed',
  };

  return {
    ...contract,
    evidenceHash: digest(contract),
  };
}

function publicBenchmarkProjection(benchmark) {
  return {
    rppId: benchmark.rppId,
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

function publicReleaseVerifierEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    evidenceSource: evidence.evidenceSource,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    benchmark: evidence.benchmark,
    runtime: evidence.runtime,
    resources: evidence.resources,
    progressCollection: evidence.progressCollection,
    generatedCoverage: evidence.generatedCoverage,
    release: evidence.release,
  };
}

function deterministicReleaseVerifierProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    evidenceSource: evidence.evidenceSource,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    benchmark: evidence.benchmark,
    resources: {
      workload: evidence.resources?.workload,
      storage: evidence.resources?.storage,
    },
    progressCollection: evidence.progressCollection,
    generatedCoverage: evidence.generatedCoverage,
    release: evidence.release,
  };
}

function compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence) {
  const firstProjectionHash = sha256(deterministicReleaseVerifierProjection(evidence));
  const secondProjectionHash = sha256(deterministicReleaseVerifierProjection(repeatedEvidence));
  return {
    sameProjection: firstProjectionHash === secondProjectionHash,
    firstProjectionHash,
    secondProjectionHash,
    ignoredVolatileFields: [
      'runtime.durationMs',
      'resources.process',
      'correctnessGates',
    ],
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
    resumeReceiptVisibility: collection.resumeReceiptVisibility,
    noFalseCompletion: collection.noFalseCompletion,
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

function carryThroughCore(carryThrough) {
  return {
    status: carryThrough.status,
    fromRpp: carryThrough.fromRpp,
    sourceProofId: carryThrough.sourceProofId,
    sourceVariant: carryThrough.sourceVariant,
    checkedSourceGate: carryThrough.checkedSourceGate,
    benchmarkId: carryThrough.benchmarkId,
    profile: carryThrough.profile,
    eventCount: carryThrough.eventCount,
    totalActions: carryThrough.totalActions,
    progressCollectionHash: carryThrough.progressCollectionHash,
    generatedCoverageHash: carryThrough.generatedCoverageHash,
    finalCursorHash: carryThrough.finalCursorHash,
    receiptVisibleChunkEvents: carryThrough.receiptVisibleChunkEvents,
    deterministicProjectionScope: carryThrough.deterministicProjectionScope,
    outputAfterCorrectnessGates: carryThrough.outputAfterCorrectnessGates,
    releaseStatus: carryThrough.releaseStatus,
    integrationRecommendation: carryThrough.integrationRecommendation,
  };
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    productionReleaseApproval: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'production-release-approval-not-supplied',
    ],
  };
}

function hasRuntimeReport(benchmark) {
  return benchmark.runtime
    && typeof benchmark.runtime.generatedAt === 'string'
    && typeof benchmark.runtime.durationMs === 'number'
    && typeof benchmark.runtime.node === 'string'
    && typeof benchmark.runtime.platform === 'string'
    && typeof benchmark.runtime.arch === 'string'
    && typeof benchmark.runtime.cpuCount === 'number';
}

function hasResourceReport(benchmark) {
  return benchmark.resources
    && typeof benchmark.resources.cpuUserMicros === 'number'
    && typeof benchmark.resources.cpuSystemMicros === 'number'
    && typeof benchmark.resources.heapUsedBytes === 'number'
    && typeof benchmark.resources.rssBytes === 'number'
    && typeof benchmark.resources.progressEvents === 'number'
    && benchmark.workload?.largeSiteShape
    && typeof benchmark.workload.largeSiteShape.totalActions === 'number';
}

function hasPassFailGateReport(benchmark) {
  return Array.isArray(benchmark.gates)
    && benchmark.gates.length === expectedBenchmarkGateIds.length
    && sameArray(benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds)
    && benchmark.gates.every((gate) => ['pass', 'fail', 'blocked'].includes(gate.status));
}

function expectedBlockerCountsHold(blockerCounts) {
  return Object.entries(expectedVariant4BlockerCounts)
    .every(([blocker, count]) => blockerCounts[blocker] === count)
    && Object.keys(blockerCounts).length === Object.keys(expectedVariant4BlockerCounts).length;
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

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return !rawReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawReleaseVerifierEvidencePattern() {
  return /wp-content|wp_posts|wp_postmeta|catalog-export|commerce-stack|payments\.php|commerce\.php|row-payload|post_content|option_value|meta_value|Bearer\s+|Basic\s+|private option value|customer secret|https?:\/\//i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function isSha256Hex(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
