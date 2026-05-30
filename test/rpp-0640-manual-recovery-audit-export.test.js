import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPushPlan } from '../src/planner.js';
import {
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  buildManualRecoveryAuditExport,
  inspectRecoveryRepair,
} from '../src/recovery-repair.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0640-manual-recovery-audit-'));
  return path.join(dir, 'recovery.jsonl');
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 4; index++) {
    files[`file-${index}.txt`] = `rpp-0640-base-private-content-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite() {
  const site = baseSite();
  for (let index = 1; index <= 4; index++) {
    site.files[`file-${index}.txt`] = `rpp-0640-local-private-content-${index}`;
  }
  return site;
}

function buildRecoveryReleaseSummary({
  inspection,
  plan,
  oldRemoteRecovery,
  manualRecoveryAuditExport,
}) {
  const mutationEvents = plan.mutations.length;
  const originalRequestHash = 'a'.repeat(64);
  const conflictingRequestHash = 'b'.repeat(64);
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...Array.from({ length: mutationEvents }, (_, index) => ({
      sequence: 3 + index,
      event: 'mutation-applied',
    })),
    { sequence: 3 + mutationEvents, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: 4 + mutationEvents, event: 'apply-replayed', requestHash: originalRequestHash },
    { sequence: 5 + mutationEvents, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: inspection,
    },
    releaseProof: {
      plan: {
        mutations: mutationEvents,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
        },
      },
      manualRecoveryAuditExport,
      replay: {
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      },
      idempotencyConflict: {
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        idempotency: {
          conflict: true,
          freshMutationWork: false,
          originalRequestHash,
          requestHash: conflictingRequestHash,
        },
        recoveryState: {
          source: 'manual recovery audit export different-body recovery proof',
          state: 'fully-updated-remote',
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
          storage: 'sqlite',
          restartReadable: true,
        },
        targetSnapshotUnchanged: true,
      },
      dbJournal: {
        mutationApplied: mutationEvents,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents,
      },
      staleClaimRetry: {
        oldRemoteRecovery,
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: '/snapshot',
        observed: '/snapshot',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation(plan) {
  return {
    ok: true,
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      applyRevalidation: {
        phase: 'before-first-mutation',
      },
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged: true,
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 7,
        applyReplayed: 8,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

test('RPP-0640 manual recovery audit export keeps GATE-2 proven on the checked release path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const local = localSite();
  const plan = createPushPlan({ base: baseSite(), local, remote, now: fixedNow });
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0640-release-proof',
  };
  const activeClaimId = 'rpp-0640-active-claim';
  const retryClaimId = 'rpp-0640-retry-claim';
  const staleThresholdMs = 1_000;

  const initial = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: activeClaimId,
    claimStaleThresholdMs: staleThresholdMs,
  });
  initial.close();

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 5_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs: staleThresholdMs,
  });
  const inspection = retry.inspect();
  retry.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);

  const persisted = readRecoveryJournal(filePath);
  const oldRemoteInspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });
  assert.equal(oldRemoteInspection.status, 'old-remote');

  const manualAuditExport = buildManualRecoveryAuditExport(
    inspectRecoveryRepair({ journalPath: filePath, plan, current: remote }),
    {
      now: fixedNow,
      exportedBy: 'release-manager',
      artifactRefs: {
        recoveryAudit: 'artifact://rpp-0640-manual-recovery-audit',
      },
    },
  );
  const serializedExport = JSON.stringify(manualAuditExport);

  assert.equal(manualAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(manualAuditExport.format, 'hash-only');
  assert.equal(manualAuditExport.rawValuesIncluded, false);
  assert.equal(manualAuditExport.targetEnvelope.complete, true);
  assert.equal(manualAuditExport.targetEnvelope.total, plan.mutations.length);
  assert.equal(manualAuditExport.targets.rollForward.length, plan.mutations.length);
  assert.match(manualAuditExport.exportHash, /^[a-f0-9]{64}$/);
  assert.equal(serializedExport.includes('rpp-0640-base-private-content'), false);
  assert.equal(serializedExport.includes('rpp-0640-local-private-content'), false);

  const oldRemoteRecovery = {
    source: 'manual recovery audit export old-remote classification',
    status: 200,
    state: oldRemoteInspection.status,
    counts: {
      ...oldRemoteInspection.counts,
      total: plan.mutations.length,
    },
  };
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      inspection,
      plan,
      oldRemoteRecovery,
      manualRecoveryAuditExport: manualAuditExport,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.total, plan.mutations.length);
});
