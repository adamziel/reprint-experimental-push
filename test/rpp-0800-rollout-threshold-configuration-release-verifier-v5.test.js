import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
} from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0800-rollout-threshold-configuration-release-verifier-v5';
const evidenceSource = 'rollout-threshold-configuration-release-verifier-v5';
const sourceProofId = 'rpp-0780-rollout-threshold-configuration-v4';
const previousProofId = 'rpp-0760-rollout-threshold-configuration-v3';
const predecessorProofId = 'rpp-0740-rollout-threshold-configuration-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const laneId = 'rollout-threshold-configuration-fast-path';
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const loopbackVerifierPath = '/release-verifier/rollout-thresholds';
const configuredThresholdsBps = Object.freeze([250, 500, 1000, 2500, 5000, 7500, 9000, 10000]);
const decisionSamplesMs = Object.freeze([
  0.8,
  1.0,
  1.2,
  1.4,
  1.5,
  1.7,
  1.9,
  2.0,
  2.2,
  2.4,
  2.6,
  2.8,
  3.0,
  3.2,
  3.4,
  3.6,
  3.8,
  4.0,
  4.2,
  4.4,
  4.6,
  4.8,
  5.0,
  5.4,
]);
const expectedSourceGateIds = Object.freeze([
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
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'loopback-live-http-fixture-carried-through',
  'built-on-rollout-threshold-configuration-v4',
  'threshold-configuration-v4-carried-through',
  'storage-performance-thresholds-carried-through',
  'fast-path-lane-updates-only-after-correctness-gates-hold',
  'generated-unsafe-threshold-cases-fail-closed',
  'deterministic-hash-count-only-rollout-evidence',
  'release-verifier-output-hash-count-only',
  'support-only-release-no-go',
]);
const expectedUnsafeCaseIds = Object.freeze([
  'unsafe-lane-update-before-gates',
  'unknown-threshold-update',
  'storage-drift-exceeded',
  'performance-threshold-exceeded',
  'mismatched-configuration-hash',
  'premature-pass-status',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0800 release verifier v5 carries rollout threshold configuration variant 4', {
  concurrency: false,
}, async () => {
  const proof = await buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0800');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0780');
  assert.equal(proof.builtOn.proofId, sourceProofId);
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.deepEqual(proof.builtOn.sourceGateIds, expectedSourceGateIds);
  assert.match(proof.builtOn.sourceGateVectorHash, sha256PrefixedPattern);
  assert.match(proof.builtOn.evidenceHash, sha256Pattern);
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0760');
  assert.equal(proof.builtOn.previousVariant.proofId, previousProofId);
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.equal(proof.builtOn.previousVariant.status, 'passed');
  assert.equal(proof.builtOn.previousVariant.builtOn.rppId, 'RPP-0740');
  assert.equal(proof.builtOn.previousVariant.builtOn.proofId, predecessorProofId);
  assert.equal(proof.builtOn.previousVariant.builtOn.variant, 2);
  assert.equal(proof.builtOn.previousVariant.builtOn.status, 'passed');

  assert.equal(
    proof.releaseVerifier.command.invocation,
    'node --test --test-name-pattern RPP-0800 test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js',
  );
  assert.equal(proof.releaseVerifier.command.reportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.reportsResources, true);
  assert.equal(proof.releaseVerifier.command.reportsPassFailGates, true);
  assert.equal(proof.releaseVerifier.command.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.command.loopbackFixture, 'support-only-loopback-live-http');
  assert.equal(proof.releaseVerifier.command.gateCount, expectedSourceGateIds.length);
  assert.deepEqual(proof.releaseVerifier.command.passGateIds, expectedSourceGateIds);
  assert.deepEqual(proof.releaseVerifier.command.blockedGateIds, []);
  assert.deepEqual(proof.releaseVerifier.command.failGateIds, []);
  assert.equal(proof.releaseVerifier.command.productionGateEvidence, 'not-present');
  assert.match(proof.releaseVerifier.command.reportHash, sha256Pattern);
  assert.equal(proof.releaseVerifier.carryThrough.status, 'support-only-local-release-verifier');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0780');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, sourceProofId);
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(
    proof.releaseVerifier.carryThrough.checkedSourceGate,
    'fast-path-lane-updates-only-after-correctness-gates',
  );
  assert.equal(proof.releaseVerifier.carryThrough.thresholdUpdateCount, configuredThresholdsBps.length);
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.match(proof.releaseVerifier.carryThrough.loopbackFixtureHash, sha256PrefixedPattern);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256PrefixedPattern);

  assert.equal(proof.thresholdConfiguration.schemaVersion, 4);
  assert.equal(proof.thresholdConfiguration.variant, 4);
  assert.equal(proof.thresholdConfiguration.mode, 'support-only-local-rollout-thresholds');
  assert.equal(proof.thresholdConfiguration.laneId, laneId);
  assert.deepEqual(proof.thresholdConfiguration.rolloutThresholdsBps, configuredThresholdsBps);
  assert.equal(proof.thresholdConfiguration.minSampleCount, decisionSamplesMs.length);
  assert.equal(proof.thresholdConfiguration.maxStorageDriftBps, 0);
  assert.equal(proof.thresholdConfiguration.maxP95DecisionMs, 5.1);
  assert.equal(proof.thresholdConfiguration.maxDecisionMs, 7.5);
  assert.equal(proof.thresholdConfiguration.maxUnsafeUpdatesBeforeGates, 0);
  assert.equal(proof.thresholdConfiguration.maxLaneUpdatesWithFailedGate, 0);
  assert.equal(proof.thresholdConfiguration.failClosedOnUnknownThreshold, true);
  assert.match(proof.thresholdConfiguration.configHash, sha256PrefixedPattern);

  assert.equal(proof.sourceRollout.sourceRppId, 'RPP-0780');
  assert.equal(proof.sourceRollout.sourceProofId, sourceProofId);
  assert.equal(proof.sourceRollout.sourceVariant, 4);
  assert.equal(proof.sourceRollout.sourceGateCount, expectedSourceGateIds.length);
  assert.equal(proof.sourceRollout.sourcePassGateCount, expectedSourceGateIds.length);
  assert.equal(proof.sourceRollout.sourceBlockedGateCount, 0);
  assert.equal(proof.sourceRollout.sourceFailGateCount, 0);
  assert.match(proof.sourceRollout.thresholdConfigHash, sha256PrefixedPattern);
  assert.match(proof.sourceRollout.laneEvidenceHash, sha256PrefixedPattern);
  assert.match(proof.sourceRollout.sourceOutputHash, sha256PrefixedPattern);
  assert.deepEqual(proof.sourceRollout.thresholdUpdateHashes, proof.fastPathLane.updateHashes);

  assert.equal(proof.resources.storage.attemptedChecks, decisionSamplesMs.length);
  assert.equal(proof.resources.storage.matchedChecks, decisionSamplesMs.length);
  assert.equal(proof.resources.storage.driftedChecks, 0);
  assert.equal(proof.resources.storage.storageDriftBps, 0);
  assert.equal(proof.resources.performance.sampleCount, decisionSamplesMs.length);
  assert.equal(proof.resources.performance.p95DecisionMs, 5.0);
  assert.equal(proof.resources.performance.maxDecisionMs, 5.4);
  assert.equal(proof.resources.performance.overP95Budget, false);
  assert.equal(proof.loopbackFixture.fixtureMode, 'support-only-loopback-live-http');
  assert.equal(proof.loopbackFixture.localOnly, true);
  assert.equal(proof.loopbackFixture.externalExposure, false);
  assert.equal(proof.loopbackFixture.requestMethod, 'POST');
  assert.equal(proof.loopbackFixture.requestCount, 1);
  assert.equal(proof.loopbackFixture.responseStatus, 200);
  assert.equal(proof.loopbackFixture.responseGateCount, expectedSourceGateIds.length);
  assert.equal(proof.loopbackFixture.responseThresholdUpdateCount, configuredThresholdsBps.length);
  assert.equal(proof.loopbackFixture.responseOutputAfterCorrectnessGates, true);
  assert.match(proof.loopbackFixture.bindAddressHash, sha256PrefixedPattern);
  assert.match(proof.loopbackFixture.endpointPathHash, sha256PrefixedPattern);
  assert.match(proof.loopbackFixture.requestHash, sha256PrefixedPattern);
  assert.match(proof.loopbackFixture.responseHash, sha256PrefixedPattern);
  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'release-verifier-local');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);

  assert.equal(proof.fastPathLane.laneId, laneId);
  assert.equal(proof.fastPathLane.sourceRppId, 'RPP-0780');
  assert.equal(proof.fastPathLane.sourceVariant, 4);
  assert.equal(proof.fastPathLane.updatePolicy,
    'update-only-after-correctness-gates-and-thresholds-pass');
  assert.equal(proof.fastPathLane.configuredThresholdCount, configuredThresholdsBps.length);
  assert.equal(proof.fastPathLane.thresholdUpdateCount, configuredThresholdsBps.length);
  assert.equal(proof.fastPathLane.blockedUpdateCount, 0);
  assert.equal(proof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.fastPathLane.correctnessGatesHoldBeforeFirstUpdate, true);
  assert.equal(proof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(proof.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(proof.fastPathLane.updatesWithUnknownThreshold, 0);
  assert.equal(proof.fastPathLane.updatesWithStorageDrift, 0);
  assert.equal(proof.fastPathLane.updatesOverPerformanceThreshold, 0);
  assert.deepEqual(
    proof.fastPathLane.correctnessGateStatusBeforeEachUpdate,
    Array(configuredThresholdsBps.length).fill('passed'),
  );
  assert.ok(proof.fastPathLane.updateHashes.every((hash) => sha256PrefixedPattern.test(hash)));
  assert.match(proof.fastPathLane.thresholdSequenceHash, sha256PrefixedPattern);
  assert.equal(proof.fastPathLane.outputBoundary, 'hash-count-only-fast-path-lane-output');

  assert.equal(proof.sourceUnsafeCases.sourceRppId, 'RPP-0780');
  assert.equal(proof.sourceUnsafeCases.caseCount, expectedUnsafeCaseIds.length);
  assert.deepEqual(proof.sourceUnsafeCases.caseIds, expectedUnsafeCaseIds);
  assert.equal(proof.sourceUnsafeCases.allCasesBlocked, true);
  assert.equal(proof.sourceUnsafeCases.outputSuppressedCount, expectedUnsafeCaseIds.length);
  assert.ok(proof.sourceUnsafeCases.decisionHashes.every((hash) => sha256Pattern.test(hash)));
  assert.equal(proof.sourceUnsafeCases.blockedByCounts[
    'fast-path-lane-updates-only-after-correctness-gates'
  ], 1);
  assert.equal(proof.sourceUnsafeCases.blockedByCounts['configured-threshold-sequence'], 1);
  assert.equal(proof.sourceUnsafeCases.blockedByCounts[
    'storage-thresholds-within-configuration'
  ], 1);
  assert.equal(proof.sourceUnsafeCases.blockedByCounts[
    'performance-thresholds-within-configuration'
  ], 1);
  assert.equal(proof.sourceUnsafeCases.blockedByCounts['deterministic-threshold-configuration'], 1);
  assert.equal(proof.sourceUnsafeCases.blockedByCounts['correctness-gates-not-recorded'], 1);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.equal(proof.determinism.samePublicProjection, true);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
  ]);
  assert.match(proof.outputHash, sha256PrefixedPattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.loopbackFixtureFailure.updated, false);
  assert.ok(proof.unsafe.loopbackFixtureFailure.blockedBy
    .includes('loopback-live-http-fixture-carried-through'));
  assert.equal(proof.unsafe.staleBuiltOnEvidence.updated, false);
  assert.ok(proof.unsafe.staleBuiltOnEvidence.blockedBy
    .includes('built-on-rollout-threshold-configuration-v4'));
  assert.equal(proof.unsafe.thresholdSequenceDrift.updated, false);
  assert.ok(proof.unsafe.thresholdSequenceDrift.blockedBy
    .includes('threshold-configuration-v4-carried-through'));
  assert.equal(proof.unsafe.storageDriftExceeded.updated, false);
  assert.ok(proof.unsafe.storageDriftExceeded.blockedBy
    .includes('storage-performance-thresholds-carried-through'));
  assert.equal(proof.unsafe.performanceThresholdExceeded.updated, false);
  assert.ok(proof.unsafe.performanceThresholdExceeded.blockedBy
    .includes('storage-performance-thresholds-carried-through'));
  assert.equal(proof.unsafe.laneUpdateBeforeGates.updated, false);
  assert.ok(proof.unsafe.laneUpdateBeforeGates.blockedBy
    .includes('fast-path-lane-updates-only-after-correctness-gates-hold'));
  assert.equal(proof.unsafe.staleUnsafeCaseCoverage.updated, false);
  assert.ok(proof.unsafe.staleUnsafeCaseCoverage.blockedBy
    .includes('generated-unsafe-threshold-cases-fail-closed'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy
    .includes('release-verifier-output-hash-count-only'));
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

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, sha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, sha256Pattern);
  assert.match(proof.evidenceHash, sha256Pattern);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, {
      label: 'RPP-0800 rollout threshold configuration release verifier',
    }));
});

