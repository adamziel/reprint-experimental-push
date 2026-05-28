import { deepClone, digest } from './stable-json.js';
import { deserializeResourceValue, setResource as defaultSetResource } from './resources.js';
import { inspectRecoveryJournal } from './recovery-inspect.js';
import {
  openRecoveryJournal,
  readRecoveryJournal,
  recoveryClaimHash,
} from './recovery-journal.js';

const DRIFTED_TARGET_CODE = 'TARGET_DRIFTED_OUTSIDE_ENVELOPE';
const UNKNOWN_OPERATOR_DECISION_ACTION = 'apply-after';

export class RecoveryRepairError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecoveryRepairError';
    this.code = code;
    this.details = details;
  }
}

export function inspectRecoveryRepair(options = {}) {
  const { plan } = options;
  assertPlan(plan, 'inspectRecoveryRepair()');
  const inspection = inspectRecoveryJournal(options);
  const targets = classifyRepairTargets(inspection.targets);
  const journalStatus = inspection.journal?.integrity?.status || 'blocked';
  const journalClaim = inspection.claim || { status: 'none' };
  const journalCompleted = hasJournalRecord(inspection.journal, 'journal-completed');
  const journalRepaired = hasJournalRecord(inspection.journal, 'journal-repaired');
  const counts = {
    old: targets.old.length,
    new: targets.new.length,
    unknown: targets.unknown.length,
    total: (plan.mutations || []).length,
  };
  const driftedTargets = targets.unknown.filter((target) => target.code === DRIFTED_TARGET_CODE);
  const incompleteJournalTargets = targets.unknown.filter((target) => target.code !== DRIFTED_TARGET_CODE);
  const noUnknownTargets = counts.unknown === 0;
  const canRollForward = journalStatus === 'ok' && noUnknownTargets && counts.old > 0;
  const canMarkRepaired = journalStatus === 'ok'
    && noUnknownTargets
    && counts.old === 0
    && counts.new === counts.total;

  return {
    status: repairStatus({ inspection, counts, journalStatus, driftedTargets, incompleteJournalTargets }),
    reason: repairReason({ inspection, counts, journalStatus, driftedTargets, incompleteJournalTargets }),
    planId: plan.id,
    journalStatus,
    journalCompleted,
    journalRepaired,
    claim: journalClaim,
    counts,
    canRollForward,
    canRollback: false,
    canMarkRepaired,
    requiresOperatorDecision: driftedTargets.length > 0,
    rollbackBoundary: {
      supported: false,
      reason: 'Rollback is not automatic because durable repair journals carry hashes, not raw before values.',
      targets: targets.new,
    },
    rollForwardTargets: targets.old,
    alreadyUpdatedTargets: targets.new,
    unknownTargets: targets.unknown,
    driftedTargets,
    incompleteJournalTargets,
    targets,
    inspection,
    journal: inspection.journal,
  };
}

