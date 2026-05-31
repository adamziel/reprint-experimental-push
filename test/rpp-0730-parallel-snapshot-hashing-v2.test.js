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

const proofId = 'rpp-0730-parallel-snapshot-hashing-v2';
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

test('RPP-0730 variant 2 proves parallel snapshot hashing waits for correctness gates', { concurrency: false }, () => {
  const first = runSmallBenchmark();
  const second = runSmallBenchmark();
  const proof = buildVariant2Proof(first, second);

  assert.equal(proof.rppId, 'RPP-0730');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0710');
  assert.equal(proof.builtOn.benchmarkId, snapshotHashingBenchmarkId);
  assert.equal(proof.builtOn.variant, 1);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.scheduler.maxConcurrency, 2);
  assert.equal(proof.scheduler.maxObservedInFlight <= proof.scheduler.maxConcurrency, true);
  assert.equal(proof.scheduler.bounded, true);
  assert.equal(proof.hashSet.snapshotCount, 3);
  assert.equal(proof.hashSet.hashCount, proof.hashSet.expectedHashCount);
  assert.equal(proof.hashSet.parallelDigest, proof.hashSet.sequentialDigest);
  assert.equal(proof.hashSet.parallelDigest, proof.hashSet.secondRunDigest);
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
  assert.equal(proof.correctness.correctnessGatesHoldBeforeLane, true);
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
  assert.match(proof.fastPathLane.outputHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.unsafe.staleParallelMismatch.updated, false);
  assert.equal(proof.unsafe.staleParallelMismatch.attemptedLaneUpdateBlocked, true);
  assert.ok(proof.unsafe.staleParallelMismatch.blockedBy.includes('parallel-matches-sequential'));
  assert.equal(proof.unsafe.prematureLaneAttempt.updated, false);
  assert.equal(proof.unsafe.prematureLaneAttempt.attemptedLaneUpdateBlocked, true);
  assert.ok(proof.unsafe.prematureLaneAttempt.blockedBy.includes('correctness-gates-not-recorded'));
  assert.equal(proof.unsafe.unsafeApplyPrecondition.updated, false);
  assert.equal(proof.unsafe.unsafeApplyPrecondition.attemptedLaneUpdateBlocked, true);
  assert.ok(proof.unsafe.unsafeApplyPrecondition.blockedBy.includes('planning-only-no-write-authority'));
  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawSnapshotValues(proof);
});

test('RPP-0730 variant 2 blocks stale, unsafe, and premature lane attempts', () => {
  const safeDecision = resolveVariant2FastPathLane(syntheticSnapshotEvidence(), {
    attemptedLaneUpdate: true,
  });
  const staleDecision = resolveVariant2FastPathLane(
    syntheticSnapshotEvidence({
      hashSet: {
        parallelDigest: sha256Label('stale-parallel-digest'),
        parallelMatchesSequential: false,
      },
    }),
    { attemptedLaneUpdate: true },
  );
  const prematureDecision = resolveVariant2FastPathLane(
    syntheticSnapshotEvidence({
      correctnessGates: [],
    }),
    { attemptedLaneUpdate: true },
  );
  const unsafeDecision = resolveVariant2FastPathLane(
    syntheticSnapshotEvidence({
      applyBoundary: {
        liveRemoteMutationPreconditions: 0,
        everyMutationHasLiveRemotePrecondition: false,
      },
    }),
    { attemptedLaneUpdate: true },
  );

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.equal(safeDecision.correctnessGatesHold, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.equal(staleDecision.updated, false);
  assert.equal(staleDecision.outputEmitted, false);
  assert.equal(staleDecision.output, null);
  assert.equal(staleDecision.attemptedLaneUpdateBlocked, true);
  assert.ok(staleDecision.blockedBy.includes('parallel-matches-sequential'));
  assert.equal(prematureDecision.updated, false);
  assert.equal(prematureDecision.outputEmitted, false);
  assert.equal(prematureDecision.output, null);
  assert.equal(prematureDecision.attemptedLaneUpdateBlocked, true);
  assert.ok(prematureDecision.blockedBy.includes('correctness-gates-not-recorded'));
  assert.equal(unsafeDecision.updated, false);
  assert.equal(unsafeDecision.outputEmitted, false);
  assert.equal(unsafeDecision.output, null);
  assert.equal(unsafeDecision.attemptedLaneUpdateBlocked, true);
  assert.ok(unsafeDecision.blockedBy.includes('planning-only-no-write-authority'));

  for (const decision of [safeDecision, staleDecision, prematureDecision, unsafeDecision]) {
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertProjectionHasNoRawSnapshotValues(decision);
  }
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
    tempDir: fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0730-')),
    ...overrides,
  });
}

