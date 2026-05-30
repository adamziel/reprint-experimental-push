import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  MIN_GENERATED_PUSH_CASES,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const expectedVariant3ConflictTags = [
  'directory-descendant-v3-non-ready',
  'file-create-update-delete-mix-v3-non-ready',
  'row-create-update-delete-mix-v3-non-ready',
  'wp-options-scalar-v3-non-ready',
  'wp-options-serialized-v3-non-ready',
  'wp-posts-create-update-delete-v3-non-ready',
  'wp-postmeta-create-update-delete-v3-non-ready',
  'plugin-owned-option-change-v3-non-ready',
];
const expectedConflictClasses = [
  'file-conflict',
  'file-topology-conflict',
  'plugin-data-conflict',
  'row-conflict',
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
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
    claimHash: '9'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function hashOnlyConflictSummary(conflict) {
  const summary = {
    id: conflict.id,
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner || null,
    resolutionPolicy: conflict.resolutionPolicy,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    change: hashOnlyChangeSummary(conflict.change),
    conflictHash: sha256Evidence({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      pluginOwner: conflict.pluginOwner || null,
      resolutionPolicy: conflict.resolutionPolicy,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      change: conflict.change,
      relatedResourceKey: conflict.relatedResourceKey || null,
      relatedChange: conflict.relatedChange || null,
    }),
  };

  if (conflict.relatedResourceKey) {
    summary.relatedResourceKey = conflict.relatedResourceKey;
    summary.relatedChange = hashOnlyChangeSummary(conflict.relatedChange);
  }

  return summary;
}

function hashOnlyChangeSummary(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: hashOnlySideSummary(change.base),
    local: hashOnlySideSummary(change.local),
    remote: hashOnlySideSummary(change.remote),
  };
}

function hashOnlySideSummary(side) {
  return {
    state: side.state,
    hash: side.hash,
    ...(side.fileType ? { fileType: side.fileType } : {}),
  };
}

function assertConflictEvidenceIsHashOnly(testCase, plan) {
  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));

  assert.deepEqual(
    findEvidenceRedactionIssues({ conflicts: plan.conflicts }),
    [],
    `${testCase.id} conflict evidence contains raw-value fields`,
  );
  assert.deepEqual(
    redactEvidence({ conflicts: plan.conflicts }),
    { conflicts: plan.conflicts },
    `${testCase.id} conflict evidence should already be hash-only`,
  );

  for (const conflict of plan.conflicts) {
    assert.equal(
      mutationKeys.has(conflict.resourceKey),
      false,
      `${testCase.id} emitted a mutation for conflicted resource ${conflict.resourceKey}`,
    );
    assert.equal(
      preconditionKeys.has(conflict.resourceKey),
      false,
      `${testCase.id} emitted a precondition for conflicted resource ${conflict.resourceKey}`,
    );
    assert.match(conflict.baseHash, sha256HexPattern, `${testCase.id} ${conflict.id} baseHash format`);
    assert.match(conflict.localHash, sha256HexPattern, `${testCase.id} ${conflict.id} localHash format`);
    assert.match(conflict.remoteHash, sha256HexPattern, `${testCase.id} ${conflict.id} remoteHash format`);
    assert.equal(conflict.change.base.hash, conflict.baseHash, `${testCase.id} ${conflict.id} base change hash`);
    assert.equal(conflict.change.local.hash, conflict.localHash, `${testCase.id} ${conflict.id} local change hash`);
    assert.equal(conflict.change.remote.hash, conflict.remoteHash, `${testCase.id} ${conflict.id} remote change hash`);
    assertHashOnlyChangeEvidence(testCase, conflict.id, conflict.resource, conflict.change);
    if (conflict.relatedChange) {
      assertHashOnlyChangeEvidence(testCase, `${conflict.id} related`, conflict.relatedResource, conflict.relatedChange);
    }
  }
}

function assertHashOnlyChangeEvidence(testCase, label, resource, change) {
  const validChangeKinds = ['create', 'delete', 'type-change', 'unchanged', 'update'];
  assert.ok(
    validChangeKinds.includes(change.localChange),
    `${testCase.id} ${label} localChange`,
  );
  assert.ok(
    validChangeKinds.includes(change.remoteChange),
    `${testCase.id} ${label} remoteChange`,
  );
  for (const sideName of ['base', 'local', 'remote']) {
    const side = change[sideName];
    const expectedKeys = resource.type === 'file' && side.state === 'present'
      ? ['fileType', 'hash', 'state']
      : ['hash', 'state'];
    assert.deepEqual(
      Object.keys(side).sort(),
      expectedKeys,
      `${testCase.id} ${label} ${sideName} evidence keys`,
    );
    assert.ok(['absent', 'present'].includes(side.state), `${testCase.id} ${label} ${sideName} state`);
    assert.match(side.hash, sha256HexPattern, `${testCase.id} ${label} ${sideName} hash format`);
    if (side.fileType) {
      assert.ok(['directory', 'file'].includes(side.fileType), `${testCase.id} ${label} ${sideName} fileType`);
    }
  }
}

