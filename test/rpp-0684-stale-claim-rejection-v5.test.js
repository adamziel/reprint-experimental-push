import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  classifyRecoveryJournalClaims,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
  RecoveryJournalClaimStaleError,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const mutationEventTypes = new Set([
  'apply-staged',
  'apply-committed',
  'journal-completed',
  'mutation-applied',
  'mutation-observed',
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0684-stale-claim-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0684-file-${index}.txt`] = `rpp-0684-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0684-file-${index}.txt`] = `rpp-0684-local-raw-site-value-${index}`;
  }
  return site;
}

function preservedRemoteSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0684-file-2.txt'] = 'rpp-0684-preserved-remote-raw-site-value-2';
  site.files['rpp-0684-file-5.txt'] = 'rpp-0684-preserved-remote-raw-site-value-5';
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const preservedRemote = preservedRemoteSite(base);
  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 5);
  return {
    plan,
    remote,
    preservedRemote,
    rawSiteValues: rawSiteValuesFor(base, local, remote, preservedRemote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0684-base-raw-site-value',
    'rpp-0684-local-raw-site-value',
    'rpp-0684-preserved-remote-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0684 evidence: ${rawValue}`,
    );
  }
}

function assertRecordsHaveNoRawValues(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawSiteValues(records, rawSiteValues);
}

function assertNoMutationEvents(records) {
  assert.equal(records.some((record) => mutationEventTypes.has(record.type)), false);
}

function assertStaleClaimError(error, {
  staleClaimId,
  activeClaimId,
  activeClaimType,
  eventType,
  claimExpired,
  rawSiteValues,
}) {
  assert.ok(error instanceof RecoveryJournalClaimStaleError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.eventType, eventType);
  assert.equal(error.details.staleClaimId, staleClaimId);
  assert.equal(error.details.staleClaimHash, recoveryClaimHash(staleClaimId));
  assert.equal(error.details.activeClaimId, activeClaimId);
  assert.equal(error.details.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(error.details.activeClaimType, activeClaimType);
  if (claimExpired !== undefined) {
    assert.equal(error.details.claimExpired, claimExpired);
  }
  assertNoRawSiteValues(error.details, rawSiteValues);
  return true;
}

function assertLeaseOwnerAuditEvidence(inspection, {
  activeClaimId,
  staleClaimRejected,
  expectedClaimStatus,
  rawSiteValues,
}) {
  const activeClaimHash = recoveryClaimHash(activeClaimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, expectedClaimStatus);
  assert.equal(inspection.claim.activeClaimId, activeClaimId);
  assert.equal(inspection.claim.activeClaimHash, activeClaimHash);
  assert.equal(inspection.journal.claimId, activeClaimId);
  assert.equal(inspection.journal.claimHash, activeClaimHash);
  assert.equal(inspection.journal.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.ownershipRecord.claimId, activeClaimId);
  assert.equal(inspection.journal.ownershipRecord.claimHash, activeClaimHash);
  assert.match(inspection.journal.ownershipRecord.journalIdentityHash, hashPattern);
  assert.equal(inspection.journal.writerLease.claimId, activeClaimId);
  assert.equal(inspection.journal.writerLease.claimHash, activeClaimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, activeClaimHash);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.writerLease.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.boundary, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, activeClaimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, activeClaimHash);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assertNoRawSiteValues(inspection, rawSiteValues);
}

