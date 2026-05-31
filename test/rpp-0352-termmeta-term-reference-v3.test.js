import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues, EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0352-termmeta-term-reference-v3.md',
);

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

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
      'index.php': '<?php echo "rpp-0352 base";',
    },
    plugins: {},
    db: {
      wp_terms: {},
      wp_termmeta: {},
    },
  };
}

function termRow(id, marker) {
  return {
    term_id: id,
    name: `RPP-0352 private term ${marker}`,
    slug: `rpp-0352-private-term-${marker}`,
    term_group: 0,
  };
}

function termmetaRow(metaId, termId, marker) {
  return {
    meta_id: metaId,
    term_id: termId,
    meta_key: `_rpp_0352_private_termmeta_${marker}`,
    meta_value: `rpp-0352-private-termmeta-value-${marker}`,
  };
}

function addWordPressGraphIdentityMapRow(site, entry) {
  site.meta ||= {};
  site.meta.wordpressGraphIdentityMap ||= {};
  site.meta.wordpressGraphIdentityMap.rows ||= [];
  site.meta.wordpressGraphIdentityMap.rows.push(entry);
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function supportFixtures() {
  return [
    samePlanTermReferenceFixture(),
    stableTermReferenceFixture(),
    mappedTermReferenceFixture(),
  ];
}

function unsupportedTargetFixtures() {
  return [
    missingTermTargetFixture(),
    staleTermTargetFixture(),
    remoteOnlyUnmappedTermTargetFixture(),
  ];
}

function samePlanTermReferenceFixture() {
  const termId = 352101;
  const metaId = 352102;
  const termRowId = `term_id:${termId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const term = termRow(termId, 'same-plan');
  const termmeta = termmetaRow(metaId, termId, 'same-plan');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_terms[termRowId] = term;
  local.db.wp_termmeta[termmetaRowId] = termmeta;

  return fixtureShape({
    variant: 'ready-same-plan-term-create',
    base,
    local,
    remote,
    termRowId,
    targetTermRowId: termRowId,
    termmetaRowId,
    sourceTermId: termId,
    targetTermId: termId,
    expectedStatus: 'ready',
    expectedMutationCount: 2,
    expectedTermmetaRewrite: false,
    privateValues: [
      term.name,
      term.slug,
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function stableTermReferenceFixture() {
  const termId = 352201;
  const metaId = 352202;
  const termRowId = `term_id:${termId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const term = termRow(termId, 'stable');
  const termmeta = termmetaRow(metaId, termId, 'stable');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  base.db.wp_terms[termRowId] = term;
  local.db.wp_terms[termRowId] = term;
  remote.db.wp_terms[termRowId] = term;
  local.db.wp_termmeta[termmetaRowId] = termmeta;

  return fixtureShape({
    variant: 'ready-stable-term-reference',
    base,
    local,
    remote,
    termRowId,
    targetTermRowId: termRowId,
    termmetaRowId,
    sourceTermId: termId,
    targetTermId: termId,
    expectedStatus: 'ready',
    expectedMutationCount: 1,
    expectedTermmetaRewrite: false,
    privateValues: [
      term.name,
      term.slug,
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function mappedTermReferenceFixture() {
  const sourceTermId = 352301;
  const targetTermId = 352302;
  const metaId = 352303;
  const sourceTermRowId = `term_id:${sourceTermId}`;
  const targetTermRowId = `term_id:${targetTermId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const sourceTerm = termRow(sourceTermId, 'mapped');
  const targetTerm = {
    ...sourceTerm,
    term_id: targetTermId,
  };
  const termmeta = termmetaRow(metaId, sourceTermId, 'mapped');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_terms[sourceTermRowId] = sourceTerm;
  remote.db.wp_terms[targetTermRowId] = targetTerm;
  local.db.wp_termmeta[termmetaRowId] = termmeta;
  addWordPressGraphIdentityMapRow(local, {
    table: 'wp_terms',
    localId: sourceTermRowId,
    remoteId: targetTermRowId,
  });

  return fixtureShape({
    variant: 'ready-identity-map-term-reference',
    base,
    local,
    remote,
    termRowId: sourceTermRowId,
    targetTermRowId,
    termmetaRowId,
    sourceTermId,
    targetTermId,
    expectedStatus: 'ready',
    expectedMutationCount: 1,
    expectedTermmetaRewrite: true,
    privateValues: [
      sourceTerm.name,
      sourceTerm.slug,
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function missingTermTargetFixture() {
  const missingTermId = 352401;
  const metaId = 352402;
  const termRowId = `term_id:${missingTermId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const termmeta = termmetaRow(metaId, missingTermId, 'missing');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_termmeta[termmetaRowId] = termmeta;

  return fixtureShape({
    variant: 'missing-term-target-fail-closed',
    base,
    local,
    remote,
    termRowId,
    targetTermRowId: termRowId,
    termmetaRowId,
    sourceTermId: missingTermId,
    targetTermId: missingTermId,
    expectedStatus: 'blocked',
    expectedTargetRemoteChange: 'unchanged',
    expectedTargetStates: {
      base: 'absent',
      local: 'absent',
      remote: 'absent',
    },
    privateValues: [
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function staleTermTargetFixture() {
  const termId = 352501;
  const metaId = 352502;
  const termRowId = `term_id:${termId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const term = termRow(termId, 'stale');
  const remoteTerm = {
    ...term,
    name: 'RPP-0352 private remote stale term',
    slug: 'rpp-0352-private-remote-stale-term',
  };
  const termmeta = termmetaRow(metaId, termId, 'stale');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  base.db.wp_terms[termRowId] = term;
  local.db.wp_terms[termRowId] = term;
  remote.db.wp_terms[termRowId] = remoteTerm;
  local.db.wp_termmeta[termmetaRowId] = termmeta;

  return fixtureShape({
    variant: 'stale-term-target-fail-closed',
    base,
    local,
    remote,
    termRowId,
    targetTermRowId: termRowId,
    termmetaRowId,
    sourceTermId: termId,
    targetTermId: termId,
    expectedStatus: 'blocked',
    expectedTargetRemoteChange: 'update',
    expectedTargetStates: {
      base: 'present',
      local: 'present',
      remote: 'present',
    },
    privateValues: [
      term.name,
      term.slug,
      remoteTerm.name,
      remoteTerm.slug,
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function remoteOnlyUnmappedTermTargetFixture() {
  const termId = 352601;
  const metaId = 352602;
  const termRowId = `term_id:${termId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const remoteTerm = termRow(termId, 'remote-only');
  const termmeta = termmetaRow(metaId, termId, 'remote-only');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  remote.db.wp_terms[termRowId] = remoteTerm;
  local.db.wp_termmeta[termmetaRowId] = termmeta;

  return fixtureShape({
    variant: 'remote-only-unmapped-term-target-fail-closed',
    base,
    local,
    remote,
    termRowId,
    targetTermRowId: termRowId,
    termmetaRowId,
    sourceTermId: termId,
    targetTermId: termId,
    expectedStatus: 'blocked',
    expectedTargetRemoteChange: 'create',
    expectedTargetStates: {
      base: 'absent',
      local: 'absent',
      remote: 'present',
    },
    privateValues: [
      remoteTerm.name,
      remoteTerm.slug,
      termmeta.meta_key,
      termmeta.meta_value,
    ],
  });
}

function fixtureShape({
  variant,
  base,
  local,
  remote,
  termRowId,
  targetTermRowId,
  termmetaRowId,
  sourceTermId,
  targetTermId,
  expectedStatus,
  expectedMutationCount = 0,
  expectedTermmetaRewrite = false,
  expectedTargetRemoteChange = null,
  expectedTargetStates = null,
  privateValues,
}) {
  return {
    variant,
    base,
    local,
    remote,
    termRowId,
    targetTermRowId,
    termmetaRowId,
    sourceTermId,
    targetTermId,
    termResource: rowResource('wp_terms', termRowId),
    targetTermResource: rowResource('wp_terms', targetTermRowId),
    termmetaResource: rowResource('wp_termmeta', termmetaRowId),
    termResourceKey: rowResourceKey('wp_terms', termRowId),
    targetTermResourceKey: rowResourceKey('wp_terms', targetTermRowId),
    termmetaResourceKey: rowResourceKey('wp_termmeta', termmetaRowId),
    expectedStatus,
    expectedMutationCount,
    expectedTermmetaRewrite,
    expectedTargetRemoteChange,
    expectedTargetStates,
    privateValues,
  };
}

function generatedRpp0352TermmetaTermReferenceVariant3Proof() {
  const supportCases = supportFixtures().map((fixture) =>
    supportCaseEvidence(fixture));
  const failClosedCases = unsupportedTargetFixtures().map((fixture) =>
    failClosedCaseEvidence(fixture));
  const proof = {
    rpp: 'RPP-0352',
    evidenceSource: 'termmeta-term-reference-v3',
    status: 'support_only',
    releaseGate: 'NO-GO',
    productionBacked: false,
    evidenceScope: 'local-generated-support-only',
    variant: 3,
    relationship: {
      relationshipKey: 'wp_termmeta.term_id',
      relationshipType: 'termmeta-term',
      sourceTable: 'wp_termmeta',
      targetTable: 'wp_terms',
    },
    coverage: {
      supportCaseCount: supportCases.length,
      unsupportedTargetCaseCount: failClosedCases.length,
      variants: [
        ...supportCases.map((entry) => entry.variant),
        ...failClosedCases.map((entry) => entry.variant),
      ],
      statuses: statusCounts([...supportCases, ...failClosedCases]),
    },
    supportCases,
    failClosedCases,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      supportOnly: true,
      finalRelease: 'NO-GO',
      checkedFixtureCount: supportCases.length + failClosedCases.length,
    },
  };
  proof.proofHash = sha256Evidence({
    relationship: proof.relationship,
    coverage: proof.coverage,
    supportCases,
    failClosedCases,
    redaction: proof.redaction,
  });

  return proof;
}

function supportCaseEvidence(fixture) {
  const plan = planFor(fixture);
  const beforeMutationCalls = { count: 0 };
  const applied = applyPlan(cloneJson(fixture.remote), plan, {
    beforeMutation() {
      beforeMutationCalls.count += 1;
    },
  });
  const termmetaMutation = mutationFor(plan, fixture.termmetaResourceKey);
  const termMutation = mutationFor(plan, fixture.termResourceKey);
  const termmetaPrecondition = preconditionFor(plan, fixture.termmetaResourceKey);
  const plannedTermmeta = deserializeResourceValue(termmetaMutation.value);
  const rewrite = termmetaMutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'termmeta-term') || null;

  assert.equal(plan.status, 'ready', `${fixture.variant} should plan as ready`);
  assert.equal(plan.summary.mutations, fixture.expectedMutationCount);
  assert.equal(plan.summary.blockers, 0);
  assert.deepEqual(plan.blockers, []);
  assert.ok(termmetaMutation, `${fixture.variant} should plan the termmeta mutation`);
  assert.ok(termmetaPrecondition, `${fixture.variant} should precondition the termmeta mutation`);
  assert.equal(termmetaPrecondition.mutationId, termmetaMutation.id);
  assert.equal(termmetaPrecondition.checkedAgainst, 'live-remote');
  assert.equal(termmetaPrecondition.expectedHash, termmetaMutation.remoteBeforeHash);
  assert.equal(plannedTermmeta.term_id, fixture.targetTermId);
  assert.equal(beforeMutationCalls.count, plan.mutations.length);
  assert.equal(applied.appliedMutations, plan.mutations.length);
  assert.equal(
    resourceHash(applied.site, fixture.termmetaResource),
    termmetaMutation.localHash,
    `${fixture.variant} did not apply the planned termmeta hash`,
  );
  assert.equal(
    applied.site.db.wp_termmeta[fixture.termmetaRowId].term_id,
    fixture.targetTermId,
    `${fixture.variant} did not carry the expected term target id`,
  );

  if (fixture.variant === 'ready-same-plan-term-create') {
    assert.ok(termMutation, 'same-plan support should create the target term');
    assert.equal(termMutation.changeKind, 'create');
  } else {
    assert.equal(termMutation, undefined, `${fixture.variant} should not mutate the target term`);
  }

  if (fixture.expectedTermmetaRewrite) {
    const sourceDecision = decisionFor(plan, fixture.termResourceKey);
    const targetDecision = decisionFor(plan, fixture.targetTermResourceKey);

    assert.ok(rewrite, 'mapped termmeta support should carry rewrite evidence');
    assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
    assert.equal(sourceDecision.targetResourceKey, fixture.targetTermResourceKey);
    assert.equal(targetDecision.decision, 'keep-remote');
    assert.equal(rewrite.relationshipKey, 'wp_termmeta.term_id');
    assert.equal(rewrite.field, 'term_id');
    assert.equal(rewrite.sourceResourceKey, fixture.termmetaResourceKey);
    assert.equal(rewrite.rewrittenResourceKey, fixture.termmetaResourceKey);
    assert.equal(rewrite.sourceTargetResourceKey, fixture.termResourceKey);
    assert.equal(rewrite.targetResourceKey, fixture.targetTermResourceKey);
    assert.match(rewrite.sourceTargetLocalHash, hashPattern);
    assert.match(rewrite.targetRemoteHash, hashPattern);
    assert.equal(applied.site.db.wp_terms[fixture.termRowId], undefined);
    assert.equal(applied.site.db.wp_terms[fixture.targetTermRowId].term_id, fixture.targetTermId);
  } else {
    assert.equal(rewrite, null, `${fixture.variant} should not rewrite the term reference`);
  }

  const evidence = {
    variant: fixture.variant,
    status: plan.status,
    planSummary: plan.summary,
    termmeta: {
      resourceKey: fixture.termmetaResourceKey,
      baseHash: resourceHash(fixture.base, fixture.termmetaResource),
      localHash: resourceHash(fixture.local, fixture.termmetaResource),
      remoteHash: resourceHash(fixture.remote, fixture.termmetaResource),
      plannedLocalHash: termmetaMutation.localHash,
      appliedHash: resourceHash(applied.site, fixture.termmetaResource),
      plannedMutation: true,
      plannedPrecondition: true,
      plannedTermIdHash: sha256Evidence(String(plannedTermmeta.term_id)),
    },
    targetTerm: {
      sourceResourceKey: fixture.termResourceKey,
      targetResourceKey: fixture.targetTermResourceKey,
      baseHash: resourceHash(fixture.base, fixture.targetTermResource),
      localHash: resourceHash(fixture.local, fixture.targetTermResource),
      remoteHash: resourceHash(fixture.remote, fixture.targetTermResource),
      appliedHash: resourceHash(applied.site, fixture.targetTermResource),
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      beforeMutationCalls: beforeMutationCalls.count,
      termmetaHashMatchesPlan: resourceHash(applied.site, fixture.termmetaResource) === termmetaMutation.localHash,
    },
    rewrite: rewrite ? {
      relationshipKey: rewrite.relationshipKey,
      relationshipType: rewrite.relationshipType,
      field: rewrite.field,
      sourceResourceKey: rewrite.sourceResourceKey,
      rewrittenResourceKey: rewrite.rewrittenResourceKey,
      sourceTargetResourceKey: rewrite.sourceTargetResourceKey,
      targetResourceKey: rewrite.targetResourceKey,
      identityMapSource: rewrite.identityMapSource,
      sourceTargetLocalHash: rewrite.sourceTargetLocalHash,
      targetRemoteHash: rewrite.targetRemoteHash,
      rewriteHash: sha256Evidence(rewrite),
    } : null,
    caseHash: sha256Evidence({
      variant: fixture.variant,
      planSummary: plan.summary,
      termmetaHash: termmetaMutation.localHash,
      targetHash: resourceHash(applied.site, fixture.targetTermResource),
      rewrite,
    }),
  };

  assertHashOnlySupportEvidence(evidence, fixture.privateValues);
  assertRedactedProbe(fixture, {
    plan,
    supportEvidence: evidence,
  });
  return evidence;
}

function failClosedCaseEvidence(fixture) {
  const plan = planFor(fixture);
  const blocker = blockerFor(plan, fixture.termmetaResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'termmeta-term') || null;
  const refusal = refusalEvidence(fixture, plan);
  const termDecision = decisionFor(plan, fixture.targetTermResourceKey);

  assert.equal(plan.status, 'blocked', `${fixture.variant} should plan as blocked`);
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: termDecision ? 1 : 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(plan.mutations, []);
  assert.deepEqual(plan.preconditions, []);
  assert.ok(blocker, `${fixture.variant} should emit a termmeta graph blocker`);
  assert.ok(reference, `${fixture.variant} should include termmeta term target evidence`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.sourceResourceKey, fixture.termmetaResourceKey);
  assert.equal(reference.targetResourceKey, fixture.targetTermResourceKey);
  assert.equal(reference.targetTable, 'wp_terms');
  assert.equal(reference.targetChange.remoteChange, fixture.expectedTargetRemoteChange);
  assert.deepEqual({
    base: reference.targetChange.base.state,
    local: reference.targetChange.local.state,
    remote: reference.targetChange.remote.state,
  }, fixture.expectedTargetStates);
  assertHashOnlyChangeEvidence(blocker, `${fixture.variant} blocker`);
  assertHashOnlyTargetEvidence(reference, `${fixture.variant} target`);
  if (termDecision) {
    assert.equal(termDecision.decision, 'keep-remote');
  }

  const evidence = {
    variant: fixture.variant,
    status: plan.status,
    planSummary: plan.summary,
    termmeta: {
      resourceKey: fixture.termmetaResourceKey,
      plannedMutation: false,
      plannedPrecondition: false,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      localChange: blocker.change.localChange,
      remoteChange: blocker.change.remoteChange,
    },
    blocker: {
      resourceKey: blocker.resourceKey,
      class: blocker.class,
      resolutionPolicy: blocker.resolutionPolicy,
      blockerHash: sha256Evidence(blocker),
      reasonHash: sha256Evidence(blocker.reason),
    },
    reference: {
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      sourceResourceKey: reference.sourceResourceKey,
      targetResourceKey: reference.targetResourceKey,
      targetTable: reference.targetTable,
      targetStates: {
        base: reference.targetChange.base.state,
        local: reference.targetChange.local.state,
        remote: reference.targetChange.remote.state,
      },
      targetChange: {
        localChange: reference.targetChange.localChange,
        remoteChange: reference.targetChange.remoteChange,
      },
      targetHashes: {
        base: reference.targetBaseHash,
        local: reference.targetLocalHash,
        remote: reference.targetRemoteHash,
      },
      referenceHash: sha256Evidence(reference),
    },
    targetDecision: termDecision ? {
      resourceKey: termDecision.resourceKey,
      decision: termDecision.decision,
      decisionHash: sha256Evidence(termDecision),
    } : null,
    refusal,
    caseHash: sha256Evidence({
      variant: fixture.variant,
      planSummary: plan.summary,
      blockerHash: sha256Evidence(blocker),
      referenceHash: sha256Evidence(reference),
      refusal,
    }),
  };

  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(refusal.beforeMutationCalls, 0);
  assert.equal(refusal.remoteHashBefore, refusal.remoteHashAfter);
  assert.equal(refusal.termmetaHashBefore, refusal.termmetaHashAfter);
  assert.equal(refusal.targetHashBefore, refusal.targetHashAfter);
  assert.equal(refusal.remoteDataPreserved, true);
  assertHashOnlyFailClosedEvidence(evidence, fixture.privateValues);
  assertRedactedProbe(fixture, {
    plan,
    blocker,
    reference,
    failClosedEvidence: evidence,
  });
  return evidence;
}

function refusalEvidence(fixture, plan) {
  const remoteBefore = cloneJson(fixture.remote);
  const remoteHashBefore = sha256Evidence(remoteBefore);
  const termmetaHashBefore = sha256Evidence(resourceHash(remoteBefore, fixture.termmetaResource));
  const targetHashBefore = sha256Evidence(resourceHash(remoteBefore, fixture.targetTermResource));
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteHashAfter = sha256Evidence(remoteBefore);
  const termmetaHashAfter = sha256Evidence(resourceHash(remoteBefore, fixture.termmetaResource));
  const targetHashAfter = sha256Evidence(resourceHash(remoteBefore, fixture.targetTermResource));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');

  return {
    code: error.code,
    detailsHash: sha256Evidence(error.details || null),
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteHashBefore,
    remoteHashAfter,
    termmetaHashBefore,
    termmetaHashAfter,
    targetHashBefore,
    targetHashAfter,
    remoteDataPreserved: remoteHashBefore === remoteHashAfter
      && termmetaHashBefore === termmetaHashAfter
      && targetHashBefore === targetHashAfter,
  };
}

function statusCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, {});
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
    assert.match(hash, hashPattern, `${label} carried a non-sha256 hash`);
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
    assert.match(hash, hashPattern, `${label} carried a non-sha256 target hash`);
  }
  for (const side of ['base', 'local', 'remote']) {
    assert.equal(
      Object.hasOwn(reference.targetChange?.[side] || {}, 'value'),
      false,
      `${label} exposed a raw ${side} target value`,
    );
  }
}

function assertHashOnlySupportEvidence(evidence, privateValues) {
  assert.match(evidence.caseHash, sha256EvidencePattern);
  assert.match(evidence.termmeta.baseHash, hashPattern);
  assert.match(evidence.termmeta.localHash, hashPattern);
  assert.match(evidence.termmeta.remoteHash, hashPattern);
  assert.match(evidence.termmeta.plannedLocalHash, hashPattern);
  assert.match(evidence.termmeta.appliedHash, hashPattern);
  assert.match(evidence.termmeta.plannedTermIdHash, sha256EvidencePattern);
  assert.match(evidence.targetTerm.baseHash, hashPattern);
  assert.match(evidence.targetTerm.localHash, hashPattern);
  assert.match(evidence.targetTerm.remoteHash, hashPattern);
  assert.match(evidence.targetTerm.appliedHash, hashPattern);
  if (evidence.rewrite) {
    assert.match(evidence.rewrite.sourceTargetLocalHash, hashPattern);
    assert.match(evidence.rewrite.targetRemoteHash, hashPattern);
    assert.match(evidence.rewrite.rewriteHash, sha256EvidencePattern);
  }
  assertNoRawValues(evidence, privateValues, `${evidence.variant} support evidence`);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: `${evidence.variant} support evidence` }));
}

function assertHashOnlyFailClosedEvidence(evidence, privateValues) {
  assert.match(evidence.caseHash, sha256EvidencePattern);
  assert.match(evidence.termmeta.baseHash, hashPattern);
  assert.match(evidence.termmeta.localHash, hashPattern);
  assert.match(evidence.termmeta.remoteHash, hashPattern);
  assert.match(evidence.blocker.blockerHash, sha256EvidencePattern);
  assert.match(evidence.blocker.reasonHash, sha256EvidencePattern);
  assert.match(evidence.reference.referenceHash, sha256EvidencePattern);
  for (const hash of Object.values(evidence.reference.targetHashes)) {
    assert.match(hash, hashPattern);
  }
  for (const hash of [
    evidence.refusal.detailsHash,
    evidence.refusal.remoteHashBefore,
    evidence.refusal.remoteHashAfter,
    evidence.refusal.termmetaHashBefore,
    evidence.refusal.termmetaHashAfter,
    evidence.refusal.targetHashBefore,
    evidence.refusal.targetHashAfter,
  ]) {
    assert.match(hash, sha256EvidencePattern);
  }
  if (evidence.targetDecision) {
    assert.match(evidence.targetDecision.decisionHash, sha256EvidencePattern);
  }
  assertNoRawValues(evidence, privateValues, `${evidence.variant} fail-closed evidence`);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: `${evidence.variant} fail-closed evidence` }));
}

function assertNoRawValues(value, privateValues, label) {
  const serialized = JSON.stringify(value);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
  assert.equal(serialized.includes('meta_value'), false, `${label} leaked a raw meta_value field name`);
  assert.equal(serialized.includes('metaValue'), false, `${label} leaked a raw metaValue field name`);
  assert.equal(serialized.includes('meta_key'), false, `${label} leaked a raw meta_key field name`);
  assert.equal(serialized.includes('RPP-0352 private term'), false, `${label} leaked a raw term name`);
  assert.equal(serialized.includes('rpp-0352-private-term-'), false, `${label} leaked a raw term slug`);
  assert.equal(serialized.includes('rpp-0352-private-termmeta-value-'), false, `${label} leaked a raw termmeta value`);
}

function assertRedactedProbe(fixture, evidence) {
  const redacted = redactEvidence({
    rpp: 'RPP-0352',
    variant: fixture.variant,
    evidence,
    rawProbe: {
      value: {
        termmeta: fixture.local.db.wp_termmeta[fixture.termmetaRowId],
        localTerm: fixture.local.db.wp_terms[fixture.termRowId] || null,
        targetTerm: fixture.remote.db.wp_terms[fixture.targetTermRowId] || null,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${fixture.variant} should redact raw probes`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${fixture.variant} should keep redaction hashes`);
  assertNoRawValues(redacted, fixture.privateValues, `${fixture.variant} redacted probe`);
}

test('RPP-0352 termmeta term reference variant 3 emits deterministic support-only proof', () => {
  const firstProof = generatedRpp0352TermmetaTermReferenceVariant3Proof();
  const replayProof = generatedRpp0352TermmetaTermReferenceVariant3Proof();

  assert.deepEqual(firstProof, replayProof, 'RPP-0352 proof must be deterministic');
  assert.equal(firstProof.rpp, 'RPP-0352');
  assert.equal(firstProof.status, 'support_only');
  assert.equal(firstProof.releaseGate, 'NO-GO');
  assert.equal(firstProof.productionBacked, false);
  assert.equal(firstProof.variant, 3);
  assert.equal(firstProof.relationship.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(firstProof.relationship.relationshipType, 'termmeta-term');
  assert.deepEqual(firstProof.coverage.statuses, {
    blocked: 3,
    ready: 3,
  });
  assert.deepEqual(firstProof.coverage.variants, [
    'ready-same-plan-term-create',
    'ready-stable-term-reference',
    'ready-identity-map-term-reference',
    'missing-term-target-fail-closed',
    'stale-term-target-fail-closed',
    'remote-only-unmapped-term-target-fail-closed',
  ]);
  assert.match(firstProof.proofHash, sha256EvidencePattern);
  assert.equal(firstProof.redaction.format, 'hash-only');
  assert.equal(firstProof.redaction.rawValuesIncluded, false);
  assert.equal(firstProof.redaction.supportOnly, true);
  assert.equal(firstProof.redaction.finalRelease, 'NO-GO');

  const [samePlanCase, stableCase, mappedCase] = firstProof.supportCases;
  assert.equal(samePlanCase.status, 'ready');
  assert.equal(samePlanCase.planSummary.mutations, 2);
  assert.equal(samePlanCase.apply.beforeMutationCalls, 2);
  assert.equal(samePlanCase.termmeta.plannedMutation, true);
  assert.equal(samePlanCase.termmeta.plannedPrecondition, true);
  assert.equal(samePlanCase.rewrite, null);

  assert.equal(stableCase.status, 'ready');
  assert.equal(stableCase.planSummary.mutations, 1);
  assert.equal(stableCase.apply.beforeMutationCalls, 1);
  assert.equal(stableCase.termmeta.plannedMutation, true);
  assert.equal(stableCase.termmeta.plannedPrecondition, true);
  assert.equal(stableCase.rewrite, null);

  assert.equal(mappedCase.status, 'ready');
  assert.equal(mappedCase.planSummary.mutations, 1);
  assert.equal(mappedCase.planSummary.decisions, 2);
  assert.equal(mappedCase.rewrite.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(mappedCase.rewrite.relationshipType, 'termmeta-term');
  assert.equal(mappedCase.rewrite.field, 'term_id');
  assert.match(mappedCase.rewrite.rewriteHash, sha256EvidencePattern);

  assertNoRawValues(firstProof, [
    ...supportFixtures().flatMap((fixture) => fixture.privateValues),
    ...unsupportedTargetFixtures().flatMap((fixture) => fixture.privateValues),
  ], 'RPP-0352 full proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0352 termmeta term reference v3 proof' }));
});

test('RPP-0352 unsupported termmeta term targets fail closed before mutation with hash-only evidence', () => {
  const proof = generatedRpp0352TermmetaTermReferenceVariant3Proof();

  assert.equal(proof.failClosedCases.length, 3);
  for (const evidence of proof.failClosedCases) {
    assert.equal(evidence.status, 'blocked');
    assert.equal(evidence.planSummary.mutations, 0);
    assert.equal(evidence.planSummary.conflicts, 0);
    assert.equal(evidence.planSummary.blockers, 1);
    assert.equal(evidence.termmeta.plannedMutation, false);
    assert.equal(evidence.termmeta.plannedPrecondition, false);
    assert.equal(evidence.blocker.class, 'stale-wordpress-graph-identity');
    assert.equal(evidence.blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
    assert.equal(evidence.reference.relationshipKey, 'wp_termmeta.term_id');
    assert.equal(evidence.reference.relationshipType, 'termmeta-term');
    assert.equal(evidence.refusal.code, 'PLAN_NOT_READY');
    assert.equal(evidence.refusal.beforeMutationCalls, 0);
    assert.equal(evidence.refusal.preMutationRefusal, true);
    assert.equal(evidence.refusal.remoteHashAfter, evidence.refusal.remoteHashBefore);
    assert.equal(evidence.refusal.termmetaHashAfter, evidence.refusal.termmetaHashBefore);
    assert.equal(evidence.refusal.targetHashAfter, evidence.refusal.targetHashBefore);
    assert.equal(evidence.refusal.remoteDataPreserved, true);
    assert.match(evidence.caseHash, sha256EvidencePattern);
  }

  assert.deepEqual(
    proof.failClosedCases.map((entry) => entry.reference.targetStates),
    [
      { base: 'absent', local: 'absent', remote: 'absent' },
      { base: 'present', local: 'present', remote: 'present' },
      { base: 'absent', local: 'absent', remote: 'present' },
    ],
  );
  assert.deepEqual(
    proof.failClosedCases.map((entry) => entry.reference.targetChange.remoteChange),
    ['unchanged', 'update', 'create'],
  );
});

test('RPP-0352 evidence document labels support-only hash-only NO-GO posture', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0352 termmeta term reference v3 evidence$/m);
  assert.match(evidenceDoc, /support-only local proof/i);
  assert.match(evidenceDoc, /hash-only/i);
  assert.match(evidenceDoc, /Final release posture: `NO-GO`/);
  assert.doesNotMatch(evidenceDoc, /docs\/reprint-push-completion-checklist\.md/);
  assert.doesNotMatch(evidenceDoc, /docs\/progress-log\.md/);
  assert.doesNotMatch(evidenceDoc, /progress\.html/);
});
