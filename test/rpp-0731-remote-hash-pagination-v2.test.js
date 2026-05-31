import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_HASH_MAX_BATCH_SIZE,
  buildRemoteHashResources,
  makeRemoteHashCursor,
  paginateRemoteHashResources,
  parseRemoteHashCursor,
  remoteHashScopeHash,
  remoteHashSourceHash,
  runRemoteHashPaginationBenchmark,
} from '../scripts/bench/remote-hash-pagination.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0731-remote-hash-pagination-v2';
const benchmarkId = 'rpp-0711-remote-hash-pagination';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const resourceCount = 73;
const batchSize = 17;
const maxDurationMs = 5000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const source = Object.freeze({
  sourceUrlHash: digest('rpp-0731-remote-source'),
  restNamespace: 'reprint/v1',
  routeProfile: 'production-shaped',
});
const scope = Object.freeze({
  files: ['uploads', 'plugins', 'themes'],
  tables: ['posts', 'postmeta', 'options'],
  plugins: true,
  includeAbsentForBaseKeys: ['plugin-main', 'home-row'],
});
const expectedPageGateIds = Object.freeze([
  'ordered-page-chain',
  'complete-page-coverage',
  'bounded-page-size',
  'page-summary-hashes-match',
  'deterministic-page-evidence',
  'hash-only-page-summaries',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);

test('RPP-0731 variant 2 proves paged remote hash collection gates and support-only NO-GO', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0731');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0711');
  assert.equal(proof.builtOn.benchmark, benchmarkId);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.remoteHashes.resourceCount, resourceCount);
  assert.equal(proof.resources.remoteHashes.requestedBatchSize, batchSize);
  assert.equal(proof.resources.remoteHashes.maxBatchSize, REMOTE_HASH_MAX_BATCH_SIZE);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.pageCollection.pageCount, 5);
  assert.equal(proof.pageCollection.expectedPageCount, 5);
  assert.deepEqual(proof.pageCollection.pageOffsets, [0, 17, 34, 51, 68]);
  assert.deepEqual(proof.pageCollection.pageSizes, [17, 17, 17, 17, 5]);
  assert.deepEqual(proof.pageCollection.pageCompleteFlags, [false, false, false, false, true]);
  assert.equal(proof.pageCollection.uniqueResourceKeyHashes, resourceCount);
  assert.equal(proof.pageCollection.observedCoverageHash, proof.pageCollection.expectedCoverageHash);
  assert.match(proof.pageCollection.collectionSummaryHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(proof.pageCollection.pages.length, proof.pageCollection.pageCount);
  assert.ok(proof.pageCollection.pages.every((page) => page.pageResourceCount <= batchSize));
  assert.ok(proof.pageCollection.pages.every((page) => page.routePageHash.match(/^sha256:[a-f0-9]{64}$/)));
  assert.ok(proof.pageCollection.pages.every((page) => page.pageSummaryHash.match(/^sha256:[a-f0-9]{64}$/)));
  assertHashOnlyPageEvidence(proof.pageCollection);

  assert.deepEqual(proof.correctness.gateIds, expectedPageGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyPageSummaryOutput, true);
  assert.equal(proof.correctness.pagedOutputEmittedAfterGates, true);
  assert.match(proof.pageCollection.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.stalePageCursor.updated, false);
  assert.equal(proof.unsafe.stalePageCursor.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.stalePageCursor.blockedBy.includes('ordered-page-chain'));
  assert.equal(proof.unsafe.missingPage.updated, false);
  assert.equal(proof.unsafe.missingPage.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingPage.blockedBy.includes('complete-page-coverage'));
  assert.equal(proof.unsafe.mismatchedPageHash.updated, false);
  assert.equal(proof.unsafe.mismatchedPageHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mismatchedPageHash.blockedBy.includes('page-summary-hashes-match'));
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
  assertHashOnlyPageEvidence(proof);
});

