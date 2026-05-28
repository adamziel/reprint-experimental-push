import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  appendRecoveryClaimOpened,
  appendStaleClaimAdvanced,
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  recoveryClaimHash,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import { deserializeResourceValue, resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempRecoveryJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-push-apply-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function failingDurableJournal(failType) {
  return {
    claimFenced: true,
    claimHash: 'a'.repeat(64),
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      if (type === failType) {
        throw new Error(`injected journal failure for ${type}`);
      }
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function unfencedDurableJournal() {
  return {
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function halfInitializedDurableJournal() {
  return {
    claimFenced: true,
    claimHash: 'not-a-valid-claim-hash',
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'basic' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function loadJsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function playgroundLocalEditedSnapshot() {
  return withStablePlaygroundAuthorIdentities(
    loadJsonFixture('fixtures/playground/local-edited.snapshot.json'),
  );
}

function playgroundBaseWithoutLocalOnlyGraphRows(snapshot) {
  const base = cloneJson(snapshot);
  delete base.db.wp_posts['ID:2001'];
  delete base.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'];
  return base;
}

function withStablePlaygroundAuthorIdentities(snapshot) {
  const next = cloneJson(snapshot);
  next.db.wp_users = next.db.wp_users || {};
  for (const post of Object.values(next.db.wp_posts || {})) {
    const userId = Number.parseInt(String(post.post_author), 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      continue;
    }
    const rowId = `ID:${userId}`;
    next.db.wp_users[rowId] = next.db.wp_users[rowId] || {
      ID: userId,
    };
  }
  return next;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function deserializeMutationValue(mutation) {
  return deserializeResourceValue(mutation.value);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function pluginResource(name) {
  return { type: 'plugin', name, key: `plugin:${name}` };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { pluginOwner, resourceKey, driver, ...extra };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function tamperReadyPlan(plan, mutate) {
  const copy = JSON.parse(JSON.stringify(plan));
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

function rpp0233LocalHashFixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = cloneJson(baseSite());
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0233-local-private-file";',
    'rpp0233-local-private-row-title',
    'rpp0233-local-private-option-mode',
    'rpp0233-invalid-raw-local-hash',
    'rpp0233-forged-mutation-value-secret',
    'rpp0233-stale-local-hash-source-secret',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[2];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms', 'wp-option'),
    ),
  };

  return {
    base,
    local,
    remote,
    privateValues,
    pluginOptionResourceKey,
    mutationResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
  };
}

function rpp0233HashOnlyPlanEvidence(plan, error) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: rpp0233HashFieldEvidence(mutation.localHash),
      remoteBeforeHash: rpp0233HashFieldEvidence(mutation.remoteBeforeHash),
      plannedValueHash: digest(deserializeMutationValue(mutation)),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: rpp0233HashFieldEvidence(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    refusal: error ? {
      code: error.code,
      message: error.message,
      details: error.details,
      detailsHash: sha256Evidence(error.details),
    } : null,
  };
}

function rpp0233HashFieldEvidence(value) {
  if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: sha256Evidence(value),
    valueType: typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannerSummaryCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function plannerSummaryEvidenceEnvelope(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    preconditions: plan.preconditions.map((precondition) => [
      precondition.mutationId,
      precondition.resourceKey,
      precondition.expectedHash,
    ]),
    mutations: plan.mutations.map((mutation) => [
      mutation.id,
      mutation.resourceKey,
      mutation.action,
      mutation.atomicGroupId,
    ]),
    decisions: plan.decisions.map((decision) => [
      decision.id,
      decision.resourceKey,
      decision.decision,
    ]),
    conflicts: plan.conflicts.map((conflict) => [
      conflict.id,
      conflict.resourceKey,
      conflict.class,
    ]),
    blockers: plan.blockers.map((blocker) => [
      blocker.id,
      blocker.resourceKey || null,
      blocker.class,
      blocker.groupId || null,
    ]),
    atomicGroups: plan.atomicGroups.map((group) => [
      group.id,
      group.status,
      group.mutationIds,
      group.conflicts,
      group.blockers.map((blocker) => blocker.id),
    ]),
  };
}

function pluginOwnerContextHashEvidenceEnvelope(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      pluginOwnedResource: mutation.pluginOwnedResource
        ? {
            pluginOwner: mutation.pluginOwnedResource.pluginOwner,
            driver: mutation.pluginOwnedResource.driver,
            ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
            ownerContext: (mutation.pluginOwnedResource.ownerContext || []).map((context) => ({
              resourceKey: context.resourceKey,
              remoteHash: context.remoteHash,
            })),
          }
        : null,
    })),
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
    })),
  };
}

function assertPlannerSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(plan.summary, plannerSummaryCounts(plan), `${label} summary totals mismatch`);
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} preconditions should remain one-for-one with emitted mutations`,
  );
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${label} status does not match emitted conflicts/blockers`,
  );
}

function buildRpp0210SummaryCountCases() {
  const readyBase = baseSite();
  const readyLocal = baseSite();
  const readyRemote = baseSite();
  readyLocal.files['index.php'] = '<?php echo "local summary proof";';
  readyRemote.db.wp_posts['ID:1'].post_title = 'Remote summary proof title';

  const conflictBase = baseSite();
  const conflictLocal = baseSite();
  const conflictRemote = baseSite();
  conflictLocal.db.wp_posts['ID:1'].post_title = 'Local summary conflict title';
  conflictRemote.db.wp_posts['ID:1'].post_title = 'Remote summary conflict title';

  const blockedBase = baseSite();
  const blockedLocal = baseSite();
  const blockedRemote = baseSite();
  blockedLocal.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-summary-blocked';

  const atomicBase = baseSite();
  const atomicLocal = baseSite();
  const atomicRemote = baseSite();
  atomicLocal.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency summary */';
  atomicLocal.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent summary */';
  atomicLocal.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  atomicLocal.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  atomicLocal.db.wp_options['option_name:reprint_push_atomic_summary_data'] = {
    option_name: 'reprint_push_atomic_summary_data',
    option_value: { mode: 'installed' },
    __pluginOwner: atomicDependentPlugin,
  };
  atomicLocal.pushIntents = [
    {
      id: 'install-atomic-summary-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
        'row:["wp_options","option_name:reprint_push_atomic_summary_data"]',
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(atomicLocal, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_summary_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];

  return [
    {
      label: 'ready local mutation plus keep-remote decision',
      base: readyBase,
      local: readyLocal,
      remote: readyRemote,
      expectedStatus: 'ready',
      expectedSummary: {
        mutations: 1,
        decisions: 1,
        conflicts: 0,
        blockers: 0,
        atomicGroups: 0,
      },
    },
    {
      label: 'row conflict',
      base: conflictBase,
      local: conflictLocal,
      remote: conflictRemote,
      expectedStatus: 'conflict',
      expectedSummary: {
        mutations: 0,
        decisions: 0,
        conflicts: 1,
        blockers: 0,
        atomicGroups: 0,
      },
    },
    {
      label: 'blocked plugin-owned row',
      base: blockedBase,
      local: blockedLocal,
      remote: blockedRemote,
      expectedStatus: 'blocked',
      expectedSummary: {
        mutations: 0,
        decisions: 0,
        conflicts: 0,
        blockers: 1,
        atomicGroups: 0,
      },
    },
    {
      label: 'ready atomic plugin bundle',
      base: atomicBase,
      local: atomicLocal,
      remote: atomicRemote,
      expectedStatus: 'ready',
      expectedSummary: {
        mutations: 5,
        decisions: 0,
        conflicts: 0,
        blockers: 0,
        atomicGroups: 1,
      },
    },
  ];
}

test('RPP-0210 planner summary counts match emitted evidence deterministically', () => {
  for (const fixture of buildRpp0210SummaryCountCases()) {
    const firstPlan = planFor(fixture.base, fixture.local, fixture.remote);
    const secondPlan = planFor(
      cloneJson(fixture.base),
      cloneJson(fixture.local),
      cloneJson(fixture.remote),
    );

    assertPlannerSummaryMatchesEvidence(firstPlan, fixture.label);
    assertPlannerSummaryMatchesEvidence(secondPlan, `${fixture.label} replay`);
    assert.equal(firstPlan.status, fixture.expectedStatus, `${fixture.label} status`);
    assert.deepEqual(firstPlan.summary, fixture.expectedSummary, `${fixture.label} expected summary`);
    assert.deepEqual(
      plannerSummaryEvidenceEnvelope(firstPlan),
      plannerSummaryEvidenceEnvelope(secondPlan),
      `${fixture.label} summary envelope changed between deterministic planning runs`,
    );
  }
});

test('plans and applies local changes when remote still matches the pull base', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';

  const plan = planFor(base, local, baseSite());

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local";');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Local title');
});

test('keeps remote-only changes and does not overwrite them', () => {
  const base = baseSite();
  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Remote editorial update';

  const plan = planFor(base, baseSite(), remote);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.decisions[0].decision, 'keep-remote');
  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Remote editorial update');
});

test('combines non-overlapping local and remote changes', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.db.wp_posts['ID:1'].post_title = 'Remote title';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Remote title');
});

test('applies an independent local row while preserving remote file edits behind preconditions', () => {
  const rowKey = 'row:["wp_posts","ID:1"]';
  const fileKey = 'file:index.php';
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Local row edit should be applied';
  remote.files['index.php'] = '<?php echo "remote file edit must be preserved";';

  const plan = planFor(base, local, remote);
  const rowMutation = mutationFor(plan, rowKey);
  const fileMutation = mutationFor(plan, fileKey);
  const fileDecision = decisionFor(plan, fileKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.ok(rowMutation);
  assert.equal(rowMutation.action, 'put');
  assert.equal(rowMutation.change.localChange, 'update');
  assert.equal(rowMutation.change.remoteChange, 'unchanged');
  assert.equal(fileMutation, undefined);
  assert.equal(fileDecision.decision, 'keep-remote');
  assert.equal(fileDecision.change.localChange, 'unchanged');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(JSON.parse(JSON.stringify(remote)), plan);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Local row edit should be applied');
  assert.equal(result.site.files['index.php'], '<?php echo "remote file edit must be preserved";');

  const staleRemote = JSON.parse(JSON.stringify(remote));
  staleRemote.db.wp_posts['ID:1'].post_title = 'Remote row drift after dry run';
  const staleBefore = JSON.stringify(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, plan));
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(staleRemote), staleBefore);

  const forged = tamperReadyPlan(plan, (copy) => {
    copy.mutations.push({
      id: 'mutation-forged-remote-file',
      resource: { type: 'file', path: 'index.php', key: fileKey },
      resourceKey: fileKey,
      action: 'put',
      value: {
        value: {
          type: 'file',
          content: 'forged overwrite of remote file',
        },
      },
      remoteBeforeHash: fileDecision.remoteHash,
      baseHash: fileDecision.baseHash,
      localHash: resourceHash(local, { type: 'file', path: 'index.php', key: fileKey }),
      changeKind: 'update',
      change: {
        localChange: 'update',
        remoteChange: 'update',
      },
      atomicGroupId: null,
    });
    copy.summary.mutations = copy.mutations.length;
  });
  const forgedRemote = JSON.parse(JSON.stringify(remote));
  const forgedBefore = JSON.stringify(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forged));
  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'PRECONDITION_MISSING');
  assert.equal(JSON.stringify(forgedRemote), forgedBefore);
});

test('plans local deletions only behind live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];

  const plan = planFor(base, local, baseSite());
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(baseSite(), plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
});

test('stops a local deletion when the remote edited the same resource', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:1'].post_title = 'Remote secret editorial update';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(JSON.stringify(conflict).includes('Remote secret editorial update'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Remote secret editorial update');
});

test('stops a local directory deletion that would remove a remote-only descendant', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:wp-content/uploads/gallery'),
    false,
  );
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote private image bytes');
});

test('RPP-0205 stops local file type swaps that would hide remote descendants without leaking file bytes', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local private replacement bytes';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private descendant bytes';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const serializedPlan = JSON.stringify(plan);
  const remoteBefore = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:wp-content/uploads/gallery'),
    false,
  );
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'type-change');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.match(conflict.remoteHash, /^[a-f0-9]{64}$/);
  assert.match(conflict.relatedChange.remote.hash, /^[a-f0-9]{64}$/);
  assert.equal(serializedPlan.includes('local private replacement bytes'), false);
  assert.equal(serializedPlan.includes('remote private descendant bytes'), false);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote private descendant bytes');
});

test('keeps independent mutation evidence while suppressing unsafe topology mutations', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('recognizes matching independent edits as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
});

test('recognizes matching independent deletions as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  delete remote.files['index.php'];

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'delete');
  assert.equal(decision.change.remoteChange, 'delete');
});

test('recognizes matching independent file edits as already in sync', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
});

test('RPP-0214 already-in-sync decisions emit no mutations or preconditions with stable counts', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    'shared-private-rpp0214-file-content',
    'Shared private RPP-0214 title',
  ];
  local.files['index.php'] = privateValues[0];
  remote.files['index.php'] = privateValues[0];
  local.plugins.forms = { version: '1.0.1', active: true };
  remote.plugins.forms = { version: '1.0.1', active: true };
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  remote.db.wp_posts['ID:1'].post_title = privateValues[1];

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const decisionsJson = JSON.stringify(firstPlan.decisions);

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 0,
    decisions: 3,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(firstPlan.mutations, []);
  assert.deepEqual(firstPlan.preconditions, []);
  assert.deepEqual(
    firstPlan.decisions.map((decision) => [
      decision.resourceKey,
      decision.decision,
      decision.change.localChange,
      decision.change.remoteChange,
    ]),
    [
      ['file:index.php', 'already-in-sync', 'update', 'update'],
      ['plugin:forms', 'already-in-sync', 'update', 'update'],
      ['row:["wp_posts","ID:1"]', 'already-in-sync', 'update', 'update'],
    ],
  );
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'already-in-sync evidence counts should be stable across deterministic planning runs',
  );
  for (const privateValue of privateValues) {
    assert.equal(decisionsJson.includes(privateValue), false, `decision evidence leaked ${privateValue}`);
  }

  const beforeRemote = JSON.stringify(remote);
  const result = applyPlan(remote, firstPlan);
  assert.equal(result.appliedMutations, 0);
  assert.equal(JSON.stringify(remote), beforeRemote);
  assert.equal(JSON.stringify(result.site), beforeRemote);
});

test('preserves remote-only plugin changes', () => {
  const base = baseSite();
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 */';

  const plan = planFor(base, baseSite(), remote);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const fileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginDecision.change.remoteChange, 'update');
  assert.equal(fileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* forms 1.1 */');
});

test('combines local ordinary changes while preserving remote-only plugin changes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, 'file:index.php').action, 'put');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local ordinary edit";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('proves plugin uninstall/delete mutations fail closed without an explicit delete driver', () => {
  const plugin = pluginResource('forms');
  const pluginSecret = 'forms-delete-private-version-rpp-0431';
  const base = baseSite();
  base.plugins.forms = { version: pluginSecret, active: true };
  const local = cloneJson(base);
  delete local.plugins.forms;
  const remote = cloneJson(base);

  const blockedPlan = planFor(base, local, remote);
  const blocker = blockedPlan.blockers.find((entry) => entry.resourceKey === plugin.key);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(blockedPlan.status, 'blocked');
  assert.equal(blockedPlan.summary.mutations, 0);
  assert.equal(mutationFor(blockedPlan, plugin.key), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-delete');
  assert.equal(blocker.resource.type, 'plugin');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.requiredDriver, 'plugin-delete');
  assert.match(blocker.reason, /explicit plugin delete driver/);
  assert.equal(blocker.change.localChange, 'delete');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assert.equal(blockerJson.includes(pluginSecret), false);

  const forgedPlan = tamperReadyPlan(blockedPlan, (plan) => {
    plan.mutations = [
      {
        id: 'mutation-forged-plugin-delete',
        resource: plugin,
        resourceKey: plugin.key,
        action: 'delete',
        value: { absent: true },
        remoteBeforeHash: resourceHash(remote, plugin),
        baseHash: resourceHash(base, plugin),
        localHash: resourceHash(local, plugin),
        changeKind: 'delete',
        change: {
          localChange: 'delete',
          remoteChange: 'unchanged',
        },
      },
    ];
    plan.preconditions = [
      {
        mutationId: 'mutation-forged-plugin-delete',
        resource: plugin,
        resourceKey: plugin.key,
        expectedHash: resourceHash(remote, plugin),
        checkedAgainst: 'live-remote',
      },
    ];
    plan.summary.mutations = 1;
    plan.summary.decisions = 0;
  });
  const beforeApply = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forgedPlan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_DELETE');
  assert.deepEqual(error.details, {
    mutationId: 'mutation-forged-plugin-delete',
    resourceKey: plugin.key,
    pluginOwner: 'forms',
    requiredDriver: 'plugin-delete',
  });
  assert.equal(JSON.stringify(remote), beforeApply);

  const evidence = {
    rpp: 'RPP-0431',
    evidenceSource: 'local-focused-node-test',
    productionBacked: false,
    explicitDeleteDriverPresent: false,
    planRefusal: {
      status: blockedPlan.status,
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      requiredDriver: blocker.requiredDriver,
      blockerHash: sha256Evidence(blocker),
    },
    applyRefusal: {
      code: error.code,
      detailsHash: sha256Evidence(error.details),
    },
    hashes: {
      basePluginHash: `sha256:${resourceHash(base, plugin)}`,
      localAbsentHash: `sha256:${resourceHash(local, plugin)}`,
      remotePluginHash: `sha256:${resourceHash(remote, plugin)}`,
    },
  };
  evidence.proofHash = sha256Evidence({
    planRefusal: evidence.planRefusal,
    applyRefusal: evidence.applyRefusal,
    hashes: evidence.hashes,
    explicitDeleteDriverPresent: evidence.explicitDeleteDriverPresent,
  });

  assert.match(evidence.planRefusal.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.applyRefusal.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.hashes.basePluginHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.hashes.localAbsentHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.hashes.remotePluginHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.proofHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidence).includes(pluginSecret), false);
});

