import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDriverDryRunValidationHookCases,
  validateDriverDryRunValidationHookCase,
} from '../scripts/harness/generated-push-cases.js';

function byVariant(results) {
  return Object.fromEntries(results.map((result) => [result.variant, result]));
}

function assertNoRawGeneratedSecrets(cases, proof) {
  const proofJson = JSON.stringify(proof);
  const secretTokens = cases.flatMap((testCase) => testCase.secretTokens || []);
  assert.ok(secretTokens.length > 0, 'generated cases must carry raw fixture tokens for redaction checks');
  for (const [index, token] of secretTokens.entries()) {
    assert.equal(proofJson.includes(token), false, `proof leaked raw generated token at index ${index}`);
  }
}

test('RPP-0437 generated harness covers supported and unsupported driver dry-run validation hook variants', () => {
  const cases = generateDriverDryRunValidationHookCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'supported-dry-run-hook-applies',
    'unsupported-dry-run-hook-blocked',
  ]);
  assert.equal(cases.every((testCase) => testCase.family === 'driver-dry-run-validation-hook'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-dry-run-validation-hook')), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_options"')), true);

  const results = cases.map(validateDriverDryRunValidationHookCase);
  const variants = byVariant(results);
  const supported = variants['supported-dry-run-hook-applies'];
  const unsupported = variants['unsupported-dry-run-hook-blocked'];
  const proof = {
    rpp: 'RPP-0437',
    evidenceSource: 'generated-push-harness-driver-dry-run-validation-hook',
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
    variants: results.map((result) => ({
      variant: result.variant,
      status: result.status,
      outcome: result.outcome,
      mutations: result.mutations,
      blockers: result.blockers,
      applied: result.applied,
      appliedMutations: result.appliedMutations || 0,
      remotePreserved: result.remotePreserved === true,
      proofHash: result.proofHash,
    })),
  };

  assert.deepEqual(Object.fromEntries(results.map((result) => [result.variant, result.outcome])), {
    'supported-dry-run-hook-applies': 'applied-supported-hook',
    'unsupported-dry-run-hook-blocked': 'blocked-unsupported-hook',
  });

  assert.equal(supported.status, 'ready');
  assert.equal(supported.mutations, 1);
  assert.equal(supported.blockers, 0);
  assert.equal(supported.applied, true);
  assert.equal(supported.appliedMutations, 1);

  assert.equal(unsupported.status, 'blocked');
  assert.equal(unsupported.mutations, 0);
  assert.equal(unsupported.blockers, 1);
  assert.equal(unsupported.applied, false);
  assert.equal(unsupported.remotePreserved, true);

  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
  assertNoRawGeneratedSecrets(cases, proof);
});
