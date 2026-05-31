import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0293-local-hash-correctness-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsEntryRowId = 'entry_id:293';
const formsEntryResourceKey = 'row:["wp_forms_entries","entry_id:293"]';
const indexResourceKey = 'file:index.php';
const workingPostResourceKey = 'row:["wp_posts","ID:2"]';

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0293-index";',
  'Base private RPP-0293 option mode',
  'Base private RPP-0293 post title',
  'base-private-rpp0293-entry',
  '<?php echo "local-private-rpp0293-index";',
  'Local private RPP-0293 option mode',
  'Local private RPP-0293 post title',
  'rpp0293-invalid-raw-local-hash-secret',
  '<?php echo "rpp0293-forged-mutation-value-secret";',
  'rpp0293-stale-local-hash-source-secret',
  '<?php echo "local-private-rpp0293-delete-resurrection";',
  '<?php echo "local-private-rpp0293-conflict-safe-file";',
  'Local private RPP-0293 conflicting post title',
  'Remote private RPP-0293 conflicting post title',
  '<?php echo "local-private-rpp0293-blocked-safe-file";',
  'local-private-rpp0293-entry-blocked',
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

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base-private-rpp0293-index";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0293 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsEntryRowId]: {
          entry_id: 293,
          status: 'submitted',
          payload: {
            mode: 'base-private-rpp0293-entry',
            ordinal: 1,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: 'Base private RPP-0293 option mode',
            limit: 10,
          },
          autoload: 'no',
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0293 post title',
          post_status: 'publish',
        },
        'ID:2': {
          ID: 2,
          post_title: 'Base private RPP-0293 working post title',
          post_status: 'publish',
        },
      },
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { resourceKey, pluginOwner, driver, ...extra };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function mixedUpdateFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0293-index";';
  local.db.wp_options[formsOptionRowId].option_value.mode = 'Local private RPP-0293 option mode';
  local.db.wp_posts['ID:1'].post_title = 'Local private RPP-0293 post title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms'),
    ),
  };

  return {
    label: 'RPP-0293 ready mixed localHash fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedSummary: {
      mutations: 3,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [
      indexResourceKey,
      formsOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
    expectedConflictResourceKeys: [],
    expectedBlockerResourceKeys: [],
    refusalCases: 'mixed',
  };
}

function deleteFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  delete local.files['index.php'];
  delete local.db.wp_options[formsOptionRowId];
  delete local.db.wp_posts['ID:1'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', { supportsDelete: true }),
    ),
  };

  return {
    label: 'RPP-0293 ready delete localHash fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedSummary: {
      mutations: 3,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [
      indexResourceKey,
      formsOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
    expectedConflictResourceKeys: [],
    expectedBlockerResourceKeys: [],
    refusalCases: 'delete',
  };
}

function conflictWithSafeMutationFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0293-conflict-safe-file";';
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0293 conflicting post title';
  remote.db.wp_posts['ID:2'].post_title = 'Remote private RPP-0293 conflicting post title';

  return {
    label: 'RPP-0293 conflict with safe localHash mutation fixture',
    base,
    local,
    remote,
    expectedStatus: 'conflict',
    expectedSummary: {
      mutations: 1,
      decisions: 0,
      conflicts: 1,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedConflictResourceKeys: [workingPostResourceKey],
    expectedBlockerResourceKeys: [],
    refusalCases: null,
  };
}

function blockedWithSafeMutationFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0293-blocked-safe-file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0293-entry-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 2;

  return {
    label: 'RPP-0293 blocked with safe localHash mutation fixture',
    base,
    local,
    remote,
    expectedStatus: 'blocked',
    expectedSummary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 1,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedConflictResourceKeys: [],
    expectedBlockerResourceKeys: [formsEntryResourceKey],
    refusalCases: null,
  };
}

