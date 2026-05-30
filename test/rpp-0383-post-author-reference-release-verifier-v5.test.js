import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const readyFamily = 'same-plan-post-author-graph';
const staleFamily = 'stale-post-author-graph';
const forbiddenRawPostAuthorMarkers = Object.freeze([
  /post-author-reference-\d/,
  /post-author-target-\d/,
  'Generated post author target',
  'Remote stale post author',
  'remote-private-post-author',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, rowId) {
  return `row:${JSON.stringify([table, rowId])}`;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function postAuthorTargetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('post-author-graph'));
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
}

function assertPostAuthorGraphShape(testCase, { staleTarget }) {
  const authoredRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([, row]) => String(row.post_title || '').startsWith('post-author-reference-'));

  assert.equal(authoredRows.length, 1, `${testCase.id} should create one generated authored post`);

  const [postRowId, postRow] = authoredRows[0];
  const userId = Number(postRow.post_author);
  const userRowId = `ID:${userId}`;
  const user = testCase.local.db.wp_users[userRowId];

  assert.ok(Number.isSafeInteger(userId), `${testCase.id} post_author should be a numeric user id`);
  assert.equal(postRowId, `ID:${postRow.ID}`);
  assert.ok(user, `${testCase.id} missing generated author target ${userRowId}`);
  assert.equal(user.ID, userId);

  if (staleTarget) {
    assert.deepEqual(
      testCase.local.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale local author target should match base`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale author target should drift on the remote`,
    );
  } else {
    assert.equal(testCase.base.db.wp_users[userRowId], undefined);
    assert.equal(testCase.remote.db.wp_users[userRowId], undefined);
  }

  return {
    userId,
    userRowId,
    postRowId,
    userResourceKey: rowResourceKey('wp_users', userRowId),
    postResourceKey: rowResourceKey('wp_posts', postRowId),
  };
}

function assertNoRawPostAuthorMarkers(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const marker of forbiddenRawPostAuthorMarkers) {
    const leaked = marker instanceof RegExp ? marker.test(serialized) : serialized.includes(marker);
    assert.equal(leaked, false, `release-verifier evidence leaked ${String(marker)}`);
  }
}

function readyPostAuthorEvidence(testCase, plan, result, shape) {
  const userMutation = mutationFor(plan, shape.userResourceKey);
  const postMutation = mutationFor(plan, shape.postResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(result.status, 'ready');
  assert.equal(result.applied, true);
  assert.equal(result.unplannedRemotePreserved, true);
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
  assert.ok(userMutation, `${testCase.id} should plan the same-plan wp_users author target`);
  assert.ok(postMutation, `${testCase.id} should plan the authored wp_posts row`);
  assert.equal(userMutation.changeKind, 'create');
  assert.equal(postMutation.changeKind, 'create');

  const plannedPost = deserializeResourceValue(postMutation.value);
  assert.equal(plannedPost.post_author, shape.userId);

  const applied = applyPlan(cloneJson(testCase.remote), plan);
  assert.deepEqual(applied.site.db.wp_users[shape.userRowId], testCase.local.db.wp_users[shape.userRowId]);
  assert.deepEqual(applied.site.db.wp_posts[shape.postRowId], testCase.local.db.wp_posts[shape.postRowId]);

  return {
    stage: 'ready-apply',
    status: plan.status,
    generatedHarnessStatus: result.status,
    samePlanAuthorTarget: true,
    staleReplayRejected: true,
    staleReplayRejectionCode: result.staleReplayRejectionCode,
    appliedMutations: applied.appliedMutations,
    graphReference: {
      relationshipKey: 'wp_posts.post_author',
      relationshipType: 'post-author',
      sourceResourceKey: shape.postResourceKey,
      targetResourceKey: shape.userResourceKey,
      targetTable: 'wp_users',
      targetId: shape.userRowId,
      postMutationChangeKind: postMutation.changeKind,
      userMutationChangeKind: userMutation.changeKind,
    },
    hashes: {
      planHash: digest(plan),
      postMutationHash: digest(postMutation),
      userMutationHash: digest(userMutation),
      appliedPostHash: digest(applied.site.db.wp_posts[shape.postRowId]),
      appliedUserHash: digest(applied.site.db.wp_users[shape.userRowId]),
      journalHash: digest(applied.journal),
    },
  };
}

function stalePostAuthorEvidence(testCase, plan, result, shape) {
  const staleBlocker = blockerFor(plan, shape.postResourceKey);
  const staleReference = staleBlocker?.references?.find((reference) =>
    reference.relationshipType === 'post-author');
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));
  const remoteAfterHash = digest(remote);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(result.status, 'blocked');
  assert.equal(result.applied, false);
  assert.equal(result.nonReadyRemoteUnchanged, true);
  assert.equal(mutationFor(plan, shape.postResourceKey), null, `${testCase.id} must not plan the stale authored post`);
  assert.ok(staleBlocker, `${testCase.id} should block the post_author graph reference`);
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(staleReference, `${testCase.id} should include post_author reference evidence`);
  assert.equal(staleReference.relationshipKey, 'wp_posts.post_author');
  assert.equal(staleReference.sourceResourceKey, shape.postResourceKey);
  assert.equal(staleReference.targetResourceKey, shape.userResourceKey);
  assert.equal(staleReference.targetTable, 'wp_users');
  assert.equal(staleReference.targetId, shape.userRowId);
  assert.equal(staleReference.targetChange.remoteChange, 'update');
  assert.equal(staleReference.targetChange.localChange, 'unchanged');
  assert.match(staleReference.targetBaseHash, sha256Pattern);
  assert.match(staleReference.targetLocalHash, sha256Pattern);
  assert.match(staleReference.targetRemoteHash, sha256Pattern);
  assert.notEqual(staleReference.targetRemoteHash, staleReference.targetBaseHash);
  assert.equal(staleReference.targetLocalHash, staleReference.targetBaseHash);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash);
  for (const marker of forbiddenRawPostAuthorMarkers) {
    const leaked = marker instanceof RegExp ? marker.test(planJson) : planJson.includes(marker);
    assert.equal(leaked, false, `${testCase.id} plan leaked ${String(marker)}`);
  }

  return {
    stage: 'stale-refusal',
    status: plan.status,
    generatedHarnessStatus: result.status,
    samePlanAuthorTarget: false,
    failClosed: {
      code: error.code,
      remoteUnchanged: remoteAfterHash === remoteBeforeHash,
      remoteBeforeHash,
      remoteAfterHash,
    },
    graphReference: {
      relationshipKey: staleReference.relationshipKey,
      relationshipType: staleReference.relationshipType,
      sourceResourceKey: staleReference.sourceResourceKey,
      targetResourceKey: staleReference.targetResourceKey,
      targetTable: staleReference.targetTable,
      targetId: staleReference.targetId,
      targetChange: staleReference.targetChange,
      targetBaseHash: staleReference.targetBaseHash,
      targetLocalHash: staleReference.targetLocalHash,
      targetRemoteHash: staleReference.targetRemoteHash,
    },
    hashes: {
      planHash: digest(plan),
      blockerHash: digest(staleBlocker),
      refusalHash: digest(error.details || {}),
    },
  };
}

