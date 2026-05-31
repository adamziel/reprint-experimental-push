import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  RECOVERY_INSPECT_REASON_CODES,
  inspectRecoveryJournal,
} from '../src/recovery-inspect.js';
import {
  appendJournalCompleted,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import {
  deserializeResourceValue,
  resourceHash,
  setResource,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const retryNow = new Date(fixedNow.getTime() + 7_000);
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const sourceUrl = 'http://127.0.0.1:8080';
const claimStaleThresholdMs = 2_000;
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedNewRemoteCases = Object.freeze([
  {
    id: 'rpp-0691-new-remote-five-v5',
    mutationCount: 5,
  },
  {
    id: 'rpp-0691-new-remote-seven-v5',
    mutationCount: 7,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0691-new-remote-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0691-new-remote-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const preservedBeforePlanKey = `${generatedCase.id}-remote-preserved-before-plan.txt`;
  const preservedAfterCrashKey = `${generatedCase.id}-remote-preserved-after-crash.txt`;
  const base = {
    files: {
      [preservedBeforePlanKey]: `base-raw-rpp-0691-${generatedCase.id}-preserved-before-plan`,
      [preservedAfterCrashKey]: `base-raw-rpp-0691-${generatedCase.id}-preserved-after-crash`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0691-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0691-${generatedCase.id}-target-${index}`;
  }
  remote.files[preservedBeforePlanKey] =
    `remote-raw-rpp-0691-${generatedCase.id}-preserved-before-plan`;

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const current = cloneJson(remote);
  applyMutations(current, plan);
  current.files[preservedAfterCrashKey] =
    `remote-raw-rpp-0691-${generatedCase.id}-preserved-after-crash`;

  return {
    plan,
    remote,
    current,
    preservedBeforePlanKey,
    preservedAfterCrashKey,
    preservedBeforePlanValue: remote.files[preservedBeforePlanKey],
    preservedAfterCrashValue: current.files[preservedAfterCrashKey],
    rawSiteValues: rawSiteValuesFor(base, local, remote, current),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0691',
    'local-raw-rpp-0691',
    'remote-raw-rpp-0691',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function applyMutations(site, plan) {
  for (const mutation of plan.mutations) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0691/${generatedCase.id}/release-verifier-new-remote-v5`,
    recoverySupport: `artifact://rpp-0691/${generatedCase.id}/local-new-remote-classification-v5`,
    durabilityScope: `artifact://rpp-0691/${generatedCase.id}/sandbox-sqlite-backed`,
  };
}

function activeClaimIdFor(generatedCase) {
  return `${generatedCase.id}-active-claim`;
}

function releaseVerifierClaimIdFor(generatedCase) {
  return `${generatedCase.id}-release-verifier-claim`;
}

function writeCompletedProductionJournal({
  filePath,
  generatedCase,
  plan,
  remote,
  current,
  artifactRefs,
}) {
  const activeClaimId = activeClaimIdFor(generatedCase);
  const releaseVerifierClaimId = releaseVerifierClaimIdFor(generatedCase);
  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: true,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  active.close();

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: retryNow,
    truncate: false,
    claimId: releaseVerifierClaimId,
    claimStaleThresholdMs,
  });

  try {
    for (const mutation of plan.mutations) {
      appendMutationObserved(journal, {
        plan,
        mutation,
        current,
        state: 'applied',
        artifactRefs,
      });
    }
    appendJournalCompleted(journal, { plan, current, artifactRefs });
    return {
      productionInspection: journal.inspect(),
      activeClaimId,
      releaseVerifierClaimId,
    };
  } finally {
    journal.close();
  }
}

function writeSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, schema_version, record_json) VALUES (?, ?, ?)',
  );
  for (const record of records) {
    insert.run(record.sequence, record.schemaVersion, JSON.stringify(record));
  }
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0691 evidence') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw site value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournalRows(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    for (const field of [
      'observedHash',
      'beforeHash',
      'afterHash',
      'claimHash',
      'previousClaimHash',
      'journalIdentityHash',
    ]) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0691 journal rows');
}

