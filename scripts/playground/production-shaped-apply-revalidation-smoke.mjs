#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';
import { getResource, resourceHash, deserializeResourceValue } from '../../src/resources.js';
import { checkedDurableJournalBoundarySatisfied } from '../../src/recovery-journal.js';
import { ABSENT, deepClone, digest } from '../../src/stable-json.js';
import {
  loadAuthSessionSourceFromRuntimeEnvironment,
  resolveAuthSessionRequestState,
} from './auth-session-source.js';
import {
  evaluateProductionAuthSessionLifecycleSummary,
  summarizeProductionAuthSessionLifecycleTrace,
} from './production-auth-session-lifecycle.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
// The proof may boot both remote-base and local-edited Playground sources
// before it can reach the apply boundary. Keep the readiness window aligned
// with the production-shaped smoke scripts that do the same two-source startup.
const serverStartupTimeoutMs = 180_000;
const serverFetchTimeoutMs = 3_000;
const requestTimeoutMs = 10_000;
const readinessProbeIntervalMs = 500;
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const credentials = {
  username: process.env.REPRINT_PUSH_USERNAME || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || 'reprint_push_admin',
  password:
    process.env.REPRINT_PUSH_APPLICATION_PASSWORD
    || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD
    || 'reprint-push-admin-app-password',
};
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';
const requiredPreservedRemoteRetryPath = process.env.REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH || '/snapshot';
const externalRemoteBaseUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const externalRemoteChangedUrl = process.env.REPRINT_PUSH_REMOTE_CHANGED_URL || '';
const externalLocalEditedUrl = process.env.REPRINT_PUSH_LOCAL_URL || '';
const authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const authSessionSource = loadAuthSessionSourceFromRuntimeEnvironment(
  authSessionSourceCommand,
  process.env,
  process.cwd(),
  {
    sourceUrl: externalRemoteBaseUrl,
    remoteUrl: externalRemoteChangedUrl,
    localUrl: externalLocalEditedUrl,
  },
);
const resolvedAuthSessionRequest = resolveAuthSessionRequestState({
  liveSourceUrl: externalRemoteBaseUrl,
  username: credentials.username,
  applicationPassword: credentials.password,
}, authSessionSource, {
  preferSource: requireProductionAuthSession,
});
const resolvedCredentials = {
  username: resolvedAuthSessionRequest.username,
  password: resolvedAuthSessionRequest.applicationPassword,
};
const resolvedExternalRemoteBaseUrl = resolvedAuthSessionRequest.liveSourceUrl || externalRemoteBaseUrl;