test('RPP-0731 variant 2 fails closed stale, missing, mismatched, and premature page evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolvePagedRemoteHashCollection(evidence, { repeatedEvidence });
  const stalePageCursor = withPassedStatus(clone(evidence));
  stalePageCursor.pageCollection.pages[1].cursorInputHash = sha256('rpp-0731-stale-page-cursor');
  const missingPage = withPassedStatus(clone(evidence));
  missingPage.pageCollection.pages.splice(2, 1);
  missingPage.pageCollection.pageCount = missingPage.pageCollection.pages.length;
  const mismatchedPageHash = withPassedStatus(clone(evidence));
  mismatchedPageHash.pageCollection.pages[0].pageSummaryHash = sha256('rpp-0731-mismatched-page-hash');
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    stalePageCursor: resolvePagedRemoteHashCollection(stalePageCursor, { repeatedEvidence }),
    missingPage: resolvePagedRemoteHashCollection(missingPage, { repeatedEvidence }),
    mismatchedPageHash: resolvePagedRemoteHashCollection(mismatchedPageHash, { repeatedEvidence }),
    prematurePassStatus: resolvePagedRemoteHashCollection(prematurePassStatus, { repeatedEvidence }),
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
  ]);
  assert.equal(unsafeDecisions.stalePageCursor.updated, false);
  assert.ok(unsafeDecisions.stalePageCursor.blockedBy.includes('ordered-page-chain'));
  assert.equal(unsafeDecisions.missingPage.updated, false);
  assert.ok(unsafeDecisions.missingPage.blockedBy.includes('complete-page-coverage'));
  assert.equal(unsafeDecisions.mismatchedPageHash.updated, false);
  assert.ok(unsafeDecisions.mismatchedPageHash.blockedBy.includes('page-summary-hashes-match'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
  }

  assert.throws(
    () => parseRemoteHashCursor(
      makeRemoteHashCursor({
        sourceHash: digest('rpp-0731-stale-source'),
        scopeHash: remoteHashScopeHash(scope),
        offset: batchSize,
      }),
      {
        expectedSourceHash: remoteHashSourceHash(source),
        expectedScopeHash: remoteHashScopeHash(scope),
      },
    ),
    (error) => error?.code === 'INVALID_CURSOR_SOURCE',
  );
});

