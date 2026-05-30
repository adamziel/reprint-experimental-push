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
  coverageKey: 'wpTermRelationshipsGraphReleaseVerifierVariant5',
  family: 'wp-term-relationships-graph-release-verifier-v5',
  tag: 'wp-term-relationships-graph-release-verifier-v5',
  readyTag: 'wp-term-relationships-graph-release-verifier-v5-ready',
  staleTag: 'wp-term-relationships-graph-release-verifier-v5-stale',
  nonReadyTag: 'wp-term-relationships-graph-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1]));
const expectedStatuses = { blocked: 5, ready: 5 };
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

function fileResource(path) {
  return {
    type: 'file',
    path,
    key: `file:${path}`,
  };
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertTermRelationshipsShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('same-plan-graph'));
  assert.ok(testCase.tags.has('taxonomy-graph'));
  assert.ok(testCase.tags.has('wp-term-relationships-graph'));
  assert.ok(testCase.tags.has('wp-term-relationships-create'));
  assert.ok(testCase.tags.has(target.tag));
  assert.equal(testCase.tags.has(target.readyTag), !staleTarget);
  assert.equal(testCase.tags.has(target.staleTag), staleTarget);
  assert.equal(testCase.tags.has(target.nonReadyTag), staleTarget);

  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([, row]) => typeof row.name === 'string'
      && row.name.startsWith('Generated wp_term_relationships term target '));
  const taxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([, row]) => typeof row.description === 'string'
      && row.description.startsWith('Generated wp_term_relationships taxonomy target '));

  assert.equal(termRows.length, 1, `${testCase.id} should carry one relationship target term`);
  assert.equal(taxonomyRows.length, 1, `${testCase.id} should carry one relationship target taxonomy`);

  const [termRowId, termRow] = termRows[0];
  const [taxonomyRowId, taxonomyRow] = taxonomyRows[0];
  const relationshipRowId = `object_id:1|term_taxonomy_id:${taxonomyRow.term_taxonomy_id}`;
  const relationshipRow = testCase.local.db.wp_term_relationships[relationshipRowId];
  const remoteOnlyPrefix = staleTarget ? 'stale-wp-term-relationships' : 'ready-wp-term-relationships';
  const remoteOnlyPaths = Object.keys(testCase.remote.files)
    .filter((path) => path.includes(`${remoteOnlyPrefix}-remote-only-`)
      && !Object.hasOwn(testCase.base.files, path)
      && !Object.hasOwn(testCase.local.files, path));

  assert.ok(relationshipRow, `${testCase.id} should create one relationship for the target taxonomy`);
  assert.equal(remoteOnlyPaths.length, 1, `${testCase.id} should seed one relationship remote-only preservation file`);
  assert.ok(testCase.base.db.wp_posts[`ID:${relationshipRow.object_id}`], `${testCase.id} relationship post should exist`);
  assert.equal(taxonomyRow.term_id, termRow.term_id, `${testCase.id} taxonomy should reference the target term`);
  assert.equal(
    relationshipRow.term_taxonomy_id,
    taxonomyRow.term_taxonomy_id,
    `${testCase.id} relationship should reference the target taxonomy`,
  );
  assert.equal(relationshipRow.term_order, 0);
  assert.equal(testCase.base.db.wp_term_relationships[relationshipRowId], undefined);
  assert.equal(testCase.remote.db.wp_term_relationships[relationshipRowId], undefined);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale term target should exist in base`);
    assert.ok(
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should exist in base`,
    );
    assert.deepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale term target should not drift`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should drift remotely`,
    );
    assert.ok(testCase.tags.has('wp-term-relationships-remote-drift'));
  } else {
    assert.equal(testCase.base.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.remote.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.base.db.wp_term_taxonomy[taxonomyRowId], undefined);
    assert.equal(testCase.remote.db.wp_term_taxonomy[taxonomyRowId], undefined);
  }

  return {
    termRowId,
    taxonomyRowId,
    relationshipRowId,
    remoteOnlyPath: remoteOnlyPaths[0],
    termRow,
    taxonomyRow,
    relationshipRow,
    remoteTaxonomyRow: testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
  };
}

