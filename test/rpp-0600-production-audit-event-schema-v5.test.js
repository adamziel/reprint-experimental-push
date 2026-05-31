import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0600-production-audit-event-schema-v5.md');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');

const sourceUrl = 'https://source.example.test/rpp-0600';
const routePrefix = '/wp-json/reprint/v1/push';
const journalEndpointPath = `${routePrefix}/db-journal`;
const checkedJournalRoute = `${journalEndpointPath}?limit=80`;
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const credential = {
  username: 'rpp_0600_admin',
  password: 'rpp-0600-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0600_raw_session_id';
const idempotencyKey = 'idem-rpp-0600-raw-idempotency-key';
const rawPayload = 'rpp-0600-private-payload-value';
const rawOptionValue = 'rpp-0600-private-option-value';
const rawJournalPayload = 'rpp-0600-private-journal-payload-value';
const proofCapturedAt = '2026-05-31T14:00:00Z';
const hashPattern = /^[a-f0-9]{64}$/;
const requiredRouteEvidence = {
  routeProfile: 'production-shaped',
  restNamespace: 'reprint/v1',
  routePrefix: '/push',
  journalRoute: '/push/db-journal',
  schemaRoute: '/push/db-journal/schema',
  checkedSurface: 'production-shaped-rest-route',
};
const forbiddenRawFields = [
  'value',
  'content',
  'payload',
  'post_content',
  'option_value',
  'meta_value',
];

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function storageGuard() {
  return {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  };
}

function journalOwnership() {
  return {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'filesystem-compare-rename',
    supportedSurface: 'claim-fenced-restart-readable',
  };
}

function journalLeaseFence() {
  return {
    boundary: 'filesystem-compare-rename',
    claimKeyUnique: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: false,
  };
}

function productionAuditEventSchema(overrides = {}) {
  return {
    schemaVersion: 1,
    schemaId: 'reprint-push-production-audit-event/v1',
    routeEvidence: {
      ...requiredRouteEvidence,
      ...(overrides.routeEvidence || {}),
    },
    eventStore: {
      storage: 'wpdb',
      appendOnlyEvents: true,
      sequenceField: 'sequence',
      cursorPrefix: 'db-journal:',
      ...(overrides.eventStore || {}),
    },
    eventShape: {
      type: 'object',
      required: ['schemaVersion', 'sequence', 'event', 'resourceHashEvidence'],
      ...(overrides.eventShape || {}),
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
      hashOnlyFields: [
        'idempotencyKeyHash',
        'requestHash',
        'resourceHashEvidence.*Hash',
      ],
      forbiddenRawFields,
      ...(overrides.redaction || {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => ![
        'routeEvidence',
        'eventStore',
        'eventShape',
        'redaction',
      ].includes(key)),
    ),
  };
}

const expectedAuditEventSchemaHash = digest(productionAuditEventSchema());

function malformedAuditEventSchema() {
  return productionAuditEventSchema({
    eventShape: {
      required: ['schemaVersion', 'sequence', 'event'],
    },
    redaction: {
      format: 'mixed',
      rawValuesIncluded: true,
      hashAlgorithm: 'plain',
      hashOnlyFields: ['requestHash'],
    },
  });
}

function staleAuditEventSchema() {
  return productionAuditEventSchema({
    supportProofRevision: 'rpp-0580-production-audit-event-schema-v4',
  });
}

function driftedAuditEventSchema() {
  return productionAuditEventSchema({
    routeEvidence: {
      schemaRoute: '/push/db-journal/schema-v0',
      checkedSurface: 'legacy-rest-route',
    },
  });
}

function generatedAuditRows() {
  const requestHash = sha256Hex(rawPayload);
  const keyHash = sha256Hex(idempotencyKey);
  return [
    {
      schemaVersion: 1,
      sequence: 6001,
      event: 'idempotency-opened',
      idempotencyKeyHash: keyHash,
      requestHash,
      resourceHashEvidence: {
        beforeHash: sha256Hex(rawOptionValue),
        journalPayloadHash: sha256Hex(rawJournalPayload),
      },
    },
    {
      schemaVersion: 1,
      sequence: 6002,
      event: 'mutation-applied',
      idempotencyKeyHash: keyHash,
      requestHash,
      appliedCount: 1,
      resourceHashEvidence: {
        beforeHash: sha256Hex(rawOptionValue),
        afterHash: sha256Hex(`${rawOptionValue}:after`),
      },
    },
    {
      schemaVersion: 1,
      sequence: 6003,
      event: 'apply-committed',
      idempotencyKeyHash: keyHash,
      requestHash,
      appliedCount: 1,
    },
  ];
}

function eventSummaries(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.event, (counts.get(row.event) || 0) + 1);
  }
  return [...counts.entries()].map(([event, count]) => ({ event, count }));
}

