import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import {
  buildManualRecoveryAuditExport,
  manualRecoveryAuditExportProvesRecoveryGate,
  writeManualRecoveryAuditExport,
} from '../src/recovery-audit-export.js';
import { openPlanRecoveryJournal } from '../src/recovery-journal.js';
import { inspectRecoveryRepair } from '../src/recovery-repair.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

function baseSite() {
  const files = {};
  for (let index = 1; index <= 4; index++) {
    files[`file-${index}.txt`] = `base-content-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite() {
  const site = baseSite();
  for (let index = 1; index <= 4; index++) {
    site.files[`file-${index}.txt`] = `local-content-${index}`;
  }
  return site;
}

function planFor(base = baseSite(), local = localSite(), remote = baseSite()) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0620-audit-export-'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setResourceForTest(site, resource, value) {
  if (resource.type !== 'file') {
    throw new Error(`Unexpected test resource type: ${resource.type}`);
  }
  site.files ||= {};
  site.files[resource.path] = value?.type === 'file' ? value.content : value;
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResourceForTest(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function openTargetJournal(filePath, plan, current) {
  const journal = openPlanRecoveryJournal({ filePath, plan, current, now: fixedNow });
  journal.close();
}

test('manual recovery audit export writes hash-only review evidence for drifted repair', () => {
  const dir = tempDir();
  const journalPath = path.join(dir, 'recovery.jsonl');
  const exportPath = path.join(dir, 'manual-recovery-audit.json');
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  openTargetJournal(journalPath, plan, remote);

  applyFirstMutations(current, plan, 1);
  current.files['file-3.txt'] = 'operator-edited-drift';

  const report = inspectRecoveryRepair({ journalPath, plan, current });
  const audit = buildManualRecoveryAuditExport({
    report,
    plan,
    generatedAt: fixedNow.toISOString(),
    source: {
      kind: 'manual-recovery-repair-inspect',
      path: 'inspectRecoveryRepair',
      releasePath: true,
      readOnly: true,
      mutates: false,
    },
    artifactRefs: { focusedProof: 'test/rpp-0620-manual-recovery-audit-export.test.js' },
  });

  assert.equal(audit.kind, 'manual-recovery-audit-export');
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.source.readOnly, true);
  assert.equal(audit.source.mutates, false);
  assert.deepEqual(audit.counts, { old: 2, new: 1, blockedUnknown: 1, total: 4 });
  assert.equal(audit.targetEnvelope.hashOnly, true);
  assert.equal(audit.targetEnvelope.rawValuesIncluded, false);
  assert.equal(audit.targetEnvelope.exportedTargets, 4);
  assert.equal(audit.manualReview.required, true);
  assert.equal(audit.manualReview.mutates, false);
  assert.equal(audit.manualReview.operatorDecisionTemplate.targets.length, 1);
  assert.deepEqual(
    audit.manualReview.operatorDecisionTemplate.targets.map((target) => target.resourceKey),
    ['file:file-3.txt'],
  );

  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes('base-content-'), false);
  assert.equal(serialized.includes('local-content-'), false);
  assert.equal(serialized.includes('operator-edited-drift'), false);
  assert.equal(manualRecoveryAuditExportProvesRecoveryGate(audit, {
    planMutationCount: plan.mutations.length,
    recovery: {
      state: 'blocked-recovery',
      counts: { old: 2, new: 1, blockedUnknown: 1, total: 4 },
    },
  }).proved, true);

  const written = writeManualRecoveryAuditExport(exportPath, {
    report,
    plan,
    generatedAt: fixedNow.toISOString(),
    source: audit.source,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(exportPath, 'utf8')), written);
  assert.equal(JSON.stringify(written).includes('operator-edited-drift'), false);
});

test('release verifier reports manual recovery audit export as proven on the recovery gate path', () => {
  const plan = planFor();
  const mutationCount = plan.mutations.length;
  const releaseSummary = releaseSummaryForManualAudit({ plan });
  const applyRevalidation = {
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: mutationCount - 1,
          new: 0,
          blockedUnknown: 1,
          total: mutationCount,
        },
      },
    },
  };

  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.source.path, 'releaseProof.recoveryInspect.recovery');
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.exportedTargets, mutationCount);
  assert.equal(proof.manualRecoveryAuditExport.counts.new, mutationCount);
});

function releaseSummaryForManualAudit({ plan }) {
  const mutationCount = plan.mutations.length;
  const claim = {
    activeClaimId: 'rpp0620-active-claim',
    activeClaimKeyHash: 'a'.repeat(64),
    activeClaimEvent: 'stale-claim-rejected',
    previousClaimId: 'rpp0620-previous-claim',
    previousClaimKeyHash: 'b'.repeat(64),
    staleClaimRejected: true,
  };
  const writerLease = {
    claimId: claim.activeClaimId,
    claimKeyHash: claim.activeClaimKeyHash,
    staleClaimRejected: true,
    restartReadable: true,
  };
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    expired: true,
    previousClaimExpired: true,
    staleThresholdMs: 0,
    openedAt: '2026-05-30T00:00:02Z',
    expiresAt: '2026-05-30T00:00:02Z',
    previousClaimOpenedAt: '2026-05-30T00:00:01Z',
    previousClaimExpiresAt: '2026-05-30T00:00:02Z',
    previousClaimAgeMs: 0,
    activeClaimSequence: 2,
    previousClaimSequence: 1,
  };
  const journal = {
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim,
    claimExpiry,
    writerLease,
    leaseFence: {
      restartReadable: true,
      staleClaimRejected: true,
      writerLease,
    },
  };
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened' },
    { sequence: 2, event: 'apply-started' },
    ...plan.mutations.map((mutation, index) => ({
      sequence: index + 3,
      event: 'mutation-applied',
      mutationId: mutation.id,
    })),
    { sequence: mutationCount + 3, event: 'apply-committed' },
    { sequence: mutationCount + 4, event: 'apply-replayed' },
    { sequence: mutationCount + 5, event: 'idempotency-key-conflict' },
  ];

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:49152',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: {
        journal,
        leaseFence: journal.leaseFence,
      },
    },
    releaseProof: {
      plan: {
        mutations: mutationCount,
      },
      planObject: plan,
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: mutationCount,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
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
        },
        targetSnapshotUnchanged: true,
      },
      dbJournal: {
        mutationApplied: mutationCount,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents,
      },
      staleClaimRetry: {
        oldRemoteRecovery: {
          source: 'stale-owner retry abandoned before mutation',
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          state: 'old-remote',
          observedState: 'stale-claim-all-old-simulated',
          counts: {
            old: mutationCount,
            new: 0,
            blockedUnknown: 0,
            total: mutationCount,
          },
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
