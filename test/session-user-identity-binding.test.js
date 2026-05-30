import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthSessionBoundaryProof } from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

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

test('signed dry-run and apply sessions reject reuse under a different authenticated user identity', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');

  assert.match(mintSession, /'identityHash'\s*=>\s*reprint_push_lab_rest_signed_identity_hash\(\$auth\)/);
  assert.match(
    verifySignedRequest,
    /\|\| !hash_equals\(\(string\) \(\$session\['identityHash'\] \?\? ''\),\s*reprint_push_lab_rest_signed_identity_hash\(\$auth\)\)/,
  );
  assertBefore(
    verifySignedRequest,
    "|| !hash_equals((string) ($session['identityHash'] ?? ''), reprint_push_lab_rest_signed_identity_hash($auth))",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assert.match(verifySignedRequest, /'SIGNED_SESSION_BINDING_MISMATCH'/);
  assert.match(
    verifySignedRequest,
    /X-Reprint-Push-Session is not bound to the current identity, credential, and source URL\./,
  );
});

test('dry-run receipts carry a session user identity binding and apply validates it before mutation', () => {
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const sessionUserBinding = functionBody('reprint_push_lab_rest_authenticated_user_identity_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const applyCallback = functionBody('reprint_push_lab_rest_authenticated_apply');

  assert.match(
    bindReceipt,
    /'sessionUser'\s*=>\s*reprint_push_lab_rest_authenticated_user_identity_binding\(\$auth,\s*\$signed_request\)/,
  );

  assert.match(sessionUserBinding, /'required'\s*=>\s*'same authenticated user identity for push session, dry-run receipt, and apply'/);
  assert.match(sessionUserBinding, /'userId'\s*=>\s*\(int\) \(\$identity\['userId'\] \?\? 0\)/);
  assert.match(sessionUserBinding, /'userLoginHash'\s*=>\s*hash\('sha256',\s*\(string\) \(\$identity\['userLogin'\] \?\? ''\)\)/);
  assert.match(sessionUserBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(sessionUserBinding, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(sessionUserBinding, /'pushSessionHash'\s*=>\s*\(string\) \(\$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(sessionUserBinding, /'manageOptions'\s*=>\s*\(bool\) \(\$capabilities\['manage_options'\] \?\? false\)/);
  assert.match(sessionUserBinding, /\$binding\['bindingHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$binding\)\)/);

  assertBefore(
    applyCallback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(validateReceipt, /\$session_user\s*=\s*isset\(\$binding\['sessionUser'\]\)/);
  assert.match(validateReceipt, /\$expected_session_user\s*=\s*reprint_push_lab_rest_authenticated_user_identity_binding/);
  assert.match(
    validateReceipt,
    /Receipt session user identity binding does not match the current authenticated user\./,
  );
  assertBefore(
    validateReceipt,
    '$expected_session_user = reprint_push_lab_rest_authenticated_user_identity_binding',
    'Receipt dry-run body binding is incomplete.',
  );
});

test('release verifier summary exposes session user identity binding in auth session boundary proof', () => {
  const sourceUrl = 'https://source.example.test/push';
  const authSessionLifecycleSummary = {
    issued: {
      step: 'preflight',
      id: 'psh_01j00000000000000000000000',
      authUser: 'admin',
      authUserId: 7,
      authCapabilities: { manage_options: true },
    },
    read: {
      step: 'journal',
      id: 'psh_01j00000000000000000000000',
      authUser: 'admin',
      authUserId: 7,
      authCapabilities: { manage_options: true },
    },
  };

  const proof = resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: sourceUrl,
    effectiveSourceUrl: sourceUrl,
    authSessionSourceCommand: 'node ./scripts/playground/auth-session-source-command.js',
    authSessionSource: { ok: true, sourceUrl },
    authSessionLifecycleSummary,
  });

  assert.equal(proof.userIdentityBinding.ok, true);
  assert.deepEqual(proof.userIdentityBinding, {
    required: 'same authenticated user identity bound to the push session and dry-run receipt',
    ok: true,
    sameSession: true,
    sameUserLogin: true,
    sameUserId: true,
    manageOptions: true,
    issued: {
      step: 'preflight',
      sessionId: 'psh_01j00000000000000000000000',
      userLogin: 'admin',
      userId: 7,
      capabilities: { manage_options: true },
    },
    readback: {
      step: 'journal',
      sessionId: 'psh_01j00000000000000000000000',
      userLogin: 'admin',
      userId: 7,
      capabilities: { manage_options: true },
    },
  });

  const drifted = resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: sourceUrl,
    effectiveSourceUrl: sourceUrl,
    authSessionSourceCommand: 'node ./scripts/playground/auth-session-source-command.js',
    authSessionSource: { ok: true, sourceUrl },
    authSessionLifecycleSummary: {
      ...authSessionLifecycleSummary,
      read: {
        ...authSessionLifecycleSummary.read,
        authUser: 'other-admin',
      },
    },
  });
  assert.equal(drifted.userIdentityBinding.ok, false);
  assert.equal(drifted.userIdentityBinding.sameUserLogin, false);
});
