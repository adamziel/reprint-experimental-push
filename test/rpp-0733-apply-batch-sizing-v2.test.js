import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0733-apply-batch-sizing-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const mutationCount = 10;
const applyBatchSize = 3;
const interruptedAfterCommittedBatches = 2;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const expectedGateIds = Object.freeze([
  'deterministic-apply-batch-size',
  'ordered-apply-batches',
  'complete-mutation-coverage',
  'batch-window-hashes-match',
  'deterministic-resume-evidence',
  'resume-skips-durable-batches',
  'resume-applies-only-missing-batches',
  'no-duplicate-mutation-work',
  'storage-boundary-cas-before-resume-mutations',
  'hash-only-apply-batch-evidence',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);

test('RPP-733 variant 2 proves apply batch sizing resume without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0733');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0713');
  assert.equal(proof.builtOn.applyBatchSizing.mode, 'apply');
  assert.equal(proof.builtOn.applyBatchSizing.maxBatchSize, 500);
  assert.equal(proof.builtOn.applyBatchSizing.storageBoundary, 'per-mutation-storage-boundary-cas');
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= maxHeapUsedBytes, true);
  assert.equal(proof.resources.apply.mutationCount, mutationCount);
  assert.equal(proof.resources.apply.applyBatchSize, applyBatchSize);
  assert.equal(proof.resources.apply.batchCount, 4);

  assert.equal(proof.batchCollection.mutationCount, mutationCount);
  assert.equal(proof.batchCollection.batchSize, applyBatchSize);
  assert.equal(proof.batchCollection.batchWindowCount, 4);
  assert.deepEqual(proof.batchCollection.batchStarts, [0, 3, 6, 9]);
  assert.deepEqual(proof.batchCollection.batchEnds, [2, 5, 8, 9]);
  assert.deepEqual(proof.batchCollection.batchSizes, [3, 3, 3, 1]);
  assert.equal(proof.batchCollection.totalWindowMutations, mutationCount);
  assert.equal(proof.batchCollection.uniqueMutationIdHashes, mutationCount);
  assert.equal(proof.batchCollection.observedCoverageHash, proof.batchCollection.expectedCoverageHash);
  assert.match(proof.batchCollection.batchCollectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.mutationCount <= applyBatchSize));
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.batchHash.match(/^sha256:[a-f0-9]{64}$/)));

  assert.equal(proof.firstAttempt.outcome, 'interrupted-after-committed-batch');
  assert.deepEqual(proof.firstAttempt.committedBatchIndexes, [0, 1]);
  assert.equal(proof.firstAttempt.appliedMutationCount, 6);
  assert.equal(proof.firstAttempt.duplicateMutationWork, 0);
  assert.equal(proof.firstAttempt.durableBatchReceiptCount, 2);

  assert.equal(proof.resume.resumeMode, 'receipt-prefix-skip-then-apply-missing-batches');
  assert.deepEqual(proof.resume.skippedBatchIndexes, [0, 1]);
  assert.equal(proof.resume.skippedMutationWork, 0);
  assert.equal(proof.resume.skippedMutations, 6);
  assert.deepEqual(proof.resume.appliedBatchIndexes, [2, 3]);
  assert.equal(proof.resume.appliedMutationsAfterResume, 4);
  assert.equal(proof.resume.finalAppliedMutations, mutationCount);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.resume.maxMutationWorkCount, 1);
  assert.equal(proof.resume.storageBoundaryFailures, 0);
  assert.ok(proof.resume.storageBoundaryChecks.every((check) => check.passed === true));

  assert.equal(proof.finalReplay.receiptSkips, 4);
  assert.equal(proof.finalReplay.mutationWork, 0);
  assert.equal(proof.finalReplay.duplicateMutationWork, 0);
  assert.equal(proof.finalReplay.applyBoundaryOpenedForReplay, false);

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
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyApplyBatchOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.resume.outputHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(proof.unsafe.staleBatchReceipt.updated, false);
  assert.equal(proof.unsafe.staleBatchReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleBatchReceipt.blockedBy.includes('resume-skips-durable-batches'));
  assert.equal(proof.unsafe.missingCommittedReceipt.updated, false);
  assert.equal(proof.unsafe.missingCommittedReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingCommittedReceipt.blockedBy.includes('resume-skips-durable-batches'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.driftedResumeStorage.updated, false);
  assert.equal(proof.unsafe.driftedResumeStorage.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.driftedResumeStorage.blockedBy.includes('storage-boundary-cas-before-resume-mutations'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyApplyBatchEvidence(proof);
});

test('RPP-733 variant 2 fails closed for stale receipts, missing receipts, duplicate work, drift, and premature output', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveApplyBatchSizingProof(evidence, { repeatedEvidence });
  const staleBatchReceipt = withPassedStatus(clone(evidence));
  staleBatchReceipt.resume.batchReceiptsBeforeResume[0].batchHash = sha256('stale-apply-batch-receipt');
  const missingCommittedReceipt = withPassedStatus(clone(evidence));
  missingCommittedReceipt.resume.batchReceiptsBeforeResume.splice(1, 1);
  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resume.duplicateMutationWork = 1;
  duplicateMutationWork.resume.mutationWorkCounts[0].totalWork = 2;
  duplicateMutationWork.resume.maxMutationWorkCount = 2;
  const driftedResumeStorage = withPassedStatus(clone(evidence));
  driftedResumeStorage.resume.storageBoundaryChecks[0].actualBeforeHash = sha256('drifted-storage-before-resume');
  driftedResumeStorage.resume.storageBoundaryChecks[0].passed = false;
  driftedResumeStorage.resume.storageBoundaryFailures = 1;
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    staleBatchReceipt: resolveApplyBatchSizingProof(staleBatchReceipt, { repeatedEvidence }),
    missingCommittedReceipt: resolveApplyBatchSizingProof(missingCommittedReceipt, { repeatedEvidence }),
    duplicateMutationWork: resolveApplyBatchSizingProof(duplicateMutationWork, { repeatedEvidence }),
    driftedResumeStorage: resolveApplyBatchSizingProof(driftedResumeStorage, { repeatedEvidence }),
    prematurePassStatus: resolveApplyBatchSizingProof(prematurePassStatus, { repeatedEvidence }),
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
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(unsafeDecisions.staleBatchReceipt.updated, false);
  assert.ok(unsafeDecisions.staleBatchReceipt.blockedBy.includes('resume-skips-durable-batches'));
  assert.equal(unsafeDecisions.missingCommittedReceipt.updated, false);
  assert.ok(unsafeDecisions.missingCommittedReceipt.blockedBy.includes('resume-skips-durable-batches'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.driftedResumeStorage.updated, false);
  assert.ok(unsafeDecisions.driftedResumeStorage.blockedBy.includes('storage-boundary-cas-before-resume-mutations'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyApplyBatchEvidence(decision);
  }
});

function buildVariant2Proof() {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveApplyBatchSizingProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeApplyBatchEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'batchCollection',
  );
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('apply-batches-resume-without-duplicates', safeDecision.updated
      && safeDecision.outputEmitted
      && evidence.resume.duplicateMutationWork === 0
      && evidence.finalReplay.duplicateMutationWork === 0, {
      duplicateMutationWork: evidence.resume.duplicateMutationWork,
      finalReplayDuplicateMutationWork: evidence.finalReplay.duplicateMutationWork,
      outputEmitted: safeDecision.outputEmitted,
    }),
    proofGate('correctness-gates-before-output', correctnessGatesRecordedBeforeOutput
      && safeDecision.correctnessGatesHold
      && safeDecision.hashOnlyApplyBatchOutput, {
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      hashOnlyApplyBatchOutput: safeDecision.hashOnlyApplyBatchOutput,
    }),
    proofGate('unsafe-resume-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0733',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: applyBatchSizingContract(),
    runtime: evidence.runtime,
    resources: evidence.resources,
    batchCollection: {
      ...evidence.batchCollection,
      outputHash: safeDecision.outputHash,
    },
    firstAttempt: evidence.firstAttempt,
    resume: {
      ...evidence.resume,
      outputHash: safeDecision.outputHash,
    },
    finalReplay: evidence.finalReplay,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyApplyBatchOutput: safeDecision.hashOnlyApplyBatchOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-and-count-only-apply-batch-resume',
      rawValueEvidenceLeaks: applyBatchEvidenceHasNoRawValues(evidence) ? 0 : 1,
      firstEvidenceHash: digest(publicApplyBatchEvidenceProjection(evidence)),
      repeatedEvidenceHash: digest(publicApplyBatchEvidenceProjection(repeatedEvidence)),
      decisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const evidence = buildApplyBatchSizingEvidence(runApplyBatchResumeScenario());
  const repeatedEvidence = buildApplyBatchSizingEvidence(runApplyBatchResumeScenario());

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { evidence, repeatedEvidence };
}

function runApplyBatchResumeScenario() {
  const started = performance.now();
  const startMemory = process.memoryUsage();
  const mutations = buildFixtureMutations();
  const batchCollection = collectApplyBatchWindowEvidence({ mutations, batchSize: applyBatchSize });
  const mutationByHash = new Map(mutations.map((mutation) => [mutation.mutationIdHash, mutation]));
  const storage = new Map(mutations.map((mutation) => [mutation.mutationIdHash, mutation.beforeHash]));
  const mutationWork = new Map(mutations.map((mutation) => [mutation.mutationIdHash, 0]));
  const firstAttemptReceipts = [];
  let appliedMutationCount = 0;

  for (const window of batchCollection.batchWindows.slice(0, interruptedAfterCommittedBatches)) {
    const result = applyBatchWindow({ window, mutationByHash, storage, mutationWork });
    appliedMutationCount += result.appliedMutationCount;
    firstAttemptReceipts.push(result.receipt);
  }

  const resume = resumeApplyBatches({
    batchCollection,
    mutationByHash,
    storage,
    mutationWork,
    receiptsBeforeResume: firstAttemptReceipts,
  });
  const finalReplay = replayCompletedApply({ batchCollection, storage, receipts: resume.receiptsAfterResume });
  const endMemory = process.memoryUsage();

  return {
    batchCollection,
    firstAttempt: {
      outcome: 'interrupted-after-committed-batch',
      interruptedBeforeBatchIndex: interruptedAfterCommittedBatches,
      committedBatchCount: interruptedAfterCommittedBatches,
      committedBatchIndexes: batchCollection.batchWindows
        .slice(0, interruptedAfterCommittedBatches)
        .map((window) => window.batchIndex),
      appliedMutationCount,
      duplicateMutationWork: duplicateMutationWorkCount(mutationWork),
      durableBatchReceiptCount: firstAttemptReceipts.length,
      durableReceiptSetHash: sha256(firstAttemptReceipts.map((receipt) => receipt.receiptHash)),
    },
    resume: resume.publicResume,
    finalReplay,
    runtime: {
      generatedAt: fixedNow.toISOString(),
      durationMs: elapsedMs(started),
      budgets: {
        maxDurationMs,
        maxHeapUsedBytes,
      },
    },
    resources: {
      apply: {
        mutationCount,
        applyBatchSize,
        batchCount: batchCollection.batchWindowCount,
        firstAttemptCommittedBatches: interruptedAfterCommittedBatches,
        resumedBatchCount: resume.publicResume.appliedBatchIndexes.length,
        finalReplayReceiptSkips: finalReplay.receiptSkips,
      },
      process: {
        heapUsedBytes: Math.max(startMemory.heapUsed, endMemory.heapUsed),
      },
    },
  };
}

function buildApplyBatchSizingEvidence(scenario) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0733',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: applyBatchSizingContract(),
    correctnessGates: [],
    batchCollection: scenario.batchCollection,
    firstAttempt: scenario.firstAttempt,
    resume: scenario.resume,
    finalReplay: scenario.finalReplay,
    runtime: scenario.runtime,
    resources: scenario.resources,
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeApplyBatchSizingGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectApplyBatchWindowEvidence({ mutations, batchSize }) {
  const batchWindows = [];
  for (let offset = 0; offset < mutations.length; offset += batchSize) {
    const entries = mutations.slice(offset, offset + batchSize);
    batchWindows.push(applyBatchWindowSummary({
      entries,
      batchIndex: batchWindows.length,
      mutationOffset: offset,
      batchCount: Math.ceil(mutations.length / batchSize),
    }));
  }

  const expectedMutationIdHashes = mutations.map((mutation) => mutation.mutationIdHash);
  const observedMutationIdHashes = batchWindows.flatMap((window) => window.mutationIdHashes);
  const collectionCore = {
    planHash: sha256({
      proofId,
      mutationIdHashes: expectedMutationIdHashes,
      applyBatchSize: batchSize,
    }),
    mutationCount: mutations.length,
    batchSize,
    maxBatchSize: 500,
    batchWindowCount: batchWindows.length,
    expectedBatchWindowCount: Math.ceil(mutations.length / batchSize),
    batchStarts: batchWindows.map((window) => window.firstSequence),
    batchEnds: batchWindows.map((window) => window.lastSequence),
    batchSizes: batchWindows.map((window) => window.mutationCount),
    totalWindowMutations: batchWindows.reduce((sum, window) => sum + window.mutationCount, 0),
    uniqueMutationIdHashes: new Set(observedMutationIdHashes).size,
    expectedCoverageHash: sha256(expectedMutationIdHashes),
    observedCoverageHash: sha256(observedMutationIdHashes),
    applyBoundary: {
      revalidation: 'fresh-live-hashes-before-each-batch',
      storageBoundary: 'per-mutation-storage-boundary-cas',
      resumePolicy: 'exact-batch-receipt-skips-committed-prefix',
    },
    batchWindows,
  };

  return {
    ...collectionCore,
    batchCollectionHash: sha256(collectionCore),
  };
}

function applyBatchWindowSummary({ entries, batchIndex, mutationOffset, batchCount }) {
  const mutationIdHashes = entries.map((mutation) => mutation.mutationIdHash);
  const resourceKeyHashes = entries.map((mutation) => mutation.resourceKeyHash);
  const core = {
    batchIndex,
    batchIdHash: sha256(`apply-batch-${batchIndex + 1}`),
    batchCount,
    mutationOffset,
    mutationCount: entries.length,
    firstSequence: entries[0].sequence,
    lastSequence: entries.at(-1).sequence,
    lastBatch: batchIndex === batchCount - 1,
    mutationIdHashes,
    resourceKeyHashes,
    beforeHashSetHash: sha256(entries.map((mutation) => mutation.beforeHash)),
    afterHashSetHash: sha256(entries.map((mutation) => mutation.afterHash)),
    estimatedBytes: entries.reduce((sum, mutation) => sum + mutation.estimatedBytes, 0),
  };

  return {
    ...core,
    batchHash: sha256(core),
  };
}

function applyBatchWindow({ window, mutationByHash, storage, mutationWork }) {
  const storageBoundaryChecks = [];
  for (const mutationIdHash of window.mutationIdHashes) {
    const mutation = mutationByHash.get(mutationIdHash);
    const actualBeforeHash = storage.get(mutationIdHash);
    const passed = actualBeforeHash === mutation.beforeHash;
    storageBoundaryChecks.push({
      batchIndex: window.batchIndex,
      mutationIdHash,
      expectedBeforeHash: mutation.beforeHash,
      actualBeforeHash,
      plannedAfterHash: mutation.afterHash,
      passed,
    });
    assert.equal(passed, true, `fixture storage drift before batch ${window.batchIndex}`);
    storage.set(mutationIdHash, mutation.afterHash);
    mutationWork.set(mutationIdHash, (mutationWork.get(mutationIdHash) || 0) + 1);
  }

  return {
    appliedMutationCount: window.mutationCount,
    receipt: receiptForWindow(window),
    storageBoundaryChecks,
  };
}

function resumeApplyBatches({
  batchCollection,
  mutationByHash,
  storage,
  mutationWork,
  receiptsBeforeResume,
}) {
  const receiptsAfterResume = [...receiptsBeforeResume];
  const skippedBatchIndexes = [];
  const appliedBatchIndexes = [];
  const storageBoundaryChecks = [];
  let skippedMutations = 0;
  let appliedMutationsAfterResume = 0;

  for (const window of batchCollection.batchWindows) {
    const receipt = receiptsAfterResume.find((candidate) => candidate.batchIndex === window.batchIndex);
    if (receipt && receiptMatchesWindow(receipt, window)) {
      assert.equal(window.mutationIdHashes.every((mutationIdHash) => {
        const mutation = mutationByHash.get(mutationIdHash);
        return storage.get(mutationIdHash) === mutation.afterHash;
      }), true, `committed batch ${window.batchIndex} storage must match the receipt`);
      skippedBatchIndexes.push(window.batchIndex);
      skippedMutations += window.mutationCount;
      continue;
    }

    assert.equal(window.mutationIdHashes.every((mutationIdHash) => {
      const mutation = mutationByHash.get(mutationIdHash);
      return storage.get(mutationIdHash) === mutation.beforeHash;
    }), true, `unreceipted batch ${window.batchIndex} must still be old before resume applies it`);

    const result = applyBatchWindow({ window, mutationByHash, storage, mutationWork });
    appliedBatchIndexes.push(window.batchIndex);
    appliedMutationsAfterResume += result.appliedMutationCount;
    storageBoundaryChecks.push(...result.storageBoundaryChecks);
    receiptsAfterResume.push(result.receipt);
  }

  const mutationWorkCounts = [...mutationWork.entries()].map(([mutationIdHash, totalWork]) => ({
    mutationIdHash,
    totalWork,
  }));
  const finalAppliedMutations = [...storage.entries()]
    .filter(([mutationIdHash, currentHash]) => currentHash === mutationByHash.get(mutationIdHash).afterHash)
    .length;

  return {
    receiptsAfterResume,
    publicResume: {
      resumeMode: 'receipt-prefix-skip-then-apply-missing-batches',
      batchReceiptsBeforeResume: receiptsBeforeResume,
      batchReceiptsAfterResume: receiptsAfterResume,
      skippedBatchIndexes,
      skippedMutations,
      skippedMutationWork: 0,
      appliedBatchIndexes,
      appliedMutationsAfterResume,
      finalAppliedMutations,
      mutationWorkCounts,
      maxMutationWorkCount: Math.max(...mutationWorkCounts.map((entry) => entry.totalWork)),
      duplicateMutationWork: duplicateMutationWorkCount(mutationWork),
      storageBoundaryChecks,
      storageBoundaryFailures: storageBoundaryChecks.filter((check) => check.passed !== true).length,
      finalStorageHash: sha256([...storage.entries()].sort(([left], [right]) => left.localeCompare(right))),
      receiptSetHashAfterResume: sha256(receiptsAfterResume.map((receipt) => receipt.receiptHash)),
    },
  };
}

function replayCompletedApply({ batchCollection, storage, receipts }) {
  let receiptSkips = 0;
  for (const window of batchCollection.batchWindows) {
    const receipt = receipts.find((candidate) => candidate.batchIndex === window.batchIndex);
    if (receipt && receiptMatchesWindow(receipt, window)) {
      receiptSkips += 1;
    }
  }

  return {
    replayMode: 'completed-apply-replay',
    receiptSkips,
    mutationWork: 0,
    duplicateMutationWork: 0,
    applyBoundaryOpenedForReplay: false,
    receiptSetHash: sha256(receipts.map((receipt) => receipt.receiptHash)),
    storageHash: sha256([...storage.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function resolveApplyBatchSizingProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeApplyBatchSizingGates(evidence, repeatedEvidence);
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
        batchCollectionHash: evidence.batchCollection.batchCollectionHash,
        committedReceiptSetHash: evidence.firstAttempt.durableReceiptSetHash,
        resumedReceiptSetHash: evidence.resume.receiptSetHashAfterResume,
        finalReplayReceiptSetHash: evidence.finalReplay.receiptSetHash,
        duplicateMutationWork: evidence.resume.duplicateMutationWork + evidence.finalReplay.duplicateMutationWork,
        finalReleaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyApplyBatchOutput: output ? applyBatchEvidenceHasNoRawValues(output) : false,
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

function recomputeApplyBatchSizingGates(evidence, repeatedEvidence) {
  const collection = evidence.batchCollection || {};
  const windows = Array.isArray(collection.batchWindows) ? collection.batchWindows : [];
  const order = batchWindowOrderMetrics(windows);
  const coverage = batchCoverageMetrics(collection, windows);
  const hashMismatches = windows
    .filter((window) => window.batchHash !== sha256(batchWindowCore(window)))
    .map((window) => window.batchIndex);
  const batchCollectionHashMatches = collection.batchCollectionHash === sha256(batchCollectionCore(collection));
  const deterministicEvidence = Boolean(repeatedEvidence)
    && digest(publicApplyBatchEvidenceProjection(evidence)) === digest(publicApplyBatchEvidenceProjection(repeatedEvidence));
  const resumeSkip = resumeSkipMetrics(evidence, windows);
  const resumeApply = resumeApplyMetrics(evidence, windows);
  const duplicateWork = duplicateWorkMetrics(evidence);
  const storageBoundary = storageBoundaryMetrics(evidence);
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};

  return [
    proofGate('deterministic-apply-batch-size', Number.isInteger(collection.batchSize)
      && collection.batchSize === applyBatchSize
      && collection.maxBatchSize === 500
      && windows.length === collection.expectedBatchWindowCount
      && windows.every((window, index) => {
        const expectedSize = index === windows.length - 1
          ? collection.mutationCount - (collection.batchSize * index)
          : collection.batchSize;
        return window.mutationCount === expectedSize
          && window.mutationCount > 0
          && window.mutationCount <= collection.batchSize;
      }), {
      batchSize: collection.batchSize,
      maxBatchSize: collection.maxBatchSize,
      expectedBatchWindowCount: collection.expectedBatchWindowCount,
      batchSizes: windows.map((window) => window.mutationCount),
    }),
    proofGate('ordered-apply-batches', order.ordered, order),
    proofGate('complete-mutation-coverage', coverage.complete, coverage),
    proofGate('batch-window-hashes-match', hashMismatches.length === 0 && batchCollectionHashMatches, {
      mismatchedBatchIndexes: hashMismatches,
      batchCollectionHashMatches,
    }),
    proofGate('deterministic-resume-evidence', deterministicEvidence, {
      firstEvidenceHash: digest(publicApplyBatchEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicApplyBatchEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('resume-skips-durable-batches', resumeSkip.safe, resumeSkip),
    proofGate('resume-applies-only-missing-batches', resumeApply.safe, resumeApply),
    proofGate('no-duplicate-mutation-work', duplicateWork.safe, duplicateWork),
    proofGate('storage-boundary-cas-before-resume-mutations', storageBoundary.safe, storageBoundary),
    proofGate('hash-only-apply-batch-evidence', applyBatchEvidenceHasNoRawValues({
      batchCollection: collection,
      firstAttempt: evidence.firstAttempt,
      resume: evidence.resume,
      finalReplay: evidence.finalReplay,
    }), {
      rawValueEvidenceLeaks: applyBatchEvidenceHasNoRawValues({
        batchCollection: collection,
        firstAttempt: evidence.firstAttempt,
        resume: evidence.resume,
        finalReplay: evidence.finalReplay,
      }) ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes, {
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
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

function batchWindowOrderMetrics(windows) {
  let expectedStart = 0;
  let indexMismatchCount = 0;
  let startMismatchCount = 0;
  let endMismatchCount = 0;
  let emptyWindowCount = 0;

  windows.forEach((window, index) => {
    if (window.batchIndex !== index) {
      indexMismatchCount += 1;
    }
    if (window.firstSequence !== expectedStart) {
      startMismatchCount += 1;
    }
    if (window.lastSequence !== window.firstSequence + window.mutationCount - 1) {
      endMismatchCount += 1;
    }
    if (window.mutationCount <= 0) {
      emptyWindowCount += 1;
    }
    expectedStart = window.lastSequence + 1;
  });

  return {
    ordered: indexMismatchCount === 0
      && startMismatchCount === 0
      && endMismatchCount === 0
      && emptyWindowCount === 0,
    indexMismatchCount,
    startMismatchCount,
    endMismatchCount,
    emptyWindowCount,
    terminalSequence: windows.at(-1)?.lastSequence ?? null,
  };
}

function batchCoverageMetrics(collection, windows) {
  const observedMutationIdHashes = windows.flatMap((window) => window.mutationIdHashes || []);
  const uniqueMutationIdHashes = new Set(observedMutationIdHashes).size;
  const recomputedObservedCoverageHash = sha256(observedMutationIdHashes);
  const expectedBatchWindowCount = Math.ceil(collection.mutationCount / collection.batchSize);
  const complete = windows.length === collection.batchWindowCount
    && windows.length === expectedBatchWindowCount
    && collection.expectedBatchWindowCount === expectedBatchWindowCount
    && observedMutationIdHashes.length === collection.mutationCount
    && uniqueMutationIdHashes === collection.mutationCount
    && collection.uniqueMutationIdHashes === uniqueMutationIdHashes
    && collection.totalWindowMutations === observedMutationIdHashes.length
    && collection.observedCoverageHash === recomputedObservedCoverageHash
    && collection.observedCoverageHash === collection.expectedCoverageHash;

  return {
    complete,
    batchWindowCount: windows.length,
    recordedBatchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount,
    observedMutationIdHashes: observedMutationIdHashes.length,
    uniqueMutationIdHashes,
    recomputedObservedCoverageHash,
    recordedObservedCoverageHash: collection.observedCoverageHash,
    expectedCoverageHash: collection.expectedCoverageHash,
  };
}

function resumeSkipMetrics(evidence, windows) {
  const committedBatchIndexes = evidence.firstAttempt?.committedBatchIndexes || [];
  const receipts = evidence.resume?.batchReceiptsBeforeResume || [];
  const exactReceiptIndexes = receipts
    .filter((receipt) => receiptMatchesWindow(receipt, windows[receipt.batchIndex]))
    .map((receipt) => receipt.batchIndex);
  const expectedSkippedMutations = committedBatchIndexes.reduce((sum, index) => sum + windows[index].mutationCount, 0);
  const safe = sameArray(exactReceiptIndexes, committedBatchIndexes)
    && sameArray(evidence.resume?.skippedBatchIndexes || [], committedBatchIndexes)
    && evidence.resume?.skippedMutations === expectedSkippedMutations
    && evidence.resume?.skippedMutationWork === 0
    && evidence.firstAttempt?.durableBatchReceiptCount === committedBatchIndexes.length;

  return {
    safe,
    committedBatchIndexes,
    exactReceiptIndexes,
    skippedBatchIndexes: evidence.resume?.skippedBatchIndexes || [],
    expectedSkippedMutations,
    skippedMutations: evidence.resume?.skippedMutations,
    skippedMutationWork: evidence.resume?.skippedMutationWork,
    durableBatchReceiptCount: evidence.firstAttempt?.durableBatchReceiptCount,
  };
}

function resumeApplyMetrics(evidence, windows) {
  const committed = new Set(evidence.firstAttempt?.committedBatchIndexes || []);
  const expectedAppliedBatchIndexes = windows
    .filter((window) => !committed.has(window.batchIndex))
    .map((window) => window.batchIndex);
  const expectedAppliedMutations = expectedAppliedBatchIndexes
    .reduce((sum, index) => sum + windows[index].mutationCount, 0);
  const finalReplay = evidence.finalReplay || {};
  const safe = sameArray(evidence.resume?.appliedBatchIndexes || [], expectedAppliedBatchIndexes)
    && evidence.resume?.appliedMutationsAfterResume === expectedAppliedMutations
    && evidence.resume?.finalAppliedMutations === evidence.batchCollection?.mutationCount
    && finalReplay.receiptSkips === evidence.batchCollection?.batchWindowCount
    && finalReplay.mutationWork === 0
    && finalReplay.applyBoundaryOpenedForReplay === false;

  return {
    safe,
    expectedAppliedBatchIndexes,
    appliedBatchIndexes: evidence.resume?.appliedBatchIndexes || [],
    expectedAppliedMutations,
    appliedMutationsAfterResume: evidence.resume?.appliedMutationsAfterResume,
    finalAppliedMutations: evidence.resume?.finalAppliedMutations,
    finalReplayReceiptSkips: finalReplay.receiptSkips,
    finalReplayMutationWork: finalReplay.mutationWork,
  };
}

function duplicateWorkMetrics(evidence) {
  const counts = evidence.resume?.mutationWorkCounts || [];
  const totalWork = counts.reduce((sum, entry) => sum + entry.totalWork, 0);
  const duplicateEntries = counts.filter((entry) => entry.totalWork > 1).length;
  const safe = counts.length === evidence.batchCollection?.mutationCount
    && totalWork === evidence.batchCollection?.mutationCount
    && duplicateEntries === 0
    && evidence.resume?.duplicateMutationWork === 0
    && evidence.resume?.maxMutationWorkCount === 1
    && evidence.finalReplay?.duplicateMutationWork === 0;

  return {
    safe,
    mutationWorkEntries: counts.length,
    totalWork,
    duplicateEntries,
    duplicateMutationWork: evidence.resume?.duplicateMutationWork,
    maxMutationWorkCount: evidence.resume?.maxMutationWorkCount,
    finalReplayDuplicateMutationWork: evidence.finalReplay?.duplicateMutationWork,
  };
}

function storageBoundaryMetrics(evidence) {
  const checks = evidence.resume?.storageBoundaryChecks || [];
  const failures = checks.filter((check) => (
    check.passed !== true || check.actualBeforeHash !== check.expectedBeforeHash
  ));
  const safe = checks.length === evidence.resume?.appliedMutationsAfterResume
    && failures.length === 0
    && evidence.resume?.storageBoundaryFailures === 0;

  return {
    safe,
    storageBoundaryCheckCount: checks.length,
    expectedStorageBoundaryCheckCount: evidence.resume?.appliedMutationsAfterResume,
    storageBoundaryFailures: evidence.resume?.storageBoundaryFailures,
    failedCheckCount: failures.length,
    failedCheckHashes: failures.map((check) => digest(check)),
  };
}

function unsafeApplyBatchEvidenceDecisions(evidence, repeatedEvidence) {
  const staleBatchReceipt = withPassedStatus(clone(evidence));
  staleBatchReceipt.resume.batchReceiptsBeforeResume[0].batchHash = sha256('stale-apply-batch-receipt');

  const missingCommittedReceipt = withPassedStatus(clone(evidence));
  missingCommittedReceipt.resume.batchReceiptsBeforeResume.splice(1, 1);

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resume.duplicateMutationWork = 1;
  duplicateMutationWork.resume.mutationWorkCounts[0].totalWork = 2;
  duplicateMutationWork.resume.maxMutationWorkCount = 2;

  const driftedResumeStorage = withPassedStatus(clone(evidence));
  driftedResumeStorage.resume.storageBoundaryChecks[0].actualBeforeHash = sha256('drifted-storage-before-resume');
  driftedResumeStorage.resume.storageBoundaryChecks[0].passed = false;
  driftedResumeStorage.resume.storageBoundaryFailures = 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    staleBatchReceipt: resolveApplyBatchSizingProof(staleBatchReceipt, { repeatedEvidence }),
    missingCommittedReceipt: resolveApplyBatchSizingProof(missingCommittedReceipt, { repeatedEvidence }),
    duplicateMutationWork: resolveApplyBatchSizingProof(duplicateMutationWork, { repeatedEvidence }),
    driftedResumeStorage: resolveApplyBatchSizingProof(driftedResumeStorage, { repeatedEvidence }),
    prematurePassStatus: resolveApplyBatchSizingProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function batchCollectionCore(collection) {
  return {
    planHash: collection.planHash,
    mutationCount: collection.mutationCount,
    batchSize: collection.batchSize,
    maxBatchSize: collection.maxBatchSize,
    batchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount: collection.expectedBatchWindowCount,
    batchStarts: collection.batchStarts,
    batchEnds: collection.batchEnds,
    batchSizes: collection.batchSizes,
    totalWindowMutations: collection.totalWindowMutations,
    uniqueMutationIdHashes: collection.uniqueMutationIdHashes,
    expectedCoverageHash: collection.expectedCoverageHash,
    observedCoverageHash: collection.observedCoverageHash,
    applyBoundary: collection.applyBoundary,
    batchWindows: collection.batchWindows,
  };
}

function batchWindowCore(window) {
  return {
    batchIndex: window.batchIndex,
    batchIdHash: window.batchIdHash,
    batchCount: window.batchCount,
    mutationOffset: window.mutationOffset,
    mutationCount: window.mutationCount,
    firstSequence: window.firstSequence,
    lastSequence: window.lastSequence,
    lastBatch: window.lastBatch,
    mutationIdHashes: window.mutationIdHashes,
    resourceKeyHashes: window.resourceKeyHashes,
    beforeHashSetHash: window.beforeHashSetHash,
    afterHashSetHash: window.afterHashSetHash,
    estimatedBytes: window.estimatedBytes,
  };
}

function receiptForWindow(window) {
  const core = {
    receiptSchemaVersion: 1,
    receiptScopeHash: sha256({
      proofId,
      phase: 'apply-batch-receipt',
      batchIndex: window.batchIndex,
    }),
    batchIndex: window.batchIndex,
    batchHash: window.batchHash,
    mutationOffset: window.mutationOffset,
    mutationCount: window.mutationCount,
    afterHashSetHash: window.afterHashSetHash,
  };

  return {
    ...core,
    receiptHash: sha256(core),
  };
}

function receiptCore(receipt) {
  return {
    receiptSchemaVersion: receipt.receiptSchemaVersion,
    receiptScopeHash: receipt.receiptScopeHash,
    batchIndex: receipt.batchIndex,
    batchHash: receipt.batchHash,
    mutationOffset: receipt.mutationOffset,
    mutationCount: receipt.mutationCount,
    afterHashSetHash: receipt.afterHashSetHash,
  };
}

function receiptMatchesWindow(receipt, window) {
  if (!receipt || !window) {
    return false;
  }
  return receipt.batchIndex === window.batchIndex
    && receipt.batchHash === window.batchHash
    && receipt.mutationOffset === window.mutationOffset
    && receipt.mutationCount === window.mutationCount
    && receipt.afterHashSetHash === window.afterHashSetHash
    && receipt.receiptHash === sha256(receiptCore(receipt));
}

function buildFixtureMutations() {
  return Array.from({ length: mutationCount }, (_, sequence) => {
    const rawMutationId = `rpp-733-raw-mutation-${sequence}`;
    const rawResourceKey = `wp_posts:ID:733${String(sequence).padStart(2, '0')}`;
    const mutationIdHash = digest(rawMutationId);
    const resourceKeyHash = digest(rawResourceKey);

    return {
      sequence,
      mutationIdHash,
      resourceKeyHash,
      beforeHash: sha256({ rawResourceKey, phase: 'before' }),
      afterHash: sha256({ rawResourceKey, phase: 'after' }),
      estimatedBytes: 640 + (sequence % 3) * 29,
    };
  });
}

function applyBatchSizingContract() {
  const contract = {
    rppId: 'RPP-0713',
    proof: 'test/rpp-0713-apply-batch-sizing.test.js',
    applyBatchSizing: {
      mode: 'apply',
      defaultBatchSize: 500,
      configuredBatchSize: applyBatchSize,
      maxBatchSize: 500,
      configuredBy: 'request',
      revalidation: 'fresh-live-hashes-before-each-batch',
      storageBoundary: 'per-mutation-storage-boundary-cas',
    },
  };

  return {
    ...contract,
    evidenceHash: digest(contract),
  };
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

function publicApplyBatchEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    batchCollection: evidence.batchCollection,
    firstAttempt: evidence.firstAttempt,
    resume: evidence.resume,
    finalReplay: evidence.finalReplay,
    release: evidence.release,
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

function duplicateMutationWorkCount(mutationWork) {
  return [...mutationWork.values()].reduce((sum, workCount) => (
    workCount > 1 ? sum + workCount - 1 : sum
  ), 0);
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

function assertHashOnlyApplyBatchEvidence(value) {
  assert.equal(applyBatchEvidenceHasNoRawValues(value), true);
}

function applyBatchEvidenceHasNoRawValues(value) {
  return !rawApplyBatchEvidencePattern().test(JSON.stringify(value));
}

function rawApplyBatchEvidencePattern() {
  return /"resourceKey"\s*:|wp_posts:ID:733|rpp-733-raw-mutation|private option value|post_content|option_value|meta_value|bearer\s+[a-z0-9._-]+|https?:\/\//i;
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

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
