import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  serializedOptionValidationEvidenceForRows,
  validateSerializedOptionRow,
} from '../src/serialized-option-validator.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const owner = 'forms';
const optionName = 'forms_rpp_0448_serialized_state';
const siblingOptionName = 'forms_rpp_0448_unplanned_serialized_state';
const rowId = `option_name:${optionName}`;
const siblingRowId = `option_name:${siblingOptionName}`;
const resourceKey = `row:${JSON.stringify(['wp_options', rowId])}`;
const siblingResourceKey = `row:${JSON.stringify(['wp_options', siblingRowId])}`;
const resource = {
  type: 'row',
  table: 'wp_options',
  id: rowId,
  key: resourceKey,
};

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

function phpString(value) {
  return `s:${Buffer.byteLength(value, 'utf8')}:"${value}";`;
}

function serializedSettings({ mode, opaque, version }) {
  return `a:3:{s:4:"mode";${phpString(mode)}s:6:"opaque";${phpString(opaque)}s:7:"version";i:${version};}`;
}

function malformedSerializedSettings(opaque) {
  return `a:1:{s:6:"opaque";s:${Buffer.byteLength(opaque, 'utf8') + 11}:"${opaque}";}`;
}

function optionRow(optionValue, {
  rowOptionName = optionName,
} = {}) {
  return {
    option_name: rowOptionName,
    option_value: optionValue,
    autoload: 'no',
    serialization: 'php-serialize',
    __pluginOwner: owner,
  };
}

function baseSite({ targetValue, siblingValue }) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture 1.0 */',
    },
    plugins: {
      [owner]: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [rowId]: optionRow(targetValue),
        [siblingRowId]: optionRow(siblingValue, { rowOptionName: siblingOptionName }),
      },
    },
  };
}