function assertStaleRejectionAuditRecord(record, {
  plan,
  staleClaimId,
  activeClaimId,
  preservedRemote,
  artifactRefs,
  rawSiteValues,
}) {
  assert.equal(record.type, 'stale-claim-rejected');
  assert.equal(record.planId, plan.id);
  assert.equal(record.state, 'rejected');
  assert.equal(record.claimId, staleClaimId);
  assert.equal(record.claimHash, recoveryClaimHash(staleClaimId));
  assert.equal(record.previousClaimId, activeClaimId);
  assert.equal(record.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(record.observedHash, digest(preservedRemote));
  assert.match(record.observedHash, hashPattern);
  assert.equal(record.staleThresholdMs, 10_000);
  assert.equal(record.previousClaimAgeMs, 1_000);
  assert.equal(record.previousClaimOpenedAt, '2026-05-31T00:00:00.000Z');
  assert.equal(record.previousClaimExpiresAt, '2026-05-31T00:00:10.000Z');
  assert.equal(record.evaluatedAt, '2026-05-31T00:00:01.000Z');
  assert.equal(record.claimExpired, false);
  assert.deepEqual(record.artifactRefs, artifactRefs);
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

function leaseOwnerIdentityFromInspection(inspection) {
  const claim = inspection.journal.claim;
  const writerLease = inspection.journal.writerLease;
  const leaseFenceWriterLease = inspection.journal.leaseFence.writerLease;
  const activeClaimKeyHash = claim.activeClaimKeyHash || claim.activeClaimHash;
  const writerLeaseClaimKeyHash = writerLease.claimKeyHash || writerLease.claimHash;
  const leaseFenceClaimKeyHash = leaseFenceWriterLease.claimKeyHash || leaseFenceWriterLease.claimHash;

  return {
    activeClaimId: claim.activeClaimId,
    activeClaimKeyHash,
    writerLeaseClaimId: writerLease.claimId,
    writerLeaseClaimKeyHash,
    leaseFenceClaimId: leaseFenceWriterLease.claimId,
    leaseFenceClaimKeyHash,
    ownershipRecordClaimId: inspection.journal.ownershipRecord.claimId,
    ownershipRecordClaimHash: inspection.journal.ownershipRecord.claimHash,
    matches: claim.activeClaimId === writerLease.claimId
      && claim.activeClaimId === leaseFenceWriterLease.claimId
      && activeClaimKeyHash === writerLeaseClaimKeyHash
      && activeClaimKeyHash === leaseFenceClaimKeyHash
      && inspection.journal.ownershipRecord.claimId === claim.activeClaimId
      && inspection.journal.ownershipRecord.claimHash === activeClaimKeyHash,
  };
}

function manualRecoveryAuditExportFor({
  productionInspection,
  plan,
  staleRejection,
}) {
  const body = {
    schemaVersion: 1,
    kind: 'manual-recovery-audit-export',
    format: 'hash-only',
    rawValuesIncluded: false,
    sameReleaseBoundary: true,
    sourceUrl: 'http://127.0.0.1:8080',
    targetEnvelope: {
      total: plan.mutations.length,
      hashOnly: true,
      rawValuesIncluded: false,
    },
    counts: {
      old: 3,
      new: 0,
      blockedUnknown: 2,
      total: plan.mutations.length,
    },
    staleClaimRejection: {
      eventType: staleRejection.type,
      rejectedClaimId: staleRejection.claimId,
      rejectedClaimHash: staleRejection.claimHash,
      leaseOwnerClaimId: staleRejection.previousClaimId,
      leaseOwnerClaimHash: staleRejection.previousClaimHash,
      claimExpired: staleRejection.claimExpired === true,
      beforeMutationRows: true,
    },
    leaseOwnerIdentity: leaseOwnerIdentityFromInspection(productionInspection),
  };

  return {
    ...body,
    exportHash: digest(body),
  };
}

function verifierStaleClaimJournalFor({
  productionInspection,
  staleRejection,
}) {
  const claimId = staleRejection.previousClaimId;
  const claimHash = staleRejection.previousClaimHash;
  const staleClaimId = staleRejection.claimId;
  const staleClaimHash = staleRejection.claimHash;
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    scope: 'claim-fenced-restart-readable',
    proven: true,
    expired: false,
    previousClaimExpired: false,
    staleClaimRejected: true,
    staleThresholdMs: staleRejection.staleThresholdMs,
    openedAt: staleRejection.previousClaimOpenedAt,
    expiresAt: staleRejection.previousClaimExpiresAt,
    evaluatedAt: staleRejection.evaluatedAt,
    previousClaimOpenedAt: staleRejection.evaluatedAt,
    previousClaimExpiresAt: staleRejection.evaluatedAt,
    previousClaimAgeMs: staleRejection.previousClaimAgeMs,
    activeClaimSequence: productionInspection.claim.sequence,
    activeClaimEvent: 'stale-claim-rejected',
    previousClaimSequence: staleRejection.sequence,
    previousClaimEvent: 'stale-claim-rejected',
  };
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId,
    claimKeyHash: claimHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'filesystem-compare-rename',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  };

  return {
    scope: 'checked live production-shaped recovery journal surface; local RPP-0684 verifier fixture',
    ownership: productionInspection.journal.ownership,
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: claimId,
      activeClaimKeyHash: claimHash,
      activeClaimSequence: productionInspection.claim.sequence,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: digest({ rpp: '0684', claimId }),
      requestHash: staleRejection.observedHash,
      staleClaimRejected: true,
      previousClaimId: staleClaimId,
      previousClaimKeyHash: staleClaimHash,
      previousClaimSequence: staleRejection.sequence,
      previousClaimEvent: 'stale-claim-rejected',
      previousStartedSequence: null,
      abandonedSequence: null,
      abandonedEvent: null,
      claimExpiry,
    },
    claimExpiry,
    writerLease,
    leaseFence: {
      boundary: 'filesystem-compare-rename',
      storageGuard: 'filesystem-compare-rename',
      fsyncEvidence: true,
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease,
    },
    storageGuard: {
      boundary: 'filesystem-compare-rename',
      operation: 'update',
      outcome: 'applied',
    },
    mutationApplied: 0,
    eventCounts: {
      'stale-claim-rejected': 1,
    },
    latestEvents: [
      {
        sequence: staleRejection.sequence,
        event: 'stale-claim-rejected',
        claimId: staleClaimId,
        previousClaimId: claimId,
        requestHash: staleRejection.observedHash,
      },
    ],
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan }) {
  return {
    source: 'RPP-0684 restarted stale-claim rejection readback',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      allTargetsAccountedFor: true,
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  staleRejection,
  oldRemoteRecovery,
}) {
  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    manualRecoveryAuditExport: manualRecoveryAuditExportFor({
      productionInspection,
      plan,
      staleRejection,
    }),
    durableJournal: {
      proof: productionInspection,
    },
    releaseProof: {
      plan: {
        mutations: plan.mutations.length,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'blocked-recovery',
          journalState: 'ok',
          counts: {
            ...oldRemoteRecovery.counts,
          },
        },
      },
      dbJournal: verifierStaleClaimJournalFor({
        productionInspection,
        staleRejection,
      }),
      staleClaimRetry: {
        oldRemoteRecovery,
        rejected: {
          status: 409,
          code: 'RECOVERY_CLAIM_STALE',
          recovery: oldRemoteRecovery,
        },
      },
    },
  };
}

