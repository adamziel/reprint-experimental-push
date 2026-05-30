import fs from 'node:fs';
import path from 'node:path';
import { assertEvidenceHasNoRawValues } from './evidence-redaction.js';
import { digest } from './stable-json.js';

export const MANUAL_RECOVERY_AUDIT_EXPORT_KIND = 'manual-recovery-audit-export';
export const MANUAL_RECOVERY_AUDIT_EXPORT_SCHEMA_VERSION = 1;

const CLAIM_HASH_PATTERN = /^[a-f0-9]{64}$/;

export class ManualRecoveryAuditExportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ManualRecoveryAuditExportError';
    this.code = code;
    this.details = details;
  }
}

export function buildManualRecoveryAuditExport(options = {}) {
  const recovery = options.report
    || options.repairReport
    || options.inspection
    || options.recovery
    || {};
  const plan = options.plan || options.planObject || recovery.plan || null;
  const generatedAt = normalizeIsoTimestamp(options.generatedAt) || new Date().toISOString();
  const planId = stringOrNull(
    options.planId
      ?? recovery.planId
      ?? recovery.planEvidence?.planId
      ?? plan?.id
      ?? null,
  );
  const planHash = stringOrNull(
    options.planHash
      ?? recovery.planHash
      ?? recovery.planEvidence?.planHash
      ?? (plan ? digest(plan) : null),
  );
  const state = normalizeRecoveryState(
    options.state
      ?? recovery.state
      ?? recovery.status
      ?? recovery.inspection?.status
      ?? null,
  );
  const counts = normalizeCounts(recovery.counts, { plan, state });
  const targets = normalizeTargets({ recovery, plan, state });
  const targetEnvelope = targetEnvelopeFor({ targets, counts, plan });
  const blockedTargets = targets.filter((target) => target.state === 'blocked-unknown');
  const oldTargets = targets.filter((target) => target.state === 'old');
  const source = normalizeSource(options.source, options.sourcePath);
  const manualReview = manualReviewFor({
    state,
    counts,
    blockedTargets,
    oldTargets,
    canMarkRepaired: Boolean(recovery.canMarkRepaired)
      || (counts.total > 0 && counts.new === counts.total && counts.blockedUnknown === 0),
  });
  const audit = {
    kind: MANUAL_RECOVERY_AUDIT_EXPORT_KIND,
    schemaVersion: MANUAL_RECOVERY_AUDIT_EXPORT_SCHEMA_VERSION,
    exportId: null,
    generatedAt,
    source,
    planId,
    planHash,
    state,
    counts,
    targetEnvelope,
    targets,
    manualReview,
    rollbackBoundary: rollbackBoundaryFor(recovery),
    journal: journalSummaryFor(recovery.journal || options.journal),
    artifactRefs: normalizeArtifactRefs(options.artifactRefs || recovery.artifactRefs),
  };
  audit.exportId = digest({ ...audit, exportId: null });
  assertEvidenceHasNoRawValues(audit, {
    label: 'Manual recovery audit export',
    code: 'MANUAL_RECOVERY_AUDIT_EXPORT_RAW_VALUE_FIELD',
  });
  return audit;
}

export function writeManualRecoveryAuditExport(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new ManualRecoveryAuditExportError(
      'MANUAL_RECOVERY_AUDIT_EXPORT_PATH_REQUIRED',
      'writeManualRecoveryAuditExport() requires a non-empty file path.',
      {},
    );
  }

  const audit = buildManualRecoveryAuditExport(options);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(dir);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort cleanup below
      }
    }
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw error;
  }

  return audit;
}

