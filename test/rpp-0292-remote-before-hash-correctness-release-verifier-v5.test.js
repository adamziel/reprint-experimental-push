import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash, setResource } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0292-remote-before-hash-correctness-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const minGeneratedRemoteBeforeHashShapes = 20;

const indexResourceKey = 'file:index.php';
const pluginResourceKey = 'plugin:rpp-0292-plugin';
const postResourceKey = 'row:["wp_posts","ID:1"]';
const sentinelPath = 'wp-content/uploads/rpp-0292-sentinel.txt';
const sentinelResourceKey = `file:${sentinelPath}`;

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0292-index";',
  '<?php echo "local-private-rpp0292-index";',
  'base-private-rpp0292-plugin-channel',
  'local-private-rpp0292-plugin-channel',
  'Base private RPP-0292 title',
  'Local private RPP-0292 title',
  'Remote private RPP-0292 stale title',
  'rpp0292-sentinel-remote-private',
]);

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

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '2'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base-private-rpp0292-index";',
      [sentinelPath]: 'rpp0292-sentinel-remote-private',
    },
    plugins: {
      'rpp-0292-plugin': {
        version: '1.0.0',
        active: true,
        metadata: {
          channel: 'base-private-rpp0292-plugin-channel',
        },
      },
    },
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0292 title',
          post_status: 'publish',
        },
      },
    },
  };
}

function focusedFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0292-index";';
  local.plugins['rpp-0292-plugin'].version = '1.1.0';
  local.plugins['rpp-0292-plugin'].metadata.channel = 'local-private-rpp0292-plugin-channel';
  local.db.wp_posts['ID:1'].post_title = 'Local private RPP-0292 title';

  return { base, local, remote };
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
  const mutation = plan.mutations.find((candidate) => candidate.resourceKey === resourceKey);
  assert.ok(mutation, `missing mutation for ${resourceKey}`);
  return mutation;
}

function preconditionFor(plan, mutation) {
  const precondition = plan.preconditions.find((candidate) => candidate.mutationId === mutation.id);
  assert.ok(precondition, `missing precondition for ${mutation.id}`);
  return precondition;
}

function mutationShape(mutation) {
  return [
    mutation.resource.type,
    mutation.action,
    mutation.changeKind,
    mutation.resource.table || 'no-table',
  ].join(':');
}

function alternateHash(actualHash) {
  const forged = '0'.repeat(64);
  return forged === actualHash ? '1'.repeat(64) : forged;
}