function assertPlanPreservesRemoteOnlyResources({
  plan,
  preservedBeforePlanKey,
  preservedAfterCrashKey,
}) {
  for (const key of [preservedBeforePlanKey, preservedAfterCrashKey]) {
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === `file:${key}`),
      false,
      `${key} must stay out of recovery mutations`,
    );
    assert.equal(
      plan.preconditions.some((precondition) => precondition.resourceKey === `file:${key}`),
      false,
      `${key} must stay out of recovery preconditions`,
    );
  }

  const preservedDecision = plan.decisions.find(
    (decision) => decision.resourceKey === `file:${preservedBeforePlanKey}`,
  );
  assert.ok(preservedDecision);
  assert.equal(preservedDecision.decision, 'keep-remote');
  assert.match(preservedDecision.remoteHash, hashPattern);
}

function assertProductionCompletedInspection(inspection, {
  filePath,
  plan,
  activeClaimId,
  releaseVerifierClaimId,
  rawSiteValues,
}) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.activeClaimId, releaseVerifierClaimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.journal.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(inspection.journal.committedState.status, 'completed');
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.journal.committedState.mutationRows, plan.mutations.length);
  assert.equal(inspection.journal.committedState.completedRows, 1);
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0691 production inspection');
}

function assertSqliteCompletedJournal(restarted, { plan, seeded, rawSiteValues }) {
  assert.equal(restarted.storage, 'sqlite');
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records, seeded.records);
  assert.equal(restarted.schemaVersionColumnPresent, true);
  assert.deepEqual(restarted.tableSchemaVersions, [1]);
  assert.deepEqual(restarted.recordSchemaVersions, [1]);
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.committedState.status, 'completed');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.mutationRows, plan.mutations.length);
  assert.equal(restarted.committedState.completedRows, 1);
  assert.equal(restarted.committedState.targetRows, plan.mutations.length);
  assert.equal(restarted.committedState.committedTargetRows, plan.mutations.length);
  assert.deepEqual(restarted.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: true,
  });
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    expectedSequences(restarted.records.length),
  );
  assert.equal(recordsOfType(restarted.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'mutation-observed').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'journal-completed').length, 1);
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(restarted.records, rawSiteValues);
}

function assertNewRemoteRecoveryState(inspection, {
  plan,
  current,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.equal(inspection.reason, 'Every planned target currently matches its journaled after hash.');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.classification, {
    state: 'fully-updated-remote',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote,
    journalIntegrity: 'ok',
    durableRows: inspection.journal.records.length,
    retry: 'no-op',
    targetEnvelope: {
      total: plan.mutations.length,
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
    },
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'new-remote',
    status: 'fully-updated-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.remoteRecoveryClassification, {
    kind: 'new-remote',
    state: 'fully-updated-remote',
    proved: true,
    replaySafe: true,
    counts: {
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
      total: plan.mutations.length,
    },
    journalState: 'ok',
    storage: 'sqlite',
  });
  assert.equal(inspection.journal.storage, 'sqlite');
  assert.equal(inspection.journal.committedState.status, 'completed');
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    const mutation = plan.mutations.find((candidate) => candidate.id === target.mutationId);
    assert.ok(mutation);
    assert.equal(target.state, 'new');
    assert.equal(target.observedHash, resourceHash(current, mutation.resource));
    assert.equal(target.observedHash, target.afterHash);
    assert.notEqual(target.beforeHash, target.afterHash);
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
  }
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0691 new-remote inspection');
}

function assertOldRemoteInspection(inspection, {
  plan,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'old-remote',
    status: 'old-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0691 old-remote inspection');
}

function assertBlockedInspection(inspection, {
  plan,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
  assert.equal(inspection.counts.old, 0);
  assert.equal(inspection.counts.new, plan.mutations.length - 1);
  assert.equal(inspection.counts.blockedUnknown, 1);
  assert.equal(inspection.remoteRecoveryClassification.kind, 'blocked-recovery');
  assert.equal(inspection.remoteRecoveryClassification.proved, false);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0691 blocked inspection');
}

function newRemoteRecoveryFromInspection({
  inspection,
  plan,
  checkedPath,
}) {
  return {
    source: 'RPP-0691 SQLite-backed new remote recovery classification',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    journalState: inspection.journal.integrity.status,
    storage: inspection.journal.storage,
    restartReadable: inspection.journal.committedState.restartReadable,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    remoteRecoveryClassification: inspection.remoteRecoveryClassification,
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      checkedPath,
      checkedPathHash: digest({ checkedPath }),
      allTargetsAccountedFor: inspection.remoteClassification.allTargetsAccountedFor,
      targets: inspection.targets.map((target) => ({
        mutationId: target.mutationId,
        resourceKey: target.resourceKey,
        state: target.state,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        observedHash: target.observedHash,
      })),
    },
  };
}