function generatedConflictRawNeedles(testCase, plan) {
  const needles = new Set();
  for (const conflict of plan.conflicts) {
    collectSensitiveResourceNeedles(needles, getResource(testCase.base, conflict.resource), conflict.resource);
    collectSensitiveResourceNeedles(needles, getResource(testCase.local, conflict.resource), conflict.resource);
    collectSensitiveResourceNeedles(needles, getResource(testCase.remote, conflict.resource), conflict.resource);
    if (conflict.relatedResource) {
      collectSensitiveResourceNeedles(
        needles,
        getResource(testCase.base, conflict.relatedResource),
        conflict.relatedResource,
      );
      collectSensitiveResourceNeedles(
        needles,
        getResource(testCase.local, conflict.relatedResource),
        conflict.relatedResource,
      );
      collectSensitiveResourceNeedles(
        needles,
        getResource(testCase.remote, conflict.relatedResource),
        conflict.relatedResource,
      );
    }
  }
  return [...needles].filter((needle) => needle.length >= 8).sort();
}

function collectSensitiveResourceNeedles(needles, value, resource) {
  if (value === undefined || value === null || value === ABSENT) {
    return;
  }
  if (resource.type === 'file') {
    if (typeof value === 'string') {
      needles.add(value);
      return;
    }
    collectStringLeaves(needles, value, { force: false, keyPath: [] });
    return;
  }
  collectStringLeaves(needles, value, { force: false, keyPath: [] });
}

function collectStringLeaves(needles, value, { force, keyPath = [] }) {
  if (typeof value === 'string') {
    if (force || keyPath.some(isSensitiveValueKey)) {
      needles.add(value);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringLeaves(needles, entry, {
      force,
      keyPath: [...keyPath, String(index)],
    }));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectStringLeaves(needles, child, {
      force: force || isSensitiveValueKey(key),
      keyPath: [...keyPath, key],
    });
  }
}

function isSensitiveValueKey(key) {
  const normalized = String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return normalized === 'optionvalue'
    || normalized === 'metavalue'
    || normalized === 'posttitle'
    || normalized === 'postcontent'
    || normalized === 'postexcerpt'
    || normalized === 'commentcontent'
    || normalized === 'payload'
    || normalized === 'privatecontent'
    || normalized === 'privatenotes'
    || normalized === 'privatetoken'
    || normalized === 'authtoken'
    || normalized === 'token'
    || normalized === 'notes'
    || normalized === 'updatedmarker';
}

