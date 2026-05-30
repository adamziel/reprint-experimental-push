import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REMOTE_HASH_CURSOR_PATTERN,
  REMOTE_HASH_MAX_BATCH_SIZE,
  buildRemoteHashResources,
  makeRemoteHashCursor,
  normalizeRemoteHashBatchSize,
  paginateRemoteHashResources,
  parseRemoteHashCursor,
  remoteHashScopeHash,
  remoteHashSourceHash,
  runRemoteHashPaginationBenchmark,
  walkRemoteHashPages,
} from '../scripts/bench/remote-hash-pagination.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const source = Object.freeze({
  sourceUrlHash: 'a'.repeat(64),
  restNamespace: 'reprint/v1',
  routeProfile: 'production-shaped',
});
const scope = Object.freeze({
  files: ['wp-content/uploads', 'wp-content/plugins'],
  tables: ['wp_posts', 'wp_postmeta'],
  plugins: true,
  includeAbsentForBaseKeys: ['file:wp-content/plugins/forms/forms.php'],
});

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

test('remote hash pagination benchmark reports runtime, resources, and pass/fail gates', () => {
  const report = runRemoteHashPaginationBenchmark({
    now: fixedNow,
    resourceCount: 1205,
    batchSize: 128,
  });

  assert.equal(report.rppId, 'RPP-0711');
  assert.equal(report.benchmark, 'rpp-0711-remote-hash-pagination');
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'deterministic-no-live-remote');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(report.runtime.liveRemoteService.status, 'unavailable');
  assert.deepEqual(report.runtime.liveRemoteService.unavailableCapabilities, ['live-wordpress-remote-service']);
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);

  assert.equal(report.resources.remoteHashes.cursorFormat, 'snapcursor:{sourceHashPrefix}:{scopeHashPrefix}:{offset}');
  assert.equal(report.resources.remoteHashes.maxBatchSize, REMOTE_HASH_MAX_BATCH_SIZE);
  assert.equal(report.resources.remoteHashes.requestedBatchSize, 128);
  assert.equal(report.resources.remoteHashes.resourceCount, 1205);
  assert.equal(report.resources.remoteHashes.pageCount, 10);
  assert.equal(report.resources.remoteHashes.complete, true);
  assert.deepEqual(report.resources.remoteHashes.duplicateResourceKeys, []);
  assert.match(report.resources.remoteHashes.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(report.resources.remoteHashes.scopeHash, /^[a-f0-9]{64}$/);
  assert.match(report.resources.remoteHashes.snapshotHashSetHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 7);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'complete-resource-set'));
  assert.ok(report.gates.some((gate) => gate.id === 'cursor-binds-source-and-scope'));
  assert.ok(report.gates.some((gate) => gate.id === 'configuration-bounds-enforced'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));

  assert.equal(report.deterministicCoverage.uniqueResourceCount, 1205);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.pageHashesStable, true);
  assert.equal(report.deterministicCoverage.errorPaths.cursorSourceMismatch.code, 'INVALID_CURSOR_SOURCE');
  assert.equal(report.deterministicCoverage.errorPaths.cursorScopeMismatch.code, 'INVALID_CURSOR_SCOPE');
  assert.match(report.limitations.join(' '), /does not claim live production proof/);
});

test('remote hash pages are cursorable, complete, deterministic, and duplicate-free', () => {
  const resources = buildRemoteHashResources(7);
  const first = paginateRemoteHashResources({ resources, source, scope, batchSize: 3 });
  assert.equal(first.complete, false);
  assert.equal(first.resources.length, 3);
  assert.match(first.cursor, REMOTE_HASH_CURSOR_PATTERN);
  assert.equal(first.pagination.offset, 0);
  assert.equal(first.pagination.nextOffset, 3);
  assert.equal(first.pagination.pageResourceCount, 3);
  assert.equal(first.planningOnly.mutates, false);

  const second = paginateRemoteHashResources({
    resources,
    source,
    scope,
    batchSize: 3,
    cursor: first.cursor,
  });
  assert.equal(second.pagination.offset, 3);
  assert.equal(second.resources.length, 3);
  assert.equal(second.complete, false);

  const third = paginateRemoteHashResources({
    resources,
    source,
    scope,
    batchSize: 3,
    cursor: second.cursor,
  });
  assert.equal(third.pagination.offset, 6);
  assert.equal(third.resources.length, 1);
  assert.equal(third.complete, true);
  assert.equal(third.cursor, null);

  const walk = walkRemoteHashPages({ resources: [...resources].reverse(), source, scope, batchSize: 3 });
  assert.equal(walk.complete, true);
  assert.equal(walk.pages.length, 3);
  assert.equal(walk.uniqueResourceCount, 7);
  assert.deepEqual(walk.duplicateResourceKeys, []);
  assert.deepEqual(walk.pages.map((page) => page.resources.length), [3, 3, 1]);
});

