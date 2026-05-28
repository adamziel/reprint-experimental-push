import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_RELEASE_CHECKS,
  REQUIRED_RELEASE_CHECKS_CONTRACT,
  REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS,
  REQUIRED_RELEASE_CHECK_SEVERITIES,
  summarizeRequiredReleaseChecks,
  validateRequiredReleaseChecks,
  validateRequiredReleaseChecksSummary,
} from '../src/required-release-checks.js';
import { stableStringify } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'fixtures/protocol/push-required-release-checks-contract.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const requiredAreas = [
  'release-gates',
  'recovery-journal',
  'auth-inspect',
  'graph-identity',
  'plugin-driver',
  'route-proof',
  'evidence-coverage',
  'operator-proof',
  'artifact-redaction-provenance',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureContractOnly() {
  const copy = clone(fixture);
  delete copy.evaluation;
  delete copy.observations;
  delete copy.expected_summary;
  return copy;
}

function fixtureOptions(overrides = {}) {
  return {
    checks: clone(fixture.checks),
    observations: clone(fixture.observations),
    now: fixture.evaluation.now,
    ...overrides,
  };
}

function summarizeFixture(overrides = {}) {
  return summarizeRequiredReleaseChecks(fixtureOptions(overrides));
}

test('required release checks fixture mirrors the exported standalone contract', () => {
  assert.deepEqual(REQUIRED_RELEASE_CHECKS_CONTRACT, fixtureContractOnly());
  assert.deepEqual(REQUIRED_RELEASE_CHECKS, fixture.checks);
  assert.deepEqual(fixture.summary_fields, REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS);
  assert.deepEqual(Object.keys(fixture.expected_summary), REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS);

  const validation = validateRequiredReleaseChecks(fixture.checks);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);

  assert.deepEqual(fixture.checks.map((check) => check.area), requiredAreas);
  for (const check of fixture.checks) {
    assert.match(check.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.equal(typeof check.command, 'string', check.id);
    assert.ok(check.command.startsWith('node ') || check.command.startsWith('npm '), check.id);
    assert.ok(Array.isArray(check.artifacts), check.id);
    assert.ok(check.artifacts.length > 0, check.id);
    for (const artifact of check.artifacts) {
      assert.equal(fs.existsSync(path.join(repoRoot, artifact)), true, `${check.id} artifact ${artifact}`);
    }
    assert.equal(check.severity, REQUIRED_RELEASE_CHECK_SEVERITIES.blocking, check.id);
    assert.equal(typeof check.ownerScope, 'string', check.id);
    assert.ok(check.ownerScope.length > 0, check.id);
    assert.equal(Number.isInteger(check.staleAfterMs), true, check.id);
    assert.ok(check.staleAfterMs > 0, check.id);
  }
});

test('fixture observations produce the stable required summary output', () => {
  const summary = summarizeFixture();

  assert.deepEqual(summary, fixture.expected_summary);
  assert.deepEqual(Object.keys(summary), REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS);
  assert.equal(stableStringify(summary), stableStringify(fixture.expected_summary));
  assert.deepEqual(validateRequiredReleaseChecksSummary(summary), { ok: true, errors: [] });
  assert.equal(summary.ok, true);
  assert.equal(summary.releaseReady, true);
  assert.equal(summary.requiredCount, 9);
  assert.equal(summary.passedCount, 9);
});

test('missing required observations, commands, and artifacts fail closed', () => {
  const missingObservation = fixtureOptions();
  delete missingObservation.observations['release-gates-evaluator'];
  let summary = summarizeRequiredReleaseChecks(missingObservation);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.requiredCount, 9);
  assert.equal(summary.passedCount, 8);
  assert.deepEqual(summary.missingChecks.map((check) => check.code), [
    'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
  ]);
  assert.equal(summary.missingChecks[0].id, 'release-gates-evaluator');

  const missingCommand = fixtureOptions();
  delete missingCommand.observations['recovery-journal-proof'].command;
  summary = summarizeRequiredReleaseChecks(missingCommand);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.missingChecks[0].id, 'recovery-journal-proof');
  assert.equal(summary.missingChecks[0].code, 'REQUIRED_RELEASE_CHECK_OBSERVED_COMMAND_MISSING');

  const missingArtifact = fixtureOptions();
  missingArtifact.observations['auth-inspect-proof'].artifacts = [
    'src/authenticated-http-push-client.js',
  ];
  summary = summarizeRequiredReleaseChecks(missingArtifact);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.missingChecks[0].id, 'auth-inspect-proof');
  assert.equal(summary.missingChecks[0].code, 'REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING');
  assert.deepEqual(summary.missingChecks[0].missingArtifacts, [
    'test/authenticated-http-push-client.test.js',
    'docs/evidence/ao-executor-auth-leases.md',
    'fixtures/protocol/push-auth-session-fencing-contract.json',
  ]);
});

