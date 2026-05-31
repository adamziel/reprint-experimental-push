import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const applyEndpointPath = `${routePrefix}/apply`;
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0577acceptednonce';
const sessionId = 'psh_01j00000000000000000577';
const invalidSessionId = 'psh_01j00000000000090577';
const idempotencyKey = 'idem-rpp-0577-same-key-different-body-v4';
const malformedJsonBody = '{"plan":';
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0577-wrong-application-password',
};
const auth = {
  identity: {
    userId: 577,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: sessionId,
    expiresAt: '2030-01-01T00:00:00Z',
  },
};
const hashPattern = /^[a-f0-9]{64}$/;

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

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0577:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function basicAuth(value = credential) {
  return `Basic ${Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')}`;
}

function labSigningKey(value = credential) {
  return hmacHex(value.password, `reprint-push-lab-v1\n${value.username}`);
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

function signedApplyHeaders({
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
    pathname: applyEndpointPath,
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

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
    mutationSetHash: digest(mutations.map((mutation) => ({
      id: String(mutation?.id || ''),
      resourceKey: String(mutation?.resourceKey || ''),
      resource: mutation?.resource,
      action: mutation?.action ?? null,
      changeKind: mutation?.changeKind ?? null,
      baseHash: mutation?.baseHash ?? null,
      remoteBeforeHash: mutation?.remoteBeforeHash ?? null,
      localHash: mutation?.localHash ?? null,
    }))),
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
  };
}

function receiptForPlan(plan, dryRunIdempotencyKey) {
  const evidence = planEvidence(plan);
  const identityHash = digest(auth.identity);
  const pushSessionHash = fixtureHash('push-session');

  return {
    receiptHash: fixtureHash('dry-run-receipt'),
    planHash: digest(plan),
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      expiresAt: '2030-01-01T00:00:00Z',
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      binding: {
        identityHash,
        pushSessionHash,
        planHash: digest(plan),
      },
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash: fixtureHash('signing-key'),
        dryRunIdempotencyKeyHash: sha256Hex(dryRunIdempotencyKey),
        issue: { identityHash },
      },
      sessionUser: {
        identityHash,
        userId: auth.identity.userId,
        userLoginHash: sha256Hex(auth.identity.userLogin),
        pushSessionHash,
        bindingHash: fixtureHash('session-user-binding'),
      },
    },
  };
}

function applyRevalidationEvidence(plan, receipt) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const evidence = planEvidence(plan);

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || digest(plan),
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: mutations.length,
    verifiedCount: mutations.length,
    verifiedResourceKeys: mutations.map((mutation) => mutation.resourceKey),
    claim: {
      activeClaimId: sessionId,
      activeClaimKeyHash: fixtureHash('active-claim-key'),
      activeClaimSequence: 2,
      staleClaimRetry: false,
    },
  };
}

function storageGuard() {
  return {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  };
}

function signedRequest(pathname, contentHash) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    sessionHash: fixtureHash('signed-session'),
    signingKeyHash: fixtureHash('signing-key'),
    request: { method: 'POST', path: pathname },
  };
}

function checkedJournal({ idempotencyKeyHash, requestHash, conflictRequestHash }) {
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const rows = [
    {
      sequence: 1,
      event: 'idempotency-opened',
      idempotencyKeyHash,
      requestHash,
    },
    {
      sequence: 2,
      event: 'apply-started',
      idempotencyKeyHash,
      requestHash,
    },
    {
      sequence: 3,
      event: 'mutation-applied',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 1,
    },
    {
      sequence: 4,
      event: 'apply-committed',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 1,
    },
    {
      sequence: 5,
      event: 'apply-replayed',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 0,
    },
    {
      sequence: 6,
      event: 'idempotency-key-conflict',
      idempotencyKeyHash,
      requestHash: conflictRequestHash,
      errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
      appliedCount: 0,
    },
  ];

  return {
    scope: trustedDbJournalScope,
    latestRows: rows,
    rowCount: rows.length,
    eventSummaries: [
      { event: 'idempotency-opened', count: 1 },
      { event: 'apply-started', count: 1 },
      { event: 'mutation-applied', count: 1 },
      { event: 'apply-committed', count: 1 },
      { event: 'apply-replayed', count: 1 },
      { event: 'idempotency-key-conflict', count: 1 },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: sessionId,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01j00000000000000000576',
      previousClaimKeyHash: fixtureHash('previous-claim-key'),
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash,
      requestHash,
      staleClaimRejected: true,
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: sessionId,
      claimKeyHash: activeClaimKeyHash,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: sessionId,
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };
}

function createLocalNegativeAuthApplyRoute() {
  const state = {
    requests: [],
    jsonParseAttempts: 0,
    mutationCapableWorkAttempts: 0,
    mutationWorkAttempts: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({ method, pathname: requestUrl.pathname, headers, rawBody });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, applyEndpointPath);

    return handleNegativeAuthApplyRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleNegativeAuthApplyRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateApplyRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse(authFailureBody(authError.code, headers, rawBody), authError.status);
  }

  state.jsonParseAttempts += 1;
  JSON.parse(rawBody);
  state.mutationCapableWorkAttempts += 1;

  return jsonResponse({
    ok: true,
    mode: 'apply',
    mutationAttempted: false,
  });
}