const remoteBlueprint = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localBlueprint = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const activePlaygroundChildren = new Set();
let currentOperation = 'startup';
process.on('beforeExit', stopAllPlaygroundChildrenSync);
process.on('exit', stopAllPlaygroundChildrenSync);
process.on('SIGINT', () => {
  stopAllPlaygroundChildrenSync();
});
process.on('SIGTERM', () => {
  stopAllPlaygroundChildrenSync();
});
process.on('uncaughtException', (error) => {
  handleFatalProcessError(error, 'uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  handleFatalProcessError(reason, 'unhandled rejection');
});

try {
  if (requireProductionAuthSession && authSessionSourceCommand && !authSessionSource?.ok) {
    emitInvalidAuthSessionSourceProof();
    process.exitCode = 1;
  } else if (resolvedExternalRemoteBaseUrl) {
    const localSnapshot = externalLocalEditedUrl
      ? await exportSnapshot('local-edited', externalLocalEditedUrl)
      : exportSnapshotFromBlueprint('local-edited', localBlueprint);
    await runApplyRevalidationProof({
      remoteServer: { name: 'remote-base', baseUrl: resolvedExternalRemoteBaseUrl },
      localServer: {
        name: externalLocalEditedUrl ? 'local-edited' : 'local-edited-blueprint',
        baseUrl: externalLocalEditedUrl || null,
      },
      localSnapshot,
      externalTopology: true,
    });
  } else {
    await withPlaygroundServer('remote-base', remoteBlueprint, async (remoteServer) => {
      await runApplyRevalidationProof({
        remoteServer,
        localServer: { name: 'local-edited-blueprint', baseUrl: null },
        localSnapshot: exportSnapshotFromBlueprint('local-edited', localBlueprint),
        externalTopology: false,
      });
    });
  }
} catch (error) {
  stopAllPlaygroundChildrenSync();
  throw error;
}

async function runApplyRevalidationProof({ remoteServer, localServer, localSnapshot, externalTopology }) {
  currentOperation = 'build authenticated client';
  const client = authenticatedHttpClient({
    sourceUrl: remoteServer.baseUrl,
    credential: resolvedCredentials,
    routeProfile: 'production-shaped',
    requestTimeoutMs,
    simulatePreservedRemoteRetryPath: requiredPreservedRemoteRetryPath,
  });
  const authSessionLifecycleTrace = [];

  currentOperation = 'preflight /preflight';
  const preflight = await client.signedGet('/preflight');
  assert.equal(preflight.status, 200, `production-shaped apply revalidation preflight HTTP ${preflight.status}`);
  assert.equal(preflight.body.ok, true);
  assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
  assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'preflight', preflight.body?.auth);

  currentOperation = `export snapshot remote-base ${remoteServer.baseUrl}`;
  const base = await exportSnapshot('remote-base', remoteServer.baseUrl);
  currentOperation = localServer.baseUrl
    ? `export snapshot local-edited ${localServer.baseUrl}`
    : 'export snapshot local-edited blueprint';
  const local = withoutUnmappedGraphPostmeta(
    localSnapshot || await exportSnapshot('local-edited', localServer.baseUrl),
  );
  const sourcePlan = createPushPlan({ base, local, remote: base });
  const plan = readyPlanFromSupportedMutations(sourcePlan);
  assert.equal(plan.status, 'ready');
  assert.ok(plan.mutations.length > 0, 'apply revalidation proof needs at least one mutation');

  const driftTarget = plan.mutations[0];
  assert.ok(driftTarget, 'apply revalidation proof needs a prepared mutation target');
  assert.equal(
    plan.mutations.findIndex((mutation) => mutation.id === driftTarget.id),
    0,
    'apply revalidation drift target must be the first mutation',
  );
  const driftPayload = driftPayloadForMutation(base, driftTarget);
  const session = preflight.body.session.id;
  const idempotencyKey = `production-shaped-apply-revalidation-smoke-${Date.now()}-${process.pid}`;
  const missingReceiptIdempotencyKey = `${idempotencyKey}-missing-receipt`;

  process.stderr.write('apply-revalidation: missing receipt /apply\n');
  currentOperation = 'missing receipt /apply';
  const missingReceipt = await client.signedPost('/apply', { plan }, { session, idempotencyKey: missingReceiptIdempotencyKey });
  assert.equal(missingReceipt.status, 428);
  assert.equal(missingReceipt.body.ok, false);
  assert.equal(missingReceipt.body.code, 'MISSING_DRY_RUN_RECEIPT');
  const afterMissingReceipt = await exportSnapshot('remote-after-missing-receipt', remoteServer.baseUrl);
  assertTargetSurfaceEqual(afterMissingReceipt, base, 'missing receipt apply must be read-only for target resources');

  process.stderr.write('apply-revalidation: dry-run /dry-run\n');
  currentOperation = 'dry-run /dry-run';
  const dryRun = await client.signedPost('/dry-run', { plan }, { session, idempotencyKey });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  assertReceiptBindsReleaseInput({
    receipt: dryRun.body.receipt,
    plan,
    sourceUrl: remoteServer.baseUrl,
    idempotencyKey,
  });
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'dry-run', dryRun.body?.auth);
  const afterDryRun = await exportSnapshot('remote-after-dry-run', remoteServer.baseUrl);
  assertTargetSurfaceEqual(afterDryRun, base, 'dry-run must be read-only for target resources');

  process.stderr.write('apply-revalidation: apply /apply\n');
  currentOperation = 'apply /apply';
  const applyBody = {
    plan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: driftTarget.id,
      resourceKey: driftTarget.resourceKey,
      ...driftPayload,
    },
  };
  const apply = await client.signedPost('/apply', {
    ...applyBody,
  }, { session, idempotencyKey });
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.applied, 0, 'stale remote must fail before the first mutation is applied');
  assert.equal(apply.body.applyRevalidation?.phase, 'before-first-mutation');
  assert.equal(apply.body.applyRevalidation?.checkedAgainst, 'live-remote');
  assert.equal(apply.body.applyRevalidation?.verifiedCount, plan.mutations.length);
  assert.equal(
    apply.body.applyRevalidation?.receiptBinding?.dryRunIdempotencyKeyHash,
    apply.body.applyRevalidation?.claim?.activeClaimKeyHash,
    'apply claim must reuse the dry-run receipt idempotency binding',
  );
  assert.equal(apply.body.rejectedRemoteEvidence?.preservedRemoteChange, true);
  assert.equal(apply.body.rejectedRemoteEvidence?.appliedBeforeFailure, 0);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.equal(apply.body.recovery?.required, true);
  assert.equal(apply.body.recovery?.state, 'blocked-recovery');
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'apply', apply.body?.auth);
  const afterApply = await exportSnapshot('remote-after-apply-rejected', remoteServer.baseUrl);
  assert.equal(resourceHash(afterApply, driftTarget.resource), apply.body.actualHash);
  assert.notEqual(resourceHash(afterApply, driftTarget.resource), driftTarget.localHash);
  assertNoPlannedMutationApplied(afterApply, plan);

  process.stderr.write('apply-revalidation: replay rejected /apply\n');
  currentOperation = 'replay rejected /apply';
  const replay = await client.signedPost('/apply', applyBody, { session, idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'replay', replay.body?.auth);
  const afterReplay = await exportSnapshot('remote-after-replayed-rejection', remoteServer.baseUrl);
  assertTargetSurfaceEqual(afterReplay, afterApply, 'replayed rejection must not overwrite preserved remote changes');

  process.stderr.write('apply-revalidation: recovery inspect /recovery/inspect\n');
  currentOperation = 'recovery inspect /recovery/inspect';
  const recoveryInspect = await client.signedPost('/recovery/inspect', {
    plan,
    receipt: dryRun.body.receipt,
  }, { session, idempotencyKey });
  assert.equal(recoveryInspect.status, 200);
  assert.equal(recoveryInspect.body.ok, true);
  assert.ok(recoveryInspect.body.recovery?.counts?.blockedUnknown >= 1);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'recovery-inspect', recoveryInspect.body?.auth);

  process.stderr.write('apply-revalidation: db journal /db-journal\n');
  currentOperation = 'db journal /db-journal';
  const dbJournal = await client.signedGet('/db-journal?limit=80', {
    session,
    idempotencyKey,
    retryable: true,
  });
  assert.equal(dbJournal.status, 200);
  assert.equal(dbJournal.body.ok, true);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'journal', dbJournal.body?.auth);
  const mutationOrdering = summarizeMutationOrdering(dbJournal.body, driftTarget.id);
  assert.equal(mutationOrdering.ordered, true, JSON.stringify(mutationOrdering, null, 2));
  assert.equal(mutationOrdering.mutationAppliedBeforeFailure, 0);
  assert.equal(mutationOrdering.applyCommitted, false);

  process.stderr.write('apply-revalidation: preserved remote retry /snapshot\n');
  currentOperation = `preserved remote retry ${requiredPreservedRemoteRetryPath}`;
  const preservedRemoteSnapshot = await client.signedGet(requiredPreservedRemoteRetryPath, {
    session,
    retryable: true,
  });
  assert.equal(preservedRemoteSnapshot.status, 200);
  assert.equal(preservedRemoteSnapshot.body.ok, true);

  const authSessionLifecycleSummary = summarizeProductionAuthSessionLifecycleTrace(authSessionLifecycleTrace);
  const authSessionLifecycle = evaluateProductionAuthSessionLifecycleSummary(authSessionLifecycleSummary);
  const recoveryJournal = recoveryInspect.body?.recovery?.journal || null;
  const checkedDurableJournalAccepted = checkedDurableJournalBoundarySatisfied(recoveryJournal);
  const preservedRemoteRetryAttempts = preservedRemoteSnapshot.retryAttempts || 1;
  const boundary = buildApplyRevalidationBoundary({
    authSessionLifecycle,
    checkedDurableJournalAccepted,
    preservedRemoteRetryAttempts,
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    topology: {
      sourceUrl: remoteServer.baseUrl,
      remoteBase: remoteServer.baseUrl,
      remoteChanged: externalRemoteChangedUrl || null,
      localEdited: localServer.baseUrl || localServer.name,
      externalTopology,
      proxyPolicy: 'local-only',
      ingressPort: 8080,
    },
    authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource, remoteServer.baseUrl),
    planning: {
      sourceStatus: sourcePlan.status,
      sourceSummary: sourcePlan.summary,
      proofPlanStatus: plan.status,
      proofPlanHash: digest(plan),
      proofMutationCount: plan.mutations.length,
      excludedBlockers: sourcePlan.blockers.length,
      excludedConflicts: sourcePlan.conflicts.length,
    },
    preflight: {
      status: preflight.status,
      routeProfile: preflight.body.routeProfile,
      session: {
        id: preflight.body.session.id,
        type: preflight.body.session.type,
      },
    },
    dryRun: {
      status: dryRun.status,
      mode: dryRun.body.mode,
      receiptHash: dryRun.body.receipt.receiptHash,
      readOnly: {
        targetSurfaceUnchanged: digest(targetSurface(afterDryRun)) === digest(targetSurface(base)),
        beforeHash: digest(targetSurface(base)),
        afterHash: digest(targetSurface(afterDryRun)),
      },
      receiptBinding: summarizeReceiptBinding(dryRun.body.receipt),
    },
    apply: {
      status: apply.status,
      code: apply.body.code,
      preconditionCheck: apply.body.preconditionCheck,
      applied: apply.body.applied,
      applyRevalidation: apply.body.applyRevalidation,
      storageGuard: apply.body.storageGuard,
      rejectedRemoteEvidence: apply.body.rejectedRemoteEvidence,
      recovery: apply.body.recovery,
    },
    replay: {
      status: replay.status,
      code: replay.body.code,
      replayed: replay.body.idempotency?.replayed === true,
      freshMutationWork: replay.body.idempotency?.freshMutationWork === true,
      preservedRemoteUnchanged: digest(targetSurface(afterReplay)) === digest(targetSurface(afterApply)),
    },
    recoveryInspect: {
      status: recoveryInspect.status,
      recovery: recoveryInspect.body.recovery,
    },
    dbJournal: {
      status: dbJournal.status,
      ordering: mutationOrdering,
      rowCount: dbJournal.body.dbJournal?.rowCount ?? null,
    },
    missingReceipt: {
      status: missingReceipt.status,
      code: missingReceipt.body.code,
      readOnly: digest(targetSurface(afterMissingReceipt)) === digest(targetSurface(base)),
    },
    authSessionLifecycle: {
      summary: authSessionLifecycleSummary,
      trace: authSessionLifecycleTrace,
      evaluation: authSessionLifecycle,
    },
    durableJournal: {
      journal: recoveryJournal,
      checkedAccepted: checkedDurableJournalAccepted,
    },
    replayAndRetry: {
      required: requiredPreservedRemoteRetryPath,
      observed: preservedRemoteRetryAttempts > 1 ? requiredPreservedRemoteRetryPath : 'missing-transient-retry',
      retryAttempts: preservedRemoteRetryAttempts,
      verdict: preservedRemoteRetryAttempts > 1 ? 'PRESERVED_REMOTE_RETRY_PROVEN' : 'PRESERVED_REMOTE_RETRY_REQUIRED',
    },
    boundary,
  }, null, 2));
  process.stdout.write('\n');
}

