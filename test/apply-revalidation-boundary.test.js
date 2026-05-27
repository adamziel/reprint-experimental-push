import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofTimeoutMs = 240_000;

test('verify release checks the live-source gate before support-only release proofs', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const verifyRelease = packageJson.scripts['verify:release'];
  const liveSourceGateIndex = verifyRelease.indexOf('test:playground:production-shaped-live-source-gate');
  const liveReleaseVerifyIndex = verifyRelease.indexOf('test:playground:production-shaped-live-release-verify');

  assert.ok(liveSourceGateIndex > 0, 'verify:release must include the missing live-source gate');
  assert.ok(liveReleaseVerifyIndex > 0, 'verify:release must still include the live release verifier');
  assert.ok(
    liveSourceGateIndex < liveReleaseVerifyIndex,
    'verify:release must fail closed for missing live source before support-only release proofs run',
  );
});

test('apply revalidation rejects stale remote before mutation and preserves replay evidence', {
  timeout: proofTimeoutMs + 10_000,
}, () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-apply-revalidation-smoke.mjs'], {
    cwd: repoRoot,
    timeout: proofTimeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  });

  assert.equal(proof.error, undefined, proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);

  const summary = parseFirstJsonObject(proof.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.missingReceipt.status, 428);
  assert.equal(summary.missingReceipt.code, 'MISSING_DRY_RUN_RECEIPT');
  assert.equal(summary.missingReceipt.readOnly, true);
  assert.equal(summary.dryRun.readOnly.targetSurfaceUnchanged, true);

  assert.match(summary.dryRun.receiptBinding.planHash, /^[a-f0-9]{64}$/);
  assert.match(summary.dryRun.receiptBinding.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(summary.dryRun.receiptBinding.sessionHash, /^[a-f0-9]{64}$/);
  assert.match(summary.dryRun.receiptBinding.dryRunIdempotencyKeyHash, /^[a-f0-9]{64}$/);
  assert.match(summary.dryRun.receiptBinding.dryRunBodyHash, /^[a-f0-9]{64}$/);
  assert.match(summary.dryRun.receiptBinding.dryRunRawBodyHash, /^[a-f0-9]{64}$/);

  assert.equal(summary.apply.status, 412);
  assert.equal(summary.apply.code, 'PRECONDITION_FAILED');
  assert.equal(summary.apply.preconditionCheck, 'storage-boundary-cas');
  assert.equal(summary.apply.applied, 0);
  assert.equal(summary.apply.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(summary.apply.applyRevalidation.checkedAgainst, 'live-remote');
  assert.equal(summary.apply.storageGuard.outcome, 'stale-at-write');
  assert.equal(summary.apply.rejectedRemoteEvidence.preservedRemoteChange, true);
  assert.equal(summary.apply.rejectedRemoteEvidence.appliedBeforeFailure, 0);

  assert.equal(summary.replay.status, 412);
  assert.equal(summary.replay.replayed, true);
  assert.equal(summary.replay.freshMutationWork, false);
  assert.equal(summary.replay.preservedRemoteUnchanged, true);

  assert.equal(summary.dbJournal.ordering.ordered, true);
  assert.equal(summary.dbJournal.ordering.mutationAppliedBeforeFailure, 0);
  assert.equal(summary.dbJournal.ordering.applyCommitted, false);
});

function parseFirstJsonObject(stdout) {
  const trimmed = String(stdout || '').trim();
  const firstBrace = trimmed.indexOf('{');
  assert.notEqual(firstBrace, -1, `proof did not emit JSON\n${stdout}`);
  const json = trimmed.slice(firstBrace);
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(json.slice(0, index + 1));
      }
    }
  }

  throw new Error(`proof emitted unterminated JSON\n${stdout}`);
}
