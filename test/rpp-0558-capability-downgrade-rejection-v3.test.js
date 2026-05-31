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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0558-capability-downgrade-rejection-v3.md');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const requiredCapability = 'manage_options';
const sessionId = 'psh_01j00000000000000000558';
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
    userId: 558,
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

function fixtureHash(label) {
  return sha256Hex(`rpp-0558:${label}`);
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
  const capabilityHash = fixtureHash('capability-granted');
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
    requiredCapability,
    capabilityHash,
    sourceHash: fixtureHash('source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    issuedAt: '2026-05-31T00:00:00Z',
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
      issuedAt: '2026-05-31T00:00:00Z',
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

function capabilityDowngradeEvidence({
  receipt,
  requestHash,
  caseLabel = 'observed-denied-current-user',
  observedCapabilityHash = fixtureHash('capability-denied'),
}) {
  return {
    schemaVersion: 1,
    caseHash: fixtureHash(caseLabel),
    code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
    phase: 'before-canonical-verification',
    authorization: 'mutation-authority-denied',
    scopeHash: sha256Hex(authScope),
    sessionHash: receipt.authBinding.pushSession.sessionHash,
    identityHash: receipt.authBinding.binding.identityHash,
    authSessionHash: receipt.authBinding.binding.authSessionHash,
    planHash: receipt.planHash,
    receiptHash: receipt.receiptHash,
    requestHash,
    requiredCapabilityHash: sha256Hex(requiredCapability),
    issuedCapabilityHash: receipt.authBinding.pushSession.issue.capabilityHash,
    observedCapabilityHash,
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
    schemaVersion: 1,
    receiptHash: receipt.receiptHash,
    planHash: receipt.planHash,
    scopeHash: sha256Hex(receipt.authBinding.scope),
    bindingHash: binding.bindingHash,
    identityHash: binding.identityHash,
    authSessionHash: binding.authSessionHash,
    pushSessionHash: binding.pushSessionHash,
    issueHash: issue.issueHash,
    issueSessionHash: issue.sessionHash,
    issueIdentityHash: issue.identityHash,
    issueScopeHash: issue.scopeHash,
    issueRequiredCapabilityHash: sha256Hex(issue.requiredCapability),
    issueCapabilityHash: issue.capabilityHash,
    sessionUserIdentityHash: sessionUser.identityHash,
    sessionUserBindingHash: sessionUser.bindingHash,
    dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
    dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
    binds: {
      samePlan: receipt.authBinding.planHash === receipt.planHash
        && binding.planHash === receipt.planHash,
      sameScope: binding.scopeHash === issue.scopeHash,
      sameIdentity: binding.identityHash === issue.identityHash
        && binding.identityHash === sessionUser.identityHash,
      sameSession: binding.pushSessionHash === issue.sessionHash
        && binding.pushSessionHash === sessionUser.pushSessionHash,
      requiredCapability: issue.requiredCapability === requiredCapability,
      capabilityHashPresent: hashPattern.test(issue.capabilityHash),
    },
  };
}

function buildSupportEnvelope({ receiptEvidence, downgradeCases }) {
  const rejectedCases = downgradeCases.map((downgrade) => ({
    caseHash: downgrade.caseHash,
    code: downgrade.code,
    scopeHash: downgrade.scopeHash,
    sessionHash: downgrade.sessionHash,
    identityHash: downgrade.identityHash,
    authSessionHash: downgrade.authSessionHash,
    planHash: downgrade.planHash,
    receiptHash: downgrade.receiptHash,
    requestHash: downgrade.requestHash,
    requiredCapabilityHash: downgrade.requiredCapabilityHash,
    issuedCapabilityHash: downgrade.issuedCapabilityHash,
    observedCapabilityHash: downgrade.observedCapabilityHash,
    mutationEventCounts: { ...downgrade.mutationEventCounts },
  }));
  const supportOk = Boolean(
    receiptEvidence.binds.samePlan
      && receiptEvidence.binds.sameScope
      && receiptEvidence.binds.sameIdentity
      && receiptEvidence.binds.sameSession
      && receiptEvidence.binds.requiredCapability
      && receiptEvidence.binds.capabilityHashPresent
      && rejectedCases.every((entry) =>
        entry.code === 'SIGNED_SESSION_CAPABILITY_DOWNGRADED'
        && entry.mutationEventCounts.prepared === 0
        && entry.mutationEventCounts.applied === 0
        && entry.mutationEventCounts.preconditionFailed === 0),
  );

  return {
    sliceHash: sha256Hex('RPP-0558'),
    variantHash: sha256Hex('capability-downgrade-rejection-v3'),
    evidenceScope: 'local-generated-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportStatus: supportOk ? 'support-only-bound-rejected' : 'support-only-blocked',
    routeProfileHash: sha256Hex('production-shaped'),
    dryRunReceipt: receiptEvidence,
    downgradeRejections: rejectedCases,
    releaseMovement: {
      allowed: false,
      reasonHash: supportOk
        ? fixtureHash('local-support-proof-only')
        : fixtureHash('receipt-or-downgrade-binding-incomplete'),
    },
  };
}

function assertBareSha256(value, label) {
  assert.match(value, hashPattern, `${label} must be a bare sha256 hex digest`);
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

function assertHashOnlySupportEnvelope(envelope) {
  function visit(value) {
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'scope', 'support envelope must not expose raw scopes');
      assert.notEqual(key, 'identity', 'support envelope must not expose raw identities');
      assert.notEqual(key, 'session', 'support envelope must not expose raw sessions');
      assert.notEqual(key, 'sessionId', 'support envelope must not expose raw session ids');
      assert.notEqual(key, 'userId', 'support envelope must not expose raw user ids');
      assert.notEqual(key, 'userLogin', 'support envelope must not expose raw user logins');
      assert.notEqual(key, 'sourceUrl', 'support envelope must not expose raw URLs');
      assert.notEqual(key, 'plan', 'support envelope must not expose raw plans');
      assert.notEqual(key, 'requestBody', 'support envelope must not expose raw request bodies');
      visit(child);
    }
  }
  visit(envelope);
}

test('RPP-0558 v3 route rejects downgraded capability evidence before mutation authority and validates receipt capability binding', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const capabilityMatches = functionBody('reprint_push_lab_rest_signed_session_capability_matches');
  const signedRequestEvidence = functionBody('reprint_push_lab_rest_signed_request_evidence');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assert.match(routeSource, /const REPRINT_PUSH_LAB_REQUIRED_CAPABILITY = 'manage_options';/);
  assert.match(capabilityMatches, /current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(capabilityMatches, /\$session\['requiredCapability'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityGranted'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityHash'\]/);
  assert.match(capabilityMatches, /reprint_push_lab_rest_signed_capability_hash\(\)/);
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

  assert.match(signedRequestEvidence, /'requiredCapability'\s*=>\s*\(string\) \(\$session\['requiredCapability'\]/);
  assert.match(signedRequestEvidence, /'capabilityHash'\s*=>\s*\(string\) \(\$session\['capabilityHash'\]/);
  assert.match(issueBinding, /'requiredCapability'\s*=>\s*\(string\) \(\$session\['requiredCapability'\]/);
  assert.match(issueBinding, /'capabilityHash'\s*=>\s*\(string\) \(\$session\['capabilityHash'\]/);
  assert.match(issueBinding, /\$issue\['issueHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$issue\)\)/);
  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\) \$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt session user identity binding does not match the current authenticated user.',
  );
});

test('RPP-0558 v3 generated flow rejects capability downgrade before mutation and binds dry-run receipt hashes', async () => {
  const originalFetch = global.fetch;
  const idempotencyKey = 'idem-rpp-0558-capability-downgrade-v3';
  const base = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0558.txt': 'base-capability-state-rpp-0558',
    },
    plugins: {},
    db: {},
  };
  const local = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0558.txt': 'local-capability-state-rpp-0558',
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
    assert.equal(dryRunReceipt.authBinding.pushSession.issue.requiredCapability, requiredCapability);
    assert.equal(dryRunReceipt.authBinding.pushSession.issue.capabilityHash, fixtureHash('capability-granted'));
    assert.equal(
      dryRunReceipt.authBinding.pushSession.issue.identityHash,
      dryRunReceipt.authBinding.binding.identityHash,
    );
    assert.equal(
      dryRunReceipt.authBinding.pushSession.issue.scopeHash,
      dryRunReceipt.authBinding.binding.scopeHash,
    );
    assert.equal(
      dryRunReceipt.authBinding.pushSession.issue.sessionHash,
      dryRunReceipt.authBinding.binding.pushSessionHash,
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
    const downgradeCases = [
      downgradeEvidence,
      capabilityDowngradeEvidence({
        receipt: dryRunReceipt,
        requestHash: applyRequest.headers['x-auth-content-hash'],
        caseLabel: 'required-capability-grant-removed',
        observedCapabilityHash: fixtureHash('capability-grant-removed'),
      }),
      capabilityDowngradeEvidence({
        receipt: dryRunReceipt,
        requestHash: applyRequest.headers['x-auth-content-hash'],
        caseLabel: 'capability-hash-mismatch',
        observedCapabilityHash: fixtureHash('capability-hash-mismatch'),
      }),
    ];
    const supportEnvelope = buildSupportEnvelope({ receiptEvidence, downgradeCases });

    assertHashFields(receiptEvidence, [
      'receiptHash',
      'planHash',
      'scopeHash',
      'bindingHash',
      'identityHash',
      'authSessionHash',
      'pushSessionHash',
      'issueHash',
      'issueSessionHash',
      'issueIdentityHash',
      'issueScopeHash',
      'issueRequiredCapabilityHash',
      'issueCapabilityHash',
      'sessionUserIdentityHash',
      'sessionUserBindingHash',
      'dryRunContentHash',
      'dryRunIdempotencyKeyHash',
    ]);
    assert.deepEqual(receiptEvidence.binds, {
      samePlan: true,
      sameScope: true,
      sameIdentity: true,
      sameSession: true,
      requiredCapability: true,
      capabilityHashPresent: true,
    });
    for (const generatedCase of downgradeCases) {
      assertHashFields(generatedCase, [
        'caseHash',
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
      assert.equal(generatedCase.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
      assert.equal(generatedCase.authorization, 'mutation-authority-denied');
      assert.deepEqual(generatedCase.mutationEventCounts, {
        prepared: 0,
        applied: 0,
        preconditionFailed: 0,
      });
      assert.equal(generatedCase.planHash, dryRunReceipt.planHash);
      assert.equal(generatedCase.receiptHash, dryRunReceipt.receiptHash);
      assert.equal(generatedCase.requestHash, applyRequest.headers['x-auth-content-hash']);
    }
    assert.equal(summary.apply.idempotency.idempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(summary.apply.idempotency.requestHash, applyRequest.headers['x-auth-content-hash']);
    assert.equal(supportEnvelope.releaseGate, 'NO-GO');
    assert.equal(supportEnvelope.productionBacked, false);
    assert.equal(supportEnvelope.supportStatus, 'support-only-bound-rejected');
    assert.equal(supportEnvelope.releaseMovement.allowed, false);
    assert.equal(supportEnvelope.downgradeRejections.length, 3);
    assert.match(supportEnvelope.sliceHash, hashPattern);
    assert.match(supportEnvelope.variantHash, hashPattern);
    assert.match(supportEnvelope.routeProfileHash, hashPattern);
    assertHashOnlySupportEnvelope(supportEnvelope);

    assertNoRawValues({
      receiptEvidence,
      downgradeCases,
      supportEnvelope,
      applyIdempotency: summary.apply.idempotency,
    }, [
      idempotencyKey,
      credential.password,
      sessionId,
      credential.username,
      authScope,
      requiredCapability,
      sourceUrl,
      routePrefix,
      base.files['wp-content/uploads/reprint-push/rpp-0558.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0558.txt'],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0558 v3 evidence doc records support-only hash-only NO-GO scope', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0558 capability downgrade rejection, variant 3$/m);
  assert.match(evidence, /local\/generated executor-auth support evidence only/);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /SIGNED_SESSION_CAPABILITY_DOWNGRADED/);
  assert.match(evidence, /dry-run receipt/);
  assert.match(evidence, /session, identity, scope, required capability, capability hash, and plan hash/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|password/i);
});
