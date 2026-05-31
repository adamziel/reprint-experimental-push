import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  EVIDENCE_REDACTION_MARKER,
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:29:00.000Z');
const command = 'node --test test/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.test.js';
const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const postResourceKey = 'row:["wp_posts","ID:1"]';
const indexResourceKey = 'file:index.php';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0299-redacted-evidence-'));
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
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: privateValues.baseOptionMode,
            notes: privateValues.baseOptionNotes,
          },
          autoload: 'no',
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

function rpp0299Fixture() {
  const privateValues = {
    baseFile: '<?php echo "rpp0299-v5-base-private-file";',
    basePostTitle: 'RPP-0299 v5 base private title',
    basePostContent: 'RPP-0299 v5 base private content',
    baseOptionMode: 'rpp0299-v5-base-private-option-mode',
    baseOptionNotes: 'rpp0299-v5-base-private-option-notes',
    localFile: '<?php echo "rpp0299-v5-local-private-file";',
    localPostTitle: 'RPP-0299 v5 local private title',
    localPostContent: 'RPP-0299 v5 local private content',
    localOptionMode: 'rpp0299-v5-local-private-option-mode',
    localOptionNotes: 'rpp0299-v5-local-private-option-notes',
    localSessionToken: 'rpp0299-v5-local-session-token',
    localCookie: 'wordpress_logged_in=rpp0299-v5-local-cookie',
    staleRemoteFile: '<?php echo "rpp0299-v5-stale-remote-file";',
  };
  const base = baseSite(privateValues);
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = privateValues.localFile;
  local.db.wp_posts['ID:1'].post_title = privateValues.localPostTitle;
  local.db.wp_posts['ID:1'].post_content = privateValues.localPostContent;
  local.db.wp_options[formsOptionRowId].option_value = {
    mode: privateValues.localOptionMode,
    notes: privateValues.localOptionNotes,
    sessionToken: privateValues.localSessionToken,
    cookie: privateValues.localCookie,
  };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };

  return {
    base,
    local,
    remote,
    expectedResourceKeys: [
      indexResourceKey,
      formsOptionResourceKey,
      postResourceKey,
    ],
    privateNeedles: [
      'rpp0299-v5-base-private-file',
      privateValues.basePostTitle,
      privateValues.basePostContent,
      privateValues.baseOptionMode,
      privateValues.baseOptionNotes,
      'rpp0299-v5-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0299-v5-local-cookie',
      'rpp0299-v5-stale-remote-file',
    ],
    rawPlannerNeedles: [
      'rpp0299-v5-local-private-file',
      privateValues.localPostTitle,
      privateValues.localPostContent,
      privateValues.localOptionMode,
      privateValues.localOptionNotes,
      privateValues.localSessionToken,
      'rpp0299-v5-local-cookie',
    ],
    staleRemoteFile: privateValues.staleRemoteFile,
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

function redactedDescriptor(value, label, reason = 'raw-site-value-field') {
  assert.equal(value.redacted, true, `${label} must be redacted`);
  assert.equal(value.redaction, EVIDENCE_REDACTION_MARKER, `${label} redaction marker`);
  assert.equal(value.reason, reason, `${label} redaction reason`);
  assert.match(value.sha256, sha256HexPattern, `${label} digest`);
  assert.equal(Object.hasOwn(value, 'value'), false, `${label} must not carry raw value`);
  return {
    redacted: true,
    redaction: value.redaction,
    reason: value.reason,
    valueType: value.valueType,
    sha256: value.sha256,
    ...(value.characterCount === undefined ? {} : { characterCount: value.characterCount }),
    ...(value.itemCount === undefined ? {} : { itemCount: value.itemCount }),
    ...(value.fieldCount === undefined ? {} : { fieldCount: value.fieldCount }),
  };
}

function assertNoPrivateValues(serialized, privateValues, label) {
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertNoRawFieldNames(serialized, label) {
  for (const field of ['"option_value"', '"post_title"', '"post_content"', '"sessionToken"', '"cookie"']) {
    assert.equal(serialized.includes(field), false, `${label} leaked raw field ${field}`);
  }
}

function plannerProjection(plan) {
  const redactedPlan = redactEvidence(plan);
  return {
    status: redactedPlan.status,
    summary: redactedPlan.summary,
    mutations: redactedPlan.mutations.map((mutation) => {
      const valueRedaction = redactedDescriptor(mutation.value, `${mutation.resourceKey} mutation value`);
      return {
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        valueRedaction,
        mutationEvidenceHash: sha256Evidence({
          id: mutation.id,
          resourceKey: mutation.resourceKey,
          action: mutation.action,
          baseHash: mutation.baseHash,
          localHash: mutation.localHash,
          remoteBeforeHash: mutation.remoteBeforeHash,
          valueRedaction,
        }),
      };
    }),
    preconditions: redactedPlan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
      preconditionEvidenceHash: sha256Evidence(precondition),
    })),
  };
}

