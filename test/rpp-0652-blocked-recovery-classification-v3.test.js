import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPushPlan } from '../src/planner.js';
import {
  buildManualRecoveryAuditExport,
  manualRecoveryAuditExportProvesRecoveryGate,
} from '../src/recovery-audit-export.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T11:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const driftedRawValue = 'rpp-0652-drift-private-charlie';

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0652-blocked-v3-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0652-alpha.txt': 'rpp-0652-base-private-alpha',
      'rpp-0652-bravo.txt': 'rpp-0652-base-private-bravo',
      'rpp-0652-charlie.txt': 'rpp-0652-base-private-charlie',
      'rpp-0652-delta.txt': 'rpp-0652-base-private-delta',
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0652-alpha.txt'] = 'rpp-0652-local-private-alpha';
  site.files['rpp-0652-bravo.txt'] = 'rpp-0652-local-private-bravo';
  site.files['rpp-0652-charlie.txt'] = 'rpp-0652-local-private-charlie';
  site.files['rpp-0652-delta.txt'] = 'rpp-0652-local-private-delta';
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  return {
    base,
    local,
    remote,
    plan,
    rawValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    driftedRawValue,
    'rpp-0652-base-private-alpha',
    'rpp-0652-base-private-bravo',
    'rpp-0652-base-private-charlie',
    'rpp-0652-base-private-delta',
    'rpp-0652-local-private-alpha',
    'rpp-0652-local-private-bravo',
    'rpp-0652-local-private-charlie',
    'rpp-0652-local-private-delta',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0652 hash-only evidence leaked raw value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournal(journal, rawValues) {
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  assert.ok(journal.records.every((record) => record.fsync?.requested === true));
  for (const record of journal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawValues(journal, rawValues);
}

function assertProductionInspection(inspection, { filePath, rawValues }) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawValues(inspection, rawValues);
}

function writeBlockedJournalInChild({
  filePath,
  base,
  local,
  remote,
  artifactRefs,
  activeClaimId,
  claimStaleThresholdMs,
}) {
  const childScript = `
    import { applyPlan } from ${JSON.stringify(new URL('../src/apply.js', import.meta.url).href)};
    import { createPushPlan } from ${JSON.stringify(new URL('../src/planner.js', import.meta.url).href)};
    import {
      appendRecoveryClaimOpened,
      openRecoveryJournal,
    } from ${JSON.stringify(new URL('../src/recovery-journal.js', import.meta.url).href)};

    const fixedNow = new Date('2026-05-31T11:00:00.000Z');
    const filePath = process.env.RPP0652_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0652_BASE_SITE);
    const local = JSON.parse(process.env.RPP0652_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0652_REMOTE_SITE);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const artifactRefs = JSON.parse(process.env.RPP0652_ARTIFACT_REFS);
    const claimStaleThresholdMs = Number(process.env.RPP0652_STALE_THRESHOLD_MS);
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: process.env.RPP0652_ACTIVE_CLAIM_ID,
      claimStaleThresholdMs,
    });
    appendRecoveryClaimOpened(durableJournal, {
      plan,
      current: remote,
      claimId: process.env.RPP0652_ACTIVE_CLAIM_ID,
      staleThresholdMs: claimStaleThresholdMs,
      artifactRefs,
      reason: 'RPP-0652 generated blocked recovery writer claim opened.',
    });

    try {
      applyPlan(remote, plan, {
        durableJournal,
        journalArtifactRefs: artifactRefs,
        mutateRemote: true,
        failDuringCommitAtMutation: 2,
      });
      console.error('expected injected partial commit failure');
      process.exit(3);
    } catch (error) {
      if (
        error?.code !== 'INJECTED_FAILURE_DURING_COMMIT'
        || error?.details?.recovery?.status !== 'blocked-recovery'
      ) {
        console.error(error?.stack || String(error));
        process.exit(2);
      }
      process.exit(0);
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0652_JOURNAL_PATH: filePath,
      RPP0652_BASE_SITE: JSON.stringify(base),
      RPP0652_LOCAL_SITE: JSON.stringify(local),
      RPP0652_REMOTE_SITE: JSON.stringify(remote),
      RPP0652_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0652_ACTIVE_CLAIM_ID: activeClaimId,
      RPP0652_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
}

function buildRestartedBlockedFixture() {
  const filePath = tempJournalPath();
  const scenario = buildScenario();
  const { base, local, remote, plan, rawValues } = scenario;
  const activeClaimId = 'rpp-0652-blocked-active-claim';
  const retryClaimId = 'rpp-0652-blocked-restart-readback';
  const claimStaleThresholdMs = 2_000;
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0652-blocked-recovery-v3-release-proof',
    recoverySupport: 'artifact://rpp-0652-blocked-recovery-v3-support',
  };
  const partialRemote = cloneJson(remote);
  applyFirstMutations(partialRemote, plan, 2);

  writeBlockedJournalInChild({
    filePath,
    base,
    local,
    remote,
    artifactRefs,
    activeClaimId,
    claimStaleThresholdMs,
  });

  const childPersisted = readRecoveryJournal(filePath);
  assertHashOnlyJournal(childPersisted, rawValues);
  assert.equal(
    childPersisted.records.filter((record) => record.type === 'mutation-observed').length,
    2,
  );
  assert.equal(
    childPersisted.records.some((record) => record.type === 'journal-completed'),
    false,
  );
  assert.equal(
    childPersisted.records.find((record) => record.type === 'recovery-state')?.state,
    'blocked-recovery',
  );
  assert.equal(childPersisted.committedState.restartReadable, true);
  assert.equal(childPersisted.committedState.status, 'committed');
  assert.equal(childPersisted.committedState.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(childPersisted.committedState.targetEnvelope.committedTargets, 2);
  assert.equal(childPersisted.committedState.targetEnvelope.allTargetsCommitted, false);

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: partialRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assertProductionInspection(productionInspection, { filePath, rawValues });

  const restarted = readRecoveryJournal(filePath);
  assertHashOnlyJournal(restarted, rawValues);

  const partialInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: partialRemote,
  });

  const driftedRemote = cloneJson(partialRemote);
  driftedRemote.files['rpp-0652-charlie.txt'] = driftedRawValue;
  const blockedUnknownInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: driftedRemote,
  });

  assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawValues);
  assertNoRawValues(partialInspection, rawValues);
  assertNoRawValues(blockedUnknownInspection, rawValues);

  return {
    filePath,
    plan,
    remote,
    partialRemote,
    driftedRemote,
    rawValues,
    restarted,
    productionInspection,
    partialInspection,
    blockedUnknownInspection,
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0652 release-shaped old remote recovery classification',
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

function blockedRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0652 restarted blocked recovery classification',
    status: 409,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    reasonCode: inspection.reasonCode,
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
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  oldRemoteRecovery,
}) {
  const mutationEvents = plan.mutations.length;
  const originalRequestHash = '3'.repeat(64);
  const conflictingRequestHash = '4'.repeat(64);
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

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
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
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          checkedPath: productionInspection.journal.checked[0],
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
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
          source: 'RPP-0652 generated different-body conflict recovery state',
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
      staleClaimRetry: {
        oldRemoteRecovery,
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: productionInspection.journal.checked[0],
        observed: productionInspection.journal.checked[0],
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation({ blockedRecovery }) {
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
      recovery: blockedRecovery,
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
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function manualAuditFromBlockedInspection({ inspection, plan }) {
  return buildManualRecoveryAuditExport({
    recovery: {
      ...inspection,
      status: inspection.status,
    },
    plan,
    generatedAt: fixedNow.toISOString(),
    source: {
      kind: 'rpp-0652-restart-recovery-inspect',
      path: 'inspectRecoveryJournal',
      releasePath: true,
      readOnly: true,
      mutates: false,
    },
    artifactRefs: {
      recoveryAudit: 'artifact://rpp-0652-blocked-recovery-v3-manual-audit',
    },
  });
}

function assertManualAuditRejectsBlockedEvidence({
  candidate,
  recovery,
  plan,
  rawValues,
}) {
  const proof = manualRecoveryAuditExportProvesRecoveryGate(candidate, {
    planMutationCount: plan.mutations.length,
    recovery,
  });

  assert.equal(proof.proved, false);
  assertNoRawValues(proof, rawValues);
}

test('RPP-0652 blocked recovery classification variant 3 survives production journal restart with durable rows', () => {
  const fixture = buildRestartedBlockedFixture();
  const {
    filePath,
    plan,
    remote,
    partialInspection,
    blockedUnknownInspection,
    productionInspection,
    rawValues,
    restarted,
  } = fixture;
  const checkedPath = productionInspection.journal.checked[0];

  assert.equal(partialInspection.status, 'blocked-recovery');
  assert.equal(partialInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.match(partialInspection.reason, /partially updated/);
  assert.deepEqual(partialInspection.counts, {
    old: 2,
    new: 2,
    blockedUnknown: 0,
  });
  assert.deepEqual(partialInspection.classification, {
    state: 'blocked-recovery',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote,
    journalIntegrity: 'ok',
    durableRows: restarted.records.length,
    retry: 'blocked',
    targetEnvelope: {
      total: plan.mutations.length,
      old: 2,
      new: 2,
      blockedUnknown: 0,
    },
  });
  assert.deepEqual(
    partialInspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:rpp-0652-alpha.txt', 'new'],
      ['file:rpp-0652-bravo.txt', 'new'],
      ['file:rpp-0652-charlie.txt', 'old'],
      ['file:rpp-0652-delta.txt', 'old'],
    ],
  );

  assert.equal(blockedUnknownInspection.status, 'blocked-recovery');
  assert.equal(blockedUnknownInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
  assert.deepEqual(blockedUnknownInspection.counts, {
    old: 1,
    new: 2,
    blockedUnknown: 1,
  });
  assert.deepEqual(
    blockedUnknownInspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:rpp-0652-alpha.txt', 'new'],
      ['file:rpp-0652-bravo.txt', 'new'],
      ['file:rpp-0652-charlie.txt', 'blocked-unknown'],
      ['file:rpp-0652-delta.txt', 'old'],
    ],
  );
  for (const target of blockedUnknownInspection.targets) {
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    if (target.state !== 'blocked-unknown') {
      assert.match(target.observedHash, hashPattern);
    }
  }

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: remote,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const blockedRecovery = blockedRecoveryFromInspection({
    inspection: blockedUnknownInspection,
    plan,
    checkedPath,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation({ blockedRecovery }),
  });
  const manualAudit = manualAuditFromBlockedInspection({
    inspection: blockedUnknownInspection,
    plan,
  });
  const manualAuditProof = manualRecoveryAuditExportProvesRecoveryGate(manualAudit, {
    planMutationCount: plan.mutations.length,
    recovery: blockedUnknownInspection,
  });

  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.partialStates.blocked.proved, true);
  assert.equal(releaseProof.partialStates.blocked.source, 'apply-time revalidation recovery inspect');
  assert.deepEqual(releaseProof.partialStates.blocked.counts, blockedRecovery.counts);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.equal(manualAudit.kind, 'manual-recovery-audit-export');
  assert.equal(manualAudit.state, 'blocked-recovery');
  assert.equal(manualAudit.targetEnvelope.hashOnly, true);
  assert.equal(manualAudit.targetEnvelope.rawValuesIncluded, false);
  assert.equal(manualAudit.manualReview.required, true);
  assert.equal(manualAudit.manualReview.mutates, false);
  assert.equal(manualAuditProof.proved, true);
  assertNoRawValues({
    releaseProof,
    manualAudit,
    manualAuditProof,
    partialInspection,
    blockedUnknownInspection,
  }, rawValues);
  assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawValues);
});

test('RPP-0652 blocked recovery proof rejects missing malformed stale or drifted classification evidence', () => {
  const fixture = buildRestartedBlockedFixture();
  const {
    plan,
    blockedUnknownInspection,
    productionInspection,
    restarted,
    remote,
    rawValues,
  } = fixture;
  const checkedPath = productionInspection.journal.checked[0];
  const oldRemoteInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: remote,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection,
    plan,
    oldRemoteRecovery,
  });
  const validBlockedRecovery = blockedRecoveryFromInspection({
    inspection: blockedUnknownInspection,
    plan,
    checkedPath,
  });
  const validManualAudit = manualAuditFromBlockedInspection({
    inspection: blockedUnknownInspection,
    plan,
  });
  const invalidClassifications = [
    {
      name: 'missing',
      blockedRecovery: null,
      audit: null,
    },
    {
      name: 'malformed',
      blockedRecovery: {
        ...validBlockedRecovery,
        counts: {
          old: 1,
          new: 2,
          blockedUnknown: 'blocked',
          total: plan.mutations.length,
        },
      },
      audit: {
        ...validManualAudit,
        counts: {
          old: 1,
          new: 2,
          blockedUnknown: 1,
          total: plan.mutations.length + 1,
        },
      },
    },
    {
      name: 'stale',
      blockedRecovery: {
        ...validBlockedRecovery,
        counts: {
          old: 2,
          new: 2,
          blockedUnknown: 0,
          total: plan.mutations.length,
        },
      },
      audit: {
        ...validManualAudit,
        counts: {
          old: 2,
          new: 2,
          blockedUnknown: 0,
          total: plan.mutations.length,
        },
      },
    },
    {
      name: 'drifted',
      blockedRecovery: {
        ...validBlockedRecovery,
        state: 'fully-updated-remote',
        observedState: 'fully-updated-remote',
        counts: {
          old: 0,
          new: plan.mutations.length,
          blockedUnknown: 0,
          total: plan.mutations.length,
        },
      },
      audit: {
        ...validManualAudit,
        state: 'fully-updated-remote',
      },
    },
  ];

  for (const classification of invalidClassifications) {
    const proof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary,
      applyRevalidation: buildBlockedApplyRevalidation({
        blockedRecovery: classification.blockedRecovery,
      }),
    });

    assert.equal(proof.ok, false, `${classification.name} release proof must fail closed`);
    assert.equal(proof.checks.blockedState, false);
    assert.equal(proof.partialStates.blocked.proved, false);
    assertNoRawValues(proof, rawValues);
    assertManualAuditRejectsBlockedEvidence({
      candidate: classification.audit,
      recovery: blockedUnknownInspection,
      plan,
      rawValues,
    });
  }
});
