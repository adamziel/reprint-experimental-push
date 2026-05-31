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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0560-production-audit-event-schema-v3.md');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');

const sourceUrl = 'https://source.example.test/rpp-0560';
const routePrefix = '/wp-json/reprint/v1/push';
const journalEndpointPath = `${routePrefix}/db-journal`;
const checkedJournalRoute = `${journalEndpointPath}?limit=80`;
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const credential = {
  username: 'rpp_0560_admin',
  password: 'rpp-0560-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0560_raw_session_id';
const idempotencyKey = 'idem-rpp-0560-raw-idempotency-key';
const rawPayload = 'rpp-0560-private-payload-value';
const rawOptionValue = 'rpp-0560-private-option-value';
const rawJournalPayload = 'rpp-0560-private-journal-payload-value';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const hashPattern = /^[a-f0-9]{64}$/;

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

function productionAuditEventSchema() {
  return {
    schemaVersion: 1,
    schemaId: 'reprint-push-production-audit-event/v1',
    routeEvidence: {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    },
    eventStore: {
      storage: 'wpdb',
      appendOnlyEvents: true,
      sequenceField: 'sequence',
      cursorPrefix: 'db-journal:',
    },
    eventShape: {
      type: 'object',
      required: ['schemaVersion', 'sequence', 'event', 'resourceHashEvidence'],
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
      forbiddenRawFields: [
        'value',
        'content',
        'payload',
        'post_content',
        'option_value',
        'meta_value',
      ],
    },
  };
}

function generatedAuditRows() {
  const requestHash = sha256Hex(rawPayload);
  const keyHash = sha256Hex(idempotencyKey);
  return [
    {
      schemaVersion: 1,
      sequence: 5601,
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
      sequence: 5602,
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
      sequence: 5603,
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

function createGeneratedProductionAuditSchemaRoute() {
  const auth = {
    identity: {
      userLogin: credential.username,
      userId: 560,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const auditEventSchema = productionAuditEventSchema();
  const rows = generatedAuditRows();
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
        receipt: { receiptHash: sha256Hex('rpp-0560-dry-run-receipt') },
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
        ...(replayed ? {} : { receipt: { receiptHash: sha256Hex('rpp-0560-apply-receipt') } }),
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
          auditEventSchema,
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

    throw new Error(`unexpected RPP-0560 fetch to ${request.pathname}`);
  }

  return { state, fetchHandler, auditEventSchema };
}

function buildGeneratedAuditSchemaEvidence({ pushSummary, journalRequest }) {
  const dbJournal = pushSummary.dbJournal || {};
  const auditEventSchema = dbJournal.auditEventSchema || null;
  const routeEvidence = auditEventSchema?.routeEvidence || {};
  const routeEvidenceComplete = Boolean(
    routeEvidence.routeProfile === 'production-shaped'
    && routeEvidence.restNamespace === 'reprint/v1'
    && routeEvidence.journalRoute === '/push/db-journal'
    && routeEvidence.schemaRoute === '/push/db-journal/schema'
    && routeEvidence.checkedSurface === 'production-shaped-rest-route',
  );
  const schemaReadbackOk = Boolean(
    dbJournal.status === 200
    && dbJournal.ok === true
    && auditEventSchema?.schemaId === 'reprint-push-production-audit-event/v1',
  );
  const core = {
    schemaVersion: 1,
    slice: 'RPP-0560',
    proofClass: 'generated-production-audit-event-schema',
    evidenceScope: 'local/generated support-only',
    productionBacked: false,
    releaseStatus: 'NO-GO',
    ok: schemaReadbackOk && routeEvidenceComplete,
    status: schemaReadbackOk && routeEvidenceComplete ? 'support_only' : 'blocked',
    code: schemaReadbackOk && routeEvidenceComplete
      ? 'LOCAL_PRODUCTION_AUDIT_EVENT_SCHEMA_SUPPORT_ONLY'
      : 'PRODUCTION_AUDIT_EVENT_SCHEMA_ROUTE_EVIDENCE_REQUIRED',
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
    routeReceipt: {
      method: journalRequest?.method || null,
      checkedRoute: checkedJournalRoute,
      requestPath: journalRequest
        ? `${journalRequest.pathname}${journalRequest.search || ''}`
        : null,
      routeEvidenceComplete,
      schemaReadbackOk,
      mutationAttempted: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'generated local audit event schema proof is support-only until checked production release evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed audit event schema route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };

  return {
    ...core,
    proofHash: digest(core),
  };
}

function buildVerifyReleaseStyleSummary(generatedEvidence) {
  const auditEventSchema = generatedEvidence.dbJournalReadback.auditEventSchema;
  const reason = generatedEvidence.ok
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : generatedEvidence.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    dbJournal: {
      status: generatedEvidence.dbJournalReadback.status,
      ok: generatedEvidence.dbJournalReadback.ok,
      requestedLimit: generatedEvidence.dbJournalReadback.requestedLimit,
      readbackPages: generatedEvidence.dbJournalReadback.readbackPages,
      paginationComplete: generatedEvidence.dbJournalReadback.paginationComplete,
      paginationTruncated: generatedEvidence.dbJournalReadback.paginationTruncated,
      rows: generatedEvidence.dbJournalReadback.rows,
      rowCount: generatedEvidence.dbJournalReadback.rowCount,
      eventCounts: generatedEvidence.dbJournalReadback.eventCounts,
      latestEventsHash: generatedEvidence.dbJournalReadback.latestEventsHash,
      journalScopeHash: generatedEvidence.dbJournalReadback.journalScopeHash,
      auditEventSchema,
    },
    productionAuditEventSchema: {
      ok: generatedEvidence.ok === true,
      summaryPath: 'dbJournal.auditEventSchema',
      schemaHash: auditEventSchema?.schemaHash || '',
      routeEvidenceHash: auditEventSchema?.routeEvidence
        ? digest(auditEventSchema.routeEvidence)
        : null,
      proofHash: generatedEvidence.proofHash,
      required: [
        'dbJournal.auditEventSchema.routeEvidence.journalRoute',
        'dbJournal.auditEventSchema.routeEvidence.schemaRoute',
        'dbJournal.auditEventSchema.redaction.rawValuesIncluded=false',
      ],
      scope: generatedEvidence.evidenceScope,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: generatedEvidence.ok
        ? 'production-backed audit event schema route proof required before release movement'
        : 'audit event schema route evidence is required before release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed audit event schema route proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function buildAuthFailureReleaseSummary({ summary, authFailureEvidence }) {
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: '[verify-release:held exit=1 reason=reprint_push_lab_auth_required mutationAttempted=false]',
    mutationAttempted: false,
    preflight: summary.preflight,
    authFailure: authFailureEvidence,
    dbJournal: summary.dbJournal,
    productionAuditEventSchema: null,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'authenticated audit event schema route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated audit event schema route proof',
      status: 'blocked',
      verdict: 'reprint_push_lab_auth_required',
    },
  };
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

function collectAuditSchemaRouteEvidenceSummaries(value, summaries = []) {
  if (!value || typeof value !== 'object') {
    return summaries;
  }
  if (
    value.schemaId === 'reprint-push-production-audit-event/v1'
    && value.routeEvidence
    && typeof value.routeEvidence === 'object'
    && value.routeEvidence.journalRoute === '/push/db-journal'
    && value.routeEvidence.schemaRoute === '/push/db-journal/schema'
  ) {
    summaries.push(value.routeEvidence);
  }
  for (const child of Object.values(value)) {
    collectAuditSchemaRouteEvidenceSummaries(child, summaries);
  }
  return summaries;
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
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

test('RPP-0560 v3 generated verify:release summary carries one production audit event schema route-evidence summary', async () => {
  const originalFetch = global.fetch;
  const route = createGeneratedProductionAuditSchemaRoute();
  global.fetch = route.fetchHandler;

  try {
    const pushSummary = await runAuthenticatedHttpPush({
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
    const journalRequest = route.state.journalReads[0];
    const generatedEvidence = buildGeneratedAuditSchemaEvidence({ pushSummary, journalRequest });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(generatedEvidence);
    const routeEvidenceSummaries = collectAuditSchemaRouteEvidenceSummaries(verifyReleaseSummary);

    assert.equal(pushSummary.dbJournal?.ok, true, 'DB journal readback must be present');
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaVersion, 1);
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaHash, digest(route.auditEventSchema));
    assert.deepEqual(pushSummary.dbJournal.auditEventSchema.routeEvidence, {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    });
    assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.format, 'hash-only');
    assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.rawValuesIncluded, false);
    assert.ok(pushSummary.dbJournal.auditEventSchema.eventRequiredFields.includes('resourceHashEvidence'));

    assert.equal(route.state.journalReads.length, 1);
    assert.equal(journalRequest.method, 'GET');
    assert.equal(`${journalRequest.pathname}${journalRequest.search}`, checkedJournalRoute);
    assert.equal(journalRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(journalRequest.headers['x-reprint-push-idempotency-key'], undefined);

    assert.equal(generatedEvidence.ok, true);
    assert.equal(generatedEvidence.productionBacked, false);
    assert.equal(generatedEvidence.releaseStatus, 'NO-GO');
    assert.equal(generatedEvidence.releaseMovement.allowed, false);
    assert.equal(generatedEvidence.routeReceipt.routeEvidenceComplete, true);
    assert.equal(generatedEvidence.routeReceipt.schemaReadbackOk, true);
    assert.equal(generatedEvidence.dbJournalReadback.auditEventSchema.schemaHash, digest(route.auditEventSchema));
    assertHashOnlyFields(generatedEvidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(generatedEvidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
    ]);
    assertHashOnlyFields(generatedEvidence.dbJournalReadback, [
      'latestEventsHash',
      'journalScopeHash',
    ]);
    assert.match(generatedEvidence.proofHash, hashPattern);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.mutationAttempted, false);
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, true);
    assert.equal(verifyReleaseSummary.productionAuditEventSchema.summaryPath, 'dbJournal.auditEventSchema');
    assert.equal(
      verifyReleaseSummary.productionAuditEventSchema.schemaHash,
      pushSummary.dbJournal.auditEventSchema.schemaHash,
    );
    assert.equal(routeEvidenceSummaries.length, 1);
    assert.deepEqual(routeEvidenceSummaries[0], pushSummary.dbJournal.auditEventSchema.routeEvidence);

    assertNoRawValues(verifyReleaseSummary, [
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0560 v3 generated auth failure evidence stays hash-only and cannot move release', async () => {
  const originalFetch = global.fetch;
  const authFailureEvidence = {
    schemaVersion: 1,
    code: 'reprint_push_lab_auth_required',
    phase: 'audit-schema-route-auth',
    credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
    sourceUrlHash: sha256Hex(sourceUrl),
    sessionHash: sha256Hex(sessionId),
    payloadHash: sha256Hex(rawPayload),
    idempotencyKeyHash: sha256Hex(idempotencyKey),
    mutationAttempted: false,
    rawValuesIncluded: false,
  };

  global.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    assert.equal(pathname, `${routePrefix}/preflight`);
    return jsonResponse({
      ok: false,
      code: 'reprint_push_lab_auth_required',
      evidence: authFailureEvidence,
    }, 401);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
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
    const heldSummary = buildAuthFailureReleaseSummary({ summary, authFailureEvidence });
    const routeEvidenceSummaries = collectAuditSchemaRouteEvidenceSummaries(heldSummary);

    assert.equal(summary.ok, false);
    assert.equal(summary.preflight.status, 401);
    assert.equal(summary.code, 'reprint_push_lab_auth_required');
    assert.equal(summary.dbJournal, null);
    assert.equal(heldSummary.releaseStatus, 'NO-GO');
    assert.equal(heldSummary.mutationAttempted, false);
    assert.equal(heldSummary.releaseMovement.allowed, false);
    assert.equal(heldSummary.boundary.verdict, 'reprint_push_lab_auth_required');
    assert.equal(routeEvidenceSummaries.length, 0);
    assertHashOnlyFields(authFailureEvidence, [
      'credentialHash',
      'sourceUrlHash',
      'sessionHash',
      'payloadHash',
      'idempotencyKeyHash',
    ]);
    assertNoRawValues(heldSummary, [
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0560 v3 combined verifier source and evidence doc preserve support-only single-summary scope', () => {
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

  assert.match(evidence, /^# RPP-0560 production audit event schema, variant 3$/m);
  assert.match(evidence, /support evidence only/);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /exactly one/);
  assert.match(evidence, /`dbJournal\.auditEventSchema`/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|token/i);
});