function buildVariant2Proof(report, repeatedReport) {
  const snapshotEvidence = report.evidence.parallelSnapshotHashing;
  const repeatedSnapshotEvidence = repeatedReport.evidence.parallelSnapshotHashing;
  const safeDecision = resolveVariant2FastPathLane(snapshotEvidence, {
    attemptedLaneUpdate: snapshotEvidence.fastPathLane.updated,
  });
  const unsafe = unsafeCaseDecisions(snapshotEvidence);
  const rolloutGate = report.rolloutSafetyGates.gates.find((gate) =>
    gate.id === 'parallel-snapshot-hashing');
  const firstProjection = publicSnapshotEvidenceProjection(snapshotEvidence);
  const secondProjection = publicSnapshotEvidenceProjection(repeatedSnapshotEvidence);
  const deterministicProjection = digest(firstProjection) === digest(secondProjection);
  const productionBlockers = productionThroughputBlockers(report);
  const productionBlockerAbsent = !productionBlockers.includes('missing-parallel-snapshot-hashing-evidence');
  const correctnessGatesRecordedBeforeLane = objectKeyBefore(
    snapshotEvidence,
    'correctnessGates',
    'fastPathLane',
  );
  const supportOnlyRelease = {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
  const unsafeFastPathOutputs = [
    unsafe.staleParallelMismatch,
    unsafe.prematureLaneAttempt,
    unsafe.unsafeApplyPrecondition,
  ].filter((decision) => decision.updated).length;
  const gates = [
    proofGate('bounded-parallel-hash-set', safeDecision.recomputedGates.every((gate) =>
      gate.status === 'pass'), {
      recomputedGateVector: safeDecision.recomputedGates,
    }),
    proofGate('correctness-gates-before-fast-path-lane', correctnessGatesRecordedBeforeLane
      && safeDecision.correctnessGatesHold
      && safeDecision.updated
      && snapshotEvidence.fastPathLane.updated === true, {
      correctnessGatesRecordedBeforeLane,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      fastPathLaneUpdated: snapshotEvidence.fastPathLane.updated,
    }),
    proofGate('unsafe-inputs-block-fast-path-lane', unsafeFastPathOutputs === 0
      && unsafe.staleParallelMismatch.attemptedLaneUpdateBlocked
      && unsafe.prematureLaneAttempt.attemptedLaneUpdateBlocked
      && unsafe.unsafeApplyPrecondition.attemptedLaneUpdateBlocked, {
      unsafeFastPathOutputs,
      blockedDecisionHashes: [
        unsafe.staleParallelMismatch.decisionHash,
        unsafe.prematureLaneAttempt.decisionHash,
        unsafe.unsafeApplyPrecondition.decisionHash,
      ],
    }),
    proofGate('deterministic-hash-only-projection', deterministicProjection
      && parallelSnapshotHashEvidenceHasNoRawValues(firstProjection)
      && parallelSnapshotHashEvidenceHasNoRawValues(secondProjection), {
      firstEvidenceHash: digest(firstProjection),
      secondEvidenceHash: digest(secondProjection),
      sameProjectionHash: deterministicProjection,
    }),
    proofGate('production-speed-claims-disabled', supportOnlyRelease.speedClaimsAllowed === false
      && supportOnlyRelease.productionThroughput === 'not-claimed'
      && report.claims.productionThroughput.status === 'blocked'
      && productionBlockerAbsent, {
      productionThroughputStatus: report.claims.productionThroughput.status,
      productionBlockerAbsent,
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicEvidence = {
    rppId: 'RPP-0730',
    proofId,
    variant: 2,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0710',
      benchmarkId: snapshotEvidence.benchmarkId,
      variant: snapshotEvidence.variant,
      evidenceHash: digest(firstProjection),
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
      correctnessGatesHoldBeforeLane: safeDecision.correctnessGatesHold,
      rolloutGateStatus: rolloutGate?.status || 'missing',
      productionBlockerAbsent,
    },
    fastPathLane: {
      id: snapshotEvidence.fastPathLane.id,
      policy: snapshotEvidence.fastPathLane.policy,
      updated: snapshotEvidence.fastPathLane.updated,
      outputEmittedAfterGates: safeDecision.outputEmitted,
      correctnessGatesEvaluatedBeforeUpdate: correctnessGatesRecordedBeforeLane
        && safeDecision.recordedGateIdsComplete,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      blockedBy: safeDecision.blockedBy,
      outputHash: safeDecision.outputHash,
      proofDigestHash: digest(snapshotEvidence.fastPathLane.proofDigest),
      unsafeFastPathOutputs,
    },
    unsafe: projectUnsafeDecisions(unsafe),
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-redacted',
      rawValueEvidenceLeaks: 0,
      publicSnapshotEvidenceHash: digest(firstProjection),
      repeatedSnapshotEvidenceHash: digest(secondProjection),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function resolveVariant2FastPathLane(evidence, { attemptedLaneUpdate }) {
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
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        id: evidence.fastPathLane?.id || fastPathLaneId,
        policy: 'update-only-after-correctness-gates-pass',
        gateVectorHash: digest(recomputedGates),
        hashSetDigest: digest({
          parallelDigest: evidence.hashSet.parallelDigest,
          sequentialDigest: evidence.hashSet.sequentialDigest,
          secondRunDigest: evidence.hashSet.secondRunDigest,
        }),
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedLaneUpdate,
    attemptedLaneUpdateBlocked: Boolean(attemptedLaneUpdate && !correctnessGatesHold),
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    blockedBy,
    recomputedGates,
    outputHash: output ? digest(output) : null,
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

function unsafeCaseDecisions(snapshotEvidence) {
  const staleParallelMismatch = clone(snapshotEvidence);
  staleParallelMismatch.hashSet.parallelMatchesSequential = false;
  staleParallelMismatch.hashSet.parallelDigest = sha256Label('rpp-0730-stale-parallel-digest');

  const prematureLaneAttempt = clone(snapshotEvidence);
  prematureLaneAttempt.correctnessGates = [];

  const unsafeApplyPrecondition = clone(snapshotEvidence);
  unsafeApplyPrecondition.applyBoundary.everyMutationHasLiveRemotePrecondition = false;
  unsafeApplyPrecondition.applyBoundary.liveRemoteMutationPreconditions = 0;

  return {
    staleParallelMismatch: resolveVariant2FastPathLane(staleParallelMismatch, {
      attemptedLaneUpdate: true,
    }),
    prematureLaneAttempt: resolveVariant2FastPathLane(prematureLaneAttempt, {
      attemptedLaneUpdate: true,
    }),
    unsafeApplyPrecondition: resolveVariant2FastPathLane(unsafeApplyPrecondition, {
      attemptedLaneUpdate: true,
    }),
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

function syntheticSnapshotEvidence(overrides = {}) {
  const hashDigest = sha256Label('synthetic-safe-snapshot-hash-set');
  const base = {
    benchmarkId: snapshotHashingBenchmarkId,
    variant: 1,
    scope: 'synthetic-bounded-snapshot-hash-set',
    mode: 'bounded-parallel-scheduler-proof',
    status: 'passed',
    scheduler: {
      maxConcurrency: 2,
      maxAllowedConcurrency: 16,
      maxObservedInFlight: 2,
      workerSlotsUsed: 2,
      waveCount: 3,
      jobsScheduled: 6,
      scheduleDigest: sha256Label('synthetic-safe-schedule'),
      bounded: true,
    },
    hashSet: {
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
    },
    applyBoundary: {
      planningOnly: true,
      authorizesApply: false,
      applyMustRevalidate: true,
      liveRemoteMutationPreconditions: 2,
      everyMutationHasLiveRemotePrecondition: true,
    },
    fastPathLane: {
      id: fastPathLaneId,
      policy: 'update-only-after-correctness-gates-pass',
      updated: true,
      blockedBy: [],
      proofDigest: sha256Label('synthetic-safe-lane-proof'),
    },
  };
  const merged = {
    ...base,
    ...overrides,
    scheduler: { ...base.scheduler, ...overrides.scheduler },
    hashSet: { ...base.hashSet, ...overrides.hashSet },
    applyBoundary: { ...base.applyBoundary, ...overrides.applyBoundary },
    fastPathLane: { ...base.fastPathLane, ...overrides.fastPathLane },
  };
  merged.correctnessGates = overrides.correctnessGates ?? recomputeSnapshotGates(merged).map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidence: gate.metrics,
  }));
  return merged;
}

function projectUnsafeDecisions(unsafe) {
  return Object.fromEntries(
    Object.entries(unsafe).map(([name, decision]) => [
      name,
      {
        updated: decision.updated,
        outputEmitted: decision.outputEmitted,
        attemptedLaneUpdateBlocked: decision.attemptedLaneUpdateBlocked,
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

function parallelSnapshotHashEvidenceHasNoRawValues(evidence) {
  const serialized = JSON.stringify(evidence);
  return !rawSnapshotValuePattern().test(serialized)
    && !(evidence.hashSet?.hashSamples || []).some((sample) => Object.hasOwn(sample, 'resourceKey'));
}

function assertProjectionHasNoRawSnapshotValues(value) {
  assert.doesNotMatch(JSON.stringify(value), rawSnapshotValuePattern());
}

function rawSnapshotValuePattern() {
  return /row-payload|commerce_bench|catalog identity|Benchmark child post|Benchmark featured attachment|benchmark-topic|catalog-export\.bin|wp-content\/plugins|_thumbnail_id|_benchmark_term_flag|"resourceKey":/i;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