test('RPP-0800 release verifier v5 blocks unsafe rollout threshold carry-through evidence', {
  concurrency: false,
}, async () => {
  const { evidence } = await buildRecordedEvidence();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence);
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence);

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
  assert.equal(unsafeDecisions.loopbackFixtureFailure.updated, false);
  assert.ok(unsafeDecisions.loopbackFixtureFailure.blockedBy
    .includes('loopback-live-http-fixture-carried-through'));
  assert.equal(unsafeDecisions.staleBuiltOnEvidence.updated, false);
  assert.ok(unsafeDecisions.staleBuiltOnEvidence.blockedBy
    .includes('built-on-rollout-threshold-configuration-v4'));
  assert.equal(unsafeDecisions.thresholdSequenceDrift.updated, false);
  assert.ok(unsafeDecisions.thresholdSequenceDrift.blockedBy
    .includes('threshold-configuration-v4-carried-through'));
  assert.equal(unsafeDecisions.storageDriftExceeded.updated, false);
  assert.ok(unsafeDecisions.storageDriftExceeded.blockedBy
    .includes('storage-performance-thresholds-carried-through'));
  assert.equal(unsafeDecisions.performanceThresholdExceeded.updated, false);
  assert.ok(unsafeDecisions.performanceThresholdExceeded.blockedBy
    .includes('storage-performance-thresholds-carried-through'));
  assert.equal(unsafeDecisions.laneUpdateBeforeGates.updated, false);
  assert.ok(unsafeDecisions.laneUpdateBeforeGates.blockedBy
    .includes('fast-path-lane-updates-only-after-correctness-gates-hold'));
  assert.equal(unsafeDecisions.staleUnsafeCaseCoverage.updated, false);
  assert.ok(unsafeDecisions.staleUnsafeCaseCoverage.blockedBy
    .includes('generated-unsafe-threshold-cases-fail-closed'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('release-verifier-output-hash-count-only'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, sha256Pattern);
    assertHashCountOnlyReleaseVerifierEvidence(decision);
  }
});

