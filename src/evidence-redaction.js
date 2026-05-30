import crypto from 'node:crypto';
import { digest } from './stable-json.js';

export const EVIDENCE_REDACTION_MARKER = 'reprint-push-evidence-redaction-v1';

const RAW_VALUE_KEYS = new Set([
  'aftervalue',
  'body',
  'content',
  'contents',
  'data',
  'metavalue',
  'optionvalue',
  'payload',
  'postcontent',
  'postexcerpt',
  'posttitle',
  'privatecontent',
  'raw',
  'serialized',
  'serializedpayload',
  'serializedvalue',
  'value',
  'values',
  'beforevalue',
]);

const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'applicationpassword',
  'apppassword',
  'authorization',
  'bearer',
  'clientsecret',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrftoken',
  'idtoken',
  'nonce',
  'password',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'session',
  'sessioncookie',
  'sessionid',
  'sessiontoken',
  'setcookie',
  'token',
  'userpass',
]);

const SAFE_EVIDENCE_METADATA_KEYS = new Set([
  'applicationpasswordcredentialbinding',
  'authsourcecommandreadback',
  'authsessionsourcecommand',
  'productionsecret',
]);

export function redactEvidence(value, options = {}) {
  const pathParts = Array.isArray(options.path) ? options.path.map(String) : [];
  return redactNode(value, {
    key: options.key,
    pathParts,
    seen: new WeakSet(),
  });
}

export function assertEvidenceHasNoRawValues(value, options = {}) {
  const issues = findEvidenceRedactionIssues(value, options);
  if (issues.length === 0) {
    return;
  }

  const label = options.label || 'Evidence';
  const firstIssue = issues[0];
  const error = new Error(
    `${label} contains raw or sensitive evidence at ${firstIssue.path} (${firstIssue.reason}).`,
  );
  error.code = options.code || 'EVIDENCE_RAW_VALUE_FIELD';
  error.issues = issues;
  throw error;
}

export function findEvidenceRedactionIssues(value, options = {}) {
  const pathParts = Array.isArray(options.path) ? options.path.map(String) : [];
  const issues = [];
  visitForIssues(value, {
    key: options.key,
    pathParts,
    issues,
    seen: new WeakSet(),
  });
  return issues;
}

function redactNode(value, context) {
  if (isRedactedEvidence(value)) {
    return cloneEvidenceValue(value);
  }

  const pathReason = redactionReasonForPath(context.pathParts);
  if (pathReason) {
    return redactionSummary(value, pathReason);
  }

  const reason = redactionReasonForKey(context.key);
  if (reason) {
    return redactionSummary(value, reason);
  }

  if (shouldPreserveHashMetadata(context.key)) {
    return cloneEvidenceValue(value);
  }

  const stringReason = typeof value === 'string' ? redactionReasonForString(value) : null;
  if (stringReason) {
    return redactionSummary(value, stringReason);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactNode(item, {
      key: String(index),
      pathParts: [...context.pathParts, String(index)],
      seen: context.seen,
    }));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (context.seen.has(value)) {
    return redactionSummary('[Circular evidence reference]', 'circular-reference');
  }
  context.seen.add(value);

  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = redactNode(child, {
      key,
      pathParts: [...context.pathParts, key],
      seen: context.seen,
    });
  }
  context.seen.delete(value);
  return redacted;
}

function visitForIssues(value, context) {
  if (isRedactedEvidence(value)) {
    return;
  }

  const pathReason = redactionReasonForPath(context.pathParts);
  if (pathReason) {
    context.issues.push(issueFor(value, pathReason, context.pathParts));
    return;
  }

  const reason = redactionReasonForKey(context.key);
  if (reason) {
    context.issues.push(issueFor(value, reason, context.pathParts));
    return;
  }

  if (shouldPreserveHashMetadata(context.key)) {
    return;
  }

  const stringReason = typeof value === 'string' ? redactionReasonForString(value) : null;
  if (stringReason) {
    context.issues.push(issueFor(value, stringReason, context.pathParts));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitForIssues(item, {
      key: String(index),
      pathParts: [...context.pathParts, String(index)],
      issues: context.issues,
      seen: context.seen,
    }));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (context.seen.has(value)) {
    context.issues.push(issueFor('[Circular evidence reference]', 'circular-reference', context.pathParts));
    return;
  }
  context.seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    visitForIssues(child, {
      key,
      pathParts: [...context.pathParts, key],
      issues: context.issues,
      seen: context.seen,
    });
  }
  context.seen.delete(value);
}

