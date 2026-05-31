import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const releaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/mutate`;
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0587_admin',
  password: 'rpp-0587-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0587-wrong-application-password',
};
const sessionId = 'psh_rpp_0587_raw_session_id';
const expiredSessionId = 'psh_rpp_0587_expired_session_id';
const bindingMismatchSessionId = 'psh_rpp_0587_binding_mismatch_session_id';
const invalidSessionId = 'psh_rpp_0587_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0587-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T15:00:00Z';
const freshExpiresAt = '2026-05-31T15:04:00Z';
const expiredAt = '2026-05-31T14:59:00Z';
const verificationUnix = 1_780_000_000;
const signedTimestamp = String(verificationUnix);
const staleSignedTimestamp = String(verificationUnix - 600);
const signedNonce = 'rpp0587acceptednonce';
const invalidNonce = 'short';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const hashPattern = /^[a-f0-9]{64}$/;
const routeProfileHash = sha256Hex('production-shaped');
const proofClass = 'production-recovery-mutate-route-verifier-v5';
const evidenceScope = 'local-executor-auth-support';
const requiredNegativeCodes = Object.freeze([
  'reprint_push_lab_auth_required',
  'SIGNED_HEADER_REQUIRED',
  'SIGNED_SESSION_REQUIRED',
  'MISSING_IDEMPOTENCY_KEY',
  'SIGNED_CONTENT_HASH_INVALID',
  'SIGNED_CONTENT_HASH_MISMATCH',
  'SIGNED_TIMESTAMP_INVALID',
  'SIGNED_NONCE_INVALID',
  'SIGNED_AUTH_SIGNATURE_MISMATCH',
  'SIGNED_SESSION_INVALID',
  'SIGNED_SESSION_EXPIRED',
  'SIGNED_SESSION_BINDING_MISMATCH',
  'SIGNED_PUSH_SIGNATURE_MISMATCH',
]);
const recoveryMutatePayload = {
  plan: {
    id: 'plan-rpp-0587-recovery-mutate',
    status: 'ready',
    mutations: [
      {
        resourceKey: 'wp_option:blogname',
        action: 'update',
      },
    ],
    conflicts: [],
    blockers: [],
  },
  receipt: {
    type: 'dry-run',
    receiptHash: `sha256:${sha256Hex('rpp-0587-dry-run-receipt')}`,
  },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function credentialHash(value = credential) {
  return sha256Hex(`${value.username}\n${value.password}`);
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
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname,
    '',
    contentHash,
    session,
    key,
  ].join('\n');
}

function signedRecoveryMutateHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
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
    idempotencyKey: idempotency,
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

function createLocalProductionRecoveryMutateVerifierRoute() {
  const state = {
    requests: [],
    authorizationAccepted: 0,
    jsonParseAttempts: 0,
    recoveryMutationPlanningAttempts: 0,
    recoveryMutationSetupAttempts: 0,
    journalMutationAttempts: 0,
    applyCapableWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
    mutationSideEffects: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({
      methodHash: sha256Hex(method),
      pathnameHash: sha256Hex(requestUrl.pathname),
      headerCount: Object.keys(headers).length,
      bodyHash: sha256Hex(rawBody),
    });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleRecoveryMutateVerifierRequest({
      method,
      pathname: requestUrl.pathname,
      headers,
      rawBody,
      state,
    });
  }

  return { state, fetchHandler };
}

function handleRecoveryMutateVerifierRequest({ method, pathname, headers, rawBody, state }) {
  const authResult = authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody });
  if (!authResult.ok) {
    return jsonResponse(authFailureBody(authResult.code, headers, rawBody), authResult.status);
  }

  state.authorizationAccepted += 1;
  return jsonResponse(acceptedAuthOnlyBody({ auth: authResult.auth, rawBody }), 202);
}

function authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { ok: false, code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { ok: false, code: 'SIGNED_HEADER_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-session']) {
    return { ok: false, code: 'SIGNED_SESSION_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-idempotency-key']) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', status: 400 };
  }

  if (!/^[a-f0-9]{64}$/.test(headers['x-auth-content-hash'])) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_INVALID', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const timestampSeconds = parseSignedTimestamp(headers['x-auth-timestamp']);
  if (timestampSeconds === null || Math.abs(verificationUnix - timestampSeconds) > 300) {
    return { ok: false, code: 'SIGNED_TIMESTAMP_INVALID', status: 401 };
  }

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(headers['x-auth-nonce'])) {
    return { ok: false, code: 'SIGNED_NONCE_INVALID', status: 400 };
  }

  const signingKey = labSigningKey();
  const signingKeyHash = sha256Hex(signingKey);
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { ok: false, code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  const session = recoveryAuthSession(headers['x-reprint-push-session']);
  if (!session) {
    return { ok: false, code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  if (Date.parse(session.expiresAt) <= Date.parse(proofCapturedAt)) {
    return { ok: false, code: 'SIGNED_SESSION_EXPIRED', status: 401 };
  }

  if (
    session.credentialHash !== credentialHash()
    || session.signingKeyHash !== signingKeyHash
    || session.sourceUrlHash !== sha256Hex(sourceUrl)
    || session.userLoginHash !== sha256Hex(credential.username)
  ) {
    return { ok: false, code: 'SIGNED_SESSION_BINDING_MISMATCH', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'],
    idempotencyKey: headers['x-reprint-push-idempotency-key'],
  });
  const expectedPushSignature = hmacHex(signingKey, canonical);
  if (headers['x-reprint-push-signature'] !== expectedPushSignature) {
    return { ok: false, code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return {
    ok: true,
    auth: {
      contentHash,
      timestampHash: sha256Hex(headers['x-auth-timestamp']),
      nonceHash: sha256Hex(headers['x-auth-nonce']),
      credentialHash: credentialHash(),
      userLoginHash: sha256Hex(credential.username),
      signingKeyHash,
      sourceUrlHash: sha256Hex(sourceUrl),
      sessionIdHash: sha256Hex(headers['x-reprint-push-session']),
      sessionExpiresAtHash: sha256Hex(session.expiresAt),
      idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key']),
      canonicalHash: sha256Hex(canonical),
      authSignatureHash: sha256Hex(authSignature),
      pushSignatureHash: sha256Hex(expectedPushSignature),
    },
  };
}

function parseSignedTimestamp(value) {
  return /^\d{10}$/.test(value) ? Number(value) : null;
}

function recoveryAuthSession(value) {
  const base = {
    credentialHash: credentialHash(),
    signingKeyHash: sha256Hex(labSigningKey()),
    sourceUrlHash: sha256Hex(sourceUrl),
    userLoginHash: sha256Hex(credential.username),
    expiresAt: freshExpiresAt,
  };

  if (value === sessionId) {
    return base;
  }

  if (value === expiredSessionId) {
    return {
      ...base,
      expiresAt: expiredAt,
    };
  }

  if (value === bindingMismatchSessionId) {
    return {
      ...base,
      credentialHash: credentialHash(wrongCredential),
    };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'recovery-mutate',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      routePathHash: sha256Hex(endpointPath),
      methodHash: sha256Hex('POST'),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      contentTypeHash: headers['content-type'] ? sha256Hex(headers['content-type']) : null,
      contentHashHeaderHash: headers['x-auth-content-hash']
        ? sha256Hex(headers['x-auth-content-hash'])
        : null,
      timestampHash: headers['x-auth-timestamp'] ? sha256Hex(headers['x-auth-timestamp']) : null,
      nonceHash: headers['x-auth-nonce'] ? sha256Hex(headers['x-auth-nonce']) : null,
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      jsonParsed: false,
      recoveryMutationPlanningAttempted: false,
      recoveryMutationSetupAttempted: false,
      journalMutationAttempted: false,
      applyCapableWorkAttempted: false,
      mutationCapableWorkAttempted: false,
      mutationAttempted: false,
    },
  };
}

function acceptedAuthOnlyBody({ auth, rawBody }) {
  return {
    ok: true,
    code: 'RECOVERY_MUTATE_AUTHORIZED_SUPPORT_ONLY',
    mode: 'recovery-mutate',
    releaseStatus: 'NO-GO',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefixHash: sha256Hex('/push'),
      routePathHash: sha256Hex(endpointPath),
      labBacked: true,
    },
    authorization: {
      schemaVersion: 1,
      status: 'accepted',
      capturedAtHash: sha256Hex(proofCapturedAt),
      bodyHash: sha256Hex(rawBody),
      ...auth,
    },
    recoveryMutationAuthorization: {
      authorizationOnly: true,
      jsonParsed: false,
      recoveryMutationPlanningAttempted: false,
      recoveryMutationSetupAttempted: false,
      journalMutationAttempted: false,
      applyCapableWorkAttempted: false,
      mutationCapableWorkAttempted: false,
      mutationAttempted: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local authorization-only recovery mutate route proof cannot move release gates',
    },
  };
}

function summarizeAcceptedAuthSupportEvidence(response) {
  const body = response.body || {};
  const authorization = body.authorization || {};
  const recoveryAuth = body.recoveryMutationAuthorization || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0587',
    proofClass,
    evidenceScope,
    releaseStatus: 'NO-GO',
    status: body.ok === true ? 'support_only' : 'blocked',
    mutationAttempted: false,
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: authorization.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: authorization.credentialHash,
      userLoginHash: authorization.userLoginHash,
      sessionIdHash: authorization.sessionIdHash,
      sessionExpiresAtHash: authorization.sessionExpiresAtHash,
      signingKeyHash: authorization.signingKeyHash,
      nonceHash: authorization.nonceHash,
      idempotencyKeyHash: authorization.idempotencyKeyHash,
      canonicalHash: authorization.canonicalHash,
      bodyHash: authorization.bodyHash,
    },
    routeEvidence: {
      proofClass,
      routeProfileHash,
      routeKindHash: sha256Hex('production-recovery-mutate'),
      methodHash: sha256Hex(response.request?.method || 'POST'),
      routePathHash: body.routeProfile?.routePathHash || null,
      profileHash: sha256Hex(body.routeProfile?.profile || ''),
      proofHash: digest({
        method: response.request?.method || 'POST',
        routePathHash: body.routeProfile?.routePathHash || null,
        status: response.status,
        code: body.code || null,
        authStatus: authorization.status || null,
      }),
    },
    recoveryMutationAuthorization: {
      authorized: authorization.status === 'accepted',
      authorizationOnly: recoveryAuth.authorizationOnly === true,
      jsonParsed: recoveryAuth.jsonParsed === true,
      recoveryMutationPlanningStarted: recoveryAuth.recoveryMutationPlanningAttempted === true,
      recoveryMutationSetupStarted: recoveryAuth.recoveryMutationSetupAttempted === true,
      journalMutationStarted: recoveryAuth.journalMutationAttempted === true,
      applyCapableWorkStarted: recoveryAuth.applyCapableWorkAttempted === true,
      mutationCapableWorkStarted: recoveryAuth.mutationCapableWorkAttempted === true,
      mutationAttempted: recoveryAuth.mutationAttempted === true,
      proofHash: digest({
        authorized: authorization.status === 'accepted',
        authorizationOnly: recoveryAuth.authorizationOnly === true,
        jsonParsed: recoveryAuth.jsonParsed === true,
        recoveryMutationPlanningStarted: recoveryAuth.recoveryMutationPlanningAttempted === true,
        recoveryMutationSetupStarted: recoveryAuth.recoveryMutationSetupAttempted === true,
        journalMutationStarted: recoveryAuth.journalMutationAttempted === true,
        applyCapableWorkStarted: recoveryAuth.applyCapableWorkAttempted === true,
        mutationCapableWorkStarted: recoveryAuth.mutationCapableWorkAttempted === true,
        mutationAttempted: recoveryAuth.mutationAttempted === true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'production-backed recovery mutate authorization and executor proof is still required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0587',
    proofClass: `${proofClass}-negative`,
    evidenceScope,
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
      nonceHash: evidence.nonceHash,
      timestampHash: evidence.timestampHash,
      contentHashHeaderHash: evidence.contentHashHeaderHash,
    },
    routeEvidence: {
      methodHash: evidence.methodHash,
      routePathHash: evidence.routePathHash,
      proofHash: digest({
        methodHash: evidence.methodHash,
        routePathHash: evidence.routePathHash,
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
      recoveryMutationPlanningStarted: evidence.recoveryMutationPlanningAttempted === true,
      recoveryMutationSetupStarted: evidence.recoveryMutationSetupAttempted === true,
      journalMutationStarted: evidence.journalMutationAttempted === true,
      applyCapableWorkStarted: evidence.applyCapableWorkAttempted === true,
      mutationCapableWorkStarted: evidence.mutationCapableWorkAttempted === true,
      mutationSideEffectStarted: evidence.mutationAttempted === true,
      recoveryMutationEvidence: hasRecoveryMutationEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'negative recovery mutate auth proof cannot move release gates',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function buildNegativeAuthAggregate(caseSummaries) {
  const cases = caseSummaries.map(({ name, summary }) => ({
    idHash: sha256Hex(name),
    status: summary.negativeAuth.status,
    code: summary.negativeAuth.code,
    routeEvidenceHash: summary.routeEvidence.proofHash,
    bodyHash: summary.negativeAuth.bodyHash,
    rejectedBeforeJsonParse: summary.negativeAuth.jsonParsed === false,
    recoveryMutationPlanningStarted: summary.negativeAuth.recoveryMutationPlanningStarted,
    recoveryMutationSetupStarted: summary.negativeAuth.recoveryMutationSetupStarted,
    journalMutationStarted: summary.negativeAuth.journalMutationStarted,
    applyCapableWorkStarted: summary.negativeAuth.applyCapableWorkStarted,
    mutationCapableWorkStarted: summary.negativeAuth.mutationCapableWorkStarted,
    mutationAttempted: summary.negativeAuth.mutationSideEffectStarted,
    mutationEvidence: summary.negativeAuth.recoveryMutationEvidence,
    rawValueIncluded: false,
  }));
  const core = {
    schemaVersion: 1,
    slice: 'RPP-0587',
    proofClass: `${proofClass}-negative-aggregate`,
    evidenceScopeHash: sha256Hex(evidenceScope),
    releaseStatus: 'NO-GO',
    status: 'blocked',
    caseCount: cases.length,
    cases,
    requiredCodesHash: digest(requiredNegativeCodes),
    observedCodesHash: digest(cases.map((entry) => entry.code).sort()),
  };
  const ok = negativeAuthCasesAreComplete(core);
  return {
    ...core,
    ok,
    proofHash: digest({ ...core, ok }),
  };
}

function negativeAuthCasesAreComplete(aggregate) {
  if (!aggregate || !Array.isArray(aggregate.cases)) {
    return false;
  }
  const observedCodes = new Set(aggregate.cases.map((entry) => entry.code));
  return aggregate.cases.length >= requiredNegativeCodes.length
    && requiredNegativeCodes.every((code) => observedCodes.has(code))
    && aggregate.cases.every((entry) => (
      entry.rejectedBeforeJsonParse === true
      && entry.recoveryMutationPlanningStarted === false
      && entry.recoveryMutationSetupStarted === false
      && entry.journalMutationStarted === false
      && entry.applyCapableWorkStarted === false
      && entry.mutationCapableWorkStarted === false
      && entry.mutationAttempted === false
      && entry.mutationEvidence === false
      && entry.rawValueIncluded === false
      && hashPattern.test(entry.idHash)
      && hashPattern.test(entry.routeEvidenceHash)
      && hashPattern.test(entry.bodyHash)
    ));
}

function buildProductionRecoveryMutateVerifierReceipt({
  acceptedEvidence = null,
  negativeAuthEvidence = null,
  capturedAtHash = sha256Hex(proofCapturedAt),
} = {}) {
  const routeEvidenceOk = acceptedEvidenceHasRequiredRouteProof(acceptedEvidence);
  const negativeAuthOk = negativeAuthCasesAreComplete(negativeAuthEvidence);
  const ok = routeEvidenceOk && negativeAuthOk;
  const code = recoveryMutateReceiptCode({ acceptedEvidence, negativeAuthEvidence, ok });
  const core = {
    schemaVersion: 1,
    slice: 'RPP-0587',
    proofClass,
    evidenceScope,
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAtHash,
    mutationAttempted: false,
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: acceptedEvidence?.sourceSummary || {
      sourceUrlHash: null,
      rawUrlIncluded: false,
    },
    authSummary: acceptedEvidence?.authSummary || null,
    routeEvidence: acceptedEvidence?.routeEvidence || null,
    recoveryMutationAuthorization: acceptedEvidence?.recoveryMutationAuthorization || null,
    negativeAuthEvidence,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local recovery mutate route verifier proof is support-only until checked production evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };

  return {
    ...core,
    receiptHash: digest(core),
  };
}

function recoveryMutateReceiptCode({ acceptedEvidence, negativeAuthEvidence, ok }) {
  if (ok) {
    return 'LOCAL_RECOVERY_MUTATE_ROUTE_VERIFIER_V5_SUPPORT_ONLY';
  }
  if (!acceptedEvidence) {
    return 'RECOVERY_MUTATE_ROUTE_EVIDENCE_REQUIRED';
  }
  if (!acceptedEvidenceHasRequiredRouteProof(acceptedEvidence)) {
    return 'RECOVERY_MUTATE_ROUTE_EVIDENCE_MALFORMED';
  }
  if (!negativeAuthCasesAreComplete(negativeAuthEvidence)) {
    return 'RECOVERY_MUTATE_NEGATIVE_AUTH_EVIDENCE_INCOMPLETE';
  }
  return 'RECOVERY_MUTATE_ROUTE_VERIFIER_INCOMPLETE';
}

function acceptedEvidenceHasRequiredRouteProof(acceptedEvidence) {
  const auth = acceptedEvidence?.recoveryMutationAuthorization || {};
  const routeEvidence = acceptedEvidence?.routeEvidence || {};
  return acceptedEvidence?.slice === 'RPP-0587'
    && acceptedEvidence?.proofClass === proofClass
    && acceptedEvidence?.status === 'support_only'
    && acceptedEvidence?.releaseStatus === 'NO-GO'
    && acceptedEvidence?.mutationAttempted === false
    && routeEvidence.proofClass === proofClass
    && routeEvidence.routeProfileHash === routeProfileHash
    && hashPattern.test(routeEvidence.routeKindHash || '')
    && hashPattern.test(routeEvidence.methodHash || '')
    && hashPattern.test(routeEvidence.routePathHash || '')
    && hashPattern.test(routeEvidence.profileHash || '')
    && hashPattern.test(routeEvidence.proofHash || '')
    && auth.authorized === true
    && auth.authorizationOnly === true
    && auth.jsonParsed === false
    && auth.recoveryMutationPlanningStarted === false
    && auth.recoveryMutationSetupStarted === false
    && auth.journalMutationStarted === false
    && auth.applyCapableWorkStarted === false
    && auth.mutationCapableWorkStarted === false
    && auth.mutationAttempted === false
    && hashPattern.test(auth.proofHash || '');
}

function buildVerifyReleaseStyleSummary(receipt) {
  const reason = receipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : receipt.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    productionRecoveryMutateRoute: {
      ok: receipt.ok === true,
      summaryPath: 'productionRecoveryMutateRoute',
      receiptHash: receipt.receiptHash,
      routeEvidence: receipt.routeEvidence,
      authorizationHash: receipt.recoveryMutationAuthorization
        ? digest(receipt.recoveryMutationAuthorization)
        : null,
      negativeAuthEvidenceHash: receipt.negativeAuthEvidence
        ? digest(receipt.negativeAuthEvidence)
        : null,
      requiredHash: digest([
        'production recovery mutate route authorization evidence',
        'negative authentication fails before JSON parsing',
        'negative authentication fails before recovery mutation planning',
        'negative authentication fails before mutation-capable work',
        'hash-only verifier summary',
      ]),
      scopeHash: sha256Hex(receipt.evidenceScope),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: receipt.ok === true
        ? 'production-backed recovery mutate authorization and executor proof required before release movement'
        : 'recovery mutate route verifier proof is incomplete',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function collectRecoveryMutateRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (
    value.proofClass === proofClass
    && value.routeProfileHash === routeProfileHash
    && hashPattern.test(value.proofHash || '')
  ) {
    blocks.push(value);
  }
  for (const child of Object.values(value)) {
    collectRecoveryMutateRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
}

function hasRecoveryMutationEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.recovery
    || body.recoveryMutation
    || body.recoveryMutationAuthorization
    || body.dbJournal
    || body.signedRequest
    || body.receipt?.type === 'recovery-mutate'
  );
}

async function requestLocalRoute(route, headers) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: malformedJsonBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function negativeAuthCases() {
  return [
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
        signedRecoveryMutateHeaders({
          rawBody: malformedJsonBody,
          session: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-missing-idempotency-malformed-json',
      expectedStatus: 400,
      expectedCode: 'MISSING_IDEMPOTENCY_KEY',
      headers: withoutHeader(
        signedRecoveryMutateHeaders({
          rawBody: malformedJsonBody,
          idempotency: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'valid-auth-content-hash-invalid-malformed-json',
      expectedStatus: 400,
      expectedCode: 'SIGNED_CONTENT_HASH_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        contentHash: 'not-a-sha256-hash',
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-timestamp-invalid-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_TIMESTAMP_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        timestamp: staleSignedTimestamp,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-nonce-invalid-malformed-json',
      expectedStatus: 400,
      expectedCode: 'SIGNED_NONCE_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        nonce: invalidNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-expired-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_EXPIRED',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: expiredSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-session-binding-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_BINDING_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: bindingMismatchSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
  ];
}

async function collectNegativeAuthEvidence(route, { assertEachCase = false } = {}) {
  const caseSummaries = [];
  for (const negativeCase of negativeAuthCases()) {
    const result = await requestLocalRoute(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasRecoveryMutationEvidence(result), false, `${negativeCase.name} emitted mutation evidence`);

    if (assertEachCase) {
      assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
      assert.equal(summary.negativeAuth.jsonParsed, false);
      assert.equal(summary.negativeAuth.recoveryMutationPlanningStarted, false);
      assert.equal(summary.negativeAuth.recoveryMutationSetupStarted, false);
      assert.equal(summary.negativeAuth.journalMutationStarted, false);
      assert.equal(summary.negativeAuth.applyCapableWorkStarted, false);
      assert.equal(summary.negativeAuth.mutationCapableWorkStarted, false);
      assert.equal(summary.negativeAuth.mutationSideEffectStarted, false);
      assert.equal(summary.negativeAuth.recoveryMutationEvidence, false);
      assert.equal(summary.releaseStatus, 'NO-GO');
      assert.equal(summary.releaseMovement.allowed, false);
      assert.equal(summary.mutationAttempted, false);
      assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
      assertHashOnlyFields(summary.routeEvidence, [
        'methodHash',
        'routePathHash',
        'proofHash',
      ]);
      assertHashOnlyFields(summary.negativeAuth, ['bodyHash']);
      assertHashOnlyWhenPresent(summary.authSummary, [
        'credentialHeaderHash',
        'sessionIdHash',
        'idempotencyKeyHash',
        'nonceHash',
        'timestampHash',
        'contentHashHeaderHash',
      ]);
      assertNoRawValues({
        response: result.body,
        summary,
      }, rawFixtureValues());
    }

    caseSummaries.push({
      name: negativeCase.name,
      summary,
    });
  }

  return buildNegativeAuthAggregate(caseSummaries);
}

function functionBody(source, name, { afterParameters = false } = {}) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const jsBodyStart = afterParameters ? source.indexOf(') {', start) : -1;
  const open = jsBodyStart === -1 ? source.indexOf('{', start) : jsBodyStart + 2;
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

function assertNoRecoveryMutationBoundaryWork(state) {
  assert.equal(state.jsonParseAttempts, 0);
  assert.equal(state.recoveryMutationPlanningAttempts, 0);
  assert.equal(state.recoveryMutationSetupAttempts, 0);
  assert.equal(state.journalMutationAttempts, 0);
  assert.equal(state.applyCapableWorkAttempts, 0);
  assert.equal(state.mutationCapableWorkAttempts, 0);
  assert.equal(state.mutationSideEffects, 0);
}

function rawFixtureValues() {
  return [
    sourceUrl,
    endpointPath,
    credential.username,
    credential.password,
    wrongCredential.password,
    sessionId,
    expiredSessionId,
    bindingMismatchSessionId,
    invalidSessionId,
    idempotencyKey,
    signedNonce,
    invalidNonce,
    staleSignedTimestamp,
    malformedJsonBody,
    JSON.stringify(recoveryMutatePayload),
  ];
}

test('RPP-0587 v5 carries recovery mutate route evidence through one verifier summary', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionRecoveryMutateVerifierRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const recoveryMutate = await client.signedPost('/recovery/mutate', recoveryMutatePayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const acceptedEvidence = summarizeAcceptedAuthSupportEvidence(recoveryMutate);
    const negativeAuthEvidence = await collectNegativeAuthEvidence(route);
    const receipt = buildProductionRecoveryMutateVerifierReceipt({
      acceptedEvidence,
      negativeAuthEvidence,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectRecoveryMutateRouteEvidenceBlocks(verifyReleaseSummary);

    assert.equal(recoveryMutate.status, 202);
    assert.equal(recoveryMutate.request.pathname, endpointPath);
    assert.equal(recoveryMutate.request.method, 'POST');
    assert.equal(recoveryMutate.body.ok, true);
    assert.equal(recoveryMutate.body.code, 'RECOVERY_MUTATE_AUTHORIZED_SUPPORT_ONLY');
    assert.equal(recoveryMutate.body.mode, 'recovery-mutate');
    assert.equal(recoveryMutate.body.releaseStatus, 'NO-GO');
    assert.equal(recoveryMutate.body.releaseMovement.allowed, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.authorizationOnly, true);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.jsonParsed, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.recoveryMutationPlanningAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.recoveryMutationSetupAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.journalMutationAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.applyCapableWorkAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.mutationCapableWorkAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.mutationAttempted, false);

    assert.equal(acceptedEvidence.status, 'support_only');
    assert.equal(acceptedEvidence.releaseStatus, 'NO-GO');
    assert.equal(acceptedEvidence.releaseMovement.allowed, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.authorized, true);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.authorizationOnly, true);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.jsonParsed, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.recoveryMutationPlanningStarted, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.recoveryMutationSetupStarted, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.journalMutationStarted, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.applyCapableWorkStarted, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.mutationCapableWorkStarted, false);
    assert.equal(acceptedEvidence.recoveryMutationAuthorization.mutationAttempted, false);

    assert.equal(negativeAuthEvidence.ok, true);
    assert.equal(negativeAuthEvidence.caseCount, negativeAuthCases().length);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.match(receipt.receiptHash, hashPattern);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionRecoveryMutateRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionRecoveryMutateRoute.receiptHash, receipt.receiptHash);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(routeEvidenceBlocks[0], verifyReleaseSummary.productionRecoveryMutateRoute.routeEvidence);

    assertHashOnlyFields(acceptedEvidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(acceptedEvidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'signingKeyHash',
      'nonceHash',
      'idempotencyKeyHash',
      'canonicalHash',
      'bodyHash',
    ]);
    assertHashOnlyFields(acceptedEvidence.routeEvidence, [
      'routeKindHash',
      'methodHash',
      'routePathHash',
      'profileHash',
      'proofHash',
    ]);
    assertHashOnlyFields(acceptedEvidence.recoveryMutationAuthorization, ['proofHash']);
    assertHashOnlyFields(receipt, ['capturedAtHash', 'receiptHash']);
    assertHashOnlyFields(verifyReleaseSummary, ['commandHash', 'checkedCommandHash']);
    assertNoRawValues({
      acceptedEvidence,
      negativeAuthEvidence,
      receipt,
      verifyReleaseSummary,
    }, rawFixtureValues());

    assert.equal(route.state.authorizationAccepted, 1);
    assertNoRecoveryMutationBoundaryWork(route.state);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0587 v5 negative auth fails before JSON parsing planning or mutation work', async () => {
  const route = createLocalProductionRecoveryMutateVerifierRoute();
  const negativeAuthEvidence = await collectNegativeAuthEvidence(route, { assertEachCase: true });

  assert.equal(negativeAuthEvidence.ok, true);
  assert.equal(negativeAuthEvidence.caseCount, negativeAuthCases().length);
  assert.deepEqual(
    [...new Set(negativeAuthEvidence.cases.map((entry) => entry.code))].sort(),
    [...new Set([
      ...requiredNegativeCodes,
      'reprint_push_lab_auth_required',
    ])].sort(),
  );
  for (const entry of negativeAuthEvidence.cases) {
    assert.equal(entry.rejectedBeforeJsonParse, true);
    assert.equal(entry.recoveryMutationPlanningStarted, false);
    assert.equal(entry.recoveryMutationSetupStarted, false);
    assert.equal(entry.journalMutationStarted, false);
    assert.equal(entry.applyCapableWorkStarted, false);
    assert.equal(entry.mutationCapableWorkStarted, false);
    assert.equal(entry.mutationAttempted, false);
    assert.equal(entry.mutationEvidence, false);
    assert.equal(entry.rawValueIncluded, false);
    assertHashOnlyFields(entry, ['idHash', 'routeEvidenceHash', 'bodyHash']);
  }

  assert.equal(route.state.authorizationAccepted, 0);
  assertNoRecoveryMutationBoundaryWork(route.state);
  assertNoRawValues(negativeAuthEvidence, rawFixtureValues());
});

test('RPP-0587 v5 missing or malformed route proof blocks verifier movement', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionRecoveryMutateVerifierRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const recoveryMutate = await client.signedPost('/recovery/mutate', recoveryMutatePayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const acceptedEvidence = summarizeAcceptedAuthSupportEvidence(recoveryMutate);
    const negativeAuthEvidence = await collectNegativeAuthEvidence(route);
    const missingRoute = buildProductionRecoveryMutateVerifierReceipt({
      acceptedEvidence: null,
      negativeAuthEvidence,
    });
    const malformedRoute = buildProductionRecoveryMutateVerifierReceipt({
      acceptedEvidence: {
        ...acceptedEvidence,
        routeEvidence: {
          ...acceptedEvidence.routeEvidence,
          proofHash: 'not-a-sha256-hash',
        },
      },
      negativeAuthEvidence,
    });
    const missingNegative = buildProductionRecoveryMutateVerifierReceipt({
      acceptedEvidence,
      negativeAuthEvidence: {
        ...negativeAuthEvidence,
        cases: negativeAuthEvidence.cases.slice(0, 1),
      },
    });
    const malformedSummary = buildVerifyReleaseStyleSummary(malformedRoute);

    assert.equal(missingRoute.ok, false);
    assert.equal(missingRoute.status, 'blocked');
    assert.equal(missingRoute.code, 'RECOVERY_MUTATE_ROUTE_EVIDENCE_REQUIRED');
    assert.equal(missingRoute.releaseStatus, 'NO-GO');
    assert.equal(missingRoute.releaseMovement.allowed, false);
    assert.equal(missingRoute.boundary.verdict, 'RECOVERY_MUTATE_ROUTE_EVIDENCE_REQUIRED');

    assert.equal(malformedRoute.ok, false);
    assert.equal(malformedRoute.status, 'blocked');
    assert.equal(malformedRoute.code, 'RECOVERY_MUTATE_ROUTE_EVIDENCE_MALFORMED');
    assert.equal(malformedRoute.releaseStatus, 'NO-GO');
    assert.equal(malformedRoute.releaseMovement.allowed, false);
    assert.equal(malformedRoute.boundary.verdict, 'RECOVERY_MUTATE_ROUTE_EVIDENCE_MALFORMED');

    assert.equal(missingNegative.ok, false);
    assert.equal(missingNegative.status, 'blocked');
    assert.equal(missingNegative.code, 'RECOVERY_MUTATE_NEGATIVE_AUTH_EVIDENCE_INCOMPLETE');
    assert.equal(missingNegative.releaseMovement.allowed, false);
    assert.equal(missingNegative.boundary.verdict, 'RECOVERY_MUTATE_NEGATIVE_AUTH_EVIDENCE_INCOMPLETE');

    assert.equal(malformedSummary.ok, false);
    assert.equal(malformedSummary.releaseStatus, 'NO-GO');
    assert.equal(malformedSummary.releaseMovement.allowed, false);
    assert.equal(malformedSummary.productionRecoveryMutateRoute.ok, false);
    assert.equal(collectRecoveryMutateRouteEvidenceBlocks(malformedSummary).length, 0);
    assertNoRawValues({
      missingRoute,
      malformedRoute,
      missingNegative,
      malformedSummary,
    }, rawFixtureValues());
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0587 v5 live release verifier keeps recovery mutate evidence single-summary scoped', () => {
  const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
  const releaseVerifierSource = readFileSync(releaseVerifierPath, 'utf8');
  const emitCombinedReleaseProof = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof', {
    afterParameters: true,
  });
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence', {
    afterParameters: true,
  });

  assert.match(releaseVerifierSource, /'recovery-mutate'/);
  assert.match(
    releaseVerifierSource,
    /recoveryMutate:\s*'requires inspect plus fresh live evidence and the same HMAC floor as apply'/,
  );
  assert.match(emitCombinedReleaseProof, /\.\.\.verify,\s*gate2DurableRecoveryJournal:/s);
  assert.match(emitCombinedReleaseProof, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.equal(
    (emitCombinedReleaseProof.match(/productionRecoveryMutateRoute/g) || []).length,
    0,
    'combined proof should carry recovery mutate route evidence through the release proof spread',
  );
  assert.equal(
    (topologyEvidence.match(/productionRecoveryMutateRoute/g) || []).length,
    0,
    'topology evidence must not duplicate the recovery mutate route summary',
  );
});
