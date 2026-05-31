import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/snapshot-hashes`;
const routeName = '/push/snapshot-hashes';
const credential = {
  username: 'rpp_0562_admin',
  password: 'rpp-0562-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0562-wrong-application-password',
};
const sessionId = 'psh_rpp_0562_raw_session_id';
const invalidSessionId = 'psh_rpp_0562_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0562-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0562acceptednonce';
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

function createLocalProductionSnapshotHashesRoute() {
  const state = {
    requests: [],
    phaseLog: [],
    authAttempts: 0,
    jsonParseAttempts: 0,
    snapshotHashWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

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
    userLogin: credential.username,
    userId: 562,
    capabilities: { manage_options: true },
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
  const snapshotHash = `sha256:${digest({ payload, salt: 'rpp-0562-snapshot' })}`;
  const snapshotHashSetHash = `sha256:${digest({
    scope: payload.scope,
    resources: ['wp_option:home', 'wp_post:562'],
  })}`;
  const coverageHash = `sha256:${digest({
    scope: payload.scope,
    resourceCount: 2,
    route: routeName,
  })}`;
  const pageHash = `sha256:${sha256Hex('rpp-0562-page')}`;
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
        resourceKeyHash: sha256Hex('wp_post:562'),
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

function buildSnapshotHashesRouteSupportEvidence({ snapshotHashes, state }) {
  const body = snapshotHashes?.body || {};
  const receipt = body.receipt || {};
  const routeProfile = body.routeProfile || {};
  const signedRequest = body.signedRequest || {};

  return {
    schemaVersion: 1,
    slice: 'RPP-0562',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status: 'support_only',
    ok: snapshotHashes?.status === 200 && body.ok === true,
    code: 'LOCAL_SNAPSHOT_HASH_ROUTE_SUPPORT_ONLY',
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    mutationAttempted: false,
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
      identityHash: receipt.authBinding?.identityHash || body.authSummary?.identityHash || null,
      sessionIdHash: receipt.authBinding?.sessionHash || body.authSummary?.sessionHash || null,
      sessionExpiresAtHash: body.authSummary?.sessionExpiresAtHash || null,
      signingKeyHashLength: String(receipt.authBinding?.signingKeyHash || '').length,
      idempotencyKeyHash: signedRequest.request?.idempotencyKeyHash
        || receipt.request?.idempotencyKeyHash
        || null,
      sessionType: body.authSummary?.sessionType || null,
      sessionStatus: body.authSummary?.sessionStatus || null,
    },
    routeEvidence: {
      method: snapshotHashes?.request?.method || 'POST',
      endpointPath,
      requestPath: snapshotHashes?.request?.pathname || null,
      routeProfile: routeProfile.profile || null,
      restNamespace: routeProfile.restNamespace || null,
      routePrefix: routeProfile.routePrefix || null,
      labBacked: routeProfile.labBacked === true,
      authBeforePayloadHash: sha256Hex(state.phaseLog.slice(0, 4).join('\n')),
      proofHash: digest({
        method: snapshotHashes?.request?.method || 'POST',
        endpointPath,
        requestPath: snapshotHashes?.request?.pathname || null,
        routeProfile: routeProfile.profile || null,
        status: snapshotHashes?.status ?? null,
        mode: body.mode || null,
        capturedAt: proofCapturedAt,
      }),
    },
    snapshotHashesSummary: {
      status: snapshotHashes?.status ?? null,
      ok: body.ok === true,
      mode: body.mode || null,
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
        mode: body.mode || null,
        route: receipt.route || null,
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
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local snapshot-hashes route proof is support-only until production URL and credential proof exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed snapshot-hashes route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function summarizeNegativeAuthEvidence(response, casePhases) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0562',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
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
      reason: 'authenticated production snapshot-hashes route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated snapshot-hashes route proof',
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

test('RPP-0562 v4 keeps production snapshot-hashes auth before payload parsing and mutation helpers', () => {
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

test('RPP-0562 v4 rejects negative auth/signature/session cases before JSON parsing or mutation-capable work', async () => {
  const route = createLocalProductionSnapshotHashesRoute();
  const negativeCases = [
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

  for (const negativeCase of negativeCases) {
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
    assert.equal(route.state.jsonParseAttempts, 0);
    assert.equal(route.state.snapshotHashWorkAttempts, 0);
    assert.equal(route.state.mutationCapableWorkAttempts, 0);

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
    assertHashOnlyFields(summary.routeEvidence, ['proofHash']);
    assertHashOnlyFields(summary.negativeAuth, ['bodyHash', 'phaseHash']);
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
      signedNonce,
      malformedJsonBody,
    ]);
  }

  assert.equal(route.state.authAttempts, negativeCases.length);
  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.snapshotHashWorkAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
});

test('RPP-0562 v4 accepts support evidence as planning-only read-only and hash-only', async () => {
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
    const evidence = buildSnapshotHashesRouteSupportEvidence({ snapshotHashes, state: route.state });

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

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(evidence.routeEvidence.labBacked, true);
    assert.equal(evidence.snapshotHashesSummary.planningOnly.readOnly, true);
    assert.equal(evidence.snapshotHashesSummary.planningOnly.mutates, false);
    assert.equal(evidence.snapshotHashesSummary.resourceCount, 2);
    assert.equal(evidence.execution.jsonParseAttempts, 1);
    assert.equal(evidence.execution.snapshotHashWorkAttempts, 1);
    assert.equal(evidence.execution.mutationCapableWorkAttempts, 0);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'identityHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'idempotencyKeyHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['authBeforePayloadHash', 'proofHash']);
    assertHashOnlyFields(evidence.snapshotHashesSummary, ['proofHash']);
    assertHashOnlyFields(evidence.execution, ['phaseHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