function summarizeAuthSessionSource(command, source, fallbackSourceUrl = '') {
  if (!command) {
    return null;
  }

  return {
    command,
    ok: Boolean(source?.ok),
    sourceUrl: source?.sourceUrl || fallbackSourceUrl || '',
    username: source?.username || resolvedCredentials.username || '',
    applicationPasswordPresent: Boolean(source?.applicationPassword || resolvedCredentials.password),
    error: source?.error || '',
  };
}

function readyPlanFromSupportedMutations(sourcePlan) {
  if (sourcePlan.status === 'ready') {
    return sourcePlan;
  }

  assert.equal(
    sourcePlan.conflicts.length,
    0,
    'apply revalidation proof refuses to derive a focused plan from a conflicted source plan',
  );
  assert.ok(
    sourcePlan.mutations.length > 0,
    'apply revalidation proof needs planner-produced supported mutations',
  );

  const mutationIds = new Set(sourcePlan.mutations.map((mutation) => mutation.id));
  const focused = deepClone(sourcePlan);
  focused.id = `${sourcePlan.id}-supported-mutations`;
  focused.status = 'ready';
  focused.mutations = focused.mutations.filter((mutation) => mutationIds.has(mutation.id));
  focused.preconditions = focused.preconditions.filter((precondition) => mutationIds.has(precondition.mutationId));
  focused.conflicts = [];
  focused.blockers = [];
  focused.decisions = [];
  focused.atomicGroups = focused.atomicGroups.filter((group) =>
    focused.mutations.some((mutation) => mutation.atomicGroupId && mutation.atomicGroupId === group.id),
  );
  focused.summary = {
    mutations: focused.mutations.length,
    decisions: focused.decisions.length,
    conflicts: focused.conflicts.length,
    blockers: focused.blockers.length,
    atomicGroups: focused.atomicGroups.length,
  };

  assert.equal(
    focused.preconditions.length,
    focused.mutations.length,
    'focused apply revalidation plan must preserve one precondition per mutation',
  );

  return focused;
}

