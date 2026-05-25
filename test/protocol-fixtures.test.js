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
  const topologyMatrix = readJson('fixtures/protocol/push-topology-matrix.json');

  assert.equal(contract.contract_id, 'push-contract-production-extension');
  assert.equal(contract.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(contract.pull_pipeline.importer, 'persists the base package as immutable provenance');
  assert.equal(contract.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
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
    contract.push_guards.snapshot_listing,
    'returns live remote hash evidence for planning and never upgrades into write authority',
  );
  assert.equal(
    contract.push_guards.dry_run_receipt,
    'proves eligibility only and cannot be reused as a liveness lock',
  );
  assert.equal(
    contract.push_guards.apply_revalidation,
    'refreshes live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    contract.production_shape.dry_run_plan_upload,
    'a canonical plan upload that yields a receipt but never a lock',
  );
  assert.equal(
    contract.production_shape.preflight_session_binding,
    'a short-lived session bound to the persisted pull base and live remote identity',
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
  assert.equal(topologyMatrix.push_pipeline.preflight, 'binds the persisted pull base to the live remote identity and a short-lived push session');
  assert.equal(topologyMatrix.push_pipeline.snapshot_hash_listing, 'returns the live remote comparison set for planning only');
  assert.equal(topologyMatrix.push_pipeline.dry_run_plan_upload, 'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock');
  assert.equal(topologyMatrix.push_pipeline.mutation_batch_apply, 'revalidates fresh live evidence before every batch and again at the storage boundary');
  assert.equal(topologyMatrix.push_pipeline.journal_inspect, 'reads durable evidence without authorizing mutation');
  assert.equal(topologyMatrix.push_pipeline.recovery, 'starts with inspect and allows mutating repair only when the journal and live hashes prove the action');
  assert.equal(topologyMatrix.remote_snapshot_hash_listing, 'cursorable live hash evidence used for planning only and never treated as write authority');
  assert.equal(topologyMatrix.pull_to_push_mapping.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    topologyMatrix.pull_to_push_mapping.importer,
    'persists the base package as immutable provenance',
  );
  assert.equal(
    topologyMatrix.pull_to_push_mapping.preflight,
    'binds that persisted base package to the live remote identity and a short-lived session',
  );
  assert.equal(
    topologyMatrix.pull_to_push_mapping.recovery,
    'starts with inspect and only mutates when the journal plus fresh live hashes prove the action',
  );
  assert.equal(
    topologyMatrix.recovery_inspect.authorization,
    'read-only evidence reader that never authorizes mutation by itself',
  );
  assert.equal(topologyMatrix.roles.remote_base, 'one remote source site that seeds the persisted pull base');
  assert.equal(topologyMatrix.roles.local_edited, 'one imported local site with user edits');
  assert.equal(topologyMatrix.roles.remote_changed, 'the same remote site observed later after independent drift');
  assert.equal(topologyMatrix.roles.runner, 'the only process allowed to preflight, plan, upload, inspect, revalidate, and recover');
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
  assert.ok(
    contract.required_invariants.includes('authentication must be at least as strict as current Reprint HMAC usage'),
  );
  assert.equal(mapping.mapping_id, 'push-pull-handoff-production-map');
  assert.equal(mapping.pull_exports.persisted_base_package.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(mapping.pull_exports.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(mapping.push_bindings.push_snapshot_hashes, 'lists the live remote comparison set for planning only');
  assert.equal(
    mapping.push_sequence.snapshot_hash_listing,
    'collect the live remote comparison set for planning only',
  );
  assert.equal(
    mapping.push_sequence.dry_run_plan_upload,
    'upload the canonical plan as eligibility evidence and receive a receipt, not a lock',
  );
  assert.equal(
    mapping.push_sequence.mutation_batch_apply,
    'revalidate live remote evidence before every batch and at the storage boundary',
  );
  assert.equal(
    mapping.restart_proof.persisted_evidence.includes('journal_cursor'),
    true,
  );
  assert.equal(mapping.restart_proof.persisted_evidence.includes('journal_row'), true);
  assert.equal(mapping.restart_proof.persisted_evidence.includes('live_hash_page'), true);
  assert.ok(mapping.restart_proof.invariants.includes('dry-run is a receipt, not a lock'));
  assert.ok(
    mapping.restart_proof.invariants.includes(
      'apply must revalidate the live remote before every batch and at the storage boundary',
    ),
  );
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
  const authSessionJournalProof = readJson('fixtures/protocol/push-auth-session-journal-proof.json');
  const authSessionRecoveryContract = readJson('fixtures/protocol/push-auth-session-recovery-contract.json');
  const sessionJournalProof = readJson('fixtures/protocol/push-session-journal-proof.json');
  const recoveryPath = readJson('fixtures/protocol/push-recovery-path.json');
  const recoveryBlocked = readJson('fixtures/protocol/push-recovery-blocked-response.json');
  const inspectContract = readJson('fixtures/protocol/push-recovery-inspect-contract.json');
  const snapshotPageContract = readJson('fixtures/protocol/push-snapshot-hashes-page-contract.json');
  const dryRunApplyContract = readJson('fixtures/protocol/push-dry-run-apply-revalidation-contract.json');
  const productionLadderContract = readJson('fixtures/protocol/push-production-ladder-contract.json');
  const executorTopologyProof = readJson('fixtures/protocol/push-executor-topology-proof.json');

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
  assert.equal(authSessionJournalProof.auth.export_hmac_family, 'hmac-sha256');
  assert.equal(authSessionJournalProof.auth.push_hmac_family, 'hmac-sha256');
  assert.deepEqual(authSessionJournalProof.auth.push_requires, [
    'push session',
    'canonical push signature',
    'idempotency key',
  ]);
  assert.equal(authSessionJournalProof.session.remote_site_id, 'remote-example');
  assert.equal(authSessionJournalProof.journal_row.claim_generation, 4);
  assert.equal(authSessionJournalProof.inspect.mutates, false);
  assert.ok(authSessionJournalProof.required_invariants.includes('inspect is read-only and must come before any mutating recovery mode'));
  assert.equal(authSessionRecoveryContract.contract_id, 'push-auth-session-recovery-contract-one-remote-one-local');
  assert.equal(authSessionRecoveryContract.auth.push_hmac_family, 'hmac-sha256');
  assert.deepEqual(authSessionRecoveryContract.auth.inspect_requires, [
    'HMAC-authenticated request',
    'read-only recovery mode',
  ]);
  assert.equal(authSessionRecoveryContract.session.identity_hash, 'sha256:remote-identity');
  assert.equal(authSessionRecoveryContract.journal_row.storage_guard, 'filesystem-compare-rename');
  assert.equal(authSessionRecoveryContract.recovery.inspect_mode, 'inspect');
  assert.equal(authSessionRecoveryContract.recovery.mutates, false);
  assert.ok(
    authSessionRecoveryContract.recovery.blocked_when.includes(
      'the claim lease has expired and the worker is fenced',
    ),
  );
  assert.ok(authSessionRecoveryContract.required_invariants.includes('fresh live hashes must still be checked before finish, rollback, or auto'));
  assert.equal(sessionJournalProof.live_evidence.same_remote_identity, true);
  assert.equal(sessionJournalProof.journal_fencing.claim_owner, 'worker-17');
  assert.equal(sessionJournalProof.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(recoveryPath.inspect.mutates, false);
  assert.deepEqual(recoveryPath.classification, { old: 2, new: 3, blocked: 1, open: 0 });
  assert.ok(recoveryPath.blocked_cases.includes('the claim lease has expired and the worker is fenced'));
  assert.equal(recoveryBlocked.code, 'RECOVERY_BLOCKED');
  assert.equal(recoveryBlocked.details.batch_id, 'batch-1');
  assert.equal(recoveryBlocked.details.target_state_counts.blocked, 1);
  assert.equal(inspectContract.contract_id, 'push-recovery-inspect-contract-one-remote-one-local');
  assert.equal(inspectContract.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(inspectContract.journal_row.claim_generation, 4);
  assert.equal(inspectContract.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(inspectContract.journal_row.before_hash, 'sha256:base-index');
  assert.equal(inspectContract.journal_row.staged_hash, 'sha256:local-index');
  assert.equal(inspectContract.live_evidence.same_remote_identity, true);
  assert.equal(inspectContract.recovery.inspect_mode, 'inspect');
  assert.equal(inspectContract.recovery.mutates, false);
  assert.ok(inspectContract.required_invariants.includes('inspect is read-only'));
  assert.ok(
    inspectContract.required_invariants.includes(
      'claim generation and lease expiry fence stale workers before mutation',
    ),
  );
  assert.equal(snapshotPageContract.contract_id, 'push-snapshot-hashes-page-contract-one-remote-one-local');
  assert.equal(snapshotPageContract.request.cursor, 'snapcursor:remote-example:1');
  assert.equal(snapshotPageContract.request.batch_size, 2);
  assert.equal(snapshotPageContract.response.cursor, 'snapcursor:remote-example:2');
  assert.equal(snapshotPageContract.response.complete, false);
  assert.equal(snapshotPageContract.response.coverage.complete, true);
  assert.equal(snapshotPageContract.response.coverage.blocked.length, 0);
  assert.ok(
    snapshotPageContract.required_invariants.includes(
      'snapshot hash listing is cursorable for large sites',
    ),
  );
  assert.ok(
    snapshotPageContract.required_invariants.includes(
      'partial listings remain planning evidence, not write authority',
    ),
  );
  assert.equal(dryRunApplyContract.contract_id, 'push-dry-run-apply-revalidation-contract-one-remote-one-local');
  assert.equal(dryRunApplyContract.pull_handoff.exporter, 'scans the merge base and coverage evidence');
  assert.equal(dryRunApplyContract.pull_handoff.preflight, 'binds the persisted pull base to the live remote identity and a short-lived push session');
  assert.equal(dryRunApplyContract.plan_bindings.snapshot_id, 'snap_01j00000000000000000000000');
  assert.equal(dryRunApplyContract.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.ok(dryRunApplyContract.apply_revalidation.rejected_if.includes('the remote changed after the dry-run receipt'));
  assert.equal(dryRunApplyContract.journal_and_recovery.inspect_mode, 'inspect');
  assert.equal(dryRunApplyContract.journal_and_recovery.inspect_is_read_only, true);
  assert.equal(dryRunApplyContract.topology.browser_ingress_port, 8080);
  assert.equal(dryRunApplyContract.topology.proxy_policy, 'local-only');
  assert.equal(dryRunApplyContract.topology.tunnels, 'disallowed');
  assert.ok(dryRunApplyContract.required_invariants.includes('the dry-run receipt never becomes a lock'));
  assert.equal(productionLadderContract.contract_id, 'push-production-ladder-one-remote-one-local');
  assert.equal(
    productionLadderContract.pull_pipeline.persisted_base_package.remote_site_id,
    'remote-example',
  );
  assert.deepEqual(
    productionLadderContract.push_ladder.map((stage) => stage.stage),
    [
      'push_preflight',
      'push_snapshot_hashes',
      'push_plan_dry_run',
      'push_batch_apply',
      'push_journal',
      'push_recover inspect',
      'push_recover auto|finish|rollback',
    ],
  );
  assert.equal(
    productionLadderContract.push_ladder[0].proof,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    productionLadderContract.push_ladder[1].proof,
    'lists the live remote comparison set for planning only',
  );
  assert.equal(
    productionLadderContract.push_ladder[3].proof,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    productionLadderContract.push_ladder[5].proof,
    'starts with inspect and may block when finish or rollback cannot be proven safe',
  );
  assert.equal(productionLadderContract.topology.networking.ingress_port, 8080);
  assert.equal(productionLadderContract.topology.networking.proxy_policy, 'local-only');
  assert.equal(productionLadderContract.topology.networking.tunnels, 'disallowed');
  assert.ok(
    productionLadderContract.required_invariants.includes(
      'authentication must be at least as strict as current Reprint HMAC usage',
    ),
  );
  assert.equal(productionLadderContract.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.deepEqual(
    productionLadderContract.push_ladder.map((stage) => stage.stage),
    [
      'push_preflight',
      'push_snapshot_hashes',
      'push_plan_dry_run',
      'push_batch_apply',
      'push_journal',
      'push_recover inspect',
      'push_recover auto|finish|rollback',
    ],
  );
  assert.ok(
    productionLadderContract.topology.docker.proof.includes(
      'remote-base and remote-changed are the same remote identity at different times',
    ),
  );
  assert.equal(executorTopologyProof.push_pipeline.recovery, 'starts with inspect and allows mutating repair only when the journal and live hashes prove the action');
  assert.equal(executorTopologyProof.topology.networking.ingress_port, 8080);
  assert.equal(executorTopologyProof.topology.networking.proxy_policy, 'local-only');
  assert.equal(executorTopologyProof.topology.networking.tunnels, 'disallowed');
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

test('push topology matrix fixture captures the minimal docker and playground proof shape', () => {
  const matrix = readJson('fixtures/protocol/push-topology-matrix.json');

  assert.equal(matrix.topology_matrix_id, 'push-topology-docker-playground-matrix');
  assert.equal(matrix.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(matrix.pull_pipeline.importer, 'persists the base package as immutable provenance');
  assert.equal(matrix.pull_pipeline.persisted_base_package.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(matrix.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(matrix.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(matrix.apply_revalidation.at_storage_boundary, 'fresh live hashes plus storage-guard proof');
  assert.ok(matrix.apply_revalidation.rejected_if.includes('the remote changed after the dry-run receipt'));
  assert.equal(matrix.recovery_inspect.mode, 'inspect');
  assert.equal(matrix.recovery_inspect.mutates, false);
  assert.deepEqual(matrix.recovery_inspect.requires, [
    'read journal',
    'inspect live hashes',
    'classify finish|rollback|retry|block',
  ]);
  assert.equal(matrix.networking.ingress_port, 8080);
  assert.equal(matrix.networking.proxy_policy, 'local-only');
  assert.equal(matrix.networking.tunnels, 'disallowed');
  assert.equal(matrix.docker.remote_base, 'remote-base');
  assert.equal(matrix.docker.local_edited, 'local-edited');
  assert.equal(matrix.docker.remote_changed, 'remote-changed');
  assert.ok(matrix.docker.proof.includes('one private network'));
  assert.ok(
    matrix.docker.proof.includes(
      'remote-base and remote-changed are the same remote identity at different times',
    ),
  );
  assert.equal(matrix.playground.remote_base, 'remote-base');
  assert.equal(matrix.playground.local_edited, 'local-edited');
  assert.equal(matrix.playground.remote_changed, 'remote-changed');
  assert.ok(matrix.playground.proof.includes('separate disposable blueprints'));
  assert.ok(
    matrix.required_invariants.includes(
      'apply must revalidate the live remote before every batch and at the storage boundary',
    ),
  );
  assert.ok(
    matrix.required_invariants.includes(
      'mutating recovery must still be fenced by fresh live hashes and journal evidence',
    ),
  );
  assert.ok(
    matrix.required_invariants.includes(
      'dry-run and apply are separate remote operations even when the same runner executes both',
    ),
  );
  assert.ok(
    matrix.required_invariants.includes(
      'journal inspect must precede mutating recovery and cannot authorize mutation on its own',
    ),
  );
});

test('push pull mapping fixture preserves the one-way pull-to-push provenance boundary', () => {
  const mapping = readJson('fixtures/protocol/push-pull-mapping.json');
  const executorTopology = readJson('fixtures/protocol/push-executor-topology-proof.json');
  const contract = readJson('fixtures/protocol/push-contract.json');

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
  assert.equal(executorTopology.proof_id, 'push-executor-topology-proof-one-remote-one-local');
  assert.equal(executorTopology.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(
    executorTopology.push_pipeline.preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    executorTopology.push_pipeline.dry_run,
    'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(executorTopology.topology.networking.ingress_port, 8080);
  assert.equal(executorTopology.topology.networking.proxy_policy, 'local-only');
  assert.equal(executorTopology.topology.networking.tunnels, 'disallowed');
  assert.ok(executorTopology.topology.docker.proof.includes('one private network'));
  assert.ok(executorTopology.topology.playground.proof.includes('separate disposable blueprints'));
  assert.ok(
    executorTopology.required_invariants.includes(
      'authentication must be at least as strict as current Reprint HMAC usage',
    ),
  );
  assert.equal(contract.pull_handoff.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    contract.pull_handoff.push_recover,
    'starts with inspect, then finishes, rolls back, or blocks only when journal evidence plus fresh live hashes prove the action',
  );
  assert.equal(
    contract.push_guards.recovery_inspect,
    'must happen before any mutating recovery mode and may block when finish or rollback cannot be proven safe',
  );
  assert.ok(
    contract.required_invariants.includes(
      'authentication must be at least as strict as current Reprint HMAC usage',
    ),
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
