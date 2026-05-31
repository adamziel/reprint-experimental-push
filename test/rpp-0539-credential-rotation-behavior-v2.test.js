import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authenticatedHttpClient,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const authScope = 'reprint-push-lab:authenticated-http-push';
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000539';
const futureExpiry = '2030-01-01T00:00:00Z';
const sha256Pattern = /^[a-f0-9]{64}$/;

const credentials = {
  old: {
    username: 'reprint_push_admin',
    password: 'rpp-0539-old-application-password',
  },
  rotated: {
    username: 'reprint_push_admin',
    password: 'rpp-0539-rotated-application-password',
  },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function credentialHash(credential) {
  return sha256Hex(`${credential.username}\n${credential.password}`);
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0539:${label}`);
}

function cloneJson(value) {
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

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function headerEntries(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function credentialKind(headers) {
  const authorization = String(headers.authorization || '');
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return 'missing';
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  if (decoded === `${credentials.old.username}:${credentials.old.password}`) {
    return 'old';
  }
  if (decoded === `${credentials.rotated.username}:${credentials.rotated.password}`) {
    return 'rotated';
  }
  return 'unknown';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function signedRequest(pathname, contentHash, headers) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: fixtureHash('signed-session'),
    signingKeyHash: fixtureHash('rotated-signing-key'),
    request: {
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
    },
  };
}

function rotatedAuthEnvelope() {
  return {
    identity: {
      userId: 539,
      userLogin: credentials.rotated.username,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: futureExpiry,
      applicationPasswordUuid: 'app-pass-rpp-0539-rotated',
      credentialHash: credentialHash(credentials.rotated),
      revoked: false,
      cleanedUp: false,
      playgroundFallback: false,
    },
  };
}

function sourceIdentity() {
  return {
    sourceHash: fixtureHash('live-source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    restNamespace: 'reprint/v1',
    routeProfile: 'production-shaped',
    labBacked: false,
  };
}

function withBindingHash(binding) {
  return {
    ...binding,
    bindingHash: digest(binding),
  };
}

function withIssueHash(issue) {
  return {
    ...issue,
    issueHash: digest(issue),
  };
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

function receiptForPlan(plan, idempotencyKey, dryRunRawBodyHash) {
  const auth = rotatedAuthEnvelope();
  const source = sourceIdentity();
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(auth.identity);
  const authSessionHash = digest(auth.session);
  const pushSessionHash = fixtureHash('push-session');
  const signingKeyHash = fixtureHash('rotated-signing-key');
  const scopeHash = sha256Hex(authScope);
  const subjectBinding = withBindingHash({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash,
  });
  const sessionUser = withBindingHash({
    schemaVersion: 1,
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: auth.identity.userId,
    userLoginHash: sha256Hex(auth.identity.userLogin),
    identityHash,
    authSessionHash,
    pushSessionHash,
    manageOptions: true,
  });
  const issue = withIssueHash({
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: pushSessionHash,
    signingKeyHash,
    scopeHash,
    identityHash,
    userIdentityHash: fixtureHash('user-identity'),
    requiredCapability: 'manage_options',
    capabilityHash: fixtureHash('capability-granted'),
    sourceHash: source.sourceHash,
    sourceUrlHash: source.sourceUrlHash,
    credentialHash: auth.session.credentialHash,
    issuedAt: '2026-05-30T00:00:00Z',
    expiresAt: auth.session.expiresAt,
    ttlSeconds: 300,
  });
  const receipt = {
    planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      scope: authScope,
      planHash,
      binding: subjectBinding,
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash,
        issue,
        dryRunNonceHash: fixtureHash('dry-run-nonce'),
        dryRunContentHash: dryRunRawBodyHash,
        dryRunCanonicalHash: fixtureHash('dry-run-canonical'),
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
      },
      sessionUser,
      source,
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: `${routePrefix}/dry-run`,
        routeProfile: 'production-shaped',
        labBacked: false,
        planHash,
        planPayloadHash: planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash,
      },
      plan: {
        schemaVersion: 1,
        planHash,
        planPayloadHash: planHash,
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
      },
      snapshotHashes: {
        schemaVersion: 1,
        required: 'dry-run receipt binds snapshot hash preconditions as planning evidence only',
        planningOnly: true,
        snapshotIdHash: fixtureHash('snapshot-id'),
        coverageHash: fixtureHash('coverage'),
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
        planHash,
      },
      issuedAt: '2026-05-30T00:00:00Z',
      expiresAt: auth.session.expiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function applyRevalidationEvidence({ plan, receipt, currentSnapshot, verifiedCount }) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const evidence = planEvidence(plan);
  const source = sourceIdentity();
  const receiptSource = receipt.authBinding.source;
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
    dbJournalCursor: 'db-journal:1',
  };

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
    verifiedCount,
    verifiedResourceKeys: [],
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
      activeClaimKeyHash: fixtureHash('active-claim-key'),
      activeClaimSequence: 1,
      staleClaimRetry: false,
    },
  };
}

function preconditionFailureEvidence({ plan, currentSnapshot, requestHash }) {
  const mutation = plan.mutations[0];
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === mutation.resourceKey);
  const expectedHash = precondition?.expectedHash || mutation.remoteBeforeHash;
  const actualHash = resourceHash(currentSnapshot, mutation.resource);
  assert.notEqual(actualHash, expectedHash, 'fixture must simulate stale live-source drift');

  return {
    schemaVersion: 1,
    code: 'PRECONDITION_FAILED',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    resourceKeyHash: sha256Hex(mutation.resourceKey),
    expectedHash,
    actualHash,
    requestHash,
  };
}

function assertBareSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} must be a bare sha256 digest`);
}