function assertReceiptBindsReleaseInput({ receipt, plan, sourceUrl, idempotencyKey }) {
  assert.equal(receipt?.mode, 'dry-run');
  assert.equal(receipt?.planHash, digest(plan));
  assert.equal(receipt?.mutationSetHash, receipt?.authBinding?.preconditions?.mutationSetHash);
  assert.equal(receipt?.preconditionSetHash, receipt?.authBinding?.preconditions?.preconditionSetHash);
  assert.equal(receipt?.mutationCount, plan.mutations.length);
  assert.equal(receipt?.authBinding?.preconditions?.mutationCount, plan.mutations.length);
  assert.equal(receipt?.authBinding?.request?.planPayloadHash, digest(plan));
  assert.equal(receipt?.authBinding?.request?.dryRunBodyHash, digest({ plan }));
  assert.equal(
    receipt?.authBinding?.pushSession?.dryRunIdempotencyKeyHash,
    sha256Hex(idempotencyKey),
  );
  assert.match(receipt?.authBinding?.pushSession?.sessionHash || '', /^[a-f0-9]{64}$/);
  assert.match(receipt?.authBinding?.source?.sourceHash || '', /^[a-f0-9]{64}$/);
  assert.equal(
    normalizeUrlForEvidence(receipt?.authBinding?.source?.siteUrl || ''),
    normalizeUrlForEvidence(sourceUrl),
  );

  const withoutHash = deepClone(receipt);
  const receiptHash = withoutHash.receiptHash;
  delete withoutHash.receiptHash;
  assert.equal(digest(withoutHash), receiptHash, 'dry-run receipt must bind its full body');
}

