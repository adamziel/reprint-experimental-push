import test from 'node:test';
import assert from 'node:assert/strict';

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
const target = Object.freeze({
  coverageKey: 'wpTermTaxonomyGraphReleaseVerifierVariant5',
  family: 'wp-term-taxonomy-graph-release-verifier-v5',
  tag: 'wp-term-taxonomy-graph-release-verifier-v5',
  readyTag: 'wp-term-taxonomy-graph-release-verifier-v5-ready',
  staleTag: 'wp-term-taxonomy-graph-release-verifier-v5-stale',
  nonReadyTag: 'wp-term-taxonomy-graph-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const expectedStatuses = { blocked: 4, conflict: 6, ready: 10 };
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

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertTermTaxonomyShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('same-plan-graph'));
  assert.ok(testCase.tags.has('taxonomy-graph'));
  assert.ok(testCase.tags.has('wp-term-taxonomy-graph'));
  assert.ok(testCase.tags.has('wp-term-taxonomy-create'));
  assert.ok(testCase.tags.has(target.tag));

  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term taxonomy graph target '));
  const taxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([id, row]) => !testCase.base.db.wp_term_taxonomy[id]
      && typeof row.description === 'string'
      && row.description.startsWith('generated term taxonomy graph '));

  assert.equal(termRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one term`);
  assert.equal(taxonomyRows.length, 1, `${testCase.id} should create one wp_term_taxonomy row`);

  const [taxonomyRowId, taxonomyRow] = taxonomyRows[0];
  const termId = taxonomyRow.term_id;
  const termRowId = `term_id:${termId}`;
  const localTerm = testCase.local.db.wp_terms[termRowId];
  const remoteTerm = testCase.remote.db.wp_terms[termRowId];
  const baseTerm = testCase.base.db.wp_terms[termRowId];

  assert.equal(taxonomyRowId, `term_taxonomy_id:${taxonomyRow.term_taxonomy_id}`);
  assert.equal(taxonomyRow.term_id, termId);
  assert.equal(taxonomyRow.taxonomy, 'category');
  assert.equal(taxonomyRow.parent, 0);
  assert.equal(taxonomyRow.count, 1);
  assert.equal(testCase.base.db.wp_term_taxonomy[taxonomyRowId], undefined);
  assert.equal(testCase.remote.db.wp_term_taxonomy[taxonomyRowId], undefined);
  assert.ok(localTerm, `${testCase.id} should have the term target locally`);

  if (staleTarget) {
    assert.ok(baseTerm, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteTerm, `${testCase.id} stale target should exist remotely`);
    assert.deepEqual(localTerm, baseTerm, `${testCase.id} stale local term should match base`);
    assert.notDeepEqual(remoteTerm, baseTerm, `${testCase.id} stale target should drift remotely`);
    assert.equal(remoteTerm.name, `Remote stale term taxonomy graph target ${termId}`);
    assert.equal(remoteTerm.slug, `remote-stale-term-taxonomy-graph-${termId}`);
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-terms-remote-drift'));
    assert.ok(testCase.tags.has(target.staleTag));
    assert.ok(testCase.tags.has(target.nonReadyTag));
  } else {
    assert.equal(baseTerm, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteTerm, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-terms-create'));
    assert.ok(testCase.tags.has(target.readyTag));
  }

  return {
    termId,
    termRowId,
    taxonomyRowId,
    localTerm,
    remoteTerm,
    baseTerm,
    taxonomyRow,
  };
}

function surfaceEvidence(testCase, shape) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', shape.taxonomyRowId);

  return {
    term: {
      resourceKey: termResource.key,
      baseHash: resourceHash(testCase.base, termResource),
      localHash: resourceHash(testCase.local, termResource),
      remoteHash: resourceHash(testCase.remote, termResource),
      termIdHash: `sha256:${digest(shape.termRowId)}`,
      slugHash: `sha256:${digest(shape.localTerm.slug)}`,
    },
    taxonomy: {
      resourceKey: taxonomyResource.key,
      baseHash: resourceHash(testCase.base, taxonomyResource),
      localHash: resourceHash(testCase.local, taxonomyResource),
      remoteHash: resourceHash(testCase.remote, taxonomyResource),
      termIdHash: `sha256:${digest(String(shape.taxonomyRow.term_id))}`,
      taxonomyHash: `sha256:${digest(shape.taxonomyRow.taxonomy)}`,
      descriptionHash: `sha256:${digest(shape.taxonomyRow.description)}`,
    },
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'term', resource: rowResource('wp_terms', shape.termRowId), changeKind: 'create' },
    { label: 'taxonomy', resource: rowResource('wp_term_taxonomy', shape.taxonomyRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
  };
}

function staleReplayAttempt({ testCase, plan, resource, mutateRemote }) {
  const driftedRemote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(driftedRemote);
  let beforeMutationCalls = 0;

  mutateRemote(driftedRemote);

  const staleRemoteHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale replay should refuse apply`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.notEqual(staleRemoteHash, remoteBeforeHash, `${testCase.id} stale remote should drift before replay`);
  assert.equal(remoteAfterHash, staleRemoteHash, `${testCase.id} stale replay refusal mutated remote`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);

  return {
    code: error.code,
    resourceKey: error.details?.resourceKey,
    expectedResourceKey: resource.key,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    staleRemoteHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === staleRemoteHash,
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', shape.taxonomyRowId);
  const attempts = {
    term: staleReplayAttempt({
      testCase,
      plan,
      resource: termResource,
      mutateRemote(remote) {
        remote.db.wp_terms ||= {};
        remote.db.wp_terms[shape.termRowId] = {
          ...shape.localTerm,
          name: 'RPP-0192 stale replay term drift',
          slug: 'rpp-0192-stale-replay-term',
        };
      },
    }),
    taxonomy: staleReplayAttempt({
      testCase,
      plan,
      resource: taxonomyResource,
      mutateRemote(remote) {
        remote.db.wp_term_taxonomy ||= {};
        remote.db.wp_term_taxonomy[shape.taxonomyRowId] = {
          ...shape.taxonomyRow,
          description: 'RPP-0192 stale replay taxonomy drift',
          count: 9,
        };
      },
    }),
  };

  assert.equal(attempts.term.resourceKey, termResource.key);
  assert.equal(attempts.taxonomy.resourceKey, taxonomyResource.key);

  return {
    attempts,
    allRejected: Object.values(attempts).every((attempt) => attempt.code === 'PRECONDITION_FAILED'),
    allBeforeMutation: Object.values(attempts).every((attempt) => attempt.beforeMutationCalls === 0),
    allRemoteUnchanged: Object.values(attempts).every((attempt) => attempt.remoteUnchanged),
  };
}

function staleBlockerEvidence({ testCase, plan, shape }) {
  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const termDecision = plan.decisions.find((entry) => entry.resourceKey === termResourceKey);
  const plannedMutation = plan.mutations.some((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === taxonomyResourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) =>
    precondition.resourceKey === termResourceKey || precondition.resourceKey === taxonomyResourceKey);

  assert.ok(blocker, `${testCase.id} should report a stale term-taxonomy graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(termDecision, `${testCase.id} should keep the stale remote term`);
  assert.equal(termDecision.decision, 'keep-remote');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan stale term-taxonomy graph mutations`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition stale term-taxonomy graph rows`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedMutation,
    plannedPrecondition,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: termResourceKey,
    targetChange: blocker.references.find((reference) =>
      reference.targetResourceKey === termResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: termDecision.resourceKey,
      decision: termDecision.decision,
      decisionHash: `sha256:${digest(termDecision)}`,
    },
  };
}

function refusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} non-ready refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function caseEvidence(testCase, result) {
  const staleTarget = testCase.tags.has(target.staleTag);
  assert.equal(
    staleTarget,
    testCase.family === 'wp-term-taxonomy-graph-stale',
    `${testCase.id} RPP-0192 stale tag should match stale graph family`,
  );
  assert.equal(
    testCase.tags.has(target.readyTag),
    testCase.family === 'wp-term-taxonomy-graph-ready',
    `${testCase.id} RPP-0192 ready tag should match ready graph family`,
  );
  const shape = assertTermTaxonomyShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = surfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    let readyBeforeMutationCalls = 0;
    const applied = applyPlan(cloneJson(testCase.remote), plan, {
      beforeMutation() {
        readyBeforeMutationCalls += 1;
      },
    });
    const { plannedChangeKinds, graphMutations } = readyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = staleReplayEvidence({ testCase, plan, shape });

    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(readyBeforeMutationCalls, plan.mutations.length, `${testCase.id} ready apply should reach every mutation`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      readyBeforeMutationCalls,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
        staleReplay,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = staleBlockerEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function generatedWpTermTaxonomyReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyUnplannedPreserved = 0;
  let readyStaleReplayRejected = 0;
  let readyStaleReplayBeforeMutation = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;
  let nonReadyGraphRowsSuppressed = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readyPreconditioned += Object.values(evidence.graphMutations)
        .every((mutation) => mutation.plannedPrecondition) ? 1 : 0;
      readyUnplannedPreserved += evidence.unplannedRemotePreserved ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplay.allRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.allBeforeMutation ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
      nonReadyGraphRowsSuppressed += !evidence.staleBlocker.plannedMutation
        && !evidence.staleBlocker.plannedPrecondition ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0192 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0192 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0192 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0192 target should select one ready term-taxonomy case');
  assert.ok(selectedCases.has('stale-non-ready'), 'RPP-0192 target should select one stale non-ready term-taxonomy case');

  return {
    target: target.coverageKey,
    family: coverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    aggregate: {
      readyApplied,
      readyPreconditioned,
      readyUnplannedPreserved,
      readyStaleReplayRejected,
      readyStaleReplayBeforeMutation,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
      nonReadyGraphRowsSuppressed,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

test('RPP-0192 generated harness summary exposes wp_term_taxonomy release-verifier v5 counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));
  const summaryText = JSON.stringify(report);

  assert.ok(coverage, 'missing wp_term_taxonomy release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(coverage.total - coverage.statuses.ready, 10);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.staleTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0192 wp_term_taxonomy case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0192 wp_term_taxonomy case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.notEqual(validateGeneratedCase(nonReadyCase).status, 'ready');
  assert.equal(summaryText.includes('Generated term taxonomy graph target'), false, 'RPP-0192 summary leaked term name');
  assert.equal(summaryText.includes('generated-term-taxonomy-graph-'), false, 'RPP-0192 summary leaked term slug');
  assert.equal(summaryText.includes('generated term taxonomy graph '), false, 'RPP-0192 summary leaked taxonomy description');
  assert.equal(summaryText.includes('Remote stale term taxonomy graph target'), false, 'RPP-0192 summary leaked remote term drift');
});

test('RPP-0192 generated wp_term_taxonomy release-verifier evidence fails stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedWpTermTaxonomyReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedWpTermTaxonomyReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0192-wp-term-taxonomy-graph-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0192 wp_term_taxonomy evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.total - coverage.statuses.ready);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 10,
    readyPreconditioned: 10,
    readyUnplannedPreserved: 10,
    readyStaleReplayRejected: 10,
    readyStaleReplayBeforeMutation: 10,
    nonReadyApplyRefused: 10,
    nonReadyBeforeMutation: 10,
    nonReadyGraphRowsSuppressed: 10,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status === 'ready' ? 'ready' : 'non-ready'),
    ['ready', 'non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.readyBeforeMutationCalls, readyCase.planSummary.mutations);
  assert.ok(readyCase.readyBeforeMutationCalls >= 2);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });

  for (const label of ['term', 'taxonomy']) {
    const mutation = readyCase.graphMutations[label];
    assert.equal(mutation.changeKind, 'create');
    assert.equal(mutation.plannedMutation, true);
    assert.equal(mutation.plannedPrecondition, true);
    assert.equal(mutation.appliedHash, readyCase.surface[label].localHash);
    assert.equal(mutation.preconditionExpectedHash, mutation.remoteBeforeHash);
    assert.match(mutation.mutationHash, sha256EvidencePattern);
  }

  for (const label of ['term', 'taxonomy']) {
    const attempt = readyCase.staleReplay.attempts[label];
    assert.equal(attempt.code, 'PRECONDITION_FAILED');
    assert.equal(attempt.resourceKey, readyCase.surface[label].resourceKey);
    assert.equal(attempt.expectedResourceKey, readyCase.surface[label].resourceKey);
    assert.equal(attempt.beforeMutationCalls, 0);
    assert.equal(attempt.preMutationRefusal, true);
    assert.equal(attempt.remoteUnchanged, true);
    assert.match(attempt.detailsHash, sha256EvidencePattern);
  }
  assert.equal(readyCase.staleReplay.allRejected, true);
  assert.equal(readyCase.staleReplay.allBeforeMutation, true);
  assert.equal(readyCase.staleReplay.allRemoteUnchanged, true);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.ok(nonReadyCase.tags.includes(target.staleTag));
  assert.equal(nonReadyCase.variant, 'stale-non-ready');
  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.term.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.equal(nonReadyCase.staleBlocker.plannedPrecondition, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_taxonomy.term_id']);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.beforeMutationCalls, 0);
  assert.equal(nonReadyCase.refusal.preMutationRefusal, true);
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.staleBlocker.blockerHash, sha256EvidencePattern);
  assert.match(nonReadyCase.staleBlocker.decision.decisionHash, sha256EvidencePattern);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('Generated term taxonomy graph target'), false, 'RPP-0192 evidence leaked term name');
  assert.equal(evidenceText.includes('generated-term-taxonomy-graph-'), false, 'RPP-0192 evidence leaked term slug');
  assert.equal(evidenceText.includes('generated term taxonomy graph '), false, 'RPP-0192 evidence leaked taxonomy description');
  assert.equal(evidenceText.includes('Remote stale term taxonomy graph target'), false, 'RPP-0192 evidence leaked remote term drift');
  assert.equal(evidenceText.includes('remote-stale-term-taxonomy-graph-'), false, 'RPP-0192 evidence leaked remote term slug');
  assert.equal(evidenceText.includes('RPP-0192 stale replay term'), false, 'RPP-0192 evidence leaked stale replay term value');
  assert.equal(evidenceText.includes('rpp-0192-stale-replay-term'), false, 'RPP-0192 evidence leaked stale replay term slug');
  assert.equal(evidenceText.includes('RPP-0192 stale replay taxonomy'), false, 'RPP-0192 evidence leaked stale replay taxonomy value');
});