function assertNoTargetOrMutationJournalEvents(events, label) {
  assert.deepEqual(
    events
      .filter((event) => event.type === 'target-planned' || event.type.includes('mutation'))
      .map((event) => event.type),
    [],
    `${label} wrote target or mutation journal evidence before refusal`,
  );
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertHashOnlyEvidence(value) {
  assertHashOnlyEvidenceRedacted(value, rawFixtureValues, 'RPP-0292 release-verifier evidence');
  const serialized = JSON.stringify(value);
  for (const rawFieldName of ['post_title', 'metadata', 'channel']) {
    assert.equal(serialized.includes(rawFieldName), false, `hash-only evidence leaked raw field ${rawFieldName}`);
  }
}

function assertRemoteBeforeHashBinding({ label, remote, plan, mutation }) {
  const precondition = preconditionFor(plan, mutation);
  const observedRemoteHash = resourceHash(remote, mutation.resource);
  const observedLocalHash = mutation.localHash;

  assert.match(mutation.remoteBeforeHash, sha256HexPattern, `${label} remoteBeforeHash format`);
  assert.equal(mutation.resource?.key, mutation.resourceKey, `${label} mutation resource key`);
  assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource object`);
  assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
  assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
  assert.equal(mutation.remoteBeforeHash, observedRemoteHash, `${label} live remote hash`);

  return {
    mutationIdHash: `sha256:${digest(mutation.id)}`,
    resourceKey: mutation.resourceKey,
    resourceType: mutation.resource.type,
    action: mutation.action,
    changeKind: mutation.changeKind,
    remoteBeforeHash: mutation.remoteBeforeHash,
    expectedHash: precondition.expectedHash,
    observedRemoteHash,
    observedLocalHash,
    bindingHash: `sha256:${digest({
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      remoteBeforeHash: mutation.remoteBeforeHash,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })}`,
  };
}

function assertFocusedPlanSurface(fixture, plan) {
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 3,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.resourceKey),
    [indexResourceKey, pluginResourceKey, postResourceKey],
  );
  assert.deepEqual(
    plan.preconditions.map((precondition) => precondition.resourceKey),
    [indexResourceKey, pluginResourceKey, postResourceKey],
  );
  assert.equal(plan.preconditions.length, plan.mutations.length);

  return plan.mutations.map((mutation) => {
    const binding = assertRemoteBeforeHashBinding({
      label: `RPP-0292 focused ${mutation.resourceKey}`,
      remote: fixture.remote,
      plan,
      mutation,
    });
    assert.notEqual(
      binding.remoteBeforeHash,
      resourceHash(fixture.local, mutation.resource),
      `${mutation.resourceKey} remoteBeforeHash must not be derived from local payloads`,
    );
    return binding;
  });
}

function focusedApplyProof(fixture, plan) {
  const result = applyPlan(cloneJson(fixture.remote), plan);

  assert.equal(result.appliedMutations, plan.mutations.length);
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(result.site, mutation.resource),
      mutation.localHash,
      `${mutation.resourceKey} did not apply planned local hash`,
    );
  }

  return {
    appliedMutations: result.appliedMutations,
    finalSiteHash: `sha256:${digest(result.site)}`,
    journalHash: `sha256:${digest(result.journal)}`,
    mutationLocalHashes: plan.mutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      localHash: mutation.localHash,
    })),
  };
}

function focusedForgedAliasRefusal(fixture, plan) {
  const forged = cloneJson(plan);
  const forgedMutation = mutationFor(forged, indexResourceKey);
  const forgedPrecondition = preconditionFor(forged, forgedMutation);
  const sentinelResourceWithForgedKey = {
    type: 'file',
    path: sentinelPath,
    key: indexResourceKey,
  };
  const sentinelHash = resourceHash(fixture.remote, sentinelResourceWithForgedKey);
  const applyRemote = cloneJson(fixture.remote);
  const beforeRemote = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];

  forgedMutation.remoteBeforeHash = sentinelHash;
  forgedPrecondition.expectedHash = sentinelHash;
  forgedPrecondition.resource = sentinelResourceWithForgedKey;

  const error = captureError(() => applyPlan(applyRemote, forged, {
    durableJournal: durableJournal(journalEvents),
  }));
  const issueCodes = error.details.issues.map((issue) => issue.code).sort();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    error.details.issues.some((issue) =>
      issue.code === 'PRECONDITION_RESOURCE_OBJECT_MISMATCH'
      && issue.expectedResourceKey === indexResourceKey
      && issue.actualResourceKey === sentinelResourceKey),
    'forged precondition resource object should be rejected even when its key aliases the mutation target',
  );
  assert.equal(JSON.stringify(applyRemote), beforeRemote, 'forged alias plan mutated the remote');
  assert.equal(digest(applyRemote), beforeRemoteHash, 'forged alias plan changed the remote hash');
  assertNoTargetOrMutationJournalEvents(journalEvents, 'RPP-0292 focused forged alias');

  return {
    case: 'focused-forged-alias',
    code: error.code,
    issueCodes,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };
}

function focusedStaleLaterMutationRefusal(fixture, plan) {
  const staleMutation = mutationFor(plan, postResourceKey);
  const staleRemote = cloneJson(fixture.remote);
  const journalEvents = [];

  staleRemote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0292 stale title';
  const staleActualHash = resourceHash(staleRemote, staleMutation.resource);
  assert.notEqual(staleActualHash, staleMutation.remoteBeforeHash, 'focused stale row must drift');

  const beforeRemote = JSON.stringify(staleRemote);
  const beforeRemoteHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan, {
    durableJournal: durableJournal(journalEvents),
  }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, postResourceKey);
  assert.equal(error.details.expectedHash, staleMutation.remoteBeforeHash);
  assert.equal(error.details.actualHash, staleActualHash);
  assert.equal(JSON.stringify(staleRemote), beforeRemote, 'stale row plan mutated the remote');
  assert.equal(digest(staleRemote), beforeRemoteHash, 'stale row plan changed the remote hash');
  assert.equal(staleRemote.files['index.php'], fixture.remote.files['index.php'], 'earlier file mutation was staged');
  assert.deepEqual(
    staleRemote.plugins['rpp-0292-plugin'],
    fixture.remote.plugins['rpp-0292-plugin'],
    'earlier plugin mutation was staged',
  );
  assertNoTargetOrMutationJournalEvents(journalEvents, 'RPP-0292 focused stale row');

  return {
    case: 'focused-stale-later-row',
    code: error.code,
    resourceKey: error.details.resourceKey,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    beforeRemoteHash,
    afterRemoteHash: digest(staleRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };
}

function focusedRemoteBeforeHashEvidence() {
  const fixture = focusedFixture();
  const firstPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });
  const firstBindings = assertFocusedPlanSurface(fixture, firstPlan);
  const replayBindings = assertFocusedPlanSurface(fixture, replayPlan);

  assert.deepEqual(
    firstBindings,
    replayBindings,
    'RPP-0292 focused remoteBeforeHash evidence changed between deterministic planning runs',
  );

  const evidence = {
    label: 'RPP-0292 focused file/plugin/row remoteBeforeHash release-verifier fixture',
    status: firstPlan.status,
    summary: firstPlan.summary,
    bindingCount: firstBindings.length,
    bindingHashes: firstBindings.map((binding) => binding.bindingHash).sort(),
    resourceKeys: firstBindings.map((binding) => binding.resourceKey),
    applyProof: focusedApplyProof(fixture, firstPlan),
    forgedAliasRefusal: focusedForgedAliasRefusal(fixture, firstPlan),
    staleLaterMutationRefusal: focusedStaleLaterMutationRefusal(fixture, firstPlan),
    envelopeHash: `sha256:${digest(firstBindings)}`,
  };

  assertHashOnlyEvidence(evidence);
  return evidence;
}

function staleValueFor(resource, current, marker) {
  if (resource.type === 'file') {
    return { type: 'file', content: marker };
  }

  if (resource.type === 'plugin') {
    if (current === ABSENT) {
      return { version: `0.0.0-${marker}`, active: false };
    }
    return {
      ...cloneJson(current),
      version: `${current.version || '0.0.0'}-${marker}`,
      __rpp0292StaleMarker: marker,
    };
  }

  if (resource.type === 'row') {
    if (current === ABSENT || current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { __rpp0292StaleMarker: marker };
    }
    return {
      ...cloneJson(current),
      __rpp0292StaleMarker: marker,
    };
  }

  throw new Error(`No stale value helper for ${resource.type}`);
}

function staleRemoteFor(entry, marker) {
  const staleRemote = cloneJson(entry.testCase.remote);
  const current = getResource(staleRemote, entry.mutation.resource);
  setResource(staleRemote, entry.mutation.resource, staleValueFor(entry.mutation.resource, current, marker));
  return staleRemote;
}

function selectedGeneratedShapeEntries() {
  const cases = generatePushHarnessCases();
  const selectedByShape = new Map();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    totals: {
      mutations: 0,
      preconditions: 0,
    },
    readyCasesWithMutations: 0,
    nonReadyCasesWithMutations: 0,
    maxMutations: 0,
    resourceTypes: {},
    actions: {},
    changeKinds: {},
    rowTables: {},
    familiesWithMutations: {},
    caseProofs: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });
    const bindings = [];

    incrementCount(evidence.statuses, plan.status);
    evidence.totals.mutations += plan.mutations.length;
    evidence.totals.preconditions += plan.preconditions.length;
    evidence.maxMutations = Math.max(evidence.maxMutations, plan.mutations.length);
    if (plan.mutations.length > 0) {
      incrementCount(evidence.familiesWithMutations, testCase.family);
      if (plan.status === 'ready') {
        evidence.readyCasesWithMutations += 1;
      } else {
        evidence.nonReadyCasesWithMutations += 1;
      }
    }

    for (const mutation of plan.mutations) {
      const binding = assertRemoteBeforeHashBinding({
        label: `RPP-0292 generated ${testCase.id}:${mutation.id}`,
        remote: testCase.remote,
        plan,
        mutation,
      });
      bindings.push(binding);
      incrementCount(evidence.resourceTypes, mutation.resource.type);
      incrementCount(evidence.actions, mutation.action);
      incrementCount(evidence.changeKinds, mutation.changeKind);
      if (mutation.resource.table) {
        incrementCount(evidence.rowTables, mutation.resource.table);
      }

      const shape = mutationShape(mutation);
      if (plan.status === 'ready' && !selectedByShape.has(shape)) {
        selectedByShape.set(shape, {
          id: `${testCase.id}:${mutation.id}`,
          caseId: testCase.id,
          family: testCase.family,
          tier: testCase.tier,
          shape,
          testCase,
          plan,
          mutation,
        });
      }
    }

    evidence.caseProofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      bindingHash: `sha256:${digest(bindings)}`,
    });
  }

  const matrix = [...selectedByShape.values()].sort((left, right) => left.shape.localeCompare(right.shape));
  return {
    matrix,
    evidence: {
      ...evidence,
      statuses: sortedObject(evidence.statuses),
      resourceTypes: sortedObject(evidence.resourceTypes),
      actions: sortedObject(evidence.actions),
      changeKinds: sortedObject(evidence.changeKinds),
      rowTables: sortedObject(evidence.rowTables),
      familiesWithMutations: sortedObject(evidence.familiesWithMutations),
    },
  };
}

function generatedForgedRemoteBeforeHashRefusal(entry) {
  const forgedHash = alternateHash(entry.mutation.remoteBeforeHash);
  const forgedPlan = cloneJson(entry.plan);
  const forgedMutation = mutationFor(forgedPlan, entry.mutation.resourceKey);
  const forgedPrecondition = preconditionFor(forgedPlan, forgedMutation);
  const applyRemote = cloneJson(entry.testCase.remote);
  const beforeRemote = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];

  forgedMutation.remoteBeforeHash = forgedHash;
  forgedPrecondition.expectedHash = forgedHash;

  const error = captureError(() => applyPlan(applyRemote, forgedPlan, {
    durableJournal: durableJournal(journalEvents),
  }));
  const actualHash = resourceHash(entry.testCase.remote, entry.mutation.resource);

  assert.ok(error instanceof PushPlanError, entry.id);
  assert.equal(error.code, 'PRECONDITION_FAILED', entry.id);
  assert.equal(error.details.resourceKey, entry.mutation.resourceKey, entry.id);
  assert.equal(error.details.expectedHash, forgedHash, entry.id);
  assert.equal(error.details.actualHash, actualHash, entry.id);
  assert.equal(JSON.stringify(applyRemote), beforeRemote, `${entry.id} forged attempt mutated remote`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${entry.id} forged attempt changed remote hash`);
  assertNoTargetOrMutationJournalEvents(journalEvents, `${entry.id} forged remoteBeforeHash`);

  return {
    caseId: entry.caseId,
    family: entry.family,
    tier: entry.tier,
    shape: entry.shape,
    resourceKey: entry.mutation.resourceKey,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };
}