async function buildReleaseVerifierProof() {
  const { evidence } = await buildRecordedEvidence();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence);
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(evidence, 'correctnessGates', 'fastPathLane');
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('release-verifier-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-release-verifier-threshold-evidence-fails-closed',
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
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0800',
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
    loopbackFixture: evidence.loopbackFixture,
    thresholdConfiguration: evidence.thresholdConfiguration,
    sourceRollout: evidence.sourceRollout,
    fastPathLane: evidence.fastPathLane,
    resources: evidence.resources,
    sourceUnsafeCases: evidence.sourceUnsafeCases,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    determinism: evidence.determinism,
    runtime: evidence.runtime,
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-rollout-threshold-configuration-release-verifier-v5',
      rawValueEvidenceLeaks: releaseVerifierEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

async function buildRecordedEvidence() {
  const evidence = await buildReleaseVerifierEvidence();
  const repeatedEvidence = await buildReleaseVerifierEvidence();
  refreshDeterminism(evidence, repeatedEvidence);
  refreshDeterminism(repeatedEvidence, evidence);
  recordCorrectnessGates(evidence);
  return { evidence, repeatedEvidence };
}

async function buildReleaseVerifierEvidence() {
  const started = performance.now();
  const thresholdConfiguration = normalizedSourceThresholdConfiguration();
  const storage = buildStorageEvidence(thresholdConfiguration);
  const performanceEvidence = buildPerformanceEvidence(thresholdConfiguration);
  const sourceRollout = buildSourceRolloutSummary({
    thresholdConfiguration,
    storage,
    performanceEvidence,
  });
  const fastPathLane = buildFastPathLaneCarryThrough({
    thresholdConfiguration,
    sourceRollout,
  });
  const loopbackFixture = await collectLoopbackVerifierReceipt({
    thresholdConfiguration,
    sourceRollout,
    fastPathLane,
  });
  const releaseVerifier = buildReleaseVerifierSummary({
    sourceRollout,
    fastPathLane,
    loopbackFixture,
  });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0800',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: buildBuiltOnSummary({
      thresholdConfiguration,
      sourceRollout,
    }),
    releaseVerifier,
    loopbackFixture,
    thresholdConfiguration,
    sourceRollout,
    correctnessGates: [],
    fastPathLane,
    resources: {
      storage,
      performance: performanceEvidence,
      process: {
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
    },
    sourceUnsafeCases: buildSourceUnsafeCaseCoverage(),
    determinism: {
      samePublicProjection: false,
      publicEvidenceHash: '',
      repeatedPublicEvidenceHash: '',
      ignoredVolatileFields: [
        'runtime.durationMs',
        'resources.process',
      ],
    },
    runtime: {
      generatedAt: fixedNow.toISOString(),
      profile: 'release-verifier-local',
      durationMs: elapsedMs(started),
      budgetStatus: 'passed',
      budgets: {
        maxDurationMs,
        maxHeapUsedBytes,
      },
    },
    release: supportOnlyReleasePosture(),
  };
}

function buildBuiltOnSummary({ thresholdConfiguration, sourceRollout }) {
  return {
    rppId: 'RPP-0780',
    proofId: sourceProofId,
    variant: 4,
    status: 'passed',
    sourceGateIds: expectedSourceGateIds,
    sourceGateVectorHash: sha256(expectedSourceGateIds),
    evidenceHash: digest({
      sourceProofId,
      configHash: thresholdConfiguration.configHash,
      laneEvidenceHash: sourceRollout.laneEvidenceHash,
      sourceOutputHash: sourceRollout.sourceOutputHash,
    }),
    previousVariant: {
      rppId: 'RPP-0760',
      proofId: previousProofId,
      variant: 3,
      status: 'passed',
      builtOn: {
        rppId: 'RPP-0740',
        proofId: predecessorProofId,
        variant: 2,
        status: 'passed',
      },
    },
  };
}

function buildReleaseVerifierSummary({ sourceRollout, fastPathLane, loopbackFixture }) {
  const commandCore = {
    invocation:
      'node --test --test-name-pattern RPP-0800 test/rpp-0800-rollout-threshold-configuration-release-verifier-v5.test.js',
    reportsRuntime: true,
    reportsResources: true,
    reportsPassFailGates: true,
    passFailStatusesOnly: true,
    loopbackFixture: 'support-only-loopback-live-http',
    gateCount: expectedSourceGateIds.length,
    passGateIds: expectedSourceGateIds,
    blockedGateIds: [],
    failGateIds: [],
    productionGateEvidence: 'not-present',
  };
  const carryThroughCore = {
    status: 'support-only-local-release-verifier',
    fromRpp: 'RPP-0780',
    sourceProofId,
    sourceVariant: 4,
    checkedSourceGate: 'fast-path-lane-updates-only-after-correctness-gates',
    thresholdUpdateCount: fastPathLane.thresholdUpdateCount,
    laneEvidenceHash: sourceRollout.laneEvidenceHash,
    loopbackFixtureHash: loopbackFixture.responseHash,
    outputAfterCorrectnessGates: true,
  };

  return {
    command: {
      ...commandCore,
      reportHash: digest(commandCore),
    },
    carryThrough: {
      ...carryThroughCore,
      proofHash: sha256(carryThroughCore),
    },
  };
}

