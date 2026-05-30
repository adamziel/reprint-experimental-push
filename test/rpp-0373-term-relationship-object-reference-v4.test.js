import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const prefixedHashPattern = /^sha256:[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function fileResource(path) {
  return {
    type: 'file',
    path,
    key: `file:${path}`,
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function makePost(id, marker) {
  return {
    ID: id,
    post_title: `Local Private RPP-0373 ${marker} Object Post`,
    post_name: `local-private-rpp0373-${marker}-object-post`,
    post_content: `local-private-rpp0373-${marker}-object-body`,
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
}

function makeRemoteStalePost(id, marker) {
  return {
    ...makePost(id, marker),
    post_title: `Remote Private RPP-0373 ${marker} Object Post`,
    post_content: `remote-private-rpp0373-${marker}-object-body`,
  };
}

function addTermRelationshipObjectGraph(local, ids, marker) {
  local.db.wp_terms[ids.termRowId] = {
    term_id: ids.termId,
    name: `Local Private RPP-0373 ${marker} Term`,
    slug: `local-private-rpp0373-${marker}-term`,
    term_group: 0,
  };
  local.db.wp_term_taxonomy[ids.taxonomyRowId] = {
    term_taxonomy_id: ids.taxonomyId,
    term_id: ids.termId,
    taxonomy: 'category',
    description: `local-private-rpp0373-${marker}-taxonomy-description`,
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships[ids.relationshipRowId] = {
    object_id: ids.postId,
    term_taxonomy_id: ids.taxonomyId,
    term_order: 0,
  };
}

function buildGeneratedTermRelationshipObjectCase({ variant, postId, termId, taxonomyId, staleObject }) {
  const marker = staleObject ? 'generated-stale' : 'generated-ready';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const ids = {
    postId,
    termId,
    taxonomyId,
    postRowId: `ID:${postId}`,
    termRowId: `term_id:${termId}`,
    taxonomyRowId: `term_taxonomy_id:${taxonomyId}`,
    relationshipRowId: `object_id:${postId}|term_taxonomy_id:${taxonomyId}`,
  };
  const remoteOnlyPath = `wp-content/uploads/rpp-0373-${variant}-remote-only.txt`;

  remote.files[remoteOnlyPath] = `Remote Private RPP-0373 ${marker} remote-only note`;

  if (staleObject) {
    base.db.wp_posts[ids.postRowId] = makePost(postId, 'base-stale');
    local.db.wp_posts[ids.postRowId] = cloneJson(base.db.wp_posts[ids.postRowId]);
    remote.db.wp_posts[ids.postRowId] = makeRemoteStalePost(postId, 'stale-live');
  } else {
    local.db.wp_posts[ids.postRowId] = makePost(postId, 'ready');
  }

  addTermRelationshipObjectGraph(local, ids, marker);

  return {
    id: `rpp-0373-term-relationship-object-reference-v4-${variant}`,
    variant,
    tags: new Set([
      'rpp-0373',
      'term-relationship-object-graph',
      `term-relationship-object-${variant}`,
      staleObject ? 'generated-stale' : 'generated-ready',
    ]),
    base,
    local,
    remote,
    ids,
    resources: {
      post: rowResource('wp_posts', ids.postRowId),
      term: rowResource('wp_terms', ids.termRowId),
      taxonomy: rowResource('wp_term_taxonomy', ids.taxonomyRowId),
      relationship: rowResource('wp_term_relationships', ids.relationshipRowId),
      remoteOnly: fileResource(remoteOnlyPath),
    },
    privateValues: [
      ...privatePostValues(makePost(postId, staleObject ? 'base-stale' : 'ready')),
      ...(staleObject ? privatePostValues(makeRemoteStalePost(postId, 'stale-live')) : []),
      `Local Private RPP-0373 ${marker} Term`,
      `local-private-rpp0373-${marker}-term`,
      `local-private-rpp0373-${marker}-taxonomy-description`,
      remote.files[remoteOnlyPath],
    ],
  };
}

function buildGeneratedTermRelationshipObjectCases() {
  return [
    buildGeneratedTermRelationshipObjectCase({
      variant: 'ready',
      postId: 737301,
      termId: 737311,
      taxonomyId: 737321,
      staleObject: false,
    }),
    buildGeneratedTermRelationshipObjectCase({
      variant: 'stale',
      postId: 737303,
      termId: 737313,
      taxonomyId: 737323,
      staleObject: true,
    }),
  ];
}

function privatePostValues(post) {
  return [post.post_title, post.post_name, post.post_content];
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  }
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} should be a SHA-256 hex hash`);
}

function assertPrefixedHash(value, label) {
  assert.match(value, prefixedHashPattern, `${label} should be a prefixed SHA-256 hash`);
}

function assertNoRawValues(serialized, privateValues, label) {
  for (const privateValue of privateValues.filter(Boolean).map(String)) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertRedactedPayload(testCase, payload, label) {
  const redacted = redactEvidence(payload);
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${label} should contain redaction markers`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${label} should retain hash evidence`);
  assertNoRawValues(serialized, testCase.privateValues, label);

  return {
    redactedHash: `sha256:${digest(redacted)}`,
    markerObserved: true,
  };
}

function surfaceEvidence(testCase) {
  const { resources, ids } = testCase;

  return {
    post: {
      resourceKey: resources.post.key,
      baseHash: resourceHash(testCase.base, resources.post),
      localHash: resourceHash(testCase.local, resources.post),
      remoteHash: resourceHash(testCase.remote, resources.post),
      objectIdHash: `sha256:${digest(String(ids.postId))}`,
    },
    term: {
      resourceKey: resources.term.key,
      baseHash: resourceHash(testCase.base, resources.term),
      localHash: resourceHash(testCase.local, resources.term),
      remoteHash: resourceHash(testCase.remote, resources.term),
      termIdHash: `sha256:${digest(String(ids.termId))}`,
    },
    taxonomy: {
      resourceKey: resources.taxonomy.key,
      baseHash: resourceHash(testCase.base, resources.taxonomy),
      localHash: resourceHash(testCase.local, resources.taxonomy),
      remoteHash: resourceHash(testCase.remote, resources.taxonomy),
      taxonomyIdHash: `sha256:${digest(String(ids.taxonomyId))}`,
    },
    relationship: {
      resourceKey: resources.relationship.key,
      baseHash: resourceHash(testCase.base, resources.relationship),
      localHash: resourceHash(testCase.local, resources.relationship),
      remoteHash: resourceHash(testCase.remote, resources.relationship),
      objectIdHash: `sha256:${digest(String(ids.postId))}`,
      taxonomyIdHash: `sha256:${digest(String(ids.taxonomyId))}`,
    },
    remoteOnly: {
      resourceKey: resources.remoteOnly.key,
      baseHash: resourceHash(testCase.base, resources.remoteOnly),
      localHash: resourceHash(testCase.local, resources.remoteOnly),
      remoteHash: resourceHash(testCase.remote, resources.remoteOnly),
    },
  };
}

function readyCaseEvidence(testCase) {
  const plan = planFor(testCase);
  const postMutation = mutationFor(plan, testCase.resources.post.key);
  const termMutation = mutationFor(plan, testCase.resources.term.key);
  const taxonomyMutation = mutationFor(plan, testCase.resources.taxonomy.key);
  const relationshipMutation = mutationFor(plan, testCase.resources.relationship.key);
  const remoteOnlyDecision = decisionFor(plan, testCase.resources.remoteOnly.key);
  const plannedRelationship = deserializeResourceValue(relationshipMutation?.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.ok(postMutation, 'ready case should create the object_id post target');
  assert.ok(termMutation, 'ready case should create the term row');
  assert.ok(taxonomyMutation, 'ready case should create the term_taxonomy row');
  assert.ok(relationshipMutation, 'ready case should create the term relationship row');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(plannedRelationship.object_id, testCase.ids.postId);
  assert.equal(plannedRelationship.term_taxonomy_id, testCase.ids.taxonomyId);
  assert.equal(relationshipMutation.wordpressGraphIdentity, undefined);
  assert.equal(remoteOnlyDecision?.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const applied = applyPlan(cloneJson(testCase.remote), plan);
  assert.deepEqual(applied.site.db.wp_posts[testCase.ids.postRowId], testCase.local.db.wp_posts[testCase.ids.postRowId]);
  assert.deepEqual(
    applied.site.db.wp_term_relationships[testCase.ids.relationshipRowId],
    testCase.local.db.wp_term_relationships[testCase.ids.relationshipRowId],
  );
  assert.equal(
    resourceHash(applied.site, testCase.resources.remoteOnly),
    resourceHash(testCase.remote, testCase.resources.remoteOnly),
    'ready apply should preserve the unplanned remote-only file',
  );

  const staleReplayRemote = cloneJson(testCase.remote);
  staleReplayRemote.db.wp_posts[testCase.ids.postRowId] = makeRemoteStalePost(
    testCase.ids.postId,
    'ready-replay',
  );
  const staleReplayBeforeHash = digest(staleReplayRemote);
  const staleReplayError = captureError(() => applyPlan(staleReplayRemote, plan));
  const staleReplayAfterHash = digest(staleReplayRemote);

  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.code, 'PRECONDITION_FAILED');
  assert.equal(staleReplayAfterHash, staleReplayBeforeHash, 'stale ready replay must fail before mutation');

  const redaction = assertRedactedPayload(testCase, {
    status: plan.status,
    rawReadyProbe: {
      value: {
        post: testCase.local.db.wp_posts[testCase.ids.postRowId],
        term: testCase.local.db.wp_terms[testCase.ids.termRowId],
        taxonomy: testCase.local.db.wp_term_taxonomy[testCase.ids.taxonomyRowId],
        relationship: testCase.local.db.wp_term_relationships[testCase.ids.relationshipRowId],
      },
    },
    mutations: [postMutation, termMutation, taxonomyMutation, relationshipMutation].map((mutation) => ({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      change: mutation.change,
      value: mutation.value,
    })),
  }, `${testCase.id} ready redacted evidence`);

  const relationshipPrecondition = plan.preconditions.find((entry) =>
    entry.resourceKey === testCase.resources.relationship.key);
  const evidence = {
    id: testCase.id,
    variant: 'generated-ready',
    status: plan.status,
    applied: true,
    planSummary: plan.summary,
    surface: surfaceEvidence(testCase),
    objectReference: {
      relationshipKey: 'wp_term_relationships.object_id',
      relationshipType: 'term-relationship-object',
      sourceResourceKey: testCase.resources.relationship.key,
      targetResourceKey: testCase.resources.post.key,
      targetLocalHash: resourceHash(testCase.local, testCase.resources.post),
      targetRemoteHash: resourceHash(testCase.remote, testCase.resources.post),
      objectIdHash: `sha256:${digest(String(testCase.ids.postId))}`,
      samePlanTargetCreate: true,
    },
    relationshipMutation: {
      resourceKey: relationshipMutation.resourceKey,
      action: relationshipMutation.action,
      changeKind: relationshipMutation.changeKind,
      localHash: resourceHash(testCase.local, testCase.resources.relationship),
      remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      preconditionExpectedHash: relationshipPrecondition.expectedHash,
      appliedHash: resourceHash(applied.site, testCase.resources.relationship),
      mutationHash: `sha256:${digest({
        resourceKey: relationshipMutation.resourceKey,
        action: relationshipMutation.action,
        changeKind: relationshipMutation.changeKind,
        localHash: resourceHash(testCase.local, testCase.resources.relationship),
        remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      })}`,
    },
    remoteOnlyPreservation: {
      resourceKey: testCase.resources.remoteOnly.key,
      remoteBeforeHash: resourceHash(testCase.remote, testCase.resources.remoteOnly),
      appliedHash: resourceHash(applied.site, testCase.resources.remoteOnly),
      preserved: true,
    },
    staleReplay: {
      code: staleReplayError.code,
      resourceKey: staleReplayError.details.resourceKey,
      remoteBeforeHash: staleReplayBeforeHash,
      remoteAfterHash: staleReplayAfterHash,
    },
    redaction,
  };
  evidence.modelProofHash = `sha256:${digest(evidence)}`;

  assertHashOnlyEvidence(evidence, testCase, `${testCase.id} ready hash-only evidence`);
  return evidence;
}

function staleCaseEvidence(testCase) {
  const plan = planFor(testCase);
  const relationshipBlocker = blockerFor(plan, testCase.resources.relationship.key);
  const objectReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-object');
  const remoteOnlyDecision = decisionFor(plan, testCase.resources.remoteOnly.key);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.blockers, 1);
  assert.equal(mutationFor(plan, testCase.resources.relationship.key), undefined);
  assert.ok(mutationFor(plan, testCase.resources.term.key), 'safe term row may be planned but cannot apply');
  assert.ok(mutationFor(plan, testCase.resources.taxonomy.key), 'safe taxonomy row may be planned but cannot apply');
  assert.equal(remoteOnlyDecision?.decision, 'keep-remote');
  assert.ok(relationshipBlocker, 'stale case should block the term relationship row');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.ok(objectReference, 'stale case should include object_id reference evidence');
  assert.equal(objectReference.relationshipKey, 'wp_term_relationships.object_id');
  assert.equal(objectReference.relationshipType, 'term-relationship-object');
  assert.equal(objectReference.sourceResourceKey, testCase.resources.relationship.key);
  assert.equal(objectReference.targetResourceKey, testCase.resources.post.key);
  assert.equal(objectReference.targetChange.localChange, 'unchanged');
  assert.equal(objectReference.targetChange.remoteChange, 'update');
  assert.equal(Object.hasOwn(objectReference, 'targetSupport'), false);
  assert.equal(relationshipBlocker.references.length, 1);
  assertHashOnlyGraphBlocker(relationshipBlocker);

  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, 'blocked stale object plan must refuse before mutation');

  const redaction = assertRedactedPayload(testCase, {
    status: plan.status,
    rawStaleProbe: {
      value: {
        basePost: testCase.base.db.wp_posts[testCase.ids.postRowId],
        localPost: testCase.local.db.wp_posts[testCase.ids.postRowId],
        remotePost: testCase.remote.db.wp_posts[testCase.ids.postRowId],
        relationship: testCase.local.db.wp_term_relationships[testCase.ids.relationshipRowId],
      },
    },
    blocker: relationshipBlocker,
  }, `${testCase.id} stale redacted evidence`);

  const evidence = {
    id: testCase.id,
    variant: 'generated-stale',
    status: plan.status,
    applied: false,
    planSummary: plan.summary,
    surface: surfaceEvidence(testCase),
    staleBlocker: {
      resourceKey: relationshipBlocker.resourceKey,
      class: relationshipBlocker.class,
      resolutionPolicy: relationshipBlocker.resolutionPolicy,
      relationshipKeys: relationshipBlocker.references.map((reference) => reference.relationshipKey).sort(),
      blockerHash: `sha256:${digest(relationshipBlocker)}`,
      plannedRelationshipMutation: false,
    },
    objectReference: {
      relationshipKey: objectReference.relationshipKey,
      relationshipType: objectReference.relationshipType,
      sourceResourceKey: objectReference.sourceResourceKey,
      targetResourceKey: objectReference.targetResourceKey,
      targetBaseHash: objectReference.targetBaseHash,
      targetLocalHash: objectReference.targetLocalHash,
      targetRemoteHash: objectReference.targetRemoteHash,
      targetLocalChange: objectReference.targetChange.localChange,
      targetRemoteChange: objectReference.targetChange.remoteChange,
      objectIdHash: `sha256:${digest(String(testCase.ids.postId))}`,
    },
    refusal: {
      code: error.code,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
    redaction,
  };
  evidence.modelProofHash = `sha256:${digest(evidence)}`;

  assertHashOnlyEvidence(evidence, testCase, `${testCase.id} stale hash-only evidence`);
  return evidence;
}

function assertHashOnlyGraphBlocker(blocker) {
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
  ]) {
    assertHash(hash, `${blocker.resourceKey} blocker hash`);
  }
  assert.equal(Object.hasOwn(blocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.remote, 'value'), false);

  for (const reference of blocker.references) {
    for (const hash of [
      reference.targetBaseHash,
      reference.targetLocalHash,
      reference.targetRemoteHash,
      reference.targetChange.base.hash,
      reference.targetChange.local.hash,
      reference.targetChange.remote.hash,
    ]) {
      assertHash(hash, `${reference.relationshipKey} target hash`);
    }
    assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
    assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
  }
}

function assertHashOnlyEvidence(evidence, testCase, label) {
  const serialized = JSON.stringify(evidence);

  assertPrefixedHash(evidence.modelProofHash, `${label} model proof hash`);
  assertNoRawValues(serialized, testCase.privateValues, label);

  for (const surface of Object.values(evidence.surface)) {
    assertHash(surface.baseHash, `${label} ${surface.resourceKey} base hash`);
    assertHash(surface.localHash, `${label} ${surface.resourceKey} local hash`);
    assertHash(surface.remoteHash, `${label} ${surface.resourceKey} remote hash`);
  }

  assertPrefixedHash(evidence.objectReference.objectIdHash, `${label} object id hash`);
  if (evidence.relationshipMutation) {
    assertPrefixedHash(evidence.relationshipMutation.mutationHash, `${label} relationship mutation hash`);
  }
  if (evidence.staleBlocker) {
    assertPrefixedHash(evidence.staleBlocker.blockerHash, `${label} stale blocker hash`);
  }
  if (evidence.refusal) {
    assertPrefixedHash(evidence.refusal.detailsHash, `${label} refusal hash`);
  }
  assertPrefixedHash(evidence.redaction.redactedHash, `${label} redaction hash`);
}

test('RPP-0373 proves generated-ready and stale term relationship object references with hash-only evidence', () => {
  const cases = buildGeneratedTermRelationshipObjectCases();
  const evidence = cases.map((testCase) => {
    assert.ok(testCase.tags.has('term-relationship-object-graph'));
    if (testCase.variant === 'ready') {
      return readyCaseEvidence(testCase);
    }
    return staleCaseEvidence(testCase);
  });
  const envelope = {
    rpp: 'RPP-0373',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'separate-production-gates-not-claimed',
    cases: evidence,
  };
  envelope.evidenceHash = `sha256:${digest(envelope)}`;
  const serializedEnvelope = JSON.stringify(envelope);

  assert.deepEqual(evidence.map((entry) => entry.variant), ['generated-ready', 'generated-stale']);
  assert.equal(evidence[0].status, 'ready');
  assert.equal(evidence[0].applied, true);
  assert.equal(evidence[0].objectReference.relationshipKey, 'wp_term_relationships.object_id');
  assert.equal(evidence[0].objectReference.samePlanTargetCreate, true);
  assert.equal(evidence[0].relationshipMutation.appliedHash, evidence[0].surface.relationship.localHash);
  assert.equal(evidence[0].remoteOnlyPreservation.preserved, true);
  assert.equal(evidence[0].staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(evidence[0].staleReplay.remoteBeforeHash, evidence[0].staleReplay.remoteAfterHash);

  assert.equal(evidence[1].status, 'blocked');
  assert.equal(evidence[1].applied, false);
  assert.deepEqual(evidence[1].staleBlocker.relationshipKeys, ['wp_term_relationships.object_id']);
  assert.equal(evidence[1].staleBlocker.plannedRelationshipMutation, false);
  assert.equal(evidence[1].objectReference.targetRemoteChange, 'update');
  assert.equal(evidence[1].refusal.code, 'PLAN_NOT_READY');
  assert.equal(evidence[1].refusal.remoteBeforeHash, evidence[1].refusal.remoteAfterHash);

  assertPrefixedHash(envelope.evidenceHash, 'RPP-0373 envelope evidence hash');
  for (const testCase of cases) {
    assertNoRawValues(serializedEnvelope, testCase.privateValues, 'RPP-0373 evidence envelope');
  }
});