export function replayRecoveryRepair(options = {}) {
  const {
    plan,
    current,
    mutateCurrent = false,
    operatorDecision = null,
    writeResource = defaultWriteResource,
  } = options;
  assertPlan(plan, 'replayRecoveryRepair()');
  if (!current || typeof current !== 'object') {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_CURRENT_REQUIRED',
      'replayRecoveryRepair() requires a current site snapshot.',
      {},
    );
  }
  if (typeof writeResource !== 'function') {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_WRITER_INVALID',
      'replayRecoveryRepair() requires writeResource to be a function when supplied.',
      {},
    );
  }

  const before = inspectRecoveryRepair(options);
  assertJournalRepairableForReplay(before);
  const unknownDecisions = validateOperatorDecision(operatorDecision, before.driftedTargets);
  const site = mutateCurrent ? current : deepClone(current);
  const mutationById = new Map((plan.mutations || []).map((mutation) => [mutation.id, mutation]));
  const repairTargets = [
    ...before.rollForwardTargets,
    ...before.driftedTargets.filter((target) => unknownDecisions.has(target.mutationId)),
  ];
  const appliedTargets = [];

  for (const target of repairTargets) {
    const mutation = mutationById.get(target.mutationId);
    if (!mutation) {
      throw new RecoveryRepairError(
        'RECOVERY_REPAIR_TARGET_MISSING_MUTATION',
        `Recovery repair target ${target.mutationId} is not present in the supplied plan.`,
        { target },
      );
    }
    writeResource(site, mutation.resource, deserializeResourceValue(mutation.value), {
      planId: plan.id,
      mutation,
      target,
      repairAction: target.state === 'blocked-unknown' ? 'operator-apply-after' : 'apply-after',
    });
    appliedTargets.push(target);
  }

  const after = inspectRecoveryRepair({
    ...options,
    current: site,
  });
  if (!after.canMarkRepaired) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_REPLAY_DID_NOT_CONVERGE',
      'Recovery replay did not converge every planned target to its after hash.',
      {
        before: repairSummary(before),
        after: repairSummary(after),
      },
    );
  }

  return {
    status: 'replayed',
    reason: 'Recovery replay applied only old targets and left already-updated targets untouched.',
    site,
    appliedMutations: appliedTargets.length,
    appliedTargets,
    skippedTargets: before.alreadyUpdatedTargets,
    operatorAppliedTargets: before.driftedTargets.filter((target) => unknownDecisions.has(target.mutationId)),
    before,
    after,
    recoveryState: {
      status: 'fully-updated-remote',
      reason: 'Recovery replay converged every planned target to its after hash.',
      remoteHash: digest(site),
      planId: plan.id,
      artifacts: {
        repair: repairSummary(after),
      },
    },
  };
}

export function markRecoveryJournalRepaired(options = {}) {
  const {
    journalPath,
    plan,
    current,
    artifactRefs = {},
    now,
    repairId = null,
    claimId = null,
  } = options;
  assertPlan(plan, 'markRecoveryJournalRepaired()');
  if (typeof journalPath !== 'string' || journalPath.length === 0) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_JOURNAL_PATH_REQUIRED',
      'markRecoveryJournalRepaired() requires a journalPath.',
      {},
    );
  }
  if (!current || typeof current !== 'object') {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_CURRENT_REQUIRED',
      'markRecoveryJournalRepaired() requires a current site snapshot.',
      {},
    );
  }

  const report = inspectRecoveryRepair({ journalPath, plan, current });
  assertClaimAllowsRepairAppend(report, claimId);
  assertRepairCanBeMarked(report);

  const journal = openRecoveryJournal(journalPath, { truncate: false, now, claimId });
  try {
    const record = journal.appendEvent('journal-repaired', {
      planId: plan.id,
      state: 'repaired',
      repairId,
      observedHash: digest(current),
      repairedTargets: report.alreadyUpdatedTargets.map((target) => ({
        mutationId: target.mutationId,
        resourceKey: target.resourceKey,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        observedHash: target.observedHash,
      })),
      counts: report.counts,
      artifactRefs,
    });
    return {
      status: 'repaired',
      reason: 'Recovery journal repaired marker was appended after every target matched the after hash.',
      record,
      report,
    };
  } finally {
    journal.close();
  }
}

export function repairSummary(report) {
  return {
    status: report.status,
    reason: report.reason,
    planId: report.planId,
    journalStatus: report.journalStatus,
    journalCompleted: report.journalCompleted,
    journalRepaired: report.journalRepaired,
    counts: { ...report.counts },
    canRollForward: report.canRollForward,
    canRollback: report.canRollback,
    canMarkRepaired: report.canMarkRepaired,
    requiresOperatorDecision: report.requiresOperatorDecision,
    rollForwardTargets: report.rollForwardTargets.map(publicTargetSummary),
    alreadyUpdatedTargets: report.alreadyUpdatedTargets.map(publicTargetSummary),
    unknownTargets: report.unknownTargets.map(publicTargetSummary),
  };
}

function assertPlan(plan, operationName) {
  if (!plan || typeof plan !== 'object' || typeof plan.id !== 'string' || !Array.isArray(plan.mutations)) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_PLAN_INVALID',
      `${operationName} requires a recovery plan with an id and mutations array.`,
      {},
    );
  }
}

