#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const topology = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'fixtures/protocol/push-production-topology-contract.json'), 'utf8'),
);
const routeMatrix = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'fixtures/protocol/push-production-route-matrix-contract.json'), 'utf8'),
);

assert.equal(topology.topology.remote_base, 'remote-base');
assert.equal(topology.topology.local_edited, 'local-edited');
assert.equal(topology.topology.remote_changed, 'remote-changed');
assert.equal(topology.topology.runner, 'runner');
assert.equal(topology.topology.same_remote_identity, true);
assert.equal(topology.topology.networking.ingress_port, 8080);
assert.equal(topology.topology.networking.proxy_policy, 'local-only');
assert.equal(topology.topology.networking.tunnels, 'disallowed');
assert.deepEqual(routeMatrix.stage_order, [
  'push_preflight',
  'push_snapshot_hashes',
  'push_plan_dry_run',
  'push_batch_apply',
  'push_journal',
  'push_recover inspect',
  'push_recover auto|finish|rollback',
]);

process.stdout.write(
  JSON.stringify(
    {
      topology: {
        remoteBase: topology.topology.remote_base,
        localEdited: topology.topology.local_edited,
        remoteChanged: topology.topology.remote_changed,
        runner: topology.topology.runner,
        ingressPort: topology.topology.networking.ingress_port,
        proxyPolicy: topology.topology.networking.proxy_policy,
        tunnels: topology.topology.networking.tunnels,
      },
      routeMatrix: {
        docker: routeMatrix.route_matrix.docker,
        playground: routeMatrix.route_matrix.playground,
      },
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