function summarizeReceiptBinding(receipt) {
  const binding = receipt?.authBinding || {};
  return {
    planHash: receipt?.planHash || null,
    receiptHash: receipt?.receiptHash || null,
    mutationSetHash: receipt?.mutationSetHash || null,
    preconditionSetHash: receipt?.preconditionSetHash || null,
    sourceHash: binding.source?.sourceHash || null,
    sessionHash: binding.pushSession?.sessionHash || null,
    dryRunIdempotencyKeyHash: binding.pushSession?.dryRunIdempotencyKeyHash || null,
    dryRunBodyHash: binding.request?.dryRunBodyHash || null,
    dryRunRawBodyHash: binding.request?.dryRunRawBodyHash || null,
  };
}

function driftPayloadForMutation(snapshot, mutation) {
  const resource = mutation.resource || {};
  if (resource.type === 'file') {
    return {
      value: {
        type: 'file',
        content: 'production-shaped apply revalidation drift',
      },
    };
  }

  const current = getResource(snapshot, resource);
  const planned = deserializeResourceValue(mutation.value);
  const sourceValue = current === ABSENT ? planned : current;
  if (sourceValue === ABSENT) {
    return {
      value: fallbackValueForCreatedResource(resource),
    };
  }

  if (resource.type === 'row') {
    return {
      value: driftRowValue(resource, sourceValue),
    };
  }

  if (resource.type === 'plugin') {
    return {
      value: {
        ...deepClone(sourceValue),
        active: sourceValue?.active === true ? false : true,
      },
    };
  }

  throw new Error(`Unsupported drift target resource type: ${resource.type}`);
}