test('RPP-0215 keep-remote decisions are deterministic hash-only evidence', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    'remote-private-rpp0215-index-content',
    '9.9.9-rpp0215-private-version',
    'Remote private RPP-0215 title',
  ];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';
  remote.files['index.php'] = privateValues[0];
  remote.plugins.forms = { version: privateValues[1], active: false };
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const keepRemoteKeys = [
    'file:index.php',
    'plugin:forms',
    'row:["wp_posts","ID:1"]',
  ];
  const keepRemoteEvidence = JSON.stringify({
    summary: firstPlan.summary,
    emitted: plannerSummaryCounts(firstPlan),
    decisions: firstPlan.decisions,
    envelope: plannerSummaryEvidenceEnvelope(firstPlan),
  });

  assert.equal(firstPlan.status, 'ready');
  assertPlannerSummaryMatchesEvidence(firstPlan, 'RPP-0215 keep-remote invariant');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 3,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    firstPlan.decisions.map((decision) => [
      decision.resourceKey,
      decision.decision,
      decision.change.localChange,
      decision.change.remoteChange,
    ]),
    [
      ['file:index.php', 'keep-remote', 'unchanged', 'update'],
      ['plugin:forms', 'keep-remote', 'unchanged', 'update'],
      ['row:["wp_posts","ID:1"]', 'keep-remote', 'unchanged', 'update'],
    ],
  );
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'keep-remote evidence counts should be stable across deterministic planning runs',
  );
  assert.equal(mutationFor(firstPlan, 'file:wp-content/themes/theme/style.css').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan);
  for (const resourceKey of keepRemoteKeys) {
    assert.equal(mutationFor(firstPlan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
    assert.equal(
      firstPlan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
      false,
      `${resourceKey} emitted a precondition`,
    );
  }
  for (const privateValue of privateValues) {
    assert.equal(keepRemoteEvidence.includes(privateValue), false, `keep-remote evidence leaked ${privateValue}`);
  }

  const result = applyPlan(remote, firstPlan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: blue; }');
  assert.equal(result.site.files['index.php'], privateValues[0]);
  assert.deepEqual(result.site.plugins.forms, { version: privateValues[1], active: false });
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, privateValues[2]);
});

test('blocks local plugin metadata changes when remote plugin files changed', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins.forms = { version: '1.0.0', active: false };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'plugin:forms'), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, 'plugin:forms');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.active, true);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('RPP-0216 blocked plans refuse apply before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const blockedResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const privateBlockedValue = 'local-private-rpp0216-blocked-mode';
  local.files['index.php'] = '<?php echo "rpp0216 safe local edit";';
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateBlockedValue;

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const firstJournal = [];
  const secondJournal = [];
  const trapJournal = (events) => ({
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  });
  const errorEnvelope = (error) => ({
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
  });
  const beforeRemote = JSON.stringify(remote);

  assert.equal(firstPlan.status, 'blocked');
  assertPlannerSummaryMatchesEvidence(firstPlan, 'RPP-0216 blocked apply refusal');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'blocked apply refusal evidence should be stable across deterministic planning runs',
  );
  assert.deepEqual(firstPlan.blockers, secondPlan.blockers);
  assert.equal(mutationFor(firstPlan, 'file:index.php').action, 'put');
  assert.equal(mutationFor(firstPlan, blockedResourceKey), undefined);
  assert.equal(
    firstPlan.preconditions.some((precondition) => precondition.resourceKey === blockedResourceKey),
    false,
    'blocked resource emitted a precondition',
  );
  assertEveryMutationHasLiveRemotePrecondition(firstPlan);
  assert.equal(firstPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(firstPlan.blockers[0].resourceKey, blockedResourceKey);
  assert.equal(
    JSON.stringify({
      blockers: firstPlan.blockers,
      envelope: plannerSummaryEvidenceEnvelope(firstPlan),
    }).includes(privateBlockedValue),
    false,
    'blocked plan evidence leaked raw private option value',
  );

  const firstError = captureError(() => applyPlan(remote, firstPlan, {
    durableJournal: trapJournal(firstJournal),
  }));
  const secondError = captureError(() => applyPlan(cloneJson(remote), secondPlan, {
    durableJournal: trapJournal(secondJournal),
  }));

  assert.ok(firstError instanceof PushPlanError);
  assert.deepEqual(errorEnvelope(firstError), {
    name: 'PushPlanError',
    code: 'PLAN_NOT_READY',
    message: 'Refusing to apply a blocked plan.',
    details: { status: 'blocked' },
  });
  assert.deepEqual(errorEnvelope(firstError), errorEnvelope(secondError));
  assert.equal(JSON.stringify(errorEnvelope(firstError)).includes(privateBlockedValue), false);
  assert.deepEqual(firstJournal, [], 'blocked apply should refuse before durable journal evidence');
  assert.deepEqual(secondJournal, [], 'blocked apply replay should refuse before durable journal evidence');
  assert.equal(JSON.stringify(remote), beforeRemote);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(
    remote.db.wp_options['option_name:forms_settings'].option_value.mode,
    base.db.wp_options['option_name:forms_settings'].option_value.mode,
  );
});

test('blocks local plugin file changes when remote plugin metadata changed', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local-private-forms-code */';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'file:wp-content/plugins/forms/forms.php'), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'plugin:forms');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('local-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* forms 1.0 */');
});

test('allows plugin file changes when plugin metadata independently matches remote', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.plugins.forms = { version: '1.1.0', active: true };
  remote.plugins.forms = { version: '1.1.0', active: true };
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local forms 1.1 file */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'already-in-sync');
  assert.equal(mutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* local forms 1.1 file */');
});

test('blocks plugin-owned data when owner plugin files changed only on remote', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('RPP-0207 executor rejects stale or forged plugin-owned data owner context', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const ready = planFor(base, local, baseSite());
  const mutation = mutationFor(ready, resourceKey);

  assert.equal(ready.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.ok(mutation.pluginOwnedResource.ownerContext.length > 0);
  assert.equal(
    mutation.pluginOwnedResource.ownerContext.some((context) =>
      context.resourceKey === 'file:wp-content/plugins/forms/forms.php'),
    true,
  );

  const staleRemote = baseSite();
  staleRemote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';
  const staleBefore = JSON.stringify(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, ready));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.resourceKey, resourceKey);
  assert.equal(staleError.details.contextResourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(JSON.stringify(staleRemote), staleBefore);
  assert.equal(JSON.stringify(staleError.details).includes('local-advanced'), false);
  assert.equal(JSON.stringify(staleError.details).includes('remote-private-forms-code'), false);

  const forged = tamperReadyPlan(ready, (plan) => {
    delete mutationFor(plan, resourceKey).pluginOwnedResource.ownerContext;
  });
  const forgedRemote = baseSite();
  const forgedBefore = JSON.stringify(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forged));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(forgedError.details.resourceKey, resourceKey);
  assert.equal(JSON.stringify(forgedRemote), forgedBefore);
});

test('RPP-0227 rejects stale or forged plugin-owned data owner context with hash-only evidence', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const ownerContextKey = 'file:wp-content/plugins/forms/forms.php';
  const ownerContextPath = 'wp-content/plugins/forms/forms.php';
  const privateValues = [
    'rpp0227-local-confidential-mode',
    '<?php /* rpp0227-remote-confidential-owner-file */',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[0];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };

  const ready = planFor(base, local, cloneJson(base));
  const replay = planFor(cloneJson(base), cloneJson(local), cloneJson(base));
  const mutation = mutationFor(ready, resourceKey);
  const ownerContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerContextKey,
  );
  const hashEvidence = pluginOwnerContextHashEvidenceEnvelope(ready);
  const replayHashEvidence = pluginOwnerContextHashEvidenceEnvelope(replay);

  assert.equal(ready.status, 'ready');
  assertPlannerSummaryMatchesEvidence(ready, 'RPP-0227 plugin owner context');
  assert.deepEqual(ready.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assertEveryMutationHasLiveRemotePrecondition(ready);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(ownerContext);
  assert.match(ownerContext.remoteHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(hashEvidence, replayHashEvidence);

  const staleRemote = cloneJson(base);
  staleRemote.files[ownerContextPath] = privateValues[1];
  const staleBefore = JSON.stringify(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, ready));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.resourceKey, resourceKey);
  assert.equal(staleError.details.contextResourceKey, ownerContextKey);
  assert.equal(staleError.details.expectedHash, ownerContext.remoteHash);
  assert.match(staleError.details.actualHash, /^[a-f0-9]{64}$/);
  assert.notEqual(staleError.details.actualHash, staleError.details.expectedHash);
  assert.equal(JSON.stringify(staleRemote), staleBefore);
  assert.deepEqual(staleRemote.db.wp_options['option_name:forms_settings'], base.db.wp_options['option_name:forms_settings']);
  assert.equal(staleRemote.files[ownerContextPath], privateValues[1]);

  const missingContext = tamperReadyPlan(ready, (plan) => {
    delete mutationFor(plan, resourceKey).pluginOwnedResource.ownerContext;
  });
  const missingRemote = cloneJson(base);
  const missingBefore = JSON.stringify(missingRemote);
  const missingError = captureError(() => applyPlan(missingRemote, missingContext));

  assert.ok(missingError instanceof PushPlanError);
  assert.equal(missingError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(missingError.details.resourceKey, resourceKey);
  assert.equal(missingError.details.pluginOwner, 'forms');
  assert.equal(JSON.stringify(missingRemote), missingBefore);
  assert.deepEqual(missingRemote.db.wp_options['option_name:forms_settings'], base.db.wp_options['option_name:forms_settings']);

  const forgedContext = tamperReadyPlan(ready, (plan) => {
    mutationFor(plan, resourceKey).pluginOwnedResource.ownerContext[0].remoteHash = 'not-a-valid-owner-hash';
  });
  const forgedRemote = cloneJson(base);
  const forgedBefore = JSON.stringify(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedContext));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(forgedError.details.resourceKey, resourceKey);
  assert.equal(forgedError.details.contextResourceKey, ownerContextKey);
  assert.equal(JSON.stringify(forgedRemote), forgedBefore);
  assert.deepEqual(forgedRemote.db.wp_options['option_name:forms_settings'], base.db.wp_options['option_name:forms_settings']);

  const serializedEvidence = JSON.stringify({
    plan: hashEvidence,
    refusals: [
      { code: staleError.code, details: staleError.details },
      { code: missingError.code, details: missingError.details },
      { code: forgedError.code, details: forgedError.details },
    ],
  });
  for (const privateValue of privateValues) {
    assert.equal(serializedEvidence.includes(privateValue), false, `RPP-0227 evidence leaked ${privateValue}`);
  }
});

test('allows plugin-owned data when owner plugin context independently matches remote', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'already-in-sync');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('blocks plugin-owned data when the owning plugin is missing or inactive on remote', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.plugins.forms = { version: '1.0.0', active: false };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].pluginOwner, 'forms');
  assert.equal(plan.blockers[0].ownerContext[0].resourceKey, 'plugin:forms');
  assert.equal(plan.blockers[0].ownerContext[0].change.remoteChange, 'update');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
});

test('still blocks plugin-owned data when a same-plan plugin mutation leaves the owner inactive', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  local.pushIntents = [
    {
      id: 'update-forms-plugin',
      kind: 'plugin-update',
      requireAtomic: true,
      resources: ['plugin:forms'],
    },
  ];
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].pluginOwner, 'forms');
  assert.equal(plan.blockers[0].ownerContext[0].resourceKey, 'plugin:forms');
});

test('remote-only plugin removal blocks stale local dependency assumptions', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.pushIntents = [
    {
      id: 'update-forms-settings',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:forms_settings"]'],
      dependencies: { plugins: ['forms'] },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource('row:["wp_options","option_name:forms_settings"]', 'forms'),
      ),
    },
  ];

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(plan.blockers[0].class, 'missing-plugin-dependency');
  assert.equal(plan.blockers[0].plugin, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
});

test('refuses direct conflicts and preserves the remote snapshot', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote title';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.conflicts[0].class, 'row-conflict');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Remote title');
});

test('RPP-0217 conflict plans refuse apply before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const conflictResourceKey = 'row:["wp_posts","ID:1"]';
  const privateConflictValues = [
    'local-private-rpp0217-title',
    'remote-private-rpp0217-title',
  ];
  local.files['index.php'] = '<?php echo "rpp0217 safe local edit";';
  local.db.wp_posts['ID:1'].post_title = privateConflictValues[0];
  remote.db.wp_posts['ID:1'].post_title = privateConflictValues[1];

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const firstJournal = [];
  const secondJournal = [];
  const trapJournal = (events) => ({
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  });
  const errorEnvelope = (error) => ({
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
  });
  const beforeRemote = JSON.stringify(remote);

  assert.equal(firstPlan.status, 'conflict');
  assertPlannerSummaryMatchesEvidence(firstPlan, 'RPP-0217 conflict apply refusal');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'conflict apply refusal evidence should be stable across deterministic planning runs',
  );
  assert.deepEqual(firstPlan.conflicts, secondPlan.conflicts);
  assert.equal(mutationFor(firstPlan, 'file:index.php').action, 'put');
  assert.equal(mutationFor(firstPlan, conflictResourceKey), undefined);
  assert.equal(
    firstPlan.preconditions.some((precondition) => precondition.resourceKey === conflictResourceKey),
    false,
    'conflict resource emitted a precondition',
  );
  assertEveryMutationHasLiveRemotePrecondition(firstPlan);
  assert.equal(firstPlan.conflicts[0].class, 'row-conflict');
  assert.equal(firstPlan.conflicts[0].resourceKey, conflictResourceKey);
  assert.equal(firstPlan.conflicts[0].resolutionPolicy, 'preserve-remote-and-stop');
  const conflictEvidence = JSON.stringify({
    conflicts: firstPlan.conflicts,
    envelope: plannerSummaryEvidenceEnvelope(firstPlan),
  });
  for (const privateValue of privateConflictValues) {
    assert.equal(conflictEvidence.includes(privateValue), false, `conflict evidence leaked ${privateValue}`);
  }

  const firstError = captureError(() => applyPlan(remote, firstPlan, {
    durableJournal: trapJournal(firstJournal),
  }));
  const secondError = captureError(() => applyPlan(cloneJson(remote), secondPlan, {
    durableJournal: trapJournal(secondJournal),
  }));

  assert.ok(firstError instanceof PushPlanError);
  assert.deepEqual(errorEnvelope(firstError), {
    name: 'PushPlanError',
    code: 'PLAN_NOT_READY',
    message: 'Refusing to apply a conflict plan.',
    details: { status: 'conflict' },
  });
  assert.deepEqual(errorEnvelope(firstError), errorEnvelope(secondError));
  for (const privateValue of privateConflictValues) {
    assert.equal(JSON.stringify(errorEnvelope(firstError)).includes(privateValue), false);
  }
  assert.deepEqual(firstJournal, [], 'conflict apply should refuse before durable journal evidence');
  assert.deepEqual(secondJournal, [], 'conflict apply replay should refuse before durable journal evidence');
  assert.equal(JSON.stringify(remote), beforeRemote);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, privateConflictValues[1]);
});