function classifyRepairTargets(targets) {
  const classified = {
    old: [],
    new: [],
    unknown: [],
  };

  for (const target of Array.isArray(targets) ? targets : []) {
    const summary = normalizeTarget(target);
    if (summary.state === 'old') {
      classified.old.push(summary);
    } else if (summary.state === 'new') {
      classified.new.push(summary);
    } else {
      classified.unknown.push(summary);
    }
  }

  return classified;
}

function normalizeTarget(target) {
  const code = target.code
    || (target.state === 'blocked-unknown' && typeof target.observedHash === 'string'
      ? DRIFTED_TARGET_CODE
      : 'TARGET_UNKNOWN');
  return {
    mutationId: target.mutationId,
    resourceKey: target.resourceKey,
    state: target.state,
    code,
    reason: target.reason || reasonForTargetCode(code),
    beforeHash: target.beforeHash ?? null,
    afterHash: target.afterHash ?? null,
    observedHash: target.observedHash ?? null,
  };
}

function reasonForTargetCode(code) {
  if (code === DRIFTED_TARGET_CODE) {
    return 'Current resource hash is outside the before/after recovery envelope.';
  }
  return 'Recovery target could not be classified from the durable journal.';
}

function repairStatus({ inspection, counts, journalStatus, driftedTargets, incompleteJournalTargets }) {
  if (journalStatus !== 'ok' || incompleteJournalTargets.length > 0) {
    return 'blocked-incomplete-journal';
  }
  if (driftedTargets.length > 0) {
    return 'blocked-operator-decision-required';
  }
  if (counts.new === counts.total) {
    return 'fully-updated-remote';
  }
  if (counts.old === counts.total) {
    return 'old-remote-replayable';
  }
  if (inspection.status === 'blocked-recovery' && counts.old > 0 && counts.new > 0) {
    return 'partial-remote-replayable';
  }
  return inspection.status;
}

function repairReason({ inspection, counts, journalStatus, driftedTargets, incompleteJournalTargets }) {
  if (journalStatus !== 'ok') {
    return inspection.journal?.integrity?.reason || 'Recovery journal integrity is blocked.';
  }
  if (incompleteJournalTargets.length > 0) {
    return 'Recovery journal target envelope is incomplete or invalid and cannot be marked repaired.';
  }
  if (driftedTargets.length > 0) {
    return 'At least one target drifted outside the journaled before/after envelope; an operator decision is required.';
  }
  if (counts.new === counts.total) {
    return 'Every planned target currently matches its journaled after hash.';
  }
  if (counts.old === counts.total) {
    return 'Every planned target is still old and can be replayed forward without touching already-updated targets.';
  }
  if (counts.old > 0 && counts.new > 0) {
    return `Remote is partially updated: ${counts.new} new and ${counts.old} old of ${counts.total} planned targets.`;
  }
  return inspection.reason;
}

function assertJournalRepairableForReplay(report) {
  if (report.journalStatus !== 'ok') {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_INCOMPLETE_JOURNAL',
      'Recovery replay requires an integrity-checked journal.',
      { report: repairSummary(report) },
    );
  }
  if (report.incompleteJournalTargets.length > 0) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_INCOMPLETE_JOURNAL',
      'Recovery replay requires a complete target envelope for every planned mutation.',
      {
        incompleteJournalTargets: report.incompleteJournalTargets.map(publicTargetSummary),
        report: repairSummary(report),
      },
    );
  }
  if (report.driftedTargets.length > 0) {
    return;
  }
  if (report.alreadyUpdatedTargets.length === report.counts.total) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_ALREADY_COMPLETE',
      'Recovery replay is unnecessary because every target already matches the after hash.',
      { report: repairSummary(report) },
    );
  }
}

function assertRepairCanBeMarked(report) {
  if (report.canMarkRepaired) {
    return;
  }
  if (report.driftedTargets.length > 0) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED',
      'Refusing to mark repair complete while targets have drifted outside the before/after envelope.',
      {
        driftedTargets: report.driftedTargets.map(publicTargetSummary),
        report: repairSummary(report),
      },
    );
  }
  throw new RecoveryRepairError(
    'RECOVERY_REPAIR_INCOMPLETE_JOURNAL',
    'Refusing to mark repair complete until every planned target has journal evidence and matches the after hash.',
    {
      oldTargets: report.rollForwardTargets.map(publicTargetSummary),
      incompleteJournalTargets: report.incompleteJournalTargets.map(publicTargetSummary),
      unknownTargets: report.unknownTargets.map(publicTargetSummary),
      report: repairSummary(report),
    },
  );
}