function authenticateApplyRequest({ method, pathname, headers, rawBody }) {
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

  if (!headers['x-reprint-push-idempotency-key']) {
    return { code: 'MISSING_IDEMPOTENCY_KEY', status: 400 };
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

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'apply',
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

async function requestMalformedApply(route, headers) {
  const response = await route.fetchHandler(new URL(applyEndpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: malformedJsonBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0577',
    proofClass: 'same-key-different-body-conflict-v4',
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
      endpointPathHash: sha256Hex(applyEndpointPath),
      proofHash: digest({
        method: 'POST',
        endpointPath: applyEndpointPath,
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
      mutationCapableWorkStarted: false,
      mutationWorkStarted: false,
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'same-key different-body apply route proof is support-only until checked production evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production executor-auth apply proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasApplyMutationEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.receipt
    || body.applyRevalidation
    || body.dbJournal
    || body.idempotency?.freshMutationWork === true
    || Number.isInteger(body.applied)
  );
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

test('RPP-0577 v4 route order rejects bad auth before JSON and conflict before mutation-capable work', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_apply');
  const applyWithJournal = functionBody('reprint_push_lab_rest_apply_with_db_journal');
  const conflictResult = functionBody('reprint_push_lab_rest_idempotency_conflict_result');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(
    callback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assertBefore(
    applyWithJournal,
    "$idempotency_key = trim((string) $request->get_header('x-reprint-push-idempotency-key'))",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_db_journal_key_has_different_request',
    'reprint_push_lab_db_journal_try_open_idempotency',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_idempotency_conflict_result($context)',
    'reprint_push_lab_rest_run_db_journal_apply',
  );

  assert.match(conflictResult, /'code'\s*=>\s*'IDEMPOTENCY_KEY_CONFLICT'/);
  assert.match(conflictResult, /'status'\s*=>\s*'conflict'/);
  assert.match(conflictResult, /'freshMutationWork'\s*=>\s*false/);
  assert.match(conflictResult, /'mutationEventCounts'\s*=>\s*\$mutation_counts/);
});

test('RPP-0577 v4 proves same-key different-body conflict preserves hash-only evidence before fresh work', async () => {
  const originalFetch = global.fetch;
  const idempotencyKeyHash = sha256Hex(idempotencyKey);
  const receiptHash = fixtureHash('dry-run-receipt');
  const base = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0577.txt': 'base-body',
    },
    plugins: {},
    db: {},
  };
  const local = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0577.txt': 'local-body',
    },
    plugins: {},
    db: {},
  };
  const seen = [];
  let currentSnapshot = base;
  let applyCount = 0;
  let freshMutationCapableWorkCount = 0;
  let mutationWorkCount = 0;
  let conflictMutationCapableWorkCount = 0;
  let conflictMutationWorkCount = 0;
  let conflictResponseBody = null;

  global.fetch = async (url, options = {}) => {
    const urlString = String(url);
    const pathname = new URL(urlString).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex('');
    seen.push({ pathname, rawBody, body, headers });

    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth,
        session: { id: sessionId, expiresAt: auth.session.expiresAt },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: currentSnapshot,
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth,
        receipt: receiptForPlan(body.plan, idempotencyKey),
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/recovery/inspect`) {
      return jsonResponse({
        ok: true,
        mode: 'inspect',
        responseSchemaVersion: 1,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: body.plan.mutations.length, blockedUnknown: 0, total: body.plan.mutations.length },
          journal: { integrity: { status: 'ok' } },
        },
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);

      if (body.durableJournalBoundaryProbe) {
        const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
        const originalRequestHash = applyRequests[0].headers['x-auth-content-hash'];
        assert.equal(applyCount, 2, 'conflict probe must run after initial apply and same-body replay');
        assert.equal(freshMutationCapableWorkCount, 1, 'conflict probe must not start fresh mutation-capable work');
        assert.deepEqual(currentSnapshot, local, 'conflict probe must start from the already-applied target snapshot');

        conflictResponseBody = {
          ok: false,
          mode: 'apply',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          responseSchemaVersion: 1,
          auth,
          idempotency: {
            conflict: true,
            replayed: false,
            freshMutationWork: false,
            status: 'conflict',
            idempotencyKeyHash,
            requestHash: contentHash,
            conflictingRequestHash: originalRequestHash,
            mutationEventCounts: {
              prepared: 0,
              applied: 0,
              preconditionFailed: 0,
            },
          },
          storageGuard: storageGuard(),
          signedRequest: signedRequest(pathname, contentHash),
        };

        return jsonResponse(conflictResponseBody, 409);
      }

      applyCount += 1;
      if (applyCount === 1) {
        freshMutationCapableWorkCount += 1;
        mutationWorkCount += body.plan.mutations.length;
        currentSnapshot = local;
      }

      return jsonResponse({
        ok: true,
        mode: 'apply',
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        applied: body.plan.mutations.length,
        responseSchemaVersion: 1,
        auth,
        receipt: body.receipt,
        idempotency: {
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
          status: applyCount === 1 ? 'fresh' : 'replayed',
          idempotencyKeyHash,
          requestHash: contentHash,
        },
        storageGuard: storageGuard(),
        signedRequest: signedRequest(pathname, contentHash),
        applyRevalidation: applyRevalidationEvidence(body.plan, body.receipt),
      });
    }

    if (pathname === `${routePrefix}/db-journal`) {
      const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: checkedJournal({
          idempotencyKeyHash,
          requestHash: applyRequests[0].headers['x-auth-content-hash'],
          conflictRequestHash: applyRequests[2].headers['x-auth-content-hash'],
        }),
        storageGuard: storageGuard(),
      });
    }

    throw new Error(`unexpected fetch to ${urlString}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      proveDurableJournalBoundary: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.apply.receiptHash, receiptHash);
    assert.equal(summary.replay.receiptHash, receiptHash);
    assert.equal(summary.sameKeySameBodyReplay.proved, true);
    assert.equal(summary.sameKeySameBodyReplay.noFreshMutationWork, true);
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.replay.idempotency.freshMutationWork, false);

    assert.equal(summary.idempotencyConflict.status, 409);
    assert.equal(summary.idempotencyConflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(summary.idempotencyConflict.idempotency.conflict, true);
    assert.equal(summary.idempotencyConflict.idempotency.replayed, false);
    assert.equal(summary.idempotencyConflict.idempotency.freshMutationWork, false);
    assert.equal(summary.idempotencyConflict.idempotency.status, 'conflict');
    assert.equal(summary.idempotencyConflict.idempotency.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(summary.idempotencyConflict.hashOnly, true);
    assert.equal(summary.idempotencyConflict.targetSnapshotUnchanged, true);
    assert.equal(summary.idempotencyConflict.finalMatchesLocal, true);
    assert.match(summary.idempotencyConflict.idempotency.idempotencyKeyHash, hashPattern);
    assert.match(summary.idempotencyConflict.idempotency.requestHash, hashPattern);

    const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
    assert.equal(applyRequests.length, 3);
    const [applyRequest, replayRequest, conflictRequest] = applyRequests;
    const applyCanonicalBodyHash = digest(applyRequest.body);
    const replayCanonicalBodyHash = digest(replayRequest.body);
    const conflictCanonicalBodyHash = digest(conflictRequest.body);
    assert.deepEqual(applyRequest.body, replayRequest.body);
    assert.notDeepEqual(applyRequest.body, conflictRequest.body);
    assert.equal(applyCanonicalBodyHash, replayCanonicalBodyHash);
    assert.notEqual(applyCanonicalBodyHash, conflictCanonicalBodyHash);
    assert.match(conflictCanonicalBodyHash, hashPattern);
    assert.equal(conflictRequest.body.receipt.receiptHash, applyRequest.body.receipt.receiptHash);
    assert.equal(conflictRequest.body.durableJournalBoundaryProbe.type, 'same-key-different-body-conflict-before-mutation');

    for (const request of applyRequests) {
      assert.equal(request.headers['x-reprint-push-session'], sessionId);
      assert.equal(request.headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(request.headers['x-auth-content-hash'], sha256Hex(request.rawBody));
    }

    assert.equal(applyRequest.headers['x-auth-content-hash'], replayRequest.headers['x-auth-content-hash']);
    assert.notEqual(applyRequest.headers['x-auth-content-hash'], conflictRequest.headers['x-auth-content-hash']);
    assert.equal(summary.idempotencyConflict.idempotency.requestHash, conflictRequest.headers['x-auth-content-hash']);
    assert.equal(conflictResponseBody.idempotency.conflictingRequestHash, applyRequest.headers['x-auth-content-hash']);
    assert.notEqual(conflictResponseBody.idempotency.conflictingRequestHash, conflictResponseBody.idempotency.requestHash);
    assert.deepEqual(conflictResponseBody.idempotency.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });

    assert.equal(applyRequest.headers['x-reprint-push-signature'], replayRequest.headers['x-reprint-push-signature']);
    assert.notEqual(applyRequest.headers['x-reprint-push-signature'], conflictRequest.headers['x-reprint-push-signature']);
    assert.notEqual(applyRequest.headers['x-auth-nonce'], replayRequest.headers['x-auth-nonce']);
    assert.notEqual(applyRequest.headers['x-auth-signature'], replayRequest.headers['x-auth-signature']);

    assert.equal(freshMutationCapableWorkCount, 1);
    assert.equal(mutationWorkCount, 1);
    assert.equal(conflictMutationCapableWorkCount, 0);
    assert.equal(conflictMutationWorkCount, 0);
    assert.equal(summary.dbJournal.eventCounts['idempotency-opened'], 1);
    assert.equal(summary.dbJournal.eventCounts['mutation-applied'], 1);
    assert.equal(summary.dbJournal.eventCounts['apply-replayed'], 1);
    assert.equal(summary.dbJournal.eventCounts['idempotency-key-conflict'], 1);
    assert.equal(summary.dbJournal.mutationApplied, 1);
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assert.equal(
      summary.dbJournal.latestEvents.find((entry) => entry.event === 'idempotency-key-conflict')?.requestHash,
      conflictRequest.headers['x-auth-content-hash'],
    );
    assert.equal(
      summary.dbJournal.latestEvents.find((entry) => entry.event === 'idempotency-key-conflict')?.appliedCount,
      0,
    );

    assertNoRawValues(conflictResponseBody.idempotency, [
      idempotencyKey,
      credential.password,
      sessionId,
      base.files['wp-content/uploads/reprint-push/rpp-0577.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0577.txt'],
    ]);
    assertNoRawValues({
      sameKeySameBodyReplay: summary.sameKeySameBodyReplay,
      idempotencyConflict: summary.idempotencyConflict.idempotency,
    }, [
      idempotencyKey,
      credential.password,
      base.files['wp-content/uploads/reprint-push/rpp-0577.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0577.txt'],
      'durableJournalBoundaryProbe',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0577 v4 negative auth cases fail before JSON parsing or mutation-capable work', async () => {
  const route = createLocalNegativeAuthApplyRoute();
  const negativeCases = [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedApplyHeaders({
          rawBody: malformedJsonBody,
          session: '',
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-missing-idempotency-key-malformed-json',
      expectedStatus: 400,
      expectedCode: 'MISSING_IDEMPOTENCY_KEY',
      headers: withoutHeader(
        signedApplyHeaders({
          rawBody: malformedJsonBody,
          idempotency: '',
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedApplyHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedApplyHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      headers: signedApplyHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedApplyHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestMalformedApply(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasApplyMutationEvidence(result), false, `${negativeCase.name} emitted apply mutation evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.mutationCapableWorkStarted, false);
    assert.equal(summary.negativeAuth.mutationWorkStarted, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, ['endpointPathHash', 'proofHash']);
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
      signedNonce,
      malformedJsonBody,
      applyEndpointPath,
    ]);
  }

  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
  assert.equal(route.state.mutationWorkAttempts, 0);
});