function createProductionAuditSchemaRoute({
  auditEventSchema = productionAuditEventSchema(),
  rows = generatedAuditRows(),
  includeAuditEventSchema = true,
} = {}) {
  const auth = {
    identity: {
      userLogin: credential.username,
      userId: 600,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const state = {
    requests: [],
    journalReads: [],
    applyCount: 0,
    rows,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const request = {
      method: options.method || 'GET',
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers: headerEntries(options.headers || {}),
      rawBody: typeof options.body === 'string' ? options.body : '',
    };
    state.requests.push(request);

    if (request.pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        mode: 'preflight',
        auth,
        session: { id: sessionId },
      });
    }

    if (request.pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: { resources: [] },
      });
    }

    if (request.pathname === `${routePrefix}/dry-run`) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt: { receiptHash: sha256Hex('rpp-0600-dry-run-receipt') },
      });
    }

    if (request.pathname === `${routePrefix}/apply`) {
      state.applyCount += 1;
      const replayed = state.applyCount > 1;
      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: replayed ? 0 : 1,
        code: replayed ? 'BATCH_ALREADY_COMMITTED' : 'APPLIED',
        responseSchemaVersion: 1,
        auth,
        ...(replayed ? {} : { receipt: { receiptHash: sha256Hex('rpp-0600-apply-receipt') } }),
        storageGuard: storageGuard(),
        idempotency: {
          replayed,
          freshMutationWork: !replayed,
          conflict: false,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: request.headers['x-auth-content-hash'],
        },
      });
    }

    if (request.pathname === `${routePrefix}/recovery/inspect`) {
      return jsonResponse({
        ok: true,
        auth,
        recovery: {
          state: 'ok',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      });
    }

    if (request.pathname === journalEndpointPath) {
      state.journalReads.push(request);
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          rowCount: rows.length,
          ...(includeAuditEventSchema ? { auditEventSchema } : {}),
          latestRows: rows,
          eventSummaries: eventSummaries(rows),
          ownership: journalOwnership(),
          writerLease: {
            storageGuard: 'filesystem-compare-rename',
            restartReadable: true,
          },
          leaseFence: journalLeaseFence(),
        },
        storageGuard: storageGuard(),
      });
    }

    throw new Error(`unexpected RPP-0600 fetch to ${request.pathname}`);
  }

  return { state, fetchHandler, auditEventSchema };
}

function auditSchemaIssues(schema) {
  const issues = [];
  if (!schema || typeof schema !== 'object') {
    return ['missing-dbJournal.auditEventSchema'];
  }

  if (schema.schemaVersion !== 1) {
    issues.push('schema.schemaVersion');
  }
  if (schema.schemaId !== 'reprint-push-production-audit-event/v1') {
    issues.push('schema.schemaId');
  }

  const routeEvidence = schema.routeEvidence || {};
  for (const [field, expected] of Object.entries(requiredRouteEvidence)) {
    if (routeEvidence[field] !== expected) {
      issues.push(`schema.routeEvidence.${field}`);
    }
  }

  if (schema.eventStore?.storage !== 'wpdb') {
    issues.push('schema.eventStore.storage');
  }
  if (schema.eventStore?.appendOnlyEvents !== true) {
    issues.push('schema.eventStore.appendOnlyEvents');
  }
  if (schema.eventStore?.sequenceField !== 'sequence') {
    issues.push('schema.eventStore.sequenceField');
  }
  if (!Array.isArray(schema.eventRequiredFields) || !schema.eventRequiredFields.includes('resourceHashEvidence')) {
    issues.push('schema.eventRequiredFields.resourceHashEvidence');
  }

  const redaction = schema.redaction || {};
  if (redaction.format !== 'hash-only') {
    issues.push('schema.redaction.format');
  }
  if (redaction.rawValuesIncluded !== false) {
    issues.push('schema.redaction.rawValuesIncluded');
  }
  if (redaction.hashAlgorithm !== 'sha256') {
    issues.push('schema.redaction.hashAlgorithm');
  }
  for (const field of ['idempotencyKeyHash', 'requestHash', 'resourceHashEvidence.*Hash']) {
    if (!Array.isArray(redaction.hashOnlyFields) || !redaction.hashOnlyFields.includes(field)) {
      issues.push(`schema.redaction.hashOnlyFields.${field}`);
    }
  }
  for (const field of forbiddenRawFields) {
    if (!Array.isArray(redaction.forbiddenRawFields) || !redaction.forbiddenRawFields.includes(field)) {
      issues.push(`schema.redaction.forbiddenRawFields.${field}`);
    }
  }

  if (issues.length === 0 && schema.schemaHash !== expectedAuditEventSchemaHash) {
    issues.push('schema.schemaHash.stale');
  }

  return issues;
}

