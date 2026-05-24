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
  assert.equal(flow.stages[5].mode, 'inspect');
  assert.equal(flow.stages[6].mode, 'auto|finish|rollback');
  assert.deepEqual(flow.required_invariants, [
    'dry-run and apply are separate remote operations',
    'apply must revalidate the live remote before every batch and at the storage boundary',
    'journal inspection is read-only and never authorizes mutation by itself',
    'recovery must begin with inspect before any mutating repair',
    'authentication must be at least as strict as current Reprint HMAC usage',
  ]);
});

test('push topology fixture encodes one remote, one local, one runner over sandbox ingress only', () => {
  const topology = readJson('fixtures/protocol/push-topology.json');

  assert.equal(topology.topology_id, 'push-topology-one-remote-one-local');
  assert.equal(topology.networking.ingress_port, 8080);
  assert.equal(topology.networking.proxy_policy, 'local-only');
  assert.equal(topology.networking.tunnels, 'disallowed');
  assert.equal(topology.roles.remote_base.examples.docker, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.playground, 'local-edited');
  assert.equal(topology.roles.remote_changed.role, 'the same remote site after independent live drift between dry-run and apply');
  assert.equal(topology.roles.runner.role, 'the only process allowed to compare, upload, inspect, and recover');
  assert.ok(topology.docker.evidence.some((line) => line.includes('push_batch_apply revalidates the live remote')));
  assert.ok(topology.playground.shape.some((line) => line.includes('fresh snapshot listing')));
});

test('push pull mapping fixture preserves the one-way pull-to-push provenance boundary', () => {
  const mapping = readJson('fixtures/protocol/push-pull-mapping.json');

  assert.equal(mapping.mapping_id, 'push-pull-mapping-one-way');
  assert.equal(mapping.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    mapping.push_pipeline.batch_apply,
    'revalidates the live remote before every batch and again at the storage boundary',
  );
  assert.equal(mapping.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(mapping.required_invariants[0], 'the pull package is immutable provenance, not a live lock');
});