function surfaceEvidence(testCase, shape) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', shape.taxonomyRowId);
  const relationshipResource = rowResource('wp_term_relationships', shape.relationshipRowId);
  const remoteOnlyResource = fileResource(shape.remoteOnlyPath);

  return {
    term: {
      resourceKey: termResource.key,
      baseHash: resourceHash(testCase.base, termResource),
      localHash: resourceHash(testCase.local, termResource),
      remoteHash: resourceHash(testCase.remote, termResource),
      termIdHash: `sha256:${digest(shape.termRowId)}`,
      slugHash: `sha256:${digest(shape.termRow.slug)}`,
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
    relationship: {
      resourceKey: relationshipResource.key,
      baseHash: resourceHash(testCase.base, relationshipResource),
      localHash: resourceHash(testCase.local, relationshipResource),
      remoteHash: resourceHash(testCase.remote, relationshipResource),
      objectIdHash: `sha256:${digest(String(shape.relationshipRow.object_id))}`,
      taxonomyIdHash: `sha256:${digest(String(shape.relationshipRow.term_taxonomy_id))}`,
      termOrderHash: `sha256:${digest(String(shape.relationshipRow.term_order))}`,
    },
    remoteOnly: {
      resourceKey: remoteOnlyResource.key,
      baseHash: resourceHash(testCase.base, remoteOnlyResource),
      localHash: resourceHash(testCase.local, remoteOnlyResource),
      remoteHash: resourceHash(testCase.remote, remoteOnlyResource),
    },
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'term', resource: rowResource('wp_terms', shape.termRowId), changeKind: 'create' },
    { label: 'taxonomy', resource: rowResource('wp_term_taxonomy', shape.taxonomyRowId), changeKind: 'create' },
    { label: 'relationship', resource: rowResource('wp_term_relationships', shape.relationshipRowId), changeKind: 'create' },
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
      preconditionCheckedAgainst: precondition.checkedAgainst,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        preconditionCheckedAgainst: precondition.checkedAgainst,
      })}`,
    };
  }

  const remoteOnlyResource = fileResource(shape.remoteOnlyPath);
  const remoteBeforeHash = resourceHash(testCase.remote, remoteOnlyResource);
  const appliedHash = resourceHash(applied.site, remoteOnlyResource);
  assert.equal(appliedHash, remoteBeforeHash, `${testCase.id} overwrote unplanned relationship remote-only file`);

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
    remoteOnlyPreservation: {
      resourceKey: remoteOnlyResource.key,
      remoteBeforeHash,
      appliedHash,
      preserved: true,
    },
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
  assert.equal(error.details?.resourceKey, resource.key);
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
  const relationshipResource = rowResource('wp_term_relationships', shape.relationshipRowId);
  const attempts = {
    term: staleReplayAttempt({
      testCase,
      plan,
      resource: termResource,
      mutateRemote(remote) {
        remote.db.wp_terms ||= {};
        remote.db.wp_terms[shape.termRowId] = {
          ...shape.termRow,
          name: 'RPP-0193 stale replay term drift',
          slug: 'rpp-0193-stale-replay-term',
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
          description: 'RPP-0193 stale replay taxonomy drift',
          count: 9,
        };
      },
    }),
    relationship: staleReplayAttempt({
      testCase,
      plan,
      resource: relationshipResource,
      mutateRemote(remote) {
        remote.db.wp_term_relationships ||= {};
        remote.db.wp_term_relationships[shape.relationshipRowId] = {
          ...shape.relationshipRow,
          term_order: 7,
        };
      },
    }),
  };

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
  const relationshipResourceKey = rowResourceKey('wp_term_relationships', shape.relationshipRowId);
  const graphResourceKeys = new Set([termResourceKey, taxonomyResourceKey, relationshipResourceKey]);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === taxonomyResourceKey));
  const taxonomyDecision = plan.decisions.find((entry) => entry.resourceKey === taxonomyResourceKey);
  const plannedGraphMutation = plan.mutations.some((mutation) => graphResourceKeys.has(mutation.resourceKey));
  const plannedGraphPrecondition = plan.preconditions.some((precondition) =>
    graphResourceKeys.has(precondition.resourceKey));

  assert.ok(blocker, `${testCase.id} should report a stale term-relationship graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(taxonomyDecision, `${testCase.id} should keep the stale remote taxonomy`);
  assert.equal(taxonomyDecision.decision, 'keep-remote');
  assert.equal(plannedGraphMutation, false, `${testCase.id} should not plan stale relationship graph mutations`);
  assert.equal(plannedGraphPrecondition, false, `${testCase.id} should not precondition stale relationship graph rows`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedGraphMutation,
    plannedGraphPrecondition,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: taxonomyResourceKey,
    targetChange: blocker.references.find((reference) =>
      reference.targetResourceKey === taxonomyResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: taxonomyDecision.resourceKey,
      decision: taxonomyDecision.decision,
      decisionHash: `sha256:${digest(taxonomyDecision)}`,
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
    testCase.tags.has('wp-term-relationships-graph-stale'),
    `${testCase.id} RPP-0193 stale tag should match relationship graph stale tag`,
  );
  assert.equal(
    testCase.tags.has(target.readyTag),
    testCase.tags.has('wp-term-relationships-graph-ready'),
    `${testCase.id} RPP-0193 ready tag should match relationship graph ready tag`,
  );
  assert.equal(
    testCase.tags.has(target.nonReadyTag),
    staleTarget,
    `${testCase.id} RPP-0193 non-ready tag should match stale relationship graph target`,
  );

  const shape = assertTermRelationshipsShape(testCase, { staleTarget });
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
    const {
      plannedChangeKinds,
      graphMutations,
      remoteOnlyPreservation,
    } = readyMutationEvidence({
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
      remoteOnlyPreservation,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
        remoteOnlyPreservation,
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

function generatedWpTermRelationshipsReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyUnplannedPreserved = 0;
  let readyRemoteOnlyPreserved = 0;
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
        .every((mutation) => mutation.plannedPrecondition
          && mutation.preconditionCheckedAgainst === 'live-remote') ? 1 : 0;
      readyUnplannedPreserved += evidence.unplannedRemotePreserved ? 1 : 0;
      readyRemoteOnlyPreserved += evidence.remoteOnlyPreservation.preserved ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplay.allRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.allBeforeMutation ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
      nonReadyGraphRowsSuppressed += !evidence.staleBlocker.plannedGraphMutation
        && !evidence.staleBlocker.plannedGraphPrecondition ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0193 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0193 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0193 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0193 target should select one ready relationship case');
  assert.ok(selectedCases.has('stale-non-ready'), 'RPP-0193 target should select one stale non-ready relationship case');

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
      readyRemoteOnlyPreserved,
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

test('RPP-0193 generated harness summary exposes wp_term_relationships release-verifier v5 counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));
  const summaryText = JSON.stringify(report);

  assert.ok(coverage, 'missing wp_term_relationships release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(coverage.total - coverage.statuses.ready, 5);
  assert.equal(report.summary.featureFamilies[target.readyTag], 5);
  assert.equal(report.summary.featureFamilies[target.staleTag], 5);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 5);
  assert.ok(readyCase, 'missing ready RPP-0193 wp_term_relationships case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0193 wp_term_relationships case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.notEqual(validateGeneratedCase(nonReadyCase).status, 'ready');
  assert.equal(summaryText.includes('Generated wp_term_relationships'), false, 'RPP-0193 summary leaked relationship value');
  assert.equal(summaryText.includes('generated-wp-term-relationships'), false, 'RPP-0193 summary leaked relationship slug');
  assert.equal(summaryText.includes('Remote stale wp_term_relationships'), false, 'RPP-0193 summary leaked stale relationship value');
  assert.equal(
    summaryText.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'RPP-0193 summary leaked remote-only relationship note',
  );
});

test('RPP-0193 generated wp_term_relationships release-verifier carries ready apply and stale refusal checks', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedWpTermRelationshipsReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedWpTermRelationshipsReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0193-wp-term-relationships-graph-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0193 wp_term_relationships evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.total - coverage.statuses.ready);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 5,
    readyPreconditioned: 5,
    readyUnplannedPreserved: 5,
    readyRemoteOnlyPreserved: 5,
    readyStaleReplayRejected: 5,
    readyStaleReplayBeforeMutation: 5,
    nonReadyApplyRefused: 5,
    nonReadyBeforeMutation: 5,
    nonReadyGraphRowsSuppressed: 5,
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
  assert.ok(readyCase.readyBeforeMutationCalls >= 3);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.remoteBeforeHash, readyCase.remoteOnlyPreservation.appliedHash);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 3 });

  for (const label of ['term', 'taxonomy', 'relationship']) {
    const mutation = readyCase.graphMutations[label];
    assert.equal(mutation.changeKind, 'create');
    assert.equal(mutation.plannedMutation, true);
    assert.equal(mutation.plannedPrecondition, true);
    assert.equal(mutation.preconditionCheckedAgainst, 'live-remote');
    assert.equal(mutation.appliedHash, readyCase.surface[label].localHash);
    assert.equal(mutation.preconditionExpectedHash, mutation.remoteBeforeHash);
    assert.match(mutation.mutationHash, sha256EvidencePattern);
  }

  assert.deepEqual(Object.keys(readyCase.staleReplay.attempts).sort(), ['relationship', 'taxonomy', 'term']);
  for (const attempt of Object.values(readyCase.staleReplay.attempts)) {
    assert.equal(attempt.code, 'PRECONDITION_FAILED');
    assert.equal(attempt.resourceKey, attempt.expectedResourceKey);
    assert.equal(attempt.beforeMutationCalls, 0);
    assert.equal(attempt.preMutationRefusal, true);
    assert.equal(attempt.remoteUnchanged, true);
    assert.match(attempt.detailsHash, sha256EvidencePattern);
  }
  assert.equal(readyCase.staleReplay.allRejected, true);
  assert.equal(readyCase.staleReplay.allBeforeMutation, true);
  assert.equal(readyCase.staleReplay.allRemoteUnchanged, true);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(nonReadyCase.tags.includes(target.staleTag));
  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.equal(nonReadyCase.status, 'blocked');
  assert.equal(nonReadyCase.variant, 'stale-non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.beforeMutationCalls, 0);
  assert.equal(nonReadyCase.refusal.preMutationRefusal, true);
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.relationship.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedGraphMutation, false);
  assert.equal(nonReadyCase.staleBlocker.plannedGraphPrecondition, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_relationships.term_taxonomy_id']);
  assert.equal(nonReadyCase.staleBlocker.decision.decision, 'keep-remote');
  assert.match(nonReadyCase.staleBlocker.blockerHash, sha256EvidencePattern);
  assert.match(nonReadyCase.staleBlocker.decision.decisionHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('Generated wp_term_relationships'), false, 'RPP-0193 evidence leaked relationship value');
  assert.equal(evidenceText.includes('generated-wp-term-relationships'), false, 'RPP-0193 evidence leaked relationship slug');
  assert.equal(evidenceText.includes('Remote stale wp_term_relationships'), false, 'RPP-0193 evidence leaked stale relationship value');
  assert.equal(
    evidenceText.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'RPP-0193 evidence leaked remote-only relationship note',
  );
  assert.equal(evidenceText.includes('RPP-0193 stale replay'), false, 'RPP-0193 evidence leaked stale replay payload');
});