function fallbackValueForCreatedResource(resource) {
  if (resource.type === 'row') {
    if (resource.table === 'wp_posts') {
      const id = Number(String(resource.id || '').replace(/^ID:/, '')) || 999999;
      return {
        ID: id,
        post_title: 'production-shaped apply revalidation drift',
        post_name: 'production-shaped-apply-revalidation-drift',
        post_content: '',
        post_status: 'draft',
        post_type: 'post',
        post_parent: 0,
        post_author: 1,
      };
    }
    if (resource.table === 'wp_options') {
      return {
        option_name: String(resource.id || '').replace(/^option_name:/, ''),
        option_value: 'production-shaped apply revalidation drift',
        __pluginOwner: 'forms',
      };
    }
    if (resource.table === 'wp_postmeta') {
      return {
        post_id: 1,
        meta_key: 'reprint_push_forms_schema',
        meta_value: 'production-shaped apply revalidation drift',
        __pluginOwner: 'forms',
      };
    }
    if (resource.table === 'wp_reprint_push_forms_lab') {
      return {
        id: Number(String(resource.id || '').replace(/^id:/, '')) || 1,
        form_slug: 'production-shaped-apply-revalidation',
        payload: { drift: true },
        updated_marker: 'production-shaped apply revalidation drift',
        __pluginOwner: 'forms',
      };
    }
  }
  if (resource.type === 'plugin') {
    const name = String(resource.name || 'reprint-push-drift-plugin');
    return {
      name,
      version: '0.0.0-drift',
      pluginFile: `${name}/${name}.php`,
      active: false,
      __pluginOwner: name,
    };
  }
  throw new Error(`No fallback drift value for ${resource.type}:${resource.key || ''}`);
}

function driftRowValue(resource, value) {
  const next = deepClone(value);
  if (resource.table === 'wp_posts') {
    next.post_title = 'production-shaped apply revalidation drift';
    return next;
  }
  if (resource.table === 'wp_options') {
    next.option_value = typeof next.option_value === 'object' && next.option_value !== null
      ? { ...next.option_value, reprint_push_apply_revalidation_drift: true }
      : 'production-shaped apply revalidation drift';
    return next;
  }
  if (resource.table === 'wp_postmeta') {
    next.meta_value = typeof next.meta_value === 'object' && next.meta_value !== null
      ? { ...next.meta_value, reprint_push_apply_revalidation_drift: true }
      : 'production-shaped apply revalidation drift';
    return next;
  }
  if (resource.table === 'wp_reprint_push_forms_lab') {
    next.updated_marker = 'production-shaped apply revalidation drift';
    return next;
  }
  throw new Error(`Unsupported row drift target table: ${resource.table}`);
}

function assertNoPlannedMutationApplied(snapshot, plan) {
  for (const mutation of plan.mutations) {
    assert.notEqual(
      resourceHash(snapshot, mutation.resource),
      mutation.localHash,
      `mutation ${mutation.id} reached planned after hash unexpectedly`,
    );
  }
}

function summarizeMutationOrdering(body, mutationId) {
  const rows = journalRows(body);
  const sequence = (event, predicate = () => true) => {
    const row = rows.find((entry) => entry.event === event && predicate(entry));
    return row ? Number(row.sequence || 0) : null;
  };
  const matchesMutation = (entry) =>
    String(entry.resourceHashEvidence?.mutation?.mutationId || '') === mutationId;
  const idempotencyOpened = sequence('idempotency-opened');
  const applyStarted = sequence('apply-started');
  const mutationPrepared = sequence('mutation-prepared', matchesMutation);
  const storageReady = sequence('mutation-storage-write-ready', matchesMutation);
  const preconditionFailed = sequence('mutation-precondition-failed', matchesMutation);
  const applyRejected = sequence('apply-rejected');
  const applyReplayed = sequence('apply-replayed');
  const applyCommitted = rows.some((entry) => entry.event === 'apply-committed');
  const mutationAppliedBeforeFailure = rows.filter((entry) =>
    entry.event === 'mutation-applied'
    && Number(entry.sequence || 0) > 0
    && preconditionFailed !== null
    && Number(entry.sequence || 0) < preconditionFailed
  ).length;
  const ordered = [
    idempotencyOpened,
    applyStarted,
    mutationPrepared,
    storageReady,
    preconditionFailed,
    applyRejected,
    applyReplayed,
  ].every((item) => Number.isInteger(item) && item > 0)
    && idempotencyOpened < applyStarted
    && applyStarted < mutationPrepared
    && mutationPrepared < storageReady
    && storageReady < preconditionFailed
    && preconditionFailed < applyRejected
    && applyRejected < applyReplayed;

  return {
    ordered,
    idempotencyOpened,
    applyStarted,
    mutationPrepared,
    storageReady,
    preconditionFailed,
    applyRejected,
    applyReplayed,
    mutationAppliedBeforeFailure,
    applyCommitted,
  };
}

