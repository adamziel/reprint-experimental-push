import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectExternalWordPressTopologyProof,
  externalWordPressTopologyVariant,
  normalizeExternalTopologyUrl,
  validateExternalTopologyCapture,
  captureExternalTopologyUrls,
} from '../scripts/playground/external-wordpress-topology-proof.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/playground/external-wordpress-topology-proof.mjs');

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/wp',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/wp/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/wp',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/wp',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/wp/',
  REPRINT_PUSH_DRY_RUN_SOURCE_URL: 'https://source.example.test:443/wp',
  REPRINT_PUSH_APPLY_ROUTE_SOURCE_URL: 'https://source.example.test/wp',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/wp',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/wp',
  REPRINT_PUSH_USERNAME: 'admin-user',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'dont-leak-this-secret',
});

test('RPP-0803 captures source/local/changed external WordPress URLs and identity-checks them', () => {
  const proof = collectExternalWordPressTopologyProof({
    env: goodEnv,
    now: new Date('2026-05-29T05:00:00.000Z'),
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.exitCode, 0);
  assert.equal(proof.topologyVariant, externalWordPressTopologyVariant);
  assert.equal(proof.urlCapture.source.normalizedUrl, 'https://source.example.test/wp');
  assert.equal(proof.urlCapture.localEdited.normalizedUrl, 'https://local.example.test/wp');
  assert.equal(proof.urlCapture.remoteChanged.normalizedUrl, 'https://changed.example.test/wp');
  assert.equal(proof.identityChecks.sourceLocalChangedUrlsDistinct.ok, true);
  assert.equal(proof.identityChecks.remoteAliasMatchesSource.ok, true);
  assert.equal(proof.identityChecks.sameSourceAcrossRoutes.ok, true);
  assert.equal(proof.identityChecks.noTunnelHosts.ok, true);
  assert.equal(proof.evidence.sourceUrl.ok, true);
  assert.equal(proof.evidence.localUrl.ok, true);
  assert.equal(proof.evidence.remoteChangedUrl.ok, true);
  assert.equal(proof.evidence.sourceIdentity.ok, true);
  assert.equal(proof.evidence.packagedFallback.observed, false);
  assert.equal(proof.constraints.networkProbePerformed, false);
  assert.equal(proof.credentialConfig.applicationPasswordPresent, true);
  assert.doesNotMatch(JSON.stringify(proof), /dont-leak-this-secret/);
});

test('RPP-0803 fails closed with exact missing URL blockers', () => {
  const proof = collectExternalWordPressTopologyProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://source.example.test',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test',
    },
    now: new Date('2026-05-29T05:00:00.000Z'),
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.failClosed, true);
  assert.equal(proof.exitCode, 2);
  assert.equal(proof.identityChecks.requiredUrlsPresent.ok, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_LOCAL_URL_REQUIRED'));
  assert.equal(proof.evidence.externalWordPressTopology.ok, false);
  assert.equal(proof.evidence.localUrl.observed, 'missing-url');
});

test('RPP-0803 rejects remote alias drift and per-route source identity drift', () => {
  const proof = collectExternalWordPressTopologyProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/wp',
      REPRINT_PUSH_REMOTE_URL: 'https://wrong-source.example.test/wp',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/wp',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/wp',
      REPRINT_PUSH_DRY_RUN_SOURCE_URL: 'https://changed.example.test/wp',
    },
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.identityChecks.remoteAliasMatchesSource.ok, false);
  assert.equal(proof.identityChecks.sameSourceAcrossRoutes.ok, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_SOURCE_URL_MISMATCH'));
  assert.ok(proof.failures.some((failure) => failure.code === 'SAME_SOURCE_IDENTITY_REQUIRED'));
  assert.equal(proof.evidence.sourceIdentity.ok, false);
});

test('RPP-0803 rejects duplicate source/local/changed URL identities', () => {
  const capture = captureExternalTopologyUrls({
    REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/wp',
    REPRINT_PUSH_LOCAL_URL: 'https://source.example.test/wp/',
    REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/wp',
  });
  const validation = validateExternalTopologyCapture(capture, {});

  assert.equal(validation.ok, false);
  assert.equal(validation.identityChecks.sourceLocalChangedUrlsDistinct.ok, false);
  assert.ok(validation.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT'));
});

test('RPP-0803 rejects URL userinfo, query strings, tunnel hosts, and packaged fallback flags', () => {
  const proof = collectExternalWordPressTopologyProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:secret@source.example.test/wp',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/wp?token=abc',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/wp',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.identityChecks.noUrlSecrets.ok, false);
  assert.equal(proof.identityChecks.noTunnelHosts.ok, false);
  assert.equal(proof.identityChecks.packagedFallbackDisabled.ok, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assert.doesNotMatch(JSON.stringify(proof), /admin:secret|token=abc/);
});

test('RPP-0803 accepts only sandbox 8080 for loopback URL identities', () => {
  const okLoopback = collectExternalWordPressTopologyProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080/source',
      REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8080/local',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'http://127.0.0.1:8080/changed',
    },
  });
  assert.equal(okLoopback.ok, true);
  assert.equal(okLoopback.urlCapture.source.serviceKind, 'sandbox-local-8080-wordpress');

  const badLoopback = collectExternalWordPressTopologyProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080/source',
      REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:3000/local',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'http://127.0.0.1:8080/changed',
    },
  });
  assert.equal(badLoopback.ok, false);
  assert.ok(badLoopback.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080'));
});

test('RPP-0803 URL normalization strips default ports, trailing slashes, and fragments for identity', () => {
  const normalized = normalizeExternalTopologyUrl('https://SOURCE.example.test:443/wp///#fragment');

  assert.equal(normalized.valid, true);
  assert.equal(normalized.normalizedUrl, 'https://source.example.test/wp');
  assert.match(normalized.identityHash, /^[a-f0-9]{64}$/);
});

test('RPP-0803 CLI emits JSON proof and final status marker', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/wp',
      REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/wp/',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/wp',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/wp',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'cli-secret-must-not-leak',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[RPP-0803-EXTERNAL-WORDPRESS:TOPOLOGY-OK\]/);
  assert.doesNotMatch(result.stdout, /cli-secret-must-not-leak/);
  const jsonText = result.stdout.slice(0, result.stdout.lastIndexOf('\n['));
  const proof = JSON.parse(jsonText);
  assert.equal(proof.ok, true);
  assert.equal(proof.evidence.sourceIdentity.sameSource, true);
});
