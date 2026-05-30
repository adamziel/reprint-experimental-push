#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  buildBenchmarkModel,
  GIB,
  MIB,
} from './performance-model.js';
import { digest as stableDigest } from '../../src/stable-json.js';

export const LONG_PUSH_PROGRESS_BENCHMARK_ID = 'rpp-0719-long-push-progress-reporting';
export const LONG_PUSH_PROGRESS_POLICY_ID = 'rpp-0719-long-push-progress-reporting';

export const LONG_PUSH_PROGRESS_PROFILES = Object.freeze({
  unit: Object.freeze({
    maxDurationMs: 2_000,
    maxHeapUsedBytes: 128 * MIB,
    maxActionsBetweenReports: 8,
    maxUploadBytesBetweenReports: 64 * MIB,
    minOperatorEvents: 24,
    minUploadBytes: GIB,
    minDbRows: 10_000,
  }),
  'large-site': Object.freeze({
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 256 * MIB,
    maxActionsBetweenReports: 8,
    maxUploadBytesBetweenReports: 64 * MIB,
    minOperatorEvents: 32,
    minUploadBytes: GIB,
    minDbRows: 10_000,
  }),
});

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const REPORT_STEP_MS = 1_000;
const REQUIRED_PHASES = Object.freeze([
  'plan-scan',
  'prepare',
  'transfer',
  'publish',
  'database-batch',
  'plugin-metadata',
  'group-finalize',
  'commit',
]);
const RAW_EVENT_FORBIDDEN_PATTERNS = Object.freeze([
  /wp-content/i,
  /wp_posts/i,
  /wp_postmeta/i,
  /catalog-export/i,
  /commerce-stack/i,
  /payments\.php/i,
  /commerce\.php/i,
  /row-payload/i,
]);

export function runLongPushProgressReportingBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();

  const model = buildBenchmarkModel(config.modelLimits);
  const progress = buildLongPushProgressReport({ model, config });

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const runtime = buildRuntimeReport({ config, started });
  const resources = buildResourceReport({ startUsage, endUsage, startMemory, endMemory, progress });
  const workload = buildWorkloadSummary({ model, progress });
  const gates = evaluateLongPushProgressGates({ config, progress, runtime, resources, workload });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0719',
    benchmark: LONG_PUSH_PROGRESS_BENCHMARK_ID,
    profile: config.profile,
    ok: gates.every((gate) => gate.status === 'pass'),
    runtime,
    resources,
    workload,
    progress,
    gates,
  };
}