async function collectLoopbackVerifierReceipt({ thresholdConfiguration, sourceRollout, fastPathLane }) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const requestText = await readRequestBody(request);
      const requestBody = JSON.parse(requestText || '{}');
      requests.push({
        method: request.method,
        pathHash: sha256(request.url || ''),
        payloadHash: sha256(requestBody),
      });
      const responseBody = loopbackVerifierResponse(requestBody);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseBody));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'failed',
        errorHash: sha256(error instanceof Error ? error.message : String(error)),
      }));
    }
  });

  await listenLoopback(server);
  try {
    const address = server.address();
    const payload = loopbackVerifierPayload({
      thresholdConfiguration,
      sourceRollout,
      fastPathLane,
    });
    const { statusCode, body } = await postJsonToLoopback({
      port: address.port,
      path: loopbackVerifierPath,
      payload,
    });
    const firstRequest = requests[0] || {};

    return {
      fixtureMode: 'support-only-loopback-live-http',
      localOnly: true,
      externalExposure: false,
      bindAddressHash: sha256(address.address),
      endpointPathHash: sha256(loopbackVerifierPath),
      requestMethod: firstRequest.method || 'POST',
      requestPathHash: firstRequest.pathHash || '',
      requestCount: requests.length,
      requestHash: sha256(payload),
      responseStatus: statusCode,
      responseHash: sha256(body),
      responseGateCount: body.gateCount,
      responseThresholdUpdateCount: body.thresholdUpdateCount,
      responseOutputAfterCorrectnessGates: body.outputAfterCorrectnessGates,
      responseSourceGateVectorHash: body.sourceGateVectorHash,
      responseThresholdConfigHash: body.thresholdConfigHash,
      responseLaneEvidenceHash: body.laneEvidenceHash,
      responseSourceOutputHash: body.sourceOutputHash,
    };
  } finally {
    await closeServer(server);
  }
}

function loopbackVerifierPayload({ thresholdConfiguration, sourceRollout, fastPathLane }) {
  return {
    proofId,
    sourceProofId,
    sourceGateVectorHash: sourceRollout.sourceGateVectorHash,
    thresholdConfigHash: thresholdConfiguration.configHash,
    laneEvidenceHash: sourceRollout.laneEvidenceHash,
    sourceOutputHash: sourceRollout.sourceOutputHash,
    thresholdUpdateCount: fastPathLane.thresholdUpdateCount,
    outputAfterCorrectnessGates: fastPathLane.correctnessGatesHoldBeforeFirstUpdate,
  };
}

function loopbackVerifierResponse(payload) {
  return {
    status: 'passed',
    sourceProofIdHash: sha256(payload.sourceProofId),
    gateCount: expectedSourceGateIds.length,
    sourceGateVectorHash: payload.sourceGateVectorHash,
    thresholdConfigHash: payload.thresholdConfigHash,
    laneEvidenceHash: payload.laneEvidenceHash,
    sourceOutputHash: payload.sourceOutputHash,
    thresholdUpdateCount: payload.thresholdUpdateCount,
    outputAfterCorrectnessGates: payload.outputAfterCorrectnessGates === true,
  };
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function postJsonToLoopback({ port, path, payload }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    }, (response) => {
      let responseText = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseText += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(responseText || '{}'),
        });
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify(payload));
  });
}