function oldRemoteRecoveryFromInspection({
  inspection,
  plan,
  checkedPath,
}) {
  return {
    source: 'RPP-0691 unchanged remote classification on completed journal',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
      hashOnly: true,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = '9'.repeat(64);
  const conflictingRequestHash = '6'.repeat(64);
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...Array.from({ length: mutationEvents }, (_, index) => ({
      sequence: 3 + index,
      event: 'mutation-applied',
      requestHash: originalRequestHash,
    })),
    { sequence: 3 + mutationEvents, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: 4 + mutationEvents, event: 'apply-replayed', requestHash: originalRequestHash },
    { sequence: 5 + mutationEvents, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];
  const staleClaimRetry = {
    abandoned: {
      status: 500,
      code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
    },
  };
  if (oldRemoteRecovery) {
    staleClaimRetry.oldRemoteRecovery = oldRemoteRecovery;
    staleClaimRetry.abandoned.recovery = oldRemoteRecovery;
  }

  const recovery = {
    source: newRemoteRecovery?.source || 'RPP-0691 missing new remote recovery classification',
    state: newRemoteRecovery?.state || null,
    observedState: newRemoteRecovery?.observedState || null,
    journalState: newRemoteRecovery?.journalState || 'ok',
    checkedPath,
    storage: newRemoteRecovery?.storage || 'sqlite',
    restartReadable: newRemoteRecovery?.restartReadable === true,
    counts: newRemoteRecovery?.counts || null,
    targetEnvelope: newRemoteRecovery?.targetEnvelope || {
      total: mutationEvents,
      old: null,
      new: null,
      blockedUnknown: null,
      hashOnly: true,
      checkedPath,
      allTargetsAccountedFor: false,
    },
    remoteRecoveryClassification: newRemoteRecovery?.remoteRecoveryClassification || null,
  };

  return {
    topology: {
      sourceUrl,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: productionInspection,
    },
    releaseProof: {
      plan: {
        mutations: mutationEvents,
      },
      recoveryInspect: {
        status: 200,
        recovery,
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
          source: 'RPP-0691 different-body conflict recovery state',
          storage: 'sqlite',
          state: 'fully-updated-remote',
          restartReadable: true,
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
        },
      },
      dbJournal: {
        mutationApplied: mutationEvents,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents,
      },
      staleClaimRetry,
      replayAndRetry: {
        required: checkedPath,
        observed: checkedPath,
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
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    durableJournal: {
      checkedAccepted: true,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function assertReleaseVerifierProof(proof, {
  releaseSummary,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  releaseVerifierClaimId,
  checkedPath,
  rawSiteValues,
}) {
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.targetEnvelope.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.staleClaimRetry.oldRemoteRecovery.targetEnvelope.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.sourceUrl, sourceUrl);
  assert.equal(proof.checks.ownsJournal, true);
  assert.equal(proof.checks.restartReadable, true);
  assert.equal(proof.checks.leaseOwnerIdentity, true);
  assert.equal(proof.checks.staleOwnerFencing, true);
  assert.equal(proof.checks.claimExpiryPolicy, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.equal(proof.leaseOwnerIdentity.activeClaimId, releaseVerifierClaimId);
  assert.equal(proof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(proof.leaseOwnerIdentity.matches, true);
  assert.equal(proof.claimExpiryPolicy.proved, true);
  assert.equal(proof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.equal(proof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.deepEqual(proof.recoveryInspectAfterRestart.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.new.proved, true);
  assert.equal(proof.partialStates.new.source, 'release-path recovery inspect');
  assert.equal(proof.partialStates.new.state, 'fully-updated-remote');
  assert.deepEqual(proof.partialStates.new.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.old.proved, true);
  assert.equal(proof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(proof.partialStates.old.state, 'old-remote');
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.partialStates.blocked.proved, true);
  assert.equal(proof.partialStates.blocked.state, 'blocked-recovery');
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.dbBacked, true);
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.storage, 'sqlite');
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.restartReadable, true);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(releaseSummary, rawSiteValues, 'RPP-0691 release summary');
  assertNoRawSiteValues(proof, rawSiteValues, 'RPP-0691 release proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0691 release proof' }));
}

function releaseVerifierEvidenceFor({
  generatedCase,
  plan,
  checkedPath,
  restarted,
  inspection,
  releaseProof,
}) {
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0691',
    variant: 5,
    generatedCase: generatedCase.id,
    planId: plan.id,
    evidenceSource: 'release-verifier-new-remote-recovery-classification-v5',
    evidenceScope: 'local-sqlite-backed-release-verifier',
    status: 'support_only',
    verdict: 'NEW_REMOTE_RECOVERY_STATE_PROVED_SUPPORT_ONLY',
    observedAt: fixedNow.toISOString(),
    checkedCommand,
    checkedRoute,
    sourceUrl,
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    hashOnly: true,
    storage: 'sqlite',
    checkedPathHash: digest({ checkedPath }),
    recoveryInspect: {
      status: inspection.status,
      reasonCode: inspection.reasonCode,
      counts: {
        ...inspection.counts,
        total: plan.mutations.length,
      },
      remoteClassification: inspection.remoteClassification,
      remoteRecoveryClassification: inspection.remoteRecoveryClassification,
    },
    journal: {
      storage: restarted.storage,
      integrityStatus: restarted.integrity.status,
      durableRows: restarted.records.length,
      rowsHash: digest(restarted.records),
      completedRows: restarted.committedState.completedRows,
      committedTargetRows: restarted.committedState.committedTargetRows,
      restartReadable: restarted.committedState.restartReadable,
      targetEnvelope: restarted.committedState.targetEnvelope,
    },
    releaseVerifier: {
      gate: releaseProof.gate,
      durableRecoveryJournalBoundary: releaseProof.durableRecoveryJournalBoundary,
      ok: releaseProof.ok,
      gateStatus: releaseProof.gateStatus,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      checks: {
        recoveryInspectAfterRestart: releaseProof.checks.recoveryInspectAfterRestart,
        oldState: releaseProof.checks.oldState,
        newState: releaseProof.checks.newState,
        blockedState: releaseProof.checks.blockedState,
        sameKeyReplayAfterRejection: releaseProof.checks.sameKeyReplayAfterRejection,
        manualRecoveryAuditExport: releaseProof.checks.manualRecoveryAuditExport,
      },
      partialStates: {
        new: releaseProof.partialStates.new,
        old: releaseProof.partialStates.old,
        blocked: releaseProof.partialStates.blocked,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'support-only SQLite-backed new-remote recovery classification proof; production release boundary still required',
    },
    plannedTargets: plan.mutations.length,
  };

  return {
    ...payload,
    evidenceHash: `sha256:${digest(payload)}`,
  };
}

function assertReleaseVerifierEvidence(evidence, {
  generatedCase,
  plan,
  rawSiteValues,
}) {
  assert.equal(evidence.issue, 'RPP-0691');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.generatedCase, generatedCase.id);
  assert.equal(evidence.planId, plan.id);
  assert.equal(evidence.evidenceSource, 'release-verifier-new-remote-recovery-classification-v5');
  assert.equal(evidence.evidenceScope, 'local-sqlite-backed-release-verifier');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'NEW_REMOTE_RECOVERY_STATE_PROVED_SUPPORT_ONLY');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.hashOnly, true);
  assert.equal(evidence.storage, 'sqlite');
  assert.match(evidence.checkedPathHash, hashPattern);
  assert.equal(evidence.recoveryInspect.status, 'fully-updated-remote');
  assert.equal(evidence.recoveryInspect.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.deepEqual(evidence.recoveryInspect.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(evidence.recoveryInspect.remoteClassification.state, 'new-remote');
  assert.equal(evidence.recoveryInspect.remoteRecoveryClassification.kind, 'new-remote');
  assert.equal(evidence.recoveryInspect.remoteRecoveryClassification.proved, true);
  assert.equal(evidence.recoveryInspect.remoteRecoveryClassification.storage, 'sqlite');
  assert.equal(evidence.journal.storage, 'sqlite');
  assert.equal(evidence.journal.integrityStatus, 'ok');
  assert.equal(evidence.journal.completedRows, 1);
  assert.equal(evidence.journal.committedTargetRows, plan.mutations.length);
  assert.equal(evidence.journal.restartReadable, true);
  assert.match(evidence.journal.rowsHash, hashPattern);
  assert.equal(evidence.releaseVerifier.gate, 'GATE-2');
  assert.equal(evidence.releaseVerifier.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(evidence.releaseVerifier.ok, true);
  assert.equal(evidence.releaseVerifier.gateStatus, 'proven');
  assert.equal(evidence.releaseVerifier.sameReleaseBoundary, true);
  assert.equal(evidence.releaseVerifier.checks.newState, true);
  assert.equal(evidence.releaseVerifier.checks.oldState, true);
  assert.equal(evidence.releaseVerifier.checks.blockedState, true);
  assert.equal(evidence.releaseVerifier.partialStates.new.proved, true);
  assert.deepEqual(evidence.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'support-only SQLite-backed new-remote recovery classification proof; production release boundary still required',
  });
  assert.equal(evidence.plannedTargets, plan.mutations.length);
  assert.match(evidence.evidenceHash, sha256EvidencePattern);

  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, `sha256:${digest(payload)}`);
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0691 release verifier evidence');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0691 release verifier evidence' }));
}