function incrementCount(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

test('RPP-0249 generated conflict evidence hash redaction variant 3 stays hash-only', () => {
  const testCases = generatePushHarnessCases();
  const coverage = {
    totalGeneratedCases: testCases.length,
    conflictCases: 0,
    conflictCount: 0,
    mutationCountInConflictPlans: 0,
    classes: {},
    families: {},
    tiers: {},
    variant3Tags: {},
    applyRefusals: {},
    rawNeedleCount: 0,
  };
  const conflictCaseEvidence = [];
  const rawNeedlesByCase = new Map();

  assert.ok(testCases.length >= MIN_GENERATED_PUSH_CASES, 'generated proof should cover the minimum generated matrix');

  for (const testCase of testCases) {
    const firstPlan = planFor(testCase);
    if (firstPlan.status !== 'conflict') {
      continue;
    }

    const replayPlan = planFor(cloneJson(testCase));
    const remote = cloneJson(testCase.remote);
    const beforeRemoteHash = digest(remote);
    const journalEvents = [];
    const applyError = captureError(() => applyPlan(remote, firstPlan, {
      durableJournal: durableJournal(journalEvents),
    }));
    const rawNeedles = generatedConflictRawNeedles(testCase, firstPlan);
    rawNeedlesByCase.set(testCase.id, rawNeedles);

    assert.deepEqual(
      firstPlan.conflicts.map(hashOnlyConflictSummary),
      replayPlan.conflicts.map(hashOnlyConflictSummary),
      `${testCase.id} generated conflict evidence should be deterministic`,
    );
    assertConflictEvidenceIsHashOnly(testCase, firstPlan);
    assert.ok(applyError instanceof PushPlanError, `${testCase.id} conflict apply should throw PushPlanError`);
    assert.equal(applyError.code, 'PLAN_NOT_READY', `${testCase.id} conflict apply code`);
    assert.deepEqual(applyError.details, { status: 'conflict' }, `${testCase.id} conflict apply details`);
    assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} conflict apply mutated remote`);
    assert.deepEqual(journalEvents, [], `${testCase.id} conflict apply wrote journal events`);

    coverage.conflictCases++;
    coverage.conflictCount += firstPlan.conflicts.length;
    coverage.mutationCountInConflictPlans += firstPlan.mutations.length;
    coverage.rawNeedleCount += rawNeedles.length;
    incrementCount(coverage.families, testCase.family);
    incrementCount(coverage.tiers, testCase.tier);
    incrementCount(coverage.applyRefusals, applyError.code);
    for (const tag of testCase.tags) {
      if (tag.includes('-v3-')) {
        incrementCount(coverage.variant3Tags, tag);
      }
    }
    for (const conflict of firstPlan.conflicts) {
      incrementCount(coverage.classes, conflict.class);
    }

    conflictCaseEvidence.push({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      variant3Tags: [...testCase.tags].filter((tag) => tag.includes('-v3-')).sort(),
      status: firstPlan.status,
      summary: firstPlan.summary,
      conflicts: firstPlan.conflicts.map(hashOnlyConflictSummary),
      mutationKeys: firstPlan.mutations.map((mutation) => mutation.resourceKey).sort(),
      preconditionHashes: firstPlan.preconditions.map((precondition) => ({
        resourceKey: precondition.resourceKey,
        expectedHash: precondition.expectedHash,
        checkedAgainst: precondition.checkedAgainst,
      })),
      refusal: {
        code: applyError.code,
        detailsHash: sha256Evidence(applyError.details),
        beforeRemoteHash: sha256Evidence(testCase.remote),
        afterRemoteHash: sha256Evidence(remote),
        durableJournalEventCount: journalEvents.length,
      },
      rawNeedleHashes: rawNeedles.map(sha256Evidence),
    });
  }

  coverage.classes = sortStringObject(coverage.classes);
  coverage.families = sortStringObject(coverage.families);
  coverage.tiers = sortNumericObject(coverage.tiers);
  coverage.variant3Tags = sortStringObject(coverage.variant3Tags);
  coverage.applyRefusals = sortStringObject(coverage.applyRefusals);

  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0249 test/rpp-0249-conflict-evidence-hash-redaction-v3.test.js',
    behavior: 'Generated conflict cases serialize conflict evidence as resource/class/policy/change-state/hash metadata only.',
    coverage,
    conflictCaseEvidence,
  };
  const evidenceText = JSON.stringify({
    ...evidenceEnvelope,
    evidenceHash: sha256Evidence(evidenceEnvelope),
  });

  assert.ok(coverage.conflictCases > 0, 'generated proof must include conflict cases');
  assert.ok(coverage.rawNeedleCount > 0, 'generated proof must collect raw fixture values to guard against leaks');
  assert.equal(coverage.applyRefusals.PLAN_NOT_READY, coverage.conflictCases, 'all conflict cases should refuse apply');
  for (const conflictClass of expectedConflictClasses) {
    assert.ok(coverage.classes[conflictClass] > 0, `generated proof should include ${conflictClass}`);
  }
  for (const tag of expectedVariant3ConflictTags) {
    assert.ok(coverage.variant3Tags[tag] > 0, `generated proof should include ${tag}`);
  }
  assert.deepEqual(
    findEvidenceRedactionIssues(JSON.parse(evidenceText)),
    [],
    'RPP-0249 evidence envelope contains raw-value fields',
  );
  for (const entry of conflictCaseEvidence) {
    assert.match(entry.refusal.detailsHash, /^sha256:[a-f0-9]{64}$/, `${entry.id} details hash format`);
    for (const conflict of entry.conflicts) {
      assert.match(conflict.conflictHash, /^sha256:[a-f0-9]{64}$/, `${entry.id} conflict hash format`);
    }
  }

  for (const [caseId, rawNeedles] of rawNeedlesByCase) {
    for (const needle of rawNeedles) {
      assert.equal(evidenceText.includes(needle), false, `${caseId} RPP-0249 evidence leaked ${needle}`);
    }
  }
});
