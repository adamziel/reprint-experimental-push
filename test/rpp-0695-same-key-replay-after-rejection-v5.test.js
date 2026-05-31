import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const sourceUrl = 'http://127.0.0.1:8080';
const checkedAt = '2026-05-31T12:00:00.000Z';
const validUntil = '2026-06-30T12:00:00.000Z';
const expiredAt = '2026-05-30T12:00:00.000Z';
const hashPattern = /^[a-f0-9]{64}$/;
const rawFixtureValues = [
  'rpp-0695-raw-idempotency-key',
  'rpp-0695-private-apply-body',
  'rpp-0695-private-replay-body',
  'rpp-0695-private-remote-before',
  'rpp-0695-private-remote-after',
];

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0695:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function proofHashFor(value) {
  return digest(value);
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} must be a 64-character sha256 hash`);
}

function assertNoRawValues(value, rawValues = rawFixtureValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0695 support evidence leaked raw fixture value: ${rawValue}`,
    );
  }
}

function buildDurableJournal() {
  const activeClaimId = 'psh_rpp0695_active_claim';
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const previousClaimId = 'psh_rpp0695_previous_claim';
  const previousClaimKeyHash = fixtureHash('previous-claim-key');
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    expired: true,
    previousClaimExpired: true,
    staleThresholdMs: 1000,
    openedAt: '2026-05-31T12:00:02.000Z',
    expiresAt: '2026-05-31T12:00:03.000Z',
    previousClaimOpenedAt: '2026-05-31T12:00:00.000Z',
    previousClaimExpiresAt: '2026-05-31T12:00:01.000Z',
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

function buildReleaseSummary() {
  const mutationCount = 2;
  const originalRequestHash = fixtureHash('accepted-request');
  const conflictingRequestHash = fixtureHash('conflicting-request');
  const durableJournal = buildDurableJournal();

  return {
    topology: {
      sourceUrl,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
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
          state: 'fully-updated-remote',
          journalState: 'ok',
          checkedPathHash: fixtureHash('checked-recovery-path'),
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
          requestHash: conflictingRequestHash,
          originalRequestHash,
        },
        targetSnapshotUnchanged: true,
        recoveryState: {
          source: 'RPP-0695 generated different-body conflict recovery state',
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
        latestEvents: [
          { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
          { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
          { sequence: 3, event: 'mutation-applied', requestHash: originalRequestHash },
          { sequence: 4, event: 'mutation-applied', requestHash: originalRequestHash },
          { sequence: 5, event: 'apply-committed', requestHash: originalRequestHash },
          { sequence: 6, event: 'apply-replayed', requestHash: originalRequestHash },
          { sequence: 7, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
        ],
      },
      staleClaimRetry: {
        oldRemoteRecovery: {
          source: 'RPP-0695 generated stale-owner retry before mutation',
          status: 200,
          state: 'old-remote',
          observedState: 'old-remote',
          counts: {
            old: mutationCount,
            new: 0,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
      replayAndRetry: {
        required: 'artifact://rpp-0695-checked-recovery-path',
        observed: 'artifact://rpp-0695-checked-recovery-path',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function baseRejectedReplayEnvelope() {
  const requestHash = fixtureHash('same-canonical-apply-request');
  const idempotencyKeyHash = fixtureHash('idempotency-key');
  const targetSnapshotHash = fixtureHash('target-snapshot-before-and-after-replay');
  const envelope = {
    schemaVersion: 1,
    issue: 'RPP-0695',
    variant: 5,
    proofClass: 'same-key-replay-after-rejection-v5',
    evidenceScope: 'local-support-only',
    hashOnly: true,
    rawKeyIncluded: false,
    rawBodyIncluded: false,
    rawResponseIncluded: false,
    sourceUrlHash: sha256Hex(sourceUrl),
    checkedRecoveryPathHash: fixtureHash('checked-recovery-path'),
    releaseBoundaryHash: fixtureHash('live-release-boundary'),
    idempotency: {
      sameKey: true,
      idempotencyKeyHash,
      originalRequestHash: requestHash,
      replayRequestHash: requestHash,
    },
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      phase: 'before-first-mutation',
      checkedAgainst: 'live-remote',
      rejectionHash: proofHashFor({
        status: 412,
        code: 'PRECONDITION_FAILED',
        phase: 'before-first-mutation',
        requestHash,
      }),
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged: true,
      rejectionHash: proofHashFor({
        status: 412,
        code: 'PRECONDITION_FAILED',
        replayed: true,
        requestHash,
      }),
    },
    target: {
      beforeHash: targetSnapshotHash,
      afterHash: targetSnapshotHash,
      preservedRemoteUnchanged: true,
    },
    dbJournal: {
      applyRejectedSequences: [20],
      applyReplayedSequences: [21],
      ordering: {
        ordered: true,
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    freshness: {
      checkedAt,
      expiresAt: validUntil,
    },
  };

  return {
    ...envelope,
    proofHash: proofHashFor(envelope),
  };
}

function rebuildProofHash(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return envelope;
  }
  const copy = cloneJson(envelope);
  delete copy.proofHash;
  copy.proofHash = proofHashFor(copy);
  return copy;
}

function generatedRejectedReplayCases() {
  const accepted = baseRejectedReplayEnvelope();
  return [
    {
      name: 'accepted',
      evidence: accepted,
      accepted: true,
      code: 'REJECTION_REPLAY_EVIDENCE_ACCEPTED',
    },
    {
      name: 'missing',
      evidence: null,
      accepted: false,
      code: 'REJECTION_REPLAY_EVIDENCE_REQUIRED',
    },
    {
      name: 'malformed-status',
      evidence: rebuildProofHash({
        ...accepted,
        apply: {
          ...accepted.apply,
          status: '412',
        },
        replay: {
          ...accepted.replay,
          status: '412',
        },
      }),
      accepted: false,
      code: 'REJECTION_REPLAY_EVIDENCE_MALFORMED',
    },
    {
      name: 'stale-window',
      evidence: rebuildProofHash({
        ...accepted,
        freshness: {
          ...accepted.freshness,
          expiresAt: expiredAt,
        },
      }),
      accepted: false,
      code: 'REJECTION_REPLAY_EVIDENCE_STALE',
    },
    {
      name: 'duplicated-replay-row',
      evidence: rebuildProofHash({
        ...accepted,
        dbJournal: {
          ...accepted.dbJournal,
          applyReplayedSequences: [21, 22],
          ordering: {
            ...accepted.dbJournal.ordering,
            ordered: false,
            applyReplayed: 22,
          },
        },
      }),
      accepted: false,
      code: 'REJECTION_REPLAY_EVIDENCE_DUPLICATED',
    },
    {
      name: 'drifted-request-and-target',
      evidence: rebuildProofHash({
        ...accepted,
        idempotency: {
          ...accepted.idempotency,
          replayRequestHash: fixtureHash('drifted-replay-request'),
        },
        replay: {
          ...accepted.replay,
          preservedRemoteUnchanged: false,
        },
        target: {
          ...accepted.target,
          afterHash: fixtureHash('drifted-target-snapshot'),
          preservedRemoteUnchanged: false,
        },
      }),
      accepted: false,
      code: 'REJECTION_REPLAY_EVIDENCE_DRIFTED',
    },
  ];
}

function validateRejectedReplayEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_REQUIRED');
  }

  if (
    evidence.schemaVersion !== 1
    || evidence.issue !== 'RPP-0695'
    || evidence.variant !== 5
    || evidence.proofClass !== 'same-key-replay-after-rejection-v5'
    || evidence.hashOnly !== true
    || evidence.rawKeyIncluded !== false
    || evidence.rawBodyIncluded !== false
    || evidence.rawResponseIncluded !== false
    || !hashFieldsAreValid([
      evidence.sourceUrlHash,
      evidence.checkedRecoveryPathHash,
      evidence.releaseBoundaryHash,
      evidence.proofHash,
      evidence.idempotency?.idempotencyKeyHash,
      evidence.idempotency?.originalRequestHash,
      evidence.idempotency?.replayRequestHash,
      evidence.apply?.rejectionHash,
      evidence.replay?.rejectionHash,
      evidence.target?.beforeHash,
      evidence.target?.afterHash,
    ])
    || Number.isInteger(evidence.apply?.status) !== true
    || Number.isInteger(evidence.replay?.status) !== true
    || evidence.apply?.code !== 'PRECONDITION_FAILED'
    || evidence.replay?.code !== 'PRECONDITION_FAILED'
  ) {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_MALFORMED');
  }

  if (!freshnessWindowIsValid(evidence.freshness)) {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_STALE');
  }

  if (
    !exactlyOneSequence(evidence.dbJournal?.applyRejectedSequences)
    || !exactlyOneSequence(evidence.dbJournal?.applyReplayedSequences)
  ) {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_DUPLICATED');
  }

  if (
    evidence.idempotency?.sameKey !== true
    || evidence.idempotency.originalRequestHash !== evidence.idempotency.replayRequestHash
    || evidence.target.beforeHash !== evidence.target.afterHash
    || evidence.target.preservedRemoteUnchanged !== true
    || evidence.replay.preservedRemoteUnchanged !== true
  ) {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_DRIFTED');
  }

  const ordering = evidence.dbJournal?.ordering || {};
  if (
    evidence.apply.status !== 412
    || evidence.apply.applied !== 0
    || evidence.apply.phase !== 'before-first-mutation'
    || evidence.replay.status !== 412
    || evidence.replay.replayed !== true
    || evidence.replay.freshMutationWork !== false
    || ordering.ordered !== true
    || ordering.applyRejected !== evidence.dbJournal.applyRejectedSequences[0]
    || ordering.applyReplayed !== evidence.dbJournal.applyReplayedSequences[0]
    || ordering.applyRejected >= ordering.applyReplayed
    || ordering.mutationAppliedBeforeFailure !== 0
    || ordering.applyCommitted !== false
  ) {
    return rejectedValidation('REJECTION_REPLAY_EVIDENCE_MALFORMED');
  }

  return {
    accepted: true,
    code: 'REJECTION_REPLAY_EVIDENCE_ACCEPTED',
    proofHash: evidence.proofHash,
  };
}

function rejectedValidation(code) {
  return {
    accepted: false,
    code,
    proofHash: null,
  };
}

function hashFieldsAreValid(values) {
  return values.every((value) => typeof value === 'string' && hashPattern.test(value));
}

function freshnessWindowIsValid(freshness) {
  const checkedMs = Date.parse(freshness?.checkedAt || '');
  const expiresMs = Date.parse(freshness?.expiresAt || '');
  return Number.isFinite(checkedMs) && Number.isFinite(expiresMs) && checkedMs < expiresMs;
}

function exactlyOneSequence(sequences) {
  return Array.isArray(sequences)
    && sequences.length === 1
    && Number.isInteger(sequences[0])
    && sequences[0] > 0;
}

function applyRevalidationFromEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return null;
  }

  const duplicateReplayRows = !exactlyOneSequence(evidence.dbJournal?.applyRejectedSequences)
    || !exactlyOneSequence(evidence.dbJournal?.applyReplayedSequences);
  const staleReplayEvidence = !freshnessWindowIsValid(evidence.freshness);
  const staleVerdict = 'REJECTED_REPLAY_EVIDENCE_STALE';
  const replayedSequences = Array.isArray(evidence.dbJournal?.applyReplayedSequences)
    ? evidence.dbJournal.applyReplayedSequences
    : [];

  return {
    ok: true,
    apply: {
      status: evidence.apply?.status,
      code: evidence.apply?.code,
      applied: evidence.apply?.applied,
      applyRevalidation: {
        phase: evidence.apply?.phase,
        checkedAgainst: evidence.apply?.checkedAgainst,
      },
    },
    replay: {
      status: evidence.replay?.status,
      code: evidence.replay?.code,
      replayed: evidence.replay?.replayed,
      freshMutationWork: evidence.replay?.freshMutationWork,
      preservedRemoteUnchanged: evidence.replay?.preservedRemoteUnchanged,
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: 2,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: evidence.dbJournal?.ordering?.ordered === true && !duplicateReplayRows,
        applyRejected: evidence.dbJournal?.applyRejectedSequences?.[0] ?? null,
        applyReplayed: duplicateReplayRows
          ? (replayedSequences.at(-1) ?? null)
          : evidence.dbJournal?.applyReplayedSequences?.[0] ?? null,
        mutationAppliedBeforeFailure: evidence.dbJournal?.ordering?.mutationAppliedBeforeFailure,
        applyCommitted: evidence.dbJournal?.ordering?.applyCommitted,
      },
    },
    durableJournal: {
      checkedAccepted: staleReplayEvidence ? false : true,
    },
    boundary: {
      verdict: staleReplayEvidence ? staleVerdict : 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: staleReplayEvidence ? staleVerdict : 'LIVE_RELEASE_BOUNDARY_OK',
      },
      replayAndRetry: {
        verdict: staleReplayEvidence ? staleVerdict : 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function evaluateGeneratedRejectedReplayEvidence(evidence) {
  const validation = validateRejectedReplayEvidence(evidence);
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildReleaseSummary(),
    applyRevalidation: applyRevalidationFromEvidence(evidence),
  });
  const recoveryGateMovementAllowed = Boolean(
    validation.accepted
    && releaseProof.ok === true
    && releaseProof.gate === 'GATE-2'
    && releaseProof.gateStatus === 'proven'
    && releaseProof.sameKeyReplayAfterRejection.proved === true
    && releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath === true,
  );

  return {
    validation,
    releaseProof,
    supportEvidence: supportEvidenceSummary({
      evidence,
      validation,
      releaseProof,
      recoveryGateMovementAllowed,
    }),
  };
}

function supportEvidenceSummary({
  evidence,
  validation,
  releaseProof,
  recoveryGateMovementAllowed,
}) {
  const summary = {
    schemaVersion: 1,
    slice: 'RPP-0695',
    proofClass: 'same-key-replay-after-rejection-v5',
    evidenceScope: 'local-support-only',
    releaseStatus: 'NO-GO',
    sourceUrlHash: sha256Hex(sourceUrl),
    fixtureProofHash: evidence?.proofHash || null,
    validation: {
      accepted: validation.accepted,
      code: validation.code,
      proofHash: validation.proofHash,
    },
    rejectedReplay: {
      status: releaseProof.sameKeyRejectedReplay.status,
      code: releaseProof.sameKeyRejectedReplay.code,
      replayed: releaseProof.sameKeyRejectedReplay.replayed,
      freshMutationWork: releaseProof.sameKeyRejectedReplay.freshMutationWork,
      preservedRemoteUnchanged: releaseProof.sameKeyRejectedReplay.preservedRemoteUnchanged,
      applyRejectedSequence: releaseProof.sameKeyRejectedReplay.applyRejectedSequence,
      applyReplayedSequence: releaseProof.sameKeyRejectedReplay.applyReplayedSequence,
      mutationAppliedBeforeFailure: releaseProof.sameKeyRejectedReplay.mutationAppliedBeforeFailure,
      applyCommitted: releaseProof.sameKeyRejectedReplay.applyCommitted,
    },
    recoveryGateMovement: {
      allowed: recoveryGateMovementAllowed,
      gate: releaseProof.gate,
      gateStatus: releaseProof.gateStatus,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      sameCheckedRecoveryPath: releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath,
      checksHash: proofHashFor(releaseProof.checks),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: fixtureHash('local-support-only-does-not-claim-final-release-readiness'),
    },
    boundary: {
      status: 'blocked',
      firstRemainingBoundaryHash: fixtureHash('checked-production-release-boundary'),
    },
  };

  return {
    ...summary,
    proofHash: proofHashFor(summary),
  };
}

test('RPP-0695 generated same-key replay after rejection v5 proves GATE-2 on the same path', () => {
  const evidence = baseRejectedReplayEnvelope();
  const result = evaluateGeneratedRejectedReplayEvidence(evidence);
  const { releaseProof, supportEvidence } = result;

  assert.equal(result.validation.accepted, true);
  assert.equal(result.validation.code, 'REJECTION_REPLAY_EVIDENCE_ACCEPTED');
  assertHash(result.validation.proofHash, 'accepted validation proof hash');
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.proved, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyRevalidationPhase, 'before-first-mutation');
  assert.equal(releaseProof.sameKeyReplayAfterRejection.replayed, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.freshMutationWork, false);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyRejectedSequence, 20);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyReplayedSequence, 21);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(releaseProof.checks.sameKeyRejectedReplay, true);
  assert.equal(releaseProof.sameKeyRejectedReplay.proved, true);
  assert.equal(releaseProof.sameKeyRejectedReplay.required, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(supportEvidence.recoveryGateMovement.allowed, true);
  assert.equal(supportEvidence.recoveryGateMovement.gate, 'GATE-2');
  assert.equal(supportEvidence.recoveryGateMovement.gateStatus, 'proven');
  assert.equal(supportEvidence.releaseStatus, 'NO-GO');
  assert.equal(supportEvidence.releaseMovement.allowed, false);
  assertHash(supportEvidence.sourceUrlHash, 'source URL hash');
  assertHash(supportEvidence.fixtureProofHash, 'fixture proof hash');
  assertHash(supportEvidence.recoveryGateMovement.checksHash, 'checks hash');
  assertHash(supportEvidence.releaseMovement.reasonHash, 'release movement reason hash');
  assertHash(supportEvidence.boundary.firstRemainingBoundaryHash, 'remaining boundary hash');
  assertHash(supportEvidence.proofHash, 'support evidence proof hash');
  assertNoRawValues(evidence);
  assertNoRawValues(supportEvidence);
});

test('RPP-0695 generated replay evidence rejects missing malformed stale duplicated and drifted fixtures', () => {
  for (const generatedCase of generatedRejectedReplayCases().filter((entry) => !entry.accepted)) {
    const result = evaluateGeneratedRejectedReplayEvidence(generatedCase.evidence);
    const { releaseProof, supportEvidence } = result;

    assert.equal(result.validation.accepted, false, `${generatedCase.name} validation accepted`);
    assert.equal(result.validation.code, generatedCase.code, generatedCase.name);
    assert.equal(releaseProof.ok, false, `${generatedCase.name} release proof`);
    assert.equal(
      releaseProof.checks.sameKeyReplayAfterRejection,
      false,
      `${generatedCase.name} same-key replay check`,
    );
    assert.equal(
      releaseProof.sameKeyReplayAfterRejection.proved,
      false,
      `${generatedCase.name} same-key replay proof`,
    );
    assert.equal(
      supportEvidence.recoveryGateMovement.allowed,
      false,
      `${generatedCase.name} recovery gate movement`,
    );
    assert.equal(supportEvidence.releaseMovement.allowed, false, `${generatedCase.name} release movement`);
    assert.equal(supportEvidence.releaseStatus, 'NO-GO', generatedCase.name);
    assertHash(supportEvidence.sourceUrlHash, `${generatedCase.name} source URL hash`);
    assertHash(supportEvidence.recoveryGateMovement.checksHash, `${generatedCase.name} checks hash`);
    assertHash(supportEvidence.releaseMovement.reasonHash, `${generatedCase.name} movement hash`);
    assertHash(supportEvidence.boundary.firstRemainingBoundaryHash, `${generatedCase.name} boundary hash`);
    assertHash(supportEvidence.proofHash, `${generatedCase.name} support proof hash`);
    assertNoRawValues(generatedCase.evidence || {});
    assertNoRawValues(supportEvidence);

    if (generatedCase.name === 'missing') {
      assert.equal(releaseProof.sameKeyRejectedReplay.required, false);
      assert.equal(releaseProof.sameKeyRejectedReplay.proved, false);
    } else {
      assert.equal(releaseProof.sameKeyRejectedReplay.required, true, generatedCase.name);
    }
  }
});