test('RPP-0229 conflict evidence serializes hash-only conflict refusals', () => {
  const base = cloneJson(baseSite());
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const conflictResourceKey = 'row:["wp_posts","ID:1"]';
  const privateValues = [
    'rpp0229-base-confidential-row-title',
    'rpp0229-local-confidential-row-title',
    'rpp0229-remote-confidential-row-title',
    '<?php echo "rpp0229-local-confidential-file";',
  ];
  base.db.wp_posts['ID:1'].post_title = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];
  local.files['index.php'] = privateValues[3];

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const firstJournal = [];
  const secondJournal = [];
  const trapJournal = (events) => ({
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  });
  const hashOnlyConflictEvidence = (plan, error) => ({
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      change: {
        localChange: conflict.change.localChange,
        remoteChange: conflict.change.remoteChange,
        base: {
          state: conflict.change.base.state,
          hash: conflict.change.base.hash,
        },
        local: {
          state: conflict.change.local.state,
          hash: conflict.change.local.hash,
        },
        remote: {
          state: conflict.change.remote.state,
          hash: conflict.change.remote.hash,
        },
      },
      conflictHash: sha256Evidence({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        resolutionPolicy: conflict.resolutionPolicy,
        baseHash: conflict.baseHash,
        localHash: conflict.localHash,
        remoteHash: conflict.remoteHash,
      }),
    })),
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    applyRefusal: {
      code: error.code,
      status: error.details.status,
      detailsHash: sha256Evidence(error.details),
    },
  });

  assert.equal(firstPlan.status, 'conflict');
  assertPlannerSummaryMatchesEvidence(firstPlan, 'RPP-0229 conflict evidence redaction');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'RPP-0229 summary evidence should be deterministic',
  );
  assert.equal(firstPlan.conflicts[0].class, 'row-conflict');
  assert.equal(firstPlan.conflicts[0].resourceKey, conflictResourceKey);
  assert.equal(firstPlan.conflicts[0].resolutionPolicy, 'preserve-remote-and-stop');
  assert.deepEqual(Object.keys(firstPlan.conflicts[0].change.base).sort(), ['hash', 'state']);
  assert.deepEqual(Object.keys(firstPlan.conflicts[0].change.local).sort(), ['hash', 'state']);
  assert.deepEqual(Object.keys(firstPlan.conflicts[0].change.remote).sort(), ['hash', 'state']);
  assert.match(firstPlan.conflicts[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(firstPlan.conflicts[0].localHash, /^[a-f0-9]{64}$/);
  assert.match(firstPlan.conflicts[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(mutationFor(firstPlan, conflictResourceKey), undefined);
  assert.equal(mutationFor(firstPlan, 'file:index.php').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan);

  const beforeRemote = JSON.stringify(remote);
  const firstError = captureError(() => applyPlan(remote, firstPlan, {
    durableJournal: trapJournal(firstJournal),
  }));
  const secondError = captureError(() => applyPlan(cloneJson(remote), secondPlan, {
    durableJournal: trapJournal(secondJournal),
  }));

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.code, 'PLAN_NOT_READY');
  assert.deepEqual(firstError.details, { status: 'conflict' });
  assert.equal(JSON.stringify(remote), beforeRemote);
  assert.deepEqual(firstJournal, [], 'conflict apply should reject before durable journal evidence');
  assert.deepEqual(secondJournal, [], 'conflict replay should reject before durable journal evidence');

  const serializedEvidence = JSON.stringify(hashOnlyConflictEvidence(firstPlan, firstError));
  const replaySerializedEvidence = JSON.stringify(hashOnlyConflictEvidence(secondPlan, secondError));
  assert.equal(serializedEvidence, replaySerializedEvidence);
  for (const conflict of JSON.parse(serializedEvidence).conflicts) {
    assert.match(conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  }
  for (const privateValue of privateValues) {
    assert.equal(serializedEvidence.includes(privateValue), false, `RPP-0229 evidence leaked ${privateValue}`);
    assert.equal(JSON.stringify(firstPlan.conflicts).includes(privateValue), false, `RPP-0229 conflict leaked ${privateValue}`);
    assert.equal(JSON.stringify(firstError.details).includes(privateValue), false, `RPP-0229 refusal leaked ${privateValue}`);
  }
});

test('RPP-0237 conflict plans reject apply, forged ready status, and stale mutation attempts before mutation', () => {
  const base = cloneJson(baseSite());
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const conflictResourceKey = 'row:["wp_posts","ID:1"]';
  const independentMutationKey = 'file:index.php';
  const privateValues = [
    'rpp0237-base-private-row-title',
    'rpp0237-local-private-row-title',
    'rpp0237-remote-private-row-title',
    '<?php echo "rpp0237-local-private-file";',
    '<?php echo "rpp0237-stale-remote-file";',
  ];
  base.db.wp_posts['ID:1'].post_title = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];
  local.files['index.php'] = privateValues[3];

  const firstPlan = planFor(base, local, remote);
  const secondPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const conflictJournalEvents = [];
  const forgedJournalEvents = [];
  const staleJournalEvents = [];
  const claimFencedJournal = (events) => ({
    claimFenced: true,
    claimHash: 'b'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  });
  const hashOnlyEvidence = (plan, applyError, forgedError, staleError) => ({
    command: 'node --test --test-name-pattern=RPP-0237 test/push-planner.test.js',
    caveat: 'Focused local planner/apply proof; release remains gated separately.',
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      conflictHash: sha256Evidence({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        baseHash: conflict.baseHash,
        localHash: conflict.localHash,
        remoteHash: conflict.remoteHash,
      }),
    })),
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    refusals: {
      conflictApply: {
        code: applyError.code,
        detailsHash: sha256Evidence(applyError.details),
      },
      forgedReadyWithConflictEvidence: {
        code: forgedError.code,
        issueCodes: forgedError.details.issues.map((issue) => issue.code).sort(),
        detailsHash: sha256Evidence(forgedError.details),
      },
      staleMutationAttempt: {
        code: staleError.code,
        detailsHash: sha256Evidence(staleError.details),
      },
    },
    journalEventCounts: {
      conflictApply: conflictJournalEvents.length,
      forgedReady: forgedJournalEvents.length,
      staleAttempt: staleJournalEvents.length,
      mutationEvents: [
        ...conflictJournalEvents,
        ...forgedJournalEvents,
        ...staleJournalEvents,
      ].filter((event) => event.type.includes('mutation')).length,
    },
  });

  assert.equal(firstPlan.status, 'conflict');
  assertPlannerSummaryMatchesEvidence(firstPlan, 'RPP-0237 conflict apply refusal');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(firstPlan),
    plannerSummaryEvidenceEnvelope(secondPlan),
    'RPP-0237 conflict refusal evidence should be deterministic',
  );
  assert.equal(firstPlan.conflicts[0].resourceKey, conflictResourceKey);
  assert.equal(firstPlan.conflicts[0].class, 'row-conflict');
  assert.equal(firstPlan.conflicts[0].resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(mutationFor(firstPlan, conflictResourceKey), undefined);
  assert.equal(mutationFor(firstPlan, independentMutationKey).action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan);

  const beforeRemoteHash = digest(remote);
  let appliedMutationCount = 0;
  const conflictApplyError = captureError(() => {
    const result = applyPlan(remote, firstPlan, {
      durableJournal: claimFencedJournal(conflictJournalEvents),
    });
    appliedMutationCount = result.appliedMutations;
  });
  assert.ok(conflictApplyError instanceof PushPlanError);
  assert.equal(conflictApplyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(conflictApplyError.details, { status: 'conflict' });
  assert.equal(appliedMutationCount, 0);
  assert.equal(digest(remote), beforeRemoteHash);
  assert.deepEqual(conflictJournalEvents, []);

  const forgedReadyWithConflictEvidence = cloneJson(firstPlan);
  forgedReadyWithConflictEvidence.status = 'ready';
  const forgedRemote = cloneJson(remote);
  const forgedBeforeHash = digest(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedReadyWithConflictEvidence, {
    durableJournal: claimFencedJournal(forgedJournalEvents),
  }));
  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    forgedError.details.issues.some((issue) => issue.code === 'READY_PLAN_HAS_CONFLICTS'),
    'forged ready status should keep conflict evidence fail-closed',
  );
  assert.equal(digest(forgedRemote), forgedBeforeHash);
  assert.deepEqual(forgedJournalEvents, []);

  const staleForgedReady = tamperReadyPlan(firstPlan, () => {});
  const staleRemote = cloneJson(remote);
  staleRemote.files['index.php'] = privateValues[4];
  const staleBeforeHash = digest(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, staleForgedReady, {
    durableJournal: claimFencedJournal(staleJournalEvents),
  }));
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(digest(staleRemote), staleBeforeHash);
  assert.equal(
    staleJournalEvents.filter((event) => event.type.includes('mutation')).length,
    0,
    'stale forged conflict plan wrote mutation journal evidence before refusal',
  );

  const serializedEvidence = JSON.stringify({
    ...hashOnlyEvidence(firstPlan, conflictApplyError, forgedError, staleError),
    evidenceHash: sha256Evidence(hashOnlyEvidence(firstPlan, conflictApplyError, forgedError, staleError)),
  });
  assert.match(JSON.parse(serializedEvidence).evidenceHash, /^sha256:[a-f0-9]{64}$/);
  for (const privateValue of privateValues) {
    assert.equal(serializedEvidence.includes(privateValue), false, `RPP-0237 evidence leaked ${privateValue}`);
  }
});

test('classifies plugin-owned data conflicts separately from generic rows', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  remote.db.wp_options['option_name:forms_settings'].option_value.mode = 'remote-advanced';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.conflicts[0].class, 'plugin-data-conflict');
  assert.equal(plan.conflicts[0].pluginOwner, 'forms');
});

test('allows plugin-owned option rows only with explicit snapshot driver policy', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';

  const blockedPlan = planFor(base, local, baseSite());
  assert.equal(blockedPlan.status, 'blocked');
  assert.equal(blockedPlan.summary.mutations, 0);
  assert.equal(blockedPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(blockedPlan.blockers[0].pluginOwner, 'forms');
  assert.equal(blockedPlan.blockers[0].resourceKey, resourceKey);

  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const readyPlan = planFor(base, local, baseSite());

  assert.equal(readyPlan.status, 'ready');
  assert.equal(mutationFor(readyPlan, resourceKey).changeKind, 'update');
});

test('RPP-0439 driver audit evidence is hash-only and stale apply preserves plugin-owned remote data', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const baseSecret = 'audit-redaction-base-private-rpp-0439';
  const localSecret = 'audit-redaction-local-private-rpp-0439';
  const remoteDriftSecret = 'audit-redaction-remote-drift-rpp-0439';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'].option_value.mode = baseSecret;
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = localSecret;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(auditEvidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.resourceKey, resourceKey);
  assert.equal(auditEvidence.pluginOwner, 'forms');
  assert.equal(auditEvidence.driver, 'wp-option');
  assert.equal(auditEvidence.baseHash, mutation.baseHash);
  assert.equal(auditEvidence.localHash, mutation.localHash);
  assert.equal(auditEvidence.remoteHash, mutation.remoteBeforeHash);
  assert.match(auditEvidence.ownerContextHash, /^[a-f0-9]{64}$/);

  const driftedRemote = cloneJson(remote);
  driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode = remoteDriftSecret;
  const driftedRowBeforeHash = resourceHash(driftedRemote, mutation.resource);
  const driftedRemoteBeforeHash = sha256Evidence(driftedRemote);
  const staleError = captureError(() => applyPlan(driftedRemote, plan));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.deepEqual(staleError.details, {
    resourceKey,
    expectedHash: mutation.remoteBeforeHash,
    actualHash: driftedRowBeforeHash,
  });
  assert.equal(
    driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode,
    remoteDriftSecret,
  );
  assert.equal(resourceHash(driftedRemote, mutation.resource), driftedRowBeforeHash);
  assert.equal(sha256Evidence(driftedRemote), driftedRemoteBeforeHash);

  const evidence = {
    rpp: 'RPP-0439',
    evidenceSource: 'local-focused-node-test',
    productionBacked: false,
    audit: {
      resourceKey: auditEvidence.resourceKey,
      pluginOwner: auditEvidence.pluginOwner,
      driver: auditEvidence.driver,
      format: auditEvidence.format,
      rawValuesIncluded: auditEvidence.rawValuesIncluded,
      auditEvidenceHash: sha256Evidence(auditEvidence),
      ownerContextHash: `sha256:${auditEvidence.ownerContextHash}`,
    },
    staleRemotePreservation: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      rowHashBefore: `sha256:${driftedRowBeforeHash}`,
      rowHashAfter: `sha256:${resourceHash(driftedRemote, mutation.resource)}`,
      remoteHashBefore: driftedRemoteBeforeHash,
      remoteHashAfter: sha256Evidence(driftedRemote),
    },
  };
  evidence.proofHash = sha256Evidence({
    audit: evidence.audit,
    staleRemotePreservation: evidence.staleRemotePreservation,
  });

  assert.equal(evidence.staleRemotePreservation.rowHashAfter, evidence.staleRemotePreservation.rowHashBefore);
  assert.equal(evidence.staleRemotePreservation.remoteHashAfter, evidence.staleRemotePreservation.remoteHashBefore);
  assert.match(evidence.audit.auditEvidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.staleRemotePreservation.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.proofHash, /^sha256:[a-f0-9]{64}$/);
  const serializedAudit = JSON.stringify(auditEvidence);
  const serializedEvidence = JSON.stringify(evidence);
  for (const rawValue of [baseSecret, localSecret, remoteDriftSecret]) {
    assert.equal(serializedAudit.includes(rawValue), false, `audit leaked ${rawValue}`);
    assert.equal(serializedEvidence.includes(rawValue), false, `evidence leaked ${rawValue}`);
  }
});


