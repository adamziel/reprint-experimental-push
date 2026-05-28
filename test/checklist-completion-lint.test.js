import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  collectScanFiles,
  lintChecklistCompletion,
  parseChecklist,
} from '../scripts/release/checklist-completion-lint.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/checklist-completion-lint.mjs');

function makeFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-completion-lint-'));
}

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function writeChecklist(root, items) {
  writeFile(root, 'docs/reprint-push-completion-checklist.md', [
    '# Fixture checklist',
    '',
    ...items.map(([state, id, label]) => `- [${state}] ${id} ${label}`),
    '',
  ].join('\n'));
}

test('parses checked and unchecked RPP IDs without relying on repository checklist counts', () => {
  const root = makeFixture();
  writeChecklist(root, [
    ['x', 'RPP-0003', 'checked item'],
    [' ', 'RPP-0001', 'unchecked item'],
    ['X', 'RPP-0002', 'also checked item'],
  ]);

  const checklist = parseChecklist(path.join(root, 'docs/reprint-push-completion-checklist.md'));

  assert.deepEqual(checklist.checkedIds, ['RPP-0002', 'RPP-0003']);
  assert.deepEqual(checklist.uncheckedIds, ['RPP-0001']);
  assert.deepEqual(checklist.errors, []);
});

test('collects only the configured evidence/progress scan targets in stable order', () => {
  const root = makeFixture();
  writeChecklist(root, [[' ', 'RPP-0001', 'unchecked item']]);
  writeFile(root, 'docs/evidence/zeta.md', 'RPP-0001 evidence toward only.\n');
  writeFile(root, 'docs/evidence/alpha.md', 'RPP-0001 evidence toward only.\n');
  writeFile(root, 'docs/evidence/skip.txt', 'RPP-0001 done.\n');
  writeFile(root, 'audits/audit.md', 'RPP-0001 evidence toward only.\n');
  writeFile(root, 'docs/progress-log.md', 'RPP-0001 evidence toward only.\n');
  writeFile(root, 'docs/supervisor-feedback.md', 'RPP-0001 evidence toward only.\n');
  writeFile(root, 'progress.html', '<p>RPP-0001 evidence toward only.</p>\n');
  writeFile(root, 'docs/other.md', 'RPP-0001 done.\n');

  assert.deepEqual(collectScanFiles(root), [
    'audits/audit.md',
    'docs/evidence/alpha.md',
    'docs/evidence/zeta.md',
    'docs/progress-log.md',
    'docs/supervisor-feedback.md',
    'progress.html',
  ]);
});

test('flags risky completion language for unchecked RPP IDs while ignoring checked IDs', () => {
  const root = makeFixture();
  writeChecklist(root, [
    ['x', 'RPP-0001', 'checked item'],
    [' ', 'RPP-0002', 'unchecked item'],
    [' ', 'RPP-0003', 'another unchecked item'],
  ]);
  writeFile(root, 'docs/evidence/claims.md', [
    'RPP-0001 is done and passed with verifier evidence.',
    'RPP-0002 is done and passed with verifier evidence.',
    'RPP-0003 is release-ready.',
    '',
  ].join('\n'));

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.checkedIds, ['RPP-0001']);
  assert.deepEqual(result.uncheckedIds, ['RPP-0002', 'RPP-0003']);
  assert.deepEqual(result.riskyClaims.map((claim) => claim.id), ['RPP-0002', 'RPP-0003']);
  assert.deepEqual(result.riskyClaims[0].matchedTerms, ['done', 'passed']);
  assert.deepEqual(result.riskyClaims[1].matchedTerms, ['release-ready']);
  assert.ok(result.riskyClaims[0].reasonCodes.includes('RPP_ID_UNCHECKED'));
  assert.ok(result.riskyClaims[0].reasonCodes.includes('RISKY_COMPLETION_LANGUAGE'));
  assert.ok(result.reasonCodes.includes('RISKY_TERM_DONE'));
  assert.ok(result.reasonCodes.includes('RISKY_TERM_PASSED'));
});

test('expands RPP ranges so risky broad claims cannot hide unchecked IDs', () => {
  const root = makeFixture();
  writeChecklist(root, [
    ['x', 'RPP-0001', 'checked item'],
    [' ', 'RPP-0002', 'unchecked item'],
    [' ', 'RPP-0003', 'unchecked item'],
  ]);
  writeFile(root, 'audits/range.md', 'RPP-0001 through RPP-0003 are complete.\n');

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.riskyClaims.map((claim) => claim.id), ['RPP-0002', 'RPP-0003']);
  assert.deepEqual(result.riskyClaims.map((claim) => claim.line), [1, 1]);
});