function focusedFixtures() {
  return [
    mixedUpdateFixture(),
    deleteFixture(),
    conflictWithSafeMutationFixture(),
    blockedWithSafeMutationFixture(),
  ];
}

function sortStrings(values) {
  return [...values].sort();
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function plannedValueHash(mutation) {
  return digest(deserializeResourceValue(mutation.value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function hashFieldEvidence(value) {
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: sha256Evidence(value),
    valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function durableEventsFor(events) {
  return {
    claimFenced: true,
    claimHash: '9'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, payloadHash: sha256Evidence(payload) };
      events.push(record);
      return record;
    },
  };
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function releaseVerifierPlanEvidence(plan, local, error = null, journalEvents = [], appliedMutationCount = 0) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => {
      const plannedHash = plannedValueHash(mutation);
      const localSnapshotHash = resourceHash(local, mutation.resource);

      return {
        mutationIdHash: sha256Evidence(mutation.id),
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        baseHash: hashFieldEvidence(mutation.baseHash),
        localHash: hashFieldEvidence(mutation.localHash),
        remoteBeforeHash: hashFieldEvidence(mutation.remoteBeforeHash),
        plannedValueHash: plannedHash,
        localSnapshotHash,
        localHashMatchesPlannedValue: mutation.localHash === plannedHash,
        localHashMatchesLocalSnapshot: mutation.wordpressGraphIdentity
          ? null
          : mutation.localHash === localSnapshotHash,
        graphIdentityRewriteCount: mutation.wordpressGraphIdentity?.rewrites?.length || 0,
        bindingHash: sha256Evidence({
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          action: mutation.action,
          localHash: mutation.localHash || null,
          plannedValueHash: plannedHash,
          localSnapshotHash,
        }),
      };
    }),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationIdHash: sha256Evidence(precondition.mutationId),
      resourceKey: precondition.resourceKey,
      expectedHash: hashFieldEvidence(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      localHash: hashFieldEvidence(conflict.localHash),
      remoteHash: hashFieldEvidence(conflict.remoteHash),
      conflictHash: sha256Evidence({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        localHash: conflict.localHash || null,
        remoteHash: conflict.remoteHash || null,
      }),
    })),
    blockers: plan.blockers.map((blocker) => ({
      resourceKey: blocker.resourceKey,
      class: blocker.class,
      localHash: hashFieldEvidence(blocker.localHash),
      remoteHash: hashFieldEvidence(blocker.remoteHash),
      blockerHash: sha256Evidence({
        resourceKey: blocker.resourceKey,
        class: blocker.class,
        localHash: blocker.localHash || null,
        remoteHash: blocker.remoteHash || null,
      }),
    })),
    refusal: error
      ? {
          code: error.code,
          issueCodes: (error.details?.issues || []).map((issue) => issue.code).sort(),
          detailsHash: sha256Evidence(error.details),
        }
      : null,
    journalEventTypes: journalEvents.map((event) => event.type),
    appliedMutationCount,
  };
}

function assertPlanSurface(plan, fixture) {
  assert.equal(plan.status, fixture.expectedStatus, `${fixture.label} status`);
  assert.deepEqual(plan.summary, fixture.expectedSummary, `${fixture.label} summary`);
  assert.deepEqual(
    plan.summary,
    emittedPlannerCounts(plan),
    `${fixture.label} summary must match emitted planner evidence counts`,
  );
  assert.deepEqual(
    sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} mutation resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.preconditions.map((precondition) => precondition.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} precondition resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.conflicts.map((conflict) => conflict.resourceKey)),
    sortStrings(fixture.expectedConflictResourceKeys),
    `${fixture.label} conflict resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.blockers.map((blocker) => blocker.resourceKey)),
    sortStrings(fixture.expectedBlockerResourceKeys),
    `${fixture.label} blocker resource surface`,
  );
}

function assertMutationLocalHashBinding({ label, local, mutation }) {
  const expectedPlannedHash = plannedValueHash(mutation);
  assert.match(mutation.localHash, sha256HexPattern, `${label} ${mutation.resourceKey} localHash format`);
  assert.equal(
    mutation.localHash,
    expectedPlannedHash,
    `${label} ${mutation.resourceKey} localHash must bind to the serialized planned value`,
  );

  if (!mutation.wordpressGraphIdentity) {
    assert.equal(
      mutation.localHash,
      resourceHash(local, mutation.resource),
      `${label} ${mutation.resourceKey} localHash must bind to the local snapshot`,
    );
  }
}

function assertEveryMutationHasLiveRemotePrecondition({ label, remote, plan }) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      precondition.expectedHash,
      resourceHash(remote, mutation.resource),
      `${label} precondition must bind to the live remote hash`,
    );
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope mismatch`);
  }
}