function executorJournalProjection(journal) {
  return {
    status: journal.status,
    remoteBeforeHash: journal.remoteBeforeHash,
    entryCount: journal.entries.length,
    entries: journal.entries.map((entry) => {
      const beforeValue = redactedDescriptor(entry.beforeValue, `${entry.resourceKey} journal beforeValue`);
      const afterValue = redactedDescriptor(entry.afterValue, `${entry.resourceKey} journal afterValue`);
      return {
        mutationId: entry.mutationId,
        resourceKey: entry.resourceKey,
        action: entry.action,
        status: entry.status,
        beforeHash: entry.beforeHash,
        beforeValue,
        afterHash: entry.afterHash,
        afterValue,
        journalEntryEvidenceHash: sha256Evidence({
          mutationId: entry.mutationId,
          resourceKey: entry.resourceKey,
          action: entry.action,
          status: entry.status,
          beforeHash: entry.beforeHash,
          beforeValue,
          afterHash: entry.afterHash,
          afterValue,
        }),
      };
    }),
  };
}

function summarizeRedactedRawValueReleaseVerifierProof() {
  const fixture = rpp0299Fixture();
  const readyPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });

  const executorRemote = cloneJson(fixture.remote);
  const executorRemoteBeforeHash = digest(executorRemote);
  const executorRemoteProofHashBefore = sha256Evidence(executorRemote);
  const journalPath = tempJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'rpp-0299-redacted-raw-value-release-verifier-v5',
  });
  let executorError;
  try {
    executorError = captureError(() => applyPlan(executorRemote, readyPlan, {
      mutateRemote: true,
      failAfterStaging: true,
      durableJournal,
    }));
  } finally {
    durableJournal.close();
  }
  const persistedJournal = readRecoveryJournal(journalPath);

  const staleRemote = cloneJson(fixture.remote);
  staleRemote.files['index.php'] = fixture.staleRemoteFile;
  const staleRemoteBeforeHash = digest(staleRemote);
  const staleRemoteProofHashBefore = sha256Evidence(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, { mutateRemote: true }));

  const rawSerializedCandidate = JSON.stringify({
    planner: readyPlan,
    executorRecovery: executorError.details.recovery,
  });
  const rawEvidenceCandidate = JSON.parse(rawSerializedCandidate);
  const rawIssues = findEvidenceRedactionIssues(rawEvidenceCandidate);
  const redactedCandidate = redactEvidence(rawEvidenceCandidate);

  const planner = plannerProjection(readyPlan);
  const replayPlanner = plannerProjection(replayPlan);
  const executorJournal = executorJournalProjection(executorError.details.recovery.artifacts.journal);

  const proof = {
    rpp: 'RPP-0299',
    behavior: 'Redacted raw value evidence release verifier, variant 5',
    command,
    evidenceSource: 'release-verifier-redacted-raw-value-evidence-v5',
    status: 'support_only',
    verdict: 'REDACTED_RAW_VALUE_EVIDENCE_HASH_ONLY_SUPPORT',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    releaseVerifier: {
      checkedBy: command,
      check: 'redacted-raw-value-evidence',
      variant: 'v5',
      serializedRawEvidenceRejected: true,
      plannerMutationPayloadsRedacted: true,
      executorJournalPayloadsRedacted: true,
      stalePreconditionPayloadsHashOnly: true,
      deterministicReplay: true,
    },
    plan: {
      status: readyPlan.status,
      summary: readyPlan.summary,
      mutationCount: readyPlan.mutations.length,
      preconditionCount: readyPlan.preconditions.length,
      planHash: sha256Evidence(planner),
      replayHash: sha256Evidence(replayPlanner),
    },
    planner,
    executor: {
      code: executorError.code,
      recoveryStatus: executorError.details.recovery.status,
      detailsHash: sha256Evidence(executorError.details),
      remoteHashBefore: executorRemoteProofHashBefore,
      remoteHashAfter: sha256Evidence(executorRemote),
      journal: executorJournal,
      durableJournal: {
        integrity: persistedJournal.integrity.status,
        recordTypes: persistedJournal.records.map((record) => record.type),
        recordsHash: sha256Evidence(persistedJournal.records),
      },
    },
    stalePrecondition: {
      code: staleError.code,
      resourceKey: staleError.details.resourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      detailsHash: sha256Evidence(staleError.details),
      remoteHashBefore: staleRemoteProofHashBefore,
      remoteHashAfter: sha256Evidence(staleRemote),
    },
    redaction: {
      format: 'hash-only-with-redaction-descriptors',
      evidenceSurfacesRedacted: true,
      rawValuesIncluded: false,
      rawFieldNamesIncluded: false,
      checkedFixtureCount: fixture.privateNeedles.length,
      rawIssueCountBefore: rawIssues.length,
      rawIssueCountAfter: findEvidenceRedactionIssues(redactedCandidate).length,
      surfaces: [
        'planner-mutation-value-fields',
        'executor-recovery-journal-before-after-fields',
        'durable-recovery-journal-records',
        'stale-precondition-refusal-details',
        'release-verifier-proof',
      ],
    },
  };
  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    plan: proof.plan,
    planner: proof.planner,
    executor: proof.executor,
    stalePrecondition: proof.stalePrecondition,
    redaction: proof.redaction,
  });

  return {
    fixture,
    readyPlan,
    replayPlan,
    executorError,
    executorRemote,
    executorRemoteBeforeHash,
    persistedJournal,
    staleError,
    staleRemote,
    staleRemoteBeforeHash,
    rawSerializedCandidate,
    rawEvidenceCandidate,
    rawIssues,
    redactedCandidate,
    proof,
  };
}