function assertReleaseProofRejectsNewRemoteEvidence({
  productionInspection,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  rawSiteValues,
}) {
  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      newRemoteRecovery,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.ok, false);
  assert.equal(proof.checks.newState, false);
  assert.equal(proof.partialStates.new.proved, false);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assertNoRawSiteValues(proof, rawSiteValues, 'RPP-0691 rejected release proof');
}

function buildSqliteBackedScenario(generatedCase) {
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const {
    plan,
    remote,
    current,
    preservedBeforePlanKey,
    preservedAfterCrashKey,
    preservedBeforePlanValue,
    preservedAfterCrashValue,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);

  assertPlanPreservesRemoteOnlyResources({
    plan,
    preservedBeforePlanKey,
    preservedAfterCrashKey,
  });

  const {
    productionInspection,
    activeClaimId,
    releaseVerifierClaimId,
  } = writeCompletedProductionJournal({
    filePath,
    generatedCase,
    plan,
    remote,
    current,
    artifactRefs,
  });
  assertProductionCompletedInspection(productionInspection, {
    filePath,
    plan,
    activeClaimId,
    releaseVerifierClaimId,
    rawSiteValues,
  });

  const seeded = readRecoveryJournal(filePath);
  assert.equal(seeded.integrity.status, 'ok');
  assert.equal(seeded.committedState.status, 'completed');
  assert.equal(seeded.committedState.restartReadable, true);
  assertHashOnlyJournalRows(seeded.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0691 journal file');

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, seeded.records);
  database.close();

  database = new DatabaseSync(sqlitePath);
  return {
    database,
    filePath,
    plan,
    remote,
    current,
    preservedBeforePlanKey,
    preservedAfterCrashKey,
    preservedBeforePlanValue,
    preservedAfterCrashValue,
    rawSiteValues,
    seeded,
    productionInspection,
    releaseVerifierClaimId,
  };
}

