import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const ownerPlugin = 'rpp-0455-termmeta-owner';
const ownerPluginResourceKey = `plugin:${ownerPlugin}`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;
const termmetaRowId = 'meta_id:9455';
const termmetaResourceKey = `row:["wp_termmeta","${termmetaRowId}"]`;
const supportOnlyScope = 'local/support-only';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const rawFixtures = Object.freeze({
  baseTermmetaMode: 'RPP_0455_BASE_TERM_META_PRIVATE',
  localTermmetaMode: 'RPP_0455_LOCAL_TERM_META_PRIVATE',
  remoteTermmetaMode: 'RPP_0455_REMOTE_TERM_META_PRESERVED',
  ownerPluginFile: 'RPP_0455_OWNER_PLUGIN_FILE_PRIVATE',
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function ownerPluginResource() {
  return {
    type: 'plugin',
    name: ownerPlugin,
    key: ownerPluginResourceKey,
  };
}

function ownerPluginFileResource() {
  return {
    type: 'file',
    path: ownerPluginFilePath,
    key: ownerPluginFileResourceKey,
  };
}

function termmetaResource() {
  return {
    type: 'row',
    table: 'wp_termmeta',
    id: termmetaRowId,
    key: termmetaResourceKey,
  };
}

function baseSite({ termmetaMode = rawFixtures.baseTermmetaMode } = {}) {
  return {
    files: {
      [ownerPluginFilePath]: `<?php /* ${rawFixtures.ownerPluginFile} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: '1.0.0',
        active: true,
      },
    },
    db: {
      wp_terms: {
        'term_id:455': {
          term_id: 455,
          name: 'RPP 0455 remote plugin removal fixture',
          slug: 'rpp-0455-remote-plugin-removal-fixture',
          term_group: 0,
        },
      },
      wp_termmeta: {
        [termmetaRowId]: {
          meta_id: 9455,
          term_id: 455,
          meta_key: '_rpp_0455_remote_plugin_removal',
          meta_value: {
            mode: termmetaMode,
            proof: 'hash-only remote plugin removal refusal fixture',
          },
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function allowedTermmetaResource() {
  return {
    resourceKey: termmetaResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-termmeta',
  };
}

function attachSupportOnlyPolicy(site) {
  site.meta = {
    pushPolicy: {
      pluginOwnedResources: {
        evidenceScope: supportOnlyScope,
        allowedResources: [allowedTermmetaResource()],
      },
    },
  };
  return site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
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

function supportOnlyReleaseGate(evidenceScope = supportOnlyScope) {
  return {
    status: 'NO-GO',
    evidenceScope,
    sourceKind: supportOnlyScope,
    productionBacked: false,
    note:
      'RPP-0455 remote plugin removal refusal evidence is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
  };
}

function hashOnlyRefusalProof({
  plan,
  blocker,
  evidence,
  blockedError,
  remoteBeforeHash,
  remoteAfterHash,
  rowHashBefore,
  rowHashAfter,
}) {
  const proof = {
    rpp: 'RPP-0455',
    evidenceSource: 'generated-remote-plugin-removal-refusal-v3',
    status: 'support_only',
    format: 'hash-only',
    rawValuesIncluded: false,
    productionBacked: false,
    releaseGate: supportOnlyReleaseGate(evidence.releaseGateEvidenceScope),
    plan: {
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      pluginDecisionHash: sha256Evidence(decisionFor(plan, ownerPluginResourceKey)),
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      policySource: blocker.policySource,
      blockerHash: sha256Evidence(blocker),
      driverAuditHash: sha256Evidence(blocker.driverAuditEvidence),
    },
    refusal: {
      reasonCode: evidence.reasonCode,
      operation: evidence.operation,
      proofScope: evidence.proofScope,
      releaseGateEvidenceScope: evidence.releaseGateEvidenceScope,
      productionBacked: evidence.productionBacked,
      releaseGateNoteHash: sha256Evidence(evidence.releaseGateNote),
      evidenceHash: sha256Evidence(evidence),
      contextHashes: evidence.context.map((context) => ({
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
      })),
    },
    blockedApply: {
      code: blockedError.code,
      detailsHash: sha256Evidence(blockedError.details),
    },
    remotePreservation: {
      remoteBeforeHash,
      remoteAfterHash,
      rowHashBefore,
      rowHashAfter,
    },
  };

  proof.proofHash = sha256Evidence({
    releaseGate: proof.releaseGate,
    plan: proof.plan,
    blocker: proof.blocker,
    refusal: proof.refusal,
    blockedApply: proof.blockedApply,
    remotePreservation: proof.remotePreservation,
  });
  return proof;
}

function assertSha256(value, label) {
  assert.match(value, sha256HexPattern, `${label} should be a SHA-256 hash`);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, `${label} should be a sha256-prefixed hash`);
}

function assertHashOnlyEvidence(value, label) {
  const json = JSON.stringify(value);
  for (const raw of Object.values(rawFixtures)) {
    assert.equal(json.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(json.includes('meta_value'), false, `${label} leaked meta_value`);
  assert.equal(json.includes('hash-only remote plugin removal refusal fixture'), false, `${label} leaked row payload`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0455 generated remote plugin removal refusal is local support-only and hash-only', () => {
  const base = baseSite();
  const local = attachSupportOnlyPolicy(baseSite({
    termmetaMode: rawFixtures.localTermmetaMode,
  }));
  const remote = baseSite();
  delete remote.plugins[ownerPlugin];
  const remoteBeforeJson = JSON.stringify(remote);
  const remoteBeforeHash = sha256Evidence(remote);
  const rowHashBefore = `sha256:${resourceHash(remote, termmetaResource())}`;

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, termmetaResourceKey);
  const evidence = blocker.remotePluginRemovalRefusalEvidence;
  const blockedError = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
  }));
  const remoteAfterHash = sha256Evidence(remote);
  const rowHashAfter = `sha256:${resourceHash(remote, termmetaResource())}`;
  const proof = hashOnlyRefusalProof({
    plan,
    blocker,
    evidence,
    blockedError,
    remoteBeforeHash,
    remoteAfterHash,
    rowHashBefore,
    rowHashAfter,
  });

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(plan.preconditions.length, 0);
  assert.equal(mutationFor(plan, termmetaResourceKey), undefined);
  assert.equal(decisionFor(plan, ownerPluginResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, ownerPluginFileResourceKey), undefined);

  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, termmetaResourceKey);
  assert.equal(blocker.pluginOwner, ownerPlugin);
  assert.equal(blocker.driver, 'wp-termmeta');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(blocker.driverAuditEvidence.decision, 'blocked');
  assert.equal(blocker.driverAuditEvidence.rawValuesIncluded, false);
  assert.deepEqual(blocker.ownerContextRefusalEvidence, evidence);

  assert.equal(evidence.reasonCode, 'REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.format, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.proofScope, 'local-focused');
  assert.equal(evidence.releaseGateEvidenceScope, supportOnlyScope);
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseGateNote, 'Local proof only; production-backed release gate evidence is still required.');
  assert.equal(evidence.resourceKey, termmetaResourceKey);
  assert.equal(evidence.pluginOwner, ownerPlugin);
  assert.deepEqual(evidence.removedPluginResourceKeys, [ownerPluginResourceKey]);
  assert.equal(evidence.context.length, 1);
  assert.equal(evidence.context[0].resourceKey, ownerPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'delete');
  assertSha256(evidence.context[0].baseHash, 'owner plugin base hash');
  assertSha256(evidence.context[0].localHash, 'owner plugin local hash');
  assertSha256(evidence.context[0].remoteHash, 'owner plugin remote hash');
  assert.equal(evidence.context[0].localHash, evidence.context[0].baseHash);
  assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.equal(blockedError.details.status, 'blocked');
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(remoteAfterHash, remoteBeforeHash);
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remote.db.wp_termmeta[termmetaRowId].meta_value.mode, rawFixtures.baseTermmetaMode);

  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.evidenceScope, supportOnlyScope);
  assert.equal(proof.releaseGate.sourceKind, supportOnlyScope);
  assert.equal(proof.releaseGate.productionBacked, false);
  assert.match(proof.releaseGate.note, /local\/support-only/);
  assert.match(proof.releaseGate.note, /productionBacked=false/);
  assert.match(proof.releaseGate.note, /production-backed release gate evidence is still required/);

  for (const hash of [
    proof.plan.pluginDecisionHash,
    proof.blocker.blockerHash,
    proof.blocker.driverAuditHash,
    proof.refusal.releaseGateNoteHash,
    proof.refusal.evidenceHash,
    proof.blockedApply.detailsHash,
    proof.remotePreservation.remoteBeforeHash,
    proof.remotePreservation.remoteAfterHash,
    proof.remotePreservation.rowHashBefore,
    proof.remotePreservation.rowHashAfter,
    proof.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0455 support-only refusal proof hash');
  }
  assertHashOnlyEvidence(blocker, 'RPP-0455 planner blocker');
  assertHashOnlyEvidence(evidence, 'RPP-0455 remote plugin removal evidence');
  assertHashOnlyEvidence(blockedError.details, 'RPP-0455 blocked apply details');
  assertHashOnlyEvidence(proof, 'RPP-0455 generated support-only proof');
});

test('RPP-0455 stale ready plan refuses remote owner plugin removal before executor mutation', () => {
  const base = baseSite();
  const local = attachSupportOnlyPolicy(baseSite({
    termmetaMode: rawFixtures.localTermmetaMode,
  }));
  const readyRemote = baseSite();
  const staleRemote = baseSite();
  delete staleRemote.plugins[ownerPlugin];
  const staleRemoteBeforeJson = JSON.stringify(staleRemote);
  const staleRemoteHashBefore = sha256Evidence(staleRemote);
  const staleRowHashBefore = `sha256:${resourceHash(staleRemote, termmetaResource())}`;
  let beforeMutationCalls = 0;

  const readyPlan = planFor(base, local, readyRemote);
  const readyMutation = mutationFor(readyPlan, termmetaResourceKey);
  const ownerPluginContext = readyMutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginResourceKey,
  );
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const staleRemoteHashAfter = sha256Evidence(staleRemote);
  const staleRowHashAfter = `sha256:${resourceHash(staleRemote, termmetaResource())}`;
  const replayProof = {
    rpp: 'RPP-0455',
    evidenceSource: 'generated-remote-plugin-removal-refusal-v3-stale-ready-plan',
    status: 'support_only',
    format: 'hash-only',
    rawValuesIncluded: false,
    productionBacked: false,
    releaseGate: supportOnlyReleaseGate(
      readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
    ),
    readyPlan: {
      status: readyPlan.status,
      mutationCount: readyPlan.mutations.length,
      preconditionCount: readyPlan.preconditions.length,
      mutationHash: sha256Evidence({
        resourceKey: readyMutation.resourceKey,
        action: readyMutation.action,
        baseHash: readyMutation.baseHash,
        localHash: readyMutation.localHash,
        remoteBeforeHash: readyMutation.remoteBeforeHash,
      }),
      ownerContextHash: sha256Evidence(readyMutation.pluginOwnedResource.ownerContext),
      ownerPluginContextHash: sha256Evidence(ownerPluginContext),
      driverAuditHash: sha256Evidence(readyMutation.pluginOwnedResource.driverAuditEvidence),
      driverEvidenceHash: sha256Evidence(readyMutation.pluginOwnedResource.driverEvidence),
      releaseGateEvidenceScope: readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
    },
    refusal: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      contextResourceKey: staleError.details.contextResourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      beforeMutationCalls,
    },
    remotePreservation: {
      staleRemoteHashBefore,
      staleRemoteHashAfter,
      staleRowHashBefore,
      staleRowHashAfter,
    },
  };
  replayProof.proofHash = sha256Evidence({
    releaseGate: replayProof.releaseGate,
    readyPlan: replayProof.readyPlan,
    refusal: replayProof.refusal,
    remotePreservation: replayProof.remotePreservation,
  });

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-termmeta');
  assert.equal(readyMutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(readyMutation.pluginOwnedResource.driverEvidence.evidenceScope, supportOnlyScope);
  assert.equal(readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope, supportOnlyScope);
  assert.equal(readyMutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(readyMutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.ok(ownerPluginContext);
  assert.equal(ownerPluginContext.resourceKey, ownerPluginResourceKey);
  assertSha256(ownerPluginContext.remoteHash, 'ready owner plugin context hash');

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.mutationId, readyMutation.id);
  assert.equal(staleError.details.resourceKey, termmetaResourceKey);
  assert.equal(staleError.details.pluginOwner, ownerPlugin);
  assert.equal(staleError.details.contextResourceKey, ownerPluginResourceKey);
  assert.equal(staleError.details.expectedHash, ownerPluginContext.remoteHash);
  assertSha256(staleError.details.actualHash, 'stale removed owner plugin hash');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBeforeJson);
  assert.equal(staleRemoteHashAfter, staleRemoteHashBefore);
  assert.equal(staleRowHashAfter, staleRowHashBefore);
  assert.equal(staleRemote.db.wp_termmeta[termmetaRowId].meta_value.mode, rawFixtures.baseTermmetaMode);

  assert.equal(replayProof.releaseGate.status, 'NO-GO');
  assert.equal(replayProof.releaseGate.evidenceScope, supportOnlyScope);
  assert.equal(replayProof.releaseGate.productionBacked, false);
  assert.match(replayProof.releaseGate.note, /local\/support-only/);

  for (const hash of [
    replayProof.readyPlan.mutationHash,
    replayProof.readyPlan.ownerContextHash,
    replayProof.readyPlan.ownerPluginContextHash,
    replayProof.readyPlan.driverAuditHash,
    replayProof.readyPlan.driverEvidenceHash,
    replayProof.refusal.detailsHash,
    replayProof.remotePreservation.staleRemoteHashBefore,
    replayProof.remotePreservation.staleRemoteHashAfter,
    replayProof.remotePreservation.staleRowHashBefore,
    replayProof.remotePreservation.staleRowHashAfter,
    replayProof.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0455 stale ready-plan proof hash');
  }
  assertHashOnlyEvidence(readyMutation.pluginOwnedResource.auditEvidence, 'RPP-0455 ready audit evidence');
  assertHashOnlyEvidence(readyMutation.pluginOwnedResource.driverAuditEvidence, 'RPP-0455 ready driver audit evidence');
  assertHashOnlyEvidence(readyMutation.pluginOwnedResource.driverEvidence, 'RPP-0455 ready driver evidence');
  assertHashOnlyEvidence(staleError.details, 'RPP-0455 stale ready-plan details');
  assertHashOnlyEvidence(replayProof, 'RPP-0455 stale ready-plan proof');
});
