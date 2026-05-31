import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const endpointPath = `${routePrefix}/apply`;
const credential = {
  username: 'rpp_0544_admin',
  password: 'rpp-0544-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0544_generated_session';
const idempotencyKey = 'idem-rpp-0544-apply-route-v3';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const resourcePath = 'wp-content/uploads/reprint-push/rpp-0544-apply-route.txt';
const resourceKey = `file:${resourcePath}`;
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function sourceIdentity() {
  return {
    sourceHash: sha256Hex('rpp-0544-live-source-binding'),
    sourceUrlHash: sha256Hex(sourceUrl),
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
  };
}

function authEnvelope() {
  return {
    identity: {
      userId: 544,
      userLogin: credential.username,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: freshExpiresAt,
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      sourceHash: sourceIdentity().sourceHash,
      sourceUrlHash: sourceIdentity().sourceUrlHash,
      cleanedUp: false,
      playgroundFallback: true,
    },
  };
}

function buildReadyApplyPlan() {
  const resource = { kind: 'file', path: resourcePath };
  const mutationId = 'mut_rpp_0544_apply_route_live_source';
  const baseHash = sha256Hex('rpp-0544-base-resource');
  const localHash = sha256Hex('rpp-0544-local-resource');
  return {
    id: 'plan-rpp-0544-production-apply-route-v3',
    status: 'ready',
    summary: {
      total: 1,
      create: 0,
      update: 1,
      delete: 0,
    },
    mutations: [
      {
        id: mutationId,
        action: 'update',
        changeKind: 'file-update',
        resource,
        resourceKey,
        baseHash,
        remoteBeforeHash: baseHash,
        localHash,
      },
    ],
    preconditions: [
      {
        mutationId,
        resource,
        resourceKey,
        expectedHash: baseHash,
      },
    ],
    conflicts: [],
    blockers: [],
  };
}

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];
  return {
    planHash: digest(plan),
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

function receiptForPlan(plan, { rawBody, headers }) {
  const evidence = planEvidence(plan);
  const source = sourceIdentity();
  const sessionHash = sha256Hex(sessionId);
  const dryRunContentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const receipt = {
    schemaVersion: 1,
    planHash: evidence.planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    authBinding: {
      schemaVersion: 1,
      source,
      pushSession: {
        sessionHash,
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
        dryRunContentHash,
        dryRunBodyHash: digest({ plan }),
      },
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: `${routePrefix}/dry-run`,
        routeProfile: 'production-shaped',
        labBacked: true,
        planHash: evidence.planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash: sha256Hex(rawBody),
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: plan.mutations.length,
      },
      issuedAt: proofCapturedAt,
      expiresAt: freshExpiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function applyRevalidationEvidence({ plan, receipt, currentSnapshot, startedSequence }) {
  const evidence = planEvidence(plan);
  const source = sourceIdentity();
  const receiptSource = receipt.authBinding.source;
  const verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);
  const dbJournalCursor = `db-journal:${startedSequence}`;
  const liveSource = {
    snapshotHash: digest(currentSnapshot),
    sourceHash: source.sourceHash,
    sourceUrlHash: source.sourceUrlHash,
    receiptSourceHash: receiptSource.sourceHash,
    receiptSourceUrlHash: receiptSource.sourceUrlHash,
    sourceBindingHash: digest({
      receiptSourceHash: receiptSource.sourceHash,
      receiptSourceUrlHash: receiptSource.sourceUrlHash,
      currentSourceHash: source.sourceHash,
      currentSourceUrlHash: source.sourceUrlHash,
      phase: 'before-first-mutation',
    }),
    dbJournalCursor,
  };

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || evidence.planHash,
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    verifiedCount: plan.mutations.length,
    verifiedResourceKeys,
    liveSource,
    receiptBinding: {
      schemaVersion: 1,
      planHash: receipt.planHash,
      receiptHash: receipt.receiptHash,
      mutationSetHash: receipt.mutationSetHash,
      preconditionSetHash: receipt.preconditionSetHash,
      sourceHash: receiptSource.sourceHash,
      sourceUrlHash: receiptSource.sourceUrlHash,
      sessionHash: receipt.authBinding.pushSession.sessionHash,
      dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
      dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
    },
    claim: {
      activeClaimId: null,
      activeClaimKeyHash: sha256Hex(idempotencyKey),
      activeClaimSequence: startedSequence,
      staleClaimRetry: false,
    },
  };
}

function signedRequestEvidence(pathname, contentHash, headers) {
  const request = {
    method: 'POST',
    path: pathname,
    canonicalHash: sha256Hex([
      pathname,
      contentHash,
      headers['x-reprint-push-session'] || '',
      headers['x-reprint-push-idempotency-key'] || '',
    ].join('\n')),
    idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
      ? sha256Hex(headers['x-reprint-push-idempotency-key'])
      : '',
  };
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    timestamp: headers['x-auth-timestamp'] || '',
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: headers['x-reprint-push-session']
      ? sha256Hex(headers['x-reprint-push-session'])
      : '',
    signingKeyHash: sha256Hex('rpp-0544-generated-signing-key'),
    request,
  };
}