test('RPP-0468 serialized option validator accepts valid payloads and refuses invalid payloads before mutation', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_serialized_settings"]';
  const resource = {
    type: 'row',
    table: 'wp_options',
    id: 'option_name:forms_serialized_settings',
    key: resourceKey,
  };
  const validBaseSerialized = 'a:1:{s:4:"mode";s:4:"base";}';
  const validLocalSerialized = 'a:1:{s:4:"mode";s:5:"local";}';
  const invalidLocalSerialized = 'a:1:{s:4:"mode";s:20:"oops";}';
  const invalidForgedSerialized = 'a:1:{s:4:"mode";s:21:"forged";}';
  const privateValues = [
    validBaseSerialized,
    validLocalSerialized,
    invalidLocalSerialized,
    invalidForgedSerialized,
  ];
  const base = baseSite();
  base.db.wp_options['option_name:forms_serialized_settings'] = {
    option_name: 'forms_serialized_settings',
    option_value: validBaseSerialized,
    serialization: 'php-serialize',
    __pluginOwner: 'forms',
  };
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_serialized_settings'].option_value = validLocalSerialized;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const appliedRemote = cloneJson(remote);
  const applied = applyPlan(appliedRemote, plan);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(auditEvidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.match(auditEvidence.serializedOptionValidationHash, /^[a-f0-9]{64}$/);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(
    applied.site.db.wp_options['option_name:forms_serialized_settings'].option_value,
    validLocalSerialized,
  );

  const invalidLocal = cloneJson(base);
  invalidLocal.db.wp_options['option_name:forms_serialized_settings'].option_value = invalidLocalSerialized;
  invalidLocal.meta = cloneJson(local.meta);
  const invalidRemote = cloneJson(base);
  const invalidRemoteBeforeHash = sha256Evidence(invalidRemote);
  const invalidRowBeforeHash = `sha256:${resourceHash(invalidRemote, resource)}`;
  const invalidPlan = planFor(base, invalidLocal, invalidRemote);
  const invalidBlocker = invalidPlan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const invalidApplyError = captureError(() => applyPlan(invalidRemote, invalidPlan));

  assert.equal(invalidPlan.status, 'blocked');
  assert.equal(invalidPlan.summary.mutations, 0);
  assert.equal(mutationFor(invalidPlan, resourceKey), undefined);
  assert.equal(invalidBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(invalidBlocker.pluginOwner, 'forms');
  assert.equal(invalidBlocker.driver, 'wp-option');
  assert.equal(invalidBlocker.serializedOptionValidationEvidence.valid, false);
  assert.equal(invalidBlocker.serializedOptionValidationEvidence.rawValuesIncluded, false);
  assert.equal(
    invalidBlocker.serializedOptionValidationEvidence.reasonCode,
    'SERIALIZED_OPTION_STRING_LENGTH_MISMATCH',
  );
  assert.match(invalidBlocker.reason, /Serialized option validator refused/);
  assert.ok(invalidApplyError instanceof PushPlanError);
  assert.equal(invalidApplyError.code, 'PLAN_NOT_READY');
  assert.equal(invalidApplyError.details.status, 'blocked');
  assert.equal(sha256Evidence(invalidRemote), invalidRemoteBeforeHash);
  assert.equal(`sha256:${resourceHash(invalidRemote, resource)}`, invalidRowBeforeHash);

  const forgedInvalidPlan = tamperReadyPlan(plan, (readyPlan) => {
    const forgedMutation = mutationFor(readyPlan, resourceKey);
    const forgedValue = deserializeMutationValue(forgedMutation);
    forgedValue.option_value = invalidForgedSerialized;
    forgedMutation.value = serializeResourceValue(forgedValue);
    forgedMutation.localHash = digest(forgedValue);
  });
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBeforeHash = sha256Evidence(forgedRemote);
  const forgedRowBeforeHash = `sha256:${resourceHash(forgedRemote, resource)}`;
  let hookCalls = 0;
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedInvalidPlan, {
    beforeMutation() {
      hookCalls += 1;
    },
  }));
  const applyValidationEvidence = forgedError.details.applyValidationEvidence;

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(hookCalls, 0);
  assert.equal(forgedError.details.resourceKey, resourceKey);
  assert.equal(forgedError.details.pluginOwner, 'forms');
  assert.equal(forgedError.details.driver, 'wp-option');
  assert.equal(applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(applyValidationEvidence.operation, 'driver-apply-validation');
  assert.equal(applyValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(applyValidationEvidence.serializedOptionValidationEvidence.valid, false);
  assert.equal(
    applyValidationEvidence.serializedOptionValidationEvidence.reasonCode,
    'SERIALIZED_OPTION_STRING_LENGTH_MISMATCH',
  );
  assert.equal(applyValidationEvidence.serializedOptionValidationEvidence.rawValuesIncluded, false);
  assert.equal(sha256Evidence(forgedRemote), forgedRemoteBeforeHash);
  assert.equal(`sha256:${resourceHash(forgedRemote, resource)}`, forgedRowBeforeHash);
  assert.equal(
    forgedRemote.db.wp_options['option_name:forms_serialized_settings'].option_value,
    validBaseSerialized,
  );

  const evidence = {
    rpp: 'RPP-0468',
    evidenceSource: 'local-focused-plugin-driver-test',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    acceptedSerializedOption: {
      planHash: sha256Evidence({ status: plan.status, summary: plan.summary }),
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        pluginOwner: mutation.pluginOwnedResource.pluginOwner,
        driver: mutation.pluginOwnedResource.driver,
        auditEvidence: auditEvidence,
      }),
      auditEvidenceHash: sha256Evidence(auditEvidence),
      journalHash: sha256Evidence(applied.journal),
    },
    invalidPlannerRefusal: {
      code: invalidApplyError.code,
      blockerHash: sha256Evidence(invalidBlocker),
      validatorEvidenceHash: sha256Evidence(invalidBlocker.serializedOptionValidationEvidence),
      detailsHash: sha256Evidence(invalidApplyError.details),
      rowHashBefore: invalidRowBeforeHash,
      rowHashAfter: `sha256:${resourceHash(invalidRemote, resource)}`,
      remoteHashBefore: invalidRemoteBeforeHash,
      remoteHashAfter: sha256Evidence(invalidRemote),
    },
    invalidApplyRefusal: {
      code: forgedError.code,
      detailsHash: sha256Evidence(forgedError.details),
      applyValidationEvidenceHash: sha256Evidence(applyValidationEvidence),
      serializedOptionValidationHash: sha256Evidence(applyValidationEvidence.serializedOptionValidationEvidence),
      rowHashBefore: forgedRowBeforeHash,
      rowHashAfter: `sha256:${resourceHash(forgedRemote, resource)}`,
      remoteHashBefore: forgedRemoteBeforeHash,
      remoteHashAfter: sha256Evidence(forgedRemote),
    },
  };
  evidence.proofHash = sha256Evidence({
    acceptedSerializedOption: evidence.acceptedSerializedOption,
    invalidPlannerRefusal: evidence.invalidPlannerRefusal,
    invalidApplyRefusal: evidence.invalidApplyRefusal,
  });

  for (const value of [
    evidence.acceptedSerializedOption.planHash,
    evidence.acceptedSerializedOption.mutationHash,
    evidence.acceptedSerializedOption.auditEvidenceHash,
    evidence.acceptedSerializedOption.journalHash,
    evidence.invalidPlannerRefusal.blockerHash,
    evidence.invalidPlannerRefusal.validatorEvidenceHash,
    evidence.invalidPlannerRefusal.detailsHash,
    evidence.invalidPlannerRefusal.rowHashBefore,
    evidence.invalidPlannerRefusal.rowHashAfter,
    evidence.invalidPlannerRefusal.remoteHashBefore,
    evidence.invalidPlannerRefusal.remoteHashAfter,
    evidence.invalidApplyRefusal.detailsHash,
    evidence.invalidApplyRefusal.applyValidationEvidenceHash,
    evidence.invalidApplyRefusal.serializedOptionValidationHash,
    evidence.invalidApplyRefusal.rowHashBefore,
    evidence.invalidApplyRefusal.rowHashAfter,
    evidence.invalidApplyRefusal.remoteHashBefore,
    evidence.invalidApplyRefusal.remoteHashAfter,
    evidence.proofHash,
  ]) {
    assert.match(value, /^sha256:[a-f0-9]{64}$/);
  }
  assert.equal(evidence.invalidPlannerRefusal.remoteHashAfter, evidence.invalidPlannerRefusal.remoteHashBefore);
  assert.equal(evidence.invalidApplyRefusal.remoteHashAfter, evidence.invalidApplyRefusal.remoteHashBefore);

  const serializedEvidence = JSON.stringify(evidence);
  const serializedAudit = JSON.stringify(auditEvidence);
  const serializedJournal = JSON.stringify(applied.journal);
  const serializedRefusals = JSON.stringify({
    invalidBlocker,
    forgedErrorDetails: forgedError.details,
  });
  for (const rawValue of privateValues) {
    assert.equal(serializedEvidence.includes(rawValue), false, `RPP-0468 evidence leaked ${rawValue}`);
    assert.equal(serializedAudit.includes(rawValue), false, `RPP-0468 audit leaked ${rawValue}`);
    assert.equal(serializedJournal.includes(rawValue), false, `RPP-0468 journal leaked ${rawValue}`);
    assert.equal(serializedRefusals.includes(rawValue), false, `RPP-0468 refusal leaked ${rawValue}`);
  }
});

test('blocks plugin-owned resources when the declared driver does not match the table', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:7"]';
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: 'base-private-meta',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_postmeta['meta_id:7'].meta_value = 'local-private-meta';
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
      ),
    },
  ];
  const remote = JSON.parse(JSON.stringify(base));

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.match(blocker.reason, /driver does not match/);
  assert.equal(blockerJson.includes('base-private-meta'), false);
  assert.equal(blockerJson.includes('local-private-meta'), false);
});

test('allows plugin-owned postmeta-like rows with explicit push intent policy', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:7"]';
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'base' },
      __pluginOwner: 'forms',
    },
  };
  const local = baseSite();
  local.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'local' },
      __pluginOwner: 'forms',
    },
  };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, 'forms', 'wp-postmeta'),
      ),
    },
  ];
  const remote = baseSite();
  remote.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'base' },
      __pluginOwner: 'forms',
    },
  };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, resourceKey).atomicGroupId, 'update-forms-postmeta');
  assert.equal(plan.atomicGroups[0].status, 'ready');
});

test('blocks unknown plugin-owned custom table rows without leaking values', () => {
  const resourceKey = 'row:["wp_forms_entries","entry_id:9"]';
  const base = baseSite();
  base.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = baseSite();
  local.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'local-private-entry', __pluginOwner: 'forms' },
  };
  const remote = baseSite();
  remote.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blockerJson.includes('base-private-entry'), false);
  assert.equal(blockerJson.includes('local-private-entry'), false);
});

test('RPP-0228 refuses unknown plugin-owned resources before mutation with redacted evidence', () => {
  const resource = {
    type: 'row',
    table: 'wp_forms_entries',
    id: 'entry_id:29',
    key: 'row:["wp_forms_entries","entry_id:29"]',
  };
  const resourceKey = resource.key;
  const privateValues = [
    'rpp0228-base-confidential-entry',
    'rpp0228-local-confidential-entry',
  ];
  const base = baseSite();
  base.db.wp_forms_entries = {
    'entry_id:29': {
      entry_id: 29,
      payload: privateValues[0],
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_entries['entry_id:29'].payload = privateValues[1];
  const remote = cloneJson(base);

  const blockedPlan = planFor(base, local, remote);
  const replayBlockedPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const blocker = blockedPlan.blockers[0];

  assert.equal(blockedPlan.status, 'blocked');
  assertPlannerSummaryMatchesEvidence(blockedPlan, 'RPP-0228 unknown plugin-owned planner refusal');
  assert.deepEqual(blockedPlan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(
    plannerSummaryEvidenceEnvelope(blockedPlan),
    plannerSummaryEvidenceEnvelope(replayBlockedPlan),
    'unknown plugin-owned resource refusal evidence should be deterministic',
  );
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.match(blocker.baseHash, /^[a-f0-9]{64}$/);
  assert.match(blocker.localHash, /^[a-f0-9]{64}$/);
  assert.match(blocker.remoteHash, /^[a-f0-9]{64}$/);

  const blockedRemote = cloneJson(remote);
  const blockedBefore = JSON.stringify(blockedRemote);
  const blockedError = captureError(() => applyPlan(blockedRemote, blockedPlan));

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.deepEqual(blockedError.details, { status: 'blocked' });
  assert.equal(JSON.stringify(blockedRemote), blockedBefore);
  assert.deepEqual(blockedRemote.db.wp_forms_entries['entry_id:29'], remote.db.wp_forms_entries['entry_id:29']);

  const forgedMutationId = 'mutation-rpp-0228-forged-unknown-plugin-owned-resource';
  const forgedReadyPlan = tamperReadyPlan(blockedPlan, (plan) => {
    const baseHash = resourceHash(base, resource);
    const localHash = resourceHash(local, resource);
    const remoteHash = resourceHash(remote, resource);
    plan.mutations = [
      {
        id: forgedMutationId,
        resource,
        resourceKey,
        action: 'put',
        value: serializeResourceValue(local.db.wp_forms_entries['entry_id:29']),
        remoteBeforeHash: remoteHash,
        baseHash,
        localHash,
        changeKind: 'update',
        change: {
          localChange: 'update',
          remoteChange: 'unchanged',
        },
        atomicGroupId: null,
        pluginOwnedResource: {
          pluginOwner: 'forms',
          driver: null,
          policySource: null,
          supportsDelete: false,
        },
      },
    ];
    plan.preconditions = [
      {
        mutationId: forgedMutationId,
        resource,
        resourceKey,
        expectedHash: remoteHash,
        checkedAgainst: 'live-remote',
      },
    ];
    plan.summary.mutations = 1;
    plan.summary.decisions = 0;
  });
  const forgedRemote = cloneJson(remote);
  const forgedBefore = JSON.stringify(forgedRemote);
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedReadyPlan));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(forgedError.details.mutationId, forgedMutationId);
  assert.equal(forgedError.details.resourceKey, resourceKey);
  assert.equal(forgedError.details.pluginOwner, 'forms');
  assert.equal(forgedError.details.driver, null);
  assert.equal(forgedError.details.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(forgedError.details.applyValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(forgedError.details.applyValidationEvidence.driverEvidence.state, 'absent');
  assert.match(forgedError.details.applyValidationEvidence.planned.hash, /^[a-f0-9]{64}$/);
  assert.match(forgedError.details.applyValidationEvidence.remote.hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(forgedRemote), forgedBefore);
  assert.deepEqual(forgedRemote.db.wp_forms_entries['entry_id:29'], remote.db.wp_forms_entries['entry_id:29']);

  const serializedEvidence = JSON.stringify({
    planner: {
      status: blockedPlan.status,
      summary: blockedPlan.summary,
      envelope: plannerSummaryEvidenceEnvelope(blockedPlan),
      blocker: {
        class: blocker.class,
        resourceKey: blocker.resourceKey,
        pluginOwner: blocker.pluginOwner,
        baseHash: blocker.baseHash,
        localHash: blocker.localHash,
        remoteHash: blocker.remoteHash,
        blockerHash: sha256Evidence(blocker),
      },
    },
    applyRefusals: [
      {
        code: blockedError.code,
        details: blockedError.details,
      },
      {
        code: forgedError.code,
        details: forgedError.details,
        detailsHash: sha256Evidence(forgedError.details),
      },
    ],
  });
  assert.match(JSON.parse(serializedEvidence).planner.blocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(JSON.parse(serializedEvidence).applyRefusals[1].detailsHash, /^sha256:[a-f0-9]{64}$/);
  for (const privateValue of privateValues) {
    assert.equal(serializedEvidence.includes(privateValue), false, `RPP-0228 evidence leaked ${privateValue}`);
  }
});

test('allows plugin-owned custom table rows with explicit driver table policy', () => {
  const resourceKey = 'row:["wp_reprint_push_driver_fixture","entry_id:1"]';
  const base = baseSite();
  base.db.wp_reprint_push_driver_fixture = {
    'entry_id:1': {
      entry_id: 1,
      payload: { owner: 'driver-fixture', mode: 'base', version: 1 },
      updated_marker: 'base',
      __pluginOwner: 'driver-fixture',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].payload.mode = 'local-update';
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].payload.version = 2;
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].updated_marker = 'local-update';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'driver-fixture', 'fixture-arbitrary-plugin-table', {
        table: 'wp_reprint_push_driver_fixture',
        supportsDelete: false,
      }),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  const mutation = mutationFor(plan, resourceKey);
  assert.equal(mutation.pluginOwnedResource.driver, 'fixture-arbitrary-plugin-table');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
});

test('fixture forms lab table requires exact driver and active fixture plugin evidence', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-semantic';
  const remote = JSON.parse(JSON.stringify(base));

  const withoutPolicy = planFor(base, local, remote);
  assert.equal(withoutPolicy.status, 'blocked');
  assert.equal(withoutPolicy.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(withoutPolicy.blockers[0].resourceKey, resourceKey);

  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const ready = planFor(base, local, remote);
  assert.equal(ready.status, 'ready');
  const mutation = mutationFor(ready, resourceKey);
  assert.equal(mutation.pluginOwnedResource.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.source, 'live-remote');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.resourceKey, 'plugin:reprint-push-forms-fixture');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.baseHash, mutation.pluginOwnedResource.driverEvidence.remoteHash);

  const inactiveRemote = JSON.parse(JSON.stringify(remote));
  inactiveRemote.plugins['reprint-push-forms-fixture'].active = false;
  const inactivePlan = planFor(base, local, inactiveRemote);
  assert.equal(inactivePlan.status, 'blocked');
  assert.equal(inactivePlan.blockers[0].class, 'unsupported-plugin-owned-resource');

  const changedPluginRemote = JSON.parse(JSON.stringify(remote));
  changedPluginRemote.plugins['reprint-push-forms-fixture'].version = '1.0.1';
  const changedPluginPlan = planFor(base, local, changedPluginRemote);
  assert.equal(changedPluginPlan.status, 'blocked');
  assert.equal(changedPluginPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
});

test('RPP-0438 driver apply validation hook carries one valid fixture mutation through apply', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.db.wp_reprint_push_forms_lab['id:1'].updated_marker = 'local-secret-marker';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));
  const ready = planFor(base, local, remote);
  const validationEvidence = [];

  const result = applyPlan(remote, ready, {
    beforeMutation({ mutation, mutationIndex, driverApplyValidation }) {
      assert.equal(mutationIndex, 1);
      assert.equal(mutation.resourceKey, resourceKey);
      validationEvidence.push(driverApplyValidation);
    },
  });
  const evidence = validationEvidence[0];
  const evidenceJson = JSON.stringify(evidence);
  const journalJson = JSON.stringify(result.journal);

  assert.equal(ready.status, 'ready');
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_reprint_push_forms_lab['id:1'].payload.mode, 'local-secret');
  assert.equal(validationEvidence.length, 1);
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(evidence.operation, 'driver-apply-validation');
  assert.equal(evidence.outcome, 'accepted');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'fixture-forms-lab-table');
  assert.equal(evidence.resource.table, 'wp_reprint_push_forms_lab');
  assert.equal(evidence.planned.state, 'present');
  assert.match(evidence.planned.hash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.remote.state, 'present');
  assert.match(evidence.remote.hash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.driverEvidence.source, 'live-remote');
  assert.equal(evidence.driverEvidence.resourceKey, 'plugin:reprint-push-forms-fixture');
  assert.match(evidence.driverEvidence.baseHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.driverEvidence.baseHash, evidence.driverEvidence.remoteHash);
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].beforeValue.redacted, true);
  assert.equal(result.journal.entries[0].afterValue.redacted, true);
  assert.equal(evidenceJson.includes('local-secret'), false);
  assert.equal(evidenceJson.includes('base-secret'), false);
  assert.equal(journalJson.includes('local-secret'), false);
  assert.equal(journalJson.includes('base-secret'), false);
});

