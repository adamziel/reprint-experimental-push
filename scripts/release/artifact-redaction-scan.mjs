#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

const SCANNABLE_EXTENSIONS = new Set([
  '.htm',
  '.html',
  '.json',
  '.log',
  '.markdown',
  '.md',
  '.text',
  '.txt',
]);

const RAW_HTTP_URL = 'RAW_HTTP_URL';
const CREDENTIAL_VALUE = 'CREDENTIAL_VALUE';
const TOKEN_VALUE = 'TOKEN_VALUE';
const COOKIE_VALUE = 'COOKIE_VALUE';
const SERIALIZED_PRIVATE_OPTION = 'SERIALIZED_PRIVATE_OPTION';
const SECRET_LIKE_KEY = 'SECRET_LIKE_KEY';
const PATH_NOT_FOUND = 'PATH_NOT_FOUND';
const PATH_NOT_FILE_OR_DIRECTORY = 'PATH_NOT_FILE_OR_DIRECTORY';
const UNSCANNABLE_ARTIFACT_TYPE = 'UNSCANNABLE_ARTIFACT_TYPE';
const BINARY_ARTIFACT = 'BINARY_ARTIFACT';
const FILE_READ_FAILED = 'FILE_READ_FAILED';
const NO_INPUT_PATHS = 'NO_INPUT_PATHS';

