import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

test('push protocol fixture captures the production stage order and recovery rules', () => {
  const flow = readJson('fixtures/protocol/push-flow.json');

  assert.equal(flow.flow_id, 'push-flow-preflight-to-recovery');
  assert.deepEqual(
    flow.stages.map((stage) => stage.name),
    [
      'preflight',
      'snapshot-hashes',
      'dry-run',
      'apply',
      'journal',
      'recovery-inspect',
      'recovery-mutate',
    ],
  );
  assert.equal(flow.stages[3].revalidation[0], 'fresh remote hash check before every batch');
  assert.ok(flow.stages[0].outputs.includes('requested scope binding'));
  assert.ok(flow.stages[1].outputs.includes('fresh apply-time evidence, not a lock'));
  assert.ok(flow.stages[2].outputs.includes('explicit non-mutating receipt'));
  assert.ok(flow.stages[3].outputs.includes('revalidated live proof for each batch'));
  assert.equal(flow.stages[5].mode, 'inspect');
  assert.equal(flow.stages[6].mode, 'auto|finish|rollback');
  assert.ok(flow.stages[0].outputs.includes('base manifest binding'));
  assert.ok(flow.stages[5].outputs.includes('journal and live-hash proof'));
  assert.deepEqual(flow.required_invariants, [
    'dry-run and apply are separate remote operations',
    'apply must revalidate the live remote before every batch and at the storage boundary',
    'journal inspection is read-only and never authorizes mutation by itself',
    'recovery must begin with inspect before any mutating repair',
    'authentication must be at least as strict as current Reprint HMAC usage',
  ]);
});

test('push auth fixture requires push-scoped headers for mutating calls and keeps inspect read-only', () => {
  const preflight = readJson('fixtures/protocol/push-preflight-response.json');
  const headers = readJson('fixtures/protocol/push-auth-headers.json');
  const journalOpen = readJson('fixtures/protocol/push-journal-open-response.json');
  const inspectRequest = readJson('fixtures/protocol/push-recovery-inspect-request.json');

  assert.equal(preflight.auth.required[0], 'export-hmac');
  assert.equal(preflight.auth.required[1], 'canonical-push-hmac');
  assert.equal(preflight.capabilities.journal, true);
  assert.equal(preflight.capabilities.recovery, true);
  assert.ok(headers.read_only_request_headers['X-Auth-Signature'].startsWith('hmac-sha256:'), 'read-only auth must stay HMAC-based');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Session'], 'mutating requests must carry a push session');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Idempotency-Key'], 'mutating requests must carry an idempotency key');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Signature'], 'mutating requests must carry a canonical push signature');
  assert.equal(inspectRequest.mode, 'inspect');
  assert.ok(!('idempotency_key' in inspectRequest), 'inspect must not require a mutating idempotency key');
  assert.equal(journalOpen.entries[0].claim_generation, 4);
  assert.equal(journalOpen.entries[0].lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(journalOpen.entries[0].resources[0].before_hash, 'sha256:base-index');
  assert.equal(journalOpen.entries[0].resources[0].staged_hash, 'sha256:local-index');
  assert.equal(journalOpen.entries[0].storage_guards[0].outcome, 'claimed');
});

test('push topology fixture encodes one remote, one local, one runner over sandbox ingress only', () => {
  const topology = readJson('fixtures/protocol/push-topology.json');

  assert.equal(topology.topology_id, 'push-topology-one-remote-one-local');
  assert.equal(topology.networking.ingress_port, 8080);
  assert.equal(topology.networking.proxy_policy, 'local-only');
  assert.equal(topology.networking.tunnels, 'disallowed');
  assert.equal(topology.roles.remote_base.examples.docker, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.playground, 'local-edited');
  assert.equal(topology.roles.remote_changed.examples.docker, 'remote-changed');
  assert.equal(topology.roles.remote_changed.role, 'the same remote site after independent drift between dry-run and apply');
  assert.equal(topology.roles.runner.role, 'the only process allowed to compare, upload, inspect, and recover');
  assert.equal(topology.roles.remote_base.examples.playground, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.docker, 'local-edited');
  assert.ok(topology.docker.topology.some((line) => line.includes('remote-base is one WordPress source site')));
  assert.ok(topology.docker.topology.some((line) => line.includes('runner is the only caller')));
  assert.ok(topology.playground.topology.some((line) => line.includes('remote-base is the source blueprint')));
  assert.ok(topology.playground.topology.some((line) => line.includes('runner is the local test process')));
  assert.ok(topology.docker.evidence.some((line) => line.includes('push_batch_apply revalidates the live remote')));
  assert.ok(topology.playground.shape.some((line) => line.includes('fresh snapshot listing')));
  assert.ok(topology.docker.shape.some((line) => line.includes('remote-base pulls first and seeds the merge base')));
  assert.ok(topology.playground.evidence.some((line) => line.includes('remote-changed is the same remote site observed later')));
});

test('push pull mapping fixture preserves the one-way pull-to-push provenance boundary', () => {
  const mapping = readJson('fixtures/protocol/push-pull-mapping.json');

  assert.equal(mapping.mapping_id, 'push-pull-mapping-one-way');
  assert.equal(mapping.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    mapping.push_pipeline.batch_apply,
    'revalidates the live remote before every batch and again at the storage boundary before any write',
  );
  assert.equal(mapping.session_binding.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(mapping.session_binding.remote_site_id, 'remote-example');
  assert.deepEqual(mapping.session_binding.requested_scope, ['files', 'database', 'plugins', 'themes']);
  assert.equal(mapping.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(mapping.required_invariants[0], 'the pull package is immutable provenance, not a live lock');
  assert.ok(mapping.required_invariants.includes('preflight binds the push session to the stored pull base, requested scope, and live remote identity'));
  assert.ok(mapping.required_invariants.includes('remote hash listing is planning evidence and never an apply lock'));
  assert.ok(mapping.required_invariants.includes('mutating recovery requires inspect evidence before finish or rollback'));
});

test('push recovery inspect fixture distinguishes safe evidence from blocked recovery', () => {
  const inspect = readJson('fixtures/protocol/push-recovery-inspect-response.json');
  const blocked = readJson('fixtures/protocol/push-recovery-inspect-blocked-response.json');

  assert.equal(inspect.state, 'inspect');
  assert.equal(inspect.proof, 'journal-and-live-hashes-reviewed');
  assert.deepEqual(inspect.actions, ['inspected-journal', 'inspected-live-hashes']);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assert.equal(blocked.state, 'inspect');
  assert.equal(
    blocked.message,
    'Inspection proved the batch cannot be safely finished or rolled back.',
  );
  assert.equal(blocked.details.target_state_counts.blocked, 1);
});