test('fixture forms lab table delete remains blocked without driver delete opt-in', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  delete local.db.wp_reprint_push_forms_lab['id:1'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const plan = planFor(base, local, JSON.parse(JSON.stringify(base)));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'unsupported-plugin-owned-resource');
});

test('executor rejects forged ready custom table plans without valid fixture driver evidence', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const ready = planFor(base, local, JSON.parse(JSON.stringify(base)));
  const forged = tamperReadyPlan(ready, (plan) => {
    delete mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;
  });
  const remote = JSON.parse(JSON.stringify(base));
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(JSON.stringify(error.details).includes('local-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('base-secret'), false);

  const forgedHash = tamperReadyPlan(ready, (plan) => {
    const mutation = mutationFor(plan, resourceKey);
    mutation.pluginOwnedResource.driverEvidence.baseHash = 'x'.repeat(64);
    mutation.pluginOwnedResource.driverEvidence.remoteHash = 'x'.repeat(64);
  });
  const forgedHashRemote = JSON.parse(JSON.stringify(base));
  const forgedHashBefore = JSON.stringify(forgedHashRemote);
  const forgedHashError = captureError(() => applyPlan(forgedHashRemote, forgedHash));
  assert.ok(forgedHashError instanceof PushPlanError);
  assert.equal(forgedHashError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(forgedHashRemote), forgedHashBefore);

  const stalePluginRemote = JSON.parse(JSON.stringify(base));
  stalePluginRemote.plugins['reprint-push-forms-fixture'].version = '1.0.1';
  const stalePluginBefore = JSON.stringify(stalePluginRemote);
  const stalePluginError = captureError(() => applyPlan(stalePluginRemote, ready));
  assert.ok(stalePluginError instanceof PushPlanError);
  assert.equal(stalePluginError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(stalePluginRemote), stalePluginBefore);
});

test('RPP-0438 driver apply validation fails closed before mutation with redacted evidence', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const ready = planFor(base, local, JSON.parse(JSON.stringify(base)));
  const forged = tamperReadyPlan(ready, (plan) => {
    const mutation = mutationFor(plan, resourceKey);
    mutation.pluginOwnedResource.driverEvidence.remoteHash = '0'.repeat(64);
  });
  const remote = JSON.parse(JSON.stringify(base));
  const before = JSON.stringify(remote);
  let hookCalls = 0;

  const error = captureError(() => applyPlan(remote, forged, {
    beforeMutation() {
      hookCalls++;
    },
  }));
  const evidence = error.details.applyValidationEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(hookCalls, 0);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(evidence.operation, 'driver-apply-validation');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'fixture-forms-lab-table');
  assert.equal(evidence.planned.state, 'present');
  assert.match(evidence.planned.hash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.remote.state, 'present');
  assert.match(evidence.remote.hash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.driverEvidence.state, 'present');
  assert.equal(evidence.driverEvidence.remoteHash, '0'.repeat(64));
  assert.equal(evidenceJson.includes('local-secret'), false);
  assert.equal(evidenceJson.includes('base-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('base-secret'), false);
});

test('fixture forms lab table journal redacts raw payload values', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };

  const result = applyPlan(JSON.parse(JSON.stringify(base)), planFor(base, local, JSON.parse(JSON.stringify(base))));
  const journalJson = JSON.stringify(result.journal);

  assert.equal(journalJson.includes('local-secret'), false);
  assert.equal(journalJson.includes('base-secret'), false);
  assert.equal(result.journal.entries[0].beforeHash.length, 64);
  assert.equal(result.journal.entries[0].afterHash.length, 64);
});

test('RPP-0219 redacts raw plan refusal and journal evidence while preserving hashes', () => {
  const base = baseSite();
  const conflictLocal = cloneJson(base);
  const conflictRemote = cloneJson(base);
  const privateValues = [
    'local-private-rpp0219-plan-title',
    'remote-private-rpp0219-plan-title',
    '<?php echo "local-private-rpp0219-journal-file";',
    'Local private RPP-0219 journal title',
  ];
  const rawValues = [
    ...privateValues,
    base.files['index.php'],
    base.db.wp_posts['ID:1'].post_title,
  ];
  conflictLocal.db.wp_posts['ID:1'].post_title = privateValues[0];
  conflictRemote.db.wp_posts['ID:1'].post_title = privateValues[1];

  const conflictPlan = planFor(base, conflictLocal, conflictRemote);
  const conflictEvidence = {
    summary: conflictPlan.summary,
    conflicts: conflictPlan.conflicts,
    decisions: conflictPlan.decisions,
    blockers: conflictPlan.blockers,
    envelope: plannerSummaryEvidenceEnvelope(conflictPlan),
  };

  assert.equal(conflictPlan.status, 'conflict');
  assert.equal(conflictPlan.conflicts[0].class, 'row-conflict');
  assert.equal(conflictPlan.conflicts[0].reason, 'Local and remote both changed this resource after the pull base.');
  assert.match(conflictPlan.conflicts[0].localHash, /^[a-f0-9]{64}$/);
  assert.match(conflictPlan.conflicts[0].remoteHash, /^[a-f0-9]{64}$/);

  const refusalError = captureError(() => applyPlan(conflictRemote, conflictPlan));
  assert.ok(refusalError instanceof PushPlanError);
  assert.equal(refusalError.code, 'PLAN_NOT_READY');
  assert.deepEqual(refusalError.details, { status: 'conflict' });

  const readyLocal = cloneJson(base);
  const readyRemote = cloneJson(base);
  readyLocal.files['index.php'] = privateValues[2];
  readyLocal.db.wp_posts['ID:1'].post_title = privateValues[3];
  const readyPlan = planFor(base, readyLocal, readyRemote);
  const beforeReadyRemote = JSON.stringify(readyRemote);
  const journalError = captureError(() => applyPlan(readyRemote, readyPlan, { failAfterStaging: true }));
  const journal = journalError.details.recovery.artifacts.journal;

  assert.ok(journalError instanceof PushPlanError);
  assert.equal(journalError.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assert.equal(JSON.stringify(readyRemote), beforeReadyRemote);
  assert.equal(journal.status, 'staged');
  assert.equal(journal.entries.length, 2);
  for (const entry of journal.entries) {
    assert.match(entry.beforeHash, /^[a-f0-9]{64}$/);
    assert.match(entry.afterHash, /^[a-f0-9]{64}$/);
    assert.equal(entry.beforeValue.redacted, true);
    assert.equal(entry.beforeValue.reason, 'raw-site-value-field');
    assert.match(entry.beforeValue.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.afterValue.redacted, true);
    assert.equal(entry.afterValue.reason, 'raw-site-value-field');
    assert.match(entry.afterValue.sha256, /^[a-f0-9]{64}$/);
  }

  const serializedEvidence = JSON.stringify({
    conflictEvidence,
    refusal: {
      code: refusalError.code,
      message: refusalError.message,
      details: refusalError.details,
    },
    journal,
  });
  for (const rawValue of rawValues) {
    assert.equal(serializedEvidence.includes(rawValue), false, `evidence leaked ${rawValue}`);
  }
});

test('fixture forms lab table blocked recovery redacts raw remote payload values', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));
  const plan = planFor(base, local, remote);
  const error = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
    failDuringCommitAtMutation: 1,
  }));
  const detailsJson = JSON.stringify(error.details);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(detailsJson.includes('base-secret'), false);
  assert.equal(detailsJson.includes('local-secret'), false);
  assert.equal(detailsJson.includes('forms'), true);
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_reprint_push_forms_lab['id:1'].__redacted,
    true,
  );
});

test('fixture forms lab table conflicts and stale preconditions preserve remote', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));
  remote.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'remote';

  const conflictPlan = planFor(base, local, remote);
  assert.equal(conflictPlan.status, 'conflict');
  assert.equal(conflictPlan.conflicts[0].class, 'plugin-data-conflict');
  assert.equal(conflictPlan.conflicts[0].resourceKey, resourceKey);

  const ready = planFor(base, local, JSON.parse(JSON.stringify(base)));
  const staleRemote = JSON.parse(JSON.stringify(base));
  staleRemote.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'stale-remote';
  const before = JSON.stringify(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, ready));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(staleRemote), before);
});

test('classifies divergent plugin-owned data rows as redacted plugin data conflicts', () => {
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: 'base-private-meta',
      __pluginOwner: 'forms',
    },
  };
  base.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  remote.db.wp_options['option_name:forms_settings'].option_value.mode = 'remote-private-option';
  local.db.wp_postmeta['meta_id:7'].meta_value = 'local-private-meta';
  remote.db.wp_postmeta['meta_id:7'].meta_value = 'remote-private-meta';
  local.db.wp_forms_entries['entry_id:9'].payload = 'local-private-entry';
  remote.db.wp_forms_entries['entry_id:9'].payload = 'remote-private-entry';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 3);
  assert.deepEqual(
    plan.conflicts.map((conflict) => [conflict.resourceKey, conflict.class, conflict.pluginOwner]),
    [
      ['row:["wp_forms_entries","entry_id:9"]', 'plugin-data-conflict', 'forms'],
      ['row:["wp_options","option_name:forms_settings"]', 'plugin-data-conflict', 'forms'],
      ['row:["wp_postmeta","meta_id:7"]', 'plugin-data-conflict', 'forms'],
    ],
  );
  const conflictsJson = JSON.stringify(plan.conflicts);
  assert.equal(conflictsJson.includes('local-private-option'), false);
  assert.equal(conflictsJson.includes('remote-private-meta'), false);
  assert.equal(conflictsJson.includes('local-private-entry'), false);
});

test('blocks local postmeta references to stale remote-created post identity', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_local_graph_note',
      meta_value: 'local-private-meta-payload',
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'remote-private-post-title',
    post_content: 'remote-private-post-body',
    post_status: 'publish',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const reference = blocker.references[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, targetResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(reference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(reference.relationshipType, 'postmeta-post');
  assert.equal(reference.sourceResourceKey, resourceKey);
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'create');
  assert.equal(reference.targetRemoteHash.length, 64);
  assert.equal(planJson.includes('local-private-meta-payload'), false);
  assert.equal(planJson.includes('remote-private-post-title'), false);
  assert.equal(planJson.includes('remote-private-post-body'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'remote-private-post-title');
});

test('allows same-plan post and attachment graph closure when remote still matches base', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_status: 'draft',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment asset',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: '3',
    },
  };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(mutationFor(plan, 'row:["wp_posts","ID:2"]').action, 'put');
  assert.equal(mutationFor(plan, 'row:["wp_posts","ID:3"]').action, 'put');
  assert.equal(mutationFor(plan, 'row:["wp_postmeta","meta_id:45"]').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].post_id, 2);
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].meta_value, '3');
});

test('maps real Playground postmeta when its WordPress post identity is created in the same plan', () => {
  const local = playgroundLocalEditedSnapshot();
  const base = playgroundBaseWithoutLocalOnlyGraphRows(local);
  const remote = cloneJson(base);
  const postResourceKey = 'row:["wp_posts","ID:2001"]';
  const postmetaResourceKey = 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.deepEqual(result.site.db.wp_posts['ID:2001'], local.db.wp_posts['ID:2001']);
  assert.deepEqual(
    result.site.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'],
    local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'],
  );
});

test('rewrites explicit WordPress graph identity map references to proven remote rows', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const childPostResourceKey = 'row:["wp_posts","ID:2002"]';
  const rewrittenPostmetaResourceKey = 'row:["wp_postmeta","post_id:3001:meta_key:_reprint_push_forms_schema"]';
  const commentResourceKey = 'row:["wp_comments","comment_ID:51"]';
  const sourceTermResourceKey = 'row:["wp_terms","term_id:2101"]';
  const sourceTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:2201"]';
  const rewrittenRelationshipResourceKey = 'row:["wp_term_relationships","object_id:3001|term_taxonomy_id:3201"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:4101"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  base.db.wp_comments = {};
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  base.db.wp_termmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:2001', remoteId: 'ID:3001' },
        { table: 'wp_terms', localId: 'term_id:2101', remoteId: 'term_id:3101' },
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:2201', remoteId: 'term_taxonomy_id:3201' },
      ],
    },
  };
  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'Mapped graph parent',
    post_name: 'mapped-graph-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'Mapped graph parent',
    post_name: 'mapped-graph-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_posts['ID:2002'] = {
    ID: 2002,
    post_title: 'Mapped graph child',
    post_name: 'mapped-graph-child',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 2001,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'] = {
    post_id: 2001,
    meta_key: '_reprint_push_forms_schema',
    meta_value: { source: 'local-mapped-postmeta' },
  };
  local.db.wp_comments['comment_ID:51'] = {
    comment_ID: 51,
    comment_post_ID: 2001,
    comment_parent: 0,
    comment_content: 'Mapped graph comment',
  };
  local.db.wp_terms['term_id:2101'] = {
    term_id: 2101,
    name: 'Mapped graph category',
    slug: 'mapped-graph-category',
  };
  remote.db.wp_terms['term_id:3101'] = {
    term_id: 3101,
    name: 'Mapped graph category',
    slug: 'mapped-graph-category',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:2201'] = {
    term_taxonomy_id: 2201,
    term_id: 2101,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:3201'] = {
    term_taxonomy_id: 3201,
    term_id: 3101,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:2001|term_taxonomy_id:2201'] = {
    object_id: 2001,
    term_taxonomy_id: 2201,
    term_order: 0,
  };
  local.db.wp_termmeta['meta_id:4101'] = {
    meta_id: 4101,
    term_id: 2101,
    meta_key: '_mapped_term_flag',
    meta_value: 'mapped-termmeta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const postmetaMutation = mutationFor(plan, rewrittenPostmetaResourceKey);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(decisionFor(plan, sourcePostResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(mutationFor(plan, childPostResourceKey).changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(deserializeMutationValue(mutationFor(plan, childPostResourceKey)).post_parent, 3001);
  assert.equal(deserializeMutationValue(postmetaMutation).post_id, 3001);
  assert.equal(deserializeMutationValue(mutationFor(plan, commentResourceKey)).comment_post_ID, 3001);
  assert.equal(deserializeMutationValue(relationshipMutation).object_id, 3001);
  assert.equal(deserializeMutationValue(relationshipMutation).term_taxonomy_id, 3201);
  assert.equal(deserializeMutationValue(mutationFor(plan, termmetaResourceKey)).term_id, 3101);
  assert.equal(postmetaMutation.wordpressGraphIdentity.rewrites[0].sourceTargetResourceKey, sourcePostResourceKey);
  assert.equal(postmetaMutation.wordpressGraphIdentity.rewrites[0].targetResourceKey, targetPostResourceKey);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:2001'], undefined);
  assert.equal(result.site.db.wp_posts['ID:3001'].post_title, 'Mapped graph parent');
  assert.equal(result.site.db.wp_posts['ID:2002'].post_parent, 3001);
  assert.equal(result.site.db.wp_postmeta['post_id:3001:meta_key:_reprint_push_forms_schema'].post_id, 3001);
  assert.equal(result.site.db.wp_comments['comment_ID:51'].comment_post_ID, 3001);
  assert.equal(result.site.db.wp_term_relationships['object_id:3001|term_taxonomy_id:3201'].term_taxonomy_id, 3201);
  assert.equal(result.site.db.wp_termmeta['meta_id:4101'].term_id, 3101);
});