function auditEventHashEvidenceIssues(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return ['missing-audit-event-rows'];
  }

  const issues = [];
  rows.forEach((row, index) => {
    if (row.schemaVersion !== 1) {
      issues.push(`row.${index}.schemaVersion`);
    }
    if (!Number.isInteger(row.sequence) || row.sequence <= 0) {
      issues.push(`row.${index}.sequence`);
    }
    if (!row.event || typeof row.event !== 'string') {
      issues.push(`row.${index}.event`);
    }
    collectHashOnlyFieldIssues(row, `row.${index}`, issues);
  });
  return issues;
}

function collectHashOnlyFieldIssues(value, prefix, issues) {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPrefix = `${prefix}.${key}`;
    if (forbiddenRawFields.includes(key)) {
      issues.push(childPrefix);
    }
    if (key.endsWith('Hash') && !hashPattern.test(String(child))) {
      issues.push(childPrefix);
    }
    if (child && typeof child === 'object') {
      collectHashOnlyFieldIssues(child, childPrefix, issues);
    }
  }
}

function sanitizedAuditRowInventory(rows) {
  return rows.map((row) => ({
    schemaVersion: row.schemaVersion,
    sequence: row.sequence,
    event: row.event,
    idempotencyKeyHash: hashPattern.test(String(row.idempotencyKeyHash || ''))
      ? row.idempotencyKeyHash
      : sha256Hex(row.idempotencyKeyHash || ''),
    requestHash: hashPattern.test(String(row.requestHash || ''))
      ? row.requestHash
      : sha256Hex(row.requestHash || ''),
    appliedCount: Number.isInteger(row.appliedCount) ? row.appliedCount : null,
    resourceHashEvidenceHash: row.resourceHashEvidence
      ? digest(row.resourceHashEvidence)
      : null,
  }));
}

function collectAuditSchemaRouteEvidenceSummaries(value, summaries = []) {
  if (!value || typeof value !== 'object') {
    return summaries;
  }
  if (
    value.schemaId === 'reprint-push-production-audit-event/v1'
    && value.routeEvidence
    && typeof value.routeEvidence === 'object'
    && value.routeEvidence.journalRoute === requiredRouteEvidence.journalRoute
    && value.routeEvidence.schemaRoute === requiredRouteEvidence.schemaRoute
  ) {
    summaries.push(value.routeEvidence);
  }
  for (const child of Object.values(value)) {
    collectAuditSchemaRouteEvidenceSummaries(child, summaries);
  }
  return summaries;
}

function verifyReleaseAuditSchemaIssues(summary) {
  const issues = [];
  const routeEvidenceSummaries = collectAuditSchemaRouteEvidenceSummaries(summary);

  if (routeEvidenceSummaries.length === 0) {
    issues.push('verifyRelease.routeEvidenceSummary.missing');
  } else if (routeEvidenceSummaries.length > 1) {
    issues.push('verifyRelease.routeEvidenceSummary.duplicated');
  }

  const auditSummary = summary.productionAuditEventSchema || null;
  if (!auditSummary || typeof auditSummary !== 'object') {
    issues.push('verifyRelease.productionAuditEventSchema.missing');
    return issues;
  }
  if (auditSummary.summaryPath !== 'dbJournal.auditEventSchema') {
    issues.push('verifyRelease.productionAuditEventSchema.summaryPath');
  }
  for (const field of ['schemaHash', 'auditEventRowsHash', 'proofHash']) {
    if (auditSummary[field] && !hashPattern.test(String(auditSummary[field]))) {
      issues.push(`verifyRelease.productionAuditEventSchema.${field}`);
    }
  }
  if (auditSummary.routeEvidenceHash !== null && !hashPattern.test(String(auditSummary.routeEvidenceHash || ''))) {
    issues.push('verifyRelease.productionAuditEventSchema.routeEvidenceHash');
  }

  return issues;
}