test('remote hash cursor and configuration error paths fail closed', () => {
  const resources = buildRemoteHashResources(5);
  const sourceHash = remoteHashSourceHash(source);
  const scopeHash = remoteHashScopeHash(scope);
  const cursor = makeRemoteHashCursor({ sourceHash, scopeHash, offset: 2 });
  const state = parseRemoteHashCursor(cursor, { expectedSourceHash: sourceHash, expectedScopeHash: scopeHash });
  assert.equal(state.offset, 2);
  assert.equal(state.sourceHashPrefix, sourceHash.slice(0, 16));
  assert.equal(state.scopeHashPrefix, scopeHash.slice(0, 16));

  assertRemoteHashError(
    () => parseRemoteHashCursor('snapcursor:not-valid'),
    'INVALID_CURSOR_FORMAT',
  );
  assertRemoteHashError(
    () => parseRemoteHashCursor(
      makeRemoteHashCursor({ sourceHash: remoteHashSourceHash({ ...source, restNamespace: 'other/v1' }), scopeHash, offset: 2 }),
      { expectedSourceHash: sourceHash, expectedScopeHash: scopeHash },
    ),
    'INVALID_CURSOR_SOURCE',
  );
  assertRemoteHashError(
    () => parseRemoteHashCursor(
      makeRemoteHashCursor({ sourceHash, scopeHash: remoteHashScopeHash({ ...scope, tables: ['wp_options'] }), offset: 2 }),
      { expectedSourceHash: sourceHash, expectedScopeHash: scopeHash },
    ),
    'INVALID_CURSOR_SCOPE',
  );
  assertRemoteHashError(() => normalizeRemoteHashBatchSize(0), 'INVALID_BATCH_SIZE');
  assertRemoteHashError(() => normalizeRemoteHashBatchSize(REMOTE_HASH_MAX_BATCH_SIZE + 1), 'INVALID_BATCH_SIZE');
  assertRemoteHashError(
    () => paginateRemoteHashResources({
      resources,
      source,
      scope,
      batchSize: 3,
      cursor: makeRemoteHashCursor({ sourceHash, scopeHash, offset: 6 }),
    }),
    'INVALID_CURSOR_OFFSET',
  );
});

test('snapshot hashes REST route binds pagination cursor to source and scope without write authority', () => {
  const response = functionBody('reprint_push_lab_rest_snapshot_hashes_response');
  const options = functionBody('reprint_push_lab_rest_snapshot_hashes_options');
  const cursorState = functionBody('reprint_push_lab_rest_snapshot_hashes_cursor_state');
  const validateCursor = functionBody('reprint_push_lab_rest_snapshot_hashes_validate_cursor_state');
  const cursorForOffset = functionBody('reprint_push_lab_rest_snapshot_hashes_cursor_for_offset');
  const receipt = functionBody('reprint_push_lab_rest_snapshot_hashes_receipt');

  assert.match(response, /reprint_push_lab_rest_snapshot_hashes_options\(\$payload,\s*\$source\)/);
  assert.match(
    response,
    /reprint_push_lab_rest_snapshot_hashes_cursor_for_offset\(\$source,\s*\(string\) \$options\['scopeHash'\],\s*\$next_offset\)/,
  );
  assert.match(response, /'pagination'\s*=>\s*\[/);
  assert.match(response, /'cursorFormat'\s*=>\s*'snapcursor:\{sourceHashPrefix\}:\{scopeHashPrefix\}:\{offset\}'/);
  assert.match(options, /reprint_push_lab_rest_snapshot_hashes_validate_cursor_state\(\$cursor_state,\s*\$source,\s*\$scope_hash\)/);
  assert.ok(cursorState.includes("preg_match('/^snapcursor:([a-f0-9]{16}):([a-f0-9]{16}):(\\d+)$/', $cursor, $matches)"));
  assert.match(validateCursor, /Snapshot hashes cursor source does not match the current remote source\./);
  assert.match(validateCursor, /Snapshot hashes cursor scope does not match the requested comparison scope\./);
  assert.match(validateCursor, /hash_equals/);
  assert.match(cursorForOffset, /reprint_push_lab_rest_snapshot_hashes_source_prefix\(\$source\)/);
  assert.match(cursorForOffset, /reprint_push_lab_rest_snapshot_hashes_scope_prefix\(\$scope_hash\)/);
  assert.match(receipt, /'pagination'\s*=>\s*\[/);
  assert.match(receipt, /'nextCursorHash'\s*=>/);

  const routeBodies = [
    response,
    options,
    cursorState,
    validateCursor,
    cursorForOffset,
    receipt,
  ].join('\n');
  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_protocol_append_journal_event',
    'reprint_push_lab_db_journal_insert_event',
    'reprint_push_lab_rest_apply_with_db_journal',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(routeBodies, new RegExp(escapeRegExp(forbiddenMutationCall)));
  }
});

function assertRemoteHashError(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