test('blocks explicit WordPress graph identity maps when the remote target is not equivalent', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const postmetaResourceKey = 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [{ table: 'wp_posts', localId: 'ID:2001', remoteId: 'ID:3001' }],
    },
  };
  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'local-private-mapped-title',
    post_name: 'mapped-post',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'remote-private-mapped-title',
    post_name: 'mapped-post',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'] = {
    post_id: 2001,
    meta_key: '_reprint_push_forms_schema',
    meta_value: 'local-private-mapped-postmeta',
  };

  const plan = planFor(base, local, remote);
  const sourceBlocker = plan.blockers.find((blocker) => blocker.resourceKey === sourcePostResourceKey);
  const postmetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === postmetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent/);
  assert.equal(postmetaBlocker.references[0].targetSupport.supported, false);
  assert.equal(planJson.includes('local-private-mapped-title'), false);
  assert.equal(planJson.includes('remote-private-mapped-title'), false);
  assert.equal(planJson.includes('local-private-mapped-postmeta'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks post GUID and slug collisions without an explicit graph identity map', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'local-private-colliding-title',
    post_name: 'shared-collision-slug',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid: 'https://example.test/shared-collision',
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'remote-private-colliding-title',
    post_name: 'shared-collision-slug',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid: 'https://example.test/shared-collision',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === sourcePostResourceKey);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /collides with existing remote post identity/);
  assert.deepEqual(blocker.references[0].identityKinds, ['guid', 'post_type+post_name']);
  assert.equal(blockerJson.includes('local-private-colliding-title'), false);
  assert.equal(blockerJson.includes('remote-private-colliding-title'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks featured image references when the attachment target diverged on remote', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base-private-attachment-title',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: '2',
    },
  };
  const remote = JSON.parse(JSON.stringify(base));
  remote.db.wp_posts['ID:2'].post_title = 'remote-private-attachment-title';
  remote.db.wp_posts['ID:2'].post_content = 'remote-private-attachment-body';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const reference = blocker.references[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, targetResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.equal(planJson.includes('remote-private-attachment-title'), false);
  assert.equal(planJson.includes('remote-private-attachment-body'), false);
});

test('keeps WordPress menu item graph surfaces fail-closed', () => {
  const menuItemResourceKey = 'row:["wp_posts","ID:44"]';
  const menuMetaResourceKey = 'row:["wp_postmeta","meta_id:90"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:44'] = {
    ID: 44,
    post_title: 'Local private menu item',
    post_content: 'local-private-menu-item-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
  };
  local.db.wp_postmeta['meta_id:90'] = {
    meta_id: 90,
    post_id: 44,
    meta_key: '_menu_item_object_id',
    meta_value: 1,
  };

  const plan = planFor(base, local, remote);
  const menuItemBlocker = plan.blockers.find((blocker) => blocker.resourceKey === menuItemResourceKey);
  const menuMetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === menuMetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, menuItemResourceKey), undefined);
  assert.equal(mutationFor(plan, menuMetaResourceKey), undefined);
  assert.equal(menuItemBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuItemBlocker.reason, /nav_menu_item/);
  assert.equal(menuMetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuMetaBlocker.reason, /_menu_item_object_id/);
  assert.equal(planJson.includes('local-private-menu-item-body'), false);
  assert.equal(planJson.includes('Local private menu item'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('allows same-plan comment and user graph closure when author and comment targets are created locally', () => {
  const postResourceKey = 'row:["wp_posts","ID:2"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const usermetaResourceKey = 'row:["wp_usermeta","meta_id:61"]';
  const parentCommentResourceKey = 'row:["wp_comments","comment_ID:11"]';
  const childCommentResourceKey = 'row:["wp_comments","comment_ID:12"]';
  const commentmetaResourceKey = 'row:["wp_commentmeta","meta_id:51"]';
  const base = baseSite();
  base.db.wp_users = {};
  base.db.wp_usermeta = {};
  base.db.wp_comments = {};
  base.db.wp_commentmeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_users['ID:7'] = {
    ID: 7,
    user_login: 'local-author',
    user_email: 'author@example.test',
    display_name: 'Local Author',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local authored post',
    post_status: 'draft',
    post_author: 7,
  };
  local.db.wp_usermeta['meta_id:61'] = {
    meta_id: 61,
    user_id: 7,
    meta_key: 'nickname',
    meta_value: 'local-author-nickname',
  };
  local.db.wp_comments['comment_ID:11'] = {
    comment_ID: 11,
    comment_post_ID: 2,
    comment_parent: 0,
    comment_content: 'Local parent comment',
  };
  local.db.wp_comments['comment_ID:12'] = {
    comment_ID: 12,
    comment_post_ID: 2,
    comment_parent: 11,
    comment_content: 'Local child comment',
  };
  local.db.wp_commentmeta['meta_id:51'] = {
    meta_id: 51,
    comment_id: 12,
    meta_key: '_local_comment_flag',
    meta_value: 'comment-private-meta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, userResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, usermetaResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, parentCommentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, childCommentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, commentmetaResourceKey).changeKind, 'create');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_author, 7);
  assert.equal(result.site.db.wp_usermeta['meta_id:61'].user_id, 7);
  assert.equal(result.site.db.wp_comments['comment_ID:11'].comment_post_ID, 2);
  assert.equal(result.site.db.wp_comments['comment_ID:12'].comment_parent, 11);
  assert.equal(result.site.db.wp_commentmeta['meta_id:51'].comment_id, 12);
});

test('blocks post author and usermeta references when the remote user target diverged', () => {
  const postResourceKey = 'row:["wp_posts","ID:2"]';
  const usermetaResourceKey = 'row:["wp_usermeta","meta_id:61"]';
  const targetUserResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user-login',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_usermeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local user-authored post',
    post_status: 'draft',
    post_author: 7,
  };
  local.db.wp_usermeta['meta_id:61'] = {
    meta_id: 61,
    user_id: 7,
    meta_key: 'nickname',
    meta_value: 'local-private-usermeta',
  };
  remote.db.wp_users['ID:7'] = {
    ...remote.db.wp_users['ID:7'],
    user_email: 'remote-private-user@example.test',
    display_name: 'Remote Private User',
  };

  const plan = planFor(base, local, remote);
  const postBlocker = plan.blockers.find((blocker) => blocker.resourceKey === postResourceKey);
  const usermetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === usermetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, postResourceKey), undefined);
  assert.equal(mutationFor(plan, usermetaResourceKey), undefined);
  assert.equal(decisionFor(plan, targetUserResourceKey).decision, 'keep-remote');
  assert.equal(postBlocker.references[0].relationshipType, 'post-author');
  assert.equal(postBlocker.references[0].targetResourceKey, targetUserResourceKey);
  assert.equal(postBlocker.references[0].targetChange.remoteChange, 'update');
  assert.equal(usermetaBlocker.references[0].relationshipType, 'usermeta-user');
  assert.equal(usermetaBlocker.references[0].targetResourceKey, targetUserResourceKey);
  assert.equal(planJson.includes('local-private-usermeta'), false);
  assert.equal(planJson.includes('remote-private-user@example.test'), false);
  assert.equal(planJson.includes('Remote Private User'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks comment graph references when the remote post target is missing', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:11"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base-private-comment-post',
    post_status: 'publish',
  };
  base.db.wp_comments = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_comments['comment_ID:11'] = {
    comment_ID: 11,
    comment_post_ID: 2,
    comment_parent: 0,
    comment_content: 'local-private-comment-body',
  };
  delete remote.db.wp_posts['ID:2'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(blocker.references[0].relationshipKey, 'wp_comments.comment_post_ID');
  assert.equal(blocker.references[0].relationshipType, 'comment-post');
  assert.equal(blocker.references[0].targetResourceKey, targetPostResourceKey);
  assert.equal(blocker.references[0].targetChange.remoteChange, 'delete');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('base-private-comment-post'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks core user, link, and multisite graph references when targets diverged remotely', () => {
  const sourceResourceKeys = [
    'row:["wp_comments","comment_ID:20"]',
    'row:["wp_links","link_id:8"]',
    'row:["wp_blogs","blog_id:9"]',
    'row:["wp_sitemeta","meta_id:91"]',
    'row:["wp_blogmeta","meta_id:92"]',
    'row:["wp_blog_versions","blog_id:10"]',
    'row:["wp_registration_log","ID:93"]',
  ];
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_comments = {};
  base.db.wp_links = {};
  base.db.wp_site = {
    'id:1': {
      id: 1,
      domain: 'base-private-network.test',
      path: '/',
    },
  };
  base.db.wp_blogs = {
    'blog_id:9': {
      blog_id: 9,
      site_id: 1,
      domain: 'source-blog.example.test',
      path: '/',
    },
    'blog_id:10': {
      blog_id: 10,
      site_id: 1,
      domain: 'base-private-target-blog.test',
      path: '/',
    },
  };
  base.db.wp_sitemeta = {};
  base.db.wp_blogmeta = {};
  base.db.wp_blog_versions = {};
  base.db.wp_registration_log = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'local-private-comment-body',
  };
  local.db.wp_links['link_id:8'] = {
    link_id: 8,
    link_url: 'https://example.test/local-private-link',
    link_name: 'Local private link',
    link_owner: 7,
  };
  local.db.wp_blogs['blog_id:9'].path = '/local-private-source-blog/';
  local.db.wp_sitemeta['meta_id:91'] = {
    meta_id: 91,
    site_id: 1,
    meta_key: 'local_private_site_flag',
    meta_value: 'local-private-sitemeta',
  };
  local.db.wp_blogmeta['meta_id:92'] = {
    meta_id: 92,
    blog_id: 10,
    meta_key: 'local_private_blog_flag',
    meta_value: 'local-private-blogmeta',
  };
  local.db.wp_blog_versions['blog_id:10'] = {
    blog_id: 10,
    db_version: 60000,
    last_updated: '2026-05-24 00:00:00',
  };
  local.db.wp_registration_log['ID:93'] = {
    ID: 93,
    email: 'local-private-registration@example.test',
    IP: '127.0.0.1',
    blog_id: 10,
    date_registered: '2026-05-24 00:00:00',
  };
  remote.db.wp_users['ID:7'].display_name = 'Remote Private User';
  remote.db.wp_site['id:1'].domain = 'remote-private-network.test';
  remote.db.wp_blogs['blog_id:10'].domain = 'remote-private-target-blog.test';

  const plan = planFor(base, local, remote);
  const relationshipTypes = plan.blockers
    .flatMap((blocker) => blocker.references.map((reference) => reference.relationshipType))
    .sort();
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(relationshipTypes, [
    'blog-site',
    'blog-version-blog',
    'blogmeta-blog',
    'comment-user',
    'link-owner',
    'registration-log-blog',
    'sitemeta-site',
  ]);
  for (const resourceKey of sourceResourceKeys) {
    assert.equal(mutationFor(plan, resourceKey), undefined);
  }
  assert.equal(decisionFor(plan, 'row:["wp_users","ID:7"]').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'row:["wp_site","id:1"]').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'row:["wp_blogs","blog_id:10"]').decision, 'keep-remote');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('local-private-registration@example.test'), false);
  assert.equal(planJson.includes('remote-private-network.test'), false);
  assert.equal(planJson.includes('Remote Private User'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('allows same-plan core user, link, and multisite graph closure when remote still matches base', () => {
  const base = baseSite();
  base.db.wp_users = {};
  base.db.wp_comments = {};
  base.db.wp_links = {};
  base.db.wp_site = {};
  base.db.wp_blogs = {};
  base.db.wp_sitemeta = {};
  base.db.wp_blogmeta = {};
  base.db.wp_blog_versions = {};
  base.db.wp_registration_log = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_users['ID:7'] = {
    ID: 7,
    user_login: 'local-network-owner',
    user_email: 'network-owner@example.test',
    display_name: 'Local Network Owner',
  };
  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'Local user-owned comment',
  };
  local.db.wp_links['link_id:8'] = {
    link_id: 8,
    link_url: 'https://example.test/local-link',
    link_name: 'Local link',
    link_owner: 7,
  };
  local.db.wp_site['id:1'] = {
    id: 1,
    domain: 'network.example.test',
    path: '/',
  };
  local.db.wp_blogs['blog_id:9'] = {
    blog_id: 9,
    site_id: 1,
    domain: 'site.example.test',
    path: '/',
  };
  local.db.wp_sitemeta['meta_id:91'] = {
    meta_id: 91,
    site_id: 1,
    meta_key: 'site_flag',
    meta_value: 'local-site-flag',
  };
  local.db.wp_blogmeta['meta_id:92'] = {
    meta_id: 92,
    blog_id: 9,
    meta_key: 'blog_flag',
    meta_value: 'local-blog-flag',
  };
  local.db.wp_blog_versions['blog_id:9'] = {
    blog_id: 9,
    db_version: 60000,
    last_updated: '2026-05-24 00:00:00',
  };
  local.db.wp_registration_log['ID:93'] = {
    ID: 93,
    email: 'site-owner@example.test',
    IP: '127.0.0.1',
    blog_id: 9,
    date_registered: '2026-05-24 00:00:00',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 9);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_comments['comment_ID:20'].user_id, 7);
  assert.equal(result.site.db.wp_links['link_id:8'].link_owner, 7);
  assert.equal(result.site.db.wp_blogs['blog_id:9'].site_id, 1);
  assert.equal(result.site.db.wp_sitemeta['meta_id:91'].site_id, 1);
  assert.equal(result.site.db.wp_blogmeta['meta_id:92'].blog_id, 9);
  assert.equal(result.site.db.wp_blog_versions['blog_id:9'].blog_id, 9);
  assert.equal(result.site.db.wp_registration_log['ID:93'].blog_id, 9);
});

test('blocks a graph row that still references a target deleted in the same local plan', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:20"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_comments = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  delete local.db.wp_users['ID:7'];
  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'local-private-comment-body',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, userResourceKey).action, 'delete');
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(blocker.references[0].relationshipType, 'comment-user');
  assert.equal(blocker.references[0].targetResourceKey, userResourceKey);
  assert.equal(blocker.references[0].targetChange.localChange, 'delete');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('base-private-user@example.test'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('plans a safe same-plan taxonomy closure for a category term, relationship, and termmeta', () => {
  const termResourceKey = 'row:["wp_terms","term_id:21"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:31"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:31"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:41"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  base.db.wp_termmeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:21'] = {
    term_id: 21,
    name: 'local-private-category-name',
    slug: 'local-private-category',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:31'] = {
    term_taxonomy_id: 31,
    term_id: 21,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'] = {
    object_id: 1,
    term_taxonomy_id: 31,
    term_order: 0,
  };
  local.db.wp_termmeta['meta_id:41'] = {
    meta_id: 41,
    term_id: 21,
    meta_key: '_local_term_private_flag',
    meta_value: 'local-private-termmeta-payload',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, termResourceKey).action, 'put');
  assert.equal(mutationFor(plan, termResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, taxonomyResourceKey).action, 'put');
  assert.equal(mutationFor(plan, taxonomyResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, relationshipResourceKey).action, 'put');
  assert.equal(mutationFor(plan, relationshipResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, termmetaResourceKey).action, 'put');
  assert.equal(mutationFor(plan, termmetaResourceKey).changeKind, 'create');
  assert.equal(result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'].term_taxonomy_id, 31);
  assert.equal(result.site.db.wp_termmeta['meta_id:41'].term_id, 21);
});

test('plans a safe same-plan post_tag taxonomy closure for a tag term and relationship', () => {
  const termResourceKey = 'row:["wp_terms","term_id:25"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:35"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:35"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:25'] = {
    term_id: 25,
    name: 'local-private-post-tag-name',
    slug: 'local-private-post-tag',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:35'] = {
    term_taxonomy_id: 35,
    term_id: 25,
    taxonomy: 'post_tag',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:35'] = {
    object_id: 1,
    term_taxonomy_id: 35,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, termResourceKey).action, 'put');
  assert.equal(mutationFor(plan, taxonomyResourceKey).action, 'put');
  assert.equal(mutationFor(plan, taxonomyResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, relationshipResourceKey).action, 'put');
  assert.equal(mutationFor(plan, relationshipResourceKey).changeKind, 'create');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:35'].taxonomy, 'post_tag');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:35'].term_id, 25);
  assert.equal(result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:35'].term_taxonomy_id, 35);
});