function authenticateSignedRequest({ headers, rawBody, requireSession = false }) {
  if (headers.authorization !== basicAuth()) {
    return 'reprint_push_lab_auth_required';
  }

  const requiredHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredHeaders.some((header) => !headers[header])) {
    return 'SIGNED_HEADER_REQUIRED';
  }

  if (headers['x-auth-content-hash'] !== sha256Hex(rawBody)) {
    return 'SIGNED_CONTENT_HASH_MISMATCH';
  }

  if (!requireSession) {
    return null;
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return 'SIGNED_SESSION_INVALID';
  }
  if (headers['x-reprint-push-idempotency-key'] !== idempotencyKey) {
    return 'SIGNED_IDEMPOTENCY_KEY_REQUIRED';
  }

  return null;
}

function createGeneratedApplyRoute() {
  const currentSnapshot = {
    files: { [resourcePath]: 'rpp-0544-live-source-before-apply' },
    plugins: {},
    db: {},
  };
  const state = {
    events: [],
    requests: [],
    jsonParseAttempts: 0,
    liveSourceRevalidations: 0,
    mutationExecutorEntries: 0,
    mutationApplications: 0,
  };

  function appendEvent(event, payload = {}) {
    const entry = {
      sequence: state.events.length + 1,
      event,
      ...payload,
    };
    state.events.push(entry);
    return entry;
  }

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const pathname = requestUrl.pathname;
    const method = options.method || 'GET';
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const headers = headerEntries(options.headers || {});
    state.requests.push({ method, pathname, rawBody, headers });

    if (pathname === `${routePrefix}/preflight`) {
      const authError = authenticateSignedRequest({ headers, rawBody });
      if (authError) {
        return jsonResponse({ ok: false, mode: 'preflight', code: authError }, 401);
      }
      return jsonResponse({
        ok: true,
        mode: 'preflight',
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: true,
        },
        auth: authEnvelope(),
        session: {
          id: sessionId,
          type: 'production-auth-session',
          expiresAt: freshExpiresAt,
        },
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      const authError = authenticateSignedRequest({ headers, rawBody, requireSession: true });
      if (authError) {
        return jsonResponse({ ok: false, mode: 'dry-run', code: authError }, 401);
      }

      state.jsonParseAttempts += 1;
      const body = JSON.parse(rawBody);
      const receipt = receiptForPlan(body.plan, { rawBody, headers });
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: authEnvelope(),
        receipt,
        signedRequest: signedRequestEvidence(pathname, headers['x-auth-content-hash'], headers),
      });
    }

    if (pathname === endpointPath) {
      const authError = authenticateSignedRequest({ headers, rawBody, requireSession: true });
      if (authError) {
        return jsonResponse({
          ok: false,
          mode: 'apply',
          code: authError,
          idempotency: {
            replayed: false,
            conflict: false,
            freshMutationWork: false,
            idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key'] || ''),
            requestHash: sha256Hex(rawBody),
          },
        }, 401);
      }

      state.jsonParseAttempts += 1;
      const body = JSON.parse(rawBody);
      const started = appendEvent('apply-started', {
        requestHash: headers['x-auth-content-hash'],
      });
      state.liveSourceRevalidations += 1;
      const applyRevalidation = applyRevalidationEvidence({
        plan: body.plan,
        receipt: body.receipt,
        currentSnapshot,
        startedSequence: started.sequence,
      });
      appendEvent('live-source-revalidated', {
        phase: applyRevalidation.phase,
        checkedAgainst: applyRevalidation.checkedAgainst,
        snapshotHash: applyRevalidation.liveSource.snapshotHash,
      });
      state.mutationExecutorEntries += 1;
      appendEvent('mutation-executor-entered', {
        mutationSetHash: applyRevalidation.mutationSetHash,
      });
      for (const mutation of body.plan.mutations) {
        state.mutationApplications += 1;
        appendEvent('mutation-applied', {
          mutationIdHash: sha256Hex(mutation.id),
          resourceKeyHash: sha256Hex(mutation.resourceKey),
        });
      }
      appendEvent('apply-committed', {
        applied: body.plan.mutations.length,
      });

      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: body.plan.mutations.length,
        responseSchemaVersion: 1,
        auth: authEnvelope(),
        receipt: body.receipt,
        idempotency: {
          replayed: false,
          conflict: false,
          freshMutationWork: true,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: headers['x-auth-content-hash'],
        },
        signedRequest: signedRequestEvidence(pathname, headers['x-auth-content-hash'], headers),
        applyRevalidation,
      });
    }

    throw new Error(`unexpected RPP-0544 route request: ${method} ${pathname}`);
  }

  return { currentSnapshot, state, fetchHandler };
}

