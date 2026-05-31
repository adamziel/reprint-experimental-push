import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/snapshot-hashes`;
const routeName = '/push/snapshot-hashes';
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0582_admin',
  password: 'rpp-0582-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0582-wrong-application-password',
};
const sessionId = 'psh_rpp_0582_raw_session_id';
const invalidSessionId = 'psh_rpp_0582_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0582-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T12:45:00Z';
const freshExpiresAt = '2026-05-31T12:49:00Z';
const signedTimestamp = '1780002700';
const signedNonce = 'rpp0582acceptednonce';
const malformedJsonBody = '{"scope":';
const hashPattern = /^[a-f0-9]{64}$/;
const prefixedHashPattern = /^sha256:[a-f0-9]{64}$/;
const snapshotHashesPayload = {
  scope: {
    files: [],
    tables: [],
    plugins: true,
  },
  batch_size: 1000,
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

function signedSnapshotHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
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
    'content-type': 'application/json',
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function snapshotHashRouteBodies() {
  return [
    'reprint_push_lab_rest_authenticated_snapshot_hashes',
    'reprint_push_lab_rest_snapshot_hashes_response',
    'reprint_push_lab_rest_snapshot_hash_resources',
    'reprint_push_lab_rest_snapshot_hash_resource_entry',
    'reprint_push_lab_rest_snapshot_hashes_receipt',
  ].map(functionBody).join('\n');
}

function createRouteState() {
  return {
    requests: [],
    phaseLog: [],
    acceptedPhaseLog: [],
    authAttempts: 0,
    jsonParseAttempts: 0,
    snapshotHashWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };
}

function createLocalProductionSnapshotHashesRoute() {
  const state = createRouteState();

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({
      method,
      pathnameHash: sha256Hex(requestUrl.pathname),
      headerNameHash: sha256Hex(Object.keys(headers).sort().join('\n')),
      rawBodyHash: sha256Hex(rawBody),
    });
    state.phaseLog.push('request-received');

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleSnapshotHashesRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleSnapshotHashesRequest({ method, pathname, headers, rawBody, state }) {
  const caseStart = state.phaseLog.length - 1;
  state.phaseLog.push('auth-start');
  const authError = authenticateSnapshotHashesRequest({ method, pathname, headers, rawBody, state });
  if (authError) {
    state.phaseLog.push(`auth-reject:${authError}`);
    return jsonResponse(authFailureBody(authError, headers, rawBody), 401);
  }

  state.phaseLog.push('auth-accepted');
  state.jsonParseAttempts += 1;
  state.phaseLog.push('json-parse');
  const payload = JSON.parse(rawBody);
  state.snapshotHashWorkAttempts += 1;
  state.phaseLog.push('snapshot-hash-work');
  state.acceptedPhaseLog = state.phaseLog.slice(caseStart);

  return jsonResponse(snapshotHashesBody({ payload, rawBody, headers }));
}

function authenticateSnapshotHashesRequest({ method, pathname, headers, rawBody, state }) {
  state.authAttempts += 1;
  if (headers.authorization !== basicAuth()) {
    return 'reprint_push_lab_auth_required';
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return 'SIGNED_HEADER_REQUIRED';
  }

  if (!headers['x-reprint-push-session']) {
    return 'SIGNED_SESSION_REQUIRED';
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return 'SIGNED_CONTENT_HASH_MISMATCH';
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return 'SIGNED_AUTH_SIGNATURE_MISMATCH';
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return 'SIGNED_REQUEST_SIGNATURE_MISMATCH';
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return 'SIGNED_SESSION_INVALID';
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'snapshot-hashes',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      signedHeaderSetHash: sha256Hex(Object.keys(headers).filter((header) => header.startsWith('x-')).sort().join('\n')),
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      mutationAttempted: false,
    },
  };
}

function snapshotHashesBody({ payload, rawBody, headers }) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const signingKey = labSigningKey();
  const identityHash = digest({
    userLoginHash: sha256Hex(credential.username),
    userIdHash: sha256Hex('582'),
    capabilitiesHash: digest({ manage_options: true }),
  });
  const sessionHash = sha256Hex(session);
  const signingKeyHash = sha256Hex(signingKey);
  const idempotencyKeyHash = sha256Hex(key);
  const canonicalHash = sha256Hex(pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: key,
  }));
  const snapshotHash = `sha256:${digest({ payload, salt: 'rpp-0582-snapshot' })}`;
  const snapshotHashSetHash = `sha256:${digest({
    scope: payload.scope,
    resources: ['wp_option:home', 'wp_post:582'],
  })}`;
  const coverageHash = `sha256:${digest({
    scope: payload.scope,
    resourceCount: 2,
    route: routeName,
  })}`;
  const pageHash = `sha256:${sha256Hex('rpp-0582-page')}`;
  const receiptHash = `sha256:${digest({
    type: 'snapshot-hashes',
    snapshotHashSetHash,
    canonicalHash,
  })}`;

  return {
    ok: true,
    mode: 'snapshot-hashes',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    planningOnly: {
      readOnly: true,
      mutates: false,
    },
    snapshotHash,
    snapshotHashSetHash,
    coverage: {
      coverage_hash: coverageHash,
      resource_count: 2,
    },
    pageHash,
    resources: [
      {
        resourceKeyHash: sha256Hex('wp_option:home'),
        beforeHash: `sha256:${sha256Hex('remote-home')}`,
        afterHash: `sha256:${sha256Hex('local-home')}`,
      },
      {
        resourceKeyHash: sha256Hex('wp_post:582'),
        beforeHash: `sha256:${sha256Hex('remote-post')}`,
        afterHash: `sha256:${sha256Hex('local-post')}`,
      },
    ],
    authSummary: {
      identityHash,
      sessionHash,
      signingKeyHash,
      sessionExpiresAtHash: sha256Hex(freshExpiresAt),
      sessionType: 'production-auth-session',
      sessionStatus: 'active',
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
        idempotencyKeyHash,
      },
    },
    receipt: {
      type: 'snapshot-hashes',
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      route: routeName,
      receiptHash,
      snapshotHashSetHash,
      planningOnly: {
        readOnly: true,
        mutates: false,
      },
      authBinding: {
        identityHash,
        sessionHash,
        signingKeyHash,
      },
      request: {
        canonicalHash,
        idempotencyKeyHash,
      },
    },
  };
}

function snapshotHashesRouteProofCode(snapshotHashes, state) {
  if (!snapshotHashes) {
    return 'SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED';
  }

  const body = snapshotHashes.body || {};
  const receipt = body.receipt || {};
  const routeProfile = body.routeProfile || {};
  if (
    snapshotHashes.status !== 200
    || body.ok !== true
    || body.mode !== 'snapshot-hashes'
    || snapshotHashes.request?.method !== 'POST'
    || snapshotHashes.request?.pathname !== endpointPath
    || routeProfile.profile !== 'production-shaped'
    || routeProfile.restNamespace !== 'reprint/v1'
    || routeProfile.routePrefix !== '/push'
    || routeProfile.labBacked !== true
    || body.planningOnly?.readOnly !== true
    || body.planningOnly?.mutates !== false
    || !prefixedHashPattern.test(String(body.snapshotHash || ''))
    || !prefixedHashPattern.test(String(body.snapshotHashSetHash || ''))
    || !prefixedHashPattern.test(String(body.coverage?.coverage_hash || ''))
    || !prefixedHashPattern.test(String(body.pageHash || ''))
    || receipt.type !== 'snapshot-hashes'
    || receipt.route !== routeName
    || receipt.planningOnly?.readOnly !== true
    || receipt.planningOnly?.mutates !== false
    || state.mutationCapableWorkAttempts !== 0
  ) {
    return 'SNAPSHOT_HASH_ROUTE_PROOF_MALFORMED';
  }

  return 'LOCAL_SNAPSHOT_HASH_ROUTE_V5_SUPPORT_ONLY';
}

function buildSnapshotHashesRouteReceipt({
  snapshotHashes = null,
  state = createRouteState(),
  negativeAuthSummaries = [],
  capturedAt = proofCapturedAt,
} = {}) {
  const body = snapshotHashes?.body || {};
  const receipt = body.receipt || {};
  const routeProfile = body.routeProfile || {};
  const signedRequest = body.signedRequest || {};
  const requestMethod = snapshotHashes?.request?.method || null;
  const requestPath = snapshotHashes?.request?.pathname || null;
  const code = snapshotHashesRouteProofCode(snapshotHashes, state);
  const ok = code === 'LOCAL_SNAPSHOT_HASH_ROUTE_V5_SUPPORT_ONLY';
  const routeEvidence = {
    method: requestMethod,
    endpointPathHash: sha256Hex(endpointPath),
    requestPathHash: requestPath ? sha256Hex(requestPath) : null,
    routeHash: sha256Hex(routeName),
    routeProfileHash: routeProfile.profile ? sha256Hex(routeProfile.profile) : null,
    restNamespaceHash: routeProfile.restNamespace ? sha256Hex(routeProfile.restNamespace) : null,
    routePrefixHash: routeProfile.routePrefix ? sha256Hex(routeProfile.routePrefix) : null,
    labBacked: routeProfile.labBacked === true,
    signedPost: requestMethod === 'POST' && signedRequest.signed === true,
    authBeforePayloadHash: state.acceptedPhaseLog.length
      ? sha256Hex(state.acceptedPhaseLog.slice(0, 3).join('\n'))
      : null,
    proofHash: digest({
      method: requestMethod,
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: requestPath ? sha256Hex(requestPath) : null,
      routeHash: sha256Hex(routeName),
      status: snapshotHashes?.status ?? null,
      ok,
      modeHash: body.mode ? sha256Hex(body.mode) : null,
      capturedAtHash: sha256Hex(capturedAt),
    }),
  };
  const negativeAuth = summarizeNegativeAuthCarryThrough(negativeAuthSummaries);
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0582',
    proofClass: 'release-verifier-production-snapshot-hashes-route-v5',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAtHash: sha256Hex(capturedAt),
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(sourceUrl),
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      identityHash: receipt.authBinding?.identityHash || body.authSummary?.identityHash || null,
      sessionIdHash: receipt.authBinding?.sessionHash || body.authSummary?.sessionHash || null,
      sessionExpiresAtHash: body.authSummary?.sessionExpiresAtHash || null,
      signingKeyHashLength: String(receipt.authBinding?.signingKeyHash || '').length,
      idempotencyKeyHash: signedRequest.request?.idempotencyKeyHash
        || receipt.request?.idempotencyKeyHash
        || null,
      sessionTypeHash: body.authSummary?.sessionType ? sha256Hex(body.authSummary.sessionType) : null,
      sessionStatusHash: body.authSummary?.sessionStatus ? sha256Hex(body.authSummary.sessionStatus) : null,
    },
    routeEvidence,
    snapshotHashesSummary: {
      status: snapshotHashes?.status ?? null,
      ok: body.ok === true,
      modeHash: body.mode ? sha256Hex(body.mode) : null,
      snapshotHashLength: String(body.snapshotHash || '').length,
      snapshotHashSetHashLength: String(body.snapshotHashSetHash || '').length,
      coverageHashLength: String(body.coverage?.coverage_hash || '').length,
      pageHashLength: String(body.pageHash || '').length,
      resourceCount: body.coverage?.resource_count ?? null,
      receiptHashLength: String(receipt.receiptHash || '').length,
      identityHashLength: String(receipt.authBinding?.identityHash || '').length,
      sessionHashLength: String(receipt.authBinding?.sessionHash || '').length,
      signingKeyHashLength: String(receipt.authBinding?.signingKeyHash || '').length,
      idempotencyKeyHashLength: String(receipt.request?.idempotencyKeyHash || '').length,
      planningOnly: {
        readOnly: body.planningOnly?.readOnly === true,
        mutates: body.planningOnly?.mutates === true,
      },
      proofHash: digest({
        status: snapshotHashes?.status ?? null,
        ok: body.ok === true,
        modeHash: body.mode ? sha256Hex(body.mode) : null,
        routeHash: receipt.route ? sha256Hex(receipt.route) : null,
        snapshotHash: body.snapshotHash || null,
        snapshotHashSetHash: body.snapshotHashSetHash || null,
        coverageHash: body.coverage?.coverage_hash || null,
        pageHash: body.pageHash || null,
        receiptHash: receipt.receiptHash || null,
      }),
    },
    execution: {
      authAttempts: state.authAttempts,
      jsonParseAttempts: state.jsonParseAttempts,
      snapshotHashWorkAttempts: state.snapshotHashWorkAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      phaseHash: sha256Hex(state.phaseLog.join('\n')),
      acceptedPhaseHash: state.acceptedPhaseLog.length ? sha256Hex(state.acceptedPhaseLog.join('\n')) : null,
    },
    negativeAuth,
    mutationAttempted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex(ok
        ? 'production-backed snapshot-hashes route proof required before release movement'
        : 'snapshot-hashes route proof malformed or missing before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('checked production-backed snapshot-hashes route proof'),
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function summarizeNegativeAuthCarryThrough(summaries) {
  const entries = Array.isArray(summaries) ? summaries : [];
  return {
    caseCount: entries.length,
    allFailedBeforeJsonParse: entries.every((entry) => entry.negativeAuth?.jsonParsed === false),
    allFailedBeforeSnapshotWork: entries.every((entry) => entry.negativeAuth?.snapshotHashWorkStarted === false),
    allFailedBeforeMutationCapableWork: entries.every(
      (entry) => entry.negativeAuth?.mutationCapableWorkStarted === false,
    ),
    malformedPayloadWouldFailIfParsed: entries.every(
      (entry) => entry.negativeAuth?.payloadWouldFailIfParsed === true,
    ),
    snapshotHashEvidenceEmitted: entries.some((entry) => entry.negativeAuth?.snapshotHashEvidence === true),
    statusSetHash: digest(entries.map((entry) => entry.negativeAuth?.status ?? null)),
    codeSetHash: digest(entries.map((entry) => entry.negativeAuth?.code || null)),
    bodyHashSetHash: digest(entries.map((entry) => entry.negativeAuth?.bodyHash || null)),
    phaseHashSetHash: digest(entries.map((entry) => entry.negativeAuth?.phaseHash || null)),
  };
}

function buildVerifyReleaseStyleSummary(snapshotHashesRouteReceipt) {
  const reason = snapshotHashesRouteReceipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : snapshotHashesRouteReceipt.code;
  const routeSummary = {
    ok: snapshotHashesRouteReceipt.ok === true,
    summaryPath: 'productionSnapshotHashesRoute',
    receiptHash: snapshotHashesRouteReceipt.receiptHash,
    routeEvidence: snapshotHashesRouteReceipt.routeEvidence,
    snapshotHashesSummary: snapshotHashesRouteReceipt.snapshotHashesSummary,
    authSummary: snapshotHashesRouteReceipt.authSummary,
    execution: snapshotHashesRouteReceipt.execution,
    negativeAuth: snapshotHashesRouteReceipt.negativeAuth,
    redaction: snapshotHashesRouteReceipt.redaction,
    requiredHash: digest([
      'signed POST production snapshot-hashes route',
      'auth before payload parsing',
      'malformed negative auth before JSON parse',
      'planning-only read-only snapshot hash work',
      'hash-only receipt evidence',
    ]),
    scopeHash: sha256Hex(snapshotHashesRouteReceipt.evidenceScope),
  };
  const summaryCore = {
    schemaVersion: 1,
    slice: 'RPP-0582',
    evidenceSourceHash: sha256Hex('release-verifier-production-snapshot-hashes-route-v5'),
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarkerHash: sha256Hex(`[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`),
    mutationAttempted: false,
    productionSnapshotHashesRoute: routeSummary,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex(snapshotHashesRouteReceipt.ok === true
        ? 'production-backed snapshot-hashes route proof required before release movement'
        : 'snapshot-hashes route proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('checked production-backed snapshot-hashes route proof'),
      status: 'blocked',
      verdict: reason,
    },
  };

  return {
    ...summaryCore,
    proofHash: digest(summaryCore),
  };
}

function summarizeNegativeAuthEvidence(response, casePhases) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0582',
    proofClass: 'release-verifier-production-snapshot-hashes-route-v5',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    status: 'blocked',
    mutationAttempted: false,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: evidence.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHeaderHash: evidence.credentialHeaderHash,
      signedHeaderSetHash: evidence.signedHeaderSetHash,
      sessionIdHash: evidence.sessionIdHash,
      idempotencyKeyHash: evidence.idempotencyKeyHash,
    },
    routeEvidence: {
      method: 'POST',
      endpointPathHash: sha256Hex(endpointPath),
      routeHash: sha256Hex(routeName),
      proofHash: digest({
        method: 'POST',
        endpointPathHash: sha256Hex(endpointPath),
        routeHash: sha256Hex(routeName),
        status: response.status,
        code: response.body?.code || null,
      }),
    },
    negativeAuth: {
      status: response.status,
      code: response.body?.code || null,
      modeHash: response.body?.mode ? sha256Hex(response.body.mode) : null,
      payloadWouldFailIfParsed: true,
      jsonParsed: false,
      snapshotHashWorkStarted: false,
      mutationCapableWorkStarted: false,
      snapshotHashEvidence: hasSnapshotHashEvidence(response),
      bodyHash: evidence.bodyHash,
      phaseHash: sha256Hex(casePhases.join('\n')),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('authenticated production snapshot-hashes route evidence is required'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('authenticated snapshot-hashes route proof'),
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasSnapshotHashEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.snapshotHash
    || body.snapshotHashSetHash
    || body.pageHash
    || body.coverage
    || body.receipt?.type === 'snapshot-hashes'
    || Array.isArray(body.resources)
  );
}

function negativeAuthCases() {
  return [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedSnapshotHeaders({
          rawBody: malformedJsonBody,
          session: '',
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedCode: 'SIGNED_REQUEST_SIGNATURE_MISMATCH',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
      }),
    },
  ];
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

async function runNegativeAuthProof(route = createLocalProductionSnapshotHashesRoute()) {
  const summaries = [];
  for (const negativeCase of negativeAuthCases()) {
    const phaseStart = route.state.phaseLog.length;
    const result = await requestLocalRoute(route, negativeCase.headers);
    const casePhases = route.state.phaseLog.slice(phaseStart);
    const summary = summarizeNegativeAuthEvidence(result, casePhases);

    assert.equal(result.status, 401, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasSnapshotHashEvidence(result), false, `${negativeCase.name} emitted snapshot hash evidence`);
    assert.equal(casePhases.includes('json-parse'), false, `${negativeCase.name} parsed JSON`);
    assert.equal(casePhases.includes('snapshot-hash-work'), false, `${negativeCase.name} started snapshot hash work`);
    assert.equal(casePhases.includes('mutation-capable-work'), false, `${negativeCase.name} started mutation work`);

    summaries.push(summary);
  }

  assert.equal(route.state.authAttempts, negativeAuthCases().length);
  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.snapshotHashWorkAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);

  return { route, summaries };
}

function collectSnapshotHashesRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (
    value.routeEvidence
    && typeof value.routeEvidence === 'object'
    && value.routeEvidence.routeHash === sha256Hex(routeName)
    && value.routeEvidence.endpointPathHash === sha256Hex(endpointPath)
  ) {
    blocks.push(value.routeEvidence);
  }
  for (const child of Object.values(value)) {
    collectSnapshotHashesRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
}

function collectProductionSnapshotHashesSummaries(value, summaries = []) {
  if (!value || typeof value !== 'object') {
    return summaries;
  }
  if (
    value.summaryPath === 'productionSnapshotHashesRoute'
    && value.routeEvidence?.routeHash === sha256Hex(routeName)
    && value.routeEvidence?.endpointPathHash === sha256Hex(endpointPath)
  ) {
    summaries.push(value);
  }
  for (const child of Object.values(value)) {
    collectProductionSnapshotHashesSummaries(child, summaries);
  }
  return summaries;
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

function assertHashOnlyReleaseVerifierEvidence(value) {
  assertNoRawValues(value, [
    sourceUrl,
    credential.username,
    credential.password,
    wrongCredential.password,
    sessionId,
    invalidSessionId,
    idempotencyKey,
    signedNonce,
    malformedJsonBody,
    routeSourcePath,
  ]);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0582 release verifier snapshot-hashes proof' }));
}

test('RPP-0582 v5 keeps production snapshot-hashes auth before payload parsing and mutation helpers', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/snapshot-hashes',
  );
  const callback = functionBody('reprint_push_lab_rest_authenticated_snapshot_hashes');
  const preDispatch = functionBody('reprint_push_lab_rest_pre_dispatch_snapshot_hashes_auth_guard');
  const signedVerifier = functionBody('reprint_push_lab_rest_verify_signed_request');

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_snapshot_hashes'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assert.match(routeSource, /add_filter\('rest_pre_dispatch', 'reprint_push_lab_rest_pre_dispatch_snapshot_hashes_auth_guard', 9, 3\)/);

  assertBefore(preDispatch, 'reprint_push_lab_rest_authenticated_permission($request)', "reprint_push_lab_rest_verify_signed_request($request, 'snapshot-hashes', ['claimNonce' => false])");
  assert.match(preDispatch, /\['claimNonce'\s*=>\s*false\]/);
  assert.doesNotMatch(preDispatch, /reprint_push_lab_rest_json_payload|get_json_params|reprint_push_export_snapshot|reprint_push_lab_rest_snapshot_hashes_response|reprint_push_lab_rest_claim_signed_nonce/);
  assertBefore(signedVerifier, '$claim_nonce = !array_key_exists', 'reprint_push_lab_rest_claim_signed_nonce($nonce');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'snapshot-hashes')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(callback, 'reprint_push_lab_rest_json_payload($request)', 'reprint_push_lab_rest_snapshot_hashes_response($request, $payload)');

  const routeBodies = snapshotHashRouteBodies();
  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_protocol_append_journal_event',
    'reprint_push_lab_db_journal_insert_event',
    'reprint_push_lab_rest_apply_with_db_journal',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(routeBodies, new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('RPP-0582 v5 rejects negative auth cases before JSON parsing, snapshot work, or mutation-capable work', async () => {
  const { route, summaries } = await runNegativeAuthProof();

  for (const summary of summaries) {
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.snapshotHashWorkStarted, false);
    assert.equal(summary.negativeAuth.mutationCapableWorkStarted, false);
    assert.equal(summary.negativeAuth.snapshotHashEvidence, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assert.equal(summary.redaction.rawValuesIncluded, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, ['endpointPathHash', 'routeHash', 'proofHash']);
    assertHashOnlyFields(summary.negativeAuth, ['modeHash', 'bodyHash', 'phaseHash']);
    assertHashOnlyWhenPresent(summary.authSummary, [
      'credentialHeaderHash',
      'signedHeaderSetHash',
      'sessionIdHash',
      'idempotencyKeyHash',
    ]);
    assertHashOnlyReleaseVerifierEvidence(summary);
  }

  assert.equal(route.state.authAttempts, negativeAuthCases().length);
  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.snapshotHashWorkAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
});

test('RPP-0582 v5 carries one positive snapshot-hashes route summary through the release verifier', async () => {
  const negative = await runNegativeAuthProof();
  const originalFetch = global.fetch;
  const route = createLocalProductionSnapshotHashesRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const snapshotHashes = await client.signedPost('/snapshot-hashes', snapshotHashesPayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const receipt = buildSnapshotHashesRouteReceipt({
      snapshotHashes,
      state: route.state,
      negativeAuthSummaries: negative.summaries,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectSnapshotHashesRouteEvidenceBlocks(verifyReleaseSummary);
    const productionSummaries = collectProductionSnapshotHashesSummaries(verifyReleaseSummary);

    assert.equal(snapshotHashes.status, 200);
    assert.equal(snapshotHashes.request.pathname, endpointPath);
    assert.equal(snapshotHashes.request.method, 'POST');
    assert.equal(snapshotHashes.body.mode, 'snapshot-hashes');
    assert.equal(snapshotHashes.body.routeProfile.profile, 'production-shaped');
    assert.equal(snapshotHashes.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(snapshotHashes.body.routeProfile.routePrefix, '/push');
    assert.equal(snapshotHashes.body.planningOnly.readOnly, true);
    assert.equal(snapshotHashes.body.planningOnly.mutates, false);
    assert.match(snapshotHashes.body.snapshotHash, prefixedHashPattern);
    assert.match(snapshotHashes.body.snapshotHashSetHash, prefixedHashPattern);
    assert.match(snapshotHashes.body.coverage.coverage_hash, prefixedHashPattern);
    assert.match(snapshotHashes.body.pageHash, prefixedHashPattern);
    assert.equal(snapshotHashes.body.resources.length, 2);
    assert.equal(snapshotHashes.body.receipt.type, 'snapshot-hashes');
    assert.equal(snapshotHashes.body.receipt.route, routeName);
    assert.equal(snapshotHashes.body.receipt.planningOnly.readOnly, true);
    assert.equal(snapshotHashes.body.receipt.planningOnly.mutates, false);
    assert.equal(route.state.jsonParseAttempts, 1);
    assert.equal(route.state.snapshotHashWorkAttempts, 1);
    assert.equal(route.state.mutationCapableWorkAttempts, 0);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.code, 'LOCAL_SNAPSHOT_HASH_ROUTE_V5_SUPPORT_ONLY');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.productionInputs.productionUrlSupplied, false);
    assert.equal(receipt.productionInputs.productionCredentialsSupplied, false);
    assert.equal(receipt.routeEvidence.method, 'POST');
    assert.equal(receipt.routeEvidence.labBacked, true);
    assert.equal(receipt.routeEvidence.signedPost, true);
    assert.equal(receipt.snapshotHashesSummary.planningOnly.readOnly, true);
    assert.equal(receipt.snapshotHashesSummary.planningOnly.mutates, false);
    assert.equal(receipt.snapshotHashesSummary.resourceCount, 2);
    assert.equal(receipt.execution.jsonParseAttempts, 1);
    assert.equal(receipt.execution.snapshotHashWorkAttempts, 1);
    assert.equal(receipt.execution.mutationCapableWorkAttempts, 0);
    assert.equal(receipt.negativeAuth.caseCount, negativeAuthCases().length);
    assert.equal(receipt.negativeAuth.allFailedBeforeJsonParse, true);
    assert.equal(receipt.negativeAuth.allFailedBeforeSnapshotWork, true);
    assert.equal(receipt.negativeAuth.allFailedBeforeMutationCapableWork, true);
    assert.equal(receipt.negativeAuth.snapshotHashEvidenceEmitted, false);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(receipt.redaction.rawValuesIncluded, false);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionSnapshotHashesRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionSnapshotHashesRoute.receiptHash, receipt.receiptHash);
    assert.equal(
      verifyReleaseSummary.productionSnapshotHashesRoute.routeEvidence.proofHash,
      receipt.routeEvidence.proofHash,
    );
    assert.equal(productionSummaries.length, 1);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(productionSummaries[0], verifyReleaseSummary.productionSnapshotHashesRoute);
    assert.deepEqual(routeEvidenceBlocks[0], verifyReleaseSummary.productionSnapshotHashesRoute.routeEvidence);

    assertHashOnlyFields(receipt.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(receipt.authSummary, [
      'credentialHash',
      'identityHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'idempotencyKeyHash',
      'sessionTypeHash',
      'sessionStatusHash',
    ]);
    assertHashOnlyFields(receipt.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'authBeforePayloadHash',
      'proofHash',
    ]);
    assertHashOnlyFields(receipt.snapshotHashesSummary, ['modeHash', 'proofHash']);
    assertHashOnlyFields(receipt.execution, ['phaseHash', 'acceptedPhaseHash']);
    assertHashOnlyFields(receipt.negativeAuth, [
      'statusSetHash',
      'codeSetHash',
      'bodyHashSetHash',
      'phaseHashSetHash',
    ]);
    assert.match(receipt.receiptHash, hashPattern);
    assert.match(verifyReleaseSummary.proofHash, hashPattern);
    assertHashOnlyReleaseVerifierEvidence(verifyReleaseSummary);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0582 v5 blocks malformed or missing snapshot-hashes route evidence before release movement', () => {
  const rawBody = JSON.stringify(snapshotHashesPayload);
  const headers = signedSnapshotHeaders({ rawBody });
  const acceptedResponse = {
    status: 200,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: snapshotHashesBody({ payload: snapshotHashesPayload, rawBody, headers }),
  };
  const missing = buildSnapshotHashesRouteReceipt({
    snapshotHashes: null,
    state: createRouteState(),
  });
  const wrongPath = buildSnapshotHashesRouteReceipt({
    snapshotHashes: {
      ...acceptedResponse,
      request: {
        method: 'POST',
        pathname: `${routePrefix}/dry-run`,
      },
    },
    state: createRouteState(),
  });
  const mutatingPlanningFlag = buildSnapshotHashesRouteReceipt({
    snapshotHashes: {
      ...acceptedResponse,
      body: {
        ...clone(acceptedResponse.body),
        planningOnly: {
          readOnly: false,
          mutates: true,
        },
      },
    },
    state: createRouteState(),
  });
  const summaries = [
    buildVerifyReleaseStyleSummary(missing),
    buildVerifyReleaseStyleSummary(wrongPath),
    buildVerifyReleaseStyleSummary(mutatingPlanningFlag),
  ];

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED');

  for (const malformed of [wrongPath, mutatingPlanningFlag]) {
    assert.equal(malformed.ok, false);
    assert.equal(malformed.status, 'blocked');
    assert.equal(malformed.code, 'SNAPSHOT_HASH_ROUTE_PROOF_MALFORMED');
    assert.equal(malformed.releaseStatus, 'NO-GO');
    assert.equal(malformed.releaseMovement.allowed, false);
    assert.equal(malformed.mutationAttempted, false);
    assert.equal(malformed.boundary.verdict, 'SNAPSHOT_HASH_ROUTE_PROOF_MALFORMED');
    assertHashOnlyFields(malformed.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(malformed.authSummary, [
      'credentialHash',
      'identityHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'idempotencyKeyHash',
      'sessionTypeHash',
      'sessionStatusHash',
    ]);
    assertHashOnlyFields(malformed.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashOnlyFields(malformed.snapshotHashesSummary, ['modeHash', 'proofHash']);
  }

  for (const summary of summaries) {
    assert.equal(summary.ok, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.productionSnapshotHashesRoute.ok, false);
    assert.equal(collectProductionSnapshotHashesSummaries(summary).length, 1);
    assert.equal(collectSnapshotHashesRouteEvidenceBlocks(summary).length, 1);
    assertHashOnlyReleaseVerifierEvidence(summary);
  }
});