function assertClaimAllowsRepairAppend(report, claimId) {
  const claim = report.claim;
  if (!claim || claim.status === 'none') {
    return;
  }
  if (typeof claimId !== 'string' || claimId.length === 0) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_CLAIM_REQUIRED',
      'Refusing to append a repaired marker to a claim-fenced journal without the active claim id.',
      { activeClaimId: claim.activeClaimId || null, activeClaimHash: claim.activeClaimHash || null },
    );
  }
  const suppliedHash = recoveryClaimHash(claimId);
  if (suppliedHash !== claim.activeClaimHash) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_CLAIM_STALE',
      'Refusing to append a repaired marker with a stale recovery claim id.',
      {
        staleClaimId: claimId,
        staleClaimHash: suppliedHash,
        activeClaimId: claim.activeClaimId || null,
        activeClaimHash: claim.activeClaimHash || null,
      },
    );
  }
}

function validateOperatorDecision(operatorDecision, driftedTargets) {
  const decisions = new Map();
  if (driftedTargets.length === 0) {
    return decisions;
  }
  if (!operatorDecision || typeof operatorDecision !== 'object') {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED',
      'Recovery replay cannot mutate drifted targets without an explicit operator decision.',
      { driftedTargets: driftedTargets.map(publicTargetSummary) },
    );
  }
  if (!hasNonEmptyString(operatorDecision.operator) || !hasNonEmptyString(operatorDecision.reason)) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_OPERATOR_DECISION_INVALID',
      'Operator decision must name the operator and reason for replaying drifted targets.',
      { driftedTargets: driftedTargets.map(publicTargetSummary) },
    );
  }
  const targetDecisions = Array.isArray(operatorDecision.targets) ? operatorDecision.targets : [];
  for (const decision of targetDecisions) {
    if (decision?.action !== UNKNOWN_OPERATOR_DECISION_ACTION) {
      continue;
    }
    decisions.set(decision.mutationId, decision);
  }

  const missing = [];
  const mismatched = [];
  for (const target of driftedTargets) {
    const decision = decisions.get(target.mutationId);
    if (!decision) {
      missing.push(publicTargetSummary(target));
      continue;
    }
    if (
      decision.resourceKey !== target.resourceKey
      || decision.observedHash !== target.observedHash
      || decision.beforeHash !== target.beforeHash
      || decision.afterHash !== target.afterHash
    ) {
      mismatched.push({
        expected: publicTargetSummary(target),
        actual: {
          mutationId: decision.mutationId ?? null,
          resourceKey: decision.resourceKey ?? null,
          beforeHash: decision.beforeHash ?? null,
          afterHash: decision.afterHash ?? null,
          observedHash: decision.observedHash ?? null,
          action: decision.action ?? null,
        },
      });
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    throw new RecoveryRepairError(
      'RECOVERY_REPAIR_OPERATOR_DECISION_INVALID',
      'Operator decision must cover every drifted target with exact before/after/observed hashes.',
      { missing, mismatched },
    );
  }

  return decisions;
}

function publicTargetSummary(target) {
  return {
    mutationId: target.mutationId,
    resourceKey: target.resourceKey,
    state: target.state,
    code: target.code,
    beforeHash: target.beforeHash,
    afterHash: target.afterHash,
    observedHash: target.observedHash,
  };
}

function defaultWriteResource(site, resource, value) {
  defaultSetResource(site, resource, value);
}

function hasJournalRecord(journal, type) {
  return (Array.isArray(journal?.records) ? journal.records : []).some((record) => record.type === type);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function recoveryRepairJournalHasRepairedMarker(journalPath) {
  const journal = readRecoveryJournal(journalPath);
  return journal.integrity.status === 'ok' && hasJournalRecord(journal, 'journal-repaired');
}