function firstEventSequence(events, event) {
  const entry = events.find((item) => item.event === event);
  return Number.isInteger(entry?.sequence) ? entry.sequence : null;
}

function allHashFields(value, fields) {
  return fields.every((field) => hashPattern.test(String(value?.[field] || '')));
}

function resolveApplyRouteSupportCode({ apply, validRevalidation, revalidatedAfterClaim, beforeFirstMutation }) {
  if (!apply) {
    return 'APPLY_ROUTE_PROOF_REQUIRED';
  }
  if (!validRevalidation) {
    return 'APPLY_REVALIDATION_REQUIRED';
  }
  if (!revalidatedAfterClaim || !beforeFirstMutation) {
    return 'APPLY_REVALIDATION_ORDER_REQUIRED';
  }
  return 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY';
}

function buildApplyRouteSupportEvidence({
  apply = null,
  events = [],
  capturedAt = proofCapturedAt,
} = {}) {
  const body = apply?.body || {};
  const revalidation = body.applyRevalidation || {};
  const liveSource = revalidation.liveSource || {};
  const receiptBinding = revalidation.receiptBinding || {};
  const claim = revalidation.claim || {};
  const applyStartedSequence = firstEventSequence(events, 'apply-started');
  const liveRevalidationSequence = firstEventSequence(events, 'live-source-revalidated');
  const firstMutationSequence = firstEventSequence(events, 'mutation-applied');
  const commitSequence = firstEventSequence(events, 'apply-committed');
  const revalidatedAfterClaim = Number.isInteger(applyStartedSequence)
    && Number.isInteger(liveRevalidationSequence)
    && applyStartedSequence < liveRevalidationSequence;
  const beforeFirstMutation = Number.isInteger(liveRevalidationSequence)
    && Number.isInteger(firstMutationSequence)
    && liveRevalidationSequence < firstMutationSequence;
  const validRevalidation = apply?.status === 200
    && body.ok === true
    && body.mode === 'apply'
    && revalidation.required === 'fresh-live-hashes-before-first-mutation'
    && revalidation.phase === 'before-first-mutation'
    && revalidation.checkedAgainst === 'live-remote'
    && Number.isInteger(revalidation.mutationCount)
    && revalidation.mutationCount > 0
    && revalidation.verifiedCount === revalidation.mutationCount
    && body.applied === revalidation.mutationCount
    && claim.activeClaimSequence === applyStartedSequence
    && allHashFields(revalidation, [
      'planHash',
      'receiptHash',
      'preconditionSetHash',
      'mutationSetHash',
    ])
    && allHashFields(liveSource, [
      'snapshotHash',
      'sourceHash',
      'sourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'sourceBindingHash',
    ])
    && allHashFields(receiptBinding, [
      'planHash',
      'receiptHash',
      'mutationSetHash',
      'preconditionSetHash',
      'sourceHash',
      'sourceUrlHash',
      'sessionHash',
      'dryRunIdempotencyKeyHash',
      'dryRunContentHash',
    ]);
  const accepted = validRevalidation && revalidatedAfterClaim && beforeFirstMutation;
  const code = resolveApplyRouteSupportCode({
    apply,
    validRevalidation,
    revalidatedAfterClaim,
    beforeFirstMutation,
  });

  return {
    schemaVersion: 1,
    slice: 'RPP-0544',
    proofClass: 'generated-apply-route-revalidation-receipt',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    ok: accepted,
    status: accepted ? 'support_only' : 'blocked',
    code,
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceHash: sourceIdentity().sourceHash,
      sourceUrlHash: sourceIdentity().sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: sha256Hex(sessionId),
      manageOptions: true,
    },
    routeEvidence: {
      method: apply?.request?.method || 'POST',
      endpointPath,
      requestPath: apply?.request?.pathname || null,
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      proofHash: digest({
        method: apply?.request?.method || 'POST',
        endpointPath,
        requestPath: apply?.request?.pathname || null,
        status: apply?.status ?? null,
        code,
      }),
    },
    applyReceipt: {
      status: apply?.status ?? null,
      ok: body.ok === true,
      mode: body.mode || null,
      applied: body.applied ?? null,
      freshMutationWork: body.idempotency?.freshMutationWork === true,
      idempotencyKeyHash: body.idempotency?.idempotencyKeyHash || apply?.request?.idempotencyKeyHash || null,
      requestHash: body.idempotency?.requestHash || apply?.request?.contentHash || null,
      signedRequestHash: digest(body.signedRequest?.request || null),
    },
    revalidation: {
      required: revalidation.required || null,
      phase: revalidation.phase || null,
      checkedAgainst: revalidation.checkedAgainst || null,
      mutationCount: revalidation.mutationCount ?? null,
      verifiedCount: revalidation.verifiedCount ?? null,
      planHash: revalidation.planHash || null,
      receiptHash: revalidation.receiptHash || null,
      preconditionSetHash: revalidation.preconditionSetHash || null,
      mutationSetHash: revalidation.mutationSetHash || null,
      verifiedResourceKeysHash: digest(Array.isArray(revalidation.verifiedResourceKeys)
        ? revalidation.verifiedResourceKeys
        : []),
      snapshotHash: liveSource.snapshotHash || null,
      sourceHash: liveSource.sourceHash || null,
      sourceUrlHash: liveSource.sourceUrlHash || null,
      receiptSourceHash: liveSource.receiptSourceHash || null,
      receiptSourceUrlHash: liveSource.receiptSourceUrlHash || null,
      sourceBindingHash: liveSource.sourceBindingHash || null,
      dbJournalCursorHash: liveSource.dbJournalCursor ? sha256Hex(liveSource.dbJournalCursor) : null,
      activeClaimKeyHash: claim.activeClaimKeyHash || null,
    },
    ordering: {
      applyStartedSequence,
      liveRevalidationSequence,
      firstMutationSequence,
      commitSequence,
      revalidatedAfterClaim,
      beforeFirstMutation,
    },
    mutationAttempted: Number.isInteger(firstMutationSequence),
    releaseMovement: {
      allowed: false,
      gates: '0/1',
      reason: 'generated local apply-route proof is support-only until checked against production-owned URL and credentials',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed apply route revalidation proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function generatedApplyResponse(overrides = {}) {
  const plan = buildReadyApplyPlan();
  const receipt = receiptForPlan(plan, {
    rawBody: JSON.stringify({ plan }),
    headers: { 'x-auth-content-hash': sha256Hex(JSON.stringify({ plan })) },
  });
  const applyRevalidation = {
    ...applyRevalidationEvidence({
      plan,
      receipt,
      currentSnapshot: { files: { [resourcePath]: 'rpp-0544-current' }, plugins: {}, db: {} },
      startedSequence: 1,
    }),
    ...overrides.applyRevalidation,
  };
  return {
    status: overrides.status ?? 200,
    request: {
      method: 'POST',
      pathname: endpointPath,
      contentHash: sha256Hex('rpp-0544-apply-request'),
      idempotencyKeyHash: sha256Hex(idempotencyKey),
    },
    body: {
      ok: overrides.ok ?? true,
      mode: 'apply',
      applied: overrides.applied ?? plan.mutations.length,
      idempotency: {
        replayed: false,
        conflict: false,
        freshMutationWork: true,
        idempotencyKeyHash: sha256Hex(idempotencyKey),
        requestHash: sha256Hex('rpp-0544-apply-request'),
      },
      signedRequest: signedRequestEvidence(
        endpointPath,
        sha256Hex('rpp-0544-apply-request'),
        {
          'x-auth-timestamp': '1780000000',
          'x-auth-nonce': 'rpp0544nonce',
          'x-reprint-push-session': sessionId,
          'x-reprint-push-idempotency-key': idempotencyKey,
        },
      ),
      applyRevalidation,
    },
  };
}

function generatedApplyEvents(overrides = {}) {
  const order = overrides.order || [
    'apply-started',
    'live-source-revalidated',
    'mutation-executor-entered',
    'mutation-applied',
    'apply-committed',
  ];
  return order.map((event, index) => ({
    sequence: index + 1,
    event,
  }));
}

function assertHashFields(value, fields) {
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

test('RPP-0544 v3 keeps production apply live-source revalidation before mutation execution', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/apply',
  );
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const liveRevalidation = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_apply'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assertBefore(
    authenticatedApply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    authenticatedApply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assertBefore(
    runDbJournalApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    liveRevalidation,
    '$current_source = reprint_push_lab_rest_apply_live_source_binding_evidence($request, $accepted);',
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    liveRevalidation,
    '$current = reprint_push_export_snapshot();',
    'reprint_push_protocol_verify_preconditions(',
  );

  assert.match(liveRevalidation, /'phase'\s*=>\s*'before-first-mutation'/);
  assert.match(liveRevalidation, /'checkedAgainst'\s*=>\s*'live-remote'/);
  assert.match(liveRevalidation, /'snapshotHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$current\)\)/);
  assert.match(liveRevalidation, /'dbJournalCursor'\s*=>\s*\$db_journal_cursor/);

  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_apply_resource',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(
      liveRevalidation,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('RPP-0544 v3 accepts generated apply receipt only after live-source revalidation before mutation', async () => {
  const originalFetch = global.fetch;
  const route = createGeneratedApplyRoute();
  const plan = buildReadyApplyPlan();

  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight');
    const dryRun = await client.signedPost('/dry-run', { plan }, { session: preflight.body.session.id, idempotencyKey });
    const apply = await client.signedPost('/apply', {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session: preflight.body.session.id,
      idempotencyKey,
    });
    const evidence = buildApplyRouteSupportEvidence({
      apply,
      events: route.state.events,
    });

    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.auth.session.type, 'production-auth-session');
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.receipt.planHash, digest(plan));
    assert.equal(apply.status, 200);
    assert.equal(apply.request.pathname, endpointPath);
    assert.equal(apply.body.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(apply.body.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(apply.body.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(apply.body.applyRevalidation.planHash, dryRun.body.receipt.planHash);
    assert.equal(apply.body.applyRevalidation.receiptHash, dryRun.body.receipt.receiptHash);
    assert.equal(apply.body.applyRevalidation.mutationCount, plan.mutations.length);
    assert.equal(apply.body.applyRevalidation.verifiedCount, plan.mutations.length);
    assert.deepEqual(
      apply.body.applyRevalidation.verifiedResourceKeys,
      plan.mutations.map((mutation) => mutation.resourceKey),
    );
    assert.equal(apply.body.idempotency.freshMutationWork, true);
    assert.equal(route.state.liveSourceRevalidations, 1);
    assert.equal(route.state.mutationExecutorEntries, 1);
    assert.equal(route.state.mutationApplications, 1);
    assert.deepEqual(
      route.state.events.map((entry) => entry.event),
      [
        'apply-started',
        'live-source-revalidated',
        'mutation-executor-entered',
        'mutation-applied',
        'apply-committed',
      ],
    );

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.code, 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.applyReceipt.freshMutationWork, true);
    assert.equal(evidence.revalidation.phase, 'before-first-mutation');
    assert.equal(evidence.revalidation.checkedAgainst, 'live-remote');
    assert.equal(evidence.ordering.revalidatedAfterClaim, true);
    assert.equal(evidence.ordering.beforeFirstMutation, true);
    assert.equal(evidence.mutationAttempted, true);
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashFields(evidence.sourceSummary, ['sourceHash', 'sourceUrlHash']);
    assertHashFields(evidence.authSummary, ['credentialHash', 'userLoginHash', 'sessionIdHash']);
    assertHashFields(evidence.routeEvidence, ['proofHash']);
    assertHashFields(evidence.applyReceipt, ['idempotencyKeyHash', 'requestHash', 'signedRequestHash']);
    assertHashFields(evidence.revalidation, [
      'planHash',
      'receiptHash',
      'preconditionSetHash',
      'mutationSetHash',
      'verifiedResourceKeysHash',
      'snapshotHash',
      'sourceHash',
      'sourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'sourceBindingHash',
      'dbJournalCursorHash',
      'activeClaimKeyHash',
    ]);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      resourcePath,
      resourceKey,
      route.currentSnapshot.files[resourcePath],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0544 v3 blocks missing or post-mutation revalidation receipts before release movement', () => {
  const missing = buildApplyRouteSupportEvidence();
  const postMutationRevalidation = buildApplyRouteSupportEvidence({
    apply: generatedApplyResponse({
      applyRevalidation: {
        phase: 'after-first-mutation',
      },
    }),
    events: generatedApplyEvents({
      order: [
        'apply-started',
        'mutation-applied',
        'live-source-revalidated',
        'apply-committed',
      ],
    }),
  });
  const underVerified = buildApplyRouteSupportEvidence({
    apply: generatedApplyResponse({
      applyRevalidation: {
        verifiedCount: 0,
      },
    }),
    events: generatedApplyEvents(),
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'APPLY_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(postMutationRevalidation.ok, false);
  assert.equal(postMutationRevalidation.status, 'blocked');
  assert.equal(postMutationRevalidation.code, 'APPLY_REVALIDATION_REQUIRED');
  assert.equal(postMutationRevalidation.revalidation.phase, 'after-first-mutation');
  assert.equal(postMutationRevalidation.ordering.beforeFirstMutation, false);
  assert.equal(postMutationRevalidation.releaseStatus, 'NO-GO');
  assert.equal(postMutationRevalidation.releaseMovement.allowed, false);

  assert.equal(underVerified.ok, false);
  assert.equal(underVerified.status, 'blocked');
  assert.equal(underVerified.code, 'APPLY_REVALIDATION_REQUIRED');
  assert.equal(underVerified.revalidation.verifiedCount, 0);
  assert.equal(underVerified.releaseStatus, 'NO-GO');
  assert.equal(underVerified.releaseMovement.allowed, false);

  for (const evidence of [missing, postMutationRevalidation, underVerified]) {
    assert.equal(evidence.redaction.rawValuesIncluded, false);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      resourcePath,
      resourceKey,
    ]);
  }
});
