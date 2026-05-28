#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKLIST_RELATIVE_PATH = 'docs/reprint-push-completion-checklist.md';
const EVIDENCE_DIRECTORIES = ['docs/evidence', 'audits'];
const RPP_ID_PATTERN = /\bRPP-\d{4}\b/g;

export const REASON_CODES = Object.freeze({
  CHECKLIST_MISSING: 'CHECKLIST_MISSING',
  CHECKLIST_READ_FAILED: 'CHECKLIST_READ_FAILED',
  CHECKLIST_NO_IDS: 'CHECKLIST_NO_IDS',
  CHECKLIST_DUPLICATE_IDS: 'CHECKLIST_DUPLICATE_IDS',
  EVIDENCE_FILES_NOT_FOUND: 'EVIDENCE_FILES_NOT_FOUND',
  EVIDENCE_FILE_READ_FAILED: 'EVIDENCE_FILE_READ_FAILED',
});

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function compareRppIds(a, b) {
  const aNumber = Number(a.slice(4));
  const bNumber = Number(b.slice(4));

  if (aNumber !== bNumber) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareRppIds);
}

function stableSortedStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function labelFromChecklistRemainder(remainder) {
  return remainder
    .replace(/\s+Success:\s+.*$/u, '')
    .trim();
}

export function parseChecklistContent(content) {
  const items = [];
  const duplicateCounts = new Map();
  const seenIds = new Set();

  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*-\s+\[(?<state>[ xX])\]\s+(?<id>RPP-\d{4})(?<remainder>.*)$/u);

    if (!match?.groups) {
      continue;
    }

    const id = match.groups.id;
    if (seenIds.has(id)) {
      duplicateCounts.set(id, (duplicateCounts.get(id) ?? 1) + 1);
    } else {
      seenIds.add(id);
    }

    items.push({
      id,
      checked: match.groups.state.toLowerCase() === 'x',
      label: labelFromChecklistRemainder(match.groups.remainder),
    });
  }

  return {
    items,
    duplicateIds: [...duplicateCounts.keys()].sort(compareRppIds),
  };
}