function journalRows(body) {
  if (Array.isArray(body?.dbJournal?.latestRows)) {
    return body.dbJournal.latestRows;
  }
  if (Array.isArray(body?.journal?.latestRows)) {
    return body.journal.latestRows;
  }
  return [];
}

function assertTargetSurfaceEqual(actual, expected, label) {
  assert.deepEqual(targetSurface(actual), targetSurface(expected), `${label} target surface mismatch`);
  assert.equal(digest(targetSurface(actual)), digest(targetSurface(expected)), `${label} target surface hash mismatch`);
}

function targetSurface(snapshot) {
  return {
    files: snapshot?.files || {},
    plugins: snapshot?.plugins || {},
    db: snapshot?.db || {},
  };
}

function normalizeUrlForEvidence(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function emitInvalidAuthSessionSourceProof() {
  process.stdout.write(JSON.stringify({
    ok: false,
    topology: {
      sourceUrl: resolvedExternalRemoteBaseUrl || externalRemoteBaseUrl || '',
      remoteBase: 'remote-base',
      localEdited: externalLocalEditedUrl ? 'local-edited' : null,
      externalTopology: Boolean(externalLocalEditedUrl),
      proxyPolicy: 'local-only',
      ingressPort: 8080,
    },
    authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
    boundary: {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      liveAuthSessionSource: {
        requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
        observed: 'invalid-production-auth-session-source',
        error: authSessionSource?.error || 'invalid auth session source',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    },
  }, null, 2));
  process.stdout.write('\n');
}

function buildApplyRevalidationBoundary({
  authSessionLifecycle,
  checkedDurableJournalAccepted,
  preservedRemoteRetryAttempts,
}) {
  if (!authSessionLifecycle?.ok) {
    return {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: authSessionLifecycle?.required || 'production-auth-session lifecycle',
        observed: authSessionLifecycle?.observed || 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    };
  }

  if (!checkedDurableJournalAccepted) {
    return {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      authSession: {
        required: authSessionLifecycle.required,
        observed: authSessionLifecycle.observed,
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    };
  }

  if (preservedRemoteRetryAttempts < 2) {
    return {
      firstRemainingProductionBoundary: 'replay and preserved-remote retry on the checked release path',
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      authSession: {
        required: authSessionLifecycle.required,
        observed: authSessionLifecycle.observed,
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
      },
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
      replayAndRetry: {
        required: requiredPreservedRemoteRetryPath,
        observed: 'missing-transient-retry',
        retryAttempts: preservedRemoteRetryAttempts,
        verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      },
    };
  }

  return {
    firstRemainingProductionBoundary: null,
    verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    authSession: {
      required: authSessionLifecycle.required,
      observed: authSessionLifecycle.observed,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    replayAndRetry: {
      required: requiredPreservedRemoteRetryPath,
      observed: requiredPreservedRemoteRetryPath,
      retryAttempts: preservedRemoteRetryAttempts,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
  };
}

function recordAuthSessionLifecycle(trace, step, auth) {
  const session = auth?.session;
  if (!session || typeof session !== 'object') {
    return;
  }

  const previous = trace.at(-1) || null;
  trace.push({
    step,
    id: session.id ?? null,
    type: session.type ?? null,
    status: session.status ?? null,
    expiresAt: session.expiresAt ?? null,
    authUser: auth?.identity?.userLogin ?? null,
    expired: session.expired === true || session.status === 'expired',
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: session.cleanedUp === true || session.cleanup === true || session.status === 'cleaned-up',
    rotated: Boolean(previous?.id && session.id && previous.id !== session.id),
    preserved: Boolean(previous?.id && session.id && previous.id === session.id),
  });
}

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${resolvedCredentials.username}:${resolvedCredentials.password}`).toString('base64')}`,
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

function exportSnapshotFromBlueprint(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(
    result.status,
    0,
    `Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function parseMarkedJson(stdout, beginMarker, endMarker, errorMessage) {
  const pattern = new RegExp(`${beginMarker}\\n([\\s\\S]*?)\\n${endMarker}`);
  const match = pattern.exec(stdout);
  assert.ok(match, errorMessage);
  return JSON.parse(match[1]);
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedCredentials.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activePlaygroundChildren.add(child);

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    await waitForServer(child, baseUrl, () => output);
  } catch (error) {
    process.stderr.write(`${output}\n`);
    try {
      await stopPlaygroundChild(child);
    } catch (cleanupError) {
      process.stderr.write(
        `apply-revalidation: cleanup after readiness failure ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
      );
    }
    throw error;
  }
  return { name, baseUrl, port, child };
}

async function stopPlaygroundServer(server) {
  await stopPlaygroundChild(server.child);
  activePlaygroundChildren.delete(server.child);
}

async function stopPlaygroundChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 2_000);
    return;
  } catch (error) {
    child.kill('SIGKILL');
    try {
      await waitForExit(child, 2_000);
    } catch {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }
}

function stopAllPlaygroundChildrenSync() {
  for (const child of activePlaygroundChildren) {
    if (child.exitCode !== null || child.signalCode !== null) {
      activePlaygroundChildren.delete(child);
      continue;
    }
    try {
      child.kill('SIGTERM');
    } catch {}
    try {
      child.kill('SIGKILL');
    } catch {}
    activePlaygroundChildren.delete(child);
  }
}

function handleFatalProcessError(error, label) {
  stopAllPlaygroundChildrenSync();
  process.exitCode = 1;
  if (error instanceof Error) {
    process.stderr.write(`apply-revalidation: ${label} during ${currentOperation}: ${error.stack || error.message}\n`);
    return;
  }
  process.stderr.write(`apply-revalidation: ${label} during ${currentOperation}: ${String(error)}\n`);
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let consecutiveIndex502s = 0;
  let nextHeartbeat = Date.now();
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}${formatProbeTrail(lastProbes)}\n${getLogs()}`);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`apply-revalidation: waiting for Playground at ${baseUrl}\n`);
      nextHeartbeat = Date.now() + 2_000;
    }
    try {
      process.stderr.write('apply-revalidation: probe /wp-json/\n');
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.clone().text().catch(() => '');
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responseBody.slice(0, 500),
      });
      if (response.status === 200) {
        consecutiveIndex502s = 0;
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        });
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        lastProbes.push({
        route: '/wp-json/reprint-push-lab/v1/snapshot',
        status: snapshot.status,
        ok: snapshot.ok,
        body: snapshotBody.slice(0, 500),
      });
      process.stderr.write(`apply-revalidation: snapshot probe HTTP ${snapshot.status}\n`);
      if (snapshot.status === 200) {
        await snapshot.arrayBuffer();
        return;
      }
      lastError = new Error(`Playground lab snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`Playground index readiness HTTP ${response.status}`);
        if (response.status === 502) {
          consecutiveIndex502s += 1;
        } else {
          consecutiveIndex502s = 0;
        }
      }
      if (consecutiveIndex502s >= maxNotReadyReadinessProbes) {
        break;
      }
    } catch (error) {
      lastError = error;
      process.stderr.write(`apply-revalidation: readiness probe error ${error.message}\n`);
      consecutiveIndex502s = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}${formatProbeTrail(lastProbes)}\n${getLogs()}`);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), serverFetchTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(new Error(`Child did not exit within ${timeoutMs}ms${child.pid ? ` (pid ${child.pid})` : ''}`));
    }, timeoutMs);

    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

function formatProbeTrail(lastProbes) {
  if (lastProbes.length === 0) {
    return '';
  }
  return `\nLast probe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`;
}

async function findLocalPort() {
  for (;;) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', () => resolve(false));
    socket.listen(port, '127.0.0.1', () => {
      socket.close(() => resolve(true));
    });
  });
}
