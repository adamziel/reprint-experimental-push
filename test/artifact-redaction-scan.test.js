import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_REDACTION_REASON_CODES,
  scanArtifacts,
} from '../scripts/release/artifact-redaction-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannerPath = path.join(repoRoot, 'scripts/release/artifact-redaction-scan.mjs');
const sha256A = 'a'.repeat(64);
const sha256B = 'b'.repeat(64);
const sha256C = 'c'.repeat(64);
const sha256D = 'd'.repeat(64);

async function fixtureRoot(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-redaction-scan-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, contents);
  }

  return root;
}

function reasonCodes(report) {
  return report.rejectedFiles.flatMap((file) => file.reasons.map((reason) => reason.code));
}

test('scans nested JSON, Markdown, and HTML artifacts in deterministic order while allowing cautious redaction docs', async (t) => {
  const root = await fixtureRoot(t, {
    'z-notes.md': [
      '# Operator evidence',
      'This document mentions redaction rules without pasting values.',
      'Do not paste REPRINT_PUSH_APPLICATION_PASSWORD into release artifacts.',
      'Sandbox examples may use http://127.0.0.1:8080 only.',
    ].join('\n'),
    'a-summary.json': JSON.stringify({
      release: 'candidate',
      sourceUrlHash: `sha256:${sha256A}`,
      operatorSecret: '<redacted>',
      applicationPasswordPresent: true,
    }, null, 2),
    'nested/m-page.html': '<main><p>Use http://localhost:8080 for local-only sandbox examples.</p></main>\n',
  });

  const report = await scanArtifacts(['.'], { cwd: root });

  assert.equal(report.ok, true);
  assert.deepEqual(report.scannedFiles, [
    'a-summary.json',
    'nested/m-page.html',
    'z-notes.md',
  ]);
  assert.deepEqual(report.rejectedFiles, []);
  assert.equal(report.allowedHashEvidence, 1);
});

test('allows hash-only metadata across JSON and Markdown without treating tokenHash as a secret', async (t) => {
  const root = await fixtureRoot(t, {
    'hashes.json': JSON.stringify({
      localHash: `sha256:${sha256A}`,
      remoteBeforeDigest: sha256B,
      tokenHash: `sha256:${sha256C}`,
    }, null, 2),
    'nested/evidence.md': `remoteBeforeHash: sha256:${sha256D}\nRedaction status: hash-only metadata retained.\n`,
  });

  const report = await scanArtifacts(['hashes.json', 'nested'], { cwd: root });

  assert.equal(report.ok, true);
  assert.deepEqual(report.scannedFiles, ['hashes.json', 'nested/evidence.md']);
  assert.deepEqual(report.rejectedFiles, []);
  assert.equal(report.allowedHashEvidence, 4);
});

const failClosedFixtures = [
  {
    name: 'raw http URL',
    file: 'bad-url.md',
    contents: 'Release evidence must not include https://live-site.example.invalid/wp-json here.\n',
    code: ARTIFACT_REDACTION_REASON_CODES.RAW_HTTP_URL,
    leaked: 'live-site.example.invalid',
  },
  {
    name: 'application password-shaped credential',
    file: 'bad-credential.txt',
    contents: 'Captured app password: abcd efgh ijkl mnop qrst uvwx\n',
    code: ARTIFACT_REDACTION_REASON_CODES.CREDENTIAL_VALUE,
    leaked: 'abcd efgh ijkl mnop qrst uvwx',
  },
  {
    name: 'token-shaped value',
    file: 'bad-token.md',
    contents: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue000\n',
    code: ARTIFACT_REDACTION_REASON_CODES.TOKEN_VALUE,
    leaked: 'signaturevalue000',
  },
  {
    name: 'cookie-shaped value in HTML',
    file: 'bad-cookie.html',
    contents: '<pre>Set-Cookie: wordpress_logged_in_abc=private-session-cookie; Path=/;</pre>\n',
    code: ARTIFACT_REDACTION_REASON_CODES.COOKIE_VALUE,
    leaked: 'private-session-cookie',
  },
  {
    name: 'serialized private option payload',
    file: 'bad-option.json',
    contents: JSON.stringify({
      option_name: 'plugin_settings',
      option_value: 'a:1:{s:11:"private_key";s:16:"operator-key";}',
    }, null, 2),
    code: ARTIFACT_REDACTION_REASON_CODES.SERIALIZED_PRIVATE_OPTION,
    leaked: 'operator-key',
  },
  {
    name: 'explicit secret-like key',
    file: 'bad-secret.json',
    contents: JSON.stringify({ operatorSecret: 'launch-window-code' }, null, 2),
    code: ARTIFACT_REDACTION_REASON_CODES.SECRET_LIKE_KEY,
    leaked: 'launch-window-code',
  },
];

for (const fixture of failClosedFixtures) {
  test(`fails closed on ${fixture.name} with a redacted preview`, async (t) => {
    const root = await fixtureRoot(t, { [fixture.file]: fixture.contents });

    const report = await scanArtifacts([fixture.file], { cwd: root });
    const serializedReport = JSON.stringify(report);

    assert.equal(report.ok, false);
    assert.deepEqual(report.scannedFiles, [fixture.file]);
    assert.ok(reasonCodes(report).includes(fixture.code), `missing ${fixture.code}`);
    assert.match(serializedReport, /<redacted:/);
    assert.doesNotMatch(serializedReport, new RegExp(fixture.leaked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('CLI emits stable JSON and exits nonzero when an artifact is rejected', async (t) => {
  const root = await fixtureRoot(t, {
    'cli/bad.md': 'apiToken: ghp_abcdefghijklmnopqrstuvwxyz123456\n',
  });

  const result = spawnSync(process.execPath, [scannerPath, 'cli'], {
    cwd: root,
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(report.ok, false);
  assert.deepEqual(report.scannedFiles, ['cli/bad.md']);
  assert.deepEqual(report.rejectedFiles.map((entry) => entry.file), ['cli/bad.md']);
  assert.ok(reasonCodes(report).includes(ARTIFACT_REDACTION_REASON_CODES.TOKEN_VALUE));
  assert.doesNotMatch(result.stdout, /abcdefghijklmnopqrstuvwxyz123456/);
});