function readChecklist(rootDir, reasonCodes, errors) {
  const checklistPath = path.join(rootDir, CHECKLIST_RELATIVE_PATH);

  if (!fs.existsSync(checklistPath)) {
    reasonCodes.add(REASON_CODES.CHECKLIST_MISSING);
    errors.push({
      code: REASON_CODES.CHECKLIST_MISSING,
      path: CHECKLIST_RELATIVE_PATH,
    });
    return { items: [], duplicateIds: [] };
  }

  try {
    const content = fs.readFileSync(checklistPath, 'utf8');
    const parsed = parseChecklistContent(content);

    if (parsed.items.length === 0) {
      reasonCodes.add(REASON_CODES.CHECKLIST_NO_IDS);
      errors.push({
        code: REASON_CODES.CHECKLIST_NO_IDS,
        path: CHECKLIST_RELATIVE_PATH,
      });
    }

    if (parsed.duplicateIds.length > 0) {
      reasonCodes.add(REASON_CODES.CHECKLIST_DUPLICATE_IDS);
      errors.push({
        code: REASON_CODES.CHECKLIST_DUPLICATE_IDS,
        path: CHECKLIST_RELATIVE_PATH,
        ids: parsed.duplicateIds,
      });
    }

    return parsed;
  } catch (error) {
    reasonCodes.add(REASON_CODES.CHECKLIST_READ_FAILED);
    errors.push({
      code: REASON_CODES.CHECKLIST_READ_FAILED,
      path: CHECKLIST_RELATIVE_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
    return { items: [], duplicateIds: [] };
  }
}

function discoverEvidenceFiles(rootDir) {
  const files = [];

  for (const relativeDirectory of EVIDENCE_DIRECTORIES) {
    const absoluteDirectory = path.join(rootDir, relativeDirectory);

    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      files.push(toPosixPath(path.join(relativeDirectory, entry.name)));
    }
  }

  return stableSortedStrings(files);
}

function scanEvidenceFiles(rootDir, checklistIdSet, reasonCodes, errors) {
  const evidenceFiles = discoverEvidenceFiles(rootDir);

  if (evidenceFiles.length === 0) {
    reasonCodes.add(REASON_CODES.EVIDENCE_FILES_NOT_FOUND);
    errors.push({
      code: REASON_CODES.EVIDENCE_FILES_NOT_FOUND,
      paths: EVIDENCE_DIRECTORIES,
    });
    return {
      sourceFiles: [],
      evidenceById: {},
      allEvidenceIds: [],
      duplicateEvidenceIds: [],
      unknownEvidenceIds: [],
    };
  }

  const sourceFiles = [];
  const evidenceSourcesById = new Map();
  const evidenceOccurrenceCountsById = new Map();

  for (const relativeFile of evidenceFiles) {
    const absoluteFile = path.join(rootDir, relativeFile);

    try {
      const content = fs.readFileSync(absoluteFile, 'utf8');
      const ids = uniqueSorted(content.match(RPP_ID_PATTERN) ?? []);
      const unknownIds = ids.filter((id) => !checklistIdSet.has(id));

      sourceFiles.push({
        path: relativeFile,
        ids,
        unknownIds,
      });

      const occurrences = content.match(RPP_ID_PATTERN) ?? [];
      for (const id of occurrences) {
        evidenceOccurrenceCountsById.set(id, (evidenceOccurrenceCountsById.get(id) ?? 0) + 1);
      }

      for (const id of ids) {
        if (!evidenceSourcesById.has(id)) {
          evidenceSourcesById.set(id, new Set());
        }
        evidenceSourcesById.get(id).add(relativeFile);
      }
    } catch (error) {
      reasonCodes.add(REASON_CODES.EVIDENCE_FILE_READ_FAILED);
      errors.push({
        code: REASON_CODES.EVIDENCE_FILE_READ_FAILED,
        path: relativeFile,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allEvidenceIds = uniqueSorted(evidenceSourcesById.keys());
  const duplicateEvidenceIds = allEvidenceIds.filter((id) => {
    const sourceCount = evidenceSourcesById.get(id)?.size ?? 0;
    const occurrenceCount = evidenceOccurrenceCountsById.get(id) ?? 0;
    return sourceCount > 1 || occurrenceCount > 1;
  });
  const unknownEvidenceIds = allEvidenceIds.filter((id) => !checklistIdSet.has(id));

  const evidenceById = {};
  for (const id of allEvidenceIds) {
    evidenceById[id] = stableSortedStrings(evidenceSourcesById.get(id) ?? []);
  }

  return {
    sourceFiles,
    evidenceById,
    allEvidenceIds,
    duplicateEvidenceIds,
    unknownEvidenceIds,
  };
}

function sortedChecklistItems(items) {
  return [...items]
    .sort((a, b) => compareRppIds(a.id, b.id))
    .map((item) => ({
      id: item.id,
      label: item.label,
      checked: item.checked,
    }));
}

export function buildEvidenceCoverageManifest(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const reasonCodes = new Set();
  const errors = [];
  const checklist = readChecklist(rootDir, reasonCodes, errors);
  const checklistItems = sortedChecklistItems(checklist.items);
  const checklistIds = uniqueSorted(checklist.items.map((item) => item.id));
  const checklistIdSet = new Set(checklistIds);
  const evidence = scanEvidenceFiles(rootDir, checklistIdSet, reasonCodes, errors);

  const coveredIds = evidence.allEvidenceIds.filter((id) => checklistIdSet.has(id));
  const coveredIdSet = new Set(coveredIds);
  const missingIds = checklistIds.filter((id) => !coveredIdSet.has(id));
  const reasonCodeList = stableSortedStrings(reasonCodes);

  return {
    ok: reasonCodeList.length === 0,
    reasonCodes: reasonCodeList,
    totals: {
      checklistIds: checklistIds.length,
      coveredIds: coveredIds.length,
      missingIds: missingIds.length,
      duplicateEvidenceIds: evidence.duplicateEvidenceIds.length,
      sourceFiles: evidence.sourceFiles.length,
      unknownEvidenceIds: evidence.unknownEvidenceIds.length,
    },
    coveredIds,
    missingIds,
    duplicateEvidenceIds: evidence.duplicateEvidenceIds,
    duplicateChecklistIds: checklist.duplicateIds,
    unknownEvidenceIds: evidence.unknownEvidenceIds,
    sourceFiles: evidence.sourceFiles,
    evidenceById: evidence.evidenceById,
    checklistItems,
    errors,
  };
}

function usage() {
  return `Usage: node scripts/release/evidence-coverage-manifest.mjs [--root <path>] [--compact]\n\nBuild a deterministic local evidence coverage manifest from docs/reprint-push-completion-checklist.md, docs/evidence/*.md, and audits/*.md.\n`;
}

function parseArguments(argv) {
  const options = {
    rootDir: process.cwd(),
    pretty: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      return { help: true, options };
    }

    if (argument === '--compact') {
      options.pretty = false;
      continue;
    }

    if (argument === '--root') {
      const rootDir = argv[index + 1];
      if (!rootDir) {
        throw new Error('--root requires a path');
      }
      options.rootDir = rootDir;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { help: false, options };
}

export function runCli(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  let parsed;

  try {
    parsed = parseArguments(argv);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    stderr.write(usage());
    return 2;
  }

  if (parsed.help) {
    stdout.write(usage());
    return 0;
  }

  const manifest = buildEvidenceCoverageManifest({ rootDir: parsed.options.rootDir });
  const json = JSON.stringify(manifest, null, parsed.options.pretty ? 2 : 0);
  stdout.write(`${json}\n`);

  return manifest.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  process.exitCode = runCli();
}
