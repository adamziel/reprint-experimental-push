import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

function buildReleaseSummary() {
  const claim = {
    activeClaimId: 'psh_rpp0615_active_claim',
    activeClaimKeyHash: 'a'.repeat(64),
    activeClaimEvent: 'stale-claim-rejected',
    previousClaimId: 'psh_rpp0615_previous_claim',
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
    staleThresholdMs: 1000,
    openedAt: '2026-05-24T00:00:02Z',
    expiresAt: '2026-05-24T00:00:03Z',
    previousClaimOpenedAt: '2026-05-24T00:00:00Z',
    previousClaimExpiresAt: '2026-05-24T00:00:01Z',
    activeClaimSequence: 20,
    previousClaimSequence: 10,
  };
  const journal = {
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      ...claim,
      claimExpiry,
    },
    claimExpiry,
    writerLease,
    leaseFence: {
      restartReadable: true,
      staleClaimRejected: true,
      writerLease,
    },
  };

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
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
        mutations: 1,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: 1,
            blockedUnknown: 0,
            total: 1,
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
        mutationApplied: 1,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents: [
          { sequence: 1, event: 'idempotency-opened' },
          { sequence: 2, event: 'apply-started' },
          { sequence: 3, event: 'mutation-applied' },
          { sequence: 4, event: 'apply-committed' },
          { sequence: 5, event: 'apply-replayed' },
          { sequence: 6, event: 'idempotency-key-conflict' },
        ],
      },
      staleClaimRetry: {
        oldRemoteRecovery: {
          source: 'stale-owner retry abandoned before mutation',
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          state: 'old-remote',
          counts: {
            old: 1,
            new: 0,
            blockedUnknown: 0,
            total: 1,
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

function buildApplyRevalidation(overrides = {}) {
  const proof = {
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
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: 1,
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
    durableJournal: {
      checkedAccepted: true,
    },
    boundary: {
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
      replayAndRetry: {
        verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      },
    },
  };

  return {
    ...proof,
    ...overrides,
    apply: {
      ...proof.apply,
      ...(overrides.apply || {}),
      applyRevalidation: {
        ...proof.apply.applyRevalidation,
        ...(overrides.apply?.applyRevalidation || {}),
      },
    },
    replay: {
      ...proof.replay,
      ...(overrides.replay || {}),
    },
    recoveryInspect: {
      ...proof.recoveryInspect,
      ...(overrides.recoveryInspect || {}),
    },
    dbJournal: {
      ...proof.dbJournal,
      ...(overrides.dbJournal || {}),
      ordering: {
        ...proof.dbJournal.ordering,
        ...(overrides.dbJournal?.ordering || {}),
      },
    },
    boundary: {
      ...proof.boundary,
      ...(overrides.boundary || {}),
      durableJournal: {
        ...proof.boundary.durableJournal,
        ...(overrides.boundary?.durableJournal || {}),
      },
      replayAndRetry: {
        ...proof.boundary.replayAndRetry,
        ...(overrides.boundary?.replayAndRetry || {}),
      },
    },
    durableJournal: {
      ...proof.durableJournal,
      ...(overrides.durableJournal || {}),
    },
  };
}

test('RPP-0615 release verifier proves same-key replay after rejection on the same recovery path', () => {
  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildReleaseSummary(),
    applyRevalidation: buildApplyRevalidation(),
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.sameKeyReplayAfterRejection.proved, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyCode, 'PRECONDITION_FAILED');
  assert.equal(proof.sameKeyReplayAfterRejection.replayed, true);
  assert.equal(proof.sameKeyReplayAfterRejection.freshMutationWork, false);
  assert.equal(proof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.releaseBoundaryVerdict, 'LIVE_RELEASE_BOUNDARY_OK');
  assert.equal(
    proof.sameKeyReplayAfterRejection.applyRevalidationBoundaryVerdict,
    'PRESERVED_REMOTE_RETRY_REQUIRED',
  );
  assert.equal(
    proof.sameKeyReplayAfterRejection.applyRevalidationDurableJournalVerdict,
    'LIVE_RELEASE_BOUNDARY_OK',
  );
  assert.equal(proof.sameKeyReplayAfterRejection.applyRevalidationDurableJournalAccepted, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyRejectedSequence, 7);
  assert.equal(proof.sameKeyReplayAfterRejection.applyReplayedSequence, 8);
  assert.equal(proof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.applyCommitted, false);
});

test('RPP-0615 release verifier fails closed when rejected replay leaves the same checked path', () => {
  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildReleaseSummary(),
    applyRevalidation: buildApplyRevalidation({
      durableJournal: {
        checkedAccepted: false,
      },
      boundary: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        durableJournal: {
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
      },
    }),
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, false);
  assert.equal(proof.sameKeyReplayAfterRejection.proved, false);
  assert.equal(
    proof.sameKeyReplayAfterRejection.applyRevalidationBoundaryVerdict,
    'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
  );
  assert.equal(
    proof.sameKeyReplayAfterRejection.applyRevalidationDurableJournalVerdict,
    'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
  );
});
