import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const formsOptionRowId = 'option_name:forms_settings';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite({ rowMode = 'rpp0434-remote-owned-row-preserved' } = {}) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* rpp0434 forms owner file */',
    },
    plugins: {
      forms: {
        version: '1.0.0',
        active: true,
        channel: 'rpp0434-base-channel',
      },
    },
    db: {
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: rowMode,
            auditLabel: 'rpp0434-row-audit-base',
          },
          __pluginOwner: 'forms',
        },
      },
    },
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { resourceKey, pluginOwner, driver, ...extra };
}

function withFormsOptionPolicy(site) {
  site.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
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

function assertSha256Evidence(value, label) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/, label);
}

function assertBareSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, label);
}

function assertNoRawValues(evidence, rawValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const value of rawValues) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw value ${value}`);
  }
}

function hashOnlyRefusalEvidence(plan, remoteBeforeHash, remoteAfterHash) {
  const blocker = blockerFor(plan, formsOptionResourceKey);
  const metadataRefusal = blocker.ownerMetadataRefusalEvidence;
  return {
    rpp: 'RPP-0434',
    evidenceSource: 'local-focused-node-test',
    productionBacked: false,
    format: 'hash-only',
    rawValuesIncluded: false,
    status: plan.status,
    summary: plan.summary,
    pluginDecision: {
      resourceKey: formsPluginResourceKey,
      decision: decisionFor(plan, formsPluginResourceKey)?.decision || null,
      decisionHash: sha256Evidence(decisionFor(plan, formsPluginResourceKey)),
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      blockerHash: sha256Evidence(blocker),
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      driverAuditHash: sha256Evidence(blocker.driverAuditEvidence),
    },
    metadataRefusal: {
      reasonCode: metadataRefusal.reasonCode,
      operation: metadataRefusal.operation,
      stalePluginMetadataResourceKeys: metadataRefusal.stalePluginMetadataResourceKeys,
      context: metadataRefusal.context,
      evidenceHash: sha256Evidence(metadataRefusal),
    },
    ownerContextRefusalHash: sha256Evidence(blocker.ownerContextRefusalEvidence),
    remotePreservation: {
      remoteBeforeHash,
      remoteAfterHash,
    },
  };
}

function hashOnlyReplayEvidence({
  readyPlan,
  mutation,
  ownerMetadataContext,
  staleError,
  staleRemote,
  rowHashBefore,
  rowHashAfter,
  remoteHashBefore,
  remoteHashAfter,
}) {
  return {
    rpp: 'RPP-0434',
    evidenceSource: 'local-focused-node-test',
    productionBacked: false,
    format: 'hash-only',
    rawValuesIncluded: false,
    readyPlan: {
      status: readyPlan.status,
      summary: readyPlan.summary,
      mutationHash: sha256Evidence(mutation),
      preconditionHash: sha256Evidence(
        readyPlan.preconditions.find((entry) => entry.resourceKey === formsOptionResourceKey),
      ),
    },
    ownerMetadataContext: {
      resourceKey: ownerMetadataContext.resourceKey,
      remoteHash: ownerMetadataContext.remoteHash,
      contextHash: sha256Evidence(ownerMetadataContext),
    },
    refusal: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      contextResourceKey: staleError.details.contextResourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
    },
    remotePreservation: {
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${rowHashAfter}`,
      remoteHashBefore,
      remoteHashAfter,
      staleRemoteHash: sha256Evidence(staleRemote),
    },
  };
}