function assertHashFields(value, fields) {
  for (const field of fields) {
    assertBareSha256(value[field], field);
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

test('RPP-0539 v2 route keeps credential and source revalidation ahead of mutation setup', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const revalidateLiveSource = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');

  assertBefore(
    authenticatedApply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    '$payload = reprint_push_lab_rest_json_payload($request);',
  );
  assertBefore(
    authenticatedApply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload);',
    'reprint_push_lab_rest_apply_with_db_journal($request, true);',
  );
  assert.match(validateReceipt, /\$session\['credentialHash'\]/);
  assert.match(validateReceipt, /\$session\['applicationPasswordUuid'\]/);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assert.match(validateReceipt, /Receipt source binding does not match the current live source\./);

  assert.match(verifySignedRequest, /'SIGNED_SESSION_BINDING_MISMATCH'/);
  assertBefore(
    verifySignedRequest,
    "$session['credentialHash']",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "$session['sourceHash']",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "'SIGNED_SESSION_BINDING_MISMATCH'",
    'reprint_push_lab_rest_claim_signed_nonce',
  );

  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    revalidateLiveSource,
    "'AUTH_SOURCE_BINDING_MISMATCH'",
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    revalidateLiveSource,
    '$current = reprint_push_export_snapshot();',
    'reprint_push_protocol_verify_preconditions(',
  );

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
      revalidateLiveSource,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('RPP-0539 v2 proves rotated receipt binding and stale live-source rejection without mutation setup', async () => {
  const originalFetch = global.fetch;
  const idempotencyKey = 'idem-rpp-0539-credential-rotation-v2';
  const filePath = 'wp-content/uploads/reprint-push/rpp-0539-credential-rotation.txt';
  const base = {
    files: { [filePath]: 'rpp-0539-private-base-credential-state' },
    plugins: {},
    db: {},
  };
  const local = {
    files: { [filePath]: 'rpp-0539-private-local-credential-state' },
    plugins: {},
    db: {},
  };
  const staleRemote = {
    files: { [filePath]: 'rpp-0539-private-stale-live-source-state' },
    plugins: {},
    db: {},
  };
  const seen = [];
  let dryRunPlan = null;
  let dryRunReceipt = null;
  let staleRevalidation = null;
  let oldCredentialRejection = null;
  let liveRevalidationCount = 0;
  let mutationSetupCount = 0;
  let mutationWorkCount = 0;

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex('');
    const kind = credentialKind(headers);
    seen.push({ pathname, rawBody, body, headers, credentialKind: kind });

    if (pathname === `${routePrefix}/preflight`) {
      if (kind === 'old') {
        oldCredentialRejection = {
          phase: 'preflight',
          code: 'reprint_push_lab_auth_required',
          status: 401,
          observedCredentialHash: credentialHash(credentials.old),
          expectedCredentialHash: credentialHash(credentials.rotated),
          mutationSetupCount,
        };
        return jsonResponse({
          ok: false,
          code: oldCredentialRejection.code,
          credentialRotation: oldCredentialRejection,
        }, 401);
      }

      assert.equal(kind, 'rotated');
      return jsonResponse({
        ok: true,
        auth: rotatedAuthEnvelope(),
        session: { id: sessionId, expiresAt: futureExpiry },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      assert.equal(kind, 'rotated');
      return jsonResponse({
        ok: true,
        snapshot: cloneJson(base),
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      assert.equal(kind, 'rotated');
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(body.plan, idempotencyKey, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: rotatedAuthEnvelope(),
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash, headers),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));

      if (kind === 'old') {
        oldCredentialRejection = {
          phase: 'apply-signed-session-binding',
          code: 'SIGNED_SESSION_BINDING_MISMATCH',
          status: 401,
          observedCredentialHash: credentialHash(credentials.old),
          expectedCredentialHash: credentialHash(credentials.rotated),
          requestHash: contentHash,
          mutationSetupCount,
          mutationWorkCount,
        };
        return jsonResponse({
          ok: false,
          mode: 'apply',
          code: oldCredentialRejection.code,
          credentialRotation: oldCredentialRejection,
          idempotency: {
            replayed: false,
            conflict: false,
            freshMutationWork: false,
            idempotencyKeyHash: sha256Hex(idempotencyKey),
            requestHash: contentHash,
          },
          signedRequest: signedRequest(pathname, contentHash, headers),
        }, 401);
      }

      assert.equal(kind, 'rotated');
      liveRevalidationCount += 1;
      staleRevalidation = preconditionFailureEvidence({
        plan: body.plan,
        currentSnapshot: staleRemote,
        requestHash: contentHash,
      });
      const applyRevalidation = applyRevalidationEvidence({
        plan: body.plan,
        receipt: body.receipt,
        currentSnapshot: staleRemote,
        verifiedCount: 0,
      });
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: 'PRECONDITION_FAILED',
        applied: 0,
        responseSchemaVersion: 1,
        auth: rotatedAuthEnvelope(),
        receipt: body.receipt,
        idempotency: {
          replayed: false,
          conflict: false,
          freshMutationWork: false,
          status: 'precondition-failed',
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash, headers),
        applyRevalidation,
        rejectedRemoteEvidence: staleRevalidation,
      }, 409);
    }

    mutationSetupCount += 1;
    mutationWorkCount += 1;
    throw new Error(`unexpected mutation setup path for RPP-0539: ${pathname}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: credentials.rotated.username,
      applicationPassword: credentials.rotated.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRECONDITION_FAILED');
    assert.equal(summary.apply.status, 409);
    assert.equal(summary.apply.code, 'PRECONDITION_FAILED');
    assert.equal(summary.apply.applied, 0);
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.equal(summary.apply.idempotency.replayed, false);
    assert.equal(summary.apply.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(summary.apply.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(summary.apply.applyRevalidation.planHash, dryRunReceipt.planHash);
    assert.equal(summary.apply.applyRevalidation.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(summary.apply.applyRevalidation.mutationCount, dryRunPlan.mutations.length);
    assert.equal(summary.apply.applyRevalidation.verifiedCount, 0);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.replay, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameUser, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameSession, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sessionUserBindingPresent, true);
    assert.equal(liveRevalidationCount, 1);
    assert.equal(mutationSetupCount, 0);
    assert.equal(mutationWorkCount, 0);

    assert.equal(dryRunReceipt.authBinding.session.credentialHash, credentialHash(credentials.rotated));
    assert.notEqual(dryRunReceipt.authBinding.session.credentialHash, credentialHash(credentials.old));
    assert.equal(dryRunReceipt.authBinding.pushSession.issue.credentialHash, credentialHash(credentials.rotated));
    assert.equal(dryRunReceipt.authBinding.session.applicationPasswordUuid, 'app-pass-rpp-0539-rotated');
    assert.equal(dryRunReceipt.authBinding.pushSession.dryRunIdempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(dryRunReceipt.authBinding.source.sourceHash, sourceIdentity().sourceHash);
    assert.equal(dryRunReceipt.authBinding.source.sourceUrlHash, sourceIdentity().sourceUrlHash);
    assert.equal(staleRevalidation.code, 'PRECONDITION_FAILED');
    assert.equal(staleRevalidation.phase, 'before-first-mutation');
    assert.equal(staleRevalidation.checkedAgainst, 'live-remote');
    assert.notEqual(staleRevalidation.actualHash, staleRevalidation.expectedHash);

    const oldClient = authenticatedHttpClient({
      sourceUrl,
      credential: credentials.old,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1,
    });
    const oldPreflight = await oldClient.signedGet('/preflight');
    assert.equal(oldPreflight.status, 401);
    assert.equal(oldPreflight.body.code, 'reprint_push_lab_auth_required');
    const oldApply = await oldClient.signedPost('/apply', {
      plan: dryRunPlan,
      receipt: dryRunReceipt,
    }, {
      session: sessionId,
      idempotencyKey,
    });
    assert.equal(oldApply.status, 401);
    assert.equal(oldApply.body.code, 'SIGNED_SESSION_BINDING_MISMATCH');
    assert.equal(oldApply.body.idempotency.freshMutationWork, false);
    assert.equal(oldCredentialRejection.mutationSetupCount, 0);
    assert.equal(oldCredentialRejection.mutationWorkCount, 0);
    assert.deepEqual(
      seen.map((entry) => `${entry.credentialKind}:${entry.pathname}`),
      [
        `rotated:${routePrefix}/preflight`,
        `rotated:${routePrefix}/snapshot`,
        `rotated:${routePrefix}/dry-run`,
        `rotated:${routePrefix}/apply`,
        `old:${routePrefix}/preflight`,
        `old:${routePrefix}/apply`,
      ],
    );

    const supportEvidence = {
      schemaVersion: 1,
      oldCredentialRejected: {
        status: oldApply.status,
        code: oldApply.body.code,
        observedCredentialHash: credentialHash(credentials.old),
        expectedCredentialHash: credentialHash(credentials.rotated),
        requestHash: oldCredentialRejection.requestHash,
        mutationSetupCount: oldCredentialRejection.mutationSetupCount,
        mutationWorkCount: oldCredentialRejection.mutationWorkCount,
      },
      rotatedReceiptBinding: {
        credentialHash: dryRunReceipt.authBinding.session.credentialHash,
        applicationPasswordUuidHash: sha256Hex(dryRunReceipt.authBinding.session.applicationPasswordUuid),
        receiptHash: dryRunReceipt.receiptHash,
        planHash: dryRunReceipt.planHash,
        sessionHash: dryRunReceipt.authBinding.pushSession.sessionHash,
        userLoginHash: dryRunReceipt.authBinding.sessionUser.userLoginHash,
        dryRunContentHash: dryRunReceipt.authBinding.pushSession.dryRunContentHash,
        dryRunIdempotencyKeyHash: dryRunReceipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
      },
      staleLiveSourceRevalidation: {
        code: summary.apply.code,
        phase: summary.apply.applyRevalidation.phase,
        checkedAgainst: summary.apply.applyRevalidation.checkedAgainst,
        planHash: summary.apply.applyRevalidation.planHash,
        receiptHash: summary.apply.applyRevalidation.receiptHash,
        resourceKeyHash: staleRevalidation.resourceKeyHash,
        expectedHash: staleRevalidation.expectedHash,
        actualHash: staleRevalidation.actualHash,
        sourceBindingHash: applyRevalidationEvidence({
          plan: dryRunPlan,
          receipt: dryRunReceipt,
          currentSnapshot: staleRemote,
          verifiedCount: 0,
        }).liveSource.sourceBindingHash,
        mutationSetupCount,
        mutationWorkCount,
      },
    };

    assertHashFields(supportEvidence.oldCredentialRejected, [
      'observedCredentialHash',
      'expectedCredentialHash',
      'requestHash',
    ]);
    assertHashFields(supportEvidence.rotatedReceiptBinding, [
      'credentialHash',
      'applicationPasswordUuidHash',
      'receiptHash',
      'planHash',
      'sessionHash',
      'userLoginHash',
      'dryRunContentHash',
      'dryRunIdempotencyKeyHash',
    ]);
    assertHashFields(supportEvidence.staleLiveSourceRevalidation, [
      'planHash',
      'receiptHash',
      'resourceKeyHash',
      'expectedHash',
      'actualHash',
      'sourceBindingHash',
    ]);
    assertNoRawValues(supportEvidence, [
      credentials.old.password,
      credentials.rotated.password,
      credentials.rotated.username,
      idempotencyKey,
      sessionId,
      authScope,
      sourceUrl,
      filePath,
      base.files[filePath],
      local.files[filePath],
      staleRemote.files[filePath],
      dryRunReceipt.authBinding.session.applicationPasswordUuid,
    ]);
    assertNoRawValues(oldApply.body.credentialRotation, [
      credentials.old.password,
      credentials.rotated.password,
      idempotencyKey,
      sessionId,
      filePath,
    ]);
    assertNoRawValues(staleRevalidation, [
      credentials.old.password,
      credentials.rotated.password,
      idempotencyKey,
      sessionId,
      filePath,
      base.files[filePath],
      local.files[filePath],
      staleRemote.files[filePath],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
