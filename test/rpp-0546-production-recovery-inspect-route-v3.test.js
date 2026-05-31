import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/inspect`;
const credential = {
  username: 'rpp_0546_admin',
  password: 'rpp-0546-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0546-wrong-application-password',
};
const sessionId = 'psh_rpp_0546_raw_session_id';
const invalidSessionId = 'psh_rpp_0546_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0546-raw-idempotency-key';
const rawPlanSecret = 'rpp-0546-private-plan-value';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const proofStaleCapturedAt = '2026-05-31T11:49:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const staleExpiresAt = '2026-05-31T11:59:00Z';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0546acceptednonce';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const proofFreshnessMs = 5 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/;
const recoveryInspectPayload = {
  plan: {
    id: 'plan-rpp-0546-recovery-inspect',
    status: 'ready',
    privatePlanHash: sha256Hex(rawPlanSecret),
    mutations: [
      {
        resourceKeyHash: sha256Hex('wp_option:blogname'),
        action: 'inspect-before-repair',
      },
    ],
    conflicts: [],
    blockers: [],
  },
  receipt: {
    type: 'dry-run',
    receiptHash: `sha256:${sha256Hex('rpp-0546-dry-run-receipt')}`,
  },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function labSigningKey(value = credential) {
  return hmacHex(value.password, `reprint-push-lab-v1\n${value.username}`);
}

function basicAuth(value = credential) {
  return `Basic ${Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')}`;
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

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: key }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    rawQuery,
    contentHash,
    session,
    key,
  ].join('\n');
}

function signedRecoveryInspectHeaders({
  rawBody,
  session = sessionId,
  idempotency,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
  contentType = 'application/json',
  authSignature,
  pushSignature,
  value = credential,
} = {}) {
  const signingKey = labSigningKey(value);
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency || '',
  });
  return {
    authorization: basicAuth(value),
    'content-type': contentType,
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': authSignature || hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`),
    'X-Reprint-Push-Signature': pushSignature || hmacHex(signingKey, canonical),
    ...(session === undefined ? {} : { 'X-Reprint-Push-Session': session }),
    ...(idempotency === undefined ? {} : { 'X-Reprint-Push-Idempotency-Key': idempotency }),
  };
}

function withoutHeader(headers, header) {
  const copy = { ...headers };
  delete copy[header];
  delete copy[header.toLowerCase()];
  return copy;
}

function storageGuard() {
  return {
    boundary: 'filesystem-compare-rename',
    operation: 'read',
    outcome: 'inspected',
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
    staleClaimRejected: true,
  };
}

function generatedRecoveryRows() {
  const requestHash = sha256Hex(rawPlanSecret);
  return [
    {
      sequence: 61,
      event: 'recovery-claim-opened',
      claimKeyHash: sha256Hex('rpp-0546-claim-key'),
      requestHash,
    },
    {
      sequence: 62,
      event: 'recovery-inspected',
      claimKeyHash: sha256Hex('rpp-0546-claim-key'),
      requestHash,
      recoveryState: 'blocked-recovery',
    },
  ];
}

function createLocalProductionRecoveryInspectRoute() {
  const state = {
    requests: [],
    jsonParseAttempts: 0,
    recoveryInspectReadAttempts: 0,
    writePathAttempts: 0,
    mutationSideEffects: 0,
    recoveryRows: generatedRecoveryRows(),
    recoveryState: 'blocked-recovery',
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({
      method,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers,
      rawBody,
    });

    assert.equal(requestUrl.pathname, endpointPath);
    return handleRecoveryInspectRequest({
      method,
      pathname: requestUrl.pathname,
      headers,
      rawBody,
      state,
    });
  }

  return { state, fetchHandler };
}

function handleRecoveryInspectRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateRecoveryInspectRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse(authFailureBody(authError.code, headers, rawBody), authError.status);
  }

  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  const rowsBefore = state.recoveryRows.length;
  const stateBefore = state.recoveryState;
  state.recoveryInspectReadAttempts += 1;
  const body = recoveryInspectBody({
    payload,
    rawBody,
    headers,
    rowsBefore,
    rowsAfter: state.recoveryRows.length,
    stateBefore,
    stateAfter: state.recoveryState,
  });
  return jsonResponse(body);
}

function authenticateRecoveryInspectRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { code: 'SIGNED_HEADER_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-session']) {
    return { code: 'SIGNED_SESSION_REQUIRED', status: 401 };
  }

  if (headers['x-reprint-push-idempotency-key']) {
    return { code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED', status: 400 };
  }

  if (method !== 'POST') {
    return { code: 'RECOVERY_INSPECT_METHOD_REQUIRED', status: 405 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'recovery-inspect',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      jsonParsed: false,
      recoveryInspectReadAttempted: false,
      writePathAttempted: false,
      mutationAttempted: false,
    },
  };
}

function recoveryInspectBody({
  payload,
  rawBody,
  headers,
  rowsBefore = 2,
  rowsAfter = 2,
  stateBefore = 'blocked-recovery',
  stateAfter = 'blocked-recovery',
  expiresAt = freshExpiresAt,
} = {}) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const signingKey = labSigningKey();
  const sessionHash = sha256Hex(session);
  const signingKeyHash = sha256Hex(signingKey);
  const canonicalHash = sha256Hex(pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: '',
  }));
  const identity = {
    userLogin: credential.username,
    userId: 546,
    capabilities: { manage_options: true },
  };

  return {
    ok: true,
    mode: 'recovery-inspect',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    auth: {
      identity,
      session: {
        type: 'production-auth-session',
        status: 'active',
        id: session,
        expiresAt,
      },
    },
    recovery: {
      state: stateAfter,
      planHash: sha256Hex(JSON.stringify(payload.plan || {})),
      receiptHash: sha256Hex(JSON.stringify(payload.receipt || {})),
      counts: { old: 1, new: 0, blockedUnknown: 1, total: 2 },
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          rowCount: rowsAfter,
        },
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: sha256Hex('rpp-0546-active-claim'),
          previousClaimKeyHash: sha256Hex('rpp-0546-previous-claim'),
          staleClaimRejected: true,
        },
        storageGuard: storageGuard(),
        ownership: journalOwnership(),
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          storageGuard: 'filesystem-compare-rename',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
        leaseFence: journalLeaseFence(),
      },
    },
    recoveryInspect: {
      schemaVersion: 1,
      route: '/push/recovery/inspect',
      readOnly: true,
      authSessionBound: true,
      idempotencyKeyPresent: false,
      rowsBefore,
      rowsAfter,
      rowsStableAcrossRead: rowsBefore === rowsAfter,
      stateBefore,
      stateAfter,
      stateStableAcrossRead: stateBefore === stateAfter,
      writePathAttempted: false,
      mutationAttempted: false,
      classificationOnly: true,
    },
    signedRequest: {
      signed: true,
      schemaVersion: 1,
      contentHash,
      nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
      sessionHash,
      signingKeyHash,
      request: {
        canonicalHash,
        idempotencyKeyPresent: false,
        idempotencyKeyHash: null,
      },
    },
  };
}

