import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createPushPlan } from '../src/planner.js';
import {
  buildManualRecoveryAuditExport,
  manualRecoveryAuditExportProvesRecoveryGate,
} from '../src/recovery-audit-export.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T13:00:00.000Z');
const sourceUrl = 'http://127.0.0.1:8080';
const checkedRecoveryPath = 'artifact://rpp-0680-manual-recovery-audit-export-v4/checked-recovery-path';
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0680:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0680-alpha.txt': 'rpp-0680-base-private-alpha',
      'rpp-0680-bravo.txt': 'rpp-0680-base-private-bravo',
      'rpp-0680-charlie.txt': 'rpp-0680-base-private-charlie',
      'rpp-0680-delta.txt': 'rpp-0680-base-private-delta',
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0680-alpha.txt'] = 'rpp-0680-local-private-alpha';
  site.files['rpp-0680-bravo.txt'] = 'rpp-0680-local-private-bravo';
  site.files['rpp-0680-charlie.txt'] = 'rpp-0680-local-private-charlie';
  site.files['rpp-0680-delta.txt'] = 'rpp-0680-local-private-delta';
  return site;
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0680-base-private-alpha',
    'rpp-0680-base-private-bravo',
    'rpp-0680-base-private-charlie',
    'rpp-0680-base-private-delta',
    'rpp-0680-local-private-alpha',
    'rpp-0680-local-private-bravo',
    'rpp-0680-local-private-charlie',
    'rpp-0680-local-private-delta',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function assertNoRawValues(value, rawValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0680 hash-only evidence leaked raw fixture value: ${rawValue}`,
    );
  }
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const recovery = fullyUpdatedRecoveryFromPlan(plan);
  const audit = buildGeneratedManualAudit({ plan, recovery });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  return {
    plan,
    recovery,
    audit,
    rawValues: rawSiteValuesFor(base, local, remote),
  };
}

function fullyUpdatedRecoveryFromPlan(plan) {
  const targets = plan.mutations.map((mutation) => ({
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    state: 'new',
    beforeHash: mutation.remoteBeforeHash,
    afterHash: mutation.localHash,
    observedHash: mutation.localHash,
  }));

  return {
    source: 'RPP-0680 generated release recovery inspect',
    state: 'fully-updated-remote',
    journalState: 'ok',
    checkedPath: checkedRecoveryPath,
    counts: {
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
      total: plan.mutations.length,
    },
    targets,
    journal: buildDurableJournal(),
  };
}

function buildGeneratedManualAudit({ plan, recovery }) {
  return buildManualRecoveryAuditExport({
    recovery,
    plan,
    generatedAt: fixedNow.toISOString(),
    source: {
      kind: 'rpp-0680-generated-release-recovery-inspect',
      path: 'releaseProof.recoveryInspect.recovery',
      releasePath: true,
      readOnly: true,
      mutates: false,
      samePathRequiredForRecoveryMutation: true,
    },
    artifactRefs: {
      recoveryAudit: 'artifact://rpp-0680-manual-recovery-audit-export-v4',
      checkedRecoveryPath,
    },
  });
}

function buildDurableJournal() {
  const activeClaimId = 'rpp-0680-active-claim';
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const previousClaimId = 'rpp-0680-previous-claim';
  const previousClaimKeyHash = fixtureHash('previous-claim-key');
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    expired: true,
    previousClaimExpired: true,
    staleThresholdMs: 1000,
    openedAt: '2026-05-31T13:00:02.000Z',
    expiresAt: '2026-05-31T13:00:03.000Z',
    previousClaimOpenedAt: '2026-05-31T13:00:00.000Z',
    previousClaimExpiresAt: '2026-05-31T13:00:01.000Z',
    previousClaimAgeMs: 2000,
    activeClaimSequence: 20,
    previousClaimSequence: 10,
  };
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId: activeClaimId,
    claimKeyHash: activeClaimKeyHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  };
  const leaseFence = {
    boundary: 'wpdb-single-statement-cas',
    storageGuard: 'wpdb-single-statement-cas',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: cloneJson(writerLease),
  };
  const claim = {
    status: 'stale-claim-rejected',
    activeClaimId,
    activeClaimKeyHash,
    activeClaimSequence: 20,
    activeClaimEvent: 'stale-claim-rejected',
    previousClaimId,
    previousClaimKeyHash,
    previousClaimSequence: 10,
    previousClaimEvent: 'recovery-claim-opened',
    staleClaimRejected: true,
    claimExpiry,
  };

  return {
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    restartReadable: true,
    integrity: {
      status: 'ok',
      schemaVersion: 1,
      scope: 'recovery-gate',
    },
    records: 12,
    claim,
    claimExpiry,
    writerLease,
    leaseFence,
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
  };
}

function buildRecoveryReleaseSummary({
  plan,
  recovery,
  manualRecoveryAuditExport,
}) {
  const mutationCount = plan.mutations.length;
  const originalRequestHash = fixtureHash('accepted-request');
  const conflictingRequestHash = fixtureHash('conflicting-request');
  const durableJournal = buildDurableJournal();
  const oldRemoteRecovery = {
    source: 'RPP-0680 generated stale-owner retry before mutation',
    status: 200,
    state: 'old-remote',
    observedState: 'old-remote',
    counts: {
      old: mutationCount,
      new: 0,
      blockedUnknown: 0,
      total: mutationCount,
    },
    targetEnvelope: {
      total: mutationCount,
      old: mutationCount,
      new: 0,
      blockedUnknown: 0,
      hashOnly: true,
      checkedPath: checkedRecoveryPath,
      allTargetsAccountedFor: true,
    },
  };
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...plan.mutations.map((mutation, index) => ({
      sequence: index + 3,
      event: 'mutation-applied',
      requestHash: originalRequestHash,
      mutationId: mutation.id,
    })),
    { sequence: mutationCount + 3, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: mutationCount + 4, event: 'apply-replayed', requestHash: originalRequestHash },
    { sequence: mutationCount + 5, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];

  return {
    topology: {
      sourceUrl,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    manualRecoveryAuditExport,
    durableJournal: {
      proof: {
        journal: durableJournal,
        leaseFence: durableJournal.leaseFence,
      },
    },
    releaseProof: {
      plan: {
        mutations: mutationCount,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          ...recovery,
          manualRecoveryAuditExport,
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
        targetSnapshotUnchanged: true,
        recoveryState: {
          source: 'RPP-0680 generated different-body conflict recovery state',
          storage: 'sqlite',
          state: 'fully-updated-remote',
          restartReadable: true,
          counts: {
            old: 0,
            new: mutationCount,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
      dbJournal: {
        mutationApplied: mutationCount,
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
        required: checkedRecoveryPath,
        observed: checkedRecoveryPath,
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
        checkedAgainst: 'live-remote',
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
        checkedPath: checkedRecoveryPath,
        counts: {
          old: plan.mutations.length - 1,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 30,
        applyReplayed: 31,
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

function generatedRejectedManualAuditCases(audit) {
  return [
    {
      name: 'missing',
      audit: null,
      issues: ['MANUAL_RECOVERY_AUDIT_EXPORT_MISSING'],
    },
    {
      name: 'source-not-release-read-only',
      audit: {
        ...cloneJson(audit),
        source: {
          ...audit.source,
          readOnly: false,
        },
      },
      issues: ['MANUAL_RECOVERY_AUDIT_EXPORT_SOURCE_NOT_RELEASE_READ_ONLY'],
    },
    {
      name: 'state-mismatch',
      audit: {
        ...cloneJson(audit),
        state: 'blocked-recovery',
      },
      issues: ['MANUAL_RECOVERY_AUDIT_EXPORT_RECOVERY_STATE_MISMATCH'],
    },
    {
      name: 'count-mismatch',
      audit: {
        ...cloneJson(audit),
        counts: {
          ...audit.counts,
          new: audit.counts.new - 1,
        },
      },
      issues: [
        'MANUAL_RECOVERY_AUDIT_EXPORT_COUNTS_INCONSISTENT',
        'MANUAL_RECOVERY_AUDIT_EXPORT_RECOVERY_COUNTS_MISMATCH',
      ],
    },
    {
      name: 'target-envelope-not-hash-only',
      audit: {
        ...cloneJson(audit),
        targetEnvelope: {
          ...audit.targetEnvelope,
          rawValuesIncluded: true,
        },
      },
      issues: ['MANUAL_RECOVERY_AUDIT_EXPORT_TARGET_ENVELOPE_NOT_HASH_ONLY'],
    },
    {
      name: 'target-count-mismatch',
      audit: {
        ...cloneJson(audit),
        targets: audit.targets.slice(1),
      },
      issues: ['MANUAL_RECOVERY_AUDIT_EXPORT_TARGET_COUNT_MISMATCH'],
    },
  ];
}

function assertExpectedIssues(validation, generatedCase) {
  for (const issue of generatedCase.issues) {
    assert.equal(
      validation.issues.includes(issue),
      true,
      `${generatedCase.name} should report ${issue}; got ${validation.issues.join(', ')}`,
    );
  }
}

test('RPP-0680 manual recovery audit export variant 4 proves GATE-2 on the same release verifier path', () => {
  const {
    plan,
    recovery,
    audit,
    rawValues,
  } = buildScenario();
  const directAuditProof = manualRecoveryAuditExportProvesRecoveryGate(audit, {
    planMutationCount: plan.mutations.length,
    recovery,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    plan,
    recovery,
    manualRecoveryAuditExport: audit,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(audit.kind, 'manual-recovery-audit-export');
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.source.path, 'releaseProof.recoveryInspect.recovery');
  assert.equal(audit.source.releasePath, true);
  assert.equal(audit.source.readOnly, true);
  assert.equal(audit.source.mutates, false);
  assert.equal(audit.source.samePathRequiredForRecoveryMutation, true);
  assert.equal(audit.artifactRefs.checkedRecoveryPath, checkedRecoveryPath);
  assert.deepEqual(audit.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(audit.targetEnvelope.hashOnly, true);
  assert.equal(audit.targetEnvelope.rawValuesIncluded, false);
  assert.equal(audit.targetEnvelope.exportedTargets, plan.mutations.length);
  assert.equal(audit.targets.length, plan.mutations.length);
  for (const target of audit.targets) {
    assert.equal(target.state, 'new');
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
    assert.equal(target.observedHash, target.afterHash);
  }

  assert.equal(directAuditProof.proved, true);
  assert.equal(directAuditProof.source.path, 'releaseProof.recoveryInspect.recovery');
  assert.equal(directAuditProof.targetEnvelope.exportedTargets, plan.mutations.length);
  assert.equal(directAuditProof.targetEnvelope.rawValuesIncluded, false);

  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedRecoveryPath);
  assert.equal(
    releaseSummary.releaseProof.manualRecoveryAuditExport.artifactRefs.checkedRecoveryPath,
    checkedRecoveryPath,
  );
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedRecoveryPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedRecoveryPath);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, sourceUrl);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.source.path, 'releaseProof.recoveryInspect.recovery');
  assert.equal(
    releaseProof.manualRecoveryAuditExport.source.samePathRequiredForRecoveryMutation,
    true,
  );
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.exportedTargets, plan.mutations.length);
  assertNoRawValues({ audit, directAuditProof, releaseSummary, releaseProof }, rawValues);
});

test('RPP-0680 generated manual recovery audit export rejects malformed variant 4 evidence', () => {
  const {
    plan,
    recovery,
    audit,
    rawValues,
  } = buildScenario();

  for (const generatedCase of generatedRejectedManualAuditCases(audit)) {
    const validation = manualRecoveryAuditExportProvesRecoveryGate(generatedCase.audit, {
      planMutationCount: plan.mutations.length,
      recovery,
    });

    assert.equal(validation.proved, false, generatedCase.name);
    assertExpectedIssues(validation, generatedCase);
    assertNoRawValues({ audit: generatedCase.audit, validation }, rawValues);

    if (!generatedCase.audit) {
      continue;
    }

    const releaseProof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary: buildRecoveryReleaseSummary({
        plan,
        recovery,
        manualRecoveryAuditExport: generatedCase.audit,
      }),
      applyRevalidation: buildBlockedApplyRevalidation(plan),
    });

    assert.equal(releaseProof.gate, 'GATE-2', generatedCase.name);
    assert.equal(releaseProof.gateStatus, 'proven', generatedCase.name);
    assert.equal(releaseProof.sameReleaseBoundary, true, generatedCase.name);
    assert.equal(releaseProof.ok, false, generatedCase.name);
    assert.equal(releaseProof.checks.manualRecoveryAuditExport, false, generatedCase.name);
    assert.equal(releaseProof.manualRecoveryAuditExport.proved, false, generatedCase.name);
    assertNoRawValues(releaseProof, rawValues);
  }
});