function redactionReasonForKey(key) {
  if (key === undefined || key === null) {
    return null;
  }

  const normalized = normalizeKey(key);
  if (SAFE_EVIDENCE_METADATA_KEYS.has(normalized)) {
    return null;
  }
  if (shouldPreserveHashMetadata(key)) {
    return null;
  }
  if (RAW_VALUE_KEYS.has(normalized)) {
    return 'raw-site-value-field';
  }
  if (SENSITIVE_KEYS.has(normalized) || isSensitiveSuffixKey(normalized)) {
    return 'secret-or-session-field';
  }
  return null;
}

function redactionReasonForPath(pathParts) {
  if (!Array.isArray(pathParts) || pathParts.length < 3) {
    return null;
  }
  const normalized = pathParts.map(normalizeKey);
  const tail = normalized.slice(-3);
  if (tail[0] === 'recovery' && tail[1] === 'artifacts' && tail[2] === 'remote') {
    return 'recovery-artifact-site-snapshot';
  }
  return null;
}

function shouldPreserveHashMetadata(key) {
  if (key === undefined || key === null) {
    return false;
  }
  const normalized = normalizeKey(key);
  if (hasSensitiveWord(normalized)) {
    return false;
  }
  return normalized === 'hash'
    || normalized === 'hashes'
    || normalized === 'sha256'
    || normalized === 'digest'
    || normalized === 'checksum'
    || normalized.endsWith('hash')
    || normalized.endsWith('hashes')
    || normalized.endsWith('digest')
    || normalized.endsWith('checksum');
}

function isSensitiveSuffixKey(normalizedKey) {
  if (SAFE_EVIDENCE_METADATA_KEYS.has(normalizedKey)) {
    return false;
  }
  return normalizedKey.endsWith('password')
    || normalizedKey.endsWith('secret')
    || normalizedKey.endsWith('token')
    || normalizedKey.endsWith('nonce');
}

function hasSensitiveWord(normalizedKey) {
  return normalizedKey.includes('password')
    || normalizedKey.includes('secret')
    || normalizedKey.includes('token')
    || normalizedKey.includes('nonce')
    || normalizedKey.includes('credential')
    || normalizedKey.includes('authorization');
}

function redactionReasonForString(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^(?:authorization:\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+$/i.test(trimmed)) {
    return 'auth-token-string';
  }
  if (/(?:^|[;\s])(?:wordpress_logged_in|wp-settings|wordpress_sec|phpsessid|sessionid|session|token|nonce)=/i.test(trimmed)) {
    return 'session-token-string';
  }
  if (/(?:[?&]|\b)(?:password|application_password|client_secret|access_token|refresh_token|id_token|nonce)=([^&\s]+)/i.test(trimmed)) {
    return 'credential-parameter-string';
  }
  if (urlContainsCredentials(trimmed)) {
    return 'credential-url-string';
  }
  if (looksLikePhpSerializedOptionPayload(trimmed) || looksLikeJsonOptionPayload(trimmed)) {
    return 'serialized-option-payload';
  }
  return null;
}

function looksLikePhpSerializedOptionPayload(value) {
  return /^(?:a|O|s|i|b|d):\d+[:;]/.test(value) || value === 'N;';
}

function looksLikeJsonOptionPayload(value) {
  if (!/^[{[]/.test(value)) {
    return false;
  }
  return /"(?:option_value|meta_value|post_content|post_excerpt|post_title|user_pass|private_content|value|values|content)"\s*:/.test(value);
}

function urlContainsCredentials(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function redactionSummary(value, reason) {
  return stripUndefined({
    redacted: true,
    redaction: EVIDENCE_REDACTION_MARKER,
    reason,
    valueType: valueType(value),
    sha256: safeDigest(value),
    characterCount: typeof value === 'string' ? value.length : undefined,
    itemCount: Array.isArray(value) ? value.length : undefined,
    fieldCount: value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length
      : undefined,
  });
}

function issueFor(value, reason, pathParts) {
  return stripUndefined({
    path: formatPath(pathParts),
    reason,
    valueType: valueType(value),
    sha256: safeDigest(value),
    characterCount: typeof value === 'string' ? value.length : undefined,
    itemCount: Array.isArray(value) ? value.length : undefined,
    fieldCount: value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length
      : undefined,
  });
}

function isRedactedEvidence(value) {
  return Boolean(value)
    && typeof value === 'object'
    && value.redacted === true
    && value.redaction === EVIDENCE_REDACTION_MARKER;
}

function safeDigest(value) {
  try {
    return digest(value);
  } catch {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }
}

function cloneEvidenceValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneEvidenceValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneEvidenceValue(child)]),
    );
  }
  return value;
}

function valueType(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function formatPath(pathParts) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) {
    return '$';
  }
  return `$${pathParts.map((part) => (/^\d+$/.test(part) ? `[${part}]` : `.${part}`)).join('')}`;
}

function normalizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function stripUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}