function assertReadyApplyCarriesLocalHash(fixture, plan) {
  if (plan.status !== 'ready') {
    return;
  }

  const applied = applyPlan(cloneJson(fixture.remote), plan);
  assert.equal(applied.appliedMutations, plan.mutations.length, `${fixture.label} applied mutation count`);
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(applied.site, mutation.resource),
      mutation.localHash,
      `${fixture.label} did not apply the planned localHash for ${mutation.resourceKey}`,
    );
  }
}

function assertNoRawEvidence(evidence, forbiddenValues, label) {
  assert.deepEqual(findEvidenceRedactionIssues(evidence), [], `${label} should be hash-only evidence`);
  const serialized = JSON.stringify(evidence);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw fixture value ${value}`);
  }
  for (const rawFieldName of ['"option_value"', '"payload"', '"post_title"', '"__pluginOwner"', '"content"']) {
    assert.equal(serialized.includes(rawFieldName), false, `${label} leaked raw field ${rawFieldName}`);
  }
}

function assertForgedLocalHashRefusal({
  fixture,
  plan,
  name,
  issueCode,
  forge,
  forbiddenValues = rawFixtureValues,
}) {
  const forged = tamperReadyPlan(plan, forge);
  const applyRemote = cloneJson(fixture.remote);
  const beforeRemote = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(applyRemote, forged, {
      durableJournal: durableEventsFor(journalEvents),
    });
    appliedMutationCount = result.appliedMutations;
  });
  const evidence = releaseVerifierPlanEvidence(
    forged,
    fixture.local,
    error,
    journalEvents,
    appliedMutationCount,
  );

  assert.ok(error instanceof PushPlanError, `${fixture.label} ${name}`);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', `${fixture.label} ${name}`);
  assert.ok(
    error.details.issues.some((issue) => issue.code === issueCode),
    `${fixture.label} ${name} missing ${issueCode}`,
  );
  assert.equal(JSON.stringify(applyRemote), beforeRemote, `${fixture.label} ${name} mutated remote before refusal`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${fixture.label} ${name} changed remote hash before refusal`);
  assert.equal(appliedMutationCount, 0, `${fixture.label} ${name} reported applied mutations`);
  assert.deepEqual(journalEvents, [], `${fixture.label} ${name} wrote durable journal evidence before refusal`);
  assertNoRawEvidence(evidence, forbiddenValues, `${fixture.label} ${name} release verifier evidence`);
  assertNoRawEvidence(
    redactEvidence(error.details),
    forbiddenValues,
    `${fixture.label} ${name} refusal details`,
  );

  return {
    name,
    issueCode,
    evidenceHash: sha256Evidence(evidence),
    remoteUnchangedHash: sha256Evidence(beforeRemoteHash),
  };
}

