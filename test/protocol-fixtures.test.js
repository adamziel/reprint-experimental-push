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
  assert.ok(flow.stages[4].outputs.includes('open or committed claim evidence'));
  assert.ok(flow.stages[6].outputs.includes('mutating recovery proof'));
  assert.deepEqual(flow.required_invariants, [
    'dry-run and apply are separate remote operations',
    'apply must revalidate the live remote before every batch and at the storage boundary',
    'journal inspection is read-only and never authorizes mutation by itself',
    'recovery must begin with inspect before any mutating repair',
    'authentication must be at least as strict as current Reprint HMAC usage',
  ]);
});

test('push contract fixture binds the pull handoff to the production push sequence', () => {
  const contract = readJson('fixtures/protocol/push-contract.json');
  const mapping = readJson('fixtures/protocol/push-pull-mapping.json');

  assert.equal(contract.contract_id, 'push-contract-production-extension');
  assert.equal(contract.pull_handoff.exporter, 'scans the merge base and coverage evidence');
  assert.equal(contract.pull_handoff.importer, 'persists the base package as immutable provenance');
  assert.equal(
    contract.pull_handoff.push_snapshot_hashes,
    'lists the live remote comparison set for planning only and never acts as a lock',
  );
  assert.equal(
    contract.pull_handoff.push_plan_dry_run,
    'uploads the canonical plan as eligibility evidence and returns a receipt without mutating target resources',
  );
  assert.equal(
    contract.pull_handoff.push_batch_apply,
    'applies mutation batches only after fresh live revalidation before every batch and again at the storage boundary',
  );
  assert.deepEqual(contract.protocol_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(
    contract.production_shape.remote_snapshot_hash_listing,
    'a cursorable live remote hash listing used only for planning',
  );
  assert.equal(
    contract.production_shape.dry_run_plan_upload,
    'a canonical plan upload that yields a receipt but never a lock',
  );
  assert.equal(contract.topology.networking.ingress_port, 8080);
  assert.equal(contract.topology.networking.proxy_policy, 'local-only');
  assert.equal(contract.topology.networking.tunnels, 'disallowed');
  assert.equal(contract.topology.docker.proof[0], 'one private network');
  assert.ok(
    contract.topology.docker.proof.includes(
      'remote-base and remote-changed are the same remote identity at different times',
    ),
  );
  assert.ok(
    contract.topology.playground.proof.includes(
      'separate disposable blueprints',
    ),
  );
  assert.equal(contract.topology.docker.remote_base, 'remote-base');
  assert.equal(contract.topology.docker.local_edited, 'local-edited');
  assert.equal(contract.topology.docker.remote_changed, 'remote-changed');
  assert.equal(contract.topology.playground.remote_base, 'remote-base');
  assert.equal(contract.topology.playground.local_edited, 'local-edited');
  assert.equal(contract.topology.playground.remote_changed, 'remote-changed');
  assert.equal(contract.proofs.auth, 'push-auth-headers.json keeps read-only inspection on the existing HMAC family and requires push session, idempotency, and canonical push signature for dry-run, apply, and mutating recovery');
  assert.equal(
    contract.proofs.auth_session_journal,
    'push-auth-session-journal-proof.json binds push-scoped auth, session minting, journal rows, lease fencing, and inspect-first recovery',
  );
  assert.equal(contract.proofs.auth.includes('existing HMAC family'), true);
  assert.equal(contract.proofs.session_journal.includes('inspect-first recovery path'), true);
  assert.equal(contract.required_invariants[0], 'dry-run and apply are separate remote operations');
  assert.ok(
    contract.required_invariants.includes('remote snapshot hash listing is planning evidence, not write authority'),
  );
  assert.equal(mapping.mapping_id, 'push-pull-handoff-production-map');
  assert.equal(mapping.pull_exports.persisted_base_package.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(mapping.pull_exports.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(mapping.push_bindings.push_snapshot_hashes, 'lists the live remote comparison set for planning only');
  assert.ok(mapping.restart_proof.invariants.includes('recovery must begin with inspect before any mutating repair'));
});

test('push auth fixture requires push-scoped headers for mutating calls and keeps inspect read-only', () => {
  const preflightRequest = readJson('fixtures/protocol/push-preflight-request.json');
  const snapshotRequest = readJson('fixtures/protocol/push-snapshot-hashes-request.json');
  const dryRunRequest = readJson('fixtures/protocol/push-dry-run-request.json');
  const applyRequest = readJson('fixtures/protocol/push-apply-batch-request.json');
  const journalRequest = readJson('fixtures/protocol/push-journal-request.json');
  const recoveryRequest = readJson('fixtures/protocol/push-recovery-request.json');
  const preflight = readJson('fixtures/protocol/push-preflight-response.json');
  const headers = readJson('fixtures/protocol/push-auth-headers.json');
  const snapshot = readJson('fixtures/protocol/push-snapshot-hashes-response.json');
  const journalOpen = readJson('fixtures/protocol/push-journal-open-response.json');
  const inspectRequest = readJson('fixtures/protocol/push-recovery-inspect-request.json');
  const inspectResponse = readJson('fixtures/protocol/push-recovery-inspect-response.json');
  const blockedInspect = readJson('fixtures/protocol/push-recovery-inspect-blocked-response.json');
  const recoveryDecision = readJson('fixtures/protocol/push-recovery-decision.json');

  assert.equal(preflightRequest.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(preflightRequest.remote_site_id, 'remote-example');
  assert.deepEqual(preflightRequest.requested_scopes, ['files', 'database', 'plugins', 'themes']);
  assert.equal(snapshotRequest.push_session, 'psh_01j00000000000000000000000');
  assert.equal(snapshotRequest.batch_size, 1000);
  assert.equal(dryRunRequest.plan_id, 'plan_2026-05-24T00:00:00Z_001');
  assert.equal(dryRunRequest.remote_snapshot_id, 'snap_01j00000000000000000000000');
  assert.equal(dryRunRequest.remote_coverage_hash, 'sha256:remote-coverage');
  assert.equal(applyRequest.dry_run_id, 'dry_01j00000000000000000000000');
  assert.equal(applyRequest.batch_id, 'batch-1');
  assert.equal(applyRequest.dry_run_receipt_hash, 'sha256:dry-run-receipt');
  assert.equal(journalRequest.cursor, null);
  assert.equal(journalRequest.include_artifacts, false);
  assert.equal(recoveryRequest.mode, 'auto');
  assert.equal(preflight.auth.required[0], 'export-hmac');
  assert.equal(preflight.auth.required[1], 'canonical-push-hmac');
  assert.equal(preflight.capabilities.journal, true);
  assert.equal(preflight.capabilities.recovery, true);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.cursor, null);
  assert.equal(snapshot.coverage.complete, true);
  assert.equal(snapshot.coverage.coverage_hash, 'sha256:remote-coverage');
  assert.equal(snapshot.resources[0].storage_guard, 'filesystem-compare-rename');
  assert.equal(snapshot.resources.length, 3);
  assert.ok(snapshot.resources.every((resource) => resource.storage_guard));
  assert.ok(headers.read_only_request_headers['X-Auth-Signature'].startsWith('hmac-sha256:'), 'read-only auth must stay HMAC-based');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Session'], 'mutating requests must carry a push session');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Idempotency-Key'], 'mutating requests must carry an idempotency key');
  assert.ok(headers.dry_run_apply_or_mutating_recovery_headers['X-Reprint-Push-Signature'], 'mutating requests must carry a canonical push signature');
  assert.equal(inspectRequest.mode, 'inspect');
  assert.ok(!('idempotency_key' in inspectRequest), 'inspect must not require a mutating idempotency key');
  assert.equal(inspectResponse.state, 'inspect');
  assert.equal(inspectResponse.proof, 'journal-and-live-hashes-reviewed');
  assert.ok(inspectResponse.actions.includes('inspected-journal'));
  assert.ok(inspectResponse.actions.includes('inspected-live-hashes'));
  assert.equal(blockedInspect.state, 'inspect');
  assert.equal(blockedInspect.code, 'RECOVERY_BLOCKED');
  assert.equal(recoveryDecision.inspect.mutates, false);
  assert.equal(recoveryDecision.mutating_modes.finish.requires[1], 'fresh live hashes');
  assert.equal(journalOpen.entries[0].claim_generation, 4);
  assert.equal(journalOpen.entries[0].lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(journalOpen.entries[0].resources[0].before_hash, 'sha256:base-index');
  assert.equal(journalOpen.entries[0].resources[0].staged_hash, 'sha256:local-index');
  assert.equal(journalOpen.entries[0].storage_guards[0].outcome, 'claimed');
  assert.equal(journalOpen.entries[0].resources[1].resource_key, 'row:["wp_posts","ID:1"]');
  assert.equal(journalOpen.entries[0].storage_guards[1].guard, 'mysql-transaction-row-lock');
});

test('push topology fixture encodes one remote, one local, one runner over sandbox ingress only', () => {
  const topology = readJson('fixtures/protocol/push-topology.json');

  assert.equal(topology.topology_id, 'push-topology-one-remote-one-local');
  assert.equal(topology.networking.ingress_port, 8080);
  assert.equal(topology.networking.proxy_policy, 'local-only');
  assert.equal(topology.networking.tunnels, 'disallowed');
  assert.equal(topology.remote_identity.site_id, 'remote-example');
  assert.equal(topology.remote_identity.same_remote_identity, true);
  assert.equal(topology.remote_identity.remote_base_snapshot, 'remote-base');
  assert.equal(topology.remote_identity.remote_changed_snapshot, 'remote-changed');
  assert.equal(topology.roles.remote_base.examples.docker, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.playground, 'local-edited');
  assert.equal(topology.roles.remote_changed.examples.docker, 'remote-changed');
  assert.equal(topology.roles.remote_changed.role, 'the same remote site after independent drift between dry-run and apply');
  assert.equal(topology.roles.runner.role, 'the only process allowed to compare, upload, inspect, and recover');
  assert.equal(topology.roles.remote_base.examples.playground, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.docker, 'local-edited');
  assert.equal(topology.docker.topology[0], 'remote-base is one WordPress source site on the private network');
  assert.equal(topology.playground.topology[0], 'remote-base is the source blueprint that becomes the persisted pull base');
  assert.ok(topology.docker.topology.some((line) => line.includes('remote-base is one WordPress source site')));
  assert.ok(topology.docker.topology.some((line) => line.includes('runner is the only caller')));
  assert.ok(topology.playground.topology.some((line) => line.includes('remote-base is the source blueprint')));
  assert.ok(topology.playground.topology.some((line) => line.includes('runner is the local test process')));
  assert.ok(topology.docker.evidence.some((line) => line.includes('push_batch_apply revalidates the live remote')));
  assert.ok(topology.playground.shape.some((line) => line.includes('fresh snapshot listing')));
  assert.ok(topology.docker.shape.some((line) => line.includes('remote-base pulls first and seeds the merge base')));
  assert.ok(topology.playground.evidence.some((line) => line.includes('remote-changed is the same remote site observed later')));
  assert.equal(topology.roles.remote_changed.examples.playground, 'remote-changed');
  assert.ok(topology.playground.shape.some((line) => line.includes('remote-changed')));
  assert.deepEqual(topology.test_topology.proof_order, [
    'preflight',
    'snapshot-hashes',
    'dry-run',
    'apply',
    'journal',
    'recovery-inspect',
    'recovery-mutate',
  ]);
  assert.ok(
    topology.test_topology.drift_proof.includes(
      'remote-base and remote-changed are the same remote identity observed at different times',
    ),
  );
  assert.ok(
    topology.test_topology.drift_proof.includes(
      'apply revalidates fresh live evidence before every batch and again at the storage boundary',
    ),
  );
  assert.ok(
    topology.test_topology.drift_proof.includes(
      'browser-visible inspection uses the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
});

test('push pull mapping fixture preserves the one-way pull-to-push provenance boundary', () => {
  const mapping = readJson('fixtures/protocol/push-pull-mapping.json');

  assert.equal(mapping.mapping_id, 'push-pull-handoff-production-map');
  assert.equal(mapping.pull_exports.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    mapping.push_bindings.push_batch_apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    mapping.push_bindings.push_recover,
    'starts with inspect and only mutates when journal evidence plus fresh live hashes prove the action',
  );
  assert.equal(mapping.pull_exports.persisted_base_package.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(mapping.pull_exports.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(mapping.pull_exports.persisted_base_package.base_coverage_hash, 'sha256:pull-base-coverage');
  assert.ok(mapping.restart_proof.persisted_evidence.includes('base_manifest_id'));
  assert.equal(mapping.restart_proof.invariants[0], 'dry-run and apply are separate remote operations');
  assert.ok(
    mapping.restart_proof.invariants.includes('remote snapshot hash listing is planning evidence, not write authority'),
  );
});

test('push recovery inspect fixture distinguishes safe evidence from blocked recovery', () => {
  const inspect = readJson('fixtures/protocol/push-recovery-inspect-response.json');
  const blocked = readJson('fixtures/protocol/push-recovery-inspect-blocked-response.json');
  const decision = readJson('fixtures/protocol/push-recovery-decision.json');

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
  assert.equal(blocked.details.live_hashes[0].resource_key, 'file:index.php');
  assert.equal(blocked.details.live_hashes[0].actual_hash, 'sha256:unexpected-live-index');
  assert.equal(decision.inspect.mutates, false);
  assert.equal(decision.inspect.next, 'finish|rollback|retry|block');
  assert.ok(decision.mutating_modes.finish.requires.includes('fresh live hashes'));
  assert.ok(decision.required_invariants.includes('inspect is read-only'));
});

test('push session journal proof binds the minted session to fencing and inspect-first recovery', () => {
  const proof = readJson('fixtures/protocol/push-session-journal-proof.json');
  const recoveryPath = readJson('fixtures/protocol/push-recovery-path.json');

  assert.equal(proof.proof_id, 'push-session-journal-proof-one-remote-one-local');
  assert.equal(proof.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(proof.session.remote_site_id, 'remote-example');
  assert.equal(proof.session.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(proof.session.identity_hash, 'sha256:remote-identity');
  assert.equal(proof.live_evidence.snapshot_id, 'snap_01j00000000000000000000000');
  assert.equal(proof.live_evidence.remote_changed_snapshot_id, 'snap_01j00000000000000000000001');
  assert.equal(proof.live_evidence.same_remote_identity, true);
  assert.equal(proof.journal_fencing.claim_generation, 4);
  assert.equal(proof.journal_fencing.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.deepEqual(proof.apply_revalidation.rejected_if, [
    'dry-run evidence is stale',
    'live drift appears after the dry-run receipt',
    'the journal cannot prove a safe finish or rollback',
  ]);
  assert.equal(proof.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(proof.apply_revalidation.at_storage_boundary, 'fresh live hashes');
  assert.deepEqual(proof.recovery.blocked_when, [
    'fresh live hashes do not match the journaled target',
    'the journal cannot prove a safe finish or rollback',
  ]);
  assert.equal(proof.recovery.inspect_mode, 'inspect');
  assert.equal(proof.recovery.mutates, false);
  assert.ok(proof.required_invariants.includes('claim generation and lease expiry fence stale workers before mutation'));
  assert.ok(proof.required_invariants.includes('journal inspection is read-only and inspect must come before mutating recovery'));
  assert.equal(recoveryPath.path_id, 'push-recovery-path-inspect-first');
  assert.equal(recoveryPath.inspect.mutates, false);
  assert.deepEqual(recoveryPath.inspect.required_order, [
    'read journal',
    'inspect live hashes',
    'classify finish|rollback|retry|block',
  ]);
  assert.equal(recoveryPath.classification.blocked, 1);
  assert.equal(recoveryPath.inputs.same_remote_identity, true);
  assert.ok(recoveryPath.mutating_modes.finish.requires.includes('fresh live hashes'));
  assert.ok(recoveryPath.required_invariants.includes('stale dry-run evidence must not be promoted into recovery authority'));
});

test('push auth session journal proof binds push-scoped auth to journal fencing and inspect-first recovery', () => {
  const proof = readJson('fixtures/protocol/push-auth-session-journal-proof.json');

  assert.equal(proof.proof_id, 'push-auth-session-journal-proof-one-remote-one-local');
  assert.equal(proof.auth.push_hmac_family, 'hmac-sha256');
  assert.equal(proof.auth.export_hmac_family, 'hmac-sha256');
  assert.deepEqual(proof.auth.push_requires, [
    'push session',
    'canonical push signature',
    'idempotency key',
  ]);
  assert.equal(proof.auth.inspect_requires[1], 'no mutating idempotency key');
  assert.ok(proof.auth.inspect_requires.includes('HMAC-authenticated request'));
  assert.equal(proof.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(proof.session.remote_site_id, 'remote-example');
  assert.equal(proof.session.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(proof.session.identity_hash, 'sha256:remote-identity');
  assert.equal(proof.journal_row.claim_owner, 'worker-17');
  assert.equal(proof.journal_row.claim_generation, 4);
  assert.equal(proof.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(proof.journal_row.resource_key, 'row:["wp_posts","ID:1"]');
  assert.equal(proof.journal_row.before_hash, 'sha256:base-post-1');
  assert.equal(proof.journal_row.staged_hash, 'sha256:local-post-1');
  assert.equal(proof.journal_row.after_hash, 'sha256:remote-post-1');
  assert.equal(proof.journal_row.storage_guard, 'mysql-transaction-row-lock');
  assert.equal(proof.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(proof.inspect.mode, 'inspect');
  assert.equal(proof.inspect.mutates, false);
  assert.deepEqual(proof.inspect.requires, [
    'read journal',
    'inspect live hashes',
    'classify finish|rollback|retry|block',
  ]);
  assert.ok(proof.inspect.blocked_when.includes('fresh live hashes do not match the journaled target'));
  assert.ok(proof.required_invariants.includes('mutating push requests must carry a push session, idempotency key, and canonical push signature'));
});
