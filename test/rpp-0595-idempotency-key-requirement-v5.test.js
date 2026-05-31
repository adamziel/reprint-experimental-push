import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/rpp-0595';
const routePrefix = '/wp-json/reprint/v1/push';
const applyEndpointPath = `${routePrefix}/apply`;
const recoveryMutateEndpointPath = `${routePrefix}/recovery/mutate`;
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0595_admin',
  password: 'rpp-0595-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0595_raw_session_id';
const idempotencyKey = 'idem-rpp-0595-raw-idempotency-key-v5';
const duplicatedIdempotencyKey = 'idem-rpp-0595-duplicate-idempotency-key-v5';
const driftedIdempotencyKey = 'idem-rpp-0595-drifted-idempotency-key-v5';
const malformedIdempotencyKey = 'idem rpp 0595 malformed';
const blankIdempotencyKey = '   ';
const signedTimestamp = '1780000000';
const staleSignedTimestamp = '1779999000';
const freshTimestampFloor = 1779999700;
const signedNonce = 'rpp0595acceptednonce';
const recoverySignedNonce = 'rpp0595recoverynonce';
const staleSignedNonce = 'rpp0595stalenonce';
const duplicateSignedNonce = 'rpp0595duplicatenonce';
const driftedSignedNonce = 'rpp0595driftednonce';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const hashPattern = /^[a-f0-9]{64}$/;
const routeProfileHash = sha256Hex('production-shaped');
const applyPayload = {
  plan: {
    id: 'plan-rpp-0595-apply',
    mutations: [{ resourceKey: 'private-apply-resource', action: 'update' }],
  },
  receipt: { receiptHash: sha256Hex('rpp-0595-apply-receipt') },
};
const recoveryPayload = {
  plan: {
    id: 'plan-rpp-0595-recovery',
    mutations: [{ resourceKey: 'private-recovery-resource', action: 'repair' }],
  },
  receipt: { receiptHash: sha256Hex('rpp-0595-recovery-receipt') },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0595:${label}`);
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
    receiptWorkAttempts: 0,
    applyWorkAttempts: 0,
    recoveryMutationWorkAttempts: 0,
    mutationSideEffects: 0,
    releaseMovementAttempts: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const pathname = requestUrl.pathname;
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const idempotencyValue = headers['x-reprint-push-idempotency-key'];
    state.requests.push({
      methodHash: sha256Hex(method),
      routeAliasHash: routeAliasHashForPath(pathname),
      routePathHash: sha256Hex(pathname),
      bodyHash: sha256Hex(rawBody),
      idempotencyEvidencePresent: idempotencyValue !== undefined && idempotencyValue !== '',
      idempotencyEvidenceDuplicated: hasDuplicatedIdempotencyEvidence(idempotencyValue),
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

  const idempotencyValue = headers['x-reprint-push-idempotency-key'];
  if (idempotencyValue === undefined || idempotencyValue === '') {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_REQUIRED', status: 400 };
  }

  if (hasDuplicatedIdempotencyEvidence(idempotencyValue)) {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED', status: 400 };
  }

  if (!isValidIdempotencyEvidence(idempotencyValue)) {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_MALFORMED', status: 400 };
  }

  if (!/^[a-f0-9]{64}$/.test(headers['x-auth-content-hash'])) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_INVALID', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  if (!isFreshSignedTimestamp(headers['x-auth-timestamp'])) {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_STALE', status: 401 };
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
    idempotencyKey: idempotencyValue,
  });
  const pushSignature = hmacHex(signingKey, canonical);
  if (headers['x-reprint-push-signature'] !== pushSignature) {
    return { ok: false, code: 'MUTATION_IDEMPOTENCY_KEY_DRIFTED', status: 401 };
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
      idempotencyKeyHash: sha256Hex(idempotencyValue),
      contentHash,
      timestampHash: sha256Hex(headers['x-auth-timestamp']),
      nonceHash: sha256Hex(headers['x-auth-nonce']),
      canonicalHash: sha256Hex(canonical),
      authSignatureHash: sha256Hex(authSignature),
      pushSignatureHash: sha256Hex(pushSignature),
    },
  };
}

function hasDuplicatedIdempotencyEvidence(value) {
  return typeof value === 'string' && value.split(',').length > 1;
}

function isValidIdempotencyEvidence(value) {
  return typeof value === 'string'
    && value.trim() === value
    && /^\S{8,160}$/.test(value);
}

function isFreshSignedTimestamp(value) {
  const timestamp = Number(value);
  return Number.isInteger(timestamp) && timestamp >= freshTimestampFloor;
}

function authFailureBody({ code, pathname, headers, rawBody }) {
  const idempotencyValue = headers['x-reprint-push-idempotency-key'];
  return {
    ok: false,
    code,
    modeHash: sha256Hex('mutation-capable-idempotency-check-v5'),
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
      pushSignatureHeaderHash: headers['x-reprint-push-signature']
        ? sha256Hex(headers['x-reprint-push-signature'])
        : null,
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: idempotencyValue ? sha256Hex(idempotencyValue) : null,
      idempotencyEvidencePresent: idempotencyValue !== undefined && idempotencyValue !== '',
      idempotencyEvidenceMalformed: code === 'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
      idempotencyEvidenceDuplicated: code === 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
      idempotencyEvidenceStale: code === 'MUTATION_IDEMPOTENCY_KEY_STALE',
      idempotencyEvidenceDrifted: code === 'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
      jsonParsed: false,
      receiptWorkAttempted: false,
      applyWorkAttempted: false,
      recoveryMutationWorkAttempted: false,
      releaseMovementAttempted: false,
      mutationAttempted: false,
    },
  };
}

function acceptedAuthorizationOnlyBody({ pathname, rawBody, auth }) {
  return {
    ok: true,
    code: 'MUTATION_CAPABLE_IDEMPOTENCY_AUTHORIZED_V5_SUPPORT_ONLY',
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
    idempotencyRouteGuard: {
      authorizationOnly: true,
      idempotencyRequired: true,
      idempotencyEvidencePresent: true,
      idempotencyEvidenceMalformed: false,
      idempotencyEvidenceDuplicated: false,
      idempotencyEvidenceStale: false,
      idempotencyEvidenceDrifted: false,
      idempotencyFresh: true,
      idempotencySignatureBound: true,
      jsonParsed: false,
      receiptWorkStarted: false,
      applyWorkStarted: false,
      recoveryMutationWorkStarted: false,
      releaseMovementStarted: false,
      mutationAttempted: false,
      proofHash: digest({
        routeAliasHash: routeAliasHashForPath(pathname),
        idempotencyRequired: true,
        idempotencyEvidencePresent: true,
        idempotencyFresh: true,
        idempotencySignatureBound: true,
        jsonParsed: false,
        receiptWorkStarted: false,
        applyWorkStarted: false,
        recoveryMutationWorkStarted: false,
        releaseMovementStarted: false,
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
    const guard = body.idempotencyRouteGuard || {};
    return {
      routeAliasHash: routeProfile.routeAliasHash || authorization.routeAliasHash || null,
      methodHash: authorization.methodHash || sha256Hex(response.request?.method || ''),
      routePathHash: routeProfile.routePathHash || authorization.routePathHash || null,
      mutationCapable: true,
      signed: true,
      sessionBound: Boolean(authorization.sessionIdHash),
      sessionHash: authorization.sessionIdHash || null,
      idempotencyRequired: guard.idempotencyRequired === true,
      idempotencyEvidencePresent: guard.idempotencyEvidencePresent === true,
      idempotencyEvidenceMalformed: guard.idempotencyEvidenceMalformed === true,
      idempotencyEvidenceDuplicated: guard.idempotencyEvidenceDuplicated === true,
      idempotencyEvidenceStale: guard.idempotencyEvidenceStale === true,
      idempotencyEvidenceDrifted: guard.idempotencyEvidenceDrifted === true,
      idempotencyFresh: guard.idempotencyFresh === true,
      idempotencySignatureBound: guard.idempotencySignatureBound === true,
      idempotencyKeyHash: authorization.idempotencyKeyHash || null,
      requestHash: authorization.contentHash || null,
      canonicalHash: authorization.canonicalHash || null,
      signedHeaderHash: digest({
        authSignatureHash: authorization.authSignatureHash || null,
        pushSignatureHash: authorization.pushSignatureHash || null,
      }),
      jsonParsed: guard.jsonParsed === true,
      receiptWorkStarted: guard.receiptWorkStarted === true,
      mutationCapableWorkStarted: guard.applyWorkStarted === true
        || guard.recoveryMutationWorkStarted === true,
      releaseMovementStarted: guard.releaseMovementStarted === true,
      mutationAttempted: guard.mutationAttempted === true,
    };
  });

  return {
    schemaVersion: 1,
    proofClass: 'focused-idempotency-key-requirement-v5',
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
      && route.idempotencyEvidenceMalformed === false
      && route.idempotencyEvidenceDuplicated === false
      && route.idempotencyEvidenceStale === false
      && route.idempotencyEvidenceDrifted === false
      && route.idempotencyFresh === true
      && route.idempotencySignatureBound === true
      && route.jsonParsed === false
      && route.receiptWorkStarted === false
      && route.mutationCapableWorkStarted === false
      && route.releaseMovementStarted === false
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

function buildIdempotencyRequirementReceipt({
  routeEvidence,
  rejectionEvidence,
  source = sourceUrl,
  capturedAtHash = sha256Hex('2026-05-31T15:00:00Z'),
}) {
  const routeEvidenceOk = routeEvidenceHasRequiredIdempotency(routeEvidence);
  const rejectionEvidenceOk = rejectionEvidenceHasRequiredFailures(rejectionEvidence);
  const contractOk = routeEvidenceOk && rejectionEvidenceOk;
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0595',
    proofClass: 'focused-idempotency-key-requirement-v5',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok: contractOk,
    status: contractOk ? 'support_only' : 'blocked',
    code: contractOk
      ? 'LOCAL_MUTATION_CAPABLE_IDEMPOTENCY_KEY_REQUIREMENT_V5_SUPPORT_ONLY'
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
  return routeEvidence?.proofClass === 'focused-idempotency-key-requirement-v5'
    && routeEvidence.routeProfileHash === routeProfileHash
    && routeEvidence.routeCount === 2
    && routeEvidence.mutationCapableContractOk === true
    && hashPattern.test(routeEvidence.proofHash)
    && Array.isArray(routeEvidence.mutationCapableRoutes)
    && routeEvidenceRoutesAreComplete(routeEvidence.mutationCapableRoutes);
}

function rejectionEvidenceHasRequiredFailures(rejectionEvidence) {
  const requiredCodes = [
    'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
    'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
    'MUTATION_IDEMPOTENCY_KEY_STALE',
    'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
    'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
  ];

  return rejectionEvidence?.ok === true
    && hashPattern.test(rejectionEvidence.proofHash)
    && Array.isArray(rejectionEvidence.cases)
    && rejectionEvidence.cases.length === requiredCodes.length * 2
    && requiredCodes.every((code) => (
      rejectionEvidence.cases.filter((entry) => entry.code === code).length === 2
    ))
    && rejectionEvidence.cases.every((entry) => (
      entry.rejectedBeforeJsonParse === true
      && entry.receiptWorkStarted === false
      && entry.mutationCapableWorkStarted === false
      && entry.releaseMovementStarted === false
      && entry.mutationAttempted === false
      && entry.rawValueIncluded === false
      && hashFieldsAreValid(entry, [
        'idHash',
        'routeAliasHash',
        'methodHash',
        'bodyHash',
        'failureClassHash',
        'caseHash',
      ])
      && (entry.sessionHash === null || hashPattern.test(entry.sessionHash))
      && (entry.idempotencyKeyHash === null || hashPattern.test(entry.idempotencyKeyHash))
      && (entry.timestampHash === null || hashPattern.test(entry.timestampHash))
      && (entry.pushSignatureHeaderHash === null || hashPattern.test(entry.pushSignatureHeaderHash))
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
        'malformed idempotency fails before JSON parsing',
        'stale idempotency fails before receipt work',
        'duplicated idempotency fails before mutation-capable work',
        'drifted idempotency fails before release movement',
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
    value.proofClass === 'focused-idempotency-key-requirement-v5'
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

function summarizeNegativeIdempotencyEvidence({ id, response }) {
  const evidence = response.body?.evidence || {};
  return {
    idHash: sha256Hex(id),
    routeAliasHash: evidence.routeAliasHash,
    methodHash: evidence.methodHash,
    status: response.status,
    code: response.body?.code || null,
    failureClassHash: sha256Hex(response.body?.code || 'UNKNOWN'),
    rejectedBeforeJsonParse: evidence.jsonParsed === false,
    receiptWorkStarted: evidence.receiptWorkAttempted === true,
    mutationCapableWorkStarted: evidence.applyWorkAttempted === true
      || evidence.recoveryMutationWorkAttempted === true,
    releaseMovementStarted: evidence.releaseMovementAttempted === true,
    mutationAttempted: evidence.mutationAttempted === true,
    rawValueIncluded: false,
    sourceUrlHash: evidence.sourceUrlHash,
    bodyHash: evidence.bodyHash,
    sessionHash: evidence.sessionIdHash,
    idempotencyKeyHash: evidence.idempotencyKeyHash,
    timestampHash: evidence.timestampHash,
    pushSignatureHeaderHash: evidence.pushSignatureHeaderHash,
    idempotencyEvidencePresent: evidence.idempotencyEvidencePresent === true,
    idempotencyEvidenceMalformed: evidence.idempotencyEvidenceMalformed === true,
    idempotencyEvidenceDuplicated: evidence.idempotencyEvidenceDuplicated === true,
    idempotencyEvidenceStale: evidence.idempotencyEvidenceStale === true,
    idempotencyEvidenceDrifted: evidence.idempotencyEvidenceDrifted === true,
    caseHash: digest({
      idHash: sha256Hex(id),
      routeAliasHash: evidence.routeAliasHash,
      status: response.status,
      code: response.body?.code || null,
      bodyHash: evidence.bodyHash,
    }),
  };
}

function summarizeNegativeRouteResponse(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0595',
    proofClass: 'focused-idempotency-key-requirement-v5-negative',
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
      pushSignatureHeaderHash: evidence.pushSignatureHeaderHash,
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
      idempotencyEvidenceDuplicated: evidence.idempotencyEvidenceDuplicated === true,
      idempotencyEvidenceStale: evidence.idempotencyEvidenceStale === true,
      idempotencyEvidenceDrifted: evidence.idempotencyEvidenceDrifted === true,
      payloadWouldFailIfParsed: true,
      jsonParsed: evidence.jsonParsed === true,
      receiptWorkStarted: evidence.receiptWorkAttempted === true,
      applyWorkStarted: evidence.applyWorkAttempted === true,
      recoveryMutationWorkStarted: evidence.recoveryMutationWorkAttempted === true,
      mutationCapableWorkStarted: evidence.applyWorkAttempted === true
        || evidence.recoveryMutationWorkAttempted === true,
      releaseMovementStarted: evidence.releaseMovementAttempted === true,
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
    || body.idempotencyRouteGuard
    || body.mutationCapableAuthorization
    || body.apply
    || body.recoveryMutation
    || body.dbJournal
    || body.signedRequest
    || body.receipt
    || body.releaseVerifier
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

function negativeIdempotencyCases() {
  return [
    {
      id: 'apply-missing-idempotency-key',
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
      id: 'recovery-missing-idempotency-key',
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
      id: 'apply-malformed-idempotency-key',
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
      id: 'recovery-malformed-idempotency-key',
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
    {
      id: 'apply-stale-idempotency-key',
      pathname: applyEndpointPath,
      expectedStatus: 401,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_STALE',
      headers: signedMutationCapableHeaders({
        pathname: applyEndpointPath,
        rawBody: malformedJsonBody,
        timestamp: staleSignedTimestamp,
        nonce: staleSignedNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      id: 'recovery-stale-idempotency-key',
      pathname: recoveryMutateEndpointPath,
      expectedStatus: 401,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_STALE',
      headers: signedMutationCapableHeaders({
        pathname: recoveryMutateEndpointPath,
        rawBody: malformedJsonBody,
        timestamp: staleSignedTimestamp,
        nonce: staleSignedNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      id: 'apply-duplicated-idempotency-key',
      pathname: applyEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
      headers: signedMutationCapableHeaders({
        pathname: applyEndpointPath,
        rawBody: malformedJsonBody,
        idempotency: `${idempotencyKey}, ${duplicatedIdempotencyKey}`,
        nonce: duplicateSignedNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      id: 'recovery-duplicated-idempotency-key',
      pathname: recoveryMutateEndpointPath,
      expectedStatus: 400,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
      headers: signedMutationCapableHeaders({
        pathname: recoveryMutateEndpointPath,
        rawBody: malformedJsonBody,
        idempotency: `${idempotencyKey}, ${duplicatedIdempotencyKey}`,
        nonce: duplicateSignedNonce,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      id: 'apply-drifted-idempotency-key',
      pathname: applyEndpointPath,
      expectedStatus: 401,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
      headers: driftedIdempotencyHeaders({
        pathname: applyEndpointPath,
        rawBody: malformedJsonBody,
      }),
    },
    {
      id: 'recovery-drifted-idempotency-key',
      pathname: recoveryMutateEndpointPath,
      expectedStatus: 401,
      expectedCode: 'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
      headers: driftedIdempotencyHeaders({
        pathname: recoveryMutateEndpointPath,
        rawBody: malformedJsonBody,
      }),
    },
  ];
}

function driftedIdempotencyHeaders({ pathname, rawBody }) {
  return {
    ...signedMutationCapableHeaders({
      pathname,
      rawBody,
      idempotency: idempotencyKey,
      nonce: driftedSignedNonce,
      contentType: malformedJsonBodyContentType,
    }),
    'X-Reprint-Push-Idempotency-Key': driftedIdempotencyKey,
  };
}

async function buildRouteRejectionEvidence(route) {
  const cases = [];
  for (const negativeCase of negativeIdempotencyCases()) {
    const response = await requestMalformedMutationCapableRoute(
      route,
      negativeCase.pathname,
      negativeCase.headers,
    );
    assert.equal(response.status, negativeCase.expectedStatus, `${negativeCase.id} status`);
    assert.equal(response.body.code, negativeCase.expectedCode, negativeCase.id);
    cases.push(summarizeNegativeIdempotencyEvidence({
      id: negativeCase.id,
      response,
    }));
  }

  return {
    ok: cases.length === 10
      && cases.every((entry) => (
        entry.rejectedBeforeJsonParse === true
        && entry.receiptWorkStarted === false
        && entry.mutationCapableWorkStarted === false
        && entry.releaseMovementStarted === false
        && entry.mutationAttempted === false
      )),
    cases,
    proofHash: digest(cases),
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
    idempotencyEvidenceMalformed: false,
    idempotencyEvidenceDuplicated: false,
    idempotencyEvidenceStale: false,
    idempotencyEvidenceDrifted: false,
    idempotencyFresh: true,
    idempotencySignatureBound: true,
    idempotencyKeyHash: fixtureHash(`idempotency-${index}`),
    requestHash: fixtureHash(`request-${index}`),
    canonicalHash: fixtureHash(`canonical-${index}`),
    signedHeaderHash: fixtureHash(`signed-headers-${index}`),
    jsonParsed: false,
    receiptWorkStarted: false,
    mutationCapableWorkStarted: false,
    releaseMovementStarted: false,
    mutationAttempted: false,
  }));

  return {
    schemaVersion: 1,
    proofClass: 'focused-idempotency-key-requirement-v5',
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
    ['recovery-missing', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_REQUIRED'],
    ['apply-malformed', 'apply', 'MUTATION_IDEMPOTENCY_KEY_MALFORMED'],
    ['recovery-malformed', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_MALFORMED'],
    ['apply-stale', 'apply', 'MUTATION_IDEMPOTENCY_KEY_STALE'],
    ['recovery-stale', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_STALE'],
    ['apply-duplicated', 'apply', 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED'],
    ['recovery-duplicated', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED'],
    ['apply-drifted', 'apply', 'MUTATION_IDEMPOTENCY_KEY_DRIFTED'],
    ['recovery-drifted', 'recovery-mutate', 'MUTATION_IDEMPOTENCY_KEY_DRIFTED'],
  ].map(([id, routeAlias, code], index) => ({
    idHash: sha256Hex(id),
    routeAliasHash: sha256Hex(routeAlias),
    methodHash: sha256Hex('POST'),
    status: code === 'MUTATION_IDEMPOTENCY_KEY_REQUIRED'
      || code === 'MUTATION_IDEMPOTENCY_KEY_MALFORMED'
      || code === 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED'
      ? 400
      : 401,
    code,
    failureClassHash: sha256Hex(code),
    rejectedBeforeJsonParse: true,
    receiptWorkStarted: false,
    mutationCapableWorkStarted: false,
    releaseMovementStarted: false,
    mutationAttempted: false,
    rawValueIncluded: false,
    sourceUrlHash: fixtureHash(`source-${index}`),
    bodyHash: fixtureHash(`body-${index}`),
    sessionHash: fixtureHash(`negative-session-${index}`),
    idempotencyKeyHash: code === 'MUTATION_IDEMPOTENCY_KEY_REQUIRED'
      ? null
      : fixtureHash(`negative-idempotency-${index}`),
    timestampHash: fixtureHash(`timestamp-${index}`),
    pushSignatureHeaderHash: fixtureHash(`push-signature-${index}`),
    idempotencyEvidencePresent: code !== 'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
    idempotencyEvidenceMalformed: code === 'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
    idempotencyEvidenceDuplicated: code === 'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
    idempotencyEvidenceStale: code === 'MUTATION_IDEMPOTENCY_KEY_STALE',
    idempotencyEvidenceDrifted: code === 'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
    caseHash: fixtureHash(`case-${index}`),
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
  assert.equal(state.receiptWorkAttempts, 0);
  assert.equal(state.applyWorkAttempts, 0);
  assert.equal(state.recoveryMutationWorkAttempts, 0);
  assert.equal(state.mutationSideEffects, 0);
  assert.equal(state.releaseMovementAttempts, 0);
}

test('RPP-0595 v5 verify:release carries one idempotency route evidence summary', async () => {
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
    const rejectionEvidence = await buildRouteRejectionEvidence(route);
    const receipt = buildIdempotencyRequirementReceipt({ routeEvidence, rejectionEvidence });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectMutationCapableRouteEvidenceBlocks(verifyReleaseSummary);

    assert.equal(apply.status, 202);
    assert.equal(recovery.status, 202);
    assert.equal(route.state.authorizationAccepted, 2);
    assert.deepEqual(
      route.state.requests.slice(0, 2).map((entry) => entry.routeAliasHash),
      [sha256Hex('apply'), sha256Hex('recovery-mutate')],
    );
    assertNoMutationCapableBoundaryWork(route.state);

    assert.equal(routeEvidence.mutationCapableContractOk, true);
    assert.equal(routeEvidence.routeCount, 2);
    assert.equal(routeEvidenceHasRequiredIdempotency(routeEvidence), true);
    for (const entry of routeEvidence.mutationCapableRoutes) {
      assert.equal(entry.mutationCapable, true);
      assert.equal(entry.idempotencyRequired, true);
      assert.equal(entry.idempotencyEvidencePresent, true);
      assert.equal(entry.idempotencyEvidenceMalformed, false);
      assert.equal(entry.idempotencyEvidenceDuplicated, false);
      assert.equal(entry.idempotencyEvidenceStale, false);
      assert.equal(entry.idempotencyEvidenceDrifted, false);
      assert.equal(entry.idempotencyFresh, true);
      assert.equal(entry.idempotencySignatureBound, true);
      assert.equal(entry.sessionBound, true);
      assert.equal(entry.jsonParsed, false);
      assert.equal(entry.receiptWorkStarted, false);
      assert.equal(entry.mutationCapableWorkStarted, false);
      assert.equal(entry.releaseMovementStarted, false);
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
      [...new Set(rejectionEvidence.cases.map((entry) => entry.code))],
      [
        'MUTATION_IDEMPOTENCY_KEY_REQUIRED',
        'MUTATION_IDEMPOTENCY_KEY_MALFORMED',
        'MUTATION_IDEMPOTENCY_KEY_STALE',
        'MUTATION_IDEMPOTENCY_KEY_DUPLICATED',
        'MUTATION_IDEMPOTENCY_KEY_DRIFTED',
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
    assertNoRawValues(verifyReleaseSummary, rawSensitiveFixtureValues());
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0595 v5 rejects bad idempotency evidence before parser receipt or mutation work', async () => {
  const route = createLocalMutationCapableIdempotencyRoute();

  for (const negativeCase of negativeIdempotencyCases()) {
    const result = await requestMalformedMutationCapableRoute(
      route,
      negativeCase.pathname,
      negativeCase.headers,
    );
    const summary = summarizeNegativeRouteResponse(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.id} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.id);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.id} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.id} parsed REST JSON`);
    assert.equal(hasMutationCapableWorkEvidence(result), false, `${negativeCase.id} emitted mutation evidence`);
    assert.equal(summary.negativeIdempotency.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeIdempotency.jsonParsed, false);
    assert.equal(summary.negativeIdempotency.receiptWorkStarted, false);
    assert.equal(summary.negativeIdempotency.applyWorkStarted, false);
    assert.equal(summary.negativeIdempotency.recoveryMutationWorkStarted, false);
    assert.equal(summary.negativeIdempotency.mutationCapableWorkStarted, false);
    assert.equal(summary.negativeIdempotency.releaseMovementStarted, false);
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
      'pushSignatureHeaderHash',
    ]);
    assertNoRawValues({
      response: result.body,
      summary,
    }, rawSensitiveFixtureValues());
  }

  assert.equal(route.state.authorizationAccepted, 0);
  assertNoMutationCapableBoundaryWork(route.state);
});