export function manualRecoveryAuditExportProvesRecoveryGate(auditExport, options = {}) {
  const issues = [];
  if (!auditExport || typeof auditExport !== 'object') {
    return manualRecoveryAuditProof(false, null, ['MANUAL_RECOVERY_AUDIT_EXPORT_MISSING'], options);
  }

  try {
    assertEvidenceHasNoRawValues(auditExport, {
      label: 'Manual recovery audit export',
      code: 'MANUAL_RECOVERY_AUDIT_EXPORT_RAW_VALUE_FIELD',
    });
  } catch (error) {
    issues.push(error.code || 'MANUAL_RECOVERY_AUDIT_EXPORT_RAW_VALUE_FIELD');
  }

  if (auditExport.kind !== MANUAL_RECOVERY_AUDIT_EXPORT_KIND) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_KIND_INVALID');
  }
  if (auditExport.schemaVersion !== MANUAL_RECOVERY_AUDIT_EXPORT_SCHEMA_VERSION) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_SCHEMA_INVALID');
  }
  if (!nonEmptyString(auditExport.exportId)) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_ID_MISSING');
  }
  if (!nonEmptyString(auditExport.generatedAt)) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TIME_MISSING');
  }

  const source = auditExport.source || {};
  if (source.readOnly !== true || source.mutates !== false || source.releasePath !== true) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_SOURCE_NOT_RELEASE_READ_ONLY');
  }

  const counts = normalizeCounts(auditExport.counts, {});
  const expectedTotal = Number.isInteger(options.planMutationCount)
    ? options.planMutationCount
    : counts.total;
  if (!Number.isInteger(expectedTotal) || expectedTotal < 0) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TOTAL_MISSING');
  }
  if (Number.isInteger(expectedTotal) && counts.total !== expectedTotal) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TOTAL_MISMATCH');
  }
  if (counts.old + counts.new + counts.blockedUnknown !== counts.total) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_COUNTS_INCONSISTENT');
  }

  const recoveryCounts = options.recovery?.counts || null;
  if (recoveryCounts && !countsMatchRecovery(counts, recoveryCounts)) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_RECOVERY_COUNTS_MISMATCH');
  }
  const recoveryState = normalizeRecoveryState(options.recovery?.state || options.recovery?.status || null);
  if (recoveryState && auditExport.state !== recoveryState) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_RECOVERY_STATE_MISMATCH');
  }

  const targetEnvelope = auditExport.targetEnvelope || {};
  const targets = Array.isArray(auditExport.targets) ? auditExport.targets : [];
  if (targetEnvelope.hashOnly !== true || targetEnvelope.rawValuesIncluded !== false) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TARGET_ENVELOPE_NOT_HASH_ONLY');
  }
  if (targetEnvelope.summaryOnly !== true) {
    if (targets.length !== counts.total) {
      issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TARGET_COUNT_MISMATCH');
    }
    if (!targets.every(targetHasHashAuditContract)) {
      issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_TARGET_HASH_CONTRACT_INVALID');
    }
  } else if (targets.length !== 0) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_SUMMARY_TARGETS_PRESENT');
  }

  const manualReview = auditExport.manualReview || {};
  if (manualReview.mutates !== false || manualReview.requiresFreshInspectBeforeMutation !== true) {
    issues.push('MANUAL_RECOVERY_AUDIT_EXPORT_MANUAL_REVIEW_NOT_FENCED');
  }

  return manualRecoveryAuditProof(issues.length === 0, auditExport, issues, options);
}

function manualRecoveryAuditProof(proved, auditExport, issues, options = {}) {
  const counts = auditExport?.counts && typeof auditExport.counts === 'object'
    ? normalizeCounts(auditExport.counts, {})
    : null;
  return {
    proved,
    issues: [...new Set(issues)].sort(),
    kind: auditExport?.kind || null,
    schemaVersion: auditExport?.schemaVersion ?? null,
    exportId: auditExport?.exportId || null,
    generatedAt: auditExport?.generatedAt || null,
    source: auditExport?.source || null,
    state: auditExport?.state || null,
    counts,
    targetEnvelope: auditExport?.targetEnvelope || null,
    manualReview: auditExport?.manualReview
      ? {
        required: auditExport.manualReview.required === true,
        mutates: auditExport.manualReview.mutates === true,
        requiresFreshInspectBeforeMutation:
          auditExport.manualReview.requiresFreshInspectBeforeMutation === true,
        operatorDecisionTargets:
          auditExport.manualReview.operatorDecisionTemplate?.targets?.length ?? 0,
      }
      : null,
    expectedPlanMutations: Number.isInteger(options.planMutationCount)
      ? options.planMutationCount
      : null,
  };
}

function normalizeSource(source, sourcePath = null) {
  const normalized = source && typeof source === 'object' ? source : {};
  return {
    kind: stringOrNull(normalized.kind) || 'recovery-inspect',
    path: stringOrNull(normalized.path) || stringOrNull(sourcePath) || 'recovery',
    releasePath: normalized.releasePath !== false,
    readOnly: normalized.readOnly !== false,
    mutates: false,
    samePathRequiredForRecoveryMutation:
      normalized.samePathRequiredForRecoveryMutation !== false,
  };
}