test('RPP-0434 planner refuses stale plugin metadata owner context before mutation with hash-only evidence', () => {
  const rawValues = [
    'rpp0434-local-owned-row-attempt',
    'rpp0434-remote-owned-row-preserved',
    '9.9.9-rpp0434-remote-metadata',
    'rpp0434-remote-metadata-channel',
    'rpp0434-remote-metadata-note',
  ];
  const base = baseSite();
  const local = withFormsOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = rawValues[0];
  const remote = cloneJson(base);
  remote.plugins.forms = {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
    note: rawValues[4],
  };
  const remoteBeforeJson = JSON.stringify(remote);
  const remoteBeforeHash = sha256Evidence(remote);

  const plan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const blocker = blockerFor(plan, formsOptionResourceKey);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockedError = captureError(() => applyPlan(remote, plan));
  const remoteAfterHash = sha256Evidence(remote);
  const hashEvidence = hashOnlyRefusalEvidence(plan, remoteBeforeHash, remoteAfterHash);
  const replayHashEvidence = hashOnlyRefusalEvidence(replayPlan, remoteBeforeHash, remoteAfterHash);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(plan.preconditions.some((precondition) => precondition.resourceKey === formsOptionResourceKey), false);
  assert.equal(decisionFor(plan, formsPluginResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.reason, `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`);
  assert.equal(blocker.ownerContextRefusalEvidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(blocker.driverAuditEvidence.decision, 'blocked');

  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context.length, 1);
  assert.deepEqual(Object.keys(evidence.context[0]).sort(), [
    'baseHash',
    'localChange',
    'localHash',
    'remoteChange',
    'remoteHash',
    'resourceKey',
  ]);
  assert.equal(evidence.context[0].resourceKey, formsPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assertBareSha256(evidence.context[0].baseHash, 'metadata base hash');
  assertBareSha256(evidence.context[0].localHash, 'metadata local hash');
  assertBareSha256(evidence.context[0].remoteHash, 'metadata remote hash');
  assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);
  assert.deepEqual(hashEvidence, replayHashEvidence, 'hash-only refusal evidence should be deterministic');

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(remote.db.wp_options[formsOptionRowId].option_value.mode, rawValues[1]);
  assert.deepEqual(remote.plugins.forms, {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
    note: rawValues[4],
  });
  assert.equal(hashEvidence.remotePreservation.remoteBeforeHash, hashEvidence.remotePreservation.remoteAfterHash);
  assertSha256Evidence(hashEvidence.blocker.blockerHash, 'blocker evidence hash');
  assertSha256Evidence(hashEvidence.metadataRefusal.evidenceHash, 'metadata refusal evidence hash');
  assertSha256Evidence(hashEvidence.ownerContextRefusalHash, 'owner-context refusal evidence hash');
  assertNoRawValues(blocker, rawValues, 'planner blocker');
  assertNoRawValues(evidence, rawValues, 'metadata refusal evidence');
  assertNoRawValues(hashEvidence, rawValues, 'hash-only planner evidence');
});

test('RPP-0434 stale live plugin metadata replay refuses before mutating plugin-owned remote data', () => {
  const rawValues = [
    'rpp0434-local-owned-row-replay-attempt',
    'rpp0434-remote-owned-row-preserved',
    '9.9.9-rpp0434-stale-live-metadata',
    'rpp0434-stale-live-channel',
  ];
  const base = baseSite();
  const local = withFormsOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = rawValues[0];
  const readyRemote = cloneJson(base);
  const readyPlan = planFor(base, local, readyRemote);
  const replayReadyPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(readyRemote));
  const mutation = mutationFor(readyPlan, formsOptionResourceKey);
  const ownerMetadataContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === formsPluginResourceKey,
  );

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(ownerMetadataContext, 'ready mutation should carry plugin metadata owner context');
  assert.equal(
    mutation.pluginOwnedResource.ownerContext.some((context) => context.resourceKey === formsPluginFileResourceKey),
    true,
    'ready mutation should also carry owner plugin file context',
  );
  assert.deepEqual(
    readyPlan.mutations.map((entry) => sha256Evidence(entry)),
    replayReadyPlan.mutations.map((entry) => sha256Evidence(entry)),
    'ready mutation hash evidence should be deterministic',
  );

  const staleRemote = cloneJson(base);
  staleRemote.plugins.forms = {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
  };
  const staleRemoteBeforeJson = JSON.stringify(staleRemote);
  const rowHashBefore = resourceHash(staleRemote, mutation.resource);
  const remoteHashBefore = sha256Evidence(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan));
  const rowHashAfter = resourceHash(staleRemote, mutation.resource);
  const remoteHashAfter = sha256Evidence(staleRemote);
  const replayEvidence = hashOnlyReplayEvidence({
    readyPlan,
    mutation,
    ownerMetadataContext,
    staleError,
    staleRemote,
    rowHashBefore,
    rowHashAfter,
    remoteHashBefore,
    remoteHashAfter,
  });
  replayEvidence.proofHash = sha256Evidence({
    readyPlan: replayEvidence.readyPlan,
    ownerMetadataContext: replayEvidence.ownerMetadataContext,
    refusal: replayEvidence.refusal,
    remotePreservation: replayEvidence.remotePreservation,
  });

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.resourceKey, formsOptionResourceKey);
  assert.equal(staleError.details.pluginOwner, 'forms');
  assert.equal(staleError.details.contextResourceKey, formsPluginResourceKey);
  assert.equal(staleError.details.expectedHash, ownerMetadataContext.remoteHash);
  assertBareSha256(staleError.details.actualHash, 'stale metadata actual hash');
  assert.notEqual(staleError.details.actualHash, staleError.details.expectedHash);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBeforeJson);
  assert.equal(staleRemote.db.wp_options[formsOptionRowId].option_value.mode, rawValues[1]);
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remoteHashAfter, remoteHashBefore);
  assert.equal(replayEvidence.remotePreservation.rowHashAfter, replayEvidence.remotePreservation.rowHashBefore);
  assert.equal(replayEvidence.remotePreservation.remoteHashAfter, replayEvidence.remotePreservation.remoteHashBefore);
  assertSha256Evidence(replayEvidence.readyPlan.mutationHash, 'ready mutation hash');
  assertSha256Evidence(replayEvidence.ownerMetadataContext.contextHash, 'owner metadata context hash');
  assertSha256Evidence(replayEvidence.refusal.detailsHash, 'stale refusal details hash');
  assertSha256Evidence(replayEvidence.proofHash, 'stale replay proof hash');
  assertNoRawValues(staleError.details, rawValues, 'stale refusal details');
  assertNoRawValues(replayEvidence, rawValues, 'hash-only stale replay evidence');
});