function auditSchemaEvidenceCode({ schemaIssues, rowIssues, verifierIssues }) {
  if (schemaIssues.includes('missing-dbJournal.auditEventSchema')) {
    return 'PRODUCTION_AUDIT_EVENT_SCHEMA_REQUIRED';
  }
  if (verifierIssues.includes('verifyRelease.routeEvidenceSummary.duplicated')) {
    return 'PRODUCTION_AUDIT_EVENT_SCHEMA_DUPLICATED';
  }
  if (schemaIssues.includes('schema.schemaHash.stale')) {
    return 'PRODUCTION_AUDIT_EVENT_SCHEMA_STALE';
  }
  if (schemaIssues.some((issue) => issue.startsWith('schema.routeEvidence.'))) {
    return 'PRODUCTION_AUDIT_EVENT_SCHEMA_DRIFTED';
  }
  if (schemaIssues.some((issue) => issue.startsWith('schema.redaction.')) || rowIssues.length > 0) {
    return 'PRODUCTION_AUDIT_EVENT_HASH_ONLY_REQUIRED';
  }
  return 'PRODUCTION_AUDIT_EVENT_SCHEMA_ROUTE_EVIDENCE_REQUIRED';
}

function buildProductionAuditSchemaEvidence({ pushSummary, journalRequest, rows }) {
  const dbJournal = pushSummary.dbJournal || {};
  const auditEventSchema = dbJournal.auditEventSchema || null;
  const schemaIssues = auditSchemaIssues(auditEventSchema);
  const rowIssues = auditEventHashEvidenceIssues(rows);
  const schemaReadbackOk = Boolean(
    dbJournal.status === 200
    && dbJournal.ok === true
    && auditEventSchema?.schemaId === 'reprint-push-production-audit-event/v1',
  );
  const ok = schemaReadbackOk && schemaIssues.length === 0 && rowIssues.length === 0;
  const code = ok
    ? 'LOCAL_PRODUCTION_AUDIT_EVENT_SCHEMA_V5_SUPPORT_ONLY'
    : auditSchemaEvidenceCode({ schemaIssues, rowIssues, verifierIssues: [] });
  const core = {
    schemaVersion: 1,
    slice: 'RPP-0600',
    proofClass: 'deterministic-production-audit-event-schema-v5',
    evidenceScope: 'local-executor-auth-support',
    productionBacked: false,
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAt: proofCapturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(sourceUrl),
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: journalRequest?.headers?.['x-reprint-push-session']
        ? sha256Hex(journalRequest.headers['x-reprint-push-session'])
        : null,
      sessionBound: Boolean(journalRequest?.headers?.['x-reprint-push-session']),
      manageOptions: true,
    },
    dbJournalReadback: {
      status: dbJournal.status ?? null,
      ok: dbJournal.ok === true,
      requestedLimit: dbJournal.requestedLimit ?? null,
      readbackPages: dbJournal.readbackPages ?? null,
      paginationComplete: dbJournal.paginationComplete === true,
      paginationTruncated: dbJournal.paginationTruncated === true,
      rows: dbJournal.rows ?? null,
      rowCount: dbJournal.rowCount ?? null,
      eventCounts: dbJournal.eventCounts || {},
      latestEventsHash: digest(dbJournal.latestEvents || []),
      journalScopeHash: dbJournal.scope ? sha256Hex(dbJournal.scope) : null,
      auditEventSchema,
    },
    auditEventHashEvidence: {
      hashOnly: rowIssues.length === 0,
      rowsHash: digest(sanitizedAuditRowInventory(rows)),
      rowCount: rows.length,
      issueCount: rowIssues.length,
      issues: rowIssues,
    },
    schemaValidation: {
      ok: schemaIssues.length === 0,
      expectedSchemaHash: expectedAuditEventSchemaHash,
      issueCount: schemaIssues.length,
      issues: schemaIssues,
    },
    routeReceipt: {
      method: journalRequest?.method || null,
      checkedRoute: checkedJournalRoute,
      requestPath: journalRequest
        ? `${journalRequest.pathname}${journalRequest.search || ''}`
        : null,
      schemaReadbackOk,
      mutationAttempted: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: ok
        ? 'local audit event schema proof is support-only until checked production release evidence exists'
        : 'missing, malformed, stale, drifted, or duplicated audit event schema evidence blocks release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed audit event schema route proof',
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };

  return {
    ...core,
    proofHash: digest(core),
  };
}