function generatedStaleRemoteBeforeHashRefusal(entry) {
  const privateMarker = `rpp0292-generated-stale-private-${entry.caseId}-${entry.mutation.id}`;
  const staleRemote = staleRemoteFor(entry, privateMarker);
  const staleActualHash = resourceHash(staleRemote, entry.mutation.resource);
  const beforeRemote = JSON.stringify(staleRemote);
  const beforeRemoteHash = digest(staleRemote);
  const journalEvents = [];

  assert.notEqual(staleActualHash, entry.mutation.remoteBeforeHash, `${entry.id} stale fixture must drift`);

  const error = captureError(() => applyPlan(staleRemote, entry.plan, {
    durableJournal: durableJournal(journalEvents),
  }));

  assert.ok(error instanceof PushPlanError, entry.id);
  assert.equal(error.code, 'PRECONDITION_FAILED', entry.id);
  assert.equal(error.details.resourceKey, entry.mutation.resourceKey, entry.id);
  assert.equal(error.details.expectedHash, entry.mutation.remoteBeforeHash, entry.id);
  assert.equal(error.details.actualHash, staleActualHash, entry.id);
  assert.equal(JSON.stringify(staleRemote), beforeRemote, `${entry.id} stale attempt mutated remote`);
  assert.equal(digest(staleRemote), beforeRemoteHash, `${entry.id} stale attempt changed remote hash`);
  assertNoTargetOrMutationJournalEvents(journalEvents, `${entry.id} stale remoteBeforeHash`);

  return {
    caseId: entry.caseId,
    family: entry.family,
    tier: entry.tier,
    shape: entry.shape,
    resourceKey: entry.mutation.resourceKey,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash,
    afterRemoteHash: digest(staleRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };
}

function generatedRemoteBeforeHashEvidence() {
  const { matrix, evidence } = selectedGeneratedShapeEntries();
  const forgedRejections = matrix.map(generatedForgedRemoteBeforeHashRefusal);
  const staleRejections = matrix.map(generatedStaleRemoteBeforeHashRefusal);

  assertHashOnlyEvidenceRedacted(
    { forgedRejections, staleRejections },
    matrix.map((entry) => `rpp0292-generated-stale-private-${entry.caseId}-${entry.mutation.id}`),
    'RPP-0292 generated stale rejection evidence',
  );

  return {
    ...evidence,
    selectedShapeCount: matrix.length,
    selectedFamilies: [...new Set(matrix.map((entry) => entry.family))].sort(),
    selectedShapes: matrix.map((entry) => ({
      caseId: entry.caseId,
      family: entry.family,
      tier: entry.tier,
      shape: entry.shape,
      resourceKey: entry.mutation.resourceKey,
      remoteBeforeHash: entry.mutation.remoteBeforeHash,
      preconditionHash: preconditionFor(entry.plan, entry.mutation).expectedHash,
    })),
    forgedRejectionCount: forgedRejections.length,
    staleRejectionCount: staleRejections.length,
    forgedRejectionHash: `sha256:${digest(forgedRejections)}`,
    staleRejectionHash: `sha256:${digest(staleRejections)}`,
    caseProofHash: `sha256:${digest(evidence.caseProofs)}`,
  };
}

function aggregateFocusedEvidence(evidence) {
  return {
    totalCases: 1,
    statuses: { [evidence.status]: 1 },
    totalMutations: evidence.summary.mutations,
    totalPreconditions: evidence.bindingCount,
    totalForgedRefusals: 1,
    totalStaleRefusals: 1,
    resourceKeys: evidence.resourceKeys,
  };
}

function assertGeneratedEvidence(evidence) {
  assert.equal(evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(evidence.totals.preconditions, evidence.totals.mutations);
  assert.ok(evidence.statuses.ready > 0, 'RPP-0292 generated proof needs ready cases');
  assert.ok(evidence.statuses.conflict > 0, 'RPP-0292 generated proof needs conflict cases');
  assert.ok(evidence.statuses.blocked > 0, 'RPP-0292 generated proof needs blocked cases');
  assert.ok(evidence.readyCasesWithMutations > 0, 'RPP-0292 generated proof needs ready mutation cases');
  assert.ok(
    evidence.nonReadyCasesWithMutations > 0,
    'RPP-0292 generated proof needs non-ready cases that still emit safe mutations',
  );
  assert.ok(evidence.maxMutations >= 15, 'RPP-0292 generated proof needs high-mutation fixtures');
  assert.ok(evidence.selectedShapeCount >= minGeneratedRemoteBeforeHashShapes);
  assert.ok(evidence.resourceTypes.file > 0, 'RPP-0292 generated proof needs file mutations');
  assert.ok(evidence.resourceTypes.plugin > 0, 'RPP-0292 generated proof needs plugin mutations');
  assert.ok(evidence.resourceTypes.row > 0, 'RPP-0292 generated proof needs row mutations');
  assert.ok(evidence.actions.put > 0, 'RPP-0292 generated proof needs put mutations');
  assert.ok(evidence.actions.delete > 0, 'RPP-0292 generated proof needs delete mutations');
  assert.equal(evidence.forgedRejectionCount, evidence.selectedShapeCount);
  assert.equal(evidence.staleRejectionCount, evidence.selectedShapeCount);
  assert.match(evidence.forgedRejectionHash, sha256EvidencePattern);
  assert.match(evidence.staleRejectionHash, sha256EvidencePattern);
  assert.match(evidence.caseProofHash, sha256EvidencePattern);

  for (const shape of evidence.selectedShapes) {
    assert.equal(shape.remoteBeforeHash, shape.preconditionHash, `${shape.caseId} selected shape hash mismatch`);
  }
}

test('RPP-0292 release verifier v5 carries remoteBeforeHash correctness through forged and stale refusals', () => {
  const firstFocusedEvidence = focusedRemoteBeforeHashEvidence();
  const replayFocusedEvidence = focusedRemoteBeforeHashEvidence();
  const firstGeneratedEvidence = generatedRemoteBeforeHashEvidence();
  const replayGeneratedEvidence = generatedRemoteBeforeHashEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0292',
    evidenceSource: 'remote-before-hash-correctness-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    focused: focusedAggregate,
    generated: {
      totalCases: firstGeneratedEvidence.totalCases,
      statuses: firstGeneratedEvidence.statuses,
      totals: firstGeneratedEvidence.totals,
      maxMutations: firstGeneratedEvidence.maxMutations,
      readyCasesWithMutations: firstGeneratedEvidence.readyCasesWithMutations,
      nonReadyCasesWithMutations: firstGeneratedEvidence.nonReadyCasesWithMutations,
      selectedShapeCount: firstGeneratedEvidence.selectedShapeCount,
      selectedFamilyCount: firstGeneratedEvidence.selectedFamilies.length,
      forgedRejectionCount: firstGeneratedEvidence.forgedRejectionCount,
      staleRejectionCount: firstGeneratedEvidence.staleRejectionCount,
    },
    focusedHash: `sha256:${digest(firstFocusedEvidence)}`,
    generatedHash: `sha256:${digest(firstGeneratedEvidence)}`,
    aggregateHash: `sha256:${digest({ focusedAggregate, generated: firstGeneratedEvidence })}`,
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0292 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0292 generated release-verifier evidence changed between runs',
  );
  assert.deepEqual(focusedAggregate, {
    totalCases: 1,
    statuses: {
      ready: 1,
    },
    totalMutations: 3,
    totalPreconditions: 3,
    totalForgedRefusals: 1,
    totalStaleRefusals: 1,
    resourceKeys: [indexResourceKey, pluginResourceKey, postResourceKey],
  });
  assertGeneratedEvidence(firstGeneratedEvidence);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence);
  assertHashOnlyEvidence(releaseEvidenceEnvelope);
});