test('RPP-0691 release verifier carries SQLite-backed new-remote recovery classification variant 5', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  for (const generatedCase of generatedNewRemoteCases) {
    const scenario = buildSqliteBackedScenario(generatedCase);
    const {
      database,
      filePath,
      plan,
      remote,
      current,
      preservedBeforePlanKey,
      preservedAfterCrashKey,
      preservedBeforePlanValue,
      preservedAfterCrashValue,
      rawSiteValues,
      seeded,
      productionInspection,
      releaseVerifierClaimId,
    } = scenario;

    try {
      const restarted = readSqliteRecoveryJournalTable(database);
      assertSqliteCompletedJournal(restarted, { plan, seeded, rawSiteValues });

      const inspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current,
      });
      assertNewRemoteRecoveryState(inspection, { plan, current, rawSiteValues });
      assert.equal(current.files[preservedBeforePlanKey], preservedBeforePlanValue);
      assert.equal(current.files[preservedAfterCrashKey], preservedAfterCrashValue);

      const oldRemoteInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: remote,
      });
      assertOldRemoteInspection(oldRemoteInspection, { plan, rawSiteValues });

      const driftedCurrent = cloneJson(current);
      driftedCurrent.files[`${generatedCase.id}-target-1.txt`] =
        `remote-raw-rpp-0691-${generatedCase.id}-outside-envelope-drift`;
      const driftedInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: driftedCurrent,
      });
      assertBlockedInspection(driftedInspection, { plan, rawSiteValues });

      const checkedPath = productionInspection.journal.checked[0];
      assert.equal(checkedPath, filePath);
      const newRemoteRecovery = newRemoteRecoveryFromInspection({
        inspection,
        plan,
        checkedPath,
      });
      const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
        inspection: oldRemoteInspection,
        plan,
        checkedPath,
      });
      const releaseSummary = buildRecoveryReleaseSummary({
        productionInspection,
        plan,
        newRemoteRecovery,
        oldRemoteRecovery,
      });
      const releaseProof = buildDurableRecoveryJournalReleaseProof({
        releaseSummary,
        applyRevalidation: buildBlockedApplyRevalidation(plan),
      });
      assertReleaseVerifierProof(releaseProof, {
        releaseSummary,
        plan,
        newRemoteRecovery,
        oldRemoteRecovery,
        releaseVerifierClaimId,
        checkedPath,
        rawSiteValues,
      });

      const evidence = releaseVerifierEvidenceFor({
        generatedCase,
        plan,
        checkedPath,
        restarted,
        inspection,
        releaseProof,
      });
      assertReleaseVerifierEvidence(evidence, { generatedCase, plan, rawSiteValues });
    } finally {
      database.close();
    }
  }
});