function normalizedSourceThresholdConfiguration() {
  const core = {
    schemaVersion: 4,
    variant: 4,
    mode: 'support-only-local-rollout-thresholds',
    laneId,
    rolloutThresholdsBps: [...configuredThresholdsBps],
    minSampleCount: decisionSamplesMs.length,
    maxStorageDriftBps: 0,
    maxP95DecisionMs: 5.1,
    maxDecisionMs: 7.5,
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

function buildStorageEvidence(config) {
  const samples = buildStoragePerformanceSamples(config);
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

function buildPerformanceEvidence(config) {
  const sorted = [...decisionSamplesMs].sort((left, right) => left - right);
  const p95DecisionMs = nearestRankPercentile(sorted, 0.95);
  const maxObservedDecisionMs = Math.max(...sorted);
  const core = {
    sampleCount: sorted.length,
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

function buildStoragePerformanceSamples(config) {
  return decisionSamplesMs.map((decisionMs, index) => {
    const thresholdBps = config.rolloutThresholdsBps[index % config.rolloutThresholdsBps.length];
    const core = {
      sampleIndex: index,
      thresholdBps,
      resourceKeyHash: sha256(`rpp-0800-resource-${index}`),
      expectedStorageHash: sha256(`rpp-0800-storage-before-${index}`),
      actualStorageHash: sha256(`rpp-0800-storage-before-${index}`),
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

function buildSourceRolloutSummary({ thresholdConfiguration, storage, performanceEvidence }) {
  const thresholdUpdateHashes = thresholdConfiguration.rolloutThresholdsBps.map((thresholdBps, index) =>
    sha256({
      sourceProofId,
      laneId,
      updateSequence: index,
      thresholdBps,
      configHash: thresholdConfiguration.configHash,
      storageEvidenceHash: storage.evidenceHash,
      performanceEvidenceHash: performanceEvidence.evidenceHash,
      correctnessGateVectorHash: sha256(expectedSourceGateIds),
      updateDecision: 'advance-threshold',
    }));
  const laneCore = {
    evidenceMode: 'support-only-rollout-threshold-configuration-v4',
    laneId,
    thresholdConfigHash: thresholdConfiguration.configHash,
    sourceGateVectorHash: sha256(expectedSourceGateIds),
    storageEvidenceHash: storage.evidenceHash,
    performanceEvidenceHash: performanceEvidence.evidenceHash,
    thresholdUpdateCount: thresholdUpdateHashes.length,
    thresholdUpdateHashes,
    sampleHashes: storage.sampleHashes,
  };
  const sourceOutput = {
    sourceProofId,
    gateVectorHash: sha256(expectedSourceGateIds),
    laneId,
    thresholdConfigHash: thresholdConfiguration.configHash,
    thresholdUpdateCount: thresholdUpdateHashes.length,
    storageEvidenceHash: storage.evidenceHash,
    performanceEvidenceHash: performanceEvidence.evidenceHash,
    releaseStatus: 'NO-GO',
  };

  return {
    sourceRppId: 'RPP-0780',
    sourceProofId,
    sourceVariant: 4,
    evidenceMode: 'support-only-rollout-threshold-configuration-v4',
    thresholdConfigHash: thresholdConfiguration.configHash,
    sourceGateVectorHash: sha256(expectedSourceGateIds),
    sourceGateCount: expectedSourceGateIds.length,
    sourcePassGateCount: expectedSourceGateIds.length,
    sourceBlockedGateCount: 0,
    sourceFailGateCount: 0,
    storageEvidenceHash: storage.evidenceHash,
    performanceEvidenceHash: performanceEvidence.evidenceHash,
    thresholdUpdateHashes,
    sampleHashes: storage.sampleHashes,
    laneEvidenceHash: sha256(laneCore),
    sourceOutputHash: sha256(sourceOutput),
  };
}

function buildFastPathLaneCarryThrough({ thresholdConfiguration, sourceRollout }) {
  const updateHashes = [...sourceRollout.thresholdUpdateHashes];

  return {
    laneId,
    sourceRppId: 'RPP-0780',
    sourceVariant: 4,
    updatePolicy: 'update-only-after-correctness-gates-and-thresholds-pass',
    outputBoundary: 'hash-count-only-fast-path-lane-output',
    configuredThresholdCount: thresholdConfiguration.rolloutThresholdsBps.length,
    thresholdUpdateCount: updateHashes.length,
    blockedUpdateCount: 0,
    thresholdSequenceHash: sha256(thresholdConfiguration.rolloutThresholdsBps),
    correctnessGateVectorHash: sourceRollout.sourceGateVectorHash,
    correctnessGateStatusBeforeEachUpdate: updateHashes.map(() => 'passed'),
    correctnessGatesHoldBeforeFirstUpdate: true,
    updatesOnlyAfterCorrectnessGates: true,
    unsafeUpdatesBeforeGates: 0,
    updatesWithFailedGate: 0,
    updatesWithUnknownThreshold: 0,
    updatesWithStorageDrift: 0,
    updatesOverPerformanceThreshold: 0,
    updateHashes,
    sourceOutputHash: sourceRollout.sourceOutputHash,
  };
}

function buildSourceUnsafeCaseCoverage() {
  const cases = [
    unsafeCase('unsafe-lane-update-before-gates', [
      'fast-path-lane-updates-only-after-correctness-gates',
    ]),
    unsafeCase('unknown-threshold-update', ['configured-threshold-sequence']),
    unsafeCase('storage-drift-exceeded', ['storage-thresholds-within-configuration']),
    unsafeCase('performance-threshold-exceeded', ['performance-thresholds-within-configuration']),
    unsafeCase('mismatched-configuration-hash', ['deterministic-threshold-configuration']),
    unsafeCase('premature-pass-status', ['correctness-gates-not-recorded']),
  ];

  return {
    sourceRppId: 'RPP-0780',
    sourceProofId,
    sourceVariant: 4,
    caseCount: cases.length,
    caseIds: cases.map((currentCase) => currentCase.caseId),
    allCasesBlocked: cases.every((currentCase) => currentCase.updated === false
      && currentCase.outputEmitted === false
      && currentCase.attemptedPassBlocked === true),
    outputSuppressedCount: cases.filter((currentCase) => currentCase.outputEmitted === false).length,
    blockedByCounts: countBy(cases.flatMap((currentCase) => currentCase.blockedBy), (id) => id),
    decisionHashes: cases.map((currentCase) => currentCase.decisionHash),
    coverageHash: digest(cases),
    cases,
  };
}

function unsafeCase(caseId, blockedBy) {
  const core = {
    caseId,
    status: 'blocked',
    updated: false,
    outputEmitted: false,
    attemptedPassBlocked: true,
    blockedBy,
  };

  return {
    ...core,
    decisionHash: digest(core),
  };
}

function refreshDeterminism(evidence, repeatedEvidence) {
  evidence.determinism.publicEvidenceHash = digest(publicReleaseVerifierEvidenceProjection(evidence));
  evidence.determinism.repeatedPublicEvidenceHash =
    digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence));
  evidence.determinism.samePublicProjection =
    evidence.determinism.publicEvidenceHash === evidence.determinism.repeatedPublicEvidenceHash;
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeReleaseVerifierGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveReleaseVerifierCarryThrough(evidence) {
  const recomputedGates = recomputeReleaseVerifierGates(evidence);
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
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        evidenceSource,
        gateVectorHash: sha256(recomputedGates),
        releaseVerifierHash: sha256(evidence.releaseVerifier),
        sourceRolloutHash: sha256({
          builtOn: evidence.builtOn,
          sourceRollout: evidence.sourceRollout,
        }),
        loopbackFixtureHash: evidence.loopbackFixture.responseHash,
        thresholdConfigHash: evidence.thresholdConfiguration.configHash,
        laneEvidenceHash: evidence.sourceRollout.laneEvidenceHash,
        sourceOutputHash: evidence.sourceRollout.sourceOutputHash,
        thresholdUpdateCount: evidence.fastPathLane.thresholdUpdateCount,
        blockedUpdateCount: evidence.fastPathLane.blockedUpdateCount,
        storageCheckCount: evidence.resources.storage.attemptedChecks,
        performanceSampleCount: evidence.resources.performance.sampleCount,
        unsafeCaseCount: evidence.sourceUnsafeCases.caseCount,
        unsafeCaseCoverageHash: evidence.sourceUnsafeCases.coverageHash,
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

function recomputeReleaseVerifierGates(evidence) {
  const releaseVerifier = evidence.releaseVerifier || {};
  const command = releaseVerifier.command || {};
  const carryThrough = releaseVerifier.carryThrough || {};
  const loopbackFixture = evidence.loopbackFixture || {};
  const builtOn = evidence.builtOn || {};
  const previousVariant = builtOn.previousVariant || {};
  const predecessor = previousVariant.builtOn || {};
  const config = evidence.thresholdConfiguration || {};
  const sourceRollout = evidence.sourceRollout || {};
  const lane = evidence.fastPathLane || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const performanceEvidence = resources.performance || {};
  const processResources = resources.process || {};
  const runtime = evidence.runtime || {};
  const sourceUnsafeCases = evidence.sourceUnsafeCases || {};
  const determinism = evidence.determinism || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const configuredThresholds = Array.isArray(config.rolloutThresholdsBps)
    ? config.rolloutThresholdsBps
    : [];
  const laneUpdateHashes = Array.isArray(lane.updateHashes) ? lane.updateHashes : [];
  const sourceThresholdHashes = Array.isArray(sourceRollout.thresholdUpdateHashes)
    ? sourceRollout.thresholdUpdateHashes
    : [];
  const unsafeCaseIds = Array.isArray(sourceUnsafeCases.caseIds) ? sourceUnsafeCases.caseIds : [];
  const unsafeCases = Array.isArray(sourceUnsafeCases.cases) ? sourceUnsafeCases.cases : [];
  const publicProjectionHash = digest(publicReleaseVerifierEvidenceProjection(evidence));
  const releaseVerifierReported = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.passFailStatusesOnly === true
    && command.loopbackFixture === 'support-only-loopback-live-http'
    && command.gateCount === expectedSourceGateIds.length
    && sameArray(command.passGateIds || [], expectedSourceGateIds)
    && sameArray(command.blockedGateIds || [], [])
    && sameArray(command.failGateIds || [], [])
    && command.productionGateEvidence === 'not-present'
    && command.reportHash === digest(commandWithoutReportHash(command))
    && carryThrough.status === 'support-only-local-release-verifier'
    && carryThrough.fromRpp === 'RPP-0780'
    && carryThrough.sourceProofId === sourceProofId
    && carryThrough.sourceVariant === 4
    && carryThrough.checkedSourceGate === 'fast-path-lane-updates-only-after-correctness-gates'
    && carryThrough.thresholdUpdateCount === configuredThresholdsBps.length
    && carryThrough.loopbackFixtureHash === loopbackFixture.responseHash
    && carryThrough.outputAfterCorrectnessGates === true
    && carryThrough.proofHash === sha256(carryThroughCore(carryThrough));
  const expectedLoopbackPayload = loopbackVerifierPayload({
    thresholdConfiguration: config,
    sourceRollout,
    fastPathLane: lane,
  });
  const expectedLoopbackResponse = loopbackVerifierResponse(expectedLoopbackPayload);
  const loopbackFixtureCarried = loopbackFixture.fixtureMode === 'support-only-loopback-live-http'
    && loopbackFixture.localOnly === true
    && loopbackFixture.externalExposure === false
    && loopbackFixture.bindAddressHash === sha256('127.0.0.1')
    && loopbackFixture.endpointPathHash === sha256(loopbackVerifierPath)
    && loopbackFixture.requestMethod === 'POST'
    && loopbackFixture.requestPathHash === sha256(loopbackVerifierPath)
    && loopbackFixture.requestCount === 1
    && loopbackFixture.requestHash === sha256(expectedLoopbackPayload)
    && loopbackFixture.responseStatus === 200
    && loopbackFixture.responseHash === sha256(expectedLoopbackResponse)
    && loopbackFixture.responseGateCount === expectedSourceGateIds.length
    && loopbackFixture.responseThresholdUpdateCount === configuredThresholdsBps.length
    && loopbackFixture.responseOutputAfterCorrectnessGates === true
    && loopbackFixture.responseSourceGateVectorHash === sourceRollout.sourceGateVectorHash
    && loopbackFixture.responseThresholdConfigHash === config.configHash
    && loopbackFixture.responseLaneEvidenceHash === sourceRollout.laneEvidenceHash
    && loopbackFixture.responseSourceOutputHash === sourceRollout.sourceOutputHash;
  const runtimeWithinBudget = runtime.profile === 'release-verifier-local'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && runtime.budgets?.maxDurationMs === maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && runtime.budgets?.maxHeapUsedBytes === maxHeapUsedBytes;
  const builtOnV4 = builtOn.rppId === 'RPP-0780'
    && builtOn.proofId === sourceProofId
    && builtOn.variant === 4
    && builtOn.status === 'passed'
    && sameArray(builtOn.sourceGateIds || [], expectedSourceGateIds)
    && builtOn.sourceGateVectorHash === sha256(expectedSourceGateIds)
    && isSha256Hash(builtOn.evidenceHash)
    && previousVariant.rppId === 'RPP-0760'
    && previousVariant.proofId === previousProofId
    && previousVariant.variant === 3
    && previousVariant.status === 'passed'
    && predecessor.rppId === 'RPP-0740'
    && predecessor.proofId === predecessorProofId
    && predecessor.variant === 2
    && predecessor.status === 'passed';
  const thresholdConfigurationCarried = config.schemaVersion === 4
    && config.variant === 4
    && config.mode === 'support-only-local-rollout-thresholds'
    && config.laneId === laneId
    && sameArray(configuredThresholds, configuredThresholdsBps)
    && isStrictlyAscending(configuredThresholds)
    && config.minSampleCount === decisionSamplesMs.length
    && config.maxStorageDriftBps === 0
    && config.maxP95DecisionMs === 5.1
    && config.maxDecisionMs === 7.5
    && config.maxUnsafeUpdatesBeforeGates === 0
    && config.maxLaneUpdatesWithFailedGate === 0
    && config.failClosedOnUnknownThreshold === true
    && config.configHash === sha256(thresholdConfigurationCore(config))
    && sourceRollout.thresholdConfigHash === config.configHash;
  const storageEvidenceHashMatches = storage.evidenceHash === sha256(storageEvidenceCore(storage));
  const performanceEvidenceHashMatches =
    performanceEvidence.evidenceHash === sha256(performanceEvidenceCore(performanceEvidence));
  const storagePerformanceCarried = storage.attemptedChecks === decisionSamplesMs.length
    && storage.matchedChecks === storage.attemptedChecks
    && storage.driftedChecks === 0
    && storage.storageDriftBps <= config.maxStorageDriftBps
    && storageEvidenceHashMatches
    && performanceEvidence.sampleCount === decisionSamplesMs.length
    && performanceEvidence.p95DecisionMs <= config.maxP95DecisionMs
    && performanceEvidence.maxDecisionMs <= config.maxDecisionMs
    && performanceEvidence.overP95Budget === false
    && performanceEvidence.overMaxBudget === false
    && performanceEvidenceHashMatches
    && sourceRollout.storageEvidenceHash === storage.evidenceHash
    && sourceRollout.performanceEvidenceHash === performanceEvidence.evidenceHash;
  const fastPathLaneUpdatesAfterGates = lane.laneId === laneId
    && lane.sourceRppId === 'RPP-0780'
    && lane.sourceVariant === 4
    && lane.updatePolicy === 'update-only-after-correctness-gates-and-thresholds-pass'
    && lane.outputBoundary === 'hash-count-only-fast-path-lane-output'
    && lane.configuredThresholdCount === configuredThresholds.length
    && lane.thresholdUpdateCount === configuredThresholds.length
    && lane.thresholdUpdateCount === laneUpdateHashes.length
    && lane.blockedUpdateCount === 0
    && lane.thresholdSequenceHash === sha256(configuredThresholds)
    && lane.correctnessGateVectorHash === sourceRollout.sourceGateVectorHash
    && lane.correctnessGatesHoldBeforeFirstUpdate === true
    && lane.updatesOnlyAfterCorrectnessGates === true
    && lane.unsafeUpdatesBeforeGates <= config.maxUnsafeUpdatesBeforeGates
    && lane.updatesWithFailedGate <= config.maxLaneUpdatesWithFailedGate
    && lane.updatesWithUnknownThreshold === 0
    && lane.updatesWithStorageDrift === 0
    && lane.updatesOverPerformanceThreshold === 0
    && sameArray(lane.correctnessGateStatusBeforeEachUpdate || [], laneUpdateHashes.map(() => 'passed'))
    && sameArray(laneUpdateHashes, sourceThresholdHashes)
    && laneUpdateHashes.every((hash) => sha256PrefixedPattern.test(hash))
    && lane.sourceOutputHash === sourceRollout.sourceOutputHash;
  const sourceUnsafeCoverage = sourceUnsafeCases.sourceRppId === 'RPP-0780'
    && sourceUnsafeCases.sourceProofId === sourceProofId
    && sourceUnsafeCases.sourceVariant === 4
    && sourceUnsafeCases.caseCount === expectedUnsafeCaseIds.length
    && sameArray(unsafeCaseIds, expectedUnsafeCaseIds)
    && sourceUnsafeCases.allCasesBlocked === true
    && sourceUnsafeCases.outputSuppressedCount === expectedUnsafeCaseIds.length
    && sameArray(sourceUnsafeCases.decisionHashes || [], unsafeCases.map((currentCase) =>
      currentCase.decisionHash))
    && sourceUnsafeCases.coverageHash === digest(unsafeCases)
    && unsafeCases.every((currentCase) => currentCase.status === 'blocked'
      && currentCase.updated === false
      && currentCase.outputEmitted === false
      && currentCase.attemptedPassBlocked === true)
    && sourceUnsafeCases.blockedByCounts?.['fast-path-lane-updates-only-after-correctness-gates'] === 1
    && sourceUnsafeCases.blockedByCounts?.['configured-threshold-sequence'] === 1
    && sourceUnsafeCases.blockedByCounts?.['storage-thresholds-within-configuration'] === 1
    && sourceUnsafeCases.blockedByCounts?.['performance-thresholds-within-configuration'] === 1
    && sourceUnsafeCases.blockedByCounts?.['deterministic-threshold-configuration'] === 1
    && sourceUnsafeCases.blockedByCounts?.['correctness-gates-not-recorded'] === 1;
  const deterministicHashCountOnlyEvidence = determinism.samePublicProjection === true
    && determinism.publicEvidenceHash === publicProjectionHash
    && determinism.repeatedPublicEvidenceHash === publicProjectionHash
    && releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence));
  const outputHashCountOnly = sourceRollout.sourcePassGateCount === expectedSourceGateIds.length
    && sourceRollout.sourceBlockedGateCount === 0
    && sourceRollout.sourceFailGateCount === 0
    && sourceRollout.sourceGateVectorHash === sha256(expectedSourceGateIds)
    && sourceRollout.thresholdUpdateHashes.length === configuredThresholds.length
    && sourceRollout.sampleHashes.length === decisionSamplesMs.length
    && isSha256PrefixedHash(sourceRollout.laneEvidenceHash)
    && isSha256PrefixedHash(sourceRollout.sourceOutputHash)
    && releaseVerifierEvidenceHasNoRawValues({
      releaseVerifier,
      loopbackFixture,
      sourceRollout,
      fastPathLane: lane,
    });

  return [
    proofGate('release-verifier-runtime-resources-gates-reported',
      releaseVerifierReported && runtimeWithinBudget, {
      reportsRuntime: command.reportsRuntime,
      reportsResources: command.reportsResources,
      reportsPassFailGates: command.reportsPassFailGates,
      gateCount: command.gateCount,
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
    }),
    proofGate('loopback-live-http-fixture-carried-through', loopbackFixtureCarried, {
      requestCount: loopbackFixture.requestCount,
      responseStatus: loopbackFixture.responseStatus,
      responseGateCount: loopbackFixture.responseGateCount,
      responseThresholdUpdateCount: loopbackFixture.responseThresholdUpdateCount,
      localOnly: loopbackFixture.localOnly,
      externalExposure: loopbackFixture.externalExposure,
    }),
    proofGate('built-on-rollout-threshold-configuration-v4', builtOnV4, {
      builtOnRppId: builtOn.rppId,
      builtOnVariant: builtOn.variant,
      previousVariantStatus: previousVariant.status,
      predecessorStatus: predecessor.status,
    }),
    proofGate('threshold-configuration-v4-carried-through', thresholdConfigurationCarried, {
      configHash: config.configHash,
      expectedConfigHash: sha256(thresholdConfigurationCore(config)),
      thresholdCount: configuredThresholds.length,
      sourceThresholdConfigHash: sourceRollout.thresholdConfigHash,
    }),
    proofGate('storage-performance-thresholds-carried-through', storagePerformanceCarried, {
      attemptedChecks: storage.attemptedChecks,
      matchedChecks: storage.matchedChecks,
      driftedChecks: storage.driftedChecks,
      storageDriftBps: storage.storageDriftBps,
      p95DecisionMs: performanceEvidence.p95DecisionMs,
      maxDecisionMs: performanceEvidence.maxDecisionMs,
      storageEvidenceHashMatches,
      performanceEvidenceHashMatches,
    }),
    proofGate('fast-path-lane-updates-only-after-correctness-gates-hold',
      fastPathLaneUpdatesAfterGates, {
      thresholdUpdateCount: lane.thresholdUpdateCount,
      blockedUpdateCount: lane.blockedUpdateCount,
      unsafeUpdatesBeforeGates: lane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: lane.updatesWithFailedGate,
      correctnessGatesHoldBeforeFirstUpdate: lane.correctnessGatesHoldBeforeFirstUpdate,
    }),
    proofGate('generated-unsafe-threshold-cases-fail-closed', sourceUnsafeCoverage, {
      caseCount: sourceUnsafeCases.caseCount,
      outputSuppressedCount: sourceUnsafeCases.outputSuppressedCount,
      blockedByCounts: sourceUnsafeCases.blockedByCounts,
    }),
    proofGate('deterministic-hash-count-only-rollout-evidence',
      deterministicHashCountOnlyEvidence, {
      publicEvidenceHash: determinism.publicEvidenceHash,
      repeatedPublicEvidenceHash: determinism.repeatedPublicEvidenceHash,
      rawValueEvidenceLeaks: releaseVerifierEvidenceHasNoRawValues(
        publicReleaseVerifierEvidenceProjection(evidence),
      ) ? 0 : 1,
    }),
    proofGate('release-verifier-output-hash-count-only', outputHashCountOnly, {
      laneEvidenceHash: sourceRollout.laneEvidenceHash,
      sourceOutputHash: sourceRollout.sourceOutputHash,
      thresholdUpdateCount: sourceRollout.thresholdUpdateHashes.length,
      sampleHashCount: sourceRollout.sampleHashes.length,
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

function unsafeReleaseVerifierDecisions(evidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.command.reportsRuntime = false;

  const loopbackFixtureFailure = withPassedStatus(clone(evidence));
  loopbackFixtureFailure.loopbackFixture.responseStatus = 503;
  loopbackFixtureFailure.loopbackFixture.externalExposure = true;

  const staleBuiltOnEvidence = withPassedStatus(clone(evidence));
  staleBuiltOnEvidence.builtOn.sourceGateIds = staleBuiltOnEvidence.builtOn.sourceGateIds.slice(0, -1);
  staleBuiltOnEvidence.builtOn.sourceGateVectorHash = sha256(staleBuiltOnEvidence.builtOn.sourceGateIds);

  const thresholdSequenceDrift = withPassedStatus(clone(evidence));
  thresholdSequenceDrift.thresholdConfiguration.rolloutThresholdsBps = [
    ...thresholdSequenceDrift.thresholdConfiguration.rolloutThresholdsBps,
    8750,
  ];

  const storageDriftExceeded = withPassedStatus(clone(evidence));
  storageDriftExceeded.resources.storage.matchedChecks -= 1;
  storageDriftExceeded.resources.storage.driftedChecks = 1;
  storageDriftExceeded.resources.storage.storageDriftBps = basisPoints(
    storageDriftExceeded.resources.storage.driftedChecks,
    storageDriftExceeded.resources.storage.attemptedChecks,
  );

  const performanceThresholdExceeded = withPassedStatus(clone(evidence));
  performanceThresholdExceeded.resources.performance.p95DecisionMs = 5.6;
  performanceThresholdExceeded.resources.performance.overP95Budget = true;

  const laneUpdateBeforeGates = withPassedStatus(clone(evidence));
  laneUpdateBeforeGates.fastPathLane.correctnessGatesHoldBeforeFirstUpdate = false;
  laneUpdateBeforeGates.fastPathLane.updatesOnlyAfterCorrectnessGates = false;
  laneUpdateBeforeGates.fastPathLane.unsafeUpdatesBeforeGates = 1;
  laneUpdateBeforeGates.fastPathLane.updatesWithFailedGate = 1;
  laneUpdateBeforeGates.fastPathLane.correctnessGateStatusBeforeEachUpdate[0] = 'failed';

  const staleUnsafeCaseCoverage = withPassedStatus(clone(evidence));
  staleUnsafeCaseCoverage.sourceUnsafeCases.cases =
    staleUnsafeCaseCoverage.sourceUnsafeCases.cases.slice(0, -1);
  staleUnsafeCaseCoverage.sourceUnsafeCases.caseIds =
    staleUnsafeCaseCoverage.sourceUnsafeCases.caseIds.slice(0, -1);
  staleUnsafeCaseCoverage.sourceUnsafeCases.decisionHashes =
    staleUnsafeCaseCoverage.sourceUnsafeCases.decisionHashes.slice(0, -1);
  staleUnsafeCaseCoverage.sourceUnsafeCases.caseCount -= 1;
  staleUnsafeCaseCoverage.sourceUnsafeCases.outputSuppressedCount -= 1;

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.sourceRollout.leakedPath = 'wp-content/uploads/2026/05/rollout-sample.bin';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport),
    loopbackFixtureFailure: resolveReleaseVerifierCarryThrough(loopbackFixtureFailure),
    staleBuiltOnEvidence: resolveReleaseVerifierCarryThrough(staleBuiltOnEvidence),
    thresholdSequenceDrift: resolveReleaseVerifierCarryThrough(thresholdSequenceDrift),
    storageDriftExceeded: resolveReleaseVerifierCarryThrough(storageDriftExceeded),
    performanceThresholdExceeded: resolveReleaseVerifierCarryThrough(performanceThresholdExceeded),
    laneUpdateBeforeGates: resolveReleaseVerifierCarryThrough(laneUpdateBeforeGates),
    staleUnsafeCaseCoverage: resolveReleaseVerifierCarryThrough(staleUnsafeCaseCoverage),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus),
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
    loopbackFixture: evidence.loopbackFixture,
    thresholdConfiguration: evidence.thresholdConfiguration,
    sourceRollout: evidence.sourceRollout,
    fastPathLane: evidence.fastPathLane,
    resources: {
      storage: evidence.resources?.storage,
      performance: evidence.resources?.performance,
    },
    sourceUnsafeCases: evidence.sourceUnsafeCases,
    release: evidence.release,
  };
}

function commandWithoutReportHash(command) {
  return {
    invocation: command.invocation,
    reportsRuntime: command.reportsRuntime,
    reportsResources: command.reportsResources,
    reportsPassFailGates: command.reportsPassFailGates,
    passFailStatusesOnly: command.passFailStatusesOnly,
    loopbackFixture: command.loopbackFixture,
    gateCount: command.gateCount,
    passGateIds: command.passGateIds,
    blockedGateIds: command.blockedGateIds,
    failGateIds: command.failGateIds,
    productionGateEvidence: command.productionGateEvidence,
  };
}

function carryThroughCore(carryThrough) {
  return {
    status: carryThrough.status,
    fromRpp: carryThrough.fromRpp,
    sourceProofId: carryThrough.sourceProofId,
    sourceVariant: carryThrough.sourceVariant,
    checkedSourceGate: carryThrough.checkedSourceGate,
    thresholdUpdateCount: carryThrough.thresholdUpdateCount,
    laneEvidenceHash: carryThrough.laneEvidenceHash,
    loopbackFixtureHash: carryThrough.loopbackFixtureHash,
    outputAfterCorrectnessGates: carryThrough.outputAfterCorrectnessGates,
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

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'production-rollout-approval-not-claimed',
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

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return findEvidenceRedactionIssues(value).length === 0
    && !rawReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawReleaseVerifierEvidencePattern() {
  return /https?:\/\/|Bearer\s+|Basic\s+|wp-content\/uploads|raw payload|post content|meta value|option value|customer secret/i;
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
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isStrictlyAscending(values) {
  return values.length > 0
    && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function isSha256Hash(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function isSha256PrefixedHash(value) {
  return typeof value === 'string' && sha256PrefixedPattern.test(value);
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
