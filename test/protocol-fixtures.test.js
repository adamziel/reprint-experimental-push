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
  const deploymentTopologyContract = readJson('fixtures/protocol/push-deployment-topology-contract.json');
  const executorTopologyProof = readJson('fixtures/protocol/push-executor-topology-proof.json');
  const protocolExtensionContract = readJson('fixtures/protocol/push-protocol-extension-contract.json');
  const preflightContract = readJson('fixtures/protocol/push-preflight-contract.json');
  const authSessionJournalRecoveryContract = readJson(
    'fixtures/protocol/push-auth-session-journal-recovery-contract.json',
  );
  const remoteLivenessTopologyContract = readJson(
    'fixtures/protocol/push-remote-liveness-topology-contract.json',
  );

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
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    contract.pull_handoff.push_journal,
    'reads durable claim, lease, fencing, and recovery evidence without granting write authority',
  );
  assert.equal(
    contract.pull_handoff['push_recover inspect'],
    'starts with inspect and classifies finish, rollback, retry, or block before any mutating repair',
  );
  assert.equal(
    contract.pull_handoff['push_recover auto|finish|rollback'],
    'mutates only when the journal row, lease fence, and fresh live hashes prove the action',
  );
  assert.equal(contract.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(contract.pull_pipeline.importer, 'persists the base package as immutable provenance');
  assert.equal(
    contract.production_shape.remote_snapshot_hash_listing,
    'a cursorable live remote hash listing used only for planning',
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
    contract.push_guards.recovery_inspect,
    'must happen before any mutating recovery mode and may block when finish or rollback cannot be proven safe',
  );
  assert.equal(
    contract.production_shape.dry_run_plan_upload,
    'a canonical plan upload that yields a receipt but never a lock',
  );
  assert.equal(
    contract.production_shape.preflight_session_binding,
    'a short-lived session bound to the persisted pull base and live remote identity',
  );
  assert.equal(
    protocolExtensionContract.push_phases.batch_apply,
    'revalidates fresh live evidence before every batch and at the storage boundary',
  );
  assert.equal(
    protocolExtensionContract.push_phases.recovery_mutate,
    'may mutate only after inspect proves the branch safe with fresh live evidence and the same auth floor as the write path',
  );
  assert.ok(
    protocolExtensionContract.required_invariants.includes(
      'preflight binds the persisted pull base package to one live remote identity and one short-lived push session',
    ),
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
    contract.topology.docker.proof.includes(
      'push preflight binds the persisted pull base to the live remote identity',
    ),
  );
  assert.ok(
    contract.topology.docker.proof.includes(
      'push snapshot hashes stay planning-only',
    ),
  );
  assert.ok(
    contract.topology.docker.proof.includes(
      'push dry-run returns a receipt, not a lock',
    ),
  );
  assert.ok(
    contract.topology.docker.proof.includes(
      'push batch apply revalidates live evidence before every batch and at the storage boundary',
    ),
  );
  assert.ok(
    contract.topology.docker.proof.includes(
      'push recovery inspect happens before any mutating repair',
    ),
  );
  assert.ok(
    contract.topology.playground.proof.includes(
      'separate disposable blueprints',
    ),
  );
  assert.ok(
    contract.topology.playground.proof.includes(
      'push preflight binds the persisted pull base to the live remote identity',
    ),
  );
  assert.ok(
    contract.topology.playground.proof.includes(
      'push recovery inspect happens before any mutating repair',
    ),
  );
  assert.equal(contract.topology.docker.remote_base, 'remote-base');
  assert.equal(contract.topology.docker.local_edited, 'local-edited');
  assert.equal(contract.topology.docker.remote_changed, 'remote-changed');
  assert.equal(contract.topology.playground.remote_base, 'remote-base');
  assert.equal(contract.topology.playground.local_edited, 'local-edited');
  assert.equal(contract.topology.playground.remote_changed, 'remote-changed');
  assert.equal(protocolExtensionContract.contract_id, 'push-protocol-extension-production-contract');
  assert.deepEqual(protocolExtensionContract.push_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_snapshot_hashes,
    'performs the remote snapshot hash listing for planning only and never becomes write authority',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_plan_dry_run,
    'uploads the canonical dry-run plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_batch_apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping['push_recover inspect'],
    'starts with inspect and classifies finish, rollback, retry, or block before any mutating repair',
  );
  assert.equal(protocolExtensionContract.push_guards.auth_floor, 'at least as strict as current Reprint HMAC usage');
  assert.equal(protocolExtensionContract.topology.same_remote_identity, true);
  assert.equal(protocolExtensionContract.topology.remote_base, 'remote-base');
  assert.equal(protocolExtensionContract.topology.local_edited, 'local-edited');
  assert.equal(protocolExtensionContract.topology.remote_changed, 'remote-changed');
  assert.equal(protocolExtensionContract.topology.runner, 'runner');
  assert.equal(protocolExtensionContract.lab_topology.remote_base.identity, 'remote-example');
  assert.equal(protocolExtensionContract.lab_topology.local_edited.identity, 'local-dev-site');
  assert.equal(protocolExtensionContract.lab_topology.remote_changed.identity, 'remote-example');
  assert.equal(remoteLivenessTopologyContract.contract_id, 'push-remote-liveness-topology-contract');
  assert.deepEqual(remoteLivenessTopologyContract.push_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(
    remoteLivenessTopologyContract.push_guards.remote_snapshot_hash_listing,
    'planning evidence only and never write authority',
  );
  assert.equal(
    remoteLivenessTopologyContract.push_guards.apply_revalidation,
    'refreshes fresh live evidence before every batch and at the storage boundary',
  );
  assert.equal(remoteLivenessTopologyContract.topology.networking.ingress_port, 8080);
  assert.equal(remoteLivenessTopologyContract.topology.networking.proxy_policy, 'local-only');
  assert.ok(
    remoteLivenessTopologyContract.topology.docker.proof.includes(
      'dry-run and apply remain separate remote calls',
    ),
  );
  assert.ok(
    remoteLivenessTopologyContract.topology.playground.proof.includes(
      'browser-visible inspection stays on the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.equal(
    remoteLivenessTopologyContract.pull_to_push_mapping.push_batch_apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.ok(
    remoteLivenessTopologyContract.required_invariants.includes(
      'one remote source site, one imported local site, and one drift witness are enough to prove the production topology',
    ),
  );
  assert.equal(preflightContract.contract_id, 'push-preflight-contract-one-remote-one-local');
  assert.equal(preflightContract.pull_provenance.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(preflightContract.pull_provenance.remote_site_id, 'remote-example');
  assert.equal(preflightContract.live_binding.remote_site_id, 'remote-example');
  assert.deepEqual(preflightContract.live_binding.requested_scope, ['files', 'database', 'plugins', 'themes']);
  assert.equal(preflightContract.topology.remote_base, 'remote-base');
  assert.equal(preflightContract.topology.local_edited, 'local-edited');
  assert.equal(preflightContract.topology.remote_changed, 'remote-changed');
  assert.equal(preflightContract.topology.same_remote_identity, true);
  assert.equal(preflightContract.topology.docker_ingress_port, 8080);
  assert.ok(
    preflightContract.required_invariants.includes(
      'preflight binds one immutable pull base package to one live remote identity and one short-lived session',
    ),
  );
  assert.equal(topologyMatrix.push_pipeline.preflight, 'binds the persisted pull base to the live remote identity and a short-lived push session');
  assert.equal(topologyMatrix.push_pipeline.snapshot_hash_listing, 'returns the live remote comparison set for planning only');
  assert.equal(topologyMatrix.push_pipeline.dry_run_plan_upload, 'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock');
  assert.equal(topologyMatrix.push_pipeline.mutation_batch_apply, 'revalidates fresh live evidence before every batch and again at the storage boundary');
  assert.equal(topologyMatrix.push_pipeline.journal_inspect, 'reads durable evidence without authorizing mutation');
  assert.equal(topologyMatrix.push_pipeline.recovery_inspect, 'starts with inspect and classifies finish, rollback, retry, or block without mutation');
  assert.equal(topologyMatrix.push_pipeline.recovery, 'allows mutating repair only when the journal row, lease fence, and fresh live hashes prove the action');
  assert.equal(topologyMatrix.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(topologyMatrix.apply_revalidation.at_storage_boundary, 'fresh live hashes plus storage-guard proof');
  assert.equal(topologyMatrix.remote_liveness.snapshot_hash_listing, 'planning evidence only and never write authority');
  assert.equal(topologyMatrix.remote_liveness.dry_run, 'eligibility evidence only and never a lock');
  assert.equal(
    topologyMatrix.remote_liveness.apply,
    'a separate remote stage that revalidates before every batch and at the storage boundary',
  );
  assert.equal(topologyMatrix.recovery_inspect.authorization, 'read-only evidence reader that never authorizes mutation by itself');
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
  assert.equal(topologyMatrix.journal_fencing.claim_generation, 4);
  assert.equal(topologyMatrix.journal_fencing.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(topologyMatrix.journal_fencing.storage_guard, 'filesystem-compare-rename');
  assert.ok(
    topologyMatrix.journal_fencing.proof.includes(
      'mutating recovery is fenced until inspect reads the journal row and fresh live hashes',
    ),
  );
  assert.equal(topologyMatrix.roles.remote_base, 'one remote source site that seeds the persisted pull base');
  assert.equal(topologyMatrix.roles.local_edited, 'one imported local site with user edits');
  assert.equal(topologyMatrix.roles.remote_changed, 'the same remote site observed later after independent drift');
  assert.equal(topologyMatrix.roles.runner, 'the only process allowed to preflight, plan, upload, inspect, revalidate, and recover');
  assert.equal(topologyMatrix.networking.ingress_port, 8080);
  assert.equal(topologyMatrix.networking.proxy_policy, 'local-only');
  assert.equal(topologyMatrix.networking.tunnels, 'disallowed');
  assert.equal(topologyMatrix.docker.remote_base, 'remote-base');
  assert.equal(topologyMatrix.docker.local_edited, 'local-edited');
  assert.equal(topologyMatrix.docker.remote_changed, 'remote-changed');
  assert.equal(topologyMatrix.playground.remote_base, 'remote-base');
  assert.equal(topologyMatrix.playground.local_edited, 'local-edited');
  assert.equal(topologyMatrix.playground.remote_changed, 'remote-changed');
  assert.ok(
    topologyMatrix.docker.proof.includes(
      'push preflight mints one short-lived session bound to the persisted base and live remote identity',
    ),
  );
  assert.ok(
    topologyMatrix.playground.proof.includes(
      'push preflight, dry-run, apply, journal, and recovery use the same route names as Docker',
    ),
  );
  assert.equal(topologyMatrix.lab_topology.remote_base.identity, 'remote-example');
  assert.equal(topologyMatrix.lab_topology.local_edited.identity, 'local-dev-site');
  assert.equal(topologyMatrix.lab_topology.remote_changed.identity, 'remote-example');
  assert.equal(topologyMatrix.lab_topology.live_drift.between[0], 'remote_base');
  assert.equal(topologyMatrix.lab_topology.live_drift.proof[0], 'remote-base and remote-changed are the same remote identity observed at different times');
  assert.equal(protocolExtensionContract.contract_id, 'push-protocol-extension-production-contract');
  assert.equal(
    protocolExtensionContract.purpose,
    'compact end-to-end proof for preflight, remote snapshot hash listing, dry-run plan upload, batched apply, journal inspect, and inspect-first recovery with explicit pull provenance mapping',
  );
  assert.equal(protocolExtensionContract.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(protocolExtensionContract.pull_pipeline.importer, 'persists the base package as immutable provenance');
  assert.equal(
    protocolExtensionContract.bridge_rule,
    'the importer-owned base package is immutable provenance for planning, apply, journal, and recovery',
  );
  assert.deepEqual(protocolExtensionContract.push_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(
    protocolExtensionContract.bridge_rule,
    'the importer-owned base package is immutable provenance for planning, apply, journal, and recovery',
  );
  assert.ok(
    protocolExtensionContract.topology.proof.includes(
      'pull exporter/importer establish the immutable base package before push',
    ),
  );
  assert.deepEqual(protocolExtensionContract.push_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_snapshot_hashes,
    'performs the remote snapshot hash listing for planning only and never becomes write authority',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_plan_dry_run,
    'uploads the canonical dry-run plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_batch_apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping.push_journal,
    'reads durable evidence without authorizing mutation',
  );
  assert.equal(
    protocolExtensionContract.pull_to_push_mapping['push_recover inspect'],
    'starts with inspect and classifies finish, rollback, retry, or block before any mutating repair',
  );
  assert.equal(
    protocolExtensionContract.push_guards.remote_liveness,
    'dry-run and apply are separate remote operations',
  );
  assert.equal(
    protocolExtensionContract.push_guards.apply,
    'must revalidate the live remote before every batch and at the storage boundary',
  );
  assert.equal(protocolExtensionContract.push_guards.auth_floor, 'at least as strict as current Reprint HMAC usage');
  assert.equal(
    protocolExtensionContract.auth_session_recovery_proofs.auth_session_fencing,
    'fixtures/protocol/push-auth-session-fencing-contract.json',
  );
  assert.equal(
    protocolExtensionContract.auth_session_recovery_proofs.auth_session_recovery,
    'fixtures/protocol/push-auth-session-recovery-contract.json',
  );
  assert.equal(
    protocolExtensionContract.auth_session_recovery_proofs.recovery_inspect,
    'fixtures/protocol/push-recovery-inspect-contract.json',
  );
  assert.equal(
    authSessionJournalRecoveryContract.contract_id,
    'push-auth-session-journal-recovery-contract-one-remote-one-local',
  );
  assert.equal(authSessionJournalRecoveryContract.auth.push_hmac_family, 'hmac-sha256');
  assert.equal(authSessionJournalRecoveryContract.session.remote_site_id, 'remote-example');
  assert.equal(authSessionJournalRecoveryContract.journal_row.claim_generation, 4);
  assert.equal(authSessionJournalRecoveryContract.journal_row.storage_guard, 'filesystem-compare-rename');
  assert.equal(authSessionJournalRecoveryContract.recovery_inspect.mode, 'inspect');
  assert.ok(
    authSessionJournalRecoveryContract.recovery_inspect.blocked_when.includes(
      'the claim lease has expired and the worker is fenced',
    ),
  );
  assert.equal(protocolExtensionContract.topology.networking.ingress_port, 8080);
  assert.equal(protocolExtensionContract.topology.networking.proxy_policy, 'local-only');
  assert.equal(protocolExtensionContract.topology.networking.tunnels, 'disallowed');
  assert.equal(protocolExtensionContract.topology.same_remote_identity, true);
  assert.ok(
    protocolExtensionContract.topology.proof.includes(
      'runner owns preflight, remote snapshot hash listing, dry-run plan upload, batch apply, journal inspect, and recovery',
    ),
  );
  assert.ok(
    protocolExtensionContract.topology.proof.includes(
      'remote-base and remote-changed are the same remote identity observed at different times',
    ),
  );
  assert.ok(
    protocolExtensionContract.topology.proof.includes(
      'recovery inspect happens before any mutating repair',
    ),
  );
  assert.ok(
    protocolExtensionContract.topology.docker.proof.includes(
      'apply revalidates fresh live evidence before every batch and at the storage boundary',
    ),
  );
  assert.ok(
    protocolExtensionContract.topology.docker.proof.includes(
      'remote snapshot hash listing stays planning-only',
    ),
  );
  assert.ok(
    protocolExtensionContract.topology.playground.proof.includes(
      'push preflight, dry-run, apply, journal, and recovery use the same route names as Docker',
    ),
  );
  assert.equal(executorTopologyProof.proof_id, 'push-executor-topology-proof-one-remote-one-local');
  assert.equal(
    executorTopologyProof.purpose,
    'compact proof that the executor keeps pull provenance, push staging, and browser ingress on one production-shaped topology',
  );
  assert.equal(
    executorTopologyProof.pull_pipeline.persisted_base_package.base_manifest_id,
    'pull-2026-05-24T00:00:00Z',
  );
  assert.equal(
    executorTopologyProof.pull_pipeline.persisted_base_package.base_manifest_hash,
    'sha256:pull-base-manifest',
  );
  assert.equal(
    executorTopologyProof.pull_pipeline.persisted_base_package.base_coverage_hash,
    'sha256:pull-base-coverage',
  );
  assert.equal(executorTopologyProof.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.preflight,
    'binds that persisted base package to the live remote identity and a short-lived session',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.snapshot_hashes,
    'lists the live remote comparison set for planning only',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.dry_run,
    'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.journal,
    'reads durable evidence without authorizing mutation',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.recovery_inspect,
    'starts with inspect and classifies finish, rollback, retry, or block without mutation',
  );
  assert.equal(
    executorTopologyProof.pull_to_push_mapping.recovery,
    'allows mutating repair only when the journal row, lease fence, and fresh live hashes prove the action',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.snapshot_hashes,
    'returns the live remote comparison set for planning only and never acts as write authority',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.dry_run,
    'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.journal,
    'reads durable evidence without authorizing mutation',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.recovery_inspect,
    'starts with inspect and classifies finish, rollback, retry, or block without mutation',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.recovery,
    'allows mutating repair only when the journal row, lease fence, and fresh live hashes prove the action',
  );
  assert.ok(executorTopologyProof.required_invariants.includes('dry-run and apply are separate remote operations'));
  assert.ok(
    executorTopologyProof.required_invariants.includes(
      'remote snapshot hash listing is planning evidence, not write authority',
    ),
  );
  assert.ok(
    executorTopologyProof.required_invariants.includes(
      'journal inspection is read-only and never authorizes mutation by itself',
    ),
  );
  assert.ok(
    executorTopologyProof.required_invariants.includes(
      'recovery must begin with inspect before any mutating repair',
    ),
  );
  assert.ok(
    executorTopologyProof.required_invariants.includes(
      'pull exporter/importer establish the immutable base package before any push stage runs',
    ),
  );
  assert.equal(protocolExtensionContract.lab_topology.remote_base.identity, 'remote-example');
  assert.equal(protocolExtensionContract.lab_topology.local_edited.identity, 'local-dev-site');
  assert.equal(protocolExtensionContract.lab_topology.remote_changed.identity, 'remote-example');
  assert.equal(protocolExtensionContract.lab_topology.remote_identity, 'remote-example');
  assert.equal(protocolExtensionContract.lab_topology.live_drift.between[0], 'remote_base');
  assert.ok(
    protocolExtensionContract.lab_topology.live_drift.proof.includes(
      'dry-run and apply remain separate remote calls',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'local-edited is the imported local site with user edits',
    ),
  );
  assert.ok(
    deploymentTopologyContract.deployment.docker.proof.includes(
      'browser-visible inspection uses the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.ok(
    deploymentTopologyContract.deployment.playground.proof.includes(
      'browser-visible inspection uses the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.equal(deploymentTopologyContract.lab_topology.remote_base.identity, 'remote-example');
  assert.equal(deploymentTopologyContract.lab_topology.local_edited.identity, 'local-dev-site');
  assert.equal(deploymentTopologyContract.lab_topology.remote_changed.identity, 'remote-example');
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'local-edited is the imported local site with user edits',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'remote-base seeds the persisted pull base',
    ),
  );
  assert.ok(
    deploymentTopologyContract.deployment.playground.proof.includes(
      'push preflight, dry-run, apply, journal, and recovery use the same route names as Docker',
    ),
  );
  assert.ok(
    topologyMatrix.docker.proof.includes(
      'push preflight mints one short-lived session bound to the persisted base and live remote identity',
    ),
  );
  assert.ok(
    topologyMatrix.docker.proof.includes(
      'recovery inspect happens before any mutating repair',
    ),
  );
  assert.ok(
    topologyMatrix.playground.proof.includes(
      'push preflight, dry-run, apply, journal, and recovery use the same route names as Docker',
    ),
  );
  assert.ok(
    topologyMatrix.required_invariants.includes(
      'push preflight must mint a short-lived session bound to one remote identity and one persisted pull base',
    ),
  );
  assert.ok(
    topologyMatrix.drift_proof.includes(
      'exporter/importer establish the immutable pull base package',
    ),
  );
  assert.ok(
    topologyMatrix.required_invariants.includes(
      'pull exporter/importer establish the immutable base package before push',
    ),
  );
  assert.equal(
    readJson('fixtures/protocol/push-production-ladder-contract.json').remote_liveness.dry_run,
    'uploads an eligibility receipt only and never reserves remote state',
  );
  assert.equal(
    readJson('fixtures/protocol/push-production-ladder-contract.json').remote_liveness.apply,
    'revalidates the live remote before every batch and again at the storage boundary',
  );
  assert.equal(
    readJson('fixtures/protocol/push-production-ladder-contract.json').remote_liveness.recovery_mutate,
    'requires fresh live hashes plus journal evidence',
  );
  assert.equal(
    readJson('fixtures/protocol/push-recovery-inspect-contract.json').session.remote_site_id,
    'remote-example',
  );
  assert.equal(readJson('fixtures/protocol/push-recovery-inspect-contract.json').journal_fence.claim_generation, 4);
  assert.equal(readJson('fixtures/protocol/push-recovery-inspect-contract.json').journal_fence.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(
    readJson('fixtures/protocol/push-recovery-inspect-contract.json').live_evidence.same_remote_identity,
    true,
  );
  assert.equal(
    readJson('fixtures/protocol/push-recovery-inspect-contract.json').recovery.inspect_mode,
    'inspect',
  );
  assert.equal(
    readJson('fixtures/protocol/push-recovery-inspect-contract.json').journal_fence.storage_guard,
    'filesystem-compare-rename',
  );
  assert.ok(
    readJson('fixtures/protocol/push-recovery-inspect-contract.json').required_invariants.includes(
      'inspect is read-only',
    ),
  );
  assert.ok(
    readJson('fixtures/protocol/push-auth-session-recovery-contract.json').auth.inspect_requires.includes(
      'read-only recovery mode',
    ),
  );
  assert.ok(
    readJson('fixtures/protocol/push-auth-session-recovery-contract.json').required_invariants.includes(
      'push auth must be at least as strict as the current export HMAC family',
    ),
  );
  assert.ok(
    readJson('fixtures/protocol/push-auth-session-recovery-contract.json').required_invariants.includes(
      'inspect is read-only and must come before any mutating recovery mode',
    ),
  );
  const sessionJournalProof = readJson('fixtures/protocol/push-session-journal-proof.json');
  assert.equal(sessionJournalProof.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(sessionJournalProof.journal_fencing.claim_generation, 4);
  assert.equal(sessionJournalProof.journal_fencing.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(sessionJournalProof.recovery.inspect_mode, 'inspect');
  assert.ok(
    sessionJournalProof.recovery.blocked_when.includes('the journal cannot prove a safe finish or rollback'),
  );
  assert.ok(
    sessionJournalProof.required_invariants.includes(
      'claim generation and lease expiry fence stale workers before mutation',
    ),
  );
  assert.equal(
    readJson('fixtures/protocol/push-executor-topology-proof.json').pull_to_push_mapping.preflight,
    'binds that persisted base package to the live remote identity and a short-lived session',
  );
  const topology = readJson('fixtures/protocol/push-topology.json');
  assert.equal(topology.topology_id, 'push-topology-one-remote-one-local');
  assert.equal(topology.remote_identity.site_id, 'remote-example');
  assert.equal(topology.remote_identity.same_remote_identity, true);
  assert.equal(topology.roles.remote_base.examples.docker, 'remote-base');
  assert.equal(topology.roles.local_edited.examples.playground, 'local-edited');
  assert.equal(topology.roles.runner.examples.playground, 'local test process');
  assert.ok(
    topology.docker.shape.includes(
      'push_journal and push_recover inspect are read-only evidence readers, while mutating recovery modes require fresh live proof',
    ),
  );
  assert.ok(
    topology.playground.shape.includes(
      'use only the sandbox-provided 8080 ingress through a local-only proxy when browser-visible inspection is needed',
    ),
  );
  assert.equal(deploymentTopologyContract.contract_id, 'push-deployment-topology-contract');
  assert.equal(deploymentTopologyContract.topology.remote_base, 'remote-base');
  assert.equal(deploymentTopologyContract.topology.local_edited, 'local-edited');
  assert.equal(deploymentTopologyContract.topology.remote_changed, 'remote-changed');
  assert.equal(deploymentTopologyContract.topology.runner, 'runner');
  assert.equal(deploymentTopologyContract.topology.same_remote_identity, true);
  assert.equal(deploymentTopologyContract.topology.proof[0], 'remote-base seeds the persisted pull base');
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'dry-run and apply remain separate remote operations',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'apply revalidates fresh live evidence before every batch and at the storage boundary',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'journal inspect stays read-only',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'recovery starts with inspect before any mutating repair',
    ),
  );
  assert.ok(
    deploymentTopologyContract.topology.proof.includes(
      'remote-changed is the same remote identity observed later after drift',
    ),
  );
  assert.equal(deploymentTopologyContract.deployment.docker.ingress_port, 8080);
  assert.equal(deploymentTopologyContract.deployment.docker.proxy_policy, 'local-only');
  assert.equal(deploymentTopologyContract.deployment.docker.tunnels, 'disallowed');
  assert.ok(
    deploymentTopologyContract.deployment.docker.proof.includes(
      'browser-visible inspection uses the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.ok(
    deploymentTopologyContract.deployment.playground.proof.includes(
      'push preflight, dry-run, apply, journal, and recovery use the same route names as Docker',
    ),
  );
  assert.equal(deploymentTopologyContract.pull_to_push_mapping.exporter, 'scans the merge base and coverage evidence');
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.importer,
    'persists the base package as immutable provenance',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.preflight,
    'binds that persisted base package to the live remote identity and a short-lived session',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.snapshot_hashes,
    'lists the live remote comparison set for planning only',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.dry_run,
    'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.journal,
    'reads durable evidence without authorizing mutation',
  );
  assert.equal(
    deploymentTopologyContract.pull_to_push_mapping.recovery_inspect,
    'starts with inspect and classifies finish, rollback, retry, or block without mutation',
  );
  assert.ok(
    deploymentTopologyContract.required_invariants.includes(
      'browser-visible inspection stays on the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.ok(
    readJson('fixtures/protocol/push-executor-topology-proof.json').required_invariants.includes(
      'pull exporter/importer are the provenance source for push preflight, dry-run, apply, journal, and recovery',
    ),
  );
  const authHeaders = readJson('fixtures/protocol/push-auth-headers.json');
  assert.equal(authHeaders.read_only_request_headers['X-Auth-Signature'], 'hmac-sha256:export-auth-signature');
  assert.ok(Object.hasOwn(authHeaders.dry_run_apply_or_mutating_recovery_headers, 'X-Reprint-Push-Session'));
  assert.ok(authHeaders.canonical_push_signature_parts.includes('push_session'));
  const authSessionFencing = readJson('fixtures/protocol/push-auth-session-fencing-contract.json');
  assert.equal(authSessionFencing.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(authSessionFencing.journal_row.claim_generation, 4);
  assert.equal(authSessionFencing.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(authSessionFencing.journal_row.storage_guard, 'filesystem-compare-rename');
  assert.ok(
    authSessionFencing.required_invariants.includes(
      'claim generation and lease expiry fence stale workers before mutation',
    ),
  );
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
  assert.equal(
    mapping.push_bindings.push_preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
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
  assert.ok(mapping.restart_proof.persisted_evidence.includes('push_session'));
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
  const authSessionFencingContract = readJson('fixtures/protocol/push-auth-session-fencing-contract.json');
  const authSessionRecoveryContract = readJson('fixtures/protocol/push-auth-session-recovery-contract.json');
  const sessionJournalProof = readJson('fixtures/protocol/push-session-journal-proof.json');
  const recoveryPath = readJson('fixtures/protocol/push-recovery-path.json');
  const recoveryBlocked = readJson('fixtures/protocol/push-recovery-blocked-response.json');
  const inspectContract = readJson('fixtures/protocol/push-recovery-inspect-contract.json');
  const snapshotPageContract = readJson('fixtures/protocol/push-snapshot-hashes-page-contract.json');
  const dryRunApplyContract = readJson('fixtures/protocol/push-dry-run-apply-revalidation-contract.json');
  const productionLadderContract = readJson('fixtures/protocol/push-production-ladder-contract.json');
  const executorTopologyProof = readJson('fixtures/protocol/push-executor-topology-proof.json');
  const recoveryRevalidationContract = readJson('fixtures/protocol/push-recovery-revalidation-contract.json');
  const recoveryBoundaryContract = readJson('fixtures/protocol/push-recovery-boundary-contract.json');
  const remoteLivenessContract = readJson('fixtures/protocol/push-remote-liveness-contract.json');
  const pullToTopologyContract = readJson('fixtures/protocol/push-pull-to-topology-contract.json');

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
  assert.equal(snapshotPageContract.contract_id, 'push-snapshot-hashes-page-contract-one-remote-one-local');
  assert.equal(snapshotPageContract.request.push_session, 'psh_01j00000000000000000000000');
  assert.equal(snapshotPageContract.request.batch_size, 2);
  assert.equal(snapshotPageContract.response.complete, false);
  assert.equal(snapshotPageContract.response.coverage.complete, true);
  assert.equal(snapshotPageContract.response.resources[0].storage_guard, 'filesystem-compare-rename');
  assert.ok(snapshotPageContract.required_invariants.includes('snapshot hash listing is cursorable for large sites'));
  assert.ok(snapshotPageContract.required_invariants.includes('partial listings remain planning evidence, not write authority'));
  assert.equal(dryRunApplyContract.contract_id, 'push-dry-run-apply-revalidation-contract-one-remote-one-local');
  assert.equal(dryRunApplyContract.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(dryRunApplyContract.apply_revalidation.at_storage_boundary, 'filesystem-compare-rename and mysql-transaction-row-lock');
  assert.ok(dryRunApplyContract.required_invariants.includes('the dry-run receipt never becomes a lock'));
  assert.ok(dryRunApplyContract.required_invariants.includes('the remote may drift between dry-run and apply'));
  assert.equal(recoveryRevalidationContract.contract_id, 'push-recovery-revalidation-contract-one-remote-one-local');
  assert.equal(
    recoveryRevalidationContract.purpose,
    'proves dry-run stays separate from apply and inspect-first recovery still depends on fresh live hashes',
  );
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.recovery.inspect_mode, 'inspect');
  assert.ok(recoveryRevalidationContract.stale_to_live_flow.recovery.requires.includes('read journal'));
  assert.ok(recoveryRevalidationContract.stale_to_live_flow.recovery.requires.includes('inspect live hashes'));
  assert.equal(
    recoveryRevalidationContract.stale_to_live_flow.apply_revalidation.at_storage_boundary,
    'fresh live hashes plus storage-guard proof',
  );
  assert.ok(recoveryRevalidationContract.required_invariants.includes('inspect is read-only and must happen before any mutating recovery'));
  assert.ok(
    recoveryRevalidationContract.required_invariants.includes(
      'apply must revalidate the live remote before every batch and at the storage boundary',
    ),
  );
  assert.ok(
    recoveryRevalidationContract.required_invariants.includes(
      'auth must be at least as strict as current Reprint HMAC usage',
    ),
  );
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.apply_revalidation.rejects_without_fresh_live_evidence, true);
  assert.equal(recoveryBoundaryContract.contract_id, 'push-recovery-boundary-contract-one-remote-one-local');
  assert.deepEqual(recoveryBoundaryContract.recovery_sequence, [
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(recoveryBoundaryContract.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(
    recoveryBoundaryContract.recovery_boundary.inspect,
    'classifies finish, rollback, retry, or block before any mutating repair',
  );
  assert.equal(
    recoveryBoundaryContract.recovery_boundary.mutate,
    'may run only after inspect and fresh live hashes prove the action safe',
  );
  assert.equal(recoveryBoundaryContract.liveness_boundary.dry_run_and_apply, 'remain separate remote operations');
  assert.equal(recoveryBoundaryContract.auth_boundary.floor, 'at least as strict as current Reprint HMAC usage');
  assert.equal(recoveryBoundaryContract.topology.browser_ingress_port, 8080);
  assert.equal(recoveryBoundaryContract.topology.proxy_policy, 'local-only');
  assert.ok(
    recoveryBoundaryContract.required_invariants.includes(
      'journal inspection is read-only and never authorizes mutation by itself',
    ),
  );
  assert.equal(remoteLivenessContract.contract_id, 'push-remote-liveness-contract');
  assert.equal(remoteLivenessContract.push_liveness.preflight, 'binds the persisted pull base to the live remote identity and a short-lived push session');
  assert.equal(remoteLivenessContract.push_liveness.snapshot_hash_listing, 'returns live remote comparison evidence for planning only');
  assert.equal(remoteLivenessContract.push_liveness.dry_run, 'uploads eligibility evidence and returns a receipt, not a lock');
  assert.equal(remoteLivenessContract.push_liveness.apply, 'revalidates live evidence before every batch and again at the storage boundary');
  assert.equal(remoteLivenessContract.push_liveness.recovery_inspect, 'starts with inspect and classifies finish, rollback, retry, or block before any mutating repair');
  assert.ok(remoteLivenessContract.required_invariants.includes('dry-run and apply are separate remote operations'));
  assert.ok(remoteLivenessContract.required_invariants.includes('journal inspection is read-only and never authorizes mutation by itself'));
  assert.ok(remoteLivenessContract.required_invariants.includes('authentication must be at least as strict as current Reprint HMAC usage'));
  assert.equal(pullToTopologyContract.contract_id, 'push-pull-to-topology-contract-one-remote-one-local');
  assert.equal(pullToTopologyContract.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.deepEqual(pullToTopologyContract.push_sequence, [
    'push_preflight',
    'push_snapshot_hashes',
    'push_plan_dry_run',
    'push_batch_apply',
    'push_journal',
    'push_recover inspect',
    'push_recover auto|finish|rollback',
  ]);
  assert.equal(pullToTopologyContract.push_guards.remote_liveness, 'dry-run and apply are separate remote operations');
  assert.equal(pullToTopologyContract.push_guards.apply, 'must revalidate the live remote before every batch and at the storage boundary');
  assert.equal(pullToTopologyContract.push_guards.auth_floor, 'at least as strict as current Reprint HMAC usage');
  assert.equal(pullToTopologyContract.topology.networking.ingress_port, 8080);
  assert.equal(pullToTopologyContract.topology.networking.proxy_policy, 'local-only');
  assert.equal(pullToTopologyContract.topology.networking.tunnels, 'disallowed');
  assert.ok(pullToTopologyContract.topology.proof.includes('remote-base seeds the persisted pull base'));
  assert.ok(
    pullToTopologyContract.topology.proof.includes(
      'remote-base and remote-changed are the same remote identity observed at different times',
    ),
  );
  assert.ok(
    pullToTopologyContract.topology.proof.includes(
      'push recovery inspect happens before any mutating repair',
    ),
  );
  assert.ok(
    pullToTopologyContract.required_invariants.includes(
      'pull exporter/importer establish the immutable base package before push',
    ),
  );
  assert.equal(authSessionRecoveryContract.recovery.inspect_mode, 'inspect');
  assert.equal(authSessionRecoveryContract.recovery.mutates, false);
  assert.ok(authSessionRecoveryContract.recovery.blocked_when.includes('fresh live hashes do not match the journaled target'));
  assert.ok(authSessionRecoveryContract.recovery.blocked_when.includes('the journal cannot prove a safe finish or rollback'));
  assert.ok(authSessionRecoveryContract.recovery.blocked_when.includes('the claim lease has expired and the worker is fenced'));
  assert.ok(authSessionRecoveryContract.required_invariants.includes('inspect is read-only and must come before any mutating recovery mode'));
  assert.equal(authSessionFencingContract.contract_id, 'push-auth-session-fencing-contract-one-remote-one-local');
  assert.equal(authSessionFencingContract.auth.push_hmac_family, 'hmac-sha256');
  assert.deepEqual(authSessionFencingContract.auth.mutating_requires, [
    'push session',
    'canonical push signature',
    'idempotency key',
  ]);
  assert.equal(authSessionFencingContract.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(authSessionFencingContract.journal_row.claim_generation, 4);
  assert.equal(authSessionFencingContract.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(authSessionFencingContract.recovery.inspect_mode, 'inspect');
  assert.equal(authSessionFencingContract.recovery.mutates, false);
  assert.ok(
    authSessionFencingContract.recovery.blocked_when.includes(
      'the claim lease has expired and the worker is fenced',
    ),
  );
  assert.ok(
    authSessionFencingContract.required_invariants.includes(
      'claim generation and lease expiry fence stale workers before mutation',
    ),
  );
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
  assert.deepEqual(authSessionRecoveryContract.auth.push_requires, [
    'push session',
    'canonical push signature',
    'idempotency key',
  ]);
  assert.deepEqual(authSessionRecoveryContract.auth.inspect_requires, [
    'HMAC-authenticated request',
    'read-only recovery mode',
  ]);
  assert.equal(authSessionRecoveryContract.session.identity_hash, 'sha256:remote-identity');
  assert.equal(authSessionRecoveryContract.session.expires_at, '2026-05-24T00:10:00Z');
  assert.equal(authSessionRecoveryContract.journal_row.claim_generation, 4);
  assert.equal(authSessionRecoveryContract.journal_row.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(authSessionRecoveryContract.journal_row.storage_guard, 'filesystem-compare-rename');
  assert.equal(authSessionRecoveryContract.recovery.inspect_mode, 'inspect');
  assert.equal(authSessionRecoveryContract.recovery.mutates, false);
  assert.ok(
    authSessionRecoveryContract.recovery.blocked_when.includes(
      'fresh live hashes do not match the journaled target',
    ),
  );
  assert.ok(
    authSessionRecoveryContract.recovery.blocked_when.includes(
      'the claim lease has expired and the worker is fenced',
    ),
  );
  assert.ok(authSessionRecoveryContract.required_invariants.includes('fresh live hashes must still be checked before finish, rollback, or auto'));
  assert.equal(sessionJournalProof.live_evidence.same_remote_identity, true);
  assert.equal(sessionJournalProof.session.push_session, 'psh_01j00000000000000000000000');
  assert.equal(sessionJournalProof.session.remote_site_id, 'remote-example');
  assert.equal(sessionJournalProof.session.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(sessionJournalProof.journal_fencing.claim_owner, 'worker-17');
  assert.equal(sessionJournalProof.journal_fencing.claim_generation, 4);
  assert.equal(sessionJournalProof.journal_fencing.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.ok(sessionJournalProof.journal_fencing.required_proof.includes('claim generation fences older workers'));
  assert.ok(sessionJournalProof.journal_fencing.required_proof.includes('lease expiry stops stale apply replay'));
  assert.equal(sessionJournalProof.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(sessionJournalProof.apply_revalidation.at_storage_boundary, 'fresh live hashes');
  assert.ok(sessionJournalProof.recovery.blocked_when.includes('fresh live hashes do not match the journaled target'));
  assert.ok(sessionJournalProof.required_invariants.includes('journal inspection is read-only and inspect must come before mutating recovery'));
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
  assert.equal(inspectContract.journal_fence.claim_owner, 'worker-17');
  assert.equal(inspectContract.journal_fence.claim_generation, 4);
  assert.equal(inspectContract.journal_fence.lease_expires_at, '2026-05-24T00:00:09Z');
  assert.equal(inspectContract.journal_fence.storage_guard, 'filesystem-compare-rename');
  assert.equal(inspectContract.live_classification.blocked, 1);
  assert.equal(inspectContract.recovery.inspect_mode, 'inspect');
  assert.equal(inspectContract.recovery.mutates, false);
  assert.ok(inspectContract.required_invariants.includes('inspect is read-only'));
  assert.ok(
    inspectContract.required_invariants.includes(
      'claim generation and lease expiry fence stale workers before mutation',
    ),
  );
  assert.ok(
    inspectContract.required_invariants.includes(
      'inspect reads the journal row and live hashes before classifying finish, rollback, retry, or block',
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
  assert.equal(recoveryRevalidationContract.contract_id, 'push-recovery-revalidation-contract-one-remote-one-local');
  assert.equal(recoveryRevalidationContract.pull_handoff.dry_run, 'uploads the canonical plan as eligibility evidence and returns a receipt, not a lock');
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.dry_run_receipt.not_a_lock, true);
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.remote_drift.same_remote_identity, true);
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.remote_drift.forces_revalidation, true);
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.apply_revalidation.at_storage_boundary, 'fresh live hashes plus storage-guard proof');
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.recovery.inspect_mode, 'inspect');
  assert.equal(recoveryRevalidationContract.stale_to_live_flow.recovery.mutates, false);
  assert.ok(
    recoveryRevalidationContract.required_invariants.includes(
      'apply must revalidate the live remote before every batch and at the storage boundary',
    ),
  );
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
  assert.equal(
    productionLadderContract.pull_to_push_mapping.exporter,
    'scans the merge base and coverage evidence',
  );
  assert.equal(
    productionLadderContract.pull_to_push_mapping.preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    productionLadderContract.auth_and_session.required_floor,
    'at least as strict as current Reprint HMAC usage',
  );
  assert.equal(
    productionLadderContract.auth_and_session.preflight_binding,
    'mints one short-lived push session bound to one remote identity and one persisted pull base',
  );
  assert.equal(
    productionLadderContract.auth_and_session.mutating_calls,
    'dry-run, apply, and mutating recovery require the push session, canonical push signature, and idempotency key',
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
  assert.ok(
    productionLadderContract.topology.docker.proof.includes(
      'remote-base and remote-changed are the same remote identity at different times',
    ),
  );
  assert.equal(
    productionLadderContract.journal_and_recovery.journal_inspect,
    'reads durable evidence without authorizing mutation',
  );
  assert.equal(
    productionLadderContract.journal_and_recovery.recover_inspect,
    'must happen before any mutating recovery mode',
  );
  assert.equal(
    productionLadderContract.journal_and_recovery.lease_fence,
    'claim generation and lease expiry fence stale workers before mutation',
  );
  assert.equal(
    productionLadderContract.journal_and_recovery.revalidation,
    'mutating recovery still requires fresh live hashes plus journal evidence',
  );
  assert.equal(
    productionLadderContract.remote_liveness.snapshot_hash_listing,
    'planning evidence only and never write authority',
  );
  assert.equal(
    executorTopologyProof.push_pipeline.recovery,
    'allows mutating repair only when the journal row, lease fence, and fresh live hashes prove the action',
  );
  assert.equal(executorTopologyProof.topology.networking.ingress_port, 8080);
  assert.equal(executorTopologyProof.topology.networking.proxy_policy, 'local-only');
  assert.equal(executorTopologyProof.topology.networking.tunnels, 'disallowed');
  assert.ok(
    executorTopologyProof.topology.docker.proof.includes(
      'dry-run and apply are separate remote operations',
    ),
  );
  assert.ok(
    productionLadderContract.topology.docker.proof.includes(
      'exporter/importer establish the immutable pull base package before push',
    ),
  );
  assert.ok(
    executorTopologyProof.topology.playground.proof.includes(
      'push preflight binds the imported base to one live remote identity and one short-lived session',
    ),
  );
  assert.ok(
    productionLadderContract.required_invariants.includes(
      'pull exporter/importer establish the immutable base package before push',
    ),
  );
  assert.ok(
    productionLadderContract.required_invariants.includes(
      'remote snapshot hash listing is planning evidence, not write authority',
    ),
  );
  assert.ok(
    executorTopologyProof.topology.docker.proof.includes(
      'push journal remains read-only before mutating recovery',
    ),
  );
});

test('push remote-liveness fixture keeps the read-only and mutating boundaries separate', () => {
  const liveness = readJson('fixtures/protocol/push-remote-liveness-contract.json');

  assert.equal(liveness.contract_id, 'push-remote-liveness-contract');
  assert.equal(
    liveness.push_liveness.preflight,
    'binds the persisted pull base to the live remote identity and a short-lived push session',
  );
  assert.equal(
    liveness.push_liveness.snapshot_hash_listing,
    'returns live remote comparison evidence for planning only',
  );
  assert.equal(
    liveness.push_liveness.dry_run,
    'uploads eligibility evidence and returns a receipt, not a lock',
  );
  assert.equal(
    liveness.push_liveness.apply,
    'revalidates live evidence before every batch and again at the storage boundary',
  );
  assert.equal(
    liveness.push_liveness.journal,
    'reads durable claim, lease, and fencing evidence without authorizing mutation',
  );
  assert.equal(
    liveness.push_liveness.recovery_inspect,
    'starts with inspect and classifies finish, rollback, retry, or block before any mutating repair',
  );
  assert.equal(liveness.live_remote_proof.same_identity_at_two_times, true);
  assert.ok(
    liveness.live_remote_proof.proof.includes(
      'remote-base and remote-changed are the same remote identity observed at different times',
    ),
  );
  assert.ok(
    liveness.live_remote_proof.proof.includes(
      'journal inspection stays read-only before inspect-first recovery can mutate',
    ),
  );
  assert.equal(liveness.auth_floor.required, 'at least as strict as current Reprint HMAC usage');
  assert.deepEqual(liveness.auth_floor.mutating_calls, ['dry-run', 'apply', 'mutating recovery']);
  assert.deepEqual(liveness.auth_floor.read_only_calls, [
    'snapshot listing',
    'journal inspect',
    'recovery inspect',
  ]);
  assert.deepEqual(liveness.required_invariants, [
    'dry-run and apply are separate remote operations',
    'remote snapshot hash listing is planning evidence, not write authority',
    'dry-run is a receipt, not a lock',
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
  assert.ok(
    topology.test_topology.drift_proof.includes(
      'journal inspection stays read-only before inspect-first recovery can mutate',
    ),
  );
});

test('push topology matrix fixture captures the minimal docker and playground proof shape', () => {
  const matrix = readJson('fixtures/protocol/push-topology-matrix.json');

  assert.equal(matrix.topology_matrix_id, 'push-topology-docker-playground-matrix');
  assert.equal(
    matrix.push_pipeline.snapshot_hash_listing,
    'returns the live remote comparison set for planning only',
  );
  assert.equal(
    matrix.push_pipeline.mutation_batch_apply,
    'revalidates fresh live evidence before every batch and again at the storage boundary',
  );
  assert.equal(matrix.test_topology.runner, 'the only actor allowed to run the push protocol');
  assert.deepEqual(matrix.test_topology.proof_order, [
    'preflight',
    'snapshot-hashes',
    'dry-run',
    'apply',
    'journal',
    'recovery-inspect',
    'recovery-mutate',
  ]);
  assert.ok(
    matrix.test_topology.drift_proof.includes(
      'browser-visible inspection uses the sandbox-provided 8080 ingress through a local-only proxy',
    ),
  );
  assert.equal(matrix.pull_pipeline.exporter, 'scans the merge base and coverage evidence');
  assert.equal(matrix.pull_pipeline.importer, 'persists the base package as immutable provenance');
  assert.equal(matrix.pull_pipeline.persisted_base_package.base_manifest_id, 'pull-2026-05-24T00:00:00Z');
  assert.equal(matrix.pull_pipeline.persisted_base_package.remote_site_id, 'remote-example');
  assert.equal(matrix.apply_revalidation.before_each_batch, 'fresh live hashes');
  assert.equal(matrix.apply_revalidation.at_storage_boundary, 'fresh live hashes plus storage-guard proof');
  assert.ok(matrix.apply_revalidation.rejected_if.includes('the remote changed after the dry-run receipt'));
  assert.equal(matrix.remote_liveness.snapshot_hash_listing, 'planning evidence only and never write authority');
  assert.equal(matrix.remote_liveness.dry_run, 'eligibility evidence only and never a lock');
  assert.equal(
    matrix.remote_liveness.apply,
    'a separate remote stage that revalidates before every batch and at the storage boundary',
  );
  assert.equal(
    matrix.remote_liveness.recovery,
    'inspect-first and mutating only when journal evidence plus fresh live hashes prove the action',
  );
  assert.equal(matrix.dry_run_receipt.mode, 'dry-run');
  assert.equal(matrix.dry_run_receipt.mutates, false);
  assert.equal(matrix.dry_run_receipt.effect, 'eligibility evidence only');
  assert.equal(matrix.dry_run_receipt.not_a_lock, true);
  assert.equal(matrix.dry_run_receipt.reused_for_apply, false);
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
  const liveness = readJson('fixtures/protocol/push-remote-liveness-contract.json');

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
  assert.equal(liveness.push_liveness.dry_run_receipt, 'may go stale before apply and never becomes write authority');
  assert.ok(
    liveness.live_remote_proof.proof.includes(
      'recovery inspect stays read-only and happens before any mutating repair',
    ),
  );
  assert.ok(
    liveness.required_invariants.includes(
      'recovery must begin with inspect before any mutating repair',
    ),
  );
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

test('push fixture index keeps the production proof bundle grouped around the new push ladder', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'fixtures/protocol/README.md'), 'utf8').replace(/\s+/g, ' ');

  assert.ok(readme.includes('push-protocol-extension-contract.json'));
  assert.ok(readme.includes('push-deployment-topology-contract.json'));
  assert.ok(readme.includes('push-pull-to-topology-contract.json'));
  assert.ok(readme.includes('preflight, remote snapshot hash listing, dry-run receipt, batched apply, journal inspect, and inspect-first recovery stay on separate liveness boundaries'));
  assert.ok(readme.includes('one-remote, one-local, one-drift-witness topology'));
  assert.ok(readme.includes('pull-to-push bridge proofs'));
});