test('blocks a taxonomy relationship when its same-plan term_taxonomy target is itself blocked', () => {
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:31"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:31"]';
  const base = baseSite();
  base.db.wp_terms = {
    'term_id:22': {
      term_id: 22,
      name: 'base-private-parent-term',
      slug: 'base-private-parent',
    },
  };
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:21'] = {
    term_id: 21,
    name: 'local-private-child-term',
    slug: 'local-private-child',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:31'] = {
    term_taxonomy_id: 31,
    term_id: 21,
    taxonomy: 'category',
    parent: 22,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'] = {
    object_id: 1,
    term_taxonomy_id: 31,
    term_order: 0,
  };
  remote.db.wp_terms['term_id:22'] = {
    term_id: 22,
    name: 'remote-private-parent-term',
    slug: 'remote-private-parent',
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const relationshipJson = JSON.stringify(relationshipBlocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.references[0].relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipBlocker.references[0].targetResourceKey, taxonomyResourceKey);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(relationshipJson.includes('remote-private-parent-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('keeps nav_menu taxonomy graph surfaces blocked', () => {
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:33"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:33"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:23'] = {
    term_id: 23,
    name: 'local-private-menu-term',
    slug: 'local-private-menu',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:33'] = {
    term_taxonomy_id: 33,
    term_id: 23,
    taxonomy: 'nav_menu',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:33'] = {
    object_id: 1,
    term_taxonomy_id: 33,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });

  assert.equal(plan.status, 'blocked');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface nav_menu/);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(blockerJson.includes('local-private-menu-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('keeps custom taxonomy graph surfaces blocked as plugin-owned or ambiguous', () => {
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:34"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:34"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:24'] = {
    term_id: 24,
    name: 'local-private-product-term',
    slug: 'local-private-product',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:34'] = {
    term_taxonomy_id: 34,
    term_id: 24,
    taxonomy: 'product_cat',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:34'] = {
    object_id: 1,
    term_taxonomy_id: 34,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });

  assert.equal(plan.status, 'blocked');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(blockerJson.includes('local-private-product-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic plugin install when dependencies are absent', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      label: 'Install atomic dependent fixture',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];

  const plan = planFor(base, local, baseSite());

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'missing-plugin-dependency');
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('RPP-0220 propagates atomic group blockers before mutation with redacted evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const blockedResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const privateValues = [
    '<?php echo "local-private-rpp0220-file";',
    'Local private RPP-0220 title',
    'local-private-rpp0220-option-mode',
  ];
  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[2];
  local.pushIntents = [
    {
      id: 'rpp-0220-atomic-blocked-group',
      kind: 'change-set',
      requireAtomic: true,
      resources: [
        'file:index.php',
        'row:["wp_posts","ID:1"]',
        blockedResourceKey,
      ],
    },
  ];
  const journalEvents = [];
  const durableJournal = {
    appendEvent(type, payload) {
      journalEvents.push({ type, payload });
      return { sequence: journalEvents.length, type, ...payload };
    },
  };
  const beforeRemote = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const group = plan.atomicGroups.find((entry) => entry.id === 'rpp-0220-atomic-blocked-group');
  const directBlocker = plan.blockers.find((blocker) => blocker.resourceKey === blockedResourceKey);
  const propagatedBlockers = plan.blockers
    .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
  const groupEvidence = JSON.stringify({ group, blockers: plan.blockers });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.blockers, 3);
  assert.equal(group.status, 'blocked');
  assert.equal(directBlocker.class, 'unsupported-plugin-owned-resource');
  assert.match(directBlocker.localHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    propagatedBlockers.map((blocker) => [
      blocker.resourceKey,
      blocker.groupId,
      blocker.sourceBlockerIds,
    ]),
    [
      ['file:index.php', 'rpp-0220-atomic-blocked-group', [directBlocker.id]],
      ['row:["wp_posts","ID:1"]', 'rpp-0220-atomic-blocked-group', [directBlocker.id]],
    ],
  );
  assert.deepEqual(
    propagatedBlockers.map((blocker) => blocker.mutationId),
    [
      mutationFor(plan, 'file:index.php').id,
      mutationFor(plan, 'row:["wp_posts","ID:1"]').id,
    ],
  );
  assertEveryMutationHasLiveRemotePrecondition(plan);
  for (const privateValue of privateValues) {
    assert.equal(groupEvidence.includes(privateValue), false, `atomic blocker evidence leaked ${privateValue}`);
  }

  const error = captureError(() => applyPlan(remote, plan, { durableJournal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'blocked' });
  assert.deepEqual(journalEvents, []);
  assert.equal(JSON.stringify(remote), beforeRemote);
});

test('RPP-0240 propagates group-level atomic blockers before any mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const groupId = 'rpp-0240-missing-dependency-group';
  const dependentFileResourceKey = `file:${pluginMainFile(atomicDependentPlugin)}`;
  const dependentPluginResourceKey = `plugin:${atomicDependentPlugin}`;
  const privateValues = [
    '<?php echo "rpp0240-private-homepage-code";',
    '<?php /* rpp0240-private-dependent-plugin-code */',
    'rpp0240-private-dependency-access-token',
  ];
  local.files['index.php'] = privateValues[0];
  local.files[pluginMainFile(atomicDependentPlugin)] = privateValues[1];
  local.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  local.pushIntents = [
    {
      id: groupId,
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        'file:index.php',
        dependentFileResourceKey,
        dependentPluginResourceKey,
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            expectedVersion: '2.1.0',
            active: true,
            accessToken: privateValues[2],
          },
        ],
      },
    },
  ];
  const plan = planFor(base, local, remote);
  const group = plan.atomicGroups.find((entry) => entry.id === groupId);
  const directBlockers = group.blockers
    .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation');
  const propagatedBlockers = group.blockers
    .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
    .sort((a, b) => a.mutationId.localeCompare(b.mutationId));
  const groupMutations = plan.mutations
    .filter((mutation) => group.mutationIds.includes(mutation.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sourceBlockerIds = directBlockers.map((blocker) => blocker.id).sort();
  const journalEvents = [];
  const durableJournal = {
    claimFenced: true,
    claimHash: 'd'.repeat(64),
    appendEvent(type, payload) {
      journalEvents.push({ type, payload });
      return { sequence: journalEvents.length, type, ...payload };
    },
  };
  const beforeRemoteHash = digest(remote);
  const beforeRemoteJson = JSON.stringify(remote);
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(remote, plan, { durableJournal });
    appliedMutationCount = result.appliedMutations;
  });
  const mutationJournalEventCount = journalEvents
    .filter((event) => event.type.includes('mutation')).length;
  const evidence = {
    status: plan.status,
    summary: plan.summary,
    group: {
      id: group.id,
      status: group.status,
      mutationIds: [...group.mutationIds],
      directBlockers: directBlockers.map((blocker) => ({
        id: blocker.id,
        class: blocker.class,
        groupId: blocker.groupId,
        blockerHash: sha256Evidence(blocker),
      })),
      propagatedBlockers: propagatedBlockers.map((blocker) => ({
        id: blocker.id,
        class: blocker.class,
        groupId: blocker.groupId,
        mutationId: blocker.mutationId,
        resourceKey: blocker.resourceKey,
        sourceBlockerIds: [...blocker.sourceBlockerIds].sort(),
        blockerHash: sha256Evidence(blocker),
      })),
      dependencyRequirements: group.dependencyRequirements.map((requirement) => ({
        plugin: requirement.plugin,
        source: requirement.source,
        resourceKey: requirement.resourceKey,
        requirementHash: sha256Evidence(requirement),
      })),
    },
    mutations: groupMutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      atomicGroupId: mutation.atomicGroupId,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      plannedValueHash: sha256Evidence(deserializeMutationValue(mutation)),
    })),
    refusal: {
      code: error.code,
      detailsHash: sha256Evidence(error.details),
      beforeRemoteHash,
      afterRemoteHash: digest(remote),
      appliedMutationCount,
      durableJournalEventCount: journalEvents.length,
      mutationJournalEventCount,
    },
  };
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0240 test/push-planner.test.js',
    caveat: 'Focused local atomic blocker proof only; release remains gated separately.',
    evidence,
    evidenceHash: sha256Evidence(evidence),
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(plan.status, 'blocked');
  assert.equal(group.status, 'blocked');
  assert.equal(plan.summary.blockers, 4);
  assert.deepEqual(
    directBlockers.map((blocker) => blocker.class),
    ['missing-plugin-dependency'],
  );
  assert.equal(groupMutations.length, 3);
  assert.deepEqual(
    propagatedBlockers.map((blocker) => blocker.mutationId),
    groupMutations.map((mutation) => mutation.id),
  );
  assert.deepEqual(
    propagatedBlockers.map((blocker) => blocker.sourceBlockerIds),
    groupMutations.map(() => sourceBlockerIds),
  );
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'blocked' });
  assert.equal(appliedMutationCount, 0);
  assert.equal(journalEvents.length, 0);
  assert.equal(mutationJournalEventCount, 0);
  assert.equal(JSON.stringify(remote), beforeRemoteJson);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  for (const mutation of groupMutations) {
    assert.equal(
      evidenceText.includes(JSON.stringify(mutation.value)),
      false,
      `RPP-0240 evidence leaked mutation payload for ${mutation.resourceKey}`,
    );
  }
  for (const privateValue of privateValues) {
    assert.equal(evidenceText.includes(privateValue), false, `RPP-0240 evidence leaked ${privateValue}`);
  }
});

test('redacts raw plugin dependency metadata from blocker evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependentPlugin}`],
      dependencies: {
        privateEnvelope: 'dependency-envelope-secret',
        plugins: [
          {
            name: atomicDependencyPlugin,
            expectedVersion: '2.1.0',
            active: true,
            accessToken: 'dependency-token-secret',
          },
        ],
      },
    },
  ];

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.atomicGroups[0].dependencies, { plugins: [atomicDependencyPlugin] });
  assert.deepEqual(blocker.dependency, {
    plugin: atomicDependencyPlugin,
    expectedVersion: '2.1.0',
    active: true,
  });
  assert.equal(planJson.includes('dependency-token-secret'), false);
  assert.equal(planJson.includes('dependency-envelope-secret'), false);
});

test('applies an atomic plugin install when dependencies are included in the same plan', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'installed' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
        'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];

  const plan = planFor(base, local, baseSite());
  const result = applyPlan(baseSite(), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.atomicGroups[0].status, 'ready');
  assert.equal(result.site.plugins[atomicDependentPlugin].version, '1.0.0');
  assert.equal(result.site.plugins[atomicDependencyPlugin].version, '2.1.0');
  assert.equal(
    result.site.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value.mode,
    'installed',
  );
});

test('executor rejects forged ready atomic plugin plans before mutation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
    },
  ];

  const ready = planFor(base, local, baseSite());
  assert.equal(ready.status, 'ready');
  const dependencyMutationId = mutationFor(ready, `plugin:${atomicDependencyPlugin}`).id;

  const cases = [
    {
      name: 'missing dependency closure',
      code: 'ATOMIC_GROUP_DEPENDENCY_MISSING',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.mutations = plan.mutations.filter((mutation) => mutation.resourceKey !== `plugin:${atomicDependencyPlugin}`);
        plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== dependencyMutationId);
        plan.atomicGroups[0].mutationIds = plan.atomicGroups[0].mutationIds.filter((id) => id !== dependencyMutationId);
      }),
    },
    {
      name: 'dependency outside group',
      code: 'ATOMIC_GROUP_DEPENDENCY_OUTSIDE_GROUP',
      plan: tamperReadyPlan(ready, (plan) => {
        mutationFor(plan, `plugin:${atomicDependencyPlugin}`).atomicGroupId = null;
        plan.atomicGroups[0].mutationIds = plan.atomicGroups[0].mutationIds.filter((id) => id !== dependencyMutationId);
      }),
    },
    {
      name: 'dependent fixture without atomic group evidence',
      code: 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED',
      plan: tamperReadyPlan(ready, (plan) => {
        delete plan.atomicGroups;
        plan.summary.atomicGroups = 0;
      }),
    },
    {
      name: 'dependent fixture without dependency requirement evidence',
      code: 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED',
      plan: tamperReadyPlan(ready, (plan) => {
        delete plan.atomicGroups[0].dependencies;
        delete plan.atomicGroups[0].dependencyRequirements;
      }),
    },
    {
      name: 'incompatible dependency version',
      code: 'ATOMIC_GROUP_DEPENDENCY_VERSION_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedVersion = '9.9.9';
      }),
    },
    {
      name: 'dependency hash mismatch',
      code: 'ATOMIC_GROUP_DEPENDENCY_HASH_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedHash = '0'.repeat(64);
      }),
    },
    {
      name: 'bad active requirement',
      code: 'ATOMIC_GROUP_DEPENDENCY_ACTIVE_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].active = false;
      }),
    },
  ];

  for (const testCase of cases) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, testCase.plan));
    assert.ok(error instanceof PushPlanError, testCase.name);
    assert.equal(error.code, testCase.code, testCase.name);
    assert.equal(JSON.stringify(remote), before, testCase.name);
  }
});

test('executor rejects forged ready atomic plan when live dependency evidence is stale', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const plan = planFor(base, local, remote);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.atomicGroups[0].dependencyRequirements[0].source, 'live-remote');

  remote.plugins[atomicDependencyPlugin] = { version: '2.2.0', active: true };
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects row-only forged ready dependent fixture data plans before mutation', () => {
  const resourceKey = 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]';
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  base.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'remote' },
    __pluginOwner: atomicDependentPlugin,
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value = { mode: 'local' };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, atomicDependentPlugin),
      ),
    },
  ];
  const remote = JSON.parse(JSON.stringify(base));
  const ready = planFor(base, local, remote);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
  assert.equal(ready.atomicGroups[0].dependencyRequirements[0].source, 'live-remote');

  const forged = tamperReadyPlan(ready, (plan) => {
    delete plan.atomicGroups;
    plan.summary.atomicGroups = 0;
  });
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(
    remote.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value.mode,
    'remote',
  );
});

test('blocks an atomic plugin bundle when its dependency mutation is outside the group', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependency-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependencyPlugin}`],
    },
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependentPlugin}`],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];

  const plan = planFor(base, local, baseSite());
  const dependentGroup = plan.atomicGroups.find((group) => group.id === 'install-atomic-dependent-fixture');

  assert.equal(plan.status, 'blocked');
  assert.equal(dependentGroup.status, 'blocked');
  assert.equal(dependentGroup.blockers[0].class, 'plugin-dependency-outside-atomic-group');
  assert.equal(dependentGroup.blockers[0].plugin, atomicDependencyPlugin);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a dependent atomic bundle when a remote dependency changed since base', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(base, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.2.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'remote-plugin-dependency-drift');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(decisionFor(plan, `plugin:${atomicDependencyPlugin}`).decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle with an incompatible plugin dependency version range', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, versionRange: '>=3.0.0 <4.0.0' }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'incompatible-plugin-dependency-version-range');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.match(blocker.reason, />=3\.0\.0 <4\.0\.0/);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle when dependency hash metadata does not match remote', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, hash: 'sha256:not-the-remote-plugin-hash' }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'plugin-dependency-hash-mismatch');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(blocker.expectedHash, 'sha256:not-the-remote-plugin-hash');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle when dependency activation does not match requirement', () => {
  const resourceKey = 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]';
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, atomicDependentPlugin),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'incompatible-plugin-dependency-activation');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(blocker.expectedActive, true);
  assert.equal(blocker.actualActive, false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('rejects apply when the remote changed after dry-run planning', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const plan = planFor(base, local, baseSite());
  const driftedRemote = baseSite();
  driftedRemote.files['index.php'] = '<?php echo "surprise remote edit";';

  assert.throws(
    () => applyPlan(driftedRemote, plan),
    (error) => error instanceof PushPlanError && error.code === 'PRECONDITION_FAILED',
  );
  assert.equal(driftedRemote.files['index.php'], '<?php echo "surprise remote edit";');
});

test('RPP-0218 forged and stale ready plans reject before mutation with redacted evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "local-private-rpp0218-file";',
    'Local private RPP-0218 title',
    '<?php echo "remote-private-rpp0218-drift";',
  ];
  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];

  const ready = planFor(base, local, remote);
  const targetMutation = mutationFor(ready, 'file:index.php');
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter(
      (precondition) => precondition.mutationId !== targetMutation.id,
    );
  });
  const replayedForgery = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter(
      (precondition) => precondition.mutationId !== targetMutation.id,
    );
  });
  const firstJournal = [];
  const secondJournal = [];
  const trapJournal = (events) => ({
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  });
  const errorEnvelope = (error) => ({
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
  });

  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.summary, {
    mutations: 2,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assertEveryMutationHasLiveRemotePrecondition(ready);

  const beforeForgedRemote = JSON.stringify(remote);
  const forgedError = captureError(() => applyPlan(remote, forged, {
    durableJournal: trapJournal(firstJournal),
  }));
  const replayedForgedError = captureError(() => applyPlan(cloneJson(remote), replayedForgery, {
    durableJournal: trapJournal(secondJournal),
  }));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION');
  assert.deepEqual(errorEnvelope(forgedError), errorEnvelope(replayedForgedError));
  assert.deepEqual(forgedError.details.issues, [
    {
      code: 'MISSING_LIVE_REMOTE_PRECONDITION',
      mutationId: targetMutation.id,
      resourceKey: 'file:index.php',
      expectedHash: targetMutation.remoteBeforeHash,
    },
  ]);
  assert.deepEqual(firstJournal, [], 'forged ready plan should reject before durable journal evidence');
  assert.deepEqual(secondJournal, [], 'forged ready replay should reject before durable journal evidence');
  assert.equal(JSON.stringify(remote), beforeForgedRemote);
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, base.db.wp_posts['ID:1'].post_title);

  const staleRemote = cloneJson(remote);
  staleRemote.files['index.php'] = privateValues[2];
  const beforeStaleRemote = JSON.stringify(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, ready));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, 'file:index.php');
  assert.equal(staleError.details.expectedHash, targetMutation.remoteBeforeHash);
  assert.equal(JSON.stringify(staleRemote), beforeStaleRemote);
  assert.equal(staleRemote.files['index.php'], privateValues[2]);
  assert.equal(staleRemote.db.wp_posts['ID:1'].post_title, base.db.wp_posts['ID:1'].post_title);

  const refusalEvidence = JSON.stringify({
    forged: errorEnvelope(forgedError),
    stale: errorEnvelope(staleError),
  });
  for (const privateValue of privateValues) {
    assert.equal(refusalEvidence.includes(privateValue), false, `refusal evidence leaked ${privateValue}`);
  }
});