function normalizeRecoveryState(state) {
  if (state === 'fully-updated-remote' || state === 'old-remote' || state === 'blocked-recovery') {
    return state;
  }
  if (state === 'fully-updated' || state === 'repaired') {
    return 'fully-updated-remote';
  }
  if (state === 'old-remote-replayable') {
    return 'old-remote';
  }
  if (state === 'partial-remote-replayable' || state === 'blocked-operator-decision-required') {
    return 'blocked-recovery';
  }
  return stringOrNull(state) || 'unknown';
}

function normalizeCounts(counts, { plan = null, state = null } = {}) {
  const planTotal = Array.isArray(plan?.mutations) ? plan.mutations.length : null;
  const old = integerOrZero(counts?.old);
  const updated = integerOrZero(counts?.new);
  const blockedUnknown = integerOrZero(counts?.blockedUnknown ?? counts?.blocked_unknown ?? counts?.unknown);
  const explicitTotal = integerOrNull(counts?.total);
  const inferredTotal = explicitTotal
    ?? planTotal
    ?? (old + updated + blockedUnknown);
  if ((old + updated + blockedUnknown) === 0 && Number.isInteger(inferredTotal) && inferredTotal > 0) {
    if (state === 'fully-updated-remote') {
      return { old: 0, new: inferredTotal, blockedUnknown: 0, total: inferredTotal };
    }
    if (state === 'old-remote') {
      return { old: inferredTotal, new: 0, blockedUnknown: 0, total: inferredTotal };
    }
  }

  return {
    old,
    new: updated,
    blockedUnknown,
    total: Math.max(0, inferredTotal),
  };
}

function normalizeTargets({ recovery, plan, state }) {
  const sourceTargets = Array.isArray(recovery.targets)
    ? recovery.targets
    : [
      ...(Array.isArray(recovery.rollForwardTargets) ? recovery.rollForwardTargets : []),
      ...(Array.isArray(recovery.alreadyUpdatedTargets) ? recovery.alreadyUpdatedTargets : []),
      ...(Array.isArray(recovery.unknownTargets) ? recovery.unknownTargets : []),
    ];

  if (sourceTargets.length > 0) {
    return sourceTargets.map(normalizeTarget).filter(Boolean);
  }

  return targetsFromPlan({ plan, state });
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const state = normalizeTargetState(target.state || target.classification);
  const beforeHash = stringOrNull(target.beforeHash ?? target.expectedOldHash ?? target.oldHash ?? null);
  const afterHash = stringOrNull(target.afterHash ?? target.expectedNewHash ?? target.newHash ?? null);
  const observedHash = stringOrNull(target.observedHash ?? target.currentHash ?? null);
  const code = stringOrNull(target.code)
    || (state === 'blocked-unknown' && observedHash ? 'TARGET_DRIFTED_OUTSIDE_ENVELOPE' : null);

  return stripUndefined({
    mutationId: stringOrNull(target.mutationId),
    resourceKey: stringOrNull(target.resourceKey),
    state,
    code,
    beforeHash,
    afterHash,
    observedHash,
    actionRequired: state === 'old'
      ? 'roll-forward'
      : state === 'blocked-unknown'
        ? 'operator-decision'
        : 'none',
  });
}

function targetsFromPlan({ plan, state }) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  if (mutations.length === 0) {
    return [];
  }

  return mutations.map((mutation) => {
    const beforeHash = stringOrNull(mutation.remoteBeforeHash ?? mutation.beforeHash ?? null);
    const afterHash = stringOrNull(mutation.localHash ?? mutation.afterHash ?? null);
    const targetState = state === 'old-remote'
      ? 'old'
      : state === 'fully-updated-remote'
        ? 'new'
        : 'blocked-unknown';
    return stripUndefined({
      mutationId: stringOrNull(mutation.id),
      resourceKey: stringOrNull(mutation.resourceKey),
      state: targetState,
      code: targetState === 'blocked-unknown' ? 'TARGET_UNKNOWN' : null,
      beforeHash,
      afterHash,
      observedHash: targetState === 'old' ? beforeHash : targetState === 'new' ? afterHash : null,
      actionRequired: targetState === 'old'
        ? 'roll-forward'
        : targetState === 'blocked-unknown'
          ? 'operator-decision'
          : 'none',
    });
  });
}

function normalizeTargetState(state) {
  if (state === 'old' || state === 'new' || state === 'blocked-unknown') {
    return state;
  }
  if (state === 'blocked' || state === 'unknown') {
    return 'blocked-unknown';
  }
  return 'blocked-unknown';
}