test('RPP-0691 release verifier rejects missing malformed stale and drifted new-remote evidence variant 5', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const generatedCase = generatedNewRemoteCases[0];
  const scenario = buildSqliteBackedScenario(generatedCase);
  const {
    database,
    plan,
    remote,
    current,
    rawSiteValues,
    seeded,
    productionInspection,
  } = scenario;

  try {
    const restarted = readSqliteRecoveryJournalTable(database);
    assertSqliteCompletedJournal(restarted, { plan, seeded, rawSiteValues });

    const inspection = inspectRecoveryJournal({ journal: restarted, plan, current });
    assertNewRemoteRecoveryState(inspection, { plan, current, rawSiteValues });
    const oldRemoteInspection = inspectRecoveryJournal({ journal: restarted, plan, current: remote });
    assertOldRemoteInspection(oldRemoteInspection, { plan, rawSiteValues });
    const checkedPath = productionInspection.journal.checked[0];
    const validNewRemoteRecovery = newRemoteRecoveryFromInspection({
      inspection,
      plan,
      checkedPath,
    });
    const validOldRemoteRecovery = oldRemoteRecoveryFromInspection({
      inspection: oldRemoteInspection,
      plan,
      checkedPath,
    });

    const accepted = buildDurableRecoveryJournalReleaseProof({
      releaseSummary: buildRecoveryReleaseSummary({
        productionInspection,
        plan,
        newRemoteRecovery: validNewRemoteRecovery,
        oldRemoteRecovery: validOldRemoteRecovery,
      }),
      applyRevalidation: buildBlockedApplyRevalidation(plan),
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.checks.newState, true);

    const malformedNewRemoteRecovery = {
      ...validNewRemoteRecovery,
      counts: {
        ...validNewRemoteRecovery.counts,
        new: String(plan.mutations.length),
      },
    };
    const staleNewRemoteRecovery = {
      ...validNewRemoteRecovery,
      counts: {
        old: 0,
        new: plan.mutations.length - 1,
        blockedUnknown: 0,
        total: plan.mutations.length - 1,
      },
    };
    const driftedNewRemoteRecovery = {
      ...validNewRemoteRecovery,
      state: 'blocked-recovery',
      observedState: 'blocked-recovery',
      counts: {
        old: 0,
        new: plan.mutations.length - 1,
        blockedUnknown: 1,
        total: plan.mutations.length,
      },
    };

    for (const rejectionCase of [
      {
        label: 'missing',
        newRemoteRecovery: null,
      },
      {
        label: 'malformed',
        newRemoteRecovery: malformedNewRemoteRecovery,
      },
      {
        label: 'stale',
        newRemoteRecovery: staleNewRemoteRecovery,
      },
      {
        label: 'drifted',
        newRemoteRecovery: driftedNewRemoteRecovery,
      },
    ]) {
      assertReleaseProofRejectsNewRemoteEvidence({
        productionInspection,
        plan,
        newRemoteRecovery: rejectionCase.newRemoteRecovery,
        oldRemoteRecovery: validOldRemoteRecovery,
        rawSiteValues,
      });
    }

    assertNoRawSiteValues(validNewRemoteRecovery, rawSiteValues, 'RPP-0691 valid new evidence');
    assertNoRawSiteValues(malformedNewRemoteRecovery, rawSiteValues, 'RPP-0691 malformed new evidence');
    assertNoRawSiteValues(staleNewRemoteRecovery, rawSiteValues, 'RPP-0691 stale new evidence');
    assertNoRawSiteValues(driftedNewRemoteRecovery, rawSiteValues, 'RPP-0691 drifted new evidence');
  } finally {
    database.close();
  }
});