function buildStaleClaimReleaseEvidence({
  plan,
  staleRejection,
  releaseProof,
}) {
  const leaseOwner = releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity;

  return {
    issue: 'RPP-0684',
    proofClass: 'stale-claim-rejection-v5',
    staleClaimRejection: {
      rejected: true,
      rejectedBeforeMutationRows: true,
      claimExpired: staleRejection.claimExpired === true,
      rejectedClaimId: staleRejection.claimId,
      rejectedClaimHash: staleRejection.claimHash,
      leaseOwnerClaimId: staleRejection.previousClaimId,
      leaseOwnerClaimHash: staleRejection.previousClaimHash,
      staleRejectionRecordHash: digest(staleRejection),
    },
    auditEvidence: {
      hashOnly: true,
      rawValuesIncluded: false,
      leaseOwnerIdentity: {
        visible: leaseOwner.matches === true,
        claimId: leaseOwner.activeClaimId,
        claimHash: leaseOwner.activeClaimKeyHash,
        claimKeyHash: leaseOwner.activeClaimKeyHash,
        writerLeaseClaimId: leaseOwner.writerLeaseClaimId,
        writerLeaseClaimKeyHash: leaseOwner.writerLeaseClaimKeyHash,
        leaseFenceClaimId: leaseOwner.leaseFenceClaimId,
        leaseFenceClaimKeyHash: leaseOwner.leaseFenceClaimKeyHash,
        ownershipRecordClaimId: leaseOwner.ownershipRecordClaimId,
        ownershipRecordClaimHash: leaseOwner.ownershipRecordClaimHash,
      },
      rejectedWriterIdentity: {
        claimId: staleRejection.claimId,
        claimHash: staleRejection.claimHash,
      },
      manualRecoveryAuditExportHash: releaseProof.manualRecoveryAuditExport.exportHash,
    },
    releaseVerifier: {
      gate: releaseProof.gate,
      gateStatus: releaseProof.gateStatus,
      durableRecoveryJournalBoundary: releaseProof.durableRecoveryJournalBoundary,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      checks: {
        leaseOwnerIdentity: releaseProof.checks.leaseOwnerIdentity,
        staleOwnerFencing: releaseProof.checks.staleOwnerFencing,
        claimExpiryPolicy: releaseProof.checks.claimExpiryPolicy,
      },
      leaseOwnerIdentity: releaseProof.leaseOwnerIdentity,
      staleOwnerFencing: releaseProof.staleOwnerFencing,
      proofHash: digest({
        gate: releaseProof.gate,
        gateStatus: releaseProof.gateStatus,
        checks: releaseProof.checks,
        leaseOwnerIdentity: releaseProof.leaseOwnerIdentity,
        staleOwnerFencing: releaseProof.staleOwnerFencing,
      }),
    },
    plan: {
      mutationCount: plan.mutations.length,
      planHash: digest(plan),
    },
  };
}

