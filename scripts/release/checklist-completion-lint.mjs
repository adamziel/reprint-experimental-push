#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKLIST_RELATIVE_PATH = 'docs/reprint-push-completion-checklist.md';
const RPP_ID_PATTERN = /\bRPP-(\d{4})\b/g;
const CHECKLIST_ITEM_PATTERN = /^\s*[-*]\s+\[(?<state>[ xX])]\s+(?<id>RPP-\d{4})\b/;
const RPP_RANGE_PATTERN = /\bRPP-(?<start>\d{4})\b\s*(?:through|to|[-–—]|\.\.)\s*\bRPP-(?<end>\d{4})\b/gi;
const SNIPPET_LIMIT = 320;

const SCAN_TARGETS = Object.freeze([
  { type: 'dir', path: 'docs/evidence', extension: '.md' },
  { type: 'dir', path: 'audits', extension: '.md' },
  { type: 'file', path: 'docs/progress-log.md' },
  { type: 'file', path: 'docs/supervisor-feedback.md' },
  { type: 'file', path: 'progress.html' },
]);

const RISKY_PATTERNS = Object.freeze([
  {
    term: 'complete',
    reasonCode: 'RISKY_TERM_COMPLETE',
    regex: /\bcomplete\b/i,
  },
  {
    term: 'done',
    reasonCode: 'RISKY_TERM_DONE',
    regex: /\bdone\b/i,
  },
  {
    term: 'release-ready',
    reasonCode: 'RISKY_TERM_RELEASE_READY',
    regex: /\brelease[-\s]?ready\b/i,
  },
  {
    term: 'passed',
    reasonCode: 'RISKY_TERM_PASSED',
    regex: /\bpassed\b/i,
  },
]);

const CAUTIOUS_PATTERNS = Object.freeze([
  {
    phrase: 'evidence toward',
    regex: /\bevidence\s+(?:toward|towards)\b/i,
  },
  {
    phrase: 'claimed evidence toward',
    regex: /\bclaimed\s+evidence\s+(?:toward|towards)\b/i,
  },
  {
    phrase: 'release remains held',
    regex: /\brelease\s+remains\s+held\b/i,
  },
  {
    phrase: 'not complete',
    regex: /\bnot\s+complete\b/i,
  },
  {
    phrase: 'not done',
    regex: /\bnot\s+done\b/i,
  },
  {
    phrase: 'not release-ready',
    regex: /\bnot\s+release[-\s]?ready\b/i,
  },
  {
    phrase: 'remain unchecked',
    regex: /\bremains?\s+unchecked\b/i,
  },
  {
    phrase: 'still unchecked',
    regex: /\bstill\s+unchecked\b/i,
  },
  {
    phrase: 'remaining work',
    regex: /\bremaining\s+work\b/i,
  },
  {
    phrase: 'no checklist item should be marked complete',
    regex: /\bno\s+checklist\s+item\s+should\s+be\s+marked\s+complete\b/i,
  },
  {
    phrase: 'do not mark complete',
    regex: /\bdo\s+not\s+mark\b[\s\S]{0,80}\bcomplete\b/i,
  },
]);

function posixPath(inputPath) {
  return inputPath.split(path.sep).join('/');
}

function stablePathFromRoot(rootDir, inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const relativePath = path.relative(rootDir, resolvedPath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return posixPath(relativePath);
  }
  return posixPath(resolvedPath);
}

function compareRppIds(a, b) {
  const aNumber = Number(a.slice('RPP-'.length));
  const bNumber = Number(b.slice('RPP-'.length));
  return aNumber - bNumber || a.localeCompare(b);
}

function sortUnique(values) {
  return [...new Set(values)].sort();
}

function sortUniqueRppIds(values) {
  return [...new Set(values)].sort(compareRppIds);
}

