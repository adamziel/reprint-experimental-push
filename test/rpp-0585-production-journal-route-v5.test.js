import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseGateScriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveReleaseVerifierSource = fs.readFileSync(liveReleaseVerifierPath, 'utf8');

const sourceUrl = 'https://source.example.test/wp';
const gateUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/db-journal`;
const checkedRoute = `${endpointPath}?limit=80`;
const checkedCommand = 'timeout 300s npm run verify:release';
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const credential = {
  username: 'rpp_0585_admin',
  password: 'rpp-0585-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0585_raw_session_id';
const idempotencyKey = 'idem-rpp-0585-raw-idempotency-key';
const rawPayload = 'rpp-0585-private-payload-value';
const rawOptionValue = 'rpp-0585-private-option-value';
const proofCapturedAt = '2026-05-31T13:00:00Z';
const fixedNow = '2026-05-31T13:00:00.000Z';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=JOURNAL_ROUTE_READ_ONLY_REQUIRED]';
const requiredJournalRouteEvidence = ['journal route read-only proof'];
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

function generatedJournalRows() {
  const requestHash = sha256Hex(rawPayload);
  const keyHash = sha256Hex(idempotencyKey);
  return [
    {
      schemaVersion: 1,
      sequence: 81,
      event: 'idempotency-opened',
      idempotencyKeyHash: keyHash,
      requestHash,
      resourceHashEvidence: {
        beforeHash: sha256Hex(rawOptionValue),
      },
    },
    {
      schemaVersion: 1,
      sequence: 82,
      event: 'mutation-applied',
      idempotencyKeyHash: keyHash,
      requestHash,
      appliedCount: 1,
      resourceHashEvidence: {
        afterHash: sha256Hex(`${rawOptionValue}:after`),
      },
    },
    {
      schemaVersion: 1,
      sequence: 83,
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

function createLocalProductionJournalRoute() {
  const auth = {
    identity: {
      userLogin: credential.username,
      userId: 585,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const rows = generatedJournalRows();
  const state = {
    requests: [],
    journalReads: [],
    journalMutationWorkAttempts: 0,
    applyCount: 0,
    rows,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const request = {
      method,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers: headerEntries(options.headers || {}),
      rawBody: typeof options.body === 'string' ? options.body : '',
    };
    state.requests.push(request);

    if (request.pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
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
        receipt: { receiptHash: sha256Hex('rpp-0585-dry-run-receipt') },
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

    if (request.pathname === `${routePrefix}/apply`) {
      state.applyCount += 1;
      const replayed = state.applyCount > 1;
      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: 0,
        code: replayed ? 'BATCH_ALREADY_COMMITTED' : 'APPLIED',
        responseSchemaVersion: 1,
        auth,
        ...(replayed ? {} : { receipt: { receiptHash: sha256Hex('rpp-0585-apply-receipt') } }),
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

    if (request.pathname === endpointPath) {
      const rowsBefore = state.rows.length;
      if (method !== 'GET') {
        state.journalMutationWorkAttempts += 1;
        return jsonResponse({
          ok: false,
          code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
          mutationAttempted: false,
        }, 405);
      }

      state.journalReads.push({
        ...request,
        rowsBefore,
        rowsAfter: state.rows.length,
      });
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          rowCount: state.rows.length,
          latestRows: state.rows,
          eventSummaries: eventSummaries(state.rows),
          ownership: journalOwnership(),
          leaseFence: journalLeaseFence(),
          writerLease: {
            storageGuard: 'filesystem-compare-rename',
            restartReadable: true,
          },
        },
        storageGuard: storageGuard(),
      });
    }

    throw new Error(`unexpected RPP-0585 fetch to ${request.pathname}`);
  }

  return { state, fetchHandler };
}

function trustedDbJournalSummary(overrides = {}) {
  return {
    status: 200,
    ok: true,
    retryAttempts: 1,
    requestedLimit: 80,
    readbackPages: 1,
    paginationComplete: true,
    paginationTruncated: false,
    oldestSequence: 81,
    newestSequence: 83,
    rows: 3,
    rowCount: 3,
    eventCounts: {
      'idempotency-opened': 1,
      'mutation-applied': 1,
      'apply-committed': 1,
    },
    latestEvents: generatedJournalRows().map((row) => ({
      sequence: row.sequence,
      event: row.event,
      claimId: null,
      idempotencyKeyHash: row.idempotencyKeyHash,
      requestHash: row.requestHash,
      appliedCount: Number.isInteger(row.appliedCount) ? row.appliedCount : null,
      errorCode: null,
    })),
    idempotencyEvidence: [],
    claim: null,
    scope: trustedDbJournalScope,
    storageGuard: storageGuard(),
    ownership: journalOwnership(),
    writerLease: {
      storageGuard: 'filesystem-compare-rename',
      restartReadable: true,
    },
    leaseFence: journalLeaseFence(),
    ...overrides,
  };
}

function buildJournalRouteReceipt({
  journalRequest = null,
  dbJournal = null,
  source = sourceUrl,
  rowsBefore = null,
  rowsAfter = null,
  capturedAt = proofCapturedAt,
} = {}) {
  const headers = journalRequest?.headers || {};
  const method = journalRequest?.method || null;
  const requestPath = journalRequest
    ? `${journalRequest.pathname}${journalRequest.search || ''}`
    : null;
  const signed = Boolean(headers['x-auth-signature'] && headers['x-reprint-push-signature']);
  const sessionHeader = headers['x-reprint-push-session'] || '';
  const idempotencyHeader = headers['x-reprint-push-idempotency-key'] || '';
  const idempotencyKeyPresent = Boolean(idempotencyHeader);
  const routeReadOnly = method === 'GET' && !idempotencyKeyPresent;
  const journalOk = dbJournal?.status === 200 && dbJournal?.ok === true;
  const stableRows = rowsBefore !== null && rowsAfter !== null && rowsBefore === rowsAfter;
  const ok = Boolean(journalOk && signed && sessionHeader && routeReadOnly && stableRows);
  const routeEvidence = {
    method,
    endpointPath,
    requestPath,
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
    journalRoute: '/push/db-journal',
    checkedRoute,
    signedRead: signed,
    sessionBound: Boolean(sessionHeader),
    readOnly: routeReadOnly,
    mutatesReleaseState: false,
    mutationAttempted: false,
    idempotencyKeyPresent,
    idempotencyKeyHash: idempotencyKeyPresent ? sha256Hex(idempotencyHeader) : null,
    proofHash: digest({
      method,
      endpointPath,
      requestPath,
      status: dbJournal?.status ?? null,
      requestedLimit: dbJournal?.requestedLimit ?? null,
      rowCount: dbJournal?.rowCount ?? null,
      rowsBefore,
      rowsAfter,
      signed,
      sessionBound: Boolean(sessionHeader),
      idempotencyKeyPresent,
    }),
  };
  const journalSummary = {
    status: dbJournal?.status ?? null,
    ok: dbJournal?.ok === true,
    requestedLimit: dbJournal?.requestedLimit ?? null,
    readbackPages: dbJournal?.readbackPages ?? null,
    paginationComplete: dbJournal?.paginationComplete === true,
    paginationTruncated: dbJournal?.paginationTruncated === true,
    rows: dbJournal?.rows ?? null,
    rowCount: dbJournal?.rowCount ?? null,
    oldestSequence: dbJournal?.oldestSequence ?? null,
    newestSequence: dbJournal?.newestSequence ?? null,
    eventCounts: dbJournal?.eventCounts || {},
    latestEventsHash: digest(dbJournal?.latestEvents || []),
    idempotencyEvidenceHash: digest(dbJournal?.idempotencyEvidence || []),
    journalScopeHash: dbJournal?.scope ? sha256Hex(dbJournal.scope) : null,
    storageGuardHash: dbJournal?.storageGuard ? digest(dbJournal.storageGuard) : null,
    ownershipHash: dbJournal?.ownership ? digest(dbJournal.ownership) : null,
    writerLeaseHash: dbJournal?.writerLease ? digest(dbJournal.writerLease) : null,
    leaseFenceHash: dbJournal?.leaseFence ? digest(dbJournal.leaseFence) : null,
  };
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0585',
    proofClass: 'generated-production-journal-route-v5',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code: ok ? 'LOCAL_PRODUCTION_JOURNAL_ROUTE_V5_SUPPORT_ONLY' : 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(source),
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: sessionHeader ? sha256Hex(sessionHeader) : null,
      sessionBound: Boolean(sessionHeader),
      manageOptions: true,
    },
    routeEvidence,
    journalSummary,
    readOnlyReceipt: {
      method,
      checkedRoute,
      signedSessionBound: signed && Boolean(sessionHeader),
      journalRowsBefore: rowsBefore,
      journalRowsAfter: rowsAfter,
      rowsStableAcrossRead: stableRows,
      mutatesReleaseState: false,
      mutationAttempted: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local journal route proof is support-only until production URL and credential proof exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed journal route proof',
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(journalRouteReceipt) {
  const reason = journalRouteReceipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : journalRouteReceipt.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand,
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    productionJournalRoute: {
      ok: journalRouteReceipt.ok === true,
      summaryPath: 'productionJournalRoute',
      receiptHash: journalRouteReceipt.receiptHash,
      routeEvidence: journalRouteReceipt.routeEvidence,
      journalSummary: journalRouteReceipt.journalSummary,
      readOnlyReceipt: journalRouteReceipt.readOnlyReceipt,
      redaction: journalRouteReceipt.redaction,
      required: [
        'signed GET /wp-json/reprint/v1/push/db-journal?limit=80',
        'session-bound read',
        'no mutating idempotency key',
        'stable journal row count across read',
        'hash-only receipt evidence',
      ],
      scope: journalRouteReceipt.evidenceScope,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: journalRouteReceipt.ok === true
        ? 'production-backed journal route proof required before release movement'
        : 'journal route read-only proof is required before release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed journal route proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function expectedRouteProofHashFromSummary(summary) {
  const route = summary?.routeEvidence || {};
  const journal = summary?.journalSummary || {};
  const readOnly = summary?.readOnlyReceipt || {};
  return digest({
    method: route.method ?? null,
    endpointPath: route.endpointPath ?? null,
    requestPath: route.requestPath ?? null,
    status: journal.status ?? null,
    requestedLimit: journal.requestedLimit ?? null,
    rowCount: journal.rowCount ?? null,
    rowsBefore: readOnly.journalRowsBefore ?? null,
    rowsAfter: readOnly.journalRowsAfter ?? null,
    signed: route.signedRead === true,
    sessionBound: route.sessionBound === true,
    idempotencyKeyPresent: route.idempotencyKeyPresent === true,
  });
}

function collectJournalRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (
    value.routeEvidence
    && typeof value.routeEvidence === 'object'
    && value.routeEvidence.journalRoute === '/push/db-journal'
    && value.routeEvidence.endpointPath === endpointPath
  ) {
    blocks.push(value.routeEvidence);
  }
  for (const child of Object.values(value)) {
    collectJournalRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
}

function collectProductionJournalSummaries(value, summaries = []) {
  if (!value || typeof value !== 'object') {
    return summaries;
  }
  if (
    value.summaryPath === 'productionJournalRoute'
    && value.routeEvidence?.journalRoute === '/push/db-journal'
    && value.routeEvidence?.endpointPath === endpointPath
  ) {
    summaries.push(value);
  }
  for (const child of Object.values(value)) {
    collectProductionJournalSummaries(child, summaries);
  }
  return summaries;
}

function validateProductionJournalRouteCarryThrough(verifyReleaseSummary) {
  const summaries = collectProductionJournalSummaries(verifyReleaseSummary);
  if (summaries.length !== 1) {
    return {
      ok: false,
      code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      observed: summaries.length === 0
        ? 'missing-production-journal-route-summary'
        : 'duplicated-production-journal-route-summary',
      summaryCount: summaries.length,
      observedStatus: null,
      method: summaries.length === 0 ? 'missing' : 'duplicate',
      mutatesReleaseState: false,
      mutationAttempted: false,
      mutatingIdempotencyKey: 'unknown',
      idempotencyKeyHash: null,
      journalRowsBefore: null,
      journalRowsAfter: null,
      routeProofHash: null,
      expectedRouteProofHash: null,
      receiptHash: null,
    };
  }

  const summary = summaries[0];
  const route = summary.routeEvidence || {};
  const journal = summary.journalSummary || {};
  const readOnly = summary.readOnlyReceipt || {};
  const expectedRouteProofHash = expectedRouteProofHashFromSummary(summary);
  const hashOnly = summary.redaction?.format === 'hash-only'
    && summary.redaction?.rawValuesIncluded === false;
  const routeStable = route.proofHash === expectedRouteProofHash;
  const ok = Boolean(
    summary.ok === true
    && summary.summaryPath === 'productionJournalRoute'
    && route.method === 'GET'
    && route.endpointPath === endpointPath
    && route.requestPath === checkedRoute
    && route.checkedRoute === checkedRoute
    && route.routeProfile === 'production-shaped'
    && route.restNamespace === 'reprint/v1'
    && route.routePrefix === '/push'
    && route.journalRoute === '/push/db-journal'
    && route.signedRead === true
    && route.sessionBound === true
    && route.readOnly === true
    && route.idempotencyKeyPresent === false
    && route.idempotencyKeyHash === null
    && route.mutatesReleaseState === false
    && route.mutationAttempted === false
    && hashPattern.test(route.proofHash || '')
    && routeStable
    && journal.status === 200
    && journal.ok === true
    && journal.requestedLimit === 80
    && journal.rowCount === 3
    && journal.rows === 3
    && readOnly.method === 'GET'
    && readOnly.checkedRoute === checkedRoute
    && readOnly.signedSessionBound === true
    && readOnly.rowsStableAcrossRead === true
    && readOnly.journalRowsBefore === readOnly.journalRowsAfter
    && readOnly.mutatesReleaseState === false
    && readOnly.mutationAttempted === false
    && hashOnly
    && hashPattern.test(summary.receiptHash || ''),
  );
  const observed = ok
    ? 'journal-read-only'
    : routeStable
      ? 'journal-route-proof-malformed'
      : 'journal-route-proof-drift';

  return {
    ok,
    code: ok ? 'OK' : 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    observed,
    summaryCount: summaries.length,
    observedStatus: journal.status ?? null,
    method: route.method || 'missing',
    mutatesReleaseState: route.mutatesReleaseState === true,
    mutationAttempted: route.mutationAttempted === true,
    mutatingIdempotencyKey: route.idempotencyKeyPresent ? 'hash-only-present' : 'absent',
    idempotencyKeyHash: route.idempotencyKeyHash ?? null,
    journalRowsBefore: readOnly.journalRowsBefore ?? null,
    journalRowsAfter: readOnly.journalRowsAfter ?? null,
    routeProofHash: route.proofHash ?? null,
    expectedRouteProofHash,
    receiptHash: summary.receiptHash ?? null,
  };
}

function journalRouteGateEvidenceFromValidation(validation, overrides = {}) {
  return {
    ok: validation.ok === true,
    readOnly: validation.ok === true,
    observed: validation.observed,
    observedStatus: validation.observedStatus,
    command: 'npm run verify:release',
    checkedCommand,
    checkedRoute,
    method: validation.method,
    mutatesReleaseState: validation.mutatesReleaseState,
    mutationAttempted: validation.mutationAttempted,
    mutatingIdempotencyKey: validation.mutatingIdempotencyKey,
    idempotencyKeyHash: validation.idempotencyKeyHash,
    journalRowsBefore: validation.journalRowsBefore,
    journalRowsAfter: validation.journalRowsAfter,
    routeProofHash: validation.routeProofHash,
    expectedRouteProofHash: validation.expectedRouteProofHash,
    receiptHash: validation.receiptHash,
    summaryCount: validation.summaryCount,
    code: validation.code,
    scope: 'final-release',
    ...overrides,
  };
}

function completeFinalEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: {
      ok: true,
      same: true,
      observed: 'same-source-readback',
      command: 'hash-only-auth-source-readback',
      scope,
    },
    productionSecret: { ok: true, present: true, observed: 'production-credential-present', scope },
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'application-password-bound-to-checked-source-user',
      bindingHash: sha256Hex('rpp-0585-application-password-binding'),
      scope,
    },
    manageOptionsCapability: {
      ok: true,
      hasManageOptions: true,
      observed: 'manage_options',
      capabilityHash: sha256Hex('rpp-0585-manage-options-capability'),
      scope,
    },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'PRODUCTION_EVIDENCE_REQUIRED',
      command: 'npm run verify:release',
      checkedCommand,
      statusMarker: '[verify-release:held exit=1 reason=PRODUCTION_EVIDENCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0585-production-journal-route-v5-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: gateUrl,
      REPRINT_PUSH_LOCAL_URL: gateUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: gateUrl,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runReleaseGateCheck(evidence) {
  return spawnSync(process.execPath, [
    releaseGateScriptPath,
    '--evidence-file',
    writeEvidence(evidence),
    '--scope',
    'final-release',
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
}

function parseReport(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
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
    if (value[field] !== null && value[field] !== undefined) {
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

function signedJournalRead(overrides = {}) {
  return {
    method: 'GET',
    pathname: endpointPath,
    search: '?limit=80',
    headers: {
      'x-auth-signature': sha256Hex('rpp-0585-auth-signature'),
      'x-reprint-push-signature': sha256Hex('rpp-0585-push-signature'),
      'x-reprint-push-session': sessionId,
      ...overrides,
    },
  };
}

function assertHeldJournalRouteGate(result, expectedObserved) {
  const report = parseReport(result);
  const gate = gateById(report, 'journal-route-read-only');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'recovery');
  assert.equal(report.primaryFailureCode, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(report.statusMarker, releaseGateHeldMarker);
  assert.ok(result.stdout.includes(releaseGateHeldMarker));
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.releaseMovement.candidateGates, '19/20');
  assert.equal(report.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.equal(gate.code, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(gate.blocking, true);
  assert.deepEqual(gate.evidence.required, requiredJournalRouteEvidence);
  assert.equal(gate.evidence.observed, expectedObserved);
  assertNoRawValues(report, [
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    trustedDbJournalScope,
  ]);

  return { report, gate };
}

test('RPP-0585 v5 verify:release summary carries one read-only production journal route proof', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionJournalRoute();
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
    const receipt = buildJournalRouteReceipt({
      journalRequest,
      dbJournal: pushSummary.dbJournal,
      rowsBefore: journalRequest.rowsBefore,
      rowsAfter: journalRequest.rowsAfter,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const validation = validateProductionJournalRouteCarryThrough(verifyReleaseSummary);
    const routeEvidenceBlocks = collectJournalRouteEvidenceBlocks(verifyReleaseSummary);
    const productionSummaries = collectProductionJournalSummaries(verifyReleaseSummary);

    assert.equal(pushSummary.dbJournal?.ok, true, 'journal readback must be present even while release remains NO-GO');
    assert.equal(pushSummary.inspectAuthMode, 'read-only-session-bound');
    assert.equal(pushSummary.ok, false);
    assert.deepEqual(
      route.state.requests.map((entry) => `${entry.method} ${entry.pathname}`),
      [
        `GET ${routePrefix}/preflight`,
        `GET ${routePrefix}/snapshot`,
        `POST ${routePrefix}/dry-run`,
        `POST ${routePrefix}/apply`,
        `POST ${routePrefix}/recovery/inspect`,
        `POST ${routePrefix}/apply`,
        `GET ${routePrefix}/snapshot`,
        `GET ${endpointPath}`,
      ],
    );
    assert.equal(route.state.journalMutationWorkAttempts, 0);
    assert.equal(route.state.journalReads.length, 1);
    assert.equal(journalRequest.method, 'GET');
    assert.equal(`${journalRequest.pathname}${journalRequest.search}`, checkedRoute);
    assert.equal(journalRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(journalRequest.headers['x-reprint-push-idempotency-key'], undefined);
    assert.ok(journalRequest.headers['x-auth-signature']);
    assert.ok(journalRequest.headers['x-reprint-push-signature']);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(receipt.routeEvidence.method, 'GET');
    assert.equal(receipt.routeEvidence.requestPath, checkedRoute);
    assert.equal(receipt.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(receipt.routeEvidence.readOnly, true);
    assert.equal(receipt.routeEvidence.mutatesReleaseState, false);
    assert.equal(receipt.routeEvidence.idempotencyKeyPresent, false);
    assert.equal(receipt.routeEvidence.idempotencyKeyHash, null);
    assert.equal(receipt.readOnlyReceipt.rowsStableAcrossRead, true);
    assert.equal(receipt.readOnlyReceipt.journalRowsBefore, 3);
    assert.equal(receipt.readOnlyReceipt.journalRowsAfter, 3);
    assert.deepEqual(receipt.journalSummary.eventCounts, {
      'idempotency-opened': 1,
      'mutation-applied': 1,
      'apply-committed': 1,
    });

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionJournalRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionJournalRoute.receiptHash, receipt.receiptHash);
    assert.equal(verifyReleaseSummary.productionJournalRoute.routeEvidence.proofHash, receipt.routeEvidence.proofHash);
    assert.equal(validation.ok, true);
    assert.equal(validation.code, 'OK');
    assert.equal(validation.observed, 'journal-read-only');
    assert.equal(validation.summaryCount, 1);
    assert.equal(validation.routeProofHash, validation.expectedRouteProofHash);
    assert.equal(productionSummaries.length, 1);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(productionSummaries[0], verifyReleaseSummary.productionJournalRoute);
    assert.deepEqual(routeEvidenceBlocks[0], verifyReleaseSummary.productionJournalRoute.routeEvidence);

    assertHashOnlyFields(receipt.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(receipt.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
    ]);
    assertHashOnlyFields(receipt.routeEvidence, ['proofHash']);
    assertHashOnlyFields(receipt.journalSummary, [
      'latestEventsHash',
      'idempotencyEvidenceHash',
      'journalScopeHash',
      'storageGuardHash',
      'ownershipHash',
      'writerLeaseHash',
      'leaseFenceHash',
    ]);
    assert.match(receipt.receiptHash, hashPattern);
    assert.equal(receipt.redaction.rawValuesIncluded, false);
    assertNoRawValues(verifyReleaseSummary, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      rawPayload,
      rawOptionValue,
      trustedDbJournalScope,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0585 v5 missing malformed duplicated or drifted journal route proof blocks release movement read-only', () => {
  const validReceipt = buildJournalRouteReceipt({
    journalRequest: signedJournalRead(),
    dbJournal: trustedDbJournalSummary(),
    rowsBefore: 3,
    rowsAfter: 3,
  });
  const validSummary = buildVerifyReleaseStyleSummary(validReceipt);
  const malformedReceipt = buildJournalRouteReceipt({
    journalRequest: signedJournalRead({
      'x-reprint-push-idempotency-key': idempotencyKey,
    }),
    dbJournal: trustedDbJournalSummary(),
    rowsBefore: 3,
    rowsAfter: 3,
  });
  const malformedSummary = buildVerifyReleaseStyleSummary(malformedReceipt);
  const missingSummary = {
    ...validSummary,
    productionJournalRoute: undefined,
  };
  const duplicatedSummary = {
    ...validSummary,
    duplicatedProductionJournalRoute: validSummary.productionJournalRoute,
  };
  const driftedSummary = {
    ...validSummary,
    productionJournalRoute: {
      ...validSummary.productionJournalRoute,
      routeEvidence: {
        ...validSummary.productionJournalRoute.routeEvidence,
        requestPath: `${endpointPath}?limit=79`,
      },
    },
  };
  const cases = [
    ['missing', missingSummary, 'missing-production-journal-route-summary'],
    ['malformed', malformedSummary, 'journal-route-proof-malformed'],
    ['duplicated', duplicatedSummary, 'duplicated-production-journal-route-summary'],
    ['drifted', driftedSummary, 'journal-route-proof-drift'],
  ];

  assert.equal(validReceipt.ok, true);
  assert.equal(validateProductionJournalRouteCarryThrough(validSummary).ok, true);
  assert.equal(malformedReceipt.ok, false);
  assert.equal(malformedReceipt.code, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(malformedReceipt.routeEvidence.idempotencyKeyPresent, true);
  assertHashOnlyWhenPresent(malformedReceipt.routeEvidence, ['idempotencyKeyHash', 'proofHash']);

  for (const [name, summary, observed] of cases) {
    const validation = validateProductionJournalRouteCarryThrough(summary);
    const evidence = journalRouteGateEvidenceFromValidation(validation, {
      reason: `RPP-0585 ${name} journal route proof was not accepted by verify:release.`,
    });
    const result = runReleaseGateCheck(completeFinalEvidence({
      journalRouteReadOnly: name === 'missing' ? undefined : evidence,
    }));
    const { gate } = assertHeldJournalRouteGate(result, name === 'missing' ? 'missing-evidence' : observed);

    assert.equal(validation.ok, false);
    assert.equal(validation.code, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
    if (name === 'missing') {
      assert.equal(validation.summaryCount, 0);
      assert.equal(gate.status, 'missing');
      assert.deepEqual(gate.evidence, {
        required: requiredJournalRouteEvidence,
        observed: 'missing-evidence',
        evidenceKey: 'journalRouteReadOnly',
        scope: 'missing',
      });
    } else {
      assert.equal(gate.status, 'failed');
      assert.equal(gate.evidence.code, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
      assert.equal(gate.evidence.observed, observed);
      assert.equal(gate.evidence.summaryCount, name === 'duplicated' ? 2 : 1);
      assert.equal(gate.evidence.ok, false);
      assert.equal(gate.evidence.readOnly, false);
      assertHashOnlyWhenPresent(gate.evidence, [
        'idempotencyKeyHash',
        'routeProofHash',
        'expectedRouteProofHash',
        'receiptHash',
      ]);
    }
  }

  assertNoRawValues([
    malformedSummary,
    missingSummary,
    duplicatedSummary,
    driftedSummary,
  ], [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    rawPayload,
    rawOptionValue,
    trustedDbJournalScope,
  ]);
});

test('RPP-0585 v5 combined verifier source keeps journal route evidence in the release proof spread', () => {
  const emitCombinedReleaseProof = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof');
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence');

  assert.match(emitCombinedReleaseProof, /\.\.\.verify,\s*gate2DurableRecoveryJournal:/s);
  assert.match(emitCombinedReleaseProof, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.equal(
    (topologyEvidence.match(/productionJournalRoute|journalRouteReceipt/g) || []).length,
    0,
    'topology evidence must not duplicate the production journal route summary',
  );
  assert.equal(
    (emitCombinedReleaseProof.match(/productionJournalRoute|journalRouteReceipt/g) || []).length,
    0,
    'combined proof should carry generated journal route evidence through the release proof spread',
  );
});