export function buildLongPushProgressReport({ model, config = benchmarkConfig({}) }) {
  const actions = flattenModelActions(model);
  const totals = summarizeProgressActions(actions);
  const events = [];
  const state = initialProgressState(totals);
  const phasesSeen = new Set();
  let lastReportActions = 0;
  let lastReportUploadBytes = 0;

  const emit = ({ kind, phase, actionEntry = null }) => {
    const sequence = events.length + 1;
    const event = progressEvent({
      sequence,
      kind,
      phase,
      state,
      totals,
      actionEntry,
      occurredAt: new Date(config.now.getTime() + (sequence - 1) * REPORT_STEP_MS).toISOString(),
    });
    events.push(event);
    lastReportActions = state.completedActions;
    lastReportUploadBytes = state.uploadBytesAcked;
  };

  emit({ kind: 'push-start', phase: 'start' });

  actions.forEach((actionEntry, index) => {
    const phase = progressPhaseForAction(actionEntry.action);
    if (!phasesSeen.has(phase)) {
      phasesSeen.add(phase);
      emit({ kind: 'phase-start', phase, actionEntry });
    }

    applyActionProgress(state, actionEntry.action);

    const isFinalAction = index === actions.length - 1;
    const actionGap = state.completedActions - lastReportActions;
    const uploadByteGap = state.uploadBytesAcked - lastReportUploadBytes;
    if (
      isFinalAction
      || actionGap >= config.maxActionsBetweenReports
      || uploadByteGap >= config.maxUploadBytesBetweenReports
    ) {
      emit({
        kind: isFinalAction ? 'push-complete' : 'progress',
        phase,
        actionEntry,
      });
    }
  });

  if (events.at(-1)?.kind !== 'push-complete') {
    emit({ kind: 'push-complete', phase: 'complete', actionEntry: actions.at(-1) || null });
  }

  const observedGaps = observedProgressGaps(events);
  return {
    policy: {
      policyId: LONG_PUSH_PROGRESS_POLICY_ID,
      variant: 1,
      eventSchemaVersion: 1,
      reportFrom: 'durable-plan-and-receipt-evidence',
      operatorFacingValues: 'counts-bytes-percent-and-hashed-cursors-only',
      completionRule: '100-percent-only-after-final-durable-commit-evidence',
      requiredPhaseCoverage: REQUIRED_PHASES,
    },
    budgets: {
      profile: config.profile,
      maxActionsBetweenReports: config.maxActionsBetweenReports,
      maxUploadBytesBetweenReports: config.maxUploadBytesBetweenReports,
      minOperatorEvents: config.minOperatorEvents,
    },
    totals,
    eventCount: events.length,
    phasesCovered: [...phasesSeen],
    observedGaps,
    events,
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = LONG_PUSH_PROGRESS_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown long-push progress benchmark profile: ${profileName}`);
  }

  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    modelLimits: options.modelLimits || {},
    maxDurationMs: numberOption(options.maxDurationMs, 'maxDurationMs', profile.maxDurationMs),
    maxHeapUsedBytes: numberOption(options.maxHeapUsedBytes, 'maxHeapUsedBytes', profile.maxHeapUsedBytes),
    maxActionsBetweenReports: numberOption(
      options.maxActionsBetweenReports,
      'maxActionsBetweenReports',
      profile.maxActionsBetweenReports,
    ),
    maxUploadBytesBetweenReports: numberOption(
      options.maxUploadBytesBetweenReports,
      'maxUploadBytesBetweenReports',
      profile.maxUploadBytesBetweenReports,
    ),
    minOperatorEvents: numberOption(options.minOperatorEvents, 'minOperatorEvents', profile.minOperatorEvents),
    minUploadBytes: numberOption(options.minUploadBytes, 'minUploadBytes', profile.minUploadBytes),
    minDbRows: numberOption(options.minDbRows, 'minDbRows', profile.minDbRows),
  };
}

function numberOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return number;
}

function flattenModelActions(model) {
  return model.schedules.flatMap((schedule, scheduleIndex) =>
    schedule.actions.map((action, actionIndex) => ({
      scheduleKind: schedule.kind,
      scheduleIndex,
      actionIndex,
      action,
    })),
  );
}

function summarizeProgressActions(actions) {
  return actions.reduce(
    (totals, { action }) => {
      totals.totalActions += 1;
      if (action.type === 'chunk-upload') {
        totals.uploadChunks += 1;
        totals.uploadBytes += action.sizeBytes;
      } else if (action.type === 'db-row-batch') {
        totals.dbBatches += 1;
        totals.dbRows += action.rowCount;
      } else if (action.type === 'file-publish') {
        totals.filePublishes += 1;
      } else if (action.type === 'plugin-metadata-stage') {
        totals.pluginMetadataEntries += 1;
      } else if (action.type === 'group-staging-finalize') {
        totals.groupStagingFinalizes += 1;
      } else if (action.type === 'atomic-group-commit') {
        totals.atomicGroupCommits += 1;
      }
      return totals;
    },
    {
      totalActions: 0,
      uploadChunks: 0,
      uploadBytes: 0,
      dbBatches: 0,
      dbRows: 0,
      filePublishes: 0,
      pluginMetadataEntries: 0,
      groupStagingFinalizes: 0,
      atomicGroupCommits: 0,
    },
  );
}

function initialProgressState(totals) {
  return {
    completedActions: 0,
    uploadChunksAcked: 0,
    uploadBytesAcked: 0,
    dbBatchesCommitted: 0,
    dbRowsCommitted: 0,
    filePublishesFinalized: 0,
    pluginMetadataStaged: 0,
    groupStagingFinalized: 0,
    atomicGroupCommits: 0,
    totals,
  };
}

function progressPhaseForAction(action) {
  if (action.type === 'remote-index-probe') {
    return 'plan-scan';
  }
  if (action.type === 'file-hash' || action.type === 'compression-decision') {
    return 'prepare';
  }
  if (action.type === 'chunk-upload') {
    return 'transfer';
  }
  if (action.type === 'db-row-batch') {
    return 'database-batch';
  }
  if (action.type === 'file-publish') {
    return 'publish';
  }
  if (action.type === 'plugin-metadata-stage') {
    return 'plugin-metadata';
  }
  if (action.type === 'group-staging-finalize') {
    return 'group-finalize';
  }
  if (action.type === 'atomic-group-commit') {
    return 'commit';
  }
  return 'unknown';
}

function applyActionProgress(state, action) {
  state.completedActions += 1;
  if (action.type === 'chunk-upload') {
    state.uploadChunksAcked += 1;
    state.uploadBytesAcked += action.sizeBytes;
  } else if (action.type === 'db-row-batch') {
    state.dbBatchesCommitted += 1;
    state.dbRowsCommitted += action.rowCount;
  } else if (action.type === 'file-publish') {
    state.filePublishesFinalized += 1;
  } else if (action.type === 'plugin-metadata-stage') {
    state.pluginMetadataStaged += 1;
  } else if (action.type === 'group-staging-finalize') {
    state.groupStagingFinalized += 1;
  } else if (action.type === 'atomic-group-commit') {
    state.atomicGroupCommits += 1;
  }
}

function progressEvent({ sequence, kind, phase, state, totals, actionEntry, occurredAt }) {
  return {
    sequence,
    kind,
    phase,
    messageCode: `rpp-0719.${kind}.${phase}`,
    occurredAt,
    completedActions: state.completedActions,
    totalActions: totals.totalActions,
    percentComplete: percent(state.completedActions, totals.totalActions),
    counters: {
      uploadChunksAcked: state.uploadChunksAcked,
      uploadChunksTotal: totals.uploadChunks,
      uploadBytesAcked: state.uploadBytesAcked,
      uploadBytesTotal: totals.uploadBytes,
      dbBatchesCommitted: state.dbBatchesCommitted,
      dbBatchesTotal: totals.dbBatches,
      dbRowsCommitted: state.dbRowsCommitted,
      dbRowsTotal: totals.dbRows,
      filePublishesFinalized: state.filePublishesFinalized,
      filePublishesTotal: totals.filePublishes,
      pluginMetadataStaged: state.pluginMetadataStaged,
      pluginMetadataTotal: totals.pluginMetadataEntries,
      groupStagingFinalized: state.groupStagingFinalized,
      groupStagingTotal: totals.groupStagingFinalizes,
      atomicGroupCommits: state.atomicGroupCommits,
      atomicGroupCommitTotal: totals.atomicGroupCommits,
    },
    durableCursor: actionProgressCursor(actionEntry),
    redaction: {
      rawValuesIncluded: false,
      payloadBytesIncluded: false,
      resourceIdentity: 'sha256-digest',
      cursorIdentity: 'sha256-digest',
    },
  };
}

function actionProgressCursor(actionEntry) {
  if (!actionEntry) {
    return {
      evidenceSource: 'operator-progress-session',
      actionType: null,
      actionRefHash: null,
      planRefHash: null,
      resourceRefHash: null,
      receiptRefHash: null,
      resumeCursorHash: null,
      idempotencyKeyHash: null,
    };
  }

  const { action, scheduleKind, scheduleIndex, actionIndex } = actionEntry;
  return {
    evidenceSource: actionEvidenceSource(action),
    actionType: action.type,
    actionRefHash: sha256({
      scheduleKind,
      scheduleIndex,
      actionIndex,
      type: action.type,
      chunkIndex: action.chunkIndex ?? null,
      batchIndex: action.batchIndex ?? null,
      durableEvidence: action.durableEvidence ?? null,
    }),
    planRefHash: action.planId ? sha256(action.planId) : null,
    resourceRefHash: resourceRefHash(action),
    receiptRefHash: action.receiptKey ? sha256(action.receiptKey) : null,
    resumeCursorHash: action.resumeCursor ? sha256(action.resumeCursor) : null,
    idempotencyKeyHash: action.idempotencyKey ? sha256(action.idempotencyKey) : null,
  };
}

function actionEvidenceSource(action) {
  if (action.durableEvidence) {
    return action.durableEvidence;
  }
  if (action.type === 'remote-index-probe') {
    return 'remote-index-planning-cursor';
  }
  if (action.type === 'file-hash') {
    return 'local-strong-hash-result';
  }
  if (action.type === 'compression-decision') {
    return 'canonical-compression-decision';
  }
  return 'scheduler-action-evidence';
}

function resourceRefHash(action) {
  if (action.resourceKey) {
    return sha256(action.resourceKey);
  }
  if (action.table) {
    return sha256({ table: action.table, firstRow: action.firstRow, rowCount: action.rowCount });
  }
  if (action.atomicGroupId) {
    return sha256({ atomicGroupId: action.atomicGroupId });
  }
  return null;
}

function percent(completed, total) {
  if (total === 0) {
    return 100;
  }
  return Number(((completed / total) * 100).toFixed(2));
}

function sha256(value) {
  return `sha256:${stableDigest(value)}`;
}

function observedProgressGaps(events) {
  const gaps = events.slice(1).map((event, index) => {
    const previous = events[index];
    return {
      fromSequence: previous.sequence,
      toSequence: event.sequence,
      actions: event.completedActions - previous.completedActions,
      uploadBytes: event.counters.uploadBytesAcked - previous.counters.uploadBytesAcked,
    };
  });
  return {
    maxActionsBetweenReports: Math.max(0, ...gaps.map((gap) => gap.actions)),
    maxUploadBytesBetweenReports: Math.max(0, ...gaps.map((gap) => gap.uploadBytes)),
  };
}

function buildRuntimeReport({ config, started }) {
  return {
    benchmarkId: LONG_PUSH_PROGRESS_BENCHMARK_ID,
    generatedAt: config.now.toISOString(),
    durationMs: elapsedMs(started),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    budgets: {
      profile: config.profile,
      maxDurationMs: config.maxDurationMs,
      maxHeapUsedBytes: config.maxHeapUsedBytes,
    },
  };
}

function buildResourceReport({ startUsage, endUsage, startMemory, endMemory, progress }) {
  return {
    cpuUserMicros: Math.max(0, endUsage.userCPUTime - startUsage.userCPUTime),
    cpuSystemMicros: Math.max(0, endUsage.systemCPUTime - startUsage.systemCPUTime),
    heapUsedBytes: endMemory.heapUsed,
    heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
    rssBytes: endMemory.rss,
    progressEvents: progress.eventCount,
  };
}

function buildWorkloadSummary({ model, progress }) {
  return {
    modelSchemaVersion: model.schemaVersion,
    scheduleCount: model.schedules.length,
    largeSiteShape: {
      uploadBytes: progress.totals.uploadBytes,
      uploadChunks: progress.totals.uploadChunks,
      dbRows: progress.totals.dbRows,
      dbBatches: progress.totals.dbBatches,
      totalActions: progress.totals.totalActions,
      filePublishes: progress.totals.filePublishes,
      atomicGroupCommits: progress.totals.atomicGroupCommits,
    },
  };
}

function evaluateLongPushProgressGates({ config, progress, runtime, resources, workload }) {
  const schema = validateProgressEventSchema(progress.events);
  const monotonic = validateMonotonicProgress(progress.events);
  const durableEvidenceBacked = validateDurableEvidenceBacked(progress.events);
  const redaction = validateProgressRedaction(progress.events);
  const completion = validateCompletion(progress.events, progress.totals);
  const requiredPhases = REQUIRED_PHASES.filter((phase) => !progress.phasesCovered.includes(phase));

  return [
    gate('progress-event-schema', schema.ok, {
      eventCount: progress.eventCount,
      missingFields: schema.missingFields,
      sequenceErrors: schema.sequenceErrors,
    }),
    gate('phase-coverage', requiredPhases.length === 0, {
      required: REQUIRED_PHASES,
      covered: progress.phasesCovered,
      missing: requiredPhases,
    }),
    gate('monotonic-progress-counters', monotonic.ok, monotonic.evidence),
    gate('bounded-operator-update-gaps',
      progress.observedGaps.maxActionsBetweenReports <= config.maxActionsBetweenReports
        && progress.observedGaps.maxUploadBytesBetweenReports <= config.maxUploadBytesBetweenReports
        && progress.eventCount >= config.minOperatorEvents,
      {
        observed: progress.observedGaps,
        budgets: progress.budgets,
        eventCount: progress.eventCount,
      }),
    gate('durable-evidence-backed-progress', durableEvidenceBacked.ok, durableEvidenceBacked.evidence),
    gate('hash-only-progress-redaction', redaction.ok, redaction.evidence),
    gate('completion-after-final-durable-evidence', completion.ok, completion.evidence),
    gate('large-site-runtime-budget',
      runtime.durationMs <= config.maxDurationMs
        && resources.heapUsedBytes <= config.maxHeapUsedBytes
        && workload.largeSiteShape.uploadBytes >= config.minUploadBytes
        && workload.largeSiteShape.dbRows >= config.minDbRows,
      {
        profile: config.profile,
        durationMs: runtime.durationMs,
        maxDurationMs: config.maxDurationMs,
        heapUsedBytes: resources.heapUsedBytes,
        maxHeapUsedBytes: config.maxHeapUsedBytes,
        uploadBytes: workload.largeSiteShape.uploadBytes,
        minUploadBytes: config.minUploadBytes,
        dbRows: workload.largeSiteShape.dbRows,
        minDbRows: config.minDbRows,
      }),
  ];
}

function validateProgressEventSchema(events) {
  const missingFields = [];
  const sequenceErrors = [];
  events.forEach((event, index) => {
    for (const field of [
      'sequence',
      'kind',
      'phase',
      'messageCode',
      'occurredAt',
      'completedActions',
      'totalActions',
      'percentComplete',
      'counters',
      'durableCursor',
      'redaction',
    ]) {
      if (!(field in event)) {
        missingFields.push(`${index + 1}:${field}`);
      }
    }
    if (event.sequence !== index + 1) {
      sequenceErrors.push({ expected: index + 1, actual: event.sequence });
    }
  });
  return {
    ok: missingFields.length === 0 && sequenceErrors.length === 0,
    missingFields,
    sequenceErrors,
  };
}

function validateMonotonicProgress(events) {
  const violations = [];
  const counterFields = [
    'uploadChunksAcked',
    'uploadBytesAcked',
    'dbBatchesCommitted',
    'dbRowsCommitted',
    'filePublishesFinalized',
    'pluginMetadataStaged',
    'groupStagingFinalized',
    'atomicGroupCommits',
  ];

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (current.completedActions < previous.completedActions) {
      violations.push(`sequence ${current.sequence} completedActions regressed`);
    }
    if (current.percentComplete < previous.percentComplete) {
      violations.push(`sequence ${current.sequence} percentComplete regressed`);
    }
    for (const field of counterFields) {
      if (current.counters[field] < previous.counters[field]) {
        violations.push(`sequence ${current.sequence} ${field} regressed`);
      }
    }
  }

  const last = events.at(-1) || null;
  return {
    ok: violations.length === 0
      && events[0]?.percentComplete === 0
      && last?.percentComplete === 100,
    evidence: {
      firstPercent: events[0]?.percentComplete ?? null,
      finalPercent: last?.percentComplete ?? null,
      violations,
    },
  };
}

function validateDurableEvidenceBacked(events) {
  const completedEvents = events.filter((event) => event.kind === 'progress' || event.kind === 'push-complete');
  const missing = completedEvents.filter((event) =>
    !event.durableCursor?.evidenceSource
      || !event.durableCursor?.actionType
      || !event.durableCursor?.actionRefHash,
  );
  const chunkEvents = completedEvents.filter((event) => event.durableCursor.actionType === 'chunk-upload');
  const chunkCursorGaps = chunkEvents.filter((event) =>
    !event.durableCursor.receiptRefHash
      || !event.durableCursor.resumeCursorHash
      || !event.durableCursor.idempotencyKeyHash,
  );

  return {
    ok: missing.length === 0 && chunkCursorGaps.length === 0,
    evidence: {
      completedEvents: completedEvents.length,
      missingEvidenceEvents: missing.map((event) => event.sequence),
      chunkEvents: chunkEvents.length,
      chunkCursorGapEvents: chunkCursorGaps.map((event) => event.sequence),
    },
  };
}

function validateProgressRedaction(events) {
  const serialized = JSON.stringify(events);
  const matchedPatterns = RAW_EVENT_FORBIDDEN_PATTERNS
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => pattern.source);
  const rawValueEvents = events.filter((event) =>
    event.redaction.rawValuesIncluded !== false
      || event.redaction.payloadBytesIncluded !== false
      || event.redaction.resourceIdentity !== 'sha256-digest'
      || event.redaction.cursorIdentity !== 'sha256-digest',
  );

  return {
    ok: matchedPatterns.length === 0 && rawValueEvents.length === 0,
    evidence: {
      matchedPatterns,
      rawValueEvents: rawValueEvents.map((event) => event.sequence),
      redactionPolicy: 'hash-only resource and cursor references',
    },
  };
}

function validateCompletion(events, totals) {
  const final = events.at(-1) || null;
  const counters = final?.counters || {};
  const failures = [];
  if (final?.kind !== 'push-complete') {
    failures.push('missing push-complete event');
  }
  if (final?.completedActions !== totals.totalActions) {
    failures.push('completed actions do not match total actions');
  }
  if (counters.uploadChunksAcked !== totals.uploadChunks) {
    failures.push('upload chunks are incomplete');
  }
  if (counters.uploadBytesAcked !== totals.uploadBytes) {
    failures.push('upload bytes are incomplete');
  }
  if (counters.dbBatchesCommitted !== totals.dbBatches) {
    failures.push('db batches are incomplete');
  }
  if (counters.filePublishesFinalized !== totals.filePublishes) {
    failures.push('file publishes are incomplete');
  }
  if (counters.pluginMetadataStaged !== totals.pluginMetadataEntries) {
    failures.push('plugin metadata staging is incomplete');
  }
  if (counters.groupStagingFinalized !== totals.groupStagingFinalizes) {
    failures.push('group staging finalization is incomplete');
  }
  if (counters.atomicGroupCommits !== totals.atomicGroupCommits) {
    failures.push('atomic group commits are incomplete');
  }

  return {
    ok: failures.length === 0,
    evidence: {
      finalSequence: final?.sequence || null,
      finalKind: final?.kind || null,
      finalPercent: final?.percentComplete || null,
      failures,
    },
  };
}

function gate(id, passed, evidence) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence,
  };
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'profile') {
      options.profile = value;
    } else if (key === 'max-duration-ms') {
      options.maxDurationMs = Number.parseInt(value, 10);
    } else if (key === 'max-heap-used-bytes') {
      options.maxHeapUsedBytes = Number.parseInt(value, 10);
    } else if (key === 'max-actions-between-reports') {
      options.maxActionsBetweenReports = Number.parseInt(value, 10);
    } else if (key === 'max-upload-bytes-between-reports') {
      options.maxUploadBytesBetweenReports = Number.parseInt(value, 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runLongPushProgressReportingBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
