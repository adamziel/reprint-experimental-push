import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  EVIDENCE_REDACTION_MARKER,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;

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

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '7'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
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

function rpp0239Fixture() {
  const privateValues = {
    baseFile: '<?php echo "rpp0239-v2-base-private-file";',
    basePostTitle: 'RPP-0239 v2 base private title',
    basePostContent: 'RPP-0239 v2 base private content',
    baseOptionMode: 'rpp0239-v2-base-private-option-mode',
    baseOptionNotes: 'rpp0239-v2-base-private-option-notes',
    localFile: '<?php echo "rpp0239-v2-local-private-file";',
    localPostTitle: 'RPP-0239 v2 local private title',
    localPostContent: 'RPP-0239 v2 local private content',
    localOptionMode: 'rpp0239-v2-local-private-option-mode',
    localOptionNotes: 'rpp0239-v2-local-private-option-notes',
    localSessionToken: 'rpp0239-v2-local-session-token',
    localCookie: 'wordpress_logged_in=rpp0239-v2-local-cookie',
    staleRemoteFile: '<?php echo "rpp0239-v2-stale-remote-file";',
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
    pluginOptionResourceKey,
    privateNeedles: [
      'rpp0239-v2-base-private-file',
      privateValues.basePostTitle,
      privateValues.basePostContent,
      privateValues.baseOptionMode,
      privateValues.baseOptionNotes,
      'rpp0239-v2-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0239-v2-local-cookie',
      'rpp0239-v2-stale-remote-file',
    ],
    rawPlanNeedles: [
      'rpp0239-v2-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0239-v2-local-cookie',
    ],
    staleRemoteFile: privateValues.staleRemoteFile,
    expectedResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
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

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function redactedDescriptor(value, label) {
  assert.equal(value.redacted, true, `${label} must be redacted`);
  assert.equal(value.redaction, EVIDENCE_REDACTION_MARKER, `${label} redaction marker`);
  assert.equal(value.reason, 'raw-site-value-field', `${label} redaction reason`);
  assert.match(value.sha256, sha256HexPattern, `${label} digest`);
  assert.equal(Object.hasOwn(value, 'value'), false, `${label} must not carry raw value`);
  return value;
}

function hashOnlyPlanSummary(plan, fixture) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutationProofs: fixture.expectedResourceKeys.map((resourceKey) => {
      const mutation = mutationFor(plan, resourceKey);
      assert.ok(mutation, `missing mutation for ${resourceKey}`);
      return {
        resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        observedRemoteHash: resourceHash(fixture.remote, mutation.resource),
        mutationHash: sha256Evidence(mutation),
      };
    }),
    preconditionProofs: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
  };
}

function assertNoPrivateValues(serialized, privateValues, label) {
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0239 redacted raw value evidence variant 2 preserves hashes without raw planner or journal payloads', () => {
  const fixture = rpp0239Fixture();
  const readyPlan = planFor(fixture);

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 3,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(readyPlan.mutations.map((mutation) => mutation.resourceKey), fixture.expectedResourceKeys);
  assert.equal(readyPlan.preconditions.length, readyPlan.mutations.length);

  for (const mutation of readyPlan.mutations) {
    const precondition = readyPlan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing live-remote precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }

  const staleRemote = cloneJson(fixture.remote);
  staleRemote.files['index.php'] = fixture.staleRemoteFile;
  const staleDurableEvents = [];
  const staleRemoteBeforeHash = digest(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(staleDurableEvents),
  }));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, 'file:index.php');
  assert.match(staleError.details.expectedHash, sha256HexPattern);
  assert.match(staleError.details.actualHash, sha256HexPattern);
  assert.equal(digest(staleRemote), staleRemoteBeforeHash, 'stale refusal mutated the remote');
  assert.deepEqual(
    staleDurableEvents.map((event) => event.type),
    ['recovery-claim-opened'],
    'stale refusal should stop after the recovery claim boundary',
  );
  assert.equal(
    staleDurableEvents.some((event) => event.type === 'target-planned' || event.type.includes('mutation')),
    false,
    'stale refusal wrote target or mutation durable journal evidence',
  );

  const stagedRemote = cloneJson(fixture.remote);
  const stagedRemoteBeforeHash = digest(stagedRemote);
  const journalError = captureError(() => applyPlan(stagedRemote, readyPlan, {
    failAfterStaging: true,
  }));
  const journal = journalError.details.recovery.artifacts.journal;

  assert.ok(journalError instanceof PushPlanError);
  assert.equal(journalError.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assert.equal(digest(stagedRemote), stagedRemoteBeforeHash, 'staging failure mutated the remote');
  assert.equal(journal.status, 'staged');
  assert.equal(journal.entries.length, readyPlan.mutations.length);

  const rawEvidence = {
    command: 'node --test --test-name-pattern=RPP-0239 test/rpp-0239-redacted-raw-value-evidence-v2.test.js',
    behavior: 'redacted raw value evidence variant 2 preserves hash utility without leaking planner or journal payloads',
    plan: readyPlan,
    hashOnlyPlanSummary: hashOnlyPlanSummary(readyPlan, fixture),
    staleRefusal: {
      code: staleError.code,
      message: staleError.message,
      details: staleError.details,
      detailsHash: sha256Evidence(staleError.details),
      remoteBeforeHash: staleRemoteBeforeHash,
      remoteAfterHash: digest(staleRemote),
      durableJournalEventTypes: staleDurableEvents.map((event) => event.type),
    },
    journalFailure: {
      code: journalError.code,
      message: journalError.message,
      detailsHash: sha256Evidence(journalError.details),
      journal,
    },
  };
  const rawSerializedEvidence = JSON.stringify(rawEvidence);
  const redactedEvidence = redactEvidence(rawEvidence);
  const redactedSerializedEvidence = JSON.stringify({
    ...redactedEvidence,
    evidenceHash: sha256Evidence(redactedEvidence),
  });

  for (const privateValue of fixture.rawPlanNeedles) {
    assert.equal(rawSerializedEvidence.includes(privateValue), true, `fixture did not exercise ${privateValue}`);
  }
  assert.ok(findEvidenceRedactionIssues(rawEvidence).length > 0, 'raw evidence should report redaction issues');
  assert.deepEqual(findEvidenceRedactionIssues(redactedEvidence), []);

  for (const mutation of redactedEvidence.plan.mutations) {
    redactedDescriptor(mutation.value, `${mutation.resourceKey} mutation value`);
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }
  for (const entry of redactedEvidence.journalFailure.journal.entries) {
    redactedDescriptor(entry.beforeValue, `${entry.resourceKey} journal beforeValue`);
    redactedDescriptor(entry.afterValue, `${entry.resourceKey} journal afterValue`);
    assert.match(entry.beforeHash, sha256HexPattern);
    assert.match(entry.afterHash, sha256HexPattern);
  }
  for (const proof of redactedEvidence.hashOnlyPlanSummary.mutationProofs) {
    assert.match(proof.baseHash, sha256HexPattern);
    assert.match(proof.localHash, sha256HexPattern);
    assert.match(proof.remoteBeforeHash, sha256HexPattern);
    assert.equal(proof.remoteBeforeHash, proof.observedRemoteHash);
    assert.match(proof.mutationHash, /^sha256:[a-f0-9]{64}$/);
  }

  assertNoPrivateValues(redactedSerializedEvidence, fixture.privateNeedles, 'redacted proof evidence');
  assertNoPrivateValues(JSON.stringify(staleError.details), fixture.privateNeedles, 'stale refusal details');
  assertNoPrivateValues(JSON.stringify(journalError.details), fixture.privateNeedles, 'journal refusal details');
});