test('allows cautious language around unchecked RPP IDs', () => {
  const root = makeFixture();
  writeChecklist(root, [
    [' ', 'RPP-0004', 'unchecked item'],
    [' ', 'RPP-0005', 'unchecked item'],
    [' ', 'RPP-0006', 'unchecked item'],
  ]);
  writeFile(root, 'docs/evidence/cautious.md', [
    'RPP-0004 has evidence toward the release gate; focused checks passed but the checklist item remains unchecked.',
    'RPP-0005 has claimed evidence toward the verifier and release remains held.',
    'RPP-0006 is not complete and not release-ready.',
    '',
  ].join('\n'));

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.riskyClaims, []);
  assert.deepEqual(result.reasonCodes, []);
});

test('does not let adjacent cautious language hide an unsafe current-line claim', () => {
  const root = makeFixture();
  writeChecklist(root, [
    [' ', 'RPP-0009', 'unchecked item'],
    [' ', 'RPP-0010', 'unchecked item'],
  ]);
  writeFile(root, 'docs/evidence/mixed.md', [
    'RPP-0009 is done.',
    'RPP-0010 is not complete.',
    '',
  ].join('\n'));

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.riskyClaims.map((claim) => claim.id), ['RPP-0009']);
  assert.deepEqual(result.riskyClaims[0].matchedTerms, ['done']);
});

test('does not carry risky language across separate markdown bullets', () => {
  const root = makeFixture();
  writeChecklist(root, [
    [' ', 'RPP-0011', 'unchecked item'],
  ]);
  writeFile(root, 'docs/progress-log.md', [
    '- RPP-0011 has evidence for the current active roster.',
    '- Progress-reporter verification passed:',
    '  `node --test test/example.test.js`',
    '',
  ].join('\n'));

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.riskyClaims, []);
});

test('fails closed when the checklist is missing', () => {
  const root = makeFixture();
  writeFile(root, 'docs/evidence/claims.md', 'RPP-0001 evidence toward only.\n');

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.checkedIds, []);
  assert.deepEqual(result.uncheckedIds, []);
  assert.deepEqual(result.riskyClaims, []);
  assert.deepEqual(result.reasonCodes, ['CHECKLIST_MISSING']);
  assert.deepEqual(result.checklistErrors.map((error) => error.reasonCode), ['CHECKLIST_MISSING']);
  assert.equal(result.checklistErrors[0].file, 'docs/reprint-push-completion-checklist.md');
});

test('fails closed when the checklist has duplicate IDs', () => {
  const root = makeFixture();
  writeChecklist(root, [
    [' ', 'RPP-0007', 'first copy'],
    ['x', 'RPP-0007', 'second copy'],
  ]);
  writeFile(root, 'docs/evidence/claims.md', 'RPP-0007 evidence toward only.\n');

  const result = lintChecklistCompletion({ rootDir: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.riskyClaims, []);
  assert.deepEqual(result.reasonCodes, ['CHECKLIST_DUPLICATE_ID']);
  assert.deepEqual(result.checklistErrors, [{
    reasonCode: 'CHECKLIST_DUPLICATE_ID',
    id: 'RPP-0007',
    file: 'docs/reprint-push-completion-checklist.md',
    lines: [3, 4],
  }]);
});

test('CLI emits stable JSON and exits nonzero for risky unchecked claims', () => {
  const root = makeFixture();
  writeChecklist(root, [
    [' ', 'RPP-0008', 'unchecked item'],
  ]);
  writeFile(root, 'progress.html', '<p>RPP-0008 done.</p>\n');

  const completed = spawnSync(process.execPath, [scriptPath, '--root', root], {
    encoding: 'utf8',
  });

  assert.equal(completed.status, 1);
  assert.equal(completed.stderr, '');
  const result = JSON.parse(completed.stdout);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), [
    'ok',
    'reasonCodes',
    'riskyClaims',
    'scannedFiles',
    'checkedIds',
    'uncheckedIds',
    'checklistErrors',
  ]);
  assert.deepEqual(result.scannedFiles, ['progress.html']);
  assert.deepEqual(result.riskyClaims.map((claim) => ({
    file: claim.file,
    line: claim.line,
    id: claim.id,
    matchedTerms: claim.matchedTerms,
  })), [{
    file: 'progress.html',
    line: 1,
    id: 'RPP-0008',
    matchedTerms: ['done'],
  }]);
});
