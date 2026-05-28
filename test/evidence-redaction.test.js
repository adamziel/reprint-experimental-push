import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EVIDENCE_REDACTION_MARKER,
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { evaluateReleaseGates } from '../src/release-gates.js';
import {
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../src/recovery-journal.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const beforeHash = 'a'.repeat(64);
const afterHash = 'b'.repeat(64);
const observedHash = 'c'.repeat(64);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-evidence-redaction-'));
  return path.join(dir, 'recovery.jsonl');
}

function redactedDescriptor(value) {
  assert.equal(value.redacted, true);
  assert.equal(value.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
  return value;
}

test('redacts nested raw site values while keeping hash evidence', () => {
  const evidence = {
    planId: 'plan-redaction-proof',
    targets: [
      {
        mutationId: 'mutation-1',
        resourceKey: 'post:private-draft',
        beforeHash,
        afterHash,
        before: {
          value: 'raw-private-before-content',
        },
        nested: {
          metadata: {
            observedHash,
          },
        },
      },
    ],
  };

  const redacted = redactEvidence(evidence);

  assert.equal(redacted.targets[0].beforeHash, beforeHash);
  assert.equal(redacted.targets[0].afterHash, afterHash);
  assert.equal(redacted.targets[0].nested.metadata.observedHash, observedHash);
  assert.equal(redacted.targets[0].before.value.reason, 'raw-site-value-field');
  redactedDescriptor(redacted.targets[0].before.value);
  assert.equal(JSON.stringify(redacted).includes('raw-private-before-content'), false);

  const issues = findEvidenceRedactionIssues(evidence);
  assert.deepEqual(issues.map((issue) => issue.path), ['$.targets[0].before.value']);
  assert.throws(
    () => assertEvidenceHasNoRawValues(evidence),
    /raw or sensitive evidence at \$\.targets\[0\]\.before\.value/,
  );
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(redacted));
});

test('redacts auth headers, session cookies, and token fields without leaking token bytes', () => {
  const evidence = {
    request: {
      headers: {
        Authorization: 'Bearer live-session-token-abc123',
      },
      cookies: 'wordpress_logged_in=private-cookie; Path=/; HttpOnly',
    },
    nested: {
      sessionToken: 'session-token-private-value',
      nonce: 'nonce-private-value',
    },
  };

  const redacted = redactEvidence(evidence);
  redactedDescriptor(redacted.request.headers.Authorization);
  redactedDescriptor(redacted.request.cookies);
  redactedDescriptor(redacted.nested.sessionToken);
  redactedDescriptor(redacted.nested.nonce);

  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes('live-session-token-abc123'), false);
  assert.equal(serialized.includes('private-cookie'), false);
  assert.equal(serialized.includes('session-token-private-value'), false);
  assert.equal(serialized.includes('nonce-private-value'), false);

  assert.deepEqual(
    findEvidenceRedactionIssues(evidence).map((issue) => issue.path),
    ['$.request.headers.Authorization', '$.request.cookies', '$.nested.sessionToken', '$.nested.nonce'],
  );
});

test('redacts serialized option-like payloads even when they appear under generic evidence fields', () => {
  const serializedOption = 'a:2:{s:11:"blog_public";s:1:"1";s:12:"private_note";s:20:"raw option content";}';
  const jsonOption = '{"option_value":"raw json option content","autoload":"yes"}';
  const evidence = {
    observed: serializedOption,
    detail: {
      note: jsonOption,
    },
  };

  const redacted = redactEvidence(evidence);
  assert.equal(redacted.observed.reason, 'serialized-option-payload');
  assert.equal(redacted.detail.note.reason, 'serialized-option-payload');
  redactedDescriptor(redacted.observed);
  redactedDescriptor(redacted.detail.note);
  assert.equal(JSON.stringify(redacted).includes('raw option content'), false);
  assert.equal(JSON.stringify(redacted).includes('raw json option content'), false);

  assert.deepEqual(
    findEvidenceRedactionIssues(evidence).map((issue) => issue.path),
    ['$.observed', '$.detail.note'],
  );
});