function focusedRefusalCases(fixture, plan) {
  const targetMutation = mutationFor(plan, indexResourceKey);
  assert.ok(targetMutation, `${fixture.label} missing target mutation`);

  if (fixture.refusalCases === 'mixed') {
    return [
      {
        name: 'missing localHash',
        issueCode: 'LOCAL_HASH_MISSING',
        forge(forgedPlan) {
          delete mutationFor(forgedPlan, targetMutation.resourceKey).localHash;
        },
      },
      {
        name: 'raw invalid localHash is redacted',
        issueCode: 'LOCAL_HASH_INVALID',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).localHash = 'rpp0293-invalid-raw-local-hash-secret';
        },
      },
      {
        name: 'wrong localHash',
        issueCode: 'LOCAL_HASH_MISMATCH',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).localHash = '0'.repeat(64);
        },
      },
      {
        name: 'stale mutation value with old localHash',
        issueCode: 'LOCAL_HASH_MISMATCH',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).value = serializeResourceValue({
            type: 'file',
            content: '<?php echo "rpp0293-forged-mutation-value-secret";',
          });
        },
      },
      {
        name: 'stale localHash from a different local snapshot',
        issueCode: 'LOCAL_HASH_MISMATCH',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).localHash = digest({
            type: 'file',
            content: 'rpp0293-stale-local-hash-source-secret',
          });
        },
      },
    ];
  }

  if (fixture.refusalCases === 'delete') {
    return [
      {
        name: 'raw invalid delete localHash is redacted',
        issueCode: 'LOCAL_HASH_INVALID',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).localHash = 'rpp0293-invalid-raw-local-hash-secret';
        },
      },
      {
        name: 'base payload hash reused for delete localHash',
        issueCode: 'LOCAL_HASH_MISMATCH',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).localHash = resourceHash(
            fixture.base,
            targetMutation.resource,
          );
        },
      },
      {
        name: 'delete payload resurrected with absent localHash',
        issueCode: 'LOCAL_HASH_MISMATCH',
        forge(forgedPlan) {
          mutationFor(forgedPlan, targetMutation.resourceKey).value = serializeResourceValue({
            type: 'file',
            content: '<?php echo "local-private-rpp0293-delete-resurrection";',
          });
        },
      },
    ];
  }

  return [];
}

function focusedLocalHashEvidence() {
  return focusedFixtures().map((fixture) => {
    const firstPlan = planFor(fixture);
    const replayPlan = planFor({
      base: cloneJson(fixture.base),
      local: cloneJson(fixture.local),
      remote: cloneJson(fixture.remote),
    });
    const firstEvidence = releaseVerifierPlanEvidence(firstPlan, fixture.local);
    const replayEvidence = releaseVerifierPlanEvidence(replayPlan, fixture.local);
    const refusalProofs = focusedRefusalCases(fixture, firstPlan).map((refusalCase) =>
      assertForgedLocalHashRefusal({
        fixture,
        plan: firstPlan,
        ...refusalCase,
      }));

    assertPlanSurface(firstPlan, fixture);
    assertEveryMutationHasLiveRemotePrecondition({
      label: fixture.label,
      remote: fixture.remote,
      plan: firstPlan,
    });
    assertEveryMutationHasLiveRemotePrecondition({
      label: `${fixture.label} replay`,
      remote: fixture.remote,
      plan: replayPlan,
    });
    assert.deepEqual(
      firstEvidence,
      replayEvidence,
      `${fixture.label} localHash evidence changed between deterministic planning runs`,
    );
    assertReadyApplyCarriesLocalHash(fixture, firstPlan);
    for (const mutation of firstPlan.mutations) {
      assertMutationLocalHashBinding({ label: fixture.label, local: fixture.local, mutation });
    }
    for (const conflict of firstPlan.conflicts) {
      assert.match(conflict.localHash, sha256HexPattern, `${fixture.label} conflict localHash format`);
    }
    for (const blocker of firstPlan.blockers) {
      assert.match(blocker.localHash, sha256HexPattern, `${fixture.label} blocker localHash format`);
    }
    assertNoRawEvidence(firstEvidence, rawFixtureValues, `${fixture.label} release verifier evidence`);

    return {
      label: fixture.label,
      status: firstPlan.status,
      summary: firstPlan.summary,
      preconditions: firstPlan.preconditions.length,
      mutationResourceKeys: sortStrings(firstPlan.mutations.map((mutation) => mutation.resourceKey)),
      conflictResourceKeys: sortStrings(firstPlan.conflicts.map((conflict) => conflict.resourceKey)),
      blockerResourceKeys: sortStrings(firstPlan.blockers.map((blocker) => blocker.resourceKey)),
      mutationLocalHashBindingHashes: firstPlan.mutations.map((mutation) =>
        sha256Evidence({
          resourceKey: mutation.resourceKey,
          localHash: mutation.localHash,
          plannedValueHash: plannedValueHash(mutation),
          localSnapshotHash: resourceHash(fixture.local, mutation.resource),
        })).sort(),
      refusalCount: refusalProofs.length,
      refusalIssueCodes: sortStrings(refusalProofs.map((proof) => proof.issueCode)),
      evidenceHash: sha256Evidence(firstEvidence),
      refusalHash: sha256Evidence(refusalProofs),
    };
  });
}

function generatedLocalHashEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    totals: {
      mutations: 0,
      localHashMatchesPlannedValue: 0,
      localHashMatchesLocalSnapshot: 0,
      graphIdentityMutations: 0,
      readyCasesWithMutations: 0,
      nonReadyCasesWithMutations: 0,
      invalidLocalHashRefusals: 0,
    },
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
    const label = `RPP-0293 generated ${testCase.id}`;
    const planEvidence = releaseVerifierPlanEvidence(plan, testCase.local);
    const mutationBindings = [];

    incrementCount(evidence.statuses, plan.status);
    evidence.totals.mutations += plan.mutations.length;
    if (plan.mutations.length > 0) {
      incrementCount(evidence.familiesWithMutations, testCase.family);
      if (plan.status === 'ready') {
        evidence.totals.readyCasesWithMutations += 1;
      } else {
        evidence.totals.nonReadyCasesWithMutations += 1;
      }
    }

    assertEveryMutationHasLiveRemotePrecondition({
      label,
      remote: testCase.remote,
      plan,
    });
    assertNoRawEvidence(
      planEvidence,
      plan.mutations.map((mutation) => JSON.stringify(mutation.value)),
      `${label} release verifier evidence`,
    );

    for (const mutation of plan.mutations) {
      const localSnapshotHash = resourceHash(testCase.local, mutation.resource);
      assertMutationLocalHashBinding({ label, local: testCase.local, mutation });
      evidence.totals.localHashMatchesPlannedValue += 1;
      if (mutation.wordpressGraphIdentity) {
        evidence.totals.graphIdentityMutations += 1;
      } else {
        assert.equal(
          mutation.localHash,
          localSnapshotHash,
          `${label} ${mutation.resourceKey} localHash must bind to the generated local snapshot`,
        );
        evidence.totals.localHashMatchesLocalSnapshot += 1;
      }
      mutationBindings.push({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        localHash: mutation.localHash,
        plannedValueHash: plannedValueHash(mutation),
        localSnapshotHash,
        graphIdentityRewriteCount: mutation.wordpressGraphIdentity?.rewrites?.length || 0,
      });
    }

    if (plan.status === 'ready' && plan.mutations.length > 0) {
      const rawPrivateValue = `rpp0293-generated-raw-local-hash-${testCase.id}`;
      assertForgedLocalHashRefusal({
        fixture: {
          label,
          local: testCase.local,
          remote: testCase.remote,
          base: testCase.base,
        },
        plan,
        name: 'generated raw invalid localHash is redacted',
        issueCode: 'LOCAL_HASH_INVALID',
        forbiddenValues: [rawPrivateValue],
        forge(forgedPlan) {
          forgedPlan.mutations[0].localHash = rawPrivateValue;
        },
      });
      evidence.totals.invalidLocalHashRefusals += 1;
    }

    evidence.caseProofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      mutationCount: plan.mutations.length,
      localHashBindingHash: sha256Evidence(mutationBindings),
      planEvidenceHash: sha256Evidence(planEvidence),
    });
  }

  return {
    ...evidence,
    statuses: sortedObject(evidence.statuses),
    familiesWithMutations: sortedObject(evidence.familiesWithMutations),
  };
}

function aggregateFocusedEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    totalMutations: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalPreconditions: 0,
    totalRefusals: 0,
  };

  for (const entry of evidence) {
    incrementCount(aggregate.statuses, entry.status);
    aggregate.totalMutations += entry.summary.mutations;
    aggregate.totalConflicts += entry.summary.conflicts;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalPreconditions += entry.preconditions;
    aggregate.totalRefusals += entry.refusalCount;
  }

  return {
    ...aggregate,
    statuses: sortedObject(aggregate.statuses),
  };
}

function assertGeneratedEvidence(evidence) {
  assert.equal(evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(evidence.totals.localHashMatchesPlannedValue, evidence.totals.mutations);
  assert.equal(
    evidence.totals.localHashMatchesLocalSnapshot + evidence.totals.graphIdentityMutations,
    evidence.totals.mutations,
  );
  assert.equal(
    evidence.totals.invalidLocalHashRefusals,
    evidence.totals.readyCasesWithMutations,
    'every generated ready plan with mutations must fail closed on a raw localHash',
  );
  assert.ok(evidence.statuses.ready > 0, 'RPP-0293 generated proof needs ready cases');
  assert.ok(evidence.statuses.conflict > 0, 'RPP-0293 generated proof needs conflict cases');
  assert.ok(evidence.statuses.blocked > 0, 'RPP-0293 generated proof needs blocked cases');
  assert.ok(evidence.totals.mutations >= 8000, 'RPP-0293 generated proof needs broad mutation coverage');
  assert.ok(
    evidence.totals.readyCasesWithMutations >= 300,
    'RPP-0293 generated proof needs broad ready-plan coverage',
  );
  assert.ok(
    Object.keys(evidence.familiesWithMutations).length >= 30,
    'RPP-0293 generated proof needs many mutation families',
  );

  for (const proof of evidence.caseProofs) {
    assert.match(proof.localHashBindingHash, sha256EvidencePattern);
    assert.match(proof.planEvidenceHash, sha256EvidencePattern);
  }
}

test('RPP-0293 release verifier v5 carries localHash correctness as hash-only evidence', () => {
  const firstFocusedEvidence = focusedLocalHashEvidence();
  const replayFocusedEvidence = focusedLocalHashEvidence();
  const firstGeneratedEvidence = generatedLocalHashEvidence();
  const replayGeneratedEvidence = generatedLocalHashEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0293',
    evidenceSource: 'local-hash-correctness-release-verifier-v5',
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
      familyCountWithMutations: Object.keys(firstGeneratedEvidence.familiesWithMutations).length,
    },
    focusedHash: sha256Evidence(firstFocusedEvidence),
    generatedHash: sha256Evidence(firstGeneratedEvidence),
    aggregateHash: sha256Evidence({ focusedAggregate, generated: firstGeneratedEvidence }),
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0293 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0293 generated release-verifier evidence changed between runs',
  );
  assert.deepEqual(focusedAggregate, {
    totalCases: 4,
    statuses: {
      blocked: 1,
      conflict: 1,
      ready: 2,
    },
    totalMutations: 8,
    totalConflicts: 1,
    totalBlockers: 1,
    totalPreconditions: 8,
    totalRefusals: 8,
  });
  assertGeneratedEvidence(firstGeneratedEvidence);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertNoRawEvidence(firstFocusedEvidence, rawFixtureValues, 'RPP-0293 focused release verifier evidence');
  assertNoRawEvidence(releaseEvidenceEnvelope, rawFixtureValues, 'RPP-0293 release verifier envelope');
});