export const ARTIFACT_REDACTION_REASON_CODES = Object.freeze({
  RAW_HTTP_URL,
  CREDENTIAL_VALUE,
  TOKEN_VALUE,
  COOKIE_VALUE,
  SERIALIZED_PRIVATE_OPTION,
  SECRET_LIKE_KEY,
  PATH_NOT_FOUND,
  PATH_NOT_FILE_OR_DIRECTORY,
  UNSCANNABLE_ARTIFACT_TYPE,
  BINARY_ARTIFACT,
  FILE_READ_FAILED,
  NO_INPUT_PATHS,
});

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\\)\]\}]+/gi;
const APP_PASSWORD_PATTERN = /\b(?:[A-Za-z0-9]{4}[ -]){5}[A-Za-z0-9]{4}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\b(Bearer)\s+([A-Za-z0-9._~+/=-]{12,})\b/gi;
const BASIC_PATTERN = /\b(Basic)\s+([A-Za-z0-9+/=]{16,})\b/gi;
const PREFIXED_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|pat_[A-Za-z0-9_]{20,})\b/g;
const COOKIE_HEADER_PATTERN = /\b(?:Set-Cookie|Cookie)\s*[:=]\s*[^\n\r]+/gi;
const COOKIE_ASSIGNMENT_PATTERN = /\b(?:wordpress_(?:logged_in|sec|auth)_[^=\s;"']*|PHPSESSID|sessionid|auth_cookie)=[^\s;"']+/gi;
const SERIALIZED_PRIVATE_OPTION_PATTERN = /\b[adObis]:\d+:[^\n\r]*(?:s:\d+:\\?"(?:private[_-]?(?:key|notes?)|operator[_-]?notes?|secret[_-]?notes?|auth[_-]?token|application[_-]?password|client[_-]?secret|api[_-]?key|password)\\?"|\\?"(?:private[_-]?(?:key|notes?)|operator[_-]?notes?|secret[_-]?notes?|auth[_-]?token|application[_-]?password|client[_-]?secret|api[_-]?key|password)\\?")[^\n\r]*/i;
const KEY_VALUE_PATTERN = /(?<key>["']?[A-Za-z_][A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|cookie|authorization|api[_-]?key|private[_-]?(?:key|notes?)|operator[_-]?(?:secret|notes?))[A-Za-z0-9_.-]*["']?)\s*(?<separator>[:=]|=>)\s*(?<value>"[^"\n\r]*"|'[^'\n\r]*'|`[^`\n\r]*`|[^\s,;}\])]+)/gi;
const HASH_METADATA_PATTERN = /(?:^|[\s,{["'])([A-Za-z0-9_.-]*(?:hash|digest|checksum|fingerprint)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?((?:sha(?:1|224|256|384|512):)?(?:[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128}))["']?/gi;

const HASH_VALUE_PATTERN = /^(?:sha(?:1|224|256|384|512):)?(?:[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/i;
const REDACTED_VALUE_PATTERN = /^(?:<?\[?redacted\]?>?|\*{3,}|x{3,}|n\/a|none|null|undefined|empty)$/i;
const SAFE_BOOLEAN_PATTERN = /^(?:true|false|null)$/i;
const PLACEHOLDER_VALUE_PATTERN = /^<(?=[a-z0-9._ -]*(?:placeholder|redacted|example|production|same-live|real-live))[a-z0-9][a-z0-9._ -]*>$/i;
const SANDBOX_DOCKER_HOSTNAMES = new Set([
  'wp-apply-revalidation-source',
  'wp-local-edited',
  'wp-remote-changed',
  'wp-source',
]);

export async function scanArtifacts(inputPaths, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const inputs = [...inputPaths];
  const filesByPath = new Map();
  const earlyRejectedFiles = [];

  if (inputs.length === 0) {
    earlyRejectedFiles.push(rejectedFile('(input)', {
      code: NO_INPUT_PATHS,
      line: 0,
      column: 0,
      preview: 'Pass at least one release or evidence artifact path to scan.',
    }));
  }

  for (const inputPath of inputs) {
    const resolvedInputPath = path.resolve(cwd, inputPath);
    let stats;
    try {
      stats = await fs.stat(resolvedInputPath);
    } catch (error) {
      earlyRejectedFiles.push(rejectedFile(displayPath(resolvedInputPath, cwd), {
        code: PATH_NOT_FOUND,
        line: 0,
        column: 0,
        preview: redactPreview(String(inputPath || error.message)),
      }));
      continue;
    }

    if (stats.isDirectory()) {
      const discoveredFiles = await collectArtifactFiles(resolvedInputPath, cwd);
      for (const file of discoveredFiles.files) {
        filesByPath.set(file, file);
      }
      earlyRejectedFiles.push(...discoveredFiles.rejectedFiles);
      continue;
    }

    if (!stats.isFile()) {
      earlyRejectedFiles.push(rejectedFile(displayPath(resolvedInputPath, cwd), {
        code: PATH_NOT_FILE_OR_DIRECTORY,
        line: 0,
        column: 0,
        preview: 'Path is neither a file nor a directory.',
      }));
      continue;
    }

    if (!isScannableArtifactPath(resolvedInputPath)) {
      earlyRejectedFiles.push(rejectedFile(displayPath(resolvedInputPath, cwd), unsupportedArtifactReason(resolvedInputPath)));
      continue;
    }

    filesByPath.set(resolvedInputPath, resolvedInputPath);
  }

  const files = [...filesByPath.values()].sort((left, right) => displayPath(left, cwd).localeCompare(displayPath(right, cwd)));
  const scannedFiles = [];
  const scanRejectedFiles = [];
  let allowedHashEvidence = 0;

  for (const file of files) {
    const artifactPath = displayPath(file, cwd);
    scannedFiles.push(artifactPath);

    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      scanRejectedFiles.push(rejectedFile(artifactPath, {
        code: FILE_READ_FAILED,
        line: 0,
        column: 0,
        preview: redactPreview(error.message),
      }));
      continue;
    }

    if (text.includes('\0')) {
      scanRejectedFiles.push(rejectedFile(artifactPath, {
        code: BINARY_ARTIFACT,
        line: 0,
        column: 0,
        preview: 'Artifact contains NUL bytes and cannot be scanned as text.',
      }));
      continue;
    }

    const scanResult = scanArtifactText(text);
    allowedHashEvidence += scanResult.allowedHashEvidence;

    if (scanResult.reasons.length > 0) {
      scanRejectedFiles.push(rejectedFile(artifactPath, ...scanResult.reasons));
    }
  }

  const rejectedFiles = [...earlyRejectedFiles, ...scanRejectedFiles]
    .map((entry) => ({
      file: entry.file,
      reasons: [...entry.reasons].sort(compareReasons),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));

  return {
    ok: rejectedFiles.length === 0,
    scannedFiles,
    rejectedFiles,
    allowedHashEvidence,
  };
}

export function scanArtifactText(text) {
  const reasons = [];
  let allowedHashEvidence = 0;
  const seen = new Set();
  const lines = splitLines(String(text));

  for (const { line, number } of lines) {
    allowedHashEvidence += countAllowedHashEvidence(line);
    scanRawUrls(line, number, reasons, seen);
    scanSerializedPrivateOptions(line, number, reasons, seen);
    scanCookies(line, number, reasons, seen);
    scanApplicationPasswords(line, number, reasons, seen);
    scanTokenValues(line, number, reasons, seen);
    scanSecretLikeKeys(line, number, reasons, seen);
  }

  reasons.sort(compareReasons);

  return { reasons, allowedHashEvidence };
}

export function isAllowedDocumentedUrl(rawUrl) {
  const trimmedUrl = trimUrlToken(rawUrl);
  let parsed;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const loopbackHost = hostname === 'localhost'
    || hostname === '::1'
    || hostname === '0:0:0:0:0:0:0:1'
    || hostname === '0.0.0.0'
    || hostname.startsWith('127.');

  if (loopbackHost && port === '8080') {
    return true;
  }

  return parsed.protocol === 'http:'
    && parsed.username === ''
    && parsed.password === ''
    && parsed.port === ''
    && parsed.pathname === '/'
    && parsed.search === ''
    && parsed.hash === ''
    && SANDBOX_DOCKER_HOSTNAMES.has(hostname);
}

export function isScannableArtifactPath(filePath) {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function redactPreview(rawLine) {
  let preview = String(rawLine || '').replace(/\s+/g, ' ').trim();

  preview = preview.replace(URL_PATTERN, (match) => {
    const token = trimUrlToken(match);
    if (isAllowedDocumentedUrl(token)) {
      return token;
    }
    return '<redacted:RAW_HTTP_URL>';
  });
  preview = preview.replace(SERIALIZED_PRIVATE_OPTION_PATTERN, '<redacted:SERIALIZED_PRIVATE_OPTION>');
  preview = preview.replace(COOKIE_HEADER_PATTERN, (match) => `${match.split(/[:=]/, 1)[0]}: <redacted:COOKIE_VALUE>`);
  preview = preview.replace(COOKIE_ASSIGNMENT_PATTERN, (match) => `${match.split('=', 1)[0]}=<redacted:COOKIE_VALUE>`);
  preview = preview.replace(APP_PASSWORD_PATTERN, '<redacted:CREDENTIAL_VALUE>');
  preview = preview.replace(JWT_PATTERN, '<redacted:TOKEN_VALUE>');
  preview = preview.replace(BEARER_PATTERN, '$1 <redacted:TOKEN_VALUE>');
  preview = preview.replace(BASIC_PATTERN, '$1 <redacted:TOKEN_VALUE>');
  preview = preview.replace(PREFIXED_TOKEN_PATTERN, '<redacted:TOKEN_VALUE>');
  preview = preview.replace(KEY_VALUE_PATTERN, (match, _key, _separator, _value, offset, fullText, groups = {}) => {
    const key = stripQuotes(groups.key || '');
    const value = stripQuotes(groups.value || '');
    if (!isSecretLikeKey(key) || isAllowedSecretLikeValue(key, value)) {
      return match;
    }

    return `${groups.key}${groups.separator}<redacted:SECRET_VALUE>`;
  });

  if (preview.length > 180) {
    preview = `${preview.slice(0, 177)}...`;
  }

  return preview;
}

async function collectArtifactFiles(rootDirectory, cwd) {
  const files = [];
  const rejectedFiles = [];
  let entries;
  try {
    entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    rejectedFiles.push(rejectedFile(displayPath(rootDirectory, cwd), {
      code: FILE_READ_FAILED,
      line: 0,
      column: 0,
      preview: redactPreview(error.message),
    }));
    return { files, rejectedFiles };
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      const child = await collectArtifactFiles(fullPath, cwd);
      files.push(...child.files);
      rejectedFiles.push(...child.rejectedFiles);
      continue;
    }

    if (!entry.isFile()) {
      rejectedFiles.push(rejectedFile(displayPath(fullPath, cwd), {
        code: PATH_NOT_FILE_OR_DIRECTORY,
        line: 0,
        column: 0,
        preview: 'Directory entry is neither a file nor a directory.',
      }));
      continue;
    }

    if (!isScannableArtifactPath(fullPath)) {
      rejectedFiles.push(rejectedFile(displayPath(fullPath, cwd), unsupportedArtifactReason(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return { files, rejectedFiles };
}

function scanRawUrls(line, lineNumber, reasons, seen) {
  for (const match of line.matchAll(URL_PATTERN)) {
    const token = trimUrlToken(match[0]);
    if (!isAllowedDocumentedUrl(token)) {
      addReason(reasons, seen, RAW_HTTP_URL, lineNumber, match.index + 1, line);
    }
  }
}

function scanSerializedPrivateOptions(line, lineNumber, reasons, seen) {
  const match = SERIALIZED_PRIVATE_OPTION_PATTERN.exec(line);
  SERIALIZED_PRIVATE_OPTION_PATTERN.lastIndex = 0;
  if (match) {
    addReason(reasons, seen, SERIALIZED_PRIVATE_OPTION, lineNumber, match.index + 1, line);
  }
}

function scanCookies(line, lineNumber, reasons, seen) {
  for (const match of line.matchAll(COOKIE_HEADER_PATTERN)) {
    if (!isRedactedValue(match[0])) {
      addReason(reasons, seen, COOKIE_VALUE, lineNumber, match.index + 1, line);
    }
  }

  for (const match of line.matchAll(COOKIE_ASSIGNMENT_PATTERN)) {
    if (!isRedactedValue(match[0])) {
      addReason(reasons, seen, COOKIE_VALUE, lineNumber, match.index + 1, line);
    }
  }
}

function scanApplicationPasswords(line, lineNumber, reasons, seen) {
  for (const match of line.matchAll(APP_PASSWORD_PATTERN)) {
    addReason(reasons, seen, CREDENTIAL_VALUE, lineNumber, match.index + 1, line);
  }
}

function scanTokenValues(line, lineNumber, reasons, seen) {
  for (const pattern of [JWT_PATTERN, BEARER_PATTERN, BASIC_PATTERN, PREFIXED_TOKEN_PATTERN]) {
    for (const match of line.matchAll(pattern)) {
      addReason(reasons, seen, TOKEN_VALUE, lineNumber, match.index + 1, line);
    }
  }
}

function scanSecretLikeKeys(line, lineNumber, reasons, seen) {
  for (const match of line.matchAll(KEY_VALUE_PATTERN)) {
    const { key: rawKey, value: rawValue } = match.groups;
    const key = stripQuotes(rawKey);
    const value = stripQuotes(rawValue);

    if (!isSecretLikeKey(key) || isAllowedSecretLikeValue(key, value)) {
      continue;
    }

    const code = reasonCodeForSecretLikeKey(key, value);
    addReason(reasons, seen, code, lineNumber, match.index + 1, line);
  }
}

function reasonCodeForSecretLikeKey(key, value) {
  const normalizedKey = normalizeKey(key);
  if (normalizedKey.includes('cookie')) {
    return COOKIE_VALUE;
  }
  if (normalizedKey.includes('token') || normalizedKey.includes('authorization') || normalizedKey.includes('apikey')) {
    return looksLikeTokenValue(value) ? TOKEN_VALUE : SECRET_LIKE_KEY;
  }
  if (normalizedKey.includes('password') || normalizedKey.includes('passwd') || normalizedKey.includes('pwd')) {
    return looksLikeApplicationPasswordValue(value) ? CREDENTIAL_VALUE : SECRET_LIKE_KEY;
  }
  return SECRET_LIKE_KEY;
}

function addReason(reasons, seen, code, line, column, rawPreview) {
  const preview = redactPreview(rawPreview);
  const key = `${code}\0${line}\0${column}\0${preview}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  reasons.push({ code, line, column, preview });
}

function countAllowedHashEvidence(line) {
  let count = 0;
  for (const match of line.matchAll(HASH_METADATA_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (isHashEvidenceKey(key) && HASH_VALUE_PATTERN.test(value)) {
      count += 1;
    }
  }
  return count;
}

function isSecretLikeKey(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return false;
  }
  if (isHashEvidenceKey(normalizedKey) || normalizedKey.endsWith('present') || normalizedKey.endsWith('redacted')) {
    return false;
  }

  return normalizedKey.includes('password')
    || normalizedKey.includes('passwd')
    || normalizedKey.includes('pwd')
    || normalizedKey.includes('token')
    || normalizedKey.includes('secret')
    || normalizedKey.includes('cookie')
    || normalizedKey.includes('authorization')
    || normalizedKey.includes('apikey')
    || normalizedKey.includes('privatekey')
    || normalizedKey.includes('privatenote')
    || normalizedKey.includes('operatornote');
}

function isAllowedSecretLikeValue(key, value) {
  const normalizedKey = normalizeKey(key);
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue || isRedactedValue(normalizedValue) || SAFE_BOOLEAN_PATTERN.test(normalizedValue)) {
    return true;
  }

  if (isHashEvidenceKey(normalizedKey) && HASH_VALUE_PATTERN.test(normalizedValue)) {
    return true;
  }

  return false;
}

function isRedactedValue(value) {
  const normalizedValue = stripQuotes(String(value || '').trim()).trim();
  const unpunctuatedValue = normalizedValue.replace(/[.,;:!?]+$/g, '');
  return REDACTED_VALUE_PATTERN.test(unpunctuatedValue)
    || PLACEHOLDER_VALUE_PATTERN.test(unpunctuatedValue)
    || /^redacted(?:\b|[-_\s].*)/i.test(unpunctuatedValue)
    || /^<[^>]*redacted[^>]*>$/i.test(unpunctuatedValue)
    || /^\[[^\]]*redacted[^\]]*\]$/i.test(unpunctuatedValue);
}

