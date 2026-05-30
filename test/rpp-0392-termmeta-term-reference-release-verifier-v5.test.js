import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T03:09:20.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const termId = 9392;
const termRowId = `term_id:${termId}`;
const termResourceKey = rowResourceKey('wp_terms', termRowId);
const termmetaRowId = 'meta_id:392';
const termmetaResourceKey = rowResourceKey('wp_termmeta', termmetaRowId);
const privateValues = Object.freeze([
  '_rpp_0392_private_missing_term',
  'local-private-rpp-0392-termmeta-value',
  'remote-private-rpp-0392-unrelated-sentinel',
]);

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

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0392 base";',
      'wp-content/uploads/rpp-0392-remote-sentinel.txt': privateValues[2],
    },
    plugins: {},
    db: {
      wp_terms: {},
      wp_termmeta: {},
    },
  };
}

function unsupportedTargetFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_termmeta[termmetaRowId] = {
    meta_id: 392,
    term_id: termId,
    meta_key: privateValues[0],
    meta_value: privateValues[1],
  };

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertHashOnlyChangeEvidence(entry, label) {
  for (const hash of [
    entry.baseHash,
    entry.localHash,
    entry.remoteHash,
    entry.change?.base?.hash,
    entry.change?.local?.hash,
    entry.change?.remote?.hash,
  ]) {
    assert.match(hash, sha256HexPattern, `${label} carried a non-sha256 hash`);
  }
  for (const side of ['base', 'local', 'remote']) {
    assert.equal(
      Object.hasOwn(entry.change?.[side] || {}, 'value'),
      false,
      `${label} exposed a raw ${side} value`,
    );
  }
}

function assertHashOnlyTargetEvidence(reference, label) {
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
    reference.targetChange?.base?.hash,
    reference.targetChange?.local?.hash,
    reference.targetChange?.remote?.hash,
  ]) {
    assert.match(hash, sha256HexPattern, `${label} carried a non-sha256 target hash`);
  }
  for (const side of ['base', 'local', 'remote']) {
    assert.equal(
      Object.hasOwn(reference.targetChange?.[side] || {}, 'value'),
      false,
      `${label} exposed a raw ${side} target value`,
    );
  }
}

function assertNoRawValues(value, label) {
  const serialized = JSON.stringify(value);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
  assert.equal(serialized.includes('meta_value'), false, `${label} leaked a raw meta_value field name`);
  assert.equal(serialized.includes('metaValue'), false, `${label} leaked a raw metaValue field name`);
  assert.equal(serialized.includes('meta_key'), false, `${label} leaked a raw meta_key field name`);
}

function summarizeRpp0392ReleaseVerifierProof() {
  const fixture = unsupportedTargetFixture();
  const plan = planFor(fixture);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey) || null;
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'termmeta-term') || null;
  const remoteBefore = cloneJson(fixture.remote);
  const remoteHashBefore = sha256Evidence(remoteBefore);
  const termmetaHashBefore = sha256Evidence(resourceHash(remoteBefore, rowResource('wp_termmeta', termmetaRowId)));
  const targetHashBefore = sha256Evidence(resourceHash(remoteBefore, rowResource('wp_terms', termRowId)));
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteHashAfter = sha256Evidence(remoteBefore);
  const termmetaHashAfter = sha256Evidence(resourceHash(remoteBefore, rowResource('wp_termmeta', termmetaRowId)));
  const targetHashAfter = sha256Evidence(resourceHash(remoteBefore, rowResource('wp_terms', termRowId)));

  assert.ok(blocker, 'missing termmeta graph blocker');
  assert.ok(reference, 'missing termmeta-term reference evidence');
  assert.ok(error instanceof PushPlanError, 'blocked plan should throw a PushPlanError');
  assert.equal(error.code, 'PLAN_NOT_READY');

  const planEvidence = {
    status: plan.status,
    summary: plan.summary,
    planHash: sha256Evidence(plan),
    target: {
      resourceKey: termResourceKey,
      table: 'wp_terms',
      rowId: termRowId,
      state: {
        base: reference.targetChange.base.state,
        local: reference.targetChange.local.state,
        remote: reference.targetChange.remote.state,
      },
      hashes: {
        base: reference.targetBaseHash,
        local: reference.targetLocalHash,
        remote: reference.targetRemoteHash,
      },
      unsupportedTarget: reference.targetChange.remote.state === 'absent',
    },
    termmeta: {
      resourceKey: termmetaResourceKey,
      table: 'wp_termmeta',
      rowId: termmetaRowId,
      mutationPresent: plan.mutations.some((mutation) => mutation.resourceKey === termmetaResourceKey),
      preconditionPresent: plan.preconditions.some((precondition) => precondition.resourceKey === termmetaResourceKey),
      localChange: blocker.change.localChange,
      remoteChange: blocker.change.remoteChange,
      hashes: {
        base: blocker.baseHash,
        local: blocker.localHash,
        remote: blocker.remoteHash,
      },
    },
    blocker: {
      id: blocker.id,
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      resolutionPolicy: blocker.resolutionPolicy,
      reasonHash: sha256Evidence(blocker.reason),
      blockerHash: sha256Evidence(blocker),
      relationshipKeys: blocker.references.map((entry) => entry.relationshipKey).sort(),
      relationshipTypes: blocker.references.map((entry) => entry.relationshipType).sort(),
    },
    reference: {
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      sourceResourceKey: reference.sourceResourceKey,
      targetResourceKey: reference.targetResourceKey,
      targetChange: {
        localChange: reference.targetChange.localChange,
        remoteChange: reference.targetChange.remoteChange,
      },
      targetStates: {
        base: reference.targetChange.base.state,
        local: reference.targetChange.local.state,
        remote: reference.targetChange.remote.state,
      },
      targetEvidenceHash: sha256Evidence(reference),
    },
  };

  const applyRefusal = {
    code: error.code,
    detailsHash: sha256Evidence(error.details || null),
    beforeMutation: beforeMutationCalls === 0,
    beforeMutationCalls,
    remoteHashBefore,
    remoteHashAfter,
    termmetaHashBefore,
    termmetaHashAfter,
    targetHashBefore,
    targetHashAfter,
    remoteDataPreserved: remoteHashAfter === remoteHashBefore
      && termmetaHashAfter === termmetaHashBefore
      && targetHashAfter === targetHashBefore,
  };

  const proof = {
    rpp: 'RPP-0392',
    evidenceSource: 'termmeta-term-reference-release-verifier-v5',
    status: 'support_only',
    verdict: 'TERMMETA_TERM_REFERENCE_UNSUPPORTED_TARGET_HASH_ONLY_FAIL_CLOSED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    evidenceScope: 'local-release-verifier-model',
    releaseVerifier: {
      checkedBy: 'test/rpp-0392-termmeta-term-reference-release-verifier-v5.test.js',
      check: 'termmeta-term-reference-unsupported-target',
      variant: 'v5',
      serializedPlanEvidence: 'hash-only',
      unsupportedTargetFailsClosed: true,
    },
    resource: {
      termmetaResourceKey,
      termResourceKey,
      sourceTable: 'wp_termmeta',
      targetTable: 'wp_terms',
      relationshipKey: 'wp_termmeta.term_id',
      relationshipType: 'termmeta-term',
    },
    plan: planEvidence,
    applyRefusal,
    redaction: {
      format: 'hash-only',
      surfaces: [
        'termmeta-term-reference-plan-evidence',
        'graph-identity-blocker',
        'apply-refusal-details',
      ],
      rawValuesIncluded: false,
      checkedFixtureCount: privateValues.length,
      serializedPlanEvidenceHash: sha256Evidence(planEvidence),
    },
  };
  proof.proofHash = sha256Evidence({
    resource: proof.resource,
    plan: proof.plan,
    applyRefusal: proof.applyRefusal,
    redaction: proof.redaction,
  });

  return { proof, plan, blocker, reference, error };
}