test('RPP-0595 v5 blocks release movement for missing stale duplicated or drifted route evidence', () => {
  const rejectionEvidence = validRejectionEvidenceFixture();
  const driftCases = [
    {
      name: 'missing-idempotency-evidence',
      mutate(route) {
        route.idempotencyEvidencePresent = false;
        route.idempotencyKeyHash = null;
      },
    },
    {
      name: 'malformed-idempotency-hash',
      mutate(route) {
        route.idempotencyKeyHash = 'not-a-sha256-hash';
      },
    },
    {
      name: 'stale-idempotency-evidence',
      mutate(route) {
        route.idempotencyEvidenceStale = true;
        route.idempotencyFresh = false;
      },
    },
    {
      name: 'duplicated-idempotency-evidence',
      mutate(route) {
        route.idempotencyEvidenceDuplicated = true;
      },
    },
    {
      name: 'drifted-idempotency-evidence',
      mutate(route) {
        route.idempotencyEvidenceDrifted = true;
        route.idempotencySignatureBound = false;
      },
    },
  ];

  assert.equal(rejectionEvidenceHasRequiredFailures(rejectionEvidence), true);

  for (const driftCase of driftCases) {
    const routeEvidence = validRouteEvidenceFixture();
    driftCase.mutate(routeEvidence.mutationCapableRoutes[0]);
    routeEvidence.mutationCapableContractOk = true;
    routeEvidence.proofHash = digest(routeEvidence.mutationCapableRoutes);
    const receipt = buildIdempotencyRequirementReceipt({
      routeEvidence,
      rejectionEvidence,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectMutationCapableRouteEvidenceBlocks(verifyReleaseSummary);

    assert.equal(routeEvidenceHasRequiredIdempotency(routeEvidence), false, driftCase.name);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.code, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.ok, false);
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
    assert.equal(
      verifyReleaseSummary.statusMarker,
      '[verify-release:held exit=1 reason=IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE mutationAttempted=false]',
    );
    assert.equal(routeEvidenceBlocks.length, 1);
    assertHashOnlyFields(verifyReleaseSummary, ['commandHash', 'checkedCommandHash']);
    assertNoRawValues(verifyReleaseSummary, rawSensitiveFixtureValues());
  }
});

function rawSensitiveFixtureValues() {
  return [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    duplicatedIdempotencyKey,
    driftedIdempotencyKey,
    malformedIdempotencyKey,
    blankIdempotencyKey,
    signedNonce,
    recoverySignedNonce,
    staleSignedNonce,
    duplicateSignedNonce,
    driftedSignedNonce,
    malformedJsonBody,
    applyEndpointPath,
    recoveryMutateEndpointPath,
    JSON.stringify(applyPayload),
    JSON.stringify(recoveryPayload),
  ];
}
