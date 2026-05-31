import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000538';
const authScope = 'reprint-push:production-shaped:manage-options';
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const activeSession = {
  type: 'production-auth-session',
  status: 'active',
  id: sessionId,
  expiresAt: '2030-01-01T00:00:00Z',
};
const grantedAuth = {
  identity: {
    userId: 538,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: activeSession,
};
const downgradedAuth = {
  identity: {
    userId: grantedAuth.identity.userId,
    userLogin: credential.username,
    capabilities: { manage_options: false },
  },
  session: activeSession,
};

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

function fixtureHash(label) {
  return sha256Hex(`rpp-0538:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function headerEntries(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(grantedAuth.identity);
  const authSessionHash = digest(grantedAuth.session);
  const pushSessionHash = fixtureHash('push-session');
  const signingKeyHash = fixtureHash('signing-key');
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
    userId: grantedAuth.identity.userId,
    userLoginHash: sha256Hex(grantedAuth.identity.userLogin),
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
    sourceHash: fixtureHash('source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    issuedAt: '2026-05-30T00:00:00Z',
    expiresAt: grantedAuth.session.expiresAt,
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
      identity: cloneJson(grantedAuth.identity),
      session: cloneJson(grantedAuth.session),
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
      source: {
        sourceHash: fixtureHash('source'),
        sourceUrlHash: sha256Hex(sourceUrl),
        restNamespace: 'reprint/v1',
        routeProfile: 'production-shaped',
        labBacked: false,
      },
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
      expiresAt: grantedAuth.session.expiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
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

function capabilityDowngradeEvidence({ receipt, requestHash }) {
  return {
    schemaVersion: 1,
    code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
    phase: 'before-canonical-verification',
    scopeHash: sha256Hex(authScope),
    sessionHash: receipt.authBinding.pushSession.sessionHash,
    identityHash: receipt.authBinding.binding.identityHash,
    authSessionHash: receipt.authBinding.binding.authSessionHash,
    planHash: receipt.planHash,
    receiptHash: receipt.receiptHash,
    requestHash,
    requiredCapabilityHash: sha256Hex('manage_options'),
    issuedCapabilityHash: fixtureHash('capability-granted'),
    observedCapabilityHash: fixtureHash('capability-denied'),
    mutationEventCounts: {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    },
  };
}

function receiptBindingEvidence(receipt) {
  const binding = receipt.authBinding.binding;
  const issue = receipt.authBinding.pushSession.issue;
  const sessionUser = receipt.authBinding.sessionUser;

  return {
    receiptHash: receipt.receiptHash,
    planHash: receipt.planHash,
    scopeHash: sha256Hex(receipt.authBinding.scope),
    bindingHash: binding.bindingHash,
    identityHash: binding.identityHash,
    authSessionHash: binding.authSessionHash,
    pushSessionHash: binding.pushSessionHash,
    issueHash: issue.issueHash,
    issueIdentityHash: issue.identityHash,
    issueScopeHash: issue.scopeHash,
    sessionUserIdentityHash: sessionUser.identityHash,
    sessionUserBindingHash: sessionUser.bindingHash,
    dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
    dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
  };
}

function assertBareSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, `${label} must be a bare sha256 hex digest`);
}

function assertHashFields(value, labels) {
  for (const label of labels) {
    assertBareSha256(value[label], label);
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

test('RPP-0538 v2 route rejects downgraded signed sessions before mutation authority and validates receipt subject binding', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const capabilityMatches = functionBody('reprint_push_lab_rest_signed_session_capability_matches');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assert.match(capabilityMatches, /current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(capabilityMatches, /\$session\['requiredCapability'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityGranted'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityHash'\]/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_CAPABILITY_DOWNGRADED'/);
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    'reprint_push_lab_rest_claim_signed_nonce',
  );
  assertBefore(
    apply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\) \$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'sessionUser'\s*=>\s*reprint_push_lab_rest_authenticated_user_identity_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assert.match(validateReceipt, /Receipt session user identity binding does not match the current authenticated user\./);
});

test('RPP-0538 v2 proves downgrade rejection before mutation with hash-only bound receipt evidence', async () => {
  const originalFetch = global.fetch;
  const idempotencyKey = 'idem-rpp-0538-capability-downgrade-v2';
  const base = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0538.txt': 'base-capability-state',
    },
    plugins: {},
    db: {},
  };
  const local = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0538.txt': 'local-capability-state',
    },
    plugins: {},
    db: {},
  };
  const seen = [];
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let downgradeEvidence = null;
  let mutationSetupCount = 0;
  let mutationWorkCount = 0;

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
        auth: grantedAuth,
        session: { id: sessionId, expiresAt: grantedAuth.session.expiresAt },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: base,
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(body.plan, idempotencyKey, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: grantedAuth,
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      downgradeEvidence = capabilityDowngradeEvidence({
        receipt: body.receipt,
        requestHash: contentHash,
      });
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
        responseSchemaVersion: 1,
        auth: downgradedAuth,
        capabilityDowngrade: downgradeEvidence,
        idempotency: {
          conflict: false,
          replayed: false,
          freshMutationWork: false,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash),
      }, 403);
    }

    mutationSetupCount += 1;
    mutationWorkCount += 1;
    throw new Error(`unexpected mutation path after capability downgrade: ${urlString}`);
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
      now: fixedNow,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
    assert.equal(summary.apply.status, 403);
    assert.equal(summary.apply.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.equal(summary.apply.idempotency.replayed, false);
    assert.equal(summary.replay, null);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(mutationSetupCount, 0);
    assert.equal(mutationWorkCount, 0);
    assert.deepEqual(
      seen.map((entry) => entry.pathname),
      [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
        `${routePrefix}/apply`,
      ],
    );

    const dryRunRequest = seen.find((entry) => entry.pathname === `${routePrefix}/dry-run`);
    const applyRequest = seen.find((entry) => entry.pathname === `${routePrefix}/apply`);
    assert.ok(dryRunRequest);
    assert.ok(applyRequest);
    assert.equal(dryRunRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(applyRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(dryRunRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
    assert.equal(applyRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
    assert.equal(dryRunRequest.headers['x-auth-content-hash'], sha256Hex(dryRunRequest.rawBody));
    assert.equal(applyRequest.headers['x-auth-content-hash'], sha256Hex(applyRequest.rawBody));

    assert.equal(dryRunReceipt.planHash, digest(dryRunPlan));
    assert.equal(dryRunReceipt.authBinding.scope, authScope);
    assert.equal(dryRunReceipt.authBinding.planHash, dryRunReceipt.planHash);
    assert.equal(dryRunReceipt.authBinding.binding.planHash, dryRunReceipt.planHash);
    assert.equal(dryRunReceipt.authBinding.binding.scopeHash, sha256Hex(authScope));
    assert.equal(dryRunReceipt.authBinding.binding.identityHash, digest(grantedAuth.identity));
    assert.equal(dryRunReceipt.authBinding.binding.authSessionHash, digest(grantedAuth.session));
    assert.equal(
      dryRunReceipt.authBinding.pushSession.issue.identityHash,
      dryRunReceipt.authBinding.binding.identityHash,
    );
    assert.equal(
      dryRunReceipt.authBinding.pushSession.issue.scopeHash,
      dryRunReceipt.authBinding.binding.scopeHash,
    );
    assert.equal(
      dryRunReceipt.authBinding.sessionUser.identityHash,
      dryRunReceipt.authBinding.binding.identityHash,
    );
    assert.equal(
      dryRunReceipt.authBinding.sessionUser.pushSessionHash,
      dryRunReceipt.authBinding.binding.pushSessionHash,
    );
    assert.equal(dryRunReceipt.authBinding.sessionUser.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameUser, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameSession, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sessionUserBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.receipt.receiptHash, dryRunReceipt.receiptHash);

    const receiptEvidence = receiptBindingEvidence(dryRunReceipt);
    assertHashFields(receiptEvidence, [
      'receiptHash',
      'planHash',
      'scopeHash',
      'bindingHash',
      'identityHash',
      'authSessionHash',
      'pushSessionHash',
      'issueHash',
      'issueIdentityHash',
      'issueScopeHash',
      'sessionUserIdentityHash',
      'sessionUserBindingHash',
      'dryRunContentHash',
      'dryRunIdempotencyKeyHash',
    ]);
    assertHashFields(downgradeEvidence, [
      'scopeHash',
      'sessionHash',
      'identityHash',
      'authSessionHash',
      'planHash',
      'receiptHash',
      'requestHash',
      'requiredCapabilityHash',
      'issuedCapabilityHash',
      'observedCapabilityHash',
    ]);
    assert.deepEqual(downgradeEvidence.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });
    assert.equal(downgradeEvidence.planHash, dryRunReceipt.planHash);
    assert.equal(downgradeEvidence.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(downgradeEvidence.requestHash, applyRequest.headers['x-auth-content-hash']);
    assert.equal(summary.apply.idempotency.idempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(summary.apply.idempotency.requestHash, applyRequest.headers['x-auth-content-hash']);

    assertNoRawValues({
      receiptEvidence,
      downgradeEvidence,
      applyIdempotency: summary.apply.idempotency,
    }, [
      idempotencyKey,
      credential.password,
      sessionId,
      credential.username,
      authScope,
      'manage_options',
      base.files['wp-content/uploads/reprint-push/rpp-0538.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0538.txt'],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
