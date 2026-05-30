import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const smokeSourcePath = path.join(repoRoot, 'scripts/playground/production-shaped-apply-revalidation-smoke.mjs');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const smokeSource = readFileSync(smokeSourcePath, 'utf8');

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

test('RPP-0529 apply revalidates the receipt-bound live source URL after apply-started and before mutation', () => {
  const runApply = functionBody(routeSource, 'reprint_push_lab_rest_run_db_journal_apply');
  const applyWithJournal = functionBody(routeSource, 'reprint_push_lab_rest_apply_with_db_journal');
  const revalidateLiveSource = functionBody(routeSource, 'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const sourceBindingEvidence = functionBody(routeSource, 'reprint_push_lab_rest_apply_live_source_binding_evidence');
  const applyRevalidationEvidence = functionBody(routeSource, 'reprint_push_lab_rest_apply_revalidation_evidence');

  assertBefore(
    runApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    revalidateLiveSource,
    '$current_source = reprint_push_lab_rest_apply_live_source_binding_evidence($request, $accepted);',
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    revalidateLiveSource,
    "'AUTH_SOURCE_BINDING_MISMATCH'",
    '$current = reprint_push_export_snapshot();',
  );
  assert.match(
    runApply,
    /catch \(Reprint_Push_Protocol_Error \$error\) \{\s*\$error->result = reprint_push_lab_rest_attach_rejected_apply_revalidation_evidence/s,
  );
  assert.match(
    applyWithJournal,
    /is_array\(\$accepted\) && !isset\(\$result\['applyRevalidation'\]\)/,
  );

  assert.match(sourceBindingEvidence, /\$current_source\s*=\s*reprint_push_lab_rest_source_identity\(\$request\)/);
  assert.match(sourceBindingEvidence, /reprint_push_lab_rest_source_binding_matches\(\$receipt_source,\s*\$current_source\)/);
  assert.match(sourceBindingEvidence, /'checkedAgainst'\s*=>\s*'live-source-url'/);
  assert.match(sourceBindingEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$current_source\['sourceUrlHash'\]/);
  assert.match(sourceBindingEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$receipt_source\['sourceUrlHash'\]/);
  assert.match(sourceBindingEvidence, /'sourceBindingHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json/);

  assert.match(applyRevalidationEvidence, /'liveSource'\s*=>\s*\[/);
  assert.match(applyRevalidationEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['sourceUrlHash'\]/);
  assert.match(applyRevalidationEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['receiptSourceUrlHash'\]/);
  assert.match(applyRevalidationEvidence, /'sourceBindingHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['sourceBindingHash'\]/);

  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_apply_resource',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(
      revalidateLiveSource,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('RPP-0529 live smoke asserts source URL binding evidence from apply revalidation', () => {
  const helper = functionBody(smokeSource, 'assertLiveSourceBindingRevalidated');
  const summarizer = functionBody(smokeSource, 'summarizeLiveSourceBinding');

  assert.match(smokeSource, /assertLiveSourceBindingRevalidated\(apply\.body\.applyRevalidation\)/);
  assert.match(smokeSource, /liveSourceBinding:\s*summarizeLiveSourceBinding\(apply\.body\.applyRevalidation\)/);
  assert.match(helper, /apply revalidation must include live source binding evidence/);
  assert.match(helper, /liveSource\.sourceHash,\s*liveSource\.receiptSourceHash/s);
  assert.match(helper, /liveSource\.sourceUrlHash,\s*liveSource\.receiptSourceUrlHash/s);
  assert.match(helper, /\^db-journal:\\d\+\$/);
  assert.match(summarizer, /sameSourceUrlHash:\s*Boolean\(liveSource\.sourceUrlHash/);
});