function allowedSerializedOptionResource() {
  return {
    resourceKey,
    pluginOwner: owner,
    driver: 'wp-option',
    table: 'wp_options',
    supportsDelete: false,
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function addSerializedOptionPushIntent(site) {
  site.pushIntents = [
    {
      id: 'rpp-0448-serialized-option-validator-v3',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedSerializedOptionResource()),
    },
  ];
  return site;
}

function fixtureSnapshots() {
  const payloads = {
    base: serializedSettings({
      mode: 'base',
      opaque: 'rpp-0448-v3-base-private',
      version: 1,
    }),
    local: serializedSettings({
      mode: 'local',
      opaque: 'rpp-0448-v3-local-private',
      version: 2,
    }),
    remote: serializedSettings({
      mode: 'base',
      opaque: 'rpp-0448-v3-base-private',
      version: 1,
    }),
    siblingBase: serializedSettings({
      mode: 'sibling-base',
      opaque: 'rpp-0448-v3-sibling-base-private',
      version: 1,
    }),
    siblingDrift: serializedSettings({
      mode: 'sibling-drift',
      opaque: 'rpp-0448-v3-sibling-drift-private',
      version: 2,
    }),
    staleRemote: serializedSettings({
      mode: 'stale',
      opaque: 'rpp-0448-v3-stale-remote-private',
      version: 3,
    }),
    invalidLocal: malformedSerializedSettings('rpp-0448-v3-invalid-local-private'),
    invalidForged: malformedSerializedSettings('rpp-0448-v3-invalid-forged-private'),
  };
  const base = baseSite({
    targetValue: payloads.base,
    siblingValue: payloads.siblingBase,
  });
  const local = addSerializedOptionPushIntent(baseSite({
    targetValue: payloads.local,
    siblingValue: payloads.siblingBase,
  }));
  const remote = baseSite({
    targetValue: payloads.remote,
    siblingValue: payloads.siblingBase,
  });

  return {
    base,
    local,
    remote,
    payloads,
    forbiddenPayloads: Object.values(payloads),
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} should be a sha256 hex digest`);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, `${label} should be sha256-prefixed evidence`);
}

function assertNoRawSerializedPayloads(value, forbiddenPayloads, label) {
  const json = JSON.stringify(value);
  for (const forbiddenPayload of forbiddenPayloads) {
    assert.equal(json.includes(forbiddenPayload), false, `${label} leaked raw serialized payload`);
  }
  assert.equal(json.includes('"option_value"'), false, `${label} leaked option_value field`);
  assert.equal(json.includes('rpp-0448-v3-base-private'), false, `${label} leaked base private marker`);
  assert.equal(json.includes('rpp-0448-v3-local-private'), false, `${label} leaked local private marker`);
  assert.equal(json.includes('rpp-0448-v3-invalid-local-private'), false, `${label} leaked invalid local marker`);
  assert.equal(json.includes('rpp-0448-v3-invalid-forged-private'), false, `${label} leaked invalid forged marker`);
}

function assertSerializedValidationEvidence(evidence, { valid, reasonCode, forbiddenPayloads }) {
  assert.equal(evidence.evidenceSource, 'plugin-driver-serialized-option-validator');
  assert.equal(evidence.format, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.table, 'wp_options');
  assert.equal(evidence.serialized, true);
  assert.equal(evidence.valid, valid);
  assert.equal(evidence.reasonCode, reasonCode);
  assert.ok(evidence.snapshots.length >= 1);
  for (const snapshot of evidence.snapshots) {
    assert.equal(snapshot.state, 'present');
    assert.equal(snapshot.serialized, true);
    assertSha256(snapshot.rowHash, `${snapshot.snapshot} rowHash`);
    assertSha256(snapshot.optionValueHash, `${snapshot.snapshot} optionValueHash`);
  }
  assertNoRawSerializedPayloads(evidence, forbiddenPayloads, 'serialized validation evidence');
}

function assertHashOnlyDriverEvidence(mutation, forbiddenPayloads) {
  const {
    auditEvidence,
    driverAuditEvidence,
    driverPayloadValidationEvidence,
  } = mutation.pluginOwnedResource;

  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.resourceKey, resourceKey);
  assert.equal(auditEvidence.pluginOwner, owner);
  assert.equal(auditEvidence.driver, 'wp-option');
  assertSha256(auditEvidence.baseHash, 'audit baseHash');
  assertSha256(auditEvidence.localHash, 'audit localHash');
  assertSha256(auditEvidence.remoteHash, 'audit remoteHash');
  assertSha256(auditEvidence.ownerContextHash, 'audit ownerContextHash');
  assertSha256(auditEvidence.serializedOptionValidationHash, 'audit serializedOptionValidationHash');
  assert.equal(auditEvidence.driverPayloadValidationHash, digest(driverPayloadValidationEvidence));

  assert.equal(driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(driverAuditEvidence.decision, 'supported');
  assert.equal(driverAuditEvidence.redaction, 'hash-only');
  assert.equal(driverAuditEvidence.rawValuesIncluded, false);
  assertSha256(driverAuditEvidence.hashes.baseHash, 'driver audit baseHash');
  assertSha256(driverAuditEvidence.hashes.localHash, 'driver audit localHash');
  assertSha256(driverAuditEvidence.hashes.remoteHash, 'driver audit remoteHash');

  assertSerializedValidationEvidence(driverPayloadValidationEvidence, {
    valid: true,
    reasonCode: 'SERIALIZED_OPTION_VALID',
    forbiddenPayloads,
  });
  assert.equal(driverPayloadValidationEvidence.validator, 'php-serialized-option');
  assert.equal(driverPayloadValidationEvidence.outcome, 'accepted');

  assertNoRawSerializedPayloads(auditEvidence, forbiddenPayloads, 'planner audit evidence');
  assertNoRawSerializedPayloads(driverAuditEvidence, forbiddenPayloads, 'driver audit evidence');
}

test('RPP-0448 generated serialized option validator carries one exact mutation through local apply', () => {
  const {
    base,
    local,
    remote,
    payloads,
    forbiddenPayloads,
  } = fixtureSnapshots();
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const precondition = preconditionFor(plan, mutation);
  const directValidationEvidence = serializedOptionValidationEvidenceForRows({
    resourceKey,
    table: 'wp_options',
    rows: [
      { snapshot: 'base', row: base.db.wp_options[rowId] },
      { snapshot: 'local', row: local.db.wp_options[rowId] },
      { snapshot: 'remote', row: remote.db.wp_options[rowId] },
    ],
  });

  assert.deepEqual(validateSerializedOptionRow(base.db.wp_options[rowId]), {
    serialized: true,
    valid: true,
    reasonCode: 'SERIALIZED_OPTION_VALID',
  });
  assert.deepEqual(validateSerializedOptionRow(local.db.wp_options[rowId]), {
    serialized: true,
    valid: true,
    reasonCode: 'SERIALIZED_OPTION_VALID',
  });
  assertSerializedValidationEvidence(directValidationEvidence, {
    valid: true,
    reasonCode: 'SERIALIZED_OPTION_VALID',
    forbiddenPayloads,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 1,
  });
  assert.deepEqual(plan.mutations.map((entry) => entry.resourceKey), [resourceKey]);
  assert.deepEqual(plan.preconditions.map((entry) => entry.resourceKey), [resourceKey]);
  assert.equal(plan.mutations.some((entry) => entry.resourceKey === siblingResourceKey), false);

  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.atomicGroupId, 'rpp-0448-serialized-option-validator-v3');
  assert.deepEqual(mutation.resource, resource);
  assert.equal(mutation.remoteBeforeHash, resourceHash(remote, resource));
  assert.equal(mutation.localHash, resourceHash(local, resource));
  assert.equal(mutation.pluginOwnedResource.pluginOwner, owner);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'push-intent:rpp-0448-serialized-option-validator-v3');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(
    mutation.pluginOwnedResource.auditEvidence.serializedOptionValidationHash,
    digest(directValidationEvidence),
  );
  assertHashOnlyDriverEvidence(mutation, forbiddenPayloads);

  assert.equal(precondition.resourceKey, resourceKey);
  assert.equal(precondition.mutationId, mutation.id);
  assert.deepEqual(precondition.resource, mutation.resource);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  const liveRemote = cloneJson(remote);
  liveRemote.db.wp_options[siblingRowId].option_value = payloads.siblingDrift;
  const applyValidationEvidence = [];
  const result = applyPlan(liveRemote, plan, {
    mutateRemote: true,
    beforeMutation({ driverApplyValidation }) {
      applyValidationEvidence.push(driverApplyValidation);
    },
  });
  const proof = {
    rpp: 'RPP-0448',
    evidenceSource: 'generated-serialized-option-validator-v3-local-production-apply',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    resourceKey,
    appliedMutations: result.appliedMutations,
    exactMutation: result.site.db.wp_options[rowId].option_value === payloads.local,
    siblingPreserved: result.site.db.wp_options[siblingRowId].option_value === payloads.siblingDrift,
    plannerValidationHash: `sha256:${mutation.pluginOwnedResource.auditEvidence.serializedOptionValidationHash}`,
    driverPayloadValidationHash: sha256Evidence(mutation.pluginOwnedResource.driverPayloadValidationEvidence),
    applyValidationHash: sha256Evidence(applyValidationEvidence[0]),
    preconditionHash: sha256Evidence(precondition),
    appliedRowHash: `sha256:${resourceHash(result.site, resource)}`,
    localRowHash: `sha256:${resourceHash(local, resource)}`,
    journalHash: sha256Evidence(result.journal),
  };
  proof.proofHash = sha256Evidence({
    plannerValidationHash: proof.plannerValidationHash,
    driverPayloadValidationHash: proof.driverPayloadValidationHash,
    applyValidationHash: proof.applyValidationHash,
    preconditionHash: proof.preconditionHash,
    appliedRowHash: proof.appliedRowHash,
    journalHash: proof.journalHash,
  });

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(liveRemote.db.wp_options[rowId], local.db.wp_options[rowId]);
  assert.equal(liveRemote.db.wp_options[siblingRowId].option_value, payloads.siblingDrift);
  assert.deepEqual(result.site.db.wp_options[rowId], local.db.wp_options[rowId]);
  assert.equal(result.site.db.wp_options[siblingRowId].option_value, payloads.siblingDrift);
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].resourceKey, resourceKey);
  assertSha256(result.journal.entries[0].beforeHash, 'journal beforeHash');
  assertSha256(result.journal.entries[0].afterHash, 'journal afterHash');

  assert.equal(applyValidationEvidence.length, 1);
  assert.equal(applyValidationEvidence[0].reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(applyValidationEvidence[0].outcome, 'accepted');
  assert.equal(applyValidationEvidence[0].driverPayloadValidationEvidence.outcome, 'accepted');
  assertSerializedValidationEvidence(applyValidationEvidence[0].serializedOptionValidationEvidence, {
    valid: true,
    reasonCode: 'SERIALIZED_OPTION_VALID',
    forbiddenPayloads,
  });

  assert.equal(proof.exactMutation, true);
  assert.equal(proof.siblingPreserved, true);
  assert.equal(proof.appliedRowHash, proof.localRowHash);
  for (const hash of [
    proof.plannerValidationHash,
    proof.driverPayloadValidationHash,
    proof.applyValidationHash,
    proof.preconditionHash,
    proof.appliedRowHash,
    proof.localRowHash,
    proof.journalHash,
    proof.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0448 apply proof hash');
  }
  assertNoRawSerializedPayloads(applyValidationEvidence, forbiddenPayloads, 'apply validation evidence');
  assertNoRawSerializedPayloads(result.journal, forbiddenPayloads, 'apply journal');
  assertNoRawSerializedPayloads(proof, forbiddenPayloads, 'apply proof');
});

test('RPP-0448 serialized option validator refuses stale and invalid payloads before mutation', () => {
  const {
    base,
    local,
    remote,
    payloads,
    forbiddenPayloads,
  } = fixtureSnapshots();
  const plan = planFor(base, local, remote);
  const staleRemote = cloneJson(remote);
  staleRemote.db.wp_options[rowId].option_value = payloads.staleRemote;
  const staleRemoteBeforeApply = cloneJson(staleRemote);
  let staleHookCalls = 0;
  const staleError = captureError(() => applyPlan(staleRemote, plan, {
    mutateRemote: true,
    beforeMutation() {
      staleHookCalls += 1;
    },
  }));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleHookCalls, 0);
  assert.equal(staleError.details.resourceKey, resourceKey);
  assertSha256(staleError.details.expectedHash, 'stale expectedHash');
  assertSha256(staleError.details.actualHash, 'stale actualHash');
  assert.notEqual(staleError.details.actualHash, staleError.details.expectedHash);
  assert.deepEqual(staleRemote, staleRemoteBeforeApply);

  const invalidLocal = addSerializedOptionPushIntent(baseSite({
    targetValue: payloads.invalidLocal,
    siblingValue: payloads.siblingBase,
  }));
  const invalidRemote = cloneJson(remote);
  const invalidRemoteBeforeApply = cloneJson(invalidRemote);
  const invalidPlan = planFor(base, invalidLocal, invalidRemote);
  const invalidBlocker = invalidPlan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const invalidApplyError = captureError(() => applyPlan(invalidRemote, invalidPlan, {
    mutateRemote: true,
    beforeMutation() {
      assert.fail('blocked invalid serialized option plan reached beforeMutation');
    },
  }));

  assert.equal(invalidPlan.status, 'blocked');
  assert.equal(invalidPlan.summary.mutations, 0);
  assert.equal(mutationFor(invalidPlan), undefined);
  assert.ok(invalidBlocker, 'invalid serialized option should emit a blocker');
  assert.equal(invalidBlocker.class, 'invalid-plugin-driver-payload');
  assert.equal(invalidBlocker.reasonCode, 'INVALID_SERIALIZED_OPTION_PAYLOAD');
  assert.equal(invalidBlocker.resourceKey, resourceKey);
  assert.equal(invalidBlocker.driver, 'wp-option');
  assert.equal(invalidBlocker.pluginOwner, owner);
  assert.match(invalidBlocker.reason, /Serialized option validator refused/);
  assertSerializedValidationEvidence(invalidBlocker.serializedOptionValidationEvidence, {
    valid: false,
    reasonCode: 'SERIALIZED_OPTION_STRING_LENGTH_MISMATCH',
    forbiddenPayloads,
  });
  assert.equal(invalidBlocker.driverPayloadValidationEvidence.outcome, 'refused');
  assert.equal(invalidBlocker.driverPayloadValidationEvidence.validator, 'php-serialized-option');
  assert.equal(invalidBlocker.driverPayloadValidationEvidence.rawValuesIncluded, false);
  assert.ok(invalidApplyError instanceof PushPlanError);
  assert.equal(invalidApplyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(invalidApplyError.details, { status: 'blocked' });
  assert.deepEqual(invalidRemote, invalidRemoteBeforeApply);

  const forgedPlan = cloneJson(plan);
  const forgedMutation = mutationFor(forgedPlan);
  const forgedValue = deserializeResourceValue(forgedMutation.value);
  forgedValue.option_value = payloads.invalidForged;
  forgedMutation.value = serializeResourceValue(forgedValue);
  forgedMutation.localHash = digest(forgedValue);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBeforeApply = cloneJson(forgedRemote);
  let forgedHookCalls = 0;
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedPlan, {
    mutateRemote: true,
    beforeMutation() {
      forgedHookCalls += 1;
    },
  }));
  const applyRefusalEvidence = forgedError.details.applyValidationEvidence;
  const refusalProof = {
    rpp: 'RPP-0448',
    evidenceSource: 'generated-serialized-option-validator-v3-refusal',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    stale: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      remoteBeforeHash: sha256Evidence(staleRemoteBeforeApply),
      remoteAfterHash: sha256Evidence(staleRemote),
      rowBeforeHash: `sha256:${resourceHash(staleRemoteBeforeApply, resource)}`,
      rowAfterHash: `sha256:${resourceHash(staleRemote, resource)}`,
      hookCalls: staleHookCalls,
    },
    invalidPlanner: {
      code: invalidApplyError.code,
      blockerHash: sha256Evidence(invalidBlocker),
      validatorEvidenceHash: sha256Evidence(invalidBlocker.serializedOptionValidationEvidence),
      remoteBeforeHash: sha256Evidence(invalidRemoteBeforeApply),
      remoteAfterHash: sha256Evidence(invalidRemote),
      rowBeforeHash: `sha256:${resourceHash(invalidRemoteBeforeApply, resource)}`,
      rowAfterHash: `sha256:${resourceHash(invalidRemote, resource)}`,
    },
    invalidApply: {
      code: forgedError.code,
      reasonCode: forgedError.details.reasonCode,
      detailsHash: sha256Evidence(forgedError.details),
      applyValidationEvidenceHash: sha256Evidence(applyRefusalEvidence),
      serializedOptionValidationHash: sha256Evidence(applyRefusalEvidence.serializedOptionValidationEvidence),
      remoteBeforeHash: sha256Evidence(forgedRemoteBeforeApply),
      remoteAfterHash: sha256Evidence(forgedRemote),
      rowBeforeHash: `sha256:${resourceHash(forgedRemoteBeforeApply, resource)}`,
      rowAfterHash: `sha256:${resourceHash(forgedRemote, resource)}`,
      hookCalls: forgedHookCalls,
    },
  };
  refusalProof.proofHash = sha256Evidence({
    stale: refusalProof.stale,
    invalidPlanner: refusalProof.invalidPlanner,
    invalidApply: refusalProof.invalidApply,
  });

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(forgedError.details.reasonCode, 'INVALID_SERIALIZED_OPTION_PAYLOAD');
  assert.equal(forgedHookCalls, 0);
  assert.equal(applyRefusalEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(applyRefusalEvidence.outcome, 'refused-before-mutation');
  assert.equal(applyRefusalEvidence.driverPayloadValidationEvidence.outcome, 'refused');
  assertSerializedValidationEvidence(applyRefusalEvidence.serializedOptionValidationEvidence, {
    valid: false,
    reasonCode: 'SERIALIZED_OPTION_STRING_LENGTH_MISMATCH',
    forbiddenPayloads,
  });
  assert.deepEqual(forgedRemote, forgedRemoteBeforeApply);

  assert.equal(refusalProof.stale.remoteAfterHash, refusalProof.stale.remoteBeforeHash);
  assert.equal(refusalProof.stale.rowAfterHash, refusalProof.stale.rowBeforeHash);
  assert.equal(refusalProof.invalidPlanner.remoteAfterHash, refusalProof.invalidPlanner.remoteBeforeHash);
  assert.equal(refusalProof.invalidPlanner.rowAfterHash, refusalProof.invalidPlanner.rowBeforeHash);
  assert.equal(refusalProof.invalidApply.remoteAfterHash, refusalProof.invalidApply.remoteBeforeHash);
  assert.equal(refusalProof.invalidApply.rowAfterHash, refusalProof.invalidApply.rowBeforeHash);
  for (const hash of [
    refusalProof.stale.detailsHash,
    refusalProof.stale.remoteBeforeHash,
    refusalProof.stale.remoteAfterHash,
    refusalProof.stale.rowBeforeHash,
    refusalProof.stale.rowAfterHash,
    refusalProof.invalidPlanner.blockerHash,
    refusalProof.invalidPlanner.validatorEvidenceHash,
    refusalProof.invalidPlanner.remoteBeforeHash,
    refusalProof.invalidPlanner.remoteAfterHash,
    refusalProof.invalidPlanner.rowBeforeHash,
    refusalProof.invalidPlanner.rowAfterHash,
    refusalProof.invalidApply.detailsHash,
    refusalProof.invalidApply.applyValidationEvidenceHash,
    refusalProof.invalidApply.serializedOptionValidationHash,
    refusalProof.invalidApply.remoteBeforeHash,
    refusalProof.invalidApply.remoteAfterHash,
    refusalProof.invalidApply.rowBeforeHash,
    refusalProof.invalidApply.rowAfterHash,
    refusalProof.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0448 refusal proof hash');
  }
  assertNoRawSerializedPayloads(staleError.details, forbiddenPayloads, 'stale refusal details');
  assertNoRawSerializedPayloads(invalidBlocker, forbiddenPayloads, 'invalid planner blocker');
  assertNoRawSerializedPayloads(applyRefusalEvidence, forbiddenPayloads, 'invalid apply refusal evidence');
  assertNoRawSerializedPayloads(forgedError.details, forbiddenPayloads, 'invalid apply error details');
  assertNoRawSerializedPayloads(refusalProof, forbiddenPayloads, 'refusal proof');
});
