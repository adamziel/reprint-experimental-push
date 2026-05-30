import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-lib.php');
const restSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const protocolSource = readFileSync(protocolSourcePath, 'utf8');
const restSource = readFileSync(restSourcePath, 'utf8');

function functionBody(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function runPhp(code) {
  const result = spawnSync('php', ['-r', code], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('RPP-0713 apply batch sizing accepts bounded deterministic sizes and rejects invalid sizes', () => {
  const report = runPhp(`
    require 'scripts/playground/push-remote-lib.php';
    $mutations = [
      ['id' => 'm1', 'resourceKey' => 'row:1'],
      ['id' => 'm2', 'resourceKey' => 'row:2'],
      ['id' => 'm3', 'resourceKey' => 'row:3'],
      ['id' => 'm4', 'resourceKey' => 'row:4'],
      ['id' => 'm5', 'resourceKey' => 'row:5'],
    ];
    $batches = reprint_push_protocol_apply_batches(
      $mutations,
      reprint_push_protocol_apply_batch_size(['applyBatchSize' => '2'])
    );
    $invalid = [];
    foreach ([0, 501, '1.5', true, ['size' => 2]] as $raw) {
      try {
        reprint_push_protocol_apply_batch_size(['applyBatchSize' => $raw]);
        $invalid[] = ['accepted' => true];
      } catch (Reprint_Push_Protocol_Error $error) {
        $invalid[] = $error->result;
      }
    }
    echo json_encode([
      'defaultSize' => reprint_push_protocol_apply_batch_size([]),
      'configuredSize' => reprint_push_protocol_apply_batch_size(['applyBatchSize' => '2']),
      'batchCount' => count($batches),
      'batches' => $batches,
      'sizingEvidence' => reprint_push_protocol_apply_batch_sizing_evidence(2, $batches, $mutations, true),
      'invalid' => $invalid,
    ], JSON_THROW_ON_ERROR);
  `);

  assert.equal(report.defaultSize, 500);
  assert.equal(report.configuredSize, 2);
  assert.equal(report.batchCount, 3);
  assert.deepEqual(report.batches.map((batch) => batch.mutationCount), [2, 2, 1]);
  assert.deepEqual(report.batches.map((batch) => batch.lastBatch), [false, false, true]);
  assert.equal(report.sizingEvidence.mode, 'apply');
  assert.equal(report.sizingEvidence.maxBatchSize, 500);
  assert.equal(report.sizingEvidence.configuredBy, 'request');
  assert.equal(report.sizingEvidence.revalidation, 'fresh-live-hashes-before-each-batch');
  assert.equal(report.sizingEvidence.storageBoundary, 'per-mutation-storage-boundary-cas');
  assert.ok(report.invalid.every((entry) => entry.code === 'INVALID_ARGUMENT'));
  assert.ok(report.invalid.every((entry) => entry.mode === 'apply'));
});

test('RPP-0713 apply loop revalidates each configured batch before mutation work and journals batch boundaries', () => {
  const runPayload = functionBody(protocolSource, 'reprint_push_protocol_run_payload');
  const revalidateBatch = functionBody(protocolSource, 'reprint_push_protocol_revalidate_apply_batch');

  assertBefore(runPayload, 'reprint_push_protocol_apply_batch_size($options)', "reprint_push_protocol_append_journal_event('apply-started'");
  assertBefore(runPayload, 'reprint_push_protocol_revalidate_apply_batch', "'mutation-prepared'");
  assertBefore(runPayload, "'mutation-applied'", "'apply-batch-committed'");
  assertBefore(runPayload, "'apply-batch-committed'", "'apply-committed'");
  assert.match(runPayload, /'applyBatchSizing'\s*=>\s*\$apply_batch_sizing/);

  assertBefore(revalidateBatch, 'reprint_push_export_snapshot()', 'reprint_push_protocol_verify_preconditions');
  assert.match(revalidateBatch, /'phase'\s*=>\s*'before-apply-batch'/);
  assert.match(revalidateBatch, /'checkedAgainst'\s*=>\s*'live-remote'/);
  assert.match(revalidateBatch, /'snapshotHash'\s*=>\s*\$snapshot_hash/);
  assert.match(revalidateBatch, /'verifiedPreconditionCount'\s*=>\s*count\(\$verified_preconditions\)/);
  assert.match(revalidateBatch, /'apply-batch-revalidated'/);
  assert.doesNotMatch(revalidateBatch, /currentSnapshot|afterSnapshot|beforeSnapshot|post_content|option_value|meta_value/);
});

test('RPP-0713 REST apply accepts snake case batch size and stores hash-only batch evidence', () => {
  const labOptions = functionBody(restSource, 'reprint_push_lab_rest_lab_options');
  const dbJournalCallback = functionBody(restSource, 'reprint_push_lab_rest_db_journal_mutation_callback');
  const applyEvidence = functionBody(restSource, 'reprint_push_lab_rest_apply_revalidation_evidence');

  assert.match(labOptions, /array_key_exists\('apply_batch_size', \$payload\)/);
  assert.match(labOptions, /\$options\['applyBatchSize'\]\s*=\s*\$payload\['apply_batch_size'\]/);
  assert.match(labOptions, /array_key_exists\('applyBatchSize', \$payload\)/);

  assert.match(dbJournalCallback, /'apply-batch-revalidated'/);
  assert.match(dbJournalCallback, /'apply-batch-committed'/);
  assert.match(dbJournalCallback, /'applyBatch'\s*=>\s*\[/);
  assert.match(dbJournalCallback, /'snapshotHash'\s*=>\s*\(string\) \(\$evidence\['snapshotHash'\]/);
  assert.match(dbJournalCallback, /reprint_push_lab_db_journal_sanitize_value/);
  assert.doesNotMatch(dbJournalCallback, /post_content|option_value|meta_value|currentSnapshot|afterSnapshot|beforeSnapshot/);

  assert.match(applyEvidence, /\$evidence\['applyBatchSizing'\]\s*=\s*reprint_push_lab_db_journal_sanitize_value/);
});