function staleClaimReleaseEvidenceProvesLeaseOwner(evidence, plan) {
  const rejection = evidence?.staleClaimRejection;
  const audit = evidence?.auditEvidence;
  const leaseOwner = audit?.leaseOwnerIdentity;
  const rejectedWriter = audit?.rejectedWriterIdentity;
  const verifier = evidence?.releaseVerifier;

  return Boolean(
    evidence?.issue === 'RPP-0684'
      && rejection?.rejected === true
      && rejection?.rejectedBeforeMutationRows === true
      && rejection?.claimExpired === false
      && typeof rejection?.rejectedClaimId === 'string'
      && hashPattern.test(rejection?.rejectedClaimHash || '')
      && typeof rejection?.leaseOwnerClaimId === 'string'
      && hashPattern.test(rejection?.leaseOwnerClaimHash || '')
      && rejection.leaseOwnerClaimId !== rejection.rejectedClaimId
      && hashPattern.test(rejection?.staleRejectionRecordHash || '')
      && audit?.hashOnly === true
      && audit?.rawValuesIncluded === false
      && leaseOwner?.visible === true
      && leaseOwner?.claimId === rejection.leaseOwnerClaimId
      && leaseOwner?.claimHash === rejection.leaseOwnerClaimHash
      && leaseOwner?.claimKeyHash === rejection.leaseOwnerClaimHash
      && leaseOwner?.writerLeaseClaimId === rejection.leaseOwnerClaimId
      && leaseOwner?.writerLeaseClaimKeyHash === rejection.leaseOwnerClaimHash
      && leaseOwner?.leaseFenceClaimId === rejection.leaseOwnerClaimId
      && leaseOwner?.leaseFenceClaimKeyHash === rejection.leaseOwnerClaimHash
      && leaseOwner?.ownershipRecordClaimId === rejection.leaseOwnerClaimId
      && leaseOwner?.ownershipRecordClaimHash === rejection.leaseOwnerClaimHash
      && rejectedWriter?.claimId === rejection.rejectedClaimId
      && rejectedWriter?.claimHash === rejection.rejectedClaimHash
      && hashPattern.test(audit?.manualRecoveryAuditExportHash || '')
      && verifier?.gate === 'GATE-2'
      && verifier?.gateStatus === 'proven'
      && verifier?.durableRecoveryJournalBoundary === 'release-verifier'
      && verifier?.sameReleaseBoundary === true
      && verifier?.checks?.leaseOwnerIdentity === true
      && verifier?.checks?.staleOwnerFencing === true
      && verifier?.checks?.claimExpiryPolicy === false
      && verifier?.leaseOwnerIdentity?.matches === true
      && verifier?.leaseOwnerIdentity?.activeClaimId === rejection.leaseOwnerClaimId
      && verifier?.leaseOwnerIdentity?.activeClaimKeyHash === rejection.leaseOwnerClaimHash
      && verifier?.staleOwnerFencing?.proved === true
      && verifier?.staleOwnerFencing?.previousClaimId === rejection.rejectedClaimId
      && verifier?.staleOwnerFencing?.previousClaimKeyHash === rejection.rejectedClaimHash
      && hashPattern.test(verifier?.proofHash || '')
      && evidence?.plan?.mutationCount === plan.mutations.length
      && hashPattern.test(evidence?.plan?.planHash || '')
  );
}