function looksLikeApplicationPasswordValue(value) {
  return matchesPattern(APP_PASSWORD_PATTERN, value);
}

function looksLikeTokenValue(value) {
  const normalizedValue = stripQuotes(String(value || '').trim());
  if (HASH_VALUE_PATTERN.test(normalizedValue)) {
    return false;
  }

  return matchesPattern(JWT_PATTERN, normalizedValue)
    || matchesPattern(PREFIXED_TOKEN_PATTERN, normalizedValue)
    || /^[A-Za-z0-9._~+/=-]{20,}$/.test(normalizedValue);
}

function matchesPattern(pattern, value) {
  pattern.lastIndex = 0;
  const matched = pattern.test(value);
  pattern.lastIndex = 0;
  return matched;
}

function isHashEvidenceKey(key) {
  const normalizedKey = normalizeKey(key);
  return normalizedKey.includes('hash')
    || normalizedKey.includes('digest')
    || normalizedKey.includes('checksum')
    || normalizedKey.includes('fingerprint');
}

function normalizeKey(key) {
  return stripQuotes(String(key || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripQuotes(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
    || (text.startsWith('`') && text.endsWith('`'))) {
    return text.slice(1, -1);
  }
  return text;
}

function splitLines(text) {
  const rawLines = String(text).split(/\r?\n/);
  return rawLines.map((line, index) => ({ line, number: index + 1 }));
}

function trimUrlToken(rawUrl) {
  return String(rawUrl || '').replace(/[.,;:!?]+$/g, '');
}

function unsupportedArtifactReason(filePath) {
  return {
    code: UNSCANNABLE_ARTIFACT_TYPE,
    line: 0,
    column: 0,
    preview: `Unsupported artifact extension ${path.extname(filePath) || '(none)'}. Use text, JSON, Markdown, or HTML evidence files.`,
  };
}

function rejectedFile(file, ...reasons) {
  return {
    file: normalizePath(file),
    reasons: reasons.map((reason) => ({
      code: reason.code,
      line: reason.line,
      column: reason.column,
      preview: reason.preview,
    })),
  };
}

function displayPath(filePath, cwd) {
  const relative = path.relative(cwd, filePath);
  if (!relative) {
    return normalizePath(path.basename(filePath));
  }
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return normalizePath(filePath);
  }
  return normalizePath(relative);
}

function normalizePath(filePath) {
  return String(filePath).split(path.sep).join('/');
}

function compareReasons(left, right) {
  return left.line - right.line
    || left.column - right.column
    || left.code.localeCompare(right.code)
    || left.preview.localeCompare(right.preview);
}

async function main() {
  const report = await scanArtifacts(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (isMainModule) {
  main().catch((error) => {
    const report = {
      ok: false,
      scannedFiles: [],
      rejectedFiles: [rejectedFile('(scanner)', {
        code: FILE_READ_FAILED,
        line: 0,
        column: 0,
        preview: redactPreview(error.stack || error.message || String(error)),
      })],
      allowedHashEvidence: 0,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  });
}