test('RPP-0299 release verifier carries redacted raw value evidence as support-only hash proof', () => {
  const {
    fixture,
    readyPlan,
    replayPlan,
    executorError,
    executorRemote,
    executorRemoteBeforeHash,
    persistedJournal,
    staleError,
    staleRemote,
    staleRemoteBeforeHash,
    rawSerializedCandidate,
    rawEvidenceCandidate,
    rawIssues,
    redactedCandidate,
    proof,
  } = summarizeRedactedRawValueReleaseVerifierProof();

  assert.equal(proof.rpp, 'RPP-0299');
  assert.equal(proof.evidenceSource, 'release-verifier-redacted-raw-value-evidence-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'REDACTED_RAW_VALUE_EVIDENCE_HASH_ONLY_SUPPORT');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: command,
    check: 'redacted-raw-value-evidence',
    variant: 'v5',
    serializedRawEvidenceRejected: true,
    plannerMutationPayloadsRedacted: true,
    executorJournalPayloadsRedacted: true,
    stalePreconditionPayloadsHashOnly: true,
    deterministicReplay: true,
  });

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
  assert.deepEqual(proof.planner, plannerProjection(replayPlan));
  assert.equal(proof.plan.planHash, proof.plan.replayHash);
  assert.match(proof.plan.planHash, sha256EvidencePattern);

  for (const resourceKey of fixture.expectedResourceKeys) {
    const mutation = mutationFor(readyPlan, resourceKey);
    assert.ok(mutation, `${resourceKey} mutation`);
    const precondition = readyPlan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${resourceKey} precondition`);
    assert.equal(precondition.resourceKey, resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, resourceHash(fixture.remote, mutation.resource));
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }

  assert.ok(executorError instanceof PushPlanError);
  assert.equal(executorError.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assert.equal(executorError.details.recovery.status, 'old-remote');
  assert.equal(executorError.details.recovery.artifacts.journal.status, 'staged');
  assert.equal(executorError.details.recovery.artifacts.journal.entries.length, readyPlan.mutations.length);
  assert.equal(digest(executorRemote), executorRemoteBeforeHash, 'after-staging failure mutated remote');
  assert.deepEqual(
    persistedJournal.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'target-planned',
      'apply-staged',
      'recovery-state',
    ],
  );
  assert.equal(persistedJournal.integrity.status, 'ok');
  for (const record of persistedJournal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, indexResourceKey);
  assert.match(staleError.details.expectedHash, sha256HexPattern);
  assert.match(staleError.details.actualHash, sha256HexPattern);
  assert.equal(digest(staleRemote), staleRemoteBeforeHash, 'stale precondition refusal mutated remote');

  for (const privateValue of fixture.rawPlannerNeedles) {
    assert.equal(
      rawSerializedCandidate.includes(privateValue),
      true,
      `raw candidate did not exercise ${privateValue}`,
    );
  }
  assert.ok(rawIssues.some((issue) => /\.planner\.mutations\[\d+\]\.value$/u.test(issue.path)));
  assert.throws(
    () => assertEvidenceHasNoRawValues(rawEvidenceCandidate, { label: 'RPP-0299 raw serialized candidate' }),
    { code: 'EVIDENCE_RAW_VALUE_FIELD' },
  );
  assert.deepEqual(findEvidenceRedactionIssues(redactedCandidate), []);

  assert.equal(proof.executor.journal.entryCount, readyPlan.mutations.length);
  for (const mutation of proof.planner.mutations) {
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
    assert.match(mutation.mutationEvidenceHash, sha256EvidencePattern);
    assert.equal(mutation.valueRedaction.redaction, EVIDENCE_REDACTION_MARKER);
  }
  for (const precondition of proof.planner.preconditions) {
    assert.match(precondition.expectedHash, sha256HexPattern);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.match(precondition.preconditionEvidenceHash, sha256EvidencePattern);
  }
  for (const entry of proof.executor.journal.entries) {
    assert.match(entry.beforeHash, sha256HexPattern);
    assert.match(entry.afterHash, sha256HexPattern);
    assert.match(entry.journalEntryEvidenceHash, sha256EvidencePattern);
    assert.equal(entry.beforeValue.redaction, EVIDENCE_REDACTION_MARKER);
    assert.equal(entry.afterValue.redaction, EVIDENCE_REDACTION_MARKER);
  }
  assert.equal(proof.executor.remoteHashBefore, proof.executor.remoteHashAfter);
  assert.equal(proof.stalePrecondition.remoteHashBefore, proof.stalePrecondition.remoteHashAfter);
  assert.match(proof.executor.detailsHash, sha256EvidencePattern);
  assert.match(proof.executor.durableJournal.recordsHash, sha256EvidencePattern);
  assert.match(proof.stalePrecondition.detailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.deepEqual(proof.redaction.surfaces, [
    'planner-mutation-value-fields',
    'executor-recovery-journal-before-after-fields',
    'durable-recovery-journal-records',
    'stale-precondition-refusal-details',
    'release-verifier-proof',
  ]);
  assert.equal(proof.redaction.rawIssueCountAfter, 0);

  const durableSerialized = JSON.stringify(persistedJournal.records);
  const proofSerialized = JSON.stringify(JSON.parse(JSON.stringify(proof)));
  assertNoPrivateValues(durableSerialized, fixture.privateNeedles, 'durable release verifier journal');
  assertNoPrivateValues(proofSerialized, fixture.privateNeedles, 'RPP-0299 release verifier proof');
  assertNoRawFieldNames(proofSerialized, 'RPP-0299 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(JSON.parse(proofSerialized), {
      label: 'RPP-0299 release verifier redacted raw-value proof',
    }));
});