function buildVariant2Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolvePagedRemoteHashCollection(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafePageEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'pageCollection',
  );
  const benchmarkGatesPass = benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-runtime-resource-gates-pass', benchmark.ok && benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('paged-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-page-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0731',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0711',
      benchmark: benchmark.benchmark,
      ok: benchmark.ok,
      mode: benchmark.mode,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
      liveRemoteService: benchmark.runtime.liveRemoteService.status,
    },
    resources: {
      remoteHashes: benchmark.resources.remoteHashes,
      process: benchmark.resources.process,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    pageCollection: {
      ...evidence.pageCollection,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyPageSummaryOutput: safeDecision.hashOnlyPageSummaryOutput,
      pagedOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-page-summaries',
      rawValueEvidenceLeaks: remoteHashPageEvidenceHasNoRawValues(evidence.pageCollection) ? 0 : 1,
      publicPageEvidenceHash: digest(publicPageEvidenceProjection(evidence)),
      repeatedPageEvidenceHash: digest(publicPageEvidenceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const benchmark = runRemoteHashPaginationBenchmark({
    now: fixedNow,
    resourceCount,
    batchSize,
    maxDurationMs,
    maxHeapUsedBytes,
    seed: 'rpp-0731-v2',
    source,
    scope,
  });
  const resources = buildRemoteHashResources(resourceCount, { seed: 'rpp-0731-v2' });
  const evidence = buildPageEvidence({
    benchmark,
    collection: collectRemoteHashPageEvidence({ resources, source, scope, batchSize }),
  });
  const repeatedEvidence = buildPageEvidence({
    benchmark,
    collection: collectRemoteHashPageEvidence({
      resources: [...resources].reverse(),
      source,
      scope,
      batchSize,
    }),
  });

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { benchmark, evidence, repeatedEvidence };
}

function buildPageEvidence({ benchmark, collection }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0731',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0711',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    pageCollection: collection,
    runtime: {
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      process: benchmark.resources.process,
    },
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeRemoteHashPageGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectRemoteHashPageEvidence({ resources, source: currentSource, scope: currentScope, batchSize: pageSize }) {
  const sourceHash = remoteHashSourceHash(currentSource);
  const scopeHash = remoteHashScopeHash(currentScope);
  const expectedResourceKeyHashes = orderedResourceKeyHashes(resources);
  const pages = [];
  let cursor = null;
  let guard = 0;

  while (true) {
    guard += 1;
    assert.ok(guard <= resources.length + 2, 'remote hash page collection did not converge');
    const cursorInputHash = nullableSha256(cursor);
    const page = paginateRemoteHashResources({
      resources,
      source: currentSource,
      scope: currentScope,
      batchSize: pageSize,
      cursor,
    });
    pages.push(pageSummary(page, pages.length, cursorInputHash));
    if (page.complete) {
      break;
    }
    cursor = page.cursor;
  }

  const observedResourceKeyHashes = pages.flatMap((page) => page.resourceKeyHashes);
  const collectionCore = {
    sourceHash,
    scopeHash,
    resourceCount: expectedResourceKeyHashes.length,
    batchSize: pageSize,
    maxBatchSize: REMOTE_HASH_MAX_BATCH_SIZE,
    pageCount: pages.length,
    expectedPageCount: Math.ceil(expectedResourceKeyHashes.length / pageSize),
    pageOffsets: pages.map((page) => page.offset),
    pageSizes: pages.map((page) => page.pageResourceCount),
    pageCompleteFlags: pages.map((page) => page.complete),
    completePageCount: pages.filter((page) => page.complete).length,
    uniqueResourceKeyHashes: new Set(observedResourceKeyHashes).size,
    expectedCoverageHash: sha256(expectedResourceKeyHashes),
    observedCoverageHash: sha256(observedResourceKeyHashes),
    snapshotHashSetHash: pages.at(-1)?.snapshotHashSetHash || '',
    planningOnly: {
      readOnly: true,
      mutates: false,
      authority: 'planning-evidence-only',
      applyBoundary: 'apply-must-revalidate-live-resource-hash',
    },
    pages,
  };

  return {
    ...collectionCore,
    collectionSummaryHash: sha256(collectionCore),
  };
}

function pageSummary(page, pageIndex, cursorInputHash) {
  const resourceKeyHashes = page.resources.map((resource) => sha256(resource.resource_key));
  const resourceProofHashes = page.resources.map((resource) => sha256({
    resourceKeyHash: sha256(resource.resource_key),
    resourceTypeHash: sha256(resource.resource_type),
    remoteHash: resource.hash,
    exists: resource.exists,
    ownerHash: sha256(resource.owner),
    storageGuardHash: sha256(resource.storage_guard),
  }));
  const summaryCore = {
    pageIndex,
    cursorInputHash,
    nextCursorHash: nullableSha256(page.cursor),
    offset: page.pagination.offset,
    nextOffset: page.pagination.nextOffset,
    batchSize: page.pagination.batchSize,
    pageResourceCount: page.pagination.pageResourceCount,
    resourceCount: page.pagination.resourceCount,
    complete: page.complete,
    routePageHash: page.pageHash,
    snapshotHashSetHash: page.snapshotHashSetHash,
    resourceKeyHashes,
    resourceProofHashes,
  };

  return {
    ...summaryCore,
    pageSummaryHash: sha256(summaryCore),
  };
}

function resolvePagedRemoteHashCollection(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeRemoteHashPageGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedPageGateIds);
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
        collectionSummaryHash: evidence.pageCollection.collectionSummaryHash,
        observedCoverageHash: evidence.pageCollection.observedCoverageHash,
        expectedCoverageHash: evidence.pageCollection.expectedCoverageHash,
        pageSummaryHashSetHash: sha256(evidence.pageCollection.pages.map((page) => page.pageSummaryHash)),
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
    hashOnlyPageSummaryOutput: output ? remoteHashPageEvidenceHasNoRawValues(output) : false,
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

function recomputeRemoteHashPageGates(evidence, repeatedEvidence) {
  const collection = evidence.pageCollection || {};
  const pages = Array.isArray(collection.pages) ? collection.pages : [];
  const chain = pageChainMetrics(pages);
  const coverage = pageCoverageMetrics(collection, pages);
  const pageHashMismatches = pages
    .filter((page) => page.pageSummaryHash !== sha256(pageSummaryCore(page)))
    .map((page) => page.pageIndex);
  const boundedPageSize = Number.isInteger(collection.batchSize)
    && collection.batchSize > 0
    && collection.batchSize <= REMOTE_HASH_MAX_BATCH_SIZE
    && pages.every((page) => (
      Number.isInteger(page.pageResourceCount)
        && page.pageResourceCount >= 0
        && page.pageResourceCount <= collection.batchSize
        && page.batchSize === collection.batchSize
    ));
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicPageEvidenceProjection(evidence)) === digest(publicPageEvidenceProjection(repeatedEvidence));
  const hashOnlyPageSummaries = remoteHashPageEvidenceHasNoRawValues(collection);
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};

  return [
    proofGate('ordered-page-chain', chain.ordered, chain),
    proofGate('complete-page-coverage', coverage.complete, coverage),
    proofGate('bounded-page-size', boundedPageSize, {
      batchSize: collection.batchSize,
      maxBatchSize: REMOTE_HASH_MAX_BATCH_SIZE,
      pageSizes: pages.map((page) => page.pageResourceCount),
    }),
    proofGate('page-summary-hashes-match', pageHashMismatches.length === 0, {
      mismatchedPageIndexes: pageHashMismatches,
    }),
    proofGate('deterministic-page-evidence', deterministicProjection, {
      firstEvidenceHash: digest(publicPageEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicPageEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('hash-only-page-summaries', hashOnlyPageSummaries, {
      rawValueEvidenceLeaks: hashOnlyPageSummaries ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', (
      runtime.durationMs <= runtime.budgets?.maxDurationMs
        && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    ), {
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

function pageChainMetrics(pages) {
  let expectedOffset = 0;
  let previousNextCursorHash = null;
  let staleCursorCount = 0;
  let offsetMismatchCount = 0;
  let indexMismatchCount = 0;
  let nextOffsetMismatchCount = 0;

  pages.forEach((page, index) => {
    if (page.pageIndex !== index) {
      indexMismatchCount += 1;
    }
    if (page.offset !== expectedOffset) {
      offsetMismatchCount += 1;
    }
    if (page.cursorInputHash !== previousNextCursorHash) {
      staleCursorCount += 1;
    }
    if (page.nextOffset !== page.offset + page.pageResourceCount) {
      nextOffsetMismatchCount += 1;
    }
    expectedOffset = page.nextOffset;
    previousNextCursorHash = page.nextCursorHash;
  });

  return {
    ordered: staleCursorCount === 0
      && offsetMismatchCount === 0
      && indexMismatchCount === 0
      && nextOffsetMismatchCount === 0,
    staleCursorCount,
    offsetMismatchCount,
    indexMismatchCount,
    nextOffsetMismatchCount,
    terminalNextCursorHash: pages.at(-1)?.nextCursorHash ?? null,
  };
}

function pageCoverageMetrics(collection, pages) {
  const observedResourceKeyHashes = pages.flatMap((page) => page.resourceKeyHashes || []);
  const uniqueResourceKeyHashes = new Set(observedResourceKeyHashes).size;
  const recomputedObservedCoverageHash = sha256(observedResourceKeyHashes);
  const completePageCount = pages.filter((page) => page.complete).length;
  const expectedPageCount = Math.ceil(collection.resourceCount / collection.batchSize);
  const complete = pages.length === collection.pageCount
    && pages.length === expectedPageCount
    && collection.expectedPageCount === expectedPageCount
    && completePageCount === 1
    && pages.at(-1)?.complete === true
    && pages.at(-1)?.nextCursorHash === null
    && observedResourceKeyHashes.length === collection.resourceCount
    && uniqueResourceKeyHashes === collection.resourceCount
    && collection.uniqueResourceKeyHashes === uniqueResourceKeyHashes
    && collection.completePageCount === completePageCount
    && collection.observedCoverageHash === recomputedObservedCoverageHash
    && collection.observedCoverageHash === collection.expectedCoverageHash;

  return {
    complete,
    pageCount: pages.length,
    recordedPageCount: collection.pageCount,
    expectedPageCount,
    completePageCount,
    observedResourceKeyHashes: observedResourceKeyHashes.length,
    uniqueResourceKeyHashes,
    recomputedObservedCoverageHash,
    recordedObservedCoverageHash: collection.observedCoverageHash,
    expectedCoverageHash: collection.expectedCoverageHash,
  };
}

function unsafePageEvidenceDecisions(evidence, repeatedEvidence) {
  const stalePageCursor = withPassedStatus(clone(evidence));
  stalePageCursor.pageCollection.pages[1].cursorInputHash = sha256('rpp-0731-stale-page-cursor');

  const missingPage = withPassedStatus(clone(evidence));
  missingPage.pageCollection.pages.splice(2, 1);
  missingPage.pageCollection.pageCount = missingPage.pageCollection.pages.length;

  const mismatchedPageHash = withPassedStatus(clone(evidence));
  mismatchedPageHash.pageCollection.pages[0].pageSummaryHash = sha256('rpp-0731-mismatched-page-hash');

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    stalePageCursor: resolvePagedRemoteHashCollection(stalePageCursor, { repeatedEvidence }),
    missingPage: resolvePagedRemoteHashCollection(missingPage, { repeatedEvidence }),
    mismatchedPageHash: resolvePagedRemoteHashCollection(mismatchedPageHash, { repeatedEvidence }),
    prematurePassStatus: resolvePagedRemoteHashCollection(prematurePassStatus, { repeatedEvidence }),
  };
}

function publicBenchmarkProjection(benchmark) {
  return {
    benchmark: benchmark.benchmark,
    ok: benchmark.ok,
    mode: benchmark.mode,
    runtime: {
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
      liveRemoteService: benchmark.runtime.liveRemoteService.status,
    },
    resources: benchmark.resources,
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      evidenceHash: digest(gate.evidence),
    })),
  };
}

function publicPageEvidenceProjection(evidence) {
  const collection = evidence.pageCollection || {};
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    pageCollection: {
      sourceHash: collection.sourceHash,
      scopeHash: collection.scopeHash,
      resourceCount: collection.resourceCount,
      batchSize: collection.batchSize,
      maxBatchSize: collection.maxBatchSize,
      pageCount: collection.pageCount,
      expectedPageCount: collection.expectedPageCount,
      pageOffsets: collection.pageOffsets,
      pageSizes: collection.pageSizes,
      pageCompleteFlags: collection.pageCompleteFlags,
      completePageCount: collection.completePageCount,
      uniqueResourceKeyHashes: collection.uniqueResourceKeyHashes,
      expectedCoverageHash: collection.expectedCoverageHash,
      observedCoverageHash: collection.observedCoverageHash,
      snapshotHashSetHash: collection.snapshotHashSetHash,
      collectionSummaryHash: collection.collectionSummaryHash,
      planningOnly: collection.planningOnly,
      pages: collection.pages,
    },
    release: evidence.release,
  };
}

function pageSummaryCore(page) {
  return {
    pageIndex: page.pageIndex,
    cursorInputHash: page.cursorInputHash,
    nextCursorHash: page.nextCursorHash,
    offset: page.offset,
    nextOffset: page.nextOffset,
    batchSize: page.batchSize,
    pageResourceCount: page.pageResourceCount,
    resourceCount: page.resourceCount,
    complete: page.complete,
    routePageHash: page.routePageHash,
    snapshotHashSetHash: page.snapshotHashSetHash,
    resourceKeyHashes: page.resourceKeyHashes,
    resourceProofHashes: page.resourceProofHashes,
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

function orderedResourceKeyHashes(resources) {
  return [...resources]
    .map((resource) => String(resource.resource_key))
    .sort((left, right) => left.localeCompare(right))
    .map((resourceKey) => sha256(resourceKey));
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

function assertHashOnlyPageEvidence(value) {
  assert.equal(remoteHashPageEvidenceHasNoRawValues(value), true);
}

function remoteHashPageEvidenceHasNoRawValues(value) {
  return !rawRemoteHashEvidencePattern().test(JSON.stringify(value));
}

function rawRemoteHashEvidencePattern() {
  return /resource_key|wp-content|wp_posts|pagination-secret|private row value|forms-\d|asset-\d|ID:\d|sourceUrlHash|restNamespace|routeProfile|"resources":\s*\[/i;
}

function nullableSha256(value) {
  return value === null || value === undefined ? null : sha256(value);
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
