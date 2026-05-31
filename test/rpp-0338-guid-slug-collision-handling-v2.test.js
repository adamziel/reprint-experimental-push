import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function generatedGuidSlugCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('post-guid-slug-collision-guard'));
}

function countCasesByTier(cases) {
  const counts = {};
  for (const testCase of cases) {
    counts[String(testCase.tier)] = (counts[String(testCase.tier)] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function expectedTierCounts(count) {
  return Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), count]));
}

function assertPostGuidSlugCollisionShape(testCase, { staleTarget }) {
  const localRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([, row]) => String(row.post_title || '').startsWith('Generated GUID slug collision guard '));

  assert.equal(localRows.length, 1, `${testCase.id} should include one generated GUID/slug collision row`);

  const [localRowId, localRow] = localRows[0];
  const matchingRemoteRows = Object.entries(testCase.remote.db.wp_posts)
    .filter(([remoteRowId, row]) =>
      remoteRowId !== localRowId
      && row?.guid === localRow.guid
      && row?.post_type === localRow.post_type
      && row?.post_name === localRow.post_name);

  assert.equal(localRowId, `ID:${localRow.ID}`);
  assert.equal(localRow.post_type, 'page');
  assert.ok(localRow.guid, `${testCase.id} should carry GUID identity`);
  assert.ok(localRow.post_name, `${testCase.id} should carry slug identity`);

  if (staleTarget) {
    assert.equal(matchingRemoteRows.length, 1, `${testCase.id} should include one remote identity collision`);
    assert.equal(testCase.base.db.wp_posts[localRowId], undefined);
    assert.equal(testCase.remote.db.wp_posts[localRowId], undefined);
  } else {
    assert.equal(matchingRemoteRows.length, 0, `${testCase.id} should not collide with remote identity`);
  }

  const [remoteRowId, remoteRow] = matchingRemoteRows[0] || [];
  return {
    localRowId,
    localResource: rowResource('wp_posts', localRowId),
    localTitle: localRow.post_title,
    remoteRowId,
    remoteResource: remoteRowId ? rowResource('wp_posts', remoteRowId) : null,
    remoteTitle: remoteRow?.post_title || null,
    guid: localRow.guid,
    slug: localRow.post_name,
  };
}

function generatedRawGuidSlugValues(cases) {
  const values = [];
  for (const testCase of cases) {
    const readyShape = assertPostGuidSlugCollisionShape(testCase, {
      staleTarget: testCase.tags.has('post-guid-slug-collision-stale'),
    });
    values.push(readyShape.localTitle, readyShape.guid, readyShape.slug);
    if (readyShape.remoteTitle) {
      values.push(readyShape.remoteTitle, readyShape.guid, readyShape.slug);
    }
  }
  return values.filter(Boolean);
}

