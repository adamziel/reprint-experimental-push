import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REASON_CODES,
  buildEvidenceCoverageManifest,
  parseChecklistContent,
} from '../scripts/release/evidence-coverage-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/release/evidence-coverage-manifest.mjs');

function makeFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-evidence-coverage-manifest-'));
}

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function runManifest(root) {
  const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
    encoding: 'utf8',
  });

  return {
    ...result,
    manifest: result.stdout ? JSON.parse(result.stdout) : null,
  };
}

test('parseChecklistContent extracts RPP IDs, labels, checked state, and duplicate checklist IDs', () => {
  const parsed = parseChecklistContent(`
# Fixture checklist

- [ ] RPP-0002 (Near / beta) Second item. Success: ignored proof detail.
- [x] RPP-0001 (Near / alpha) First item. Success: ignored proof detail.
- [ ] RPP-0002 (Near / beta) Duplicate item. Success: ignored proof detail.
`);

  assert.deepEqual(parsed.items, [
    {
      id: 'RPP-0002',
      checked: false,
      label: '(Near / beta) Second item.',
    },
    {
      id: 'RPP-0001',
      checked: true,
      label: '(Near / alpha) First item.',
    },
    {
      id: 'RPP-0002',
      checked: false,
      label: '(Near / beta) Duplicate item.',
    },
  ]);
  assert.deepEqual(parsed.duplicateIds, ['RPP-0002']);
});

test('buildEvidenceCoverageManifest reports deterministic coverage, missing IDs, duplicates, and source references', () => {
  const root = makeFixture();
  try {
    writeFile(root, 'docs/reprint-push-completion-checklist.md', `
# Fixture checklist

- [ ] RPP-0002 (Near / beta) Second item. Success: ignored proof detail.
- [x] RPP-0001 (Near / alpha) First item. Success: ignored proof detail.
- [ ] RPP-0003 (Near / gamma) Third item. Success: ignored proof detail.
`);
    writeFile(root, 'docs/evidence/z-proof.md', `
# Evidence Z

RPP-0002 has one source reference.
RPP-0001 and RPP-0001 appear here to prove duplicate occurrence detection.
RPP-9999 is intentionally outside the checklist.
`);
    writeFile(root, 'audits/a-proof.md', `
# Audit A

RPP-0001 also appears in an audit source file.
`);

    const manifest = buildEvidenceCoverageManifest({ rootDir: root });

    assert.equal(manifest.ok, true);
    assert.deepEqual(manifest.reasonCodes, []);
    assert.deepEqual(manifest.totals, {
      checklistIds: 3,
      coveredIds: 2,
      missingIds: 1,
      duplicateEvidenceIds: 1,
      sourceFiles: 2,
      unknownEvidenceIds: 1,
    });
    assert.deepEqual(manifest.coveredIds, ['RPP-0001', 'RPP-0002']);
    assert.deepEqual(manifest.missingIds, ['RPP-0003']);
    assert.deepEqual(manifest.duplicateEvidenceIds, ['RPP-0001']);
    assert.deepEqual(manifest.duplicateChecklistIds, []);
    assert.deepEqual(manifest.unknownEvidenceIds, ['RPP-9999']);
    assert.deepEqual(manifest.sourceFiles, [
      {
        path: 'audits/a-proof.md',
        ids: ['RPP-0001'],
        unknownIds: [],
      },
      {
        path: 'docs/evidence/z-proof.md',
        ids: ['RPP-0001', 'RPP-0002', 'RPP-9999'],
        unknownIds: ['RPP-9999'],
      },
    ]);
    assert.deepEqual(manifest.evidenceById, {
      'RPP-0001': ['audits/a-proof.md', 'docs/evidence/z-proof.md'],
      'RPP-0002': ['docs/evidence/z-proof.md'],
      'RPP-9999': ['docs/evidence/z-proof.md'],
    });
    assert.deepEqual(manifest.checklistItems, [
      {
        id: 'RPP-0001',
        label: '(Near / alpha) First item.',
        checked: true,
      },
      {
        id: 'RPP-0002',
        label: '(Near / beta) Second item.',
        checked: false,
      },
      {
        id: 'RPP-0003',
        label: '(Near / gamma) Third item.',
        checked: false,
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI fails closed with CHECKLIST_MISSING when the checklist file is absent', () => {
  const root = makeFixture();
  try {
    writeFile(root, 'docs/evidence/evidence.md', 'RPP-0001 evidence without a checklist.\n');

    const result = runManifest(root);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.manifest.ok, false);
    assert.deepEqual(result.manifest.reasonCodes, [REASON_CODES.CHECKLIST_MISSING]);
    assert.deepEqual(result.manifest.errors, [
      {
        code: REASON_CODES.CHECKLIST_MISSING,
        path: 'docs/reprint-push-completion-checklist.md',
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI fails closed with CHECKLIST_DUPLICATE_IDS when the checklist repeats an RPP ID', () => {
  const root = makeFixture();
  try {
    writeFile(root, 'docs/reprint-push-completion-checklist.md', `
- [ ] RPP-0001 First item. Success: ignored.
- [ ] RPP-0001 Duplicate item. Success: ignored.
`);
    writeFile(root, 'audits/evidence.md', 'RPP-0001 evidence.\n');

    const result = runManifest(root);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.manifest.ok, false);
    assert.deepEqual(result.manifest.reasonCodes, [REASON_CODES.CHECKLIST_DUPLICATE_IDS]);
    assert.deepEqual(result.manifest.duplicateChecklistIds, ['RPP-0001']);
    assert.deepEqual(result.manifest.errors, [
      {
        code: REASON_CODES.CHECKLIST_DUPLICATE_IDS,
        path: 'docs/reprint-push-completion-checklist.md',
        ids: ['RPP-0001'],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI fails closed with EVIDENCE_FILES_NOT_FOUND when no evidence markdown files are present', () => {
  const root = makeFixture();
  try {
    writeFile(root, 'docs/reprint-push-completion-checklist.md', `
- [ ] RPP-0001 First item. Success: ignored.
`);

    const result = runManifest(root);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.manifest.ok, false);
    assert.deepEqual(result.manifest.reasonCodes, [REASON_CODES.EVIDENCE_FILES_NOT_FOUND]);
    assert.deepEqual(result.manifest.errors, [
      {
        code: REASON_CODES.EVIDENCE_FILES_NOT_FOUND,
        paths: ['docs/evidence', 'audits'],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