function targetEnvelopeFor({ targets, counts, plan }) {
  const hasTargets = targets.length > 0;
  const plannedTargets = Array.isArray(plan?.mutations) ? plan.mutations.length : counts.total;
  return {
    plannedTargets,
    exportedTargets: targets.length,
    summaryOnly: !hasTargets,
    hashOnly: true,
    rawValuesIncluded: false,
    allTargetsHaveBeforeAfterHashes: hasTargets
      ? targets.every((target) => isHashString(target.beforeHash) && isHashString(target.afterHash))
      : null,
    allObservedHashesPresent: hasTargets
      ? targets.every((target) => target.state === 'blocked-unknown' || isHashString(target.observedHash))
      : null,
  };
}

function manualReviewFor({
  state,
  counts,
  blockedTargets,
  oldTargets,
  canMarkRepaired,
}) {
  const requiresOperatorDecision = blockedTargets.length > 0;
  const requiresRollForward = !requiresOperatorDecision && oldTargets.length > 0;
  const required = requiresOperatorDecision || requiresRollForward;

  return {
    required,
    reason: requiresOperatorDecision
      ? 'At least one target is outside the journaled before/after envelope; an operator must review exact hashes before any recovery mutation.'
      : requiresRollForward
        ? 'At least one target is still old; recovery may roll forward only after this hash-only audit is reviewed.'
        : 'Every audited target already matches the after hash.',
    mutates: false,
    requiresFreshInspectBeforeMutation: true,
    allowedActions: [
      ...(requiresRollForward ? ['roll-forward-old-targets'] : []),
      ...(requiresOperatorDecision ? ['operator-apply-after'] : []),
      ...(canMarkRepaired ? ['mark-repaired'] : []),
      'stop',
    ],
    state,
    counts: { ...counts },
    operatorDecisionTemplate: requiresOperatorDecision
      ? {
        action: 'apply-after',
        operatorId: '<operator-id>',
        reason: '<operator-reviewed-hash-only-audit>',
        targets: blockedTargets.map((target) => ({
          action: 'apply-after',
          mutationId: target.mutationId,
          resourceKey: target.resourceKey,
          beforeHash: target.beforeHash,
          afterHash: target.afterHash,
          observedHash: target.observedHash,
        })),
      }
      : null,
  };
}

function rollbackBoundaryFor(recovery) {
  const rollbackBoundary = recovery.rollbackBoundary && typeof recovery.rollbackBoundary === 'object'
    ? recovery.rollbackBoundary
    : null;
  return {
    supported: rollbackBoundary?.supported === true,
    reason: stringOrNull(rollbackBoundary?.reason)
      || 'Manual audit export is hash-only; rollback is not automatic without raw before values.',
    targetCount: Array.isArray(rollbackBoundary?.targets)
      ? rollbackBoundary.targets.length
      : integerOrZero(recovery.counts?.new),
  };
}

function journalSummaryFor(journal) {
  if (!journal || typeof journal !== 'object') {
    return null;
  }

  const integrity = journal.integrity && typeof journal.integrity === 'object'
    ? {
      status: stringOrNull(journal.integrity.status),
      reason: stringOrNull(journal.integrity.reason),
      schemaVersion: integerOrNull(journal.integrity.schemaVersion),
      scope: stringOrNull(journal.integrity.scope),
    }
    : null;

  return stripUndefined({
    status: integrity?.status || stringOrNull(journal.journalState) || null,
    integrity,
    records: Number.isInteger(journal.records)
      ? journal.records
      : Array.isArray(journal.records)
        ? journal.records.length
        : integerOrNull(journal.rowCount ?? journal.rows),
    scope: stringOrNull(journal.scope),
    ownership: clonePlainSummary(journal.ownership),
    claim: claimSummaryFor(journal.claim),
    writerLease: writerLeaseSummaryFor(journal.writerLease),
    leaseFence: leaseFenceSummaryFor(journal.leaseFence),
    openState: stateSummaryFor(journal.openState),
    stagedState: stateSummaryFor(journal.stagedState),
    committedState: stateSummaryFor(journal.committedState),
  });
}