function assertNoRawGuidSlugValues(proof, rawValues) {
  const serialized = JSON.stringify(proof);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0338 proof leaked raw generated GUID/slug value: ${rawValue}`,
    );
  }
}

test('RPP-0338 generated harness includes GUID and slug collision ready and stale cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postGuidSlugCollision;
  const cases = generatedGuidSlugCases();
  const readyCases = cases.filter((testCase) => testCase.tags.has('post-guid-slug-collision-ready'));
  const staleCases = cases.filter((testCase) => testCase.tags.has('post-guid-slug-collision-stale'));
  const caseProofs = [];

  assert.ok(coverage, 'missing generated GUID/slug collision target coverage');
  assert.equal(coverage.family, 'post-guid-slug-collision-guard');
  assert.equal(coverage.total, report.summary.featureFamilies['post-guid-slug-collision-guard']);
  assert.equal(coverage.total, 20, 'expected generated GUID/slug collision target count');
  assert.deepEqual(coverage.statuses, { blocked: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, expectedTierCounts(2));
  assert.equal(cases.length, 20, 'expected one ready and one stale GUID/slug case per tier');
  assert.equal(readyCases.length, 10, 'expected one ready GUID/slug case per tier');
  assert.equal(staleCases.length, 10, 'expected one stale GUID/slug collision case per tier');
  assert.deepEqual(countCasesByTier(readyCases), expectedTierCounts(1));
  assert.deepEqual(countCasesByTier(staleCases), expectedTierCounts(1));

  for (const readyCase of readyCases) {
    const shape = assertPostGuidSlugCollisionShape(readyCase, { staleTarget: false });
    const plan = createPushPlan({
      base: readyCase.base,
      local: readyCase.local,
      remote: readyCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(readyCase);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.localResource.key);
    const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.localResource.key);
    const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.localResource.key);

    assert.equal(readyCase.tags.has('post-guid-slug-collision-ready-plan'), true);
    assert.equal(plan.status, 'ready', `${readyCase.id} should be ready without a remote identity collision`);
    assert.equal(result.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true);
    assert.ok(mutation, `${readyCase.id} should plan the unique GUID/slug post`);
    assert.ok(precondition, `${readyCase.id} should carry a live remote precondition`);
    assert.equal(blocker, undefined, `${readyCase.id} should not block the unique GUID/slug post`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');

    const plannedPost = deserializeResourceValue(mutation.value);
    assert.equal(plannedPost.guid, shape.guid);
    assert.equal(plannedPost.post_name, shape.slug);
    assert.equal(plannedPost.post_type, 'page');

    caseProofs.push({
      id: readyCase.id,
      tier: readyCase.tier,
      variant: 'ready-unique-guid-slug',
      status: plan.status,
      localResourceKey: shape.localResource.key,
      localHash: resourceHash(readyCase.local, shape.localResource),
      identityKinds: ['guid', 'post_type+post_name'],
      identityHash: digest({ guid: shape.guid, postType: 'page', slug: shape.slug }),
      mutation: {
        action: mutation.action,
        changeKind: mutation.changeKind,
        liveRemotePrecondition: precondition.expectedHash === mutation.remoteBeforeHash,
      },
      validation: {
        applied: result.applied,
        staleReplayRejected: result.staleReplayRejected,
        staleReplayRejectionCode: result.staleReplayRejectionCode,
      },
    });
  }

  for (const staleCase of staleCases) {
    const shape = assertPostGuidSlugCollisionShape(staleCase, { staleTarget: true });
    const plan = createPushPlan({
      base: staleCase.base,
      local: staleCase.local,
      remote: staleCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(staleCase);
    const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.localResource.key);
    const reference = blocker?.references?.find((entry) =>
      entry.relationshipType === 'post-natural-identity-collision'
      && entry.targetResourceKey === shape.remoteResource.key);
    const remoteDecision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteResource.key);
    const remoteBefore = cloneJson(staleCase.remote);
    const remoteHashBefore = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));

    assert.equal(staleCase.tags.has('post-guid-slug-collision-non-ready'), true);
    assert.equal(staleCase.tags.has('expected-blocked'), true);
    assert.equal(plan.status, 'blocked', `${staleCase.id} should fail closed on GUID/slug collision`);
    assert.equal(result.status, 'blocked');
    assert.equal(result.applied, false);
    assert.equal(result.nonReadyRemoteUnchanged, true);
    assert.equal(
      plan.mutations.some((entry) => entry.resourceKey === shape.localResource.key),
      false,
      `${staleCase.id} must not plan the colliding local post`,
    );
    assert.equal(
      plan.preconditions.some((entry) => entry.resourceKey === shape.localResource.key),
      false,
      `${staleCase.id} must not precondition the colliding local post`,
    );
    assert.ok(blocker, `${staleCase.id} should expose a collision blocker`);
    assert.equal(blocker.class, 'stale-wordpress-graph-identity');
    assert.match(blocker.reason, /collides with existing remote post identity/);
    assert.ok(reference, `${staleCase.id} should include natural identity collision evidence`);
    assert.equal(reference.relationshipKey, 'wp_posts.identity');
    assert.deepEqual(reference.identityKinds, ['guid', 'post_type+post_name']);
    assert.match(reference.targetRemoteHash, hashPattern);
    assert.equal(remoteDecision?.decision, 'keep-remote');
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), remoteHashBefore, `${staleCase.id} should refuse before mutation`);

    caseProofs.push({
      id: staleCase.id,
      tier: staleCase.tier,
      variant: 'stale-guid-slug-collision',
      status: plan.status,
      localResourceKey: shape.localResource.key,
      remoteResourceKey: shape.remoteResource.key,
      localHash: resourceHash(staleCase.local, shape.localResource),
      remoteHash: resourceHash(staleCase.remote, shape.remoteResource),
      identityKinds: reference.identityKinds,
      identityHash: digest({ guid: shape.guid, postType: 'page', slug: shape.slug }),
      collision: {
        blockerClass: blocker.class,
        relationshipType: reference.relationshipType,
        remoteDecision: remoteDecision?.decision,
        applyRefusalCode: error.code,
        refusedBeforeMutation: digest(remoteBefore) === remoteHashBefore,
      },
    });
  }

  const aggregateEvidence = {
    rpp: 'RPP-0338',
    evidenceSource: 'generated-post-guid-slug-collision-v2',
    generatedHarnessReadyAndStale: true,
    rawValuesIncluded: false,
    coverage: {
      family: coverage.family,
      total: coverage.total,
      perTier: coverage.perTier,
      statuses: coverage.statuses,
    },
    totals: {
      readyCases: readyCases.length,
      staleCases: staleCases.length,
      readyApplied: caseProofs.filter((entry) => entry.validation?.applied).length,
      staleCollisionBlocked: caseProofs.filter((entry) => entry.collision?.blockerClass === 'stale-wordpress-graph-identity').length,
    },
    identityKinds: ['guid', 'post_type+post_name'],
    caseProofs,
  };
  aggregateEvidence.proofHash = digest(aggregateEvidence);

  assert.match(aggregateEvidence.proofHash, hashPattern);
  assert.equal(aggregateEvidence.totals.readyApplied, 10);
  assert.equal(aggregateEvidence.totals.staleCollisionBlocked, 10);
  assertNoRawGuidSlugValues(aggregateEvidence, generatedRawGuidSlugValues(cases));
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregateEvidence, { label: 'RPP-0338 GUID/slug generated proof' }));
});