test('allows hash-only metadata and operator-debuggable non-secret fields', () => {
  const evidence = {
    planId: 'plan-hash-only',
    mutationId: 'mutation-hash-only',
    resourceKey: 'post:123',
    state: 'planned',
    scope: 'final-release',
    beforeHash,
    afterHash,
    observedHash,
    contentHash: 'd'.repeat(64),
    hashes: [beforeHash, afterHash, observedHash],
    artifactRefs: {
      dryRun: 'artifact://dry-run-redacted-proof',
    },
  };

  assert.deepEqual(redactEvidence(evidence), evidence);
  assert.deepEqual(findEvidenceRedactionIssues(evidence), []);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence));
});

test('release gate evidence redacts raw values and session tokens but preserves hashes', () => {
  const serializedOption = 'a:1:{s:12:"private_note";s:20:"raw release content";}';
  const evaluation = evaluateReleaseGates({
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    },
    evidence: {
      dryRunRouteEligibility: {
        ok: false,
        eligible: false,
        observed: serializedOption,
        sessionToken: 'release-session-token-private',
        afterHash,
        scope: 'final-release',
      },
    },
    scope: 'final-release',
    now: fixedNow,
  });

  const gate = evaluation.gates.find((entry) => entry.id === 'dry-run-route-eligibility');
  assert.ok(gate);
  assert.equal(gate.status, 'failed');
  assert.equal(gate.evidence.afterHash, afterHash);
  assert.equal(gate.evidence.observed.reason, 'serialized-option-payload');
  assert.equal(gate.evidence.sessionToken.reason, 'secret-or-session-field');
  redactedDescriptor(gate.evidence.observed);
  redactedDescriptor(gate.evidence.sessionToken);

  const serialized = JSON.stringify(evaluation);
  assert.equal(serialized.includes('raw release content'), false);
  assert.equal(serialized.includes('release-session-token-private'), false);
});

test('recovery journals reject raw or secret evidence and still persist hash-only metadata', () => {
  const filePath = tempJournalPath();
  const journal = openRecoveryJournal(filePath, { truncate: true, now: fixedNow });

  assert.throws(
    () => journal.appendEvent('target-planned', {
      planId: 'plan-journal-redaction',
      mutationId: 'mutation-raw',
      nested: { value: 'raw journal private content' },
      beforeHash,
    }),
    { code: 'JOURNAL_RAW_VALUE_FIELD' },
  );
  assert.throws(
    () => journal.appendEvent('target-planned', {
      planId: 'plan-journal-redaction',
      mutationId: 'mutation-token',
      sessionToken: 'journal-session-token-private',
      beforeHash,
    }),
    { code: 'JOURNAL_RAW_VALUE_FIELD' },
  );

  journal.appendEvent('target-planned', {
    planId: 'plan-journal-redaction',
    mutationId: 'mutation-hash-only',
    resourceKey: 'post:123',
    beforeHash,
    afterHash,
    observedHash,
    artifactRefs: { dryRun: 'artifact://dry-run-redacted-proof' },
  });
  journal.close();

  const text = fs.readFileSync(filePath, 'utf8');
  assert.equal(text.includes('raw journal private content'), false);
  assert.equal(text.includes('journal-session-token-private'), false);
  assert.equal(text.includes(beforeHash), true);

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records.length, 1);
  assert.equal(restarted.records[0].beforeHash, beforeHash);
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(restarted.records[0]));
});

test('recovery journal readback blocks manually injected serialized option payloads', () => {
  const filePath = tempJournalPath();
  const serializedOption = 'a:1:{s:12:"private_note";s:22:"raw journal option";}';
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    sequence: 1,
    type: 'manual-injected-record',
    timestamp: fixedNow.toISOString(),
    observed: serializedOption,
    beforeHash,
    fsync: { requested: true, strategy: 'after-append' },
  })}\n`);

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'blocked');
  assert.equal(restarted.integrity.errors[0].code, 'JOURNAL_RAW_VALUE_FIELD');
  assert.match(restarted.integrity.errors[0].message, /\$\.observed/);
});