function buildVerifyReleaseStyleSummary(auditSchemaEvidence, { duplicateRouteEvidenceSummary = false } = {}) {
  const auditEventSchema = auditSchemaEvidence.dbJournalReadback.auditEventSchema;
  const summary = {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: '',
    mutationAttempted: false,
    dbJournal: {
      status: auditSchemaEvidence.dbJournalReadback.status,
      ok: auditSchemaEvidence.dbJournalReadback.ok,
      requestedLimit: auditSchemaEvidence.dbJournalReadback.requestedLimit,
      readbackPages: auditSchemaEvidence.dbJournalReadback.readbackPages,
      paginationComplete: auditSchemaEvidence.dbJournalReadback.paginationComplete,
      paginationTruncated: auditSchemaEvidence.dbJournalReadback.paginationTruncated,
      rows: auditSchemaEvidence.dbJournalReadback.rows,
      rowCount: auditSchemaEvidence.dbJournalReadback.rowCount,
      eventCounts: auditSchemaEvidence.dbJournalReadback.eventCounts,
      latestEventsHash: auditSchemaEvidence.dbJournalReadback.latestEventsHash,
      journalScopeHash: auditSchemaEvidence.dbJournalReadback.journalScopeHash,
      auditEventSchema,
    },
    productionAuditEventSchema: {
      ok: false,
      summaryPath: 'dbJournal.auditEventSchema',
      schemaHash: auditEventSchema?.schemaHash || '',
      expectedSchemaHash: auditSchemaEvidence.schemaValidation.expectedSchemaHash,
      routeEvidenceHash: auditEventSchema?.routeEvidence
        ? digest(auditEventSchema.routeEvidence)
        : null,
      auditEventRowsHash: auditSchemaEvidence.auditEventHashEvidence.rowsHash,
      proofHash: auditSchemaEvidence.proofHash,
      hashOnly: auditSchemaEvidence.auditEventHashEvidence.hashOnly,
      routeEvidenceSummaryCount: null,
      issues: [],
      required: [
        'dbJournal.auditEventSchema.routeEvidence.journalRoute',
        'dbJournal.auditEventSchema.routeEvidence.schemaRoute',
        'dbJournal.auditEventSchema.redaction.rawValuesIncluded=false',
        'audit event *Hash fields are sha256 hex',
        'exactly one production audit event schema route-evidence summary',
      ],
      scope: auditSchemaEvidence.evidenceScope,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'production-backed audit event schema route proof required before release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed audit event schema route proof',
      status: 'blocked',
      verdict: '',
    },
  };

  if (duplicateRouteEvidenceSummary && auditEventSchema) {
    summary.topologyEvidence = {
      auditEventSchema,
    };
  }

  const verifierIssues = verifyReleaseAuditSchemaIssues(summary);
  const issues = [
    ...auditSchemaEvidence.schemaValidation.issues,
    ...auditSchemaEvidence.auditEventHashEvidence.issues,
    ...verifierIssues,
  ];
  const routeEvidenceSummaryCount = collectAuditSchemaRouteEvidenceSummaries(summary).length;
  const auditSchemaOk = auditSchemaEvidence.ok === true && verifierIssues.length === 0;
  const reason = auditSchemaOk
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : auditSchemaEvidenceCode({
      schemaIssues: auditSchemaEvidence.schemaValidation.issues,
      rowIssues: auditSchemaEvidence.auditEventHashEvidence.issues,
      verifierIssues,
    });

  summary.statusMarker = `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`;
  summary.productionAuditEventSchema.ok = auditSchemaOk;
  summary.productionAuditEventSchema.routeEvidenceSummaryCount = routeEvidenceSummaryCount;
  summary.productionAuditEventSchema.issues = issues;
  summary.releaseMovement.reason = auditSchemaOk
    ? 'production-backed audit event schema route proof required before release movement'
    : 'valid hash-only single-summary audit event schema evidence is required before release movement';
  summary.boundary.verdict = reason;

  return summary;
}

function runFocusedPush() {
  return runAuthenticatedHttpPush({
    sourceUrl,
    base: { resources: [] },
    local: { resources: [] },
    username: credential.username,
    applicationPassword: credential.password,
    idempotencyKey,
    routeProfile: 'production-shaped',
    requireProductionAuthSession: true,
    readOnlyInspectRequests: true,
    now: new Date(proofCapturedAt),
  });
}