function buildRecoveryInspectRouteSupportEvidence({
  recoveryInspect = null,
  request = null,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
} = {}) {
  const body = recoveryInspect?.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const session = body.auth?.session || {};
  const inspect = body.recoveryInspect || {};
  const signedRequest = body.signedRequest || {};
  const headers = request?.headers || {};
  const method = request?.method || recoveryInspect?.request?.method || null;
  const requestPath = request
    ? `${request.pathname}${request.search || ''}`
    : recoveryInspect?.request?.pathname || null;
  const sessionHeader = headers['x-reprint-push-session'] || '';
  const idempotencyHeader = headers['x-reprint-push-idempotency-key'] || '';
  const idempotencyKeyPresent = Boolean(idempotencyHeader);
  const rowsStable = inspect.rowsBefore !== undefined
    && inspect.rowsAfter !== undefined
    && inspect.rowsBefore === inspect.rowsAfter;
  const stateStable = inspect.stateBefore === inspect.stateAfter;
  const signedSessionBound = signedRequest.signed === true
    && Boolean(sessionHeader)
    && signedRequest.sessionHash === sha256Hex(sessionHeader);
  const acceptedReadOnly = recoveryInspect?.status === 200
    && body.ok === true
    && body.mode === 'recovery-inspect'
    && method === 'POST'
    && requestPath === endpointPath
    && signedSessionBound
    && session.id === sessionHeader
    && session.id === sessionId
    && session.type === 'production-auth-session'
    && session.status === 'active'
    && identity.userLogin === credential.username
    && identity.capabilities?.manage_options === true
    && inspect.readOnly === true
    && inspect.authSessionBound === true
    && inspect.classificationOnly === true
    && inspect.writePathAttempted === false
    && inspect.mutationAttempted === false
    && rowsStable
    && stateStable
    && !idempotencyKeyPresent;
  const base = {
    schemaVersion: 1,
    slice: 'RPP-0546',
    proofClass: 'generated-production-recovery-inspect-route',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    mutationAttempted: false,
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(source),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: identity.userLogin ? sha256Hex(identity.userLogin) : null,
      userIdHash: identity.userId === undefined ? null : sha256Hex(String(identity.userId)),
      sessionIdHash: session.id ? sha256Hex(session.id) : null,
      sessionExpiresAtHash: session.expiresAt ? sha256Hex(session.expiresAt) : null,
      sessionType: session.type || null,
      sessionStatus: session.status || null,
      manageOptions: identity.capabilities?.manage_options === true,
      signedSessionHash: signedRequest.sessionHash || null,
      signingKeyHashLength: String(signedRequest.signingKeyHash || '').length,
      idempotencyKeyPresent,
      idempotencyKeyHash: idempotencyKeyPresent ? sha256Hex(idempotencyHeader) : null,
    },
    routeEvidence: {
      method,
      endpointPath,
      requestPath,
      recoveryInspectRoute: '/push/recovery/inspect',
      routeProfile: routeProfile.profile || null,
      restNamespace: routeProfile.restNamespace || null,
      routePrefix: routeProfile.routePrefix || null,
      labBacked: routeProfile.labBacked === true,
      signedRead: signedSessionBound,
      sessionBound: Boolean(sessionHeader),
      readOnly: acceptedReadOnly,
      idempotencyKeyPresent,
      idempotencyKeyHash: idempotencyKeyPresent ? sha256Hex(idempotencyHeader) : null,
      mutatesReleaseState: false,
      mutationAttempted: false,
      writePathAttempted: inspect.writePathAttempted === true,
      proofHash: digest({
        method,
        endpointPath,
        requestPath,
        status: recoveryInspect?.status ?? null,
        mode: body.mode || null,
        signedSessionBound,
        sessionBound: Boolean(sessionHeader),
        readOnly: acceptedReadOnly,
        idempotencyKeyPresent,
        rowsStable,
        stateStable,
      }),
    },
    recoveryInspectSummary: {
      status: recoveryInspect?.status ?? null,
      ok: body.ok === true,
      mode: body.mode || null,
      readOnly: inspect.readOnly === true,
      classificationOnly: inspect.classificationOnly === true,
      signed: signedRequest.signed === true,
      authSessionBound: inspect.authSessionBound === true,
      rowsStableAcrossRead: rowsStable,
      stateStableAcrossRead: stateStable,
      mutatesReleaseState: false,
      mutationAttempted: inspect.mutationAttempted === true,
      writePathAttempted: inspect.writePathAttempted === true,
      idempotencyKeyPresent,
      canonicalHashLength: String(signedRequest.request?.canonicalHash || '').length,
      planHash: body.recovery?.planHash || null,
      receiptHash: body.recovery?.receiptHash || null,
      recoveryStateHash: body.recovery?.state ? sha256Hex(body.recovery.state) : null,
      countsHash: body.recovery?.counts ? digest(body.recovery.counts) : null,
      journalIntegrityHash: body.recovery?.journal?.integrity ? digest(body.recovery.journal.integrity) : null,
      claimHash: body.recovery?.journal?.claim ? digest(body.recovery.journal.claim) : null,
      storageGuardHash: body.recovery?.journal?.storageGuard ? digest(body.recovery.journal.storageGuard) : null,
      ownershipHash: body.recovery?.journal?.ownership ? digest(body.recovery.journal.ownership) : null,
      writerLeaseHash: body.recovery?.journal?.writerLease ? digest(body.recovery.journal.writerLease) : null,
      leaseFenceHash: body.recovery?.journal?.leaseFence ? digest(body.recovery.journal.leaseFence) : null,
      proofHash: digest({
        status: recoveryInspect?.status ?? null,
        ok: body.ok === true,
        mode: body.mode || null,
        readOnly: inspect.readOnly === true,
        authSessionBound: inspect.authSessionBound === true,
        rowsStable,
        stateStable,
        idempotencyKeyPresent,
        mutationAttempted: inspect.mutationAttempted === true,
        writePathAttempted: inspect.writePathAttempted === true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local recovery inspect route proof is support-only until production URL and credential proof exists',
    },
    caveat: {
      noProductionProof: true,
      statement: 'generated local support evidence only; no production endpoint or credential proof is claimed',
    },
  };

  if (!acceptedReadOnly) {
    return blockedRecoveryInspectEvidence(base, body.code || 'RECOVERY_INSPECT_ROUTE_PROOF_REQUIRED');
  }

  if (!routeEvidenceIsFresh(capturedAt, evaluatedAt)) {
    return blockedRecoveryInspectEvidence(base, 'RECOVERY_INSPECT_ROUTE_PROOF_STALE');
  }

  if (!isFreshProductionSession(session, evaluatedAt)) {
    return blockedRecoveryInspectEvidence(base, 'RECOVERY_INSPECT_AUTH_SESSION_STALE');
  }

  const receiptCore = {
    ...base,
    ok: true,
    status: 'support_only',
    code: 'LOCAL_RECOVERY_INSPECT_ROUTE_SUPPORT_ONLY',
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed recovery inspect route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function blockedRecoveryInspectEvidence(base, code) {
  const blocked = {
    ...base,
    ok: false,
    status: 'blocked',
    code,
    boundary: {
      firstRemainingProductionBoundary: 'fresh production recovery inspect route proof',
      status: 'blocked',
      verdict: code === 'RECOVERY_INSPECT_READ_ONLY_REQUIRED'
        ? 'RECOVERY_INSPECT_READ_ONLY_REQUIRED'
        : 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
  return {
    ...blocked,
    receiptHash: digest(blocked),
  };
}

function routeEvidenceIsFresh(capturedAt, evaluatedAt) {
  return Date.parse(evaluatedAt) - Date.parse(capturedAt) <= proofFreshnessMs;
}

function isFreshProductionSession(session, evaluatedAt) {
  return session?.type === 'production-auth-session'
    && session?.status === 'active'
    && typeof session.expiresAt === 'string'
    && Date.parse(session.expiresAt) > Date.parse(evaluatedAt);
}

function buildVerifyReleaseStyleSummary(recoveryInspectEvidence) {
  const reason = recoveryInspectEvidence.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : recoveryInspectEvidence.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    productionRecoveryInspectRoute: {
      ok: recoveryInspectEvidence.ok === true,
      summaryPath: 'productionRecoveryInspectRoute',
      receiptHash: recoveryInspectEvidence.receiptHash,
      routeEvidence: recoveryInspectEvidence.routeEvidence,
      recoveryInspectSummary: recoveryInspectEvidence.recoveryInspectSummary,
      redaction: recoveryInspectEvidence.redaction,
      required: [
        'signed POST /wp-json/reprint/v1/push/recovery/inspect',
        'session-bound read-only recovery inspection',
        'no mutating idempotency key',
        'no write path or mutation side effect',
        'hash-only receipt evidence',
      ],
      scope: recoveryInspectEvidence.evidenceScope,
      caveat: recoveryInspectEvidence.caveat,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: recoveryInspectEvidence.ok === true
        ? 'production-backed recovery inspect route proof required before release movement'
        : 'recovery inspect route read-only proof is required before release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed recovery inspect route proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0546',
    proofClass: 'generated-production-recovery-inspect-route',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    status: 'blocked',
    mutationAttempted: false,
    sourceSummary: {
      sourceUrlHash: evidence.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHeaderHash: evidence.credentialHeaderHash,
      sessionIdHash: evidence.sessionIdHash,
      idempotencyKeyHash: evidence.idempotencyKeyHash,
    },
    routeEvidence: {
      method: 'POST',
      endpointPath,
      proofHash: digest({
        method: 'POST',
        endpointPath,
        status: response.status,
        code: response.body?.code || null,
      }),
    },
    negativeAuth: {
      status: response.status,
      code: response.body?.code || null,
      mode: response.body?.mode || null,
      payloadWouldFailIfParsed: true,
      jsonParsed: evidence.jsonParsed === true,
      recoveryInspectReadStarted: evidence.recoveryInspectReadAttempted === true,
      writePathStarted: evidence.writePathAttempted === true,
      mutationSideEffectStarted: evidence.mutationAttempted === true,
      recoveryInspectEvidence: hasRecoveryInspectEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'authenticated read-only production recovery inspect route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated read-only recovery inspect route proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasRecoveryInspectEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.recovery
    || body.recoveryInspect
    || body.signedRequest
    || body.receipt?.type === 'recovery-inspect'
  );
}

async function requestLocalRoute(route, headers, rawBody = malformedJsonBody) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function collectRecoveryInspectRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (
    value.routeEvidence
    && typeof value.routeEvidence === 'object'
    && value.routeEvidence.recoveryInspectRoute === '/push/recovery/inspect'
    && value.routeEvidence.endpointPath === endpointPath
  ) {
    blocks.push(value.routeEvidence);
  }
  for (const child of Object.values(value)) {
    collectRecoveryInspectRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
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

test('RPP-0546 v3 generated production recovery inspect route receipt is read-only hash-only support evidence', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionRecoveryInspectRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const recoveryInspect = await client.signedPost('/recovery/inspect', recoveryInspectPayload, {
      session: sessionId,
      readOnly: true,
      retryable: true,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const request = route.state.requests[0];
    const evidence = buildRecoveryInspectRouteSupportEvidence({ recoveryInspect, request });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(evidence);
    const routeEvidenceBlocks = collectRecoveryInspectRouteEvidenceBlocks(verifyReleaseSummary);

    assert.equal(recoveryInspect.status, 200);
    assert.equal(recoveryInspect.request.pathname, endpointPath);
    assert.equal(recoveryInspect.request.method, 'POST');
    assert.equal(recoveryInspect.request.retryable, true);
    assert.equal(recoveryInspect.request.idempotencyKeyHash, '');
    assert.equal(recoveryInspect.body.mode, 'recovery-inspect');
    assert.equal(recoveryInspect.body.routeProfile.profile, 'production-shaped');
    assert.equal(recoveryInspect.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(recoveryInspect.body.routeProfile.routePrefix, '/push');
    assert.equal(recoveryInspect.body.recoveryInspect.readOnly, true);
    assert.equal(recoveryInspect.body.recoveryInspect.authSessionBound, true);
    assert.equal(recoveryInspect.body.recoveryInspect.idempotencyKeyPresent, false);
    assert.equal(recoveryInspect.body.recoveryInspect.rowsStableAcrossRead, true);
    assert.equal(recoveryInspect.body.recoveryInspect.stateStableAcrossRead, true);
    assert.equal(recoveryInspect.body.recoveryInspect.writePathAttempted, false);
    assert.equal(recoveryInspect.body.recoveryInspect.mutationAttempted, false);

    assert.equal(route.state.requests.length, 1);
    assert.equal(request.method, 'POST');
    assert.equal(request.pathname, endpointPath);
    assert.equal(request.headers['x-reprint-push-session'], sessionId);
    assert.equal(request.headers['x-reprint-push-idempotency-key'], undefined);
    assert.ok(request.headers['x-auth-signature']);
    assert.ok(request.headers['x-reprint-push-signature']);
    assert.equal(route.state.jsonParseAttempts, 1);
    assert.equal(route.state.recoveryInspectReadAttempts, 1);
    assert.equal(route.state.writePathAttempts, 0);
    assert.equal(route.state.mutationSideEffects, 0);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.routeEvidence.method, 'POST');
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(evidence.routeEvidence.signedRead, true);
    assert.equal(evidence.routeEvidence.sessionBound, true);
    assert.equal(evidence.routeEvidence.readOnly, true);
    assert.equal(evidence.routeEvidence.idempotencyKeyPresent, false);
    assert.equal(evidence.routeEvidence.idempotencyKeyHash, null);
    assert.equal(evidence.routeEvidence.mutatesReleaseState, false);
    assert.equal(evidence.routeEvidence.mutationAttempted, false);
    assert.equal(evidence.routeEvidence.writePathAttempted, false);
    assert.equal(evidence.recoveryInspectSummary.rowsStableAcrossRead, true);
    assert.equal(evidence.recoveryInspectSummary.stateStableAcrossRead, true);
    assert.equal(evidence.recoveryInspectSummary.mutatesReleaseState, false);
    assert.equal(evidence.recoveryInspectSummary.mutationAttempted, false);
    assert.equal(evidence.recoveryInspectSummary.writePathAttempted, false);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.caveat.noProductionProof, true);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.productionRecoveryInspectRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionRecoveryInspectRoute.receiptHash, evidence.receiptHash);
    assert.equal(verifyReleaseSummary.productionRecoveryInspectRoute.caveat.noProductionProof, true);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(
      routeEvidenceBlocks[0],
      verifyReleaseSummary.productionRecoveryInspectRoute.routeEvidence,
    );

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'userIdHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'signedSessionHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.recoveryInspectSummary, [
      'proofHash',
      'planHash',
      'receiptHash',
      'recoveryStateHash',
      'countsHash',
      'journalIntegrityHash',
      'claimHash',
      'storageGuardHash',
      'ownershipHash',
      'writerLeaseHash',
      'leaseFenceHash',
    ]);
    assert.match(evidence.receiptHash, hashPattern);
    assert.equal(evidence.redaction.rawValuesIncluded, false);
    assertNoRawValues(verifyReleaseSummary, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
      rawPlanSecret,
      JSON.stringify(recoveryInspectPayload),
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0546 v3 negative auth cases fail before JSON parsing or recovery write paths', async () => {
  const route = createLocalProductionRecoveryInspectRoute();
  const negativeCases = [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': malformedJsonBodyContentType,
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': malformedJsonBodyContentType,
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': malformedJsonBodyContentType,
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedRecoveryInspectHeaders({
          rawBody: malformedJsonBody,
          session: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-legacy-idempotency-malformed-json',
      expectedStatus: 400,
      expectedCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      headers: signedRecoveryInspectHeaders({
        rawBody: malformedJsonBody,
        idempotency: idempotencyKey,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedRecoveryInspectHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedRecoveryInspectHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedRecoveryInspectHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      headers: signedRecoveryInspectHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestLocalRoute(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasRecoveryInspectEvidence(result), false, `${negativeCase.name} emitted recovery inspect evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.recoveryInspectReadStarted, false);
    assert.equal(summary.negativeAuth.writePathStarted, false);
    assert.equal(summary.negativeAuth.mutationSideEffectStarted, false);
    assert.equal(summary.negativeAuth.recoveryInspectEvidence, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, ['proofHash']);
    assertHashOnlyFields(summary.negativeAuth, ['bodyHash']);
    assertHashOnlyWhenPresent(summary.authSummary, [
      'credentialHeaderHash',
      'sessionIdHash',
      'idempotencyKeyHash',
    ]);
    assertNoRawValues({
      response: result.body,
      summary,
    }, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      malformedJsonBody,
    ]);
  }

  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.recoveryInspectReadAttempts, 0);
  assert.equal(route.state.writePathAttempts, 0);
  assert.equal(route.state.mutationSideEffects, 0);
});

test('RPP-0546 v3 refuses missing stale or idempotency-bound recovery inspect evidence before release movement', () => {
  const rawBody = JSON.stringify(recoveryInspectPayload);
  const headers = signedRecoveryInspectHeaders({ rawBody });
  const acceptedRequest = {
    method: 'POST',
    pathname: endpointPath,
    search: '',
    headers: headerEntries(headers),
  };
  const acceptedResponse = {
    status: 200,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: recoveryInspectBody({
      payload: recoveryInspectPayload,
      rawBody,
      headers: acceptedRequest.headers,
    }),
  };
  const legacyHeaders = signedRecoveryInspectHeaders({ rawBody, idempotency: idempotencyKey });
  const legacyRequest = {
    method: 'POST',
    pathname: endpointPath,
    search: '',
    headers: headerEntries(legacyHeaders),
  };
  const legacyResponse = {
    status: 400,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: authFailureBody('RECOVERY_INSPECT_READ_ONLY_REQUIRED', legacyRequest.headers, rawBody),
  };
  const missing = buildRecoveryInspectRouteSupportEvidence({
    recoveryInspect: null,
    evaluatedAt: proofCapturedAt,
  });
  const staleRoute = buildRecoveryInspectRouteSupportEvidence({
    recoveryInspect: acceptedResponse,
    request: acceptedRequest,
    capturedAt: proofStaleCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const staleSession = buildRecoveryInspectRouteSupportEvidence({
    recoveryInspect: {
      ...acceptedResponse,
      body: recoveryInspectBody({
        payload: recoveryInspectPayload,
        rawBody,
        headers: acceptedRequest.headers,
        expiresAt: staleExpiresAt,
      }),
    },
    request: acceptedRequest,
    capturedAt: proofCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const legacyIdempotency = buildRecoveryInspectRouteSupportEvidence({
    recoveryInspect: legacyResponse,
    request: legacyRequest,
    capturedAt: proofCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const legacySummary = buildVerifyReleaseStyleSummary(legacyIdempotency);

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'RECOVERY_INSPECT_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(staleRoute.ok, false);
  assert.equal(staleRoute.status, 'blocked');
  assert.equal(staleRoute.code, 'RECOVERY_INSPECT_ROUTE_PROOF_STALE');
  assert.equal(staleRoute.releaseStatus, 'NO-GO');
  assert.equal(staleRoute.releaseMovement.allowed, false);
  assert.equal(staleRoute.mutationAttempted, false);
  assert.equal(staleRoute.boundary.firstRemainingProductionBoundary, 'fresh production recovery inspect route proof');

  assert.equal(staleSession.ok, false);
  assert.equal(staleSession.status, 'blocked');
  assert.equal(staleSession.code, 'RECOVERY_INSPECT_AUTH_SESSION_STALE');
  assert.equal(staleSession.releaseStatus, 'NO-GO');
  assert.equal(staleSession.releaseMovement.allowed, false);
  assert.equal(staleSession.mutationAttempted, false);
  assert.equal(staleSession.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(legacyIdempotency.ok, false);
  assert.equal(legacyIdempotency.status, 'blocked');
  assert.equal(legacyIdempotency.code, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');
  assert.equal(legacyIdempotency.releaseStatus, 'NO-GO');
  assert.equal(legacyIdempotency.releaseMovement.allowed, false);
  assert.equal(legacyIdempotency.routeEvidence.idempotencyKeyPresent, true);
  assert.equal(legacyIdempotency.routeEvidence.readOnly, false);
  assert.equal(legacyIdempotency.routeEvidence.mutationAttempted, false);
  assert.equal(legacyIdempotency.routeEvidence.writePathAttempted, false);
  assert.equal(legacyIdempotency.boundary.verdict, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');
  assert.equal(legacySummary.statusMarker, '[verify-release:held exit=1 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED mutationAttempted=false]');
  assert.equal(legacySummary.releaseMovement.allowed, false);

  assertHashOnlyFields(staleRoute.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(staleRoute.authSummary, [
    'credentialHash',
    'userLoginHash',
    'userIdHash',
    'sessionIdHash',
    'sessionExpiresAtHash',
    'signedSessionHash',
  ]);
  assertHashOnlyFields(staleRoute.routeEvidence, ['proofHash']);
  assertHashOnlyFields(staleRoute.recoveryInspectSummary, [
    'proofHash',
    'planHash',
    'receiptHash',
    'recoveryStateHash',
    'countsHash',
    'journalIntegrityHash',
    'claimHash',
    'storageGuardHash',
    'ownershipHash',
    'writerLeaseHash',
    'leaseFenceHash',
  ]);
  assertHashOnlyWhenPresent(legacyIdempotency.authSummary, [
    'credentialHash',
    'userLoginHash',
    'userIdHash',
    'sessionIdHash',
    'sessionExpiresAtHash',
    'signedSessionHash',
    'idempotencyKeyHash',
  ]);
  assertHashOnlyWhenPresent(legacyIdempotency.routeEvidence, [
    'idempotencyKeyHash',
    'proofHash',
  ]);
  assertNoRawValues({
    missing,
    staleRoute,
    staleSession,
    legacySummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    wrongCredential.password,
    sessionId,
    invalidSessionId,
    idempotencyKey,
    rawPlanSecret,
    JSON.stringify(recoveryInspectPayload),
  ]);
});