function releaseVerifierCaseEvidence(testCase) {
  const staleTarget = testCase.family === staleFamily;
  const shape = assertPostAuthorGraphShape(testCase, { staleTarget });
  const plan = planFor(testCase);
  const result = validateGeneratedCase(testCase);
  const evidence = staleTarget
    ? stalePostAuthorEvidence(testCase, plan, result, shape)
    : readyPostAuthorEvidence(testCase, plan, result, shape);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    releaseVerifierCheck: 'post-author-reference',
    outcome: result.status,
    mutationCount: plan.mutations.length,
    blockerCount: plan.blockers.length,
    ...evidence,
  };
}

function buildReleaseVerifierProof() {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postAuthorGraph;
  const cases = postAuthorTargetCases();
  const readyCases = cases.filter((testCase) => testCase.family === readyFamily);
  const staleCases = cases.filter((testCase) => testCase.family === staleFamily);
  const variants = cases.map(releaseVerifierCaseEvidence);
  const statusCounts = countBy(variants.map((entry) => entry.outcome));
  const staleFailClosed = variants.filter((entry) => entry.failClosed?.remoteUnchanged === true);

  const proof = {
    rpp: 'RPP-0383',
    evidenceScope: 'local-generated-release-verifier',
    evidenceSource: 'release-verifier-post-author-reference-v5',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      acceptedForReleaseGate: false,
      reason: 'local generated post_author graph evidence only; live production release proof is outside this slice',
    },
    releaseVerifier: {
      check: 'post-author-reference',
      generatedHarnessCovered: true,
      relationshipKey: 'wp_posts.post_author',
      sourceTable: 'wp_posts',
      targetTable: 'wp_users',
      readyFamily,
      staleFamily,
      readyCases: readyCases.length,
      staleCases: staleCases.length,
      staleFailClosedCases: staleFailClosed.length,
      statusCounts,
      targetCoverage: {
        family: coverage?.family || null,
        total: coverage?.total || 0,
        perTier: coverage?.perTier || {},
        statuses: coverage?.statuses || {},
      },
      caseSetHash: sha256Evidence(variants.map((entry) => ({
        id: entry.id,
        tier: entry.tier,
        family: entry.family,
        outcome: entry.outcome,
        stage: entry.stage,
        graphReference: {
          relationshipKey: entry.graphReference.relationshipKey,
          relationshipType: entry.graphReference.relationshipType,
          targetTable: entry.graphReference.targetTable,
        },
        failClosed: entry.failClosed
          ? {
              code: entry.failClosed.code,
              remoteUnchanged: entry.failClosed.remoteUnchanged,
            }
          : null,
      }))),
    },
    variants,
  };

  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    variants: proof.variants.map((entry) => ({
      id: entry.id,
      family: entry.family,
      outcome: entry.outcome,
      hashes: entry.hashes,
      failClosed: entry.failClosed
        ? {
            code: entry.failClosed.code,
            remoteUnchanged: entry.failClosed.remoteUnchanged,
          }
        : null,
    })),
  });

  assertNoRawPostAuthorMarkers(proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0383 post author release verifier proof',
  }));
  return proof;
}