test('RPP-0233 localHash correctness rejects forged or stale evidence before mutation', () => {
  const fixture = rpp0233LocalHashFixture();
  const ready = planFor(fixture.base, fixture.local, fixture.remote);

  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), fixture.mutationResourceKeys);
  assertEveryMutationHasLiveRemotePrecondition(ready);
  assertPlannerSummaryMatchesEvidence(ready, 'RPP-0233 localHash ready plan');

  for (const mutation of ready.mutations) {
    const plannedValue = deserializeMutationValue(mutation);
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.equal(
      mutation.localHash,
      resourceHash(fixture.local, mutation.resource),
      `planner localHash must bind to local snapshot ${mutation.resourceKey}`,
    );
    assert.equal(
      mutation.localHash,
      digest(plannedValue),
      `planner localHash must bind to serialized mutation value ${mutation.resourceKey}`,
    );
  }

  const successful = applyPlan(cloneJson(fixture.remote), ready);
  assert.equal(successful.appliedMutations, 3);
  assert.equal(successful.site.files['index.php'], fixture.privateValues[0]);
  assert.equal(successful.site.db.wp_posts['ID:1'].post_title, fixture.privateValues[1]);
  assert.equal(
    successful.site.db.wp_options['option_name:forms_settings'].option_value.mode,
    fixture.privateValues[2],
  );

  const targetMutation = mutationFor(ready, 'file:index.php');
  const cases = [
    {
      name: 'missing localHash',
      issueCode: 'LOCAL_HASH_MISSING',
      forge(plan) {
        delete mutationFor(plan, targetMutation.resourceKey).localHash;
      },
    },
    {
      name: 'raw forged localHash is redacted',
      issueCode: 'LOCAL_HASH_INVALID',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = fixture.privateValues[3];
      },
    },
    {
      name: 'wrong localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = '0'.repeat(64);
      },
    },
    {
      name: 'stale mutation value with old localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).value = serializeResourceValue({
          type: 'file',
          content: fixture.privateValues[4],
        });
      },
    },
    {
      name: 'stale localHash from a different local snapshot',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = digest({
          type: 'file',
          content: fixture.privateValues[5],
        });
      },
    },
  ];

  for (const testCase of cases) {
    const remote = cloneJson(fixture.remote);
    const forged = tamperReadyPlan(ready, testCase.forge);
    const beforeRemote = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, forged));
    const serializedEvidence = JSON.stringify(rpp0233HashOnlyPlanEvidence(forged, error));

    assert.ok(error instanceof PushPlanError, testCase.name);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', testCase.name);
    assert.equal(JSON.stringify(remote), beforeRemote, `${testCase.name} mutated the remote before refusal`);
    assert.ok(
      error.details.issues.some((issue) => issue.code === testCase.issueCode),
      `${testCase.name} missing ${testCase.issueCode}`,
    );
    for (const privateValue of fixture.privateValues) {
      assert.equal(
        serializedEvidence.includes(privateValue),
        false,
        `${testCase.name} leaked private value ${privateValue}`,
      );
      assert.equal(
        JSON.stringify(error.details).includes(privateValue),
        false,
        `${testCase.name} leaked private value in refusal details ${privateValue}`,
      );
    }
  }
});

test('injected failure before commit returns no partially mutated remote state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  assert.throws(
    () => applyPlan(remote, plan, { failBeforeCommitAtMutation: 1 }),
    (error) => error instanceof PushPlanError && error.code === 'INJECTED_FAILURE_BEFORE_COMMIT',
  );
  assert.equal(JSON.stringify(remote), before);
});

test('injected failure before mutation leaves the old remote with a journal artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeMutation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.journal.entries.length, 2);
});

test('injected failure after staging leaves the old remote with staged rollback artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterStaging: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_STAGING');
  const journal = error.details.recovery.artifacts.journal;
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(journal.status, 'staged');
  assert.deepEqual(journal.entries.map((entry) => entry.status), ['staged', 'staged']);
  assert.ok(journal.entries.every((entry) => entry.beforeValue && entry.afterValue));
});

test('injected failure after dependency validation leaves the old remote with validated artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterDependencyValidation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
});

test('durable apply journal classifies pre-commit failures as old remote', () => {
  const scenarios = [
    {
      code: 'INJECTED_FAILURE_BEFORE_MUTATION',
      options: { failBeforeMutation: true },
      expectedEvents: ['recovery-claim-opened', 'journal-opened', 'target-planned', 'target-planned', 'recovery-state'],
    },
    {
      code: 'INJECTED_FAILURE_AFTER_STAGING',
      options: { failAfterStaging: true },
      expectedEvents: [
        'recovery-claim-opened',
        'journal-opened',
        'target-planned',
        'target-planned',
        'apply-staged',
        'recovery-state',
      ],
    },
    {
      code: 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
      options: { failAfterDependencyValidation: true },
      expectedEvents: [
        'recovery-claim-opened',
        'journal-opened',
        'target-planned',
        'target-planned',
        'apply-staged',
        'dependencies-validated',
        'recovery-state',
      ],
    },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:1'].post_title = 'Local title';
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const plan = planFor(base, local, remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, {
      truncate: true,
      now: fixedNow,
      claimId: `apply-plan-scenario-${scenario.code}`,
    });

    const error = captureError(() =>
      applyPlan(remote, plan, { ...scenario.options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, scenario.code);
    assert.equal(JSON.stringify(remote), before);
    assert.equal(persisted.integrity.status, 'ok');
    assert.deepEqual(persisted.records.map((record) => record.type), scenario.expectedEvents);
    assert.equal(inspection.status, 'old-remote');
    assert.deepEqual(inspection.counts, { old: 2, new: 0, blockedUnknown: 0 });
    for (const record of persisted.records) {
      assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    }
  }
});

test('durable journal write failures before commit include old-remote recovery artifacts', () => {
  const scenarios = [
    { failType: 'journal-opened', expectedJournalStatus: 'opened' },
    { failType: 'apply-staged', expectedJournalStatus: 'staged' },
    { failType: 'dependencies-validated', expectedJournalStatus: 'dependencies-validated' },
    { failType: 'apply-committing', expectedJournalStatus: 'committing' },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:1'].post_title = 'Local title';
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const plan = planFor(base, local, remote);
    const durableJournal = failingDurableJournal(scenario.failType);

    const error = captureError(() => applyPlan(remote, plan, { durableJournal }));

    assert.ok(error instanceof PushPlanError, scenario.failType);
    assert.equal(error.code, 'JOURNAL_WRITE_FAILED', scenario.failType);
    assert.equal(error.details.boundary, scenario.failType, scenario.failType);
    assert.equal(error.details.eventType, scenario.failType, scenario.failType);
    assert.equal(JSON.stringify(remote), before, scenario.failType);
    assert.equal(error.details.recovery.status, 'old-remote', scenario.failType);
    assert.equal(
      error.details.recovery.artifacts.journal.status,
      scenario.expectedJournalStatus,
      scenario.failType,
    );
  }
});

test('old-remote injected failures keep recovery artifacts if terminal recovery-state append fails', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const durableJournal = failingDurableJournal('recovery-state');

  const error = captureError(() =>
    applyPlan(remote, plan, { failAfterDependencyValidation: true, durableJournal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(error.details.durableRecoveryStateWriteFailed, true);
  assert.equal(error.details.durableJournalError.eventType, 'recovery-state');
});

test('retrying an old-remote journal appends durable retry state without duplicating targets', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const firstWriter = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'retrying-old-remote-first-writer',
  });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failBeforeMutation: true, durableJournal: firstWriter }));
  firstWriter.close();

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'old-remote');

  const retryWriter = openRecoveryJournal(journalPath, {
    now: fixedNow,
    claimId: 'retrying-old-remote-retry-writer',
  });
  appendStaleClaimAdvanced(retryWriter, {
    plan,
    current: remote,
    previousClaimId: 'retrying-old-remote-first-writer',
    claimId: 'retrying-old-remote-retry-writer',
    previousClaimAgeMs: 1,
  });
  const retry = applyPlan(remote, plan, {
    journal: firstError.details.recovery.artifacts.journal,
    durableJournal: retryWriter,
    mutateRemote: true,
  });
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(retry.appliedMutations, 2);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(remote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.ok(persisted.records.some((record) => record.type === 'journal-retry-opened'));
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
});

test('stale recovery claim fences an old worker before target mutation', () => {
  const base = baseSite();
  const staleLocal = baseSite();
  staleLocal.files['index.php'] = '<?php echo "STALE_LOCAL";';
  staleLocal.db.wp_posts['ID:1'].post_title = 'STALE_LOCAL_TITLE';
  const remote = baseSite();
  const plan = planFor(base, staleLocal, remote);
  const journalPath = tempRecoveryJournalPath();
  const staleThresholdMs = 1000;
  const previousClaimAgeMs = 5000;
  const workerAClaim = 'worker-a-stale-claim-proof';
  const workerBClaim = 'worker-b-stale-claim-proof';
  const workerA = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: workerAClaim,
  });
  appendRecoveryClaimOpened(workerA, {
    plan,
    current: remote,
    claimId: workerAClaim,
    staleThresholdMs,
  });

  let workerBAdvanced = false;
  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: workerA,
      mutateRemote: true,
      beforeMutation({ mutationIndex }) {
        assert.equal(mutationIndex, 1);
        const workerB = openRecoveryJournal(journalPath, {
          now: new Date(fixedNow.getTime() + previousClaimAgeMs),
          claimId: workerBClaim,
        });
        appendStaleClaimAdvanced(workerB, {
          plan,
          current: remote,
          previousClaimId: workerAClaim,
          claimId: workerBClaim,
          staleThresholdMs,
          previousClaimAgeMs,
        });
        workerB.close();
        remote.files['index.php'] = '<?php echo "FRESH_RETRY";';
        workerBAdvanced = true;
      },
    }));
  workerA.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });
  const journalText = fs.readFileSync(journalPath, 'utf8');

  assert.ok(workerBAdvanced);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "FRESH_RETRY";');
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Base post');
  assert.equal(journalText.includes('STALE_LOCAL'), false);
  assert.equal(journalText.includes('FRESH_RETRY'), false);
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'stale-claim-advanced',
    ],
  );
  assert.equal(persisted.records.some((record) => record.type === 'mutation-observed'), false);
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 0, blockedUnknown: 1 });
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.staleThresholdMs, staleThresholdMs);
  assert.equal(inspection.claim.previousClaimAgeMs, previousClaimAgeMs);
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('replaying a completed plan does not duplicate inserts or reapply stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  const replay = applyPlan(result.site, plan, { journal: result.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(Object.keys(replay.site.db.wp_posts).sort(), ['ID:1', 'ID:2']);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const changedAfterCompletion = JSON.parse(JSON.stringify(result.site));
  changedAfterCompletion.db.wp_posts['ID:2'].post_title = 'Remote edited after push';
  const error = captureError(() => applyPlan(changedAfterCompletion, plan, { journal: result.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(changedAfterCompletion.db.wp_posts['ID:2'].post_title, 'Remote edited after push');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
});

test('completed replay on a fresh durable journal persists a restart-inspectable envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'completed-replay-fresh-durable-journal',
  });

  const replay = applyPlan(result.site, plan, {
    journal: result.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: result.site });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      ...plan.mutations.map(() => 'target-planned'),
      'journal-replayed',
    ],
  );
  assert.equal(persisted.records[0].state, 'active');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('replaying a completed plan requires a complete matching journal envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  local.files['index.php'] = '<?php echo "local";';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const after = JSON.stringify(result.site);

  const missingTargetJournal = JSON.parse(JSON.stringify(result.journal));
  missingTargetJournal.entries = missingTargetJournal.entries.slice(0, 1);
  const missingTargetError = captureError(() =>
    applyPlan(result.site, plan, { journal: missingTargetJournal }));

  assert.ok(missingTargetError instanceof PushPlanError);
  assert.equal(missingTargetError.code, 'JOURNAL_TARGET_MISMATCH');
  assert.equal(JSON.stringify(result.site), after);

  const staleTargetJournal = JSON.parse(JSON.stringify(result.journal));
  staleTargetJournal.entries[0].afterHash = '0'.repeat(64);
  const staleTargetError = captureError(() =>
    applyPlan(result.site, plan, { journal: staleTargetJournal }));

  assert.ok(staleTargetError instanceof PushPlanError);
  assert.equal(staleTargetError.code, 'JOURNAL_TARGET_MISMATCH');
  assert.equal(JSON.stringify(result.site), after);
});

test('partial remote mutation is a blocked recovery state with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, { mutateRemote: true, failDuringCommitAtMutation: 1 }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Base post');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.journal.entries[0].status, 'applied');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');

  const retryError = captureError(() =>
    applyPlan(remote, plan, { journal: error.details.recovery.artifacts.journal }));

  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
});

test('durable apply journal classifies partial remote mutation as blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'durable-apply-journal-partial-commit',
  });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'mutation-observed',
      'recovery-state',
    ],
  );
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 1, blockedUnknown: 0 });
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('durable apply refuses an unfenced journal writer', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: unfencedDurableJournal(),
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_OWNERSHIP_REQUIRED');
  assert.equal(error.details.recovery, undefined);
});

test('durable apply refuses a claim-fenced journal writer without a valid claim hash', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: halfInitializedDurableJournal(),
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_OWNERSHIP_REQUIRED');
  assert.equal(
    error.message,
    'Durable recovery journal writer must carry a valid claim hash before applyPlan can write to it.',
  );
});

test('durable apply refuses a claim-fenced journal writer when persisted claim ownership is stale', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const filePath = tempRecoveryJournalPath();
  const currentClaimJournal = openRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'psh_01j00000000000000000000000',
  });
  appendRecoveryClaimOpened(currentClaimJournal, {
    plan,
    current: remote,
    claimId: 'psh_01j00000000000000000000000',
  });
  currentClaimJournal.close();

  const staleWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: fixedNow,
    claimId: 'psh_01j00000000000000000000001',
  });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: staleWriter,
    }));

  staleWriter.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.match(
    error.message,
    /Durable recovery journal claim was superseded before journal-opened\./,
  );
  assert.equal(error.details.activeClaimHash, recoveryClaimHash('psh_01j00000000000000000000000'));
  assert.equal(error.details.staleClaimHash, recoveryClaimHash('psh_01j00000000000000000000001'));
});

test('durable recovery stays within old remote, fully updated remote, or blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    {
      label: 'before mutation',
      options: { failBeforeMutation: true },
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'after staging',
      options: { failAfterStaging: true },
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedRecoveryStatus: 'old-remote',
    },
  ];

  for (const scenario of failureScenarios) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, scenario.options));

    assert.ok(error instanceof PushPlanError, scenario.label);
    assert.equal(JSON.stringify(remote), before, scenario.label);
    assert.equal(error.details.recovery.status, scenario.expectedRecoveryStatus, scenario.label);
    assert.ok(error.details.recovery.artifacts.journal, scenario.label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.db.wp_posts['ID:1'].post_title = 'Drifted after completion';
  const blocked = captureError(() => applyPlan(blockedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.db.wp_posts['ID:1'].post_title, 'Drifted after completion');
});

test('failure before mutation leaves old remote and a recovery artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeMutation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
});

test('failure after staging leaves old remote and a recovery artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterStaging: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'staged');
});

test('failure after dependency validation leaves old remote and a recovery artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterDependencyValidation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
});

test('replaying a completed plan returns the fully updated remote without reapplying mutations', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const completedSnapshot = JSON.stringify(completed.site);

  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(completed.site), completedSnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
});
