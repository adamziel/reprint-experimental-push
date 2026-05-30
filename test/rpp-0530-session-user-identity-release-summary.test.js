import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthSessionBoundaryProof } from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
const sourceUrl = 'https://source.example.test/push';
const hashPattern = /^[a-f0-9]{64}$/;

function functionDeclaration(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const signatureEnd = source.indexOf(') {', start);
  const open = signatureEnd === -1
    ? source.indexOf('{', start)
    : signatureEnd + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function functionBody(source, name) {
  const declaration = functionDeclaration(source, name);
  const signatureEnd = declaration.indexOf(') {');
  const open = signatureEnd === -1
    ? declaration.indexOf('{')
    : signatureEnd + 2;
  return declaration.slice(open + 1, -1);
}

function loadReleaseAuthSessionUserIdentityEvidenceBuilder() {
  const declaration = functionDeclaration(liveReleaseVerifierSource, 'buildReleaseAuthSessionUserIdentityEvidence');
  return Function('"use strict"; return (' + declaration + ');')();
}

function verifiedAuthSessionBoundary() {
  return resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: sourceUrl,
    effectiveSourceUrl: sourceUrl,
    authSessionSourceCommand: 'node ./scripts/playground/auth-session-source-command.js',
    authSessionSource: {
      ok: true,
      sourceUrl,
      username: 'rpp_0530_admin',
      applicationPassword: '<redacted>',
    },
    authSessionLifecycleSummary: {
      issued: {
        step: 'preflight',
        id: 'rpp-0530-session-01',
        authUser: 'rpp_0530_admin',
        authUserId: 530,
        authCapabilities: { manage_options: true },
      },
      read: {
        step: 'journal',
        id: 'rpp-0530-session-01',
        authUser: 'rpp_0530_admin',
        authUserId: 530,
        authCapabilities: { manage_options: true },
      },
    },
  });
}

test('verify:release summary carries one session user identity route-evidence block for RPP-0530', () => {
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence');
  const summaryEmitter = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof');
  const summaryBlocks = topologyEvidence.match(/authSessionUserIdentity:\s*buildReleaseAuthSessionUserIdentityEvidence\(/g) || [];

  assert.equal(summaryBlocks.length, 1, 'combined topology evidence should carry exactly one authSessionUserIdentity summary');
  assert.match(summaryEmitter, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.match(topologyEvidence, /authSessionUserIdentity:\s*buildReleaseAuthSessionUserIdentityEvidence\(\{\s*verify,\s*sourceUrl,\s*\}\)/s);
});

test('RPP-0530 release summary proves hash-only issued/readback user identity route evidence', () => {
  const boundary = verifiedAuthSessionBoundary();
  const buildSummary = loadReleaseAuthSessionUserIdentityEvidenceBuilder();
  const summary = buildSummary({
    verify: {
      authSessionBoundary: boundary,
      preflight: { routeProfile: { profile: 'production-shaped' } },
    },
    sourceUrl,
  });

  assert.equal(boundary.verdict, 'AUTH_SESSION_BOUNDARY_OK');
  assert.equal(boundary.userIdentity.ok, true);
  assert.deepEqual(summary.routeEvidence, {
    complete: true,
    required: [
      'issued.sessionHash',
      'issued.userIdentityHash',
      'readback.sessionHash',
      'readback.userIdentityHash',
    ],
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.required, 'same authenticated WordPress user identity bound to the short-lived push session');
  assert.equal(summary.observed, 'same-session-user-identity');
  assert.equal(summary.verdict, 'AUTH_SESSION_USER_IDENTITY_BOUND');
  assert.equal(summary.sourceUrl, sourceUrl);
  assert.equal(summary.routeProfile, 'production-shaped');
  assert.equal(summary.sameSession, true);
  assert.equal(summary.sameUserLogin, true);
  assert.equal(summary.sameUserId, true);
  assert.equal(summary.manageOptions, true);
  assert.equal(summary.issued.step, 'preflight');
  assert.equal(summary.readback.step, 'journal');
  assert.match(summary.issued.sessionHash, hashPattern);
  assert.match(summary.readback.sessionHash, hashPattern);
  assert.match(summary.issued.userIdentityHash, hashPattern);
  assert.match(summary.readback.userIdentityHash, hashPattern);
  assert.equal(summary.issued.sessionHash, summary.readback.sessionHash);
  assert.equal(summary.issued.userIdentityHash, summary.readback.userIdentityHash);
  assert.equal(summary.scope, 'final-release');

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /rpp_0530_admin/);
  assert.doesNotMatch(serialized, /rpp-0530-session-01/);
  assert.doesNotMatch(serialized, /applicationPassword|credentialHash|signingKey|password/i);
});

test('RPP-0530 release summary does not infer success without user identity hashes', () => {
  const buildSummary = loadReleaseAuthSessionUserIdentityEvidenceBuilder();
  const summary = buildSummary({
    verify: {
      authSessionBoundary: {
        verdict: 'AUTH_SESSION_BOUNDARY_OK',
        identityContinuity: {
          sameSession: true,
          sameUserLogin: true,
          sameUserId: true,
          manageOptions: true,
        },
        issuance: { step: 'preflight' },
        readback: { step: 'journal' },
      },
      preflight: { routeProfile: 'production-shaped' },
    },
    sourceUrl,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.observed, 'missing-session-user-identity');
  assert.equal(summary.verdict, 'AUTH_SESSION_USER_IDENTITY_REQUIRED');
  assert.equal(summary.routeEvidence.complete, false);
  assert.equal(summary.sameSession, true);
  assert.equal(summary.sameUserLogin, true);
  assert.equal(summary.sameUserId, true);
  assert.equal(summary.manageOptions, true);
  assert.equal(summary.issued.step, 'preflight');
  assert.equal(summary.readback.step, 'journal');
  assert.equal(summary.issued.sessionHash, '');
  assert.equal(summary.issued.userIdentityHash, '');
  assert.equal(summary.readback.sessionHash, '');
  assert.equal(summary.readback.userIdentityHash, '');
});

test('RPP-0530 release summary rejects ok claims that omit route hash evidence', () => {
  const buildSummary = loadReleaseAuthSessionUserIdentityEvidenceBuilder();
  const summary = buildSummary({
    verify: {
      authSessionBoundary: {
        userIdentity: {
          ok: true,
          observed: 'same-session-user-identity',
          verdict: 'AUTH_SESSION_USER_IDENTITY_BOUND',
          sameSession: true,
          sameUserLogin: true,
          sameUserId: true,
          manageOptions: true,
          issued: { step: 'preflight', sessionHash: 'a'.repeat(64), userIdentityHash: '' },
          readback: { step: 'journal', sessionHash: 'a'.repeat(64), userIdentityHash: '' },
        },
      },
      preflight: { routeProfile: 'production-shaped' },
    },
    sourceUrl,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.observed, 'missing-session-user-identity-route-evidence');
  assert.equal(summary.verdict, 'AUTH_SESSION_USER_IDENTITY_REQUIRED');
  assert.equal(summary.routeEvidence.complete, false);
  assert.equal(summary.issued.sessionHash, 'a'.repeat(64));
  assert.equal(summary.readback.sessionHash, 'a'.repeat(64));
  assert.equal(summary.issued.userIdentityHash, '');
  assert.equal(summary.readback.userIdentityHash, '');
});