let cachedProof;
function proof() {
  cachedProof ||= buildReleaseVerifierProof();
  return cachedProof;
}

test('RPP-0383 carries generated post_author ready and stale cases through release-verifier evidence', () => {
  const result = proof();

  assert.equal(result.rpp, 'RPP-0383');
  assert.equal(result.evidenceScope, 'local-generated-release-verifier');
  assert.equal(result.productionBacked, false);
  assert.equal(result.releaseGate.status, 'NO-GO');
  assert.equal(result.releaseGate.acceptedForReleaseGate, false);
  assert.equal(result.releaseVerifier.generatedHarnessCovered, true);
  assert.equal(result.releaseVerifier.readyFamily, readyFamily);
  assert.equal(result.releaseVerifier.staleFamily, staleFamily);
  assert.equal(result.releaseVerifier.readyCases, 10);
  assert.equal(result.releaseVerifier.staleCases, 10);
  assert.equal(result.releaseVerifier.staleFailClosedCases, 10);
  assert.deepEqual(result.releaseVerifier.statusCounts, { blocked: 10, ready: 10 });
  assert.deepEqual(result.releaseVerifier.targetCoverage.statuses, { blocked: 10, ready: 10 });
  assert.deepEqual(
    result.releaseVerifier.targetCoverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(result.releaseVerifier.targetCoverage.total, 20);
  assert.match(result.releaseVerifier.caseSetHash, sha256EvidencePattern);
  assert.match(result.proofHash, sha256EvidencePattern);
});

test('RPP-0383 release-verifier evidence applies ready post_author cases with same-plan users', () => {
  const ready = proof().variants.filter((entry) => entry.family === readyFamily);

  assert.equal(ready.length, 10);
  for (const entry of ready) {
    assert.equal(entry.stage, 'ready-apply');
    assert.equal(entry.outcome, 'ready');
    assert.equal(entry.samePlanAuthorTarget, true);
    assert.equal(entry.staleReplayRejected, true);
    assert.equal(entry.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(entry.graphReference.relationshipKey, 'wp_posts.post_author');
    assert.equal(entry.graphReference.relationshipType, 'post-author');
    assert.equal(entry.graphReference.targetTable, 'wp_users');
    assert.equal(entry.graphReference.postMutationChangeKind, 'create');
    assert.equal(entry.graphReference.userMutationChangeKind, 'create');
    assert.ok(entry.appliedMutations >= 2, `${entry.id} should apply at least the user and authored post`);
    assert.match(entry.hashes.planHash, sha256Pattern);
    assert.match(entry.hashes.postMutationHash, sha256Pattern);
    assert.match(entry.hashes.userMutationHash, sha256Pattern);
    assert.match(entry.hashes.appliedPostHash, sha256Pattern);
    assert.match(entry.hashes.appliedUserHash, sha256Pattern);
    assert.match(entry.hashes.journalHash, sha256Pattern);
  }
});

test('RPP-0383 release-verifier evidence keeps stale post_author target drift fail-closed', () => {
  const stale = proof().variants.filter((entry) => entry.family === staleFamily);

  assert.equal(stale.length, 10);
  for (const entry of stale) {
    assert.equal(entry.stage, 'stale-refusal');
    assert.equal(entry.outcome, 'blocked');
    assert.equal(entry.samePlanAuthorTarget, false);
    assert.equal(entry.failClosed.code, 'PLAN_NOT_READY');
    assert.equal(entry.failClosed.remoteUnchanged, true);
    assert.equal(entry.failClosed.remoteAfterHash, entry.failClosed.remoteBeforeHash);
    assert.equal(entry.graphReference.relationshipKey, 'wp_posts.post_author');
    assert.equal(entry.graphReference.relationshipType, 'post-author');
    assert.equal(entry.graphReference.targetTable, 'wp_users');
    assert.equal(entry.graphReference.targetChange.localChange, 'unchanged');
    assert.equal(entry.graphReference.targetChange.remoteChange, 'update');
    assert.equal(entry.graphReference.targetLocalHash, entry.graphReference.targetBaseHash);
    assert.notEqual(entry.graphReference.targetRemoteHash, entry.graphReference.targetBaseHash);
    assert.match(entry.graphReference.targetBaseHash, sha256Pattern);
    assert.match(entry.graphReference.targetLocalHash, sha256Pattern);
    assert.match(entry.graphReference.targetRemoteHash, sha256Pattern);
    assert.match(entry.hashes.planHash, sha256Pattern);
    assert.match(entry.hashes.blockerHash, sha256Pattern);
    assert.match(entry.hashes.refusalHash, sha256Pattern);
  }
  assertNoRawPostAuthorMarkers(stale);
});