function normalizeSnippet(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SNIPPET_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, SNIPPET_LIMIT - 1)}…`;
}

export function parseChecklist(checklistPath) {
  const resolvedChecklistPath = path.resolve(checklistPath);
  const checklist = {
    file: posixPath(resolvedChecklistPath),
    checkedIds: [],
    uncheckedIds: [],
    allIds: [],
    items: new Map(),
    errors: [],
  };

  if (!fs.existsSync(resolvedChecklistPath)) {
    checklist.errors.push({
      reasonCode: 'CHECKLIST_MISSING',
      file: posixPath(resolvedChecklistPath),
    });
    return checklist;
  }

  const text = fs.readFileSync(resolvedChecklistPath, 'utf8');
  const seen = new Map();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const match = line.match(CHECKLIST_ITEM_PATTERN);
    if (!match?.groups) {
      return;
    }

    const { id, state } = match.groups;
    const item = {
      id,
      checked: state.toLowerCase() === 'x',
      line: lineIndex + 1,
    };
    checklist.allIds.push(id);

    if (seen.has(id)) {
      const previous = seen.get(id);
      checklist.errors.push({
        reasonCode: 'CHECKLIST_DUPLICATE_ID',
        id,
        file: posixPath(resolvedChecklistPath),
        lines: [previous.line, item.line].sort((a, b) => a - b),
      });
      return;
    }

    seen.set(id, item);
    checklist.items.set(id, item);
  });

  checklist.checkedIds = [...checklist.items.values()]
    .filter((item) => item.checked)
    .map((item) => item.id)
    .sort(compareRppIds);
  checklist.uncheckedIds = [...checklist.items.values()]
    .filter((item) => !item.checked)
    .map((item) => item.id)
    .sort(compareRppIds);
  checklist.allIds = sortUniqueRppIds(checklist.allIds);
  checklist.errors.sort(compareChecklistErrors);

  return checklist;
}

function compareChecklistErrors(a, b) {
  return (a.reasonCode || '').localeCompare(b.reasonCode || '')
    || (a.id || '').localeCompare(b.id || '')
    || (a.file || '').localeCompare(b.file || '')
    || ((a.lines?.[0] || 0) - (b.lines?.[0] || 0));
}

export function collectScanFiles(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];

  for (const target of SCAN_TARGETS) {
    const absoluteTargetPath = path.join(root, target.path);
    if (target.type === 'file') {
      if (fs.existsSync(absoluteTargetPath) && fs.statSync(absoluteTargetPath).isFile()) {
        files.push(target.path);
      }
      continue;
    }

    if (!fs.existsSync(absoluteTargetPath) || !fs.statSync(absoluteTargetPath).isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteTargetPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(target.extension)) {
        files.push(posixPath(path.join(target.path, entry.name)));
      }
    }
  }

  return sortUnique(files);
}

function matchedRiskyTerms(context) {
  return RISKY_PATTERNS
    .filter((pattern) => pattern.regex.test(context))
    .map(({ term, reasonCode }) => ({ term, reasonCode }))
    .sort((a, b) => a.term.localeCompare(b.term));
}

function cautiousPhrases(context) {
  return CAUTIOUS_PATTERNS
    .filter((pattern) => pattern.regex.test(context))
    .map(({ phrase }) => phrase)
    .sort();
}

function expandRangeIds(context, checklistItems) {
  const ids = [];
  for (const match of context.matchAll(RPP_RANGE_PATTERN)) {
    const startNumber = Number(match.groups.start);
    const endNumber = Number(match.groups.end);
    if (!Number.isInteger(startNumber) || !Number.isInteger(endNumber)) {
      continue;
    }

    const lower = Math.min(startNumber, endNumber);
    const upper = Math.max(startNumber, endNumber);
    for (let number = lower; number <= upper; number += 1) {
      const id = `RPP-${String(number).padStart(4, '0')}`;
      if (!checklistItems || checklistItems.has(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function referencedRppIds(context, checklistItems) {
  const ids = [];
  for (const match of context.matchAll(RPP_ID_PATTERN)) {
    ids.push(`RPP-${match[1]}`);
  }
  ids.push(...expandRangeIds(context, checklistItems));
  return sortUniqueRppIds(ids);
}

function isListItemStart(line) {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function shouldIncludeAdjacentLine(currentLine, adjacentLine, direction) {
  if (!adjacentLine.trim()) {
    return false;
  }
  if (direction === 'next' && isListItemStart(adjacentLine)) {
    return false;
  }
  if (direction === 'previous' && isListItemStart(currentLine)) {
    return false;
  }
  return true;
}

function contextForLine(lines, lineIndex) {
  const context = [];
  const currentLine = lines[lineIndex];
  const previousLine = lines[lineIndex - 1];
  const nextLine = lines[lineIndex + 1];

  if (
    typeof previousLine === 'string'
    && shouldIncludeAdjacentLine(currentLine, previousLine, 'previous')
  ) {
    context.push(previousLine);
  }
  context.push(currentLine);
  if (
    typeof nextLine === 'string'
    && shouldIncludeAdjacentLine(currentLine, nextLine, 'next')
  ) {
    context.push(nextLine);
  }
  return context.join('\n');
}

function findRiskyClaimsInFile({ rootDir, relativeFile, checklist }) {
  const absoluteFile = path.join(rootDir, relativeFile);
  const text = fs.readFileSync(absoluteFile, 'utf8');
  const lines = text.split(/\r?\n/);
  const claimsByKey = new Map();

  lines.forEach((line, lineIndex) => {
    if (!RPP_ID_PATTERN.test(line)) {
      RPP_ID_PATTERN.lastIndex = 0;
      return;
    }
    RPP_ID_PATTERN.lastIndex = 0;

    const context = contextForLine(lines, lineIndex);
    const lineRiskyTerms = matchedRiskyTerms(line);
    const riskyTerms = lineRiskyTerms.length > 0 ? lineRiskyTerms : matchedRiskyTerms(context);
    if (riskyTerms.length === 0) {
      return;
    }

    const cautious = lineRiskyTerms.length > 0 ? cautiousPhrases(line) : cautiousPhrases(context);
    if (cautious.length > 0) {
      return;
    }

    for (const id of referencedRppIds(line, checklist.items)) {
      const item = checklist.items.get(id);
      if (!item || item.checked) {
        continue;
      }

      const reasonCodes = sortUnique([
        'RPP_ID_UNCHECKED',
        'RISKY_COMPLETION_LANGUAGE',
        ...riskyTerms.map((term) => term.reasonCode),
      ]);
      const key = `${relativeFile}\0${lineIndex + 1}\0${id}\0${reasonCodes.join(',')}`;
      claimsByKey.set(key, {
        file: relativeFile,
        line: lineIndex + 1,
        id,
        matchedTerms: riskyTerms.map((term) => term.term),
        reasonCodes,
        snippet: normalizeSnippet(context),
      });
    }
  });

  return [...claimsByKey.values()].sort(compareRiskyClaims);
}

function compareRiskyClaims(a, b) {
  return a.file.localeCompare(b.file)
    || (a.line - b.line)
    || compareRppIds(a.id, b.id)
    || a.snippet.localeCompare(b.snippet)
    || a.reasonCodes.join(',').localeCompare(b.reasonCodes.join(','));
}

export function lintChecklistCompletion(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const checklistPath = path.resolve(rootDir, options.checklistPath || CHECKLIST_RELATIVE_PATH);
  const checklist = parseChecklist(checklistPath);
  const checklistErrors = checklist.errors.map((error) => ({
    ...error,
    file: error.file ? stablePathFromRoot(rootDir, error.file) : error.file,
  }));
  const scannedFiles = collectScanFiles(rootDir);

  const riskyClaims = checklistErrors.length > 0
    ? []
    : scannedFiles.flatMap((relativeFile) => findRiskyClaimsInFile({
      rootDir,
      relativeFile,
      checklist,
    })).sort(compareRiskyClaims);

  const reasonCodes = sortUnique([
    ...checklistErrors.map((error) => error.reasonCode),
    ...riskyClaims.flatMap((claim) => claim.reasonCodes),
  ]);

  return {
    ok: checklistErrors.length === 0 && riskyClaims.length === 0,
    reasonCodes,
    riskyClaims,
    scannedFiles,
    checkedIds: checklist.checkedIds,
    uncheckedIds: checklist.uncheckedIds,
    checklistErrors,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--root requires a value');
      }
      options.rootDir = argv[index];
      continue;
    }
    if (arg === '--checklist') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--checklist requires a value');
      }
      options.checklistPath = argv[index];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/release/checklist-completion-lint.mjs [--root <dir>] [--checklist <path>]',
    '',
    'Scans evidence and progress docs for risky RPP checklist completion claims.',
    'Writes stable JSON and exits nonzero for missing/duplicate checklist IDs or risky unchecked claims.',
    '',
  ].join('\n'));
}

export function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    const result = {
      ok: false,
      reasonCodes: ['CLI_ARGUMENT_ERROR'],
      riskyClaims: [],
      scannedFiles: [],
      checkedIds: [],
      uncheckedIds: [],
      checklistErrors: [{
        reasonCode: 'CLI_ARGUMENT_ERROR',
        message: error.message,
      }],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 1;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = lintChecklistCompletion({
    rootDir: options.rootDir || defaultRootDir,
    checklistPath: options.checklistPath,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runCli();
}
