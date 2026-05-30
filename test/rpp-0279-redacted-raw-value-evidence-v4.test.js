import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  EVIDENCE_REDACTION_MARKER,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0279-redacted-evidence-'));
  return path.join(dir, 'recovery.jsonl');
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option') {
  return { pluginOwner, resourceKey, driver };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function baseSite(privateValues) {
  return {
    files: {
      'index.php': privateValues.baseFile,
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: {
            mode: privateValues.baseOptionMode,
            notes: privateValues.baseOptionNotes,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: privateValues.basePostTitle,
          post_content: privateValues.basePostContent,
          post_status: 'publish',
        },
      },
    },
  };
}

function rpp0279Fixture() {
  const privateValues = {
    baseFile: '<?php echo "rpp0279-v4-base-private-file";',
    basePostTitle: 'RPP-0279 v4 base private title',
    basePostContent: 'RPP-0279 v4 base private content',
    baseOptionMode: 'rpp0279-v4-base-private-option-mode',
    baseOptionNotes: 'rpp0279-v4-base-private-option-notes',
    localFile: '<?php echo "rpp0279-v4-local-private-file";',
    localPostTitle: 'RPP-0279 v4 local private title',
    localPostContent: 'RPP-0279 v4 local private content',
    localOptionMode: 'rpp0279-v4-local-private-option-mode',
    localOptionNotes: 'rpp0279-v4-local-private-option-notes',
    localSessionToken: 'rpp0279-v4-local-session-token',
    localCookie: 'wordpress_logged_in=rpp0279-v4-local-cookie',
  };
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite(privateValues);
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = privateValues.localFile;
  local.db.wp_posts['ID:1'].post_title = privateValues.localPostTitle;
  local.db.wp_posts['ID:1'].post_content = privateValues.localPostContent;
  local.db.wp_options['option_name:forms_settings'].option_value = {
    mode: privateValues.localOptionMode,
    notes: privateValues.localOptionNotes,
    sessionToken: privateValues.localSessionToken,
    cookie: privateValues.localCookie,
  };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms', 'wp-option'),
    ),
  };

  return {
    base,
    local,
    remote,
    expectedResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
    privateNeedles: [
      'rpp0279-v4-base-private-file',
      privateValues.basePostTitle,
      privateValues.basePostContent,
      privateValues.baseOptionMode,
      privateValues.baseOptionNotes,
      'rpp0279-v4-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0279-v4-local-cookie',
    ],
    rawEvidenceNeedles: [
      privateValues.basePostTitle,
      privateValues.basePostContent,
      privateValues.baseOptionMode,
      privateValues.baseOptionNotes,
      'rpp0279-v4-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0279-v4-local-cookie',
    ],
  };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function redactedDescriptor(value, label, reason = 'raw-site-value-field') {
  assert.equal(value.redacted, true, `${label} must be redacted`);
  assert.equal(value.redaction, EVIDENCE_REDACTION_MARKER, `${label} redaction marker`);
  assert.equal(value.reason, reason, `${label} redaction reason`);
  assert.match(value.sha256, sha256HexPattern, `${label} digest`);
  assert.equal(Object.hasOwn(value, 'value'), false, `${label} must not carry raw value`);
  return value;
}

function assertNoPrivateValues(serialized, privateValues, label) {
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0279 redacted raw value evidence variant 4 redacts partial recovery snapshots and durable journal proof', () => {
  const fixture = rpp0279Fixture();
  const readyPlan = planFor(fixture);
  const remote = cloneJson(fixture.remote);
  const journalPath = tempJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'rpp-0279-redacted-evidence-v4',
  });
  const error = captureError(() => applyPlan(remote, readyPlan, {
    mutateRemote: true,
    failDuringCommitAtMutation: 1,
    durableJournal,
  }));
  durableJournal.close();
  const persisted = readRecoveryJournal(journalPath);

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.mutations.map((mutation) => mutation.resourceKey), fixture.expectedResourceKeys);
  assert.equal(readyPlan.preconditions.length, readyPlan.mutations.length);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'mutation-observed',
      'recovery-state',
    ],
  );

  const durableJournalText = JSON.stringify(persisted.records);
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoPrivateValues(durableJournalText, fixture.privateNeedles, 'durable journal proof');

  const rawEvidence = {
    command: 'node --test --test-name-pattern=RPP-0279 test/rpp-0279-redacted-raw-value-evidence-v4.test.js',
    behavior: 'redacted raw value evidence variant 4 redacts partial recovery snapshots while durable journal evidence stays hash-only',
    plan: readyPlan,
    partialCommitFailure: {
      code: error.code,
      details: error.details,
      detailsHash: sha256Evidence(error.details),
      mutatedRemoteHash: sha256Evidence(remote),
      durableJournalRecords: persisted.records,
    },
  };
  const rawSerializedEvidence = JSON.stringify(rawEvidence);
  const rawIssues = findEvidenceRedactionIssues(rawEvidence);
  const redactedEvidence = redactEvidence(rawEvidence);
  const redactedSerializedEvidence = JSON.stringify({
    ...redactedEvidence,
    evidenceHash: sha256Evidence(redactedEvidence),
  });

  for (const privateValue of fixture.rawEvidenceNeedles) {
    assert.equal(rawSerializedEvidence.includes(privateValue), true, `fixture did not exercise ${privateValue}`);
  }
  assert.ok(
    rawIssues.some((issue) => issue.path === '$.partialCommitFailure.details.recovery.artifacts.remote'),
    'raw evidence should flag the partial recovery remote snapshot',
  );
  assert.deepEqual(findEvidenceRedactionIssues(redactedEvidence), []);

  for (const mutation of redactedEvidence.plan.mutations) {
    redactedDescriptor(mutation.value, `${mutation.resourceKey} mutation value`);
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }
  for (const precondition of redactedEvidence.plan.preconditions) {
    assert.match(precondition.expectedHash, sha256HexPattern);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
  for (const entry of redactedEvidence.partialCommitFailure.details.recovery.artifacts.journal.entries) {
    redactedDescriptor(entry.beforeValue, `${entry.resourceKey} journal beforeValue`);
    redactedDescriptor(entry.afterValue, `${entry.resourceKey} journal afterValue`);
    assert.match(entry.beforeHash, sha256HexPattern);
    assert.match(entry.afterHash, sha256HexPattern);
  }
  redactedDescriptor(
    redactedEvidence.partialCommitFailure.details.recovery.artifacts.remote,
    'partial recovery remote snapshot',
    'recovery-artifact-site-snapshot',
  );
  assert.match(redactedEvidence.partialCommitFailure.detailsHash, sha256EvidencePattern);
  assert.match(redactedEvidence.partialCommitFailure.mutatedRemoteHash, sha256EvidencePattern);

  assertNoPrivateValues(redactedSerializedEvidence, fixture.privateNeedles, 'redacted partial recovery proof');
});
