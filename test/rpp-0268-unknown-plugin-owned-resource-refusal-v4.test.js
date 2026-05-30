import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsRowId = 'entry_id:68';
const formsResource = {
  type: 'row',
  table: 'wp_forms_entries',
  id: formsRowId,
  key: 'row:["wp_forms_entries","entry_id:68"]',
};
const sha256HexPattern = /^[a-f0-9]{64}$/;
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

function formsEntryRow({ token, note, version }) {
  return {
    entry_id: 68,
    status: 'submitted',
    payload: {
      token,
      nested: {
        note,
        version,
      },
    },
    __pluginOwner: 'forms',
  };
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms plugin rpp-0268 v4 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsRowId]: formsEntryRow({
          token: 'rpp-0268-base-private-token-sentinel',
          note: 'rpp-0268-base-private-note-sentinel',
          version: 1,
        }),
      },
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function assertPlanSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary must match emitted planner evidence`,
  );
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${label} status must match emitted conflict/blocker evidence`,
  );
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} live-remote preconditions must remain one-for-one with mutations`,
  );
}

function assertNoRawValues(value, rawValues, label) {
  const json = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(json.includes(rawValue), false, `${label} leaked ${rawValue}`);
  }
}

function blockerEvidence(blocker) {
  return {
    class: blocker.class,
    reasonCode: blocker.reasonCode || null,
    resourceKey: blocker.resourceKey,
    pluginOwner: blocker.pluginOwner,
    driver: blocker.driver || null,
    policySource: blocker.policySource || null,
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
    change: blocker.change,
    unknownPluginOwnedResourceRefusalEvidence: blocker.unknownPluginOwnedResourceRefusalEvidence,
    blockerHash: sha256Evidence(blocker),
  };
}

function serializedPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    blockers: plan.blockers.map(blockerEvidence),
    evidenceHash: sha256Evidence({
      status: plan.status,
      summary: plan.summary,
      blockers: plan.blockers.map(blockerEvidence),
    }),
  };
}

function forgedReadyPlanFromUnknownBlocker(blockedPlan, local, remote) {
  const mutationId = 'mutation-rpp-0268-forged-unknown-plugin-owned-resource-v4';
  const forged = cloneJson(blockedPlan);
  const plannedValue = local.db.wp_forms_entries[formsRowId];
  const remoteHash = resourceHash(remote, formsResource);

  forged.status = 'ready';
  forged.conflicts = [];
  forged.blockers = [];
  forged.decisions = [];
  forged.atomicGroups = [];
  forged.mutations = [
    {
      id: mutationId,
      resource: formsResource,
      resourceKey: formsResource.key,
      action: 'put',
      value: serializeResourceValue(plannedValue),
      remoteBeforeHash: remoteHash,
      baseHash: blockedPlan.blockers[0].baseHash,
      localHash: resourceHash(local, formsResource),
      changeKind: 'update',
      change: blockedPlan.blockers[0].change,
      atomicGroupId: null,
      pluginOwnedResource: {
        pluginOwner: 'forms',
        driver: null,
        policySource: null,
        supportsDelete: false,
      },
    },
  ];
  forged.preconditions = [
    {
      mutationId,
      resource: formsResource,
      resourceKey: formsResource.key,
      expectedHash: remoteHash,
      checkedAgainst: 'live-remote',
    },
  ];
  forged.summary = {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  };
  return forged;
}

test('RPP-0268 unknown plugin-owned resource refusal variant 4 keeps plan evidence hash-only', () => {
  const rawValues = [
    'rpp-0268-base-private-token-sentinel',
    'rpp-0268-base-private-note-sentinel',
    'rpp-0268-local-private-token-sentinel',
    'rpp-0268-local-private-note-sentinel',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_forms_entries[formsRowId].payload.token = rawValues[2];
  local.db.wp_forms_entries[formsRowId].payload.nested.note = rawValues[3];
  local.db.wp_forms_entries[formsRowId].payload.nested.version = 2;
  const remote = cloneJson(base);

  const blockedPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const blocker = blockedPlan.blockers[0];
  const refusalEvidence = blocker.unknownPluginOwnedResourceRefusalEvidence;
  const serializedEvidence = serializedPlanEvidence(blockedPlan);
  const serializedEvidenceText = JSON.stringify(serializedEvidence);

  assert.equal(blockedPlan.status, 'blocked');
  assertPlanSummaryMatchesEvidence(blockedPlan, 'RPP-0268 variant 4 blocked plan');
  assert.deepEqual(blockedPlan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(blockedPlan.mutations.length, 0, 'unknown plugin-owned resource must not emit mutations');
  assert.equal(
    blockedPlan.preconditions.some((precondition) => precondition.resourceKey === formsResource.key),
    false,
    'unknown plugin-owned resource must not emit a live-remote precondition',
  );
  assert.deepEqual(
    serializedEvidence,
    serializedPlanEvidence(replayPlan),
    'variant 4 refusal evidence must be deterministic across replayed planner inputs',
  );

  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(blocker.resourceKey, formsResource.key);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, null);
  assert.equal(blocker.policySource, null);
  assert.match(blocker.baseHash, sha256HexPattern);
  assert.match(blocker.localHash, sha256HexPattern);
  assert.match(blocker.remoteHash, sha256HexPattern);
  assert.equal(blocker.baseHash, blocker.remoteHash);
  assert.notEqual(blocker.localHash, blocker.baseHash);
  assert.equal(refusalEvidence.schemaVersion, 1);
  assert.equal(refusalEvidence.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(refusalEvidence.operation, 'planner-refusal');
  assert.equal(refusalEvidence.outcome, 'blocked-before-mutation');
  assert.equal(refusalEvidence.format, 'hash-only');
  assert.equal(refusalEvidence.rawValuesIncluded, false);
  assert.equal(refusalEvidence.resourceKey, formsResource.key);
  assert.deepEqual(refusalEvidence.hashes, {
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
  });
  assert.equal(refusalEvidence.change.localChange, 'update');
  assert.equal(refusalEvidence.change.remoteChange, 'unchanged');
  assert.match(serializedEvidence.evidenceHash, sha256EvidencePattern);
  assertNoRawValues(blockedPlan, rawValues, 'RPP-0268 full blocked plan');
  assertNoRawValues(serializedEvidenceText, rawValues, 'RPP-0268 serialized plan evidence');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(serializedEvidence, {
    label: 'RPP-0268 serialized plan evidence',
  }));

  const blockedRemote = cloneJson(remote);
  const blockedRemoteBefore = digest(blockedRemote);
  const blockedError = captureError(() => applyPlan(blockedRemote, blockedPlan, { mutateRemote: true }));

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.deepEqual(blockedError.details, { status: 'blocked' });
  assert.equal(digest(blockedRemote), blockedRemoteBefore, 'blocked plan application changed remote state');
  assertNoRawValues(blockedError.details, rawValues, 'RPP-0268 blocked-plan refusal');

  const forgedReadyPlan = forgedReadyPlanFromUnknownBlocker(blockedPlan, local, remote);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBefore = digest(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedReadyPlan, { mutateRemote: true }));
  const forgedRefusalEvidence = {
    code: forgedError.code,
    mutationId: forgedError.details.mutationId,
    resourceKey: forgedError.details.resourceKey,
    pluginOwner: forgedError.details.pluginOwner,
    driver: forgedError.details.driver,
    reasonCode: forgedError.details.applyValidationEvidence.reasonCode,
    outcome: forgedError.details.applyValidationEvidence.outcome,
    detailsHash: sha256Evidence(forgedError.details),
    remoteHashBefore: `sha256:${forgedRemoteBefore}`,
    remoteHashAfter: `sha256:${digest(forgedRemote)}`,
  };

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(forgedError.details.resourceKey, formsResource.key);
  assert.equal(forgedError.details.pluginOwner, 'forms');
  assert.equal(forgedError.details.driver, null);
  assert.equal(forgedError.details.applyValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(digest(forgedRemote), forgedRemoteBefore, 'forged ready plan changed remote state');
  assert.match(forgedRefusalEvidence.detailsHash, sha256EvidencePattern);
  assert.equal(forgedRefusalEvidence.remoteHashAfter, forgedRefusalEvidence.remoteHashBefore);
  assertNoRawValues(forgedError.details, rawValues, 'RPP-0268 forged apply refusal');
  assertNoRawValues(forgedRefusalEvidence, rawValues, 'RPP-0268 forged refusal evidence');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(forgedRefusalEvidence, {
    label: 'RPP-0268 forged refusal evidence',
  }));
});
