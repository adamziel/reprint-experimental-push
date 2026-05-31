import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/rpp-0575';
const routePrefix = '/wp-json/reprint/v1/push';
const applyEndpointPath = `${routePrefix}/apply`;
const recoveryMutateEndpointPath = `${routePrefix}/recovery/mutate`;
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0575_admin',
  password: 'rpp-0575-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0575_raw_session_id';
const idempotencyKey = 'idem-rpp-0575-raw-idempotency-key-v4';
const malformedIdempotencyKey = 'idem rpp 0575 malformed';
const blankIdempotencyKey = '   ';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0575acceptednonce';
const recoverySignedNonce = 'rpp0575recoverynonce';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const hashPattern = /^[a-f0-9]{64}$/;
const routeProfileHash = sha256Hex('production-shaped');
const applyPayload = {
  plan: {
    id: 'plan-rpp-0575-apply',
    mutations: [{ resourceKey: 'private-apply-resource', action: 'update' }],
  },
  receipt: { receiptHash: sha256Hex('rpp-0575-apply-receipt') },
};
const recoveryPayload = {
  plan: {
    id: 'plan-rpp-0575-recovery',
    mutations: [{ resourceKey: 'private-recovery-resource', action: 'repair' }],
  },
  receipt: { receiptHash: sha256Hex('rpp-0575-recovery-receipt') },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0575:${label}`);
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

function routeAliasForPath(pathname) {
  if (pathname === applyEndpointPath) {
    return 'apply';
  }
  if (pathname === recoveryMutateEndpointPath) {
    return 'recovery-mutate';
  }
  return 'unknown';
}

function routeAliasHashForPath(pathname) {
  return sha256Hex(routeAliasForPath(pathname));
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: key }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    canonicalQuery(rawQuery),
    contentHash,
    session,
    key,
  ].join('\n');
}

function canonicalQuery(query) {
  if (!query) {
    return '';
  }

  return query
    .split('&')
    .map((part, index) => {
      if (!part) {
        return null;
      }
      const [key, value = ''] = part.split('=', 2);
      return {
        key: decodeURIComponent(key.replace(/\+/g, '%20')),
        value: decodeURIComponent(value.replace(/\+/g, '%20')),
        index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.key !== right.key) {
        return left.key < right.key ? -1 : 1;
      }
      if (left.value !== right.value) {
        return left.value < right.value ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((pair) => `${rawUrlEncode(pair.key)}=${rawUrlEncode(pair.value)}`)
    .join('&');
}

function rawUrlEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signedMutationCapableHeaders({
  pathname,
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
    pathname,
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

function createLocalMutationCapableIdempotencyRoute() {
  const state = {
    requests: [],
    authorizationAccepted: 0,
    jsonParseAttempts: 0,
    applyWorkAttempts: 0,
    recoveryMutationWorkAttempts: 0,
    mutationSideEffects: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const pathname = requestUrl.pathname;
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({
      methodHash: sha256Hex(method),
      routeAliasHash: routeAliasHashForPath(pathname),
      routePathHash: sha256Hex(pathname),
      bodyHash: sha256Hex(rawBody),
      idempotencyEvidencePresent: headers['x-reprint-push-idempotency-key'] !== undefined,
    });

    assert.equal(method, 'POST');
    assert.ok(
      pathname === applyEndpointPath || pathname === recoveryMutateEndpointPath,
      'expected mutation-capable apply or recovery route',
    );

    return handleMutationCapableRequest({ method, pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleMutationCapableRequest({ method, pathname, headers, rawBody, state }) {
  const authResult = authenticateMutationCapableRequest({ method, pathname, headers, rawBody });
  if (!authResult.ok) {
    return jsonResponse(authFailureBody({
      code: authResult.code,
      status: authResult.status,
      pathname,
      headers,
      rawBody,
    }), authResult.status);
  }

  state.authorizationAccepted += 1;
  return jsonResponse(acceptedAuthorizationOnlyBody({
    pathname,
    rawBody,
    auth: authResult.auth,
  }), 202);
}

function authenticateMutationCapableRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { ok: false, code: 'MUTATION_AUTH_REQUIRED', status: 401 };
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
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_REQUIRED', status: 400 };
  }

  if (!isValidIdempotencyEvidence(headers['x-reprint-push-idempotency-key'])) {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_MALFORMED', status: 400 };
  }

  if (!/^[a-f0-9]{64}$/.test(headers['x-auth-content-hash'])) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_INVALID', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { ok: false, code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { ok: false, code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'],
    idempotencyKey: headers['x-reprint-push-idempotency-key'],
  });
  const pushSignature = hmacHex(signingKey, canonical);
  if (headers['x-reprint-push-signature'] !== pushSignature) {
    return { ok: false, code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return {
    ok: true,
    auth: {
      methodHash: sha256Hex(method),
      routeAliasHash: routeAliasHashForPath(pathname),
      routePathHash: sha256Hex(pathname),
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHash: credentialHash(),
      userLoginHash: sha256Hex(credential.username),
      signingKeyHash: sha256Hex(signingKey),
      sessionIdHash: sha256Hex(headers['x-reprint-push-session']),
      idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key']),
      contentHash,
      timestampHash: sha256Hex(headers['x-auth-timestamp']),
      nonceHash: sha256Hex(headers['x-auth-nonce']),
      canonicalHash: sha256Hex(canonical),
      authSignatureHash: sha256Hex(authSignature),
      pushSignatureHash: sha256Hex(pushSignature),
    },
  };
}

function isValidIdempotencyEvidence(value) {
  return typeof value === 'string'
    && value.trim() === value
    && /^\S{8,160}$/.test(value);
}

function authFailureBody({ code, pathname, headers, rawBody }) {
  const idempotencyValue = headers['x-reprint-push-idempotency-key'];
  return {
    ok: false,
    code,
    modeHash: sha256Hex('mutation-capable-idempotency-check'),
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      methodHash: sha256Hex('POST'),
      routeAliasHash: routeAliasHashForPath(pathname),
      routePathHash: sha256Hex(pathname),
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
      idempotencyKeyHash: idempotencyValue ? sha256Hex(idempotencyValue) : null,
      idempotencyEvidencePresent: Boolean(idempotencyValue),
      idempotencyEvidenceMalformed: code === 'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
      jsonParsed: false,
      applyWorkAttempted: false,
      recoveryMutationWorkAttempted: false,
      mutationAttempted: false,
    },
  };
}

function acceptedAuthorizationOnlyBody({ pathname, rawBody, auth }) {
  return {
    ok: true,
    code: 'MUTATION_CAPABLE_IDEMPOTENCY_AUTHORIZED_SUPPORT_ONLY',
    releaseStatus: 'NO-GO',
    routeProfile: {
      profileHash: routeProfileHash,
      routeAliasHash: auth.routeAliasHash,
      routePathHash: auth.routePathHash,
      labBacked: true,
    },
    authorization: {
      schemaVersion: 1,
      statusHash: sha256Hex('accepted'),
      bodyHash: sha256Hex(rawBody),
      ...auth,
    },
    mutationCapableAuthorization: {
      authorizationOnly: true,
      idempotencyRequired: true,
      idempotencyEvidencePresent: true,
      jsonParsed: false,
      applyWorkStarted: false,
      recoveryMutationWorkStarted: false,
      mutationAttempted: false,
      proofHash: digest({
        routeAliasHash: routeAliasHashForPath(pathname),
        idempotencyRequired: true,
        idempotencyEvidencePresent: true,
        jsonParsed: false,
        applyWorkStarted: false,
        recoveryMutationWorkStarted: false,
        mutationAttempted: false,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local mutation-capable idempotency route proof cannot move release gates',
    },
  };
}

function buildMutationCapableRouteEvidence(routeResponses) {
  const routes = routeResponses.map((response) => {
    const body = response.body || {};
    const authorization = body.authorization || {};
    const routeProfile = body.routeProfile || {};
    const mutationAuth = body.mutationCapableAuthorization || {};
    return {
      routeAliasHash: routeProfile.routeAliasHash || authorization.routeAliasHash || null,
      methodHash: authorization.methodHash || sha256Hex(response.request?.method || ''),
      routePathHash: routeProfile.routePathHash || authorization.routePathHash || null,
      mutationCapable: true,
      signed: true,
      sessionBound: Boolean(authorization.sessionIdHash),
      sessionHash: authorization.sessionIdHash || null,
      idempotencyRequired: mutationAuth.idempotencyRequired === true,
      idempotencyEvidencePresent: mutationAuth.idempotencyEvidencePresent === true,
      idempotencyKeyHash: authorization.idempotencyKeyHash || null,
      requestHash: authorization.contentHash || null,
      canonicalHash: authorization.canonicalHash || null,
      signedHeaderHash: digest({
        authSignatureHash: authorization.authSignatureHash || null,
        pushSignatureHash: authorization.pushSignatureHash || null,
      }),
      jsonParsed: mutationAuth.jsonParsed === true,
      mutationCapableWorkStarted: mutationAuth.applyWorkStarted === true
        || mutationAuth.recoveryMutationWorkStarted === true,
      mutationAttempted: mutationAuth.mutationAttempted === true,
    };
  });

  return {
    schemaVersion: 1,
    proofClass: 'focused-idempotency-key-requirement-v4',
    routeProfileHash,
    routeCount: routes.length,
    mutationCapableContractOk: routeEvidenceRoutesAreComplete(routes),
    mutationCapableRoutes: routes,
    proofHash: digest(routes),
  };
}

function routeEvidenceRoutesAreComplete(routes) {
  const routeAliasHashes = new Set(routes.map((route) => route.routeAliasHash));
  return routes.length === 2
    && routeAliasHashes.has(sha256Hex('apply'))
    && routeAliasHashes.has(sha256Hex('recovery-mutate'))
    && routes.every((route) => (
      route.mutationCapable === true
      && route.signed === true
      && route.sessionBound === true
      && route.idempotencyRequired === true
      && route.idempotencyEvidencePresent === true
      && route.jsonParsed === false
      && route.mutationCapableWorkStarted === false
      && route.mutationAttempted === false
      && hashFieldsAreValid(route, [
        'routeAliasHash',
        'methodHash',
        'routePathHash',
        'sessionHash',
        'idempotencyKeyHash',
        'requestHash',
        'canonicalHash',
        'signedHeaderHash',
      ])
    ));
}

function hashFieldsAreValid(value, fields) {
  return fields.every((field) => hashPattern.test(value[field]));
}

function rejectionCase({ id, routeAlias, options, error }) {
  return {
    idHash: sha256Hex(id),
    routeAliasHash: sha256Hex(routeAlias),
    methodHash: sha256Hex('POST'),
    rejectedBeforeTransport: true,
    rejectedBeforeJsonParse: true,
    mutationCapableWorkStarted: false,
    rawValueIncluded: false,
    code: errorCode(error),
    errorHash: sha256Hex(error.message),
    sessionHash: options.session ? sha256Hex(options.session) : null,
    idempotencyKeyHash: options.idempotencyKey ? sha256Hex(options.idempotencyKey) : null,
  };
}

function errorCode(error) {
  if (/Missing push idempotencyKey/.test(error.message)) {
    return 'MUTATION_IDEMPOTENCY_KEY_REQUIRED';
  }
  if (/Invalid push idempotencyKey/.test(error.message)) {
    return 'MUTATION_IDEMPOTENCY_KEY_MALFORMED';
  }
  return 'UNEXPECTED_IDEMPOTENCY_CONTRACT_ERROR';
}

function captureThrow(buildCase) {
  let captured = null;
  assert.throws(() => {
    try {
      buildCase();
    } catch (error) {
      captured = error;
      throw error;
    }
  });
  assert.ok(captured, 'expected a synchronous idempotency contract rejection');
  return captured;
}

function buildClientRejectionEvidence(client) {
  const cases = [];
  const missingApplyOptions = { session: sessionId };
  const malformedApplyOptions = { session: sessionId, idempotencyKey: blankIdempotencyKey };
  const missingRecoveryOptions = { session: sessionId };
  const malformedRecoveryOptions = { session: sessionId, idempotencyKey: malformedIdempotencyKey };

  cases.push(rejectionCase({
    id: 'apply-missing-idempotency-key',
    routeAlias: 'apply',
    options: missingApplyOptions,
    error: captureThrow(() => client.signedPost('/apply', applyPayload, missingApplyOptions)),
  }));
  cases.push(rejectionCase({
    id: 'apply-malformed-idempotency-key',
    routeAlias: 'apply',
    options: malformedApplyOptions,
    error: captureThrow(() => client.signedPost('/apply', applyPayload, malformedApplyOptions)),
  }));
  cases.push(rejectionCase({
    id: 'recovery-mutate-missing-idempotency-key',
    routeAlias: 'recovery-mutate',
    options: missingRecoveryOptions,
    error: captureThrow(() => client.signedPost('/recovery/mutate', recoveryPayload, missingRecoveryOptions)),
  }));
  cases.push(rejectionCase({
    id: 'recovery-mutate-malformed-idempotency-key',
    routeAlias: 'recovery-mutate',
    options: malformedRecoveryOptions,
    error: captureThrow(() => client.signedPost('/recovery/mutate', recoveryPayload, malformedRecoveryOptions)),
  }));

  return {
    ok: cases.length === 4
      && cases.every((entry) => (
        entry.rejectedBeforeTransport === true
        && entry.rejectedBeforeJsonParse === true
        && entry.mutationCapableWorkStarted === false
      ))
      && cases.filter((entry) => entry.code === 'MUTATION_IDEMPOTENCY_KEY_REQUIRED').length === 2
      && cases.filter((entry) => entry.code === 'MUTATION_IDEMPOTENCY_KEY_MALFORMED').length === 2,
    cases,
    proofHash: digest(cases),
  };
}

function buildIdempotencyRequirementReceipt({
  routeEvidence,
  rejectionEvidence,
  source = sourceUrl,
  capturedAtHash = sha256Hex('2026-05-31T14:00:00Z'),
}) {
  const routeEvidenceOk = routeEvidenceHasRequiredIdempotency(routeEvidence);
  const rejectionEvidenceOk = rejectionEvidenceHasRequiredFailures(rejectionEvidence);
  const contractOk = routeEvidenceOk && rejectionEvidenceOk;
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0575',
    proofClass: 'focused-idempotency-key-requirement-v4',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok: contractOk,
    status: contractOk ? 'support_only' : 'blocked',
    code: contractOk
      ? 'LOCAL_MUTATION_CAPABLE_IDEMPOTENCY_KEY_REQUIREMENT_V4_SUPPORT_ONLY'
      : 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE',
    capturedAtHash,
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
      credentialHash: credentialHash(),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: sha256Hex(sessionId),
      sessionBound: true,
    },
    routeEvidence,
    rejectionEvidence,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local mutation-capable idempotency-key proof is support-only until checked production evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed mutation-capable idempotency-key proof',
      status: 'blocked',
      verdict: contractOk ? 'PRODUCTION_EVIDENCE_REQUIRED' : 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE',
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function routeEvidenceHasRequiredIdempotency(routeEvidence) {
  return routeEvidence?.proofClass === 'focused-idempotency-key-requirement-v4'
    && routeEvidence.routeProfileHash === routeProfileHash
    && routeEvidence.routeCount === 2
    && routeEvidence.mutationCapableContractOk === true
    && hashPattern.test(routeEvidence.proofHash)
    && Array.isArray(routeEvidence.mutationCapableRoutes)
    && routeEvidenceRoutesAreComplete(routeEvidence.mutationCapableRoutes);
}

function rejectionEvidenceHasRequiredFailures(rejectionEvidence) {
  return rejectionEvidence?.ok === true
    && hashPattern.test(rejectionEvidence.proofHash)
    && Array.isArray(rejectionEvidence.cases)
    && rejectionEvidence.cases.length === 4
    && rejectionEvidence.cases.every((entry) => (
      entry.rejectedBeforeJsonParse === true
      && entry.mutationCapableWorkStarted === false
      && entry.rawValueIncluded === false
      && hashFieldsAreValid(entry, ['idHash', 'routeAliasHash', 'methodHash', 'errorHash'])
      && (entry.sessionHash === null || hashPattern.test(entry.sessionHash))
      && (entry.idempotencyKeyHash === null || hashPattern.test(entry.idempotencyKeyHash))
    ));
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
    productionIdempotencyKeyRequirement: {
      ok: receipt.ok === true,
      summaryPath: 'productionIdempotencyKeyRequirement',
      receiptHash: receipt.receiptHash,
      routeEvidence: receipt.routeEvidence,
      rejectionEvidenceHash: digest(receipt.rejectionEvidence),
      redaction: receipt.redaction,
      requiredHash: digest([
        'mutation-capable apply route idempotency key evidence',
        'mutation-capable recovery route idempotency key evidence',
        'missing idempotency fails before JSON parsing',
        'malformed idempotency fails before mutation-capable work',
        'hash-only route evidence',
      ]),
      scopeHash: sha256Hex(receipt.evidenceScope),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: receipt.ok === true
        ? 'production-backed mutation-capable idempotency key proof required before release movement'
        : 'mutation-capable idempotency key proof is incomplete',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed mutation-capable idempotency-key proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function collectMutationCapableRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (
    value.proofClass === 'focused-idempotency-key-requirement-v4'
    && value.routeProfileHash === routeProfileHash
    && Array.isArray(value.mutationCapableRoutes)
  ) {
    blocks.push(value);
  }
  for (const child of Object.values(value)) {
    collectMutationCapableRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
}

function summarizeNegativeIdempotencyEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0575',
    proofClass: 'focused-idempotency-key-requirement-v4-negative',
    evidenceScopeHash: sha256Hex('local-executor-auth-support'),
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
    routeProof: {
      methodHash: evidence.methodHash,
      routeAliasHash: evidence.routeAliasHash,
      routePathHash: evidence.routePathHash,
      proofHash: digest({
        methodHash: evidence.methodHash,
        routeAliasHash: evidence.routeAliasHash,
        routePathHash: evidence.routePathHash,
        status: response.status,
        code: response.body?.code || null,
      }),
    },
    negativeIdempotency: {
      status: response.status,
      code: response.body?.code || null,
      idempotencyEvidencePresent: evidence.idempotencyEvidencePresent === true,
      idempotencyEvidenceMalformed: evidence.idempotencyEvidenceMalformed === true,
      payloadWouldFailIfParsed: true,
      jsonParsed: evidence.jsonParsed === true,
      applyWorkStarted: evidence.applyWorkAttempted === true,
      recoveryMutationWorkStarted: evidence.recoveryMutationWorkAttempted === true,
      mutationCapableWorkStarted: evidence.applyWorkAttempted === true
        || evidence.recoveryMutationWorkAttempted === true,
      mutationAttempted: evidence.mutationAttempted === true,
      mutationEvidence: hasMutationCapableWorkEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'negative mutation-capable idempotency proof cannot move release gates',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed mutation-capable idempotency-key proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasMutationCapableWorkEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.authorization
    || body.mutationCapableAuthorization
    || body.apply
    || body.recoveryMutation
    || body.dbJournal
    || body.signedRequest
    || body.receipt
  );
}

async function requestMalformedMutationCapableRoute(route, pathname, headers) {
  const response = await route.fetchHandler(new URL(pathname, sourceUrl), {
    method: 'POST',
    headers,
    body: malformedJsonBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function validRouteEvidenceFixture() {
  const routes = [
    {
      routeAliasHash: sha256Hex('apply'),
      routePathHash: sha256Hex(applyEndpointPath),
    },
    {
      routeAliasHash: sha256Hex('recovery-mutate'),
      routePathHash: sha256Hex(recoveryMutateEndpointPath),
    },
  ].map((route, index) => ({
    ...route,
    methodHash: sha256Hex('POST'),
    mutationCapable: true,
    signed: true,
    sessionBound: true,
    sessionHash: fixtureHash(`session-${index}`),
    idempotencyRequired: true,
    idempotencyEvidencePresent: true,
    idempotencyKeyHash: fixtureHash(`idempotency-${index}`),
    requestHash: fixtureHash(`request-${index}`),
    canonicalHash: fixtureHash(`canonical-${index}`),
    signedHeaderHash: fixtureHash(`signed-headers-${index}`),
    jsonParsed: false,
    mutationCapableWorkStarted: false,
    mutationAttempted: false,
  }));

  return {
    schemaVersion: 1,
    proofClass: 'focused-idempotency-key-requirement-v4',
    routeProfileHash,
    routeCount: routes.length,
    mutationCapableContractOk: true,
    mutationCapableRoutes: routes,
    proofHash: digest(routes),
  };
}

function validRejectionEvidenceFixture() {
  const cases = [
    ['apply-missing', 'apply', 'MUTATION_IDEMPOTENCY_KEY_REQUIRED'],
    ['apply-malformed', 'apply', 'MUTATION_IDEMPOTENCY_KEY_MALFORMED'],
    ['recovery-missing', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_REQUIRED'],
    ['recovery-malformed', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_MALFORMED'],
  ].map(([id, routeAlias, code], index) => ({
    idHash: sha256Hex(id),
    routeAliasHash: sha256Hex(routeAlias),
    methodHash: sha256Hex('POST'),
    rejectedBeforeTransport: true,
    rejectedBeforeJsonParse: true,
    mutationCapableWorkStarted: false,
    rawValueIncluded: false,
    code,
    errorHash: fixtureHash(`error-${index}`),
    sessionHash: fixtureHash(`negative-session-${index}`),
    idempotencyKeyHash: code.endsWith('MALFORMED') ? fixtureHash(`negative-idempotency-${index}`) : null,
  }));

  return {
    ok: true,
    cases,
    proofHash: digest(cases),
  };
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
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `support evidence leaked raw value ${rawValue}`,
    );
  }
}

function assertNoMutationCapableBoundaryWork(state) {
  assert.equal(state.jsonParseAttempts, 0);
  assert.equal(state.applyWorkAttempts, 0);
  assert.equal(state.recoveryMutationWorkAttempts, 0);
  assert.equal(state.mutationSideEffects, 0);
}

test('RPP-0575 v4 verify:release carries one mutation-capable idempotency route proof', async () => {
  const originalFetch = global.fetch;
  const route = createLocalMutationCapableIdempotencyRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const apply = await client.signedPost('/apply', applyPayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const recovery = await client.signedPost('/recovery/mutate', recoveryPayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: recoverySignedNonce,
    });
    const routeEvidence = buildMutationCapableRouteEvidence([apply, recovery]);
    const rejectionEvidence = buildClientRejectionEvidence(client);
    const receipt = buildIdempotencyRequirementReceipt({ routeEvidence, rejectionEvidence });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectMutationCapableRouteEvidenceBlocks(verifyReleaseSummary);

    assert.equal(apply.status, 202);
    assert.equal(recovery.status, 202);
    assert.equal(route.state.authorizationAccepted, 2);
    assert.deepEqual(
      route.state.requests.map((entry) => entry.routeAliasHash),
      [sha256Hex('apply'), sha256Hex('recovery-mutate')],
    );
    assertNoMutationCapableBoundaryWork(route.state);

    assert.equal(routeEvidence.mutationCapableContractOk, true);
    assert.equal(routeEvidence.routeCount, 2);
    assert.equal(routeEvidenceHasRequiredIdempotency(routeEvidence), true);
    assert.deepEqual(
      routeEvidence.mutationCapableRoutes.map((entry) => entry.idempotencyEvidencePresent),
      [true, true],
    );
    for (const entry of routeEvidence.mutationCapableRoutes) {
      assert.equal(entry.mutationCapable, true);
      assert.equal(entry.idempotencyRequired, true);
      assert.equal(entry.sessionBound, true);
      assert.equal(entry.jsonParsed, false);
      assert.equal(entry.mutationCapableWorkStarted, false);
      assert.equal(entry.mutationAttempted, false);
      assertHashOnlyFields(entry, [
        'routeAliasHash',
        'methodHash',
        'routePathHash',
        'sessionHash',
        'idempotencyKeyHash',
        'requestHash',
        'canonicalHash',
        'signedHeaderHash',
      ]);
    }

    assert.equal(rejectionEvidence.ok, true);
    assert.equal(rejectionEvidenceHasRequiredFailures(rejectionEvidence), true);
    assert.deepEqual(
      rejectionEvidence.cases.map((entry) => entry.code),
      [
        'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
        'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
        'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
        'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
      ],
    );

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assertHashOnlyFields(receipt.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(receipt.authSummary, ['credentialHash', 'userLoginHash', 'sessionIdHash']);
    assertHashOnlyFields(receipt.routeEvidence, ['proofHash']);
    assert.match(receipt.receiptHash, hashPattern);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.ok, true);
    assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.receiptHash, receipt.receiptHash);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(
      routeEvidenceBlocks[0],
      verifyReleaseSummary.productionIdempotencyKeyRequirement.routeEvidence,
    );
    assertHashOnlyFields(verifyReleaseSummary, ['commandHash', 'checkedCommandHash']);
    assertNoRawValues(verifyReleaseSummary, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      malformedIdempotencyKey,
      blankIdempotencyKey,
      signedNonce,
      recoverySignedNonce,
      malformedJsonBody,
      applyEndpointPath,
      recoveryMutateEndpointPath,
      JSON.stringify(applyPayload),
      JSON.stringify(recoveryPayload),
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0575 v4 missing or malformed idempotency evidence fails before parsing or work', async () => {
  const route = createLocalMutationCapableIdempotencyRoute();
  const negativeCases = [
    {
      name: 'apply-missing-idempotency-malformed-json',
      pathname: applyEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
      headers: withoutHeader(
        signedMutationCapableHeaders({
          pathname: applyEndpointPath,
          rawBody: malformedJsonBody,
          idempotency: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'apply-malformed-idempotency-malformed-json',
      pathname: applyEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
      headers: signedMutationCapableHeaders({
        pathname: applyEndpointPath,
        rawBody: malformedJsonBody,
        idempotency: malformedIdempotencyKey,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'recovery-missing-idempotency-malformed-json',
      pathname: recoveryMutateEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
      headers: withoutHeader(
        signedMutationCapableHeaders({
          pathname: recoveryMutateEndpointPath,
          rawBody: malformedJsonBody,
          idempotency: '',
          nonce: recoverySignedNonce,
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'recovery-malformed-idempotency-malformed-json',
      pathname: recoveryMutateEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
      headers: signedMutationCapableHeaders({
        pathname: recoveryMutateEndpointPath,
        rawBody: malformedJsonBody,
        idempotency: malformedIdempotencyKey,
        nonce: recoverySignedNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestMalformedMutationCapableRoute(
      route,
      negativeCase.pathname,
      negativeCase.headers,
    );
    const summary = summarizeNegativeIdempotencyEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasMutationCapableWorkEvidence(result), false, `${negativeCase.name} emitted mutation evidence`);
    assert.equal(summary.negativeIdempotency.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeIdempotency.jsonParsed, false);
    assert.equal(summary.negativeIdempotency.applyWorkStarted, false);
    assert.equal(summary.negativeIdempotency.recoveryMutationWorkStarted, false);
    assert.equal(summary.negativeIdempotency.mutationCapableWorkStarted, false);
    assert.equal(summary.negativeIdempotency.mutationAttempted, false);
    assert.equal(summary.negativeIdempotency.mutationEvidence, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeProof, [
      'methodHash',
      'routeAliasHash',
      'routePathHash',
      'proofHash',
    ]);
    assertHashOnlyFields(summary.negativeIdempotency, ['bodyHash']);
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
    }, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      malformedIdempotencyKey,
      blankIdempotencyKey,
      signedNonce,
      recoverySignedNonce,
      malformedJsonBody,
      applyEndpointPath,
      recoveryMutateEndpointPath,
    ]);
  }

  assert.equal(route.state.authorizationAccepted, 0);
  assertNoMutationCapableBoundaryWork(route.state);
});

test('RPP-0575 v4 rejects missing or malformed idempotency route evidence in one summary', () => {
  const rejectionEvidence = validRejectionEvidenceFixture();
  const missingRouteEvidence = validRouteEvidenceFixture();
  missingRouteEvidence.mutationCapableRoutes[0] = {
    ...missingRouteEvidence.mutationCapableRoutes[0],
    idempotencyEvidencePresent: false,
    idempotencyKeyHash: null,
  };
  missingRouteEvidence.mutationCapableContractOk = true;
  missingRouteEvidence.proofHash = digest(missingRouteEvidence.mutationCapableRoutes);

  const malformedRouteEvidence = validRouteEvidenceFixture();
  malformedRouteEvidence.mutationCapableRoutes[1] = {
    ...malformedRouteEvidence.mutationCapableRoutes[1],
    idempotencyKeyHash: 'not-a-sha256-hash',
  };
  malformedRouteEvidence.mutationCapableContractOk = true;
  malformedRouteEvidence.proofHash = digest(malformedRouteEvidence.mutationCapableRoutes);

  const missingReceipt = buildIdempotencyRequirementReceipt({
    routeEvidence: missingRouteEvidence,
    rejectionEvidence,
  });
  const malformedReceipt = buildIdempotencyRequirementReceipt({
    routeEvidence: malformedRouteEvidence,
    rejectionEvidence,
  });
  const missingSummary = buildVerifyReleaseStyleSummary(missingReceipt);
  const malformedSummary = buildVerifyReleaseStyleSummary(malformedReceipt);

  assert.equal(rejectionEvidenceHasRequiredFailures(rejectionEvidence), true);
  assert.equal(routeEvidenceHasRequiredIdempotency(missingRouteEvidence), false);
  assert.equal(routeEvidenceHasRequiredIdempotency(malformedRouteEvidence), false);

  for (const summary of [missingSummary, malformedSummary]) {
    const routeEvidenceBlocks = collectMutationCapableRouteEvidenceBlocks(summary);
    assert.equal(summary.ok, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.productionIdempotencyKeyRequirement.ok, false);
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.boundary.verdict, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
    assert.equal(
      summary.statusMarker,
      '[verify-release:held exit=1 reason=IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE mutationAttempted=false]',
    );
    assert.equal(routeEvidenceBlocks.length, 1);
    assertHashOnlyFields(summary, ['commandHash', 'checkedCommandHash']);
  }

  assert.equal(missingReceipt.ok, false);
  assert.equal(missingReceipt.status, 'blocked');
  assert.equal(missingReceipt.code, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
  assert.equal(malformedReceipt.ok, false);
  assert.equal(malformedReceipt.status, 'blocked');
  assert.equal(malformedReceipt.code, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
  assertNoRawValues({
    missingSummary,
    malformedSummary,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    malformedIdempotencyKey,
    blankIdempotencyKey,
    signedNonce,
    recoverySignedNonce,
    malformedJsonBody,
    applyEndpointPath,
    recoveryMutateEndpointPath,
  ]);
});