function claimSummaryFor(claim) {
  if (!claim || typeof claim !== 'object') {
    return null;
  }
  return stripUndefined({
    status: stringOrNull(claim.status),
    activeClaimId: stringOrNull(claim.activeClaimId),
    activeClaimHash: hashStringOrNull(claim.activeClaimHash ?? claim.activeClaimKeyHash),
    previousClaimId: stringOrNull(claim.previousClaimId),
    previousClaimHash: hashStringOrNull(claim.previousClaimHash ?? claim.previousClaimKeyHash),
    sequence: integerOrNull(claim.sequence ?? claim.activeClaimSequence),
    type: stringOrNull(claim.type ?? claim.activeClaimEvent),
    staleClaimRejected: typeof claim.staleClaimRejected === 'boolean' ? claim.staleClaimRejected : null,
    claimExpiry: claim.claimExpiry && typeof claim.claimExpiry === 'object'
      ? {
        policy: stringOrNull(claim.claimExpiry.policy),
        expired: claim.claimExpiry.expired === true,
        previousClaimExpired: claim.claimExpiry.previousClaimExpired === true,
        staleThresholdMs: integerOrNull(claim.claimExpiry.staleThresholdMs),
      }
      : null,
  });
}

function writerLeaseSummaryFor(writerLease) {
  if (!writerLease || typeof writerLease !== 'object') {
    return null;
  }
  return stripUndefined({
    strategy: stringOrNull(writerLease.strategy),
    claimId: stringOrNull(writerLease.claimId),
    claimHash: hashStringOrNull(writerLease.claimHash ?? writerLease.claimKeyHash),
    claimKeyUnique: writerLease.claimKeyUnique === true,
    storageGuard: stringOrNull(writerLease.storageGuard),
    fsyncEvidence: writerLease.fsyncEvidence === true,
    monotonicSequence: writerLease.monotonicSequence === true,
    restartReadable: writerLease.restartReadable === true,
    staleClaimRejected: writerLease.staleClaimRejected === true,
  });
}

function leaseFenceSummaryFor(leaseFence) {
  if (!leaseFence || typeof leaseFence !== 'object') {
    return null;
  }
  return stripUndefined({
    boundary: stringOrNull(leaseFence.boundary),
    storageGuard: stringOrNull(leaseFence.storageGuard),
    claimKeyUnique: leaseFence.claimKeyUnique === true,
    fsyncEvidence: leaseFence.fsyncEvidence === true,
    monotonicSequence: leaseFence.monotonicSequence === true,
    restartReadable: leaseFence.restartReadable === true,
    staleClaimRejected: leaseFence.staleClaimRejected === true,
    writerLease: writerLeaseSummaryFor(leaseFence.writerLease),
  });
}

function stateSummaryFor(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  return stripUndefined({
    status: stringOrNull(state.status),
    phase: stringOrNull(state.phase),
    restartReadable: state.restartReadable === true,
    durableRows: integerOrNull(state.durableRows),
    records: integerOrNull(state.records),
    planId: stringOrNull(state.planId),
    state: stringOrNull(state.state),
    observedHash: hashStringOrNull(state.observedHash),
  });
}

function targetHasHashAuditContract(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const state = normalizeTargetState(target.state);
  return nonEmptyString(target.mutationId)
    && nonEmptyString(target.resourceKey)
    && (state === 'old' || state === 'new' || state === 'blocked-unknown')
    && isHashString(target.beforeHash)
    && isHashString(target.afterHash)
    && (state === 'blocked-unknown' || isHashString(target.observedHash));
}

function countsMatchRecovery(counts, recoveryCounts) {
  const normalizedRecoveryCounts = normalizeCounts(recoveryCounts, {});
  return counts.old === normalizedRecoveryCounts.old
    && counts.new === normalizedRecoveryCounts.new
    && counts.blockedUnknown === normalizedRecoveryCounts.blockedUnknown
    && counts.total === normalizedRecoveryCounts.total;
}

function normalizeArtifactRefs(artifactRefs) {
  if (!artifactRefs || typeof artifactRefs !== 'object' || Array.isArray(artifactRefs)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(artifactRefs)
      .filter(([key, value]) => nonEmptyString(key) && nonEmptyString(value))
      .map(([key, value]) => [key, value]),
  );
}

function clonePlainSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => (
        child === null
        || ['string', 'number', 'boolean'].includes(typeof child)
        || key.toLowerCase().endsWith('hash')
      ))
      .map(([key, child]) => [key, child]),
  );
}

function hashStringOrNull(value) {
  return isHashString(value) ? String(value) : null;
}

function isHashString(value) {
  return CLAIM_HASH_PATTERN.test(String(value));
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function integerOrZero(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function fsyncDirectory(dir) {
  let dirFd = null;
  try {
    dirFd = fs.openSync(dir, 'r');
    fs.fsyncSync(dirFd);
  } catch {
    // Directory fsync is best-effort across platforms.
  } finally {
    if (dirFd !== null) {
      try {
        fs.closeSync(dirFd);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