test('RPP-0684 stale claim rejection variant 5 carries lease owner identity through release verifier audit evidence', () => {
  const filePath = tempJournalPath();
  const { plan, remote, preservedRemote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0684-stale-claim-rejection-v5',
    recoverySupport: 'artifact://rpp-0684-local-recovery-support',
  };
  const activeClaimId = 'rpp-0684-active-lease-owner';
  const staleClaimId = 'rpp-0684-rejected-stale-writer';
  const claimStaleThresholdMs = 10_000;

  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  const activeInspection = active.inspect();
  active.close();

  assertLeaseOwnerAuditEvidence(activeInspection, {
    activeClaimId,
    staleClaimRejected: false,
    expectedClaimStatus: 'active',
    rawSiteValues,
  });

  const preservedRemoteBeforeRetry = cloneJson(preservedRemote);
  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: preservedRemote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId: staleClaimId,
      claimStaleThresholdMs,
    }),
    (error) => assertStaleClaimError(error, {
      staleClaimId,
      activeClaimId,
      activeClaimType: 'recovery-claim-opened',
      eventType: 'recovery-claim-opened',
      claimExpired: false,
      rawSiteValues,
    }),
  );
  assert.deepEqual(preservedRemote, preservedRemoteBeforeRetry);

  const restarted = readRecoveryJournal(filePath);
  const claim = classifyRecoveryJournalClaims(restarted.records);
  const activeClaimRecord = recordsOfType(restarted.records, 'recovery-claim-opened')[0];
  const staleRejections = recordsOfType(restarted.records, 'stale-claim-rejected');
  const staleRejection = staleRejections[0];

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(claim.status, 'active');
  assert.equal(claim.activeClaimId, activeClaimId);
  assert.equal(claim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(activeClaimRecord.claimId, activeClaimId);
  assert.equal(staleRejections.length, 1);
  assert.ok(staleRejection.sequence > activeClaimRecord.sequence);
  assertStaleRejectionAuditRecord(staleRejection, {
    plan,
    staleClaimId,
    activeClaimId,
    preservedRemote,
    artifactRefs,
    rawSiteValues,
  });
  assert.equal(
    restarted.records.filter(
      (record) => record.type === 'recovery-claim-opened' && record.claimId === staleClaimId,
    ).length,
    0,
  );
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

  const restartInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: preservedRemote,
  });
  assert.equal(restartInspection.status, 'blocked-recovery');
  assert.deepEqual(restartInspection.counts, {
    old: 3,
    new: 0,
    blockedUnknown: 2,
  });
  assert.equal(restartInspection.claim.activeClaimId, activeClaimId);
  assertNoRawSiteValues(restartInspection, rawSiteValues);

  const activeRetry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: preservedRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 3_000),
    truncate: false,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  const activeRetryInspection = activeRetry.inspect();
  activeRetry.close();

  assertLeaseOwnerAuditEvidence(activeRetryInspection, {
    activeClaimId,
    staleClaimRejected: true,
    expectedClaimStatus: 'advanced',
    rawSiteValues,
  });
  assert.equal(activeRetryInspection.claim.previousClaimId, null);

  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection: activeRetryInspection,
    plan,
    staleRejection,
    oldRemoteRecovery: oldRemoteRecoveryFromInspection({
      inspection: restartInspection,
      plan,
    }),
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: {
      recoveryInspect: {
        recovery: {
          state: 'blocked-recovery',
          counts: {
            old: 3,
            new: 0,
            blockedUnknown: 2,
            total: plan.mutations.length,
          },
        },
      },
    },
  });

  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.leaseOwnerIdentity, true);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimId, activeClaimId);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(activeClaimId));
  assert.equal(releaseProof.leaseOwnerIdentity.writerLeaseClaimId, activeClaimId);
  assert.equal(releaseProof.leaseOwnerIdentity.writerLeaseClaimKeyHash, recoveryClaimHash(activeClaimId));
  assert.equal(releaseProof.leaseOwnerIdentity.leaseFenceClaimId, activeClaimId);
  assert.equal(releaseProof.leaseOwnerIdentity.leaseFenceClaimKeyHash, recoveryClaimHash(activeClaimId));
  assert.equal(releaseProof.leaseOwnerIdentity.matches, true);
  assert.equal(releaseProof.checks.staleOwnerFencing, true);
  assert.equal(releaseProof.staleOwnerFencing.proved, true);
  assert.equal(releaseProof.staleOwnerFencing.activeClaimId, activeClaimId);
  assert.equal(releaseProof.staleOwnerFencing.previousClaimId, staleClaimId);
  assert.equal(releaseProof.staleOwnerFencing.previousClaimKeyHash, recoveryClaimHash(staleClaimId));
  assert.equal(releaseProof.staleOwnerFencing.leaseFenceStaleClaimRejected, true);
  assert.equal(releaseProof.checks.claimExpiryPolicy, false);
  assert.equal(releaseProof.claimExpiryPolicy.expired, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.format, 'hash-only');
  assert.equal(releaseProof.manualRecoveryAuditExport.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.matches, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.activeClaimId, activeClaimId);
  assert.equal(
    releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.activeClaimKeyHash,
    recoveryClaimHash(activeClaimId),
  );
  assert.equal(releaseProof.manualRecoveryAuditExport.staleClaimRejection.rejectedClaimId, staleClaimId);
  assert.equal(releaseProof.manualRecoveryAuditExport.staleClaimRejection.leaseOwnerClaimId, activeClaimId);
  assertNoRawSiteValues(releaseProof, rawSiteValues);

  const evidence = buildStaleClaimReleaseEvidence({
    plan,
    staleRejection,
    releaseProof,
  });
  assert.equal(staleClaimReleaseEvidenceProvesLeaseOwner(evidence, plan), true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.visible, true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimId, activeClaimId);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(evidence.auditEvidence.rejectedWriterIdentity.claimId, staleClaimId);
  assert.equal(evidence.auditEvidence.rejectedWriterIdentity.claimHash, recoveryClaimHash(staleClaimId));
  assert.match(evidence.auditEvidence.manualRecoveryAuditExportHash, hashPattern);
  assert.match(evidence.releaseVerifier.proofHash, hashPattern);
  assertNoRawSiteValues(evidence, rawSiteValues);

  const hiddenLeaseOwnerEvidence = {
    ...evidence,
    auditEvidence: {
      ...evidence.auditEvidence,
      leaseOwnerIdentity: {
        ...evidence.auditEvidence.leaseOwnerIdentity,
        visible: false,
      },
    },
  };
  assert.equal(staleClaimReleaseEvidenceProvesLeaseOwner(hiddenLeaseOwnerEvidence, plan), false);

  const recordCountBeforeMutationAttempt = readRecoveryJournal(filePath).records.length;
  const staleWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: new Date(fixedNow.getTime() + 4_000),
    claimId: staleClaimId,
    claimStaleThresholdMs,
  });
  try {
    assert.throws(
      () => staleWriter.appendEvent('mutation-applied', {
        planId: plan.id,
        state: 'stale-writer-mutation-attempt',
        mutationId: plan.mutations[0].id,
        resourceKey: plan.mutations[0].resourceKey,
        observedHash: digest(preservedRemote),
        artifactRefs,
      }),
      (error) => assertStaleClaimError(error, {
        staleClaimId,
        activeClaimId,
        activeClaimType: 'recovery-claim-opened',
        eventType: 'mutation-applied',
        rawSiteValues,
      }),
    );
  } finally {
    staleWriter.close();
  }

  const afterStaleMutationAttempt = readRecoveryJournal(filePath);
  assert.equal(afterStaleMutationAttempt.records.length, recordCountBeforeMutationAttempt);
  assert.equal(recordsOfType(afterStaleMutationAttempt.records, 'stale-claim-rejected').length, 1);
  assertNoMutationEvents(afterStaleMutationAttempt.records);
  assertRecordsHaveNoRawValues(afterStaleMutationAttempt.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);
});