async function runVerifierProof(route, options = {}) {
  const originalFetch = global.fetch;
  global.fetch = route.fetchHandler;

  try {
    const pushSummary = await runFocusedPush();
    const journalRequest = route.state.journalReads[0];
    const auditSchemaEvidence = buildProductionAuditSchemaEvidence({
      pushSummary,
      journalRequest,
      rows: route.state.rows,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(auditSchemaEvidence, options);
    const routeEvidenceSummaries = collectAuditSchemaRouteEvidenceSummaries(verifyReleaseSummary);

    return {
      pushSummary,
      journalRequest,
      auditSchemaEvidence,
      verifyReleaseSummary,
      routeEvidenceSummaries,
    };
  } finally {
    global.fetch = originalFetch;
  }
}

function functionBody(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const signatureEnd = source.indexOf(') {', start);
  const open = signatureEnd === -1
    ? source.indexOf('{', start)
    : signatureEnd + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertHashOnlyWhenPresent(value, fields) {
  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined && value[field] !== '') {
      assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
    }
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `support evidence leaked raw value ${rawValue}`,
    );
  }
}

test('RPP-0600 v5 verify:release summary carries exactly one hash-only production audit event schema route-evidence summary', async () => {
  const route = createProductionAuditSchemaRoute();
  const {
    pushSummary,
    journalRequest,
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route);

  assert.equal(pushSummary.dbJournal?.ok, true, 'DB journal readback must be present');
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaVersion, 1);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaHash, expectedAuditEventSchemaHash);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaHash, digest(route.auditEventSchema));
  assert.deepEqual(pushSummary.dbJournal.auditEventSchema.routeEvidence, requiredRouteEvidence);
  assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.format, 'hash-only');
  assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.rawValuesIncluded, false);
  assert.ok(pushSummary.dbJournal.auditEventSchema.eventRequiredFields.includes('resourceHashEvidence'));

  assert.equal(route.state.journalReads.length, 1);
  assert.equal(journalRequest.method, 'GET');
  assert.equal(`${journalRequest.pathname}${journalRequest.search}`, checkedJournalRoute);
  assert.equal(journalRequest.headers['x-reprint-push-session'], sessionId);
  assert.equal(journalRequest.headers['x-reprint-push-idempotency-key'], undefined);

  assert.equal(auditSchemaEvidence.ok, true);
  assert.equal(auditSchemaEvidence.productionBacked, false);
  assert.equal(auditSchemaEvidence.releaseStatus, 'NO-GO');
  assert.equal(auditSchemaEvidence.releaseMovement.allowed, false);
  assert.deepEqual(auditSchemaEvidence.schemaValidation.issues, []);
  assert.deepEqual(auditSchemaEvidence.auditEventHashEvidence.issues, []);
  assert.equal(auditSchemaEvidence.auditEventHashEvidence.hashOnly, true);
  assertHashOnlyFields(auditSchemaEvidence.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(auditSchemaEvidence.authSummary, [
    'credentialHash',
    'userLoginHash',
    'sessionIdHash',
  ]);
  assertHashOnlyFields(auditSchemaEvidence.dbJournalReadback, [
    'latestEventsHash',
    'journalScopeHash',
  ]);
  assertHashOnlyFields(auditSchemaEvidence.auditEventHashEvidence, ['rowsHash']);
  assertHashOnlyFields(auditSchemaEvidence.schemaValidation, ['expectedSchemaHash']);
  assert.match(auditSchemaEvidence.proofHash, hashPattern);

  assert.equal(verifyReleaseSummary.ok, false);
  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.mutationAttempted, false);
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, true);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.summaryPath, 'dbJournal.auditEventSchema');
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.hashOnly, true);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 1);
  assert.deepEqual(verifyReleaseSummary.productionAuditEventSchema.issues, []);
  assert.equal(
    verifyReleaseSummary.productionAuditEventSchema.schemaHash,
    pushSummary.dbJournal.auditEventSchema.schemaHash,
  );
  assert.equal(routeEvidenceSummaries.length, 1);
  assert.deepEqual(routeEvidenceSummaries[0], pushSummary.dbJournal.auditEventSchema.routeEvidence);
  assertHashOnlyFields(verifyReleaseSummary.productionAuditEventSchema, [
    'schemaHash',
    'expectedSchemaHash',
    'routeEvidenceHash',
    'auditEventRowsHash',
    'proofHash',
  ]);

  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 malformed audit schema evidence is rejected before release movement', async () => {
  const route = createProductionAuditSchemaRoute({
    auditEventSchema: malformedAuditEventSchema(),
  });
  const {
    pushSummary,
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route);

  assert.equal(pushSummary.dbJournal?.ok, true);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
  assert.deepEqual(pushSummary.dbJournal.auditEventSchema.routeEvidence, requiredRouteEvidence);
  assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.format, 'mixed');
  assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.rawValuesIncluded, true);
  assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.hashAlgorithm, 'plain');
  assert.equal(pushSummary.dbJournal.auditEventSchema.eventRequiredFields.includes('resourceHashEvidence'), false);

  assert.equal(auditSchemaEvidence.ok, false);
  assert.equal(auditSchemaEvidence.code, 'PRODUCTION_AUDIT_EVENT_HASH_ONLY_REQUIRED');
  assert.equal(auditSchemaEvidence.status, 'blocked');
  assert.equal(auditSchemaEvidence.releaseMovement.allowed, false);
  assert.equal(auditSchemaEvidence.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_HASH_ONLY_REQUIRED');
  assert.deepEqual(auditSchemaEvidence.auditEventHashEvidence.issues, []);
  assert.deepEqual(auditSchemaEvidence.schemaValidation.issues, [
    'schema.eventRequiredFields.resourceHashEvidence',
    'schema.redaction.format',
    'schema.redaction.rawValuesIncluded',
    'schema.redaction.hashAlgorithm',
    'schema.redaction.hashOnlyFields.idempotencyKeyHash',
    'schema.redaction.hashOnlyFields.resourceHashEvidence.*Hash',
  ]);

  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.hashOnly, true);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 1);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_HASH_ONLY_REQUIRED');
  assert.equal(routeEvidenceSummaries.length, 1);
  assertHashOnlyWhenPresent(verifyReleaseSummary.productionAuditEventSchema, [
    'schemaHash',
    'expectedSchemaHash',
    'routeEvidenceHash',
    'auditEventRowsHash',
    'proofHash',
  ]);
  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 missing audit schema evidence is rejected before release movement', async () => {
  const route = createProductionAuditSchemaRoute({
    includeAuditEventSchema: false,
  });
  const {
    pushSummary,
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route);

  assert.equal(pushSummary.dbJournal?.ok, true);
  assert.equal(pushSummary.dbJournal.auditEventSchema, null);
  assert.equal(auditSchemaEvidence.ok, false);
  assert.equal(auditSchemaEvidence.code, 'PRODUCTION_AUDIT_EVENT_SCHEMA_REQUIRED');
  assert.equal(auditSchemaEvidence.status, 'blocked');
  assert.deepEqual(auditSchemaEvidence.schemaValidation.issues, ['missing-dbJournal.auditEventSchema']);
  assert.deepEqual(auditSchemaEvidence.auditEventHashEvidence.issues, []);
  assert.equal(auditSchemaEvidence.releaseMovement.allowed, false);

  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.schemaHash, '');
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceHash, null);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 0);
  assert.deepEqual(verifyReleaseSummary.productionAuditEventSchema.issues, [
    'missing-dbJournal.auditEventSchema',
    'verifyRelease.routeEvidenceSummary.missing',
  ]);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_SCHEMA_REQUIRED');
  assert.equal(routeEvidenceSummaries.length, 0);
  assertHashOnlyWhenPresent(verifyReleaseSummary.productionAuditEventSchema, [
    'expectedSchemaHash',
    'auditEventRowsHash',
    'proofHash',
  ]);
  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 duplicated audit schema route-evidence summary is rejected before release movement', async () => {
  const route = createProductionAuditSchemaRoute();
  const {
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route, { duplicateRouteEvidenceSummary: true });

  assert.equal(auditSchemaEvidence.ok, true);
  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.hashOnly, true);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 2);
  assert.deepEqual(verifyReleaseSummary.productionAuditEventSchema.issues, [
    'verifyRelease.routeEvidenceSummary.duplicated',
  ]);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_SCHEMA_DUPLICATED');
  assert.equal(routeEvidenceSummaries.length, 2);
  assert.deepEqual(routeEvidenceSummaries[0], requiredRouteEvidence);
  assert.deepEqual(routeEvidenceSummaries[1], requiredRouteEvidence);
  assertHashOnlyWhenPresent(verifyReleaseSummary.productionAuditEventSchema, [
    'schemaHash',
    'expectedSchemaHash',
    'routeEvidenceHash',
    'auditEventRowsHash',
    'proofHash',
  ]);
  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 stale audit schema hash is rejected before release movement', async () => {
  const route = createProductionAuditSchemaRoute({
    auditEventSchema: staleAuditEventSchema(),
  });
  const {
    pushSummary,
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route);

  assert.equal(pushSummary.dbJournal?.ok, true);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
  assert.deepEqual(pushSummary.dbJournal.auditEventSchema.routeEvidence, requiredRouteEvidence);
  assert.notEqual(pushSummary.dbJournal.auditEventSchema.schemaHash, expectedAuditEventSchemaHash);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaHash, digest(route.auditEventSchema));

  assert.equal(auditSchemaEvidence.ok, false);
  assert.equal(auditSchemaEvidence.code, 'PRODUCTION_AUDIT_EVENT_SCHEMA_STALE');
  assert.deepEqual(auditSchemaEvidence.schemaValidation.issues, ['schema.schemaHash.stale']);
  assert.equal(auditSchemaEvidence.releaseMovement.allowed, false);

  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 1);
  assert.deepEqual(verifyReleaseSummary.productionAuditEventSchema.issues, ['schema.schemaHash.stale']);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_SCHEMA_STALE');
  assert.equal(routeEvidenceSummaries.length, 1);
  assertHashOnlyWhenPresent(verifyReleaseSummary.productionAuditEventSchema, [
    'schemaHash',
    'expectedSchemaHash',
    'routeEvidenceHash',
    'auditEventRowsHash',
    'proofHash',
  ]);
  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 drifted audit schema route evidence is rejected before release movement', async () => {
  const route = createProductionAuditSchemaRoute({
    auditEventSchema: driftedAuditEventSchema(),
  });
  const {
    pushSummary,
    auditSchemaEvidence,
    verifyReleaseSummary,
    routeEvidenceSummaries,
  } = await runVerifierProof(route);

  assert.equal(pushSummary.dbJournal?.ok, true);
  assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
  assert.equal(pushSummary.dbJournal.auditEventSchema.routeEvidence.schemaRoute, '/push/db-journal/schema-v0');
  assert.equal(pushSummary.dbJournal.auditEventSchema.routeEvidence.checkedSurface, 'legacy-rest-route');

  assert.equal(auditSchemaEvidence.ok, false);
  assert.equal(auditSchemaEvidence.code, 'PRODUCTION_AUDIT_EVENT_SCHEMA_DRIFTED');
  assert.deepEqual(auditSchemaEvidence.schemaValidation.issues, [
    'schema.routeEvidence.schemaRoute',
    'schema.routeEvidence.checkedSurface',
  ]);
  assert.equal(auditSchemaEvidence.releaseMovement.allowed, false);

  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, false);
  assert.equal(verifyReleaseSummary.productionAuditEventSchema.routeEvidenceSummaryCount, 0);
  assert.deepEqual(verifyReleaseSummary.productionAuditEventSchema.issues, [
    'schema.routeEvidence.schemaRoute',
    'schema.routeEvidence.checkedSurface',
    'verifyRelease.routeEvidenceSummary.missing',
  ]);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_AUDIT_EVENT_SCHEMA_DRIFTED');
  assert.equal(routeEvidenceSummaries.length, 0);
  assertHashOnlyWhenPresent(verifyReleaseSummary.productionAuditEventSchema, [
    'schemaHash',
    'expectedSchemaHash',
    'routeEvidenceHash',
    'auditEventRowsHash',
    'proofHash',
  ]);
  assertNoRawValues({
    auditSchemaEvidence,
    verifyReleaseSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    rawJournalPayload,
    trustedDbJournalScope,
  ]);
});

test('RPP-0600 v5 combined verifier source and evidence doc preserve support-only single-summary scope', () => {
  const emitCombinedReleaseProof = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof');
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence');
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(emitCombinedReleaseProof, /\.\.\.verify,\s*gate2DurableRecoveryJournal:/s);
  assert.match(emitCombinedReleaseProof, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.equal(
    (topologyEvidence.match(/auditEventSchema/g) || []).length,
    0,
    'topology evidence must not duplicate the dbJournal audit schema summary',
  );
  assert.equal(
    (emitCombinedReleaseProof.match(/dbJournal/g) || []).length,
    0,
    'combined proof should carry dbJournal through the release proof spread',
  );

  assert.match(evidence, /^# RPP-0600 production audit event schema, variant 5$/m);
  assert.match(evidence, /support evidence only/);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /exactly one/);
  assert.match(evidence, /`dbJournal\.auditEventSchema`/);
  assert.match(evidence, /malformed/);
  assert.match(evidence, /missing/);
  assert.match(evidence, /duplicated/);
  assert.match(evidence, /stale/);
  assert.match(evidence, /drifted/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|token/i);
});
