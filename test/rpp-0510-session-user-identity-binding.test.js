import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const releaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');

const routeSource = readFileSync(routeSourcePath, 'utf8');
const releaseVerifierSource = readFileSync(releaseVerifierPath, 'utf8');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');

function functionBody(source, name, { afterParameters = false } = {}) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const jsBodyStart = afterParameters ? source.indexOf(') {', start) : -1;
  const open = jsBodyStart === -1 ? source.indexOf('{', start) : jsBodyStart + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function phpFunctionBody(name) {
  return functionBody(routeSource, name);
}

function releaseVerifierFunctionBody(name) {
  return functionBody(releaseVerifierSource, name, { afterParameters: true });
}

function liveReleaseVerifierFunctionBody(name) {
  return functionBody(liveReleaseVerifierSource, name, { afterParameters: true });
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

test('short-lived push sessions bind the authenticated WordPress user before canonical route verification', () => {
  const verifySignedRequest = phpFunctionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = phpFunctionBody('reprint_push_lab_rest_mint_signed_session');
  const userIdentityHash = phpFunctionBody('reprint_push_lab_rest_signed_user_identity_hash');

  assert.match(mintSession, /'userIdentityHash'\s*=>\s*reprint_push_lab_rest_signed_user_identity_hash\(\$auth\)/);
  assert.match(mintSession, /'userId'\s*=>\s*\(int\)\s*\(\$auth\['userId'\] \?\? 0\)/);
  assert.match(mintSession, /'userLogin'\s*=>\s*\(string\)\s*\(\$auth\['userLogin'\] \?\? ''\)/);

  assert.match(
    verifySignedRequest,
    /!\s*hash_equals\(\(string\) \(\$session\['userIdentityHash'\] \?\? ''\),\s*reprint_push_lab_rest_signed_user_identity_hash\(\$auth\)\)/,
  );
  assert.match(
    verifySignedRequest,
    /\(int\) \(\$session\['userId'\] \?\? 0\) !== \(int\) \(\$auth\['userId'\] \?\? 0\)/,
  );
  assert.match(
    verifySignedRequest,
    /!\s*hash_equals\(\(string\) \(\$session\['userLogin'\] \?\? ''\),\s*\(string\) \(\$auth\['userLogin'\] \?\? ''\)\)/,
  );
  assertBefore(
    verifySignedRequest,
    "reprint_push_lab_rest_signed_user_identity_hash($auth)",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "($session['userLogin'] ?? '')",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );

  assert.match(userIdentityHash, /\$auth\['userId'\]/);
  assert.match(userIdentityHash, /\$auth\['userLogin'\]/);
  assert.match(userIdentityHash, /REPRINT_PUSH_LAB_AUTH_SCOPE/);
  assert.doesNotMatch(userIdentityHash, /applicationPassword|credentialHash|signingKey|password/i);
});

test('route receipts carry hash-only session user identity evidence', () => {
  const preflight = phpFunctionBody('reprint_push_lab_rest_authenticated_preflight');
  const signedRequestEvidence = phpFunctionBody('reprint_push_lab_rest_signed_request_evidence');
  const issueBinding = phpFunctionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const validateReceipt = phpFunctionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assert.match(preflight, /'userIdentityHash'\s*=>\s*\$signature\['session'\]\['userIdentityHash'\] \?\? null/);
  assert.match(
    signedRequestEvidence,
    /'userIdentityHash'\s*=>\s*\(string\) \(\$session\['userIdentityHash'\] \?\? ''\)/,
  );
  assert.match(
    issueBinding,
    /'userIdentityHash'\s*=>\s*\(string\) \(\$session\['userIdentityHash'\] \?\? ''\)/,
  );
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt short-lived push session issue binding does not match the current request.',
  );
});

test('verify:release carries session user identity route evidence in the combined release summary', () => {
  const boundaryProof = releaseVerifierFunctionBody('resolveAuthSessionBoundaryProof');
  const userIdentityBinding = releaseVerifierFunctionBody('buildAuthSessionUserIdentityBinding');
  const topologyEvidence = liveReleaseVerifierFunctionBody('buildReleaseTopologyEvidence');
  const summaryEmitter = liveReleaseVerifierFunctionBody('emitCombinedReleaseProof');
  const userIdentitySummary = liveReleaseVerifierFunctionBody('buildReleaseAuthSessionUserIdentityEvidence');

  assert.match(boundaryProof, /const userIdentity = buildAuthSessionUserIdentityBinding\(/);
  assert.match(boundaryProof, /userIdentity,/);
  assert.match(userIdentityBinding, /same authenticated WordPress user identity bound to the short-lived push session/);
  assert.match(userIdentityBinding, /sameUserIdentityHash/);
  assert.match(userIdentityBinding, /userIdentityHash/);
  assert.match(userIdentityBinding, /sessionHash/);
  assert.doesNotMatch(userIdentityBinding, /applicationPassword|credentialHash|signingKey|password/i);

  assert.match(topologyEvidence, /authSessionUserIdentity:\s*buildReleaseAuthSessionUserIdentityEvidence\(/);
  assert.match(summaryEmitter, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.match(userIdentitySummary, /scope:\s*'final-release'/);
  assert.match(userIdentitySummary, /sameUserLogin/);
  assert.match(userIdentitySummary, /sameUserId/);
  assert.match(userIdentitySummary, /issued:\s*\{/);
  assert.match(userIdentitySummary, /readback:\s*\{/);
  assert.doesNotMatch(userIdentitySummary, /applicationPassword|credentialHash|signingKey|password/i);
});