test('production-required stale and missing observedAt observations fail closed', () => {
  const stale = fixtureOptions();
  stale.observations['auth-inspect-proof'].observedAt = '2026-05-27T19:59:59.999Z';
  let summary = summarizeRequiredReleaseChecks(stale);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.passedCount, 8);
  assert.deepEqual(summary.missingChecks, []);
  assert.equal(summary.staleChecks.length, 1);
  assert.equal(summary.staleChecks[0].id, 'auth-inspect-proof');
  assert.equal(summary.staleChecks[0].code, 'REQUIRED_RELEASE_CHECK_STALE');
  assert.equal(summary.staleChecks[0].staleAfterMs, 43_200_000);

  const missingObservedAt = fixtureOptions();
  delete missingObservedAt.observations['operator-proof'].observedAt;
  summary = summarizeRequiredReleaseChecks(missingObservedAt);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.staleChecks[0].id, 'operator-proof');
  assert.equal(summary.staleChecks[0].code, 'REQUIRED_RELEASE_CHECK_OBSERVED_AT_REQUIRED');
});

test('contract definition errors fail closed before release movement', () => {
  const duplicateChecks = clone(fixture.checks);
  duplicateChecks.push({ ...clone(fixture.checks[0]) });
  let summary = summarizeFixture({ checks: duplicateChecks });
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.ok(summary.missingChecks.some((check) => check.code === 'DUPLICATE_REQUIRED_RELEASE_CHECK_ID'));

  const unknownSeverity = clone(fixture.checks);
  unknownSeverity[0].severity = 'required-by-branch-protection';
  summary = summarizeFixture({ checks: unknownSeverity });
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.ok(summary.missingChecks.some((check) => check.code === 'UNKNOWN_REQUIRED_RELEASE_CHECK_SEVERITY'));

  const missingCommandAndArtifacts = clone(fixture.checks);
  missingCommandAndArtifacts[0].command = '';
  missingCommandAndArtifacts[1].artifacts = [];
  summary = summarizeFixture({ checks: missingCommandAndArtifacts });
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.ok(summary.missingChecks.some((check) => check.code === 'REQUIRED_RELEASE_CHECK_COMMAND_REQUIRED'));
  assert.ok(summary.missingChecks.some((check) => check.code === 'REQUIRED_RELEASE_CHECK_ARTIFACTS_REQUIRED'));
});

test('tampered releaseReady summaries with missing required checks are rejected', () => {
  const invalid = clone(fixture.expected_summary);
  invalid.missingChecks = [{ id: 'release-gates-evaluator', code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING' }];
  const validation = validateRequiredReleaseChecksSummary(invalid);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors.map((error) => error.code), [
    'RELEASE_READY_WITH_MISSING_REQUIRED_CHECKS',
  ]);
});

test('non-blocking checks are reported without weakening blocking release readiness', () => {
  const advisory = {
    id: 'advisory-docs-index',
    title: 'Advisory docs index proof',
    area: 'operator-proof',
    ownerScope: 'operator',
    severity: REQUIRED_RELEASE_CHECK_SEVERITIES.nonBlocking,
    productionRequired: false,
    command: 'node --test test/required-release-checks.test.js',
    artifacts: ['docs/evidence/ao-required-release-checks.md'],
    staleAfterMs: 60_000,
  };
  const summary = summarizeFixture({
    checks: [...clone(fixture.checks), advisory],
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.releaseReady, true);
  assert.equal(summary.requiredCount, 9);
  assert.equal(summary.passedCount, 9);
  assert.deepEqual(summary.nonBlockingChecks, [
    {
      id: 'advisory-docs-index',
      status: 'missing',
      ownerScope: 'operator',
      command: 'node --test test/required-release-checks.test.js',
      artifacts: ['docs/evidence/ao-required-release-checks.md'],
      code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
    },
  ]);
});