test('RPP-0392 release verifier fails closed for unsupported termmeta term targets with hash-only evidence', () => {
  const first = summarizeRpp0392ReleaseVerifierProof();
  const replay = summarizeRpp0392ReleaseVerifierProof();
  const { proof, plan, blocker, reference, error } = first;

  assert.deepEqual(proof, replay.proof, 'RPP-0392 release verifier evidence must be deterministic');
  assert.equal(proof.rpp, 'RPP-0392');
  assert.equal(proof.verdict, 'TERMMETA_TERM_REFERENCE_UNSUPPORTED_TARGET_HASH_ONLY_FAIL_CLOSED');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseVerifier.serializedPlanEvidence, 'hash-only');
  assert.equal(proof.releaseVerifier.unsupportedTargetFailsClosed, true);
  assert.match(proof.proofHash, sha256EvidencePattern);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(plan.mutations, []);
  assert.deepEqual(plan.preconditions, []);
  assert.deepEqual(plan.decisions, []);

  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, termmetaResourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(blocker, 'RPP-0392 termmeta blocker');

  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.sourceResourceKey, termmetaResourceKey);
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.deepEqual(reference.targetChange.base, {
    state: 'absent',
    hash: reference.targetBaseHash,
  });
  assert.deepEqual(reference.targetChange.local, {
    state: 'absent',
    hash: reference.targetLocalHash,
  });
  assert.deepEqual(reference.targetChange.remote, {
    state: 'absent',
    hash: reference.targetRemoteHash,
  });
  assert.equal(proof.plan.target.unsupportedTarget, true);
  assert.equal(proof.plan.termmeta.mutationPresent, false);
  assert.equal(proof.plan.termmeta.preconditionPresent, false);
  assert.deepEqual(proof.plan.blocker.relationshipKeys, ['wp_termmeta.term_id']);
  assert.deepEqual(proof.plan.blocker.relationshipTypes, ['termmeta-term']);
  assert.match(proof.plan.blocker.blockerHash, sha256EvidencePattern);
  assert.match(proof.plan.reference.targetEvidenceHash, sha256EvidencePattern);
  assertHashOnlyTargetEvidence(reference, 'RPP-0392 term target reference');

  assert.ok(error instanceof PushPlanError);
  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeMutation, true);
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.equal(proof.applyRefusal.termmetaHashAfter, proof.applyRefusal.termmetaHashBefore);
  assert.equal(proof.applyRefusal.targetHashAfter, proof.applyRefusal.targetHashBefore);
  assert.equal(proof.applyRefusal.remoteDataPreserved, true);
  assert.match(proof.applyRefusal.detailsHash, sha256EvidencePattern);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, privateValues.length);
  assert.match(proof.redaction.serializedPlanEvidenceHash, sha256EvidencePattern);

  assertNoRawValues(plan, 'RPP-0392 plan');
  assertNoRawValues(blocker, 'RPP-0392 blocker');
  assertNoRawValues(reference, 'RPP-0392 term reference');
  assertNoRawValues(proof, 'RPP-0392 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0392 termmeta term release verifier proof' }));
});
