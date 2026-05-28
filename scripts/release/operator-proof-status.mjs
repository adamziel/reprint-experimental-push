#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const schemaVersion = 1;
const markerPrefix = 'RPP-OPERATOR-PROOF';

const failureReasons = Object.freeze({
  invalidJson: 'INVALID_JSON',
  usage: 'OPERATOR_PROOF_USAGE',
  missingTimestamp: 'MISSING_RELEASE_TIMESTAMP',
  invalidTimestamp: 'INVALID_RELEASE_TIMESTAMP',
  missingReleaseMovement: 'MISSING_RELEASE_MOVEMENT_SUMMARY',
  missingSourceUrl: 'MISSING_SOURCE_URL_EVIDENCE',
  missingLocalUrl: 'MISSING_LOCAL_URL_EVIDENCE',
  missingRemoteUrl: 'MISSING_REMOTE_URL_EVIDENCE',
  rawSecret: 'RAW_SECRET_VALUE',
  missingVerification: 'MISSING_VERIFICATION_RESULT',
  missingBlockedFailureReason: 'MISSING_BLOCKED_FAILURE_REASON',
  inconsistent: 'INCONSISTENT_READY_BLOCKED_EVIDENCE',
  internal: 'OPERATOR_PROOF_INTERNAL_ERROR',
});

const urlRoles = Object.freeze(['source', 'local', 'remote']);

export function evaluateOperatorProofStatus(input, options = {}) {
  const root = isRecord(input) ? input : {};
  const errors = [];
  const secretFindings = findRawSecretValues(root);
  for (const finding of secretFindings) {
    errors.push({
      code: failureReasons.rawSecret,
      path: finding.path,
      reason: 'Raw secret-looking values must be redacted or hashed before operator proof status is emitted.',
    });
  }

  const releaseTimestamp = resolveReleaseTimestamp(root);
  if (!releaseTimestamp.value) {
    errors.push({
      code: failureReasons.missingTimestamp,
      path: releaseTimestamp.path || '$.releaseTimestamp',
      reason: 'A release timestamp is required for operator proof status.',
    });
  } else if (!isIsoTimestamp(releaseTimestamp.value)) {
    errors.push({
      code: failureReasons.invalidTimestamp,
      path: releaseTimestamp.path,
      reason: 'Release timestamp must be an ISO-8601 string with timezone.',
    });
  }

  const releaseMovement = resolveReleaseMovement(root);
  if (!releaseMovement) {
    errors.push({
      code: failureReasons.missingReleaseMovement,
      path: '$.releaseMovement',
      reason: 'A releaseMovement allowed/denied summary is required.',
    });
  } else if (typeof releaseMovement.allowed !== 'boolean') {
    errors.push({
      code: failureReasons.missingReleaseMovement,
      path: releaseMovement.path,
      reason: 'releaseMovement.allowed must be true or false.',
    });
  }

  const urlEvidence = {};
  for (const role of urlRoles) {
    const resolvedUrl = resolveUrlRole(root, role);
    if (!resolvedUrl) {
      errors.push({
        code: role === 'source'
          ? failureReasons.missingSourceUrl
          : role === 'local'
            ? failureReasons.missingLocalUrl
            : failureReasons.missingRemoteUrl,
        path: `$.urls.${role}`,
        reason: `${role} URL evidence must be present as a redacted URL or sha256 hash.`,
      });
      continue;
    }
    urlEvidence[role] = resolvedUrl;
  }

  const verification = resolveVerificationResult(root);
  if (!verification) {
    errors.push({
      code: failureReasons.missingVerification,
      path: '$.verification',
      reason: 'A verification command result with command and integer exitCode is required.',
    });
  }

  const inputStatus = normalizeInputStatus(firstString(
    root.operatorStatus,
    root.proofStatus,
    root.status,
    root.gateState,
    releaseMovement?.state,
  ));
  const releaseAllowed = releaseMovement?.allowed;
  const verificationExitCode = verification?.exitCode;
  const verificationOk = verification?.ok;
  const derivedReady = releaseAllowed === true && verificationExitCode === 0 && verificationOk !== false;
  const derivedBlocked = releaseAllowed === false && Number.isInteger(verificationExitCode) && verificationExitCode !== 0;
  const targetStatus = inputStatus || (derivedReady ? 'ready' : derivedBlocked ? 'blocked' : null);
  const blockedFailureReason = resolveBlockedFailureReason(root, verification, releaseMovement);

  if (targetStatus === 'blocked') {
    if (!blockedFailureReason) {
      errors.push({
        code: failureReasons.missingBlockedFailureReason,
        path: '$.verification.failureReason',
        reason: 'Blocked operator proof status requires a nonzero verification failure reason code.',
      });
    }
  }

  const inconsistentReasons = [];
  if (targetStatus === 'ready') {
    if (releaseAllowed !== true) {
      inconsistentReasons.push('ready status requires releaseMovement.allowed=true');
    }
    if (verification && verification.exitCode !== 0) {
      inconsistentReasons.push('ready status requires verification exitCode=0');
    }
    if (verification?.ok === false) {
      inconsistentReasons.push('ready status requires verification ok=true or omitted');
    }
  } else if (targetStatus === 'blocked') {
    if (releaseAllowed === true) {
      inconsistentReasons.push('blocked status cannot have releaseMovement.allowed=true');
    }
    if (verification && verification.exitCode === 0) {
      inconsistentReasons.push('blocked status requires a nonzero verification exitCode');
    }
  } else if (releaseAllowed !== undefined || verification) {
    inconsistentReasons.push('operator proof status cannot be derived from releaseMovement and verification result');
  }

  if (inconsistentReasons.length > 0) {
    errors.push({
      code: failureReasons.inconsistent,
      path: '$',
      reason: inconsistentReasons.join('; '),
    });
  }

  const firstErrorCode = errors[0]?.code || null;
  const status = errors.length === 0 && targetStatus === 'ready' ? 'ready' : 'blocked';
  const ready = status === 'ready';
  const reasonCode = ready ? null : sanitizeReasonCode(firstErrorCode || blockedFailureReason || releaseMovement?.code || 'OPERATOR_PROOF_BLOCKED');
  const marker = formatOperatorProofMarker({ status, reasonCode });

  return deepFreeze({
    schemaVersion,
    evaluator: 'reprint-push-operator-proof-status',
    generatedAt: options.generatedAt || null,
    ok: ready,
    status,
    ready,
    reasonCode,
    marker,
    releaseTimestamp: releaseTimestamp.value || null,
    releaseMovement: releaseMovement ? sanitizeReleaseMovement(releaseMovement) : null,
    verification: verification ? sanitizeVerification(verification) : null,
    urlEvidence,
    errors,
    secretFindings: secretFindings.map((finding) => ({ path: finding.path, key: finding.key })),
  });
}

export function formatOperatorProofMarker(status) {
  const proofStatus = normalizeInputStatus(status?.status) || 'blocked';
  if (proofStatus === 'ready') {
    return `[${markerPrefix}:READY]`;
  }
  const reasonCode = sanitizeReasonCode(status?.reasonCode || 'OPERATOR_PROOF_BLOCKED');
  return `[${markerPrefix}:BLOCKED:${reasonCode}]`;
}

export function stableStringify(value) {
  return JSON.stringify(sortForJson(value), null, 2);
}

function resolveReleaseTimestamp(root) {
  return firstResolvedString([
    ['$.releaseTimestamp', () => root.releaseTimestamp],
    ['$.release.timestamp', () => root.release?.timestamp],
    ['$.progressReleaseTimestamp.iso', () => root.progressReleaseTimestamp?.iso],
    ['$.evidence.releaseTimestamp', () => root.evidence?.releaseTimestamp],
    ['$.generatedAt', () => root.generatedAt],
    ['$.timestamp', () => root.timestamp],
  ]);
}

function resolveReleaseMovement(root) {
  const candidates = [
    ['$.releaseMovement', root.releaseMovement],
    ['$.movement.releaseMovement', root.movement?.releaseMovement],
    ['$.operatorProof.releaseMovement', root.operatorProof?.releaseMovement],
    ['$.topologyEvidence.releaseMovement', root.topologyEvidence?.releaseMovement],
  ];
  for (const [path, value] of candidates) {
    if (isRecord(value)) {
      return { path, ...value };
    }
  }
  return null;
}

function resolveUrlRole(root, role) {
  const candidates = urlCandidates(root, role);
  for (const [path, value] of candidates) {
    const evidence = normalizeUrlEvidence(value, path, role);
    if (evidence) {
      return evidence;
    }
  }
  return null;
}

function urlCandidates(root, role) {
  if (role === 'source') {
    return [
      ['$.urlEvidence.source', root.urlEvidence?.source],
      ['$.urls.source', root.urls?.source],
      ['$.sourceUrl', root.sourceUrl],
      ['$.topology.sourceUrl', root.topology?.sourceUrl],
      ['$.topology.remoteBase', root.topology?.remoteBase],
      ['$.topologyEvidence.topology.sourceUrl', root.topologyEvidence?.topology?.sourceUrl],
      ['$.topologyEvidence.services.source.url', root.topologyEvidence?.services?.source?.url],
    ];
  }
  if (role === 'local') {
    return [
      ['$.urlEvidence.local', root.urlEvidence?.local],
      ['$.urls.local', root.urls?.local],
      ['$.localUrl', root.localUrl],
      ['$.topology.localUrl', root.topology?.localUrl],
      ['$.topology.localEdited', root.topology?.localEdited],
      ['$.topologyEvidence.topology.localEditedSite', root.topologyEvidence?.topology?.localEditedSite],
      ['$.topologyEvidence.services.localEdited.url', root.topologyEvidence?.services?.localEdited?.url],
    ];
  }
  return [
    ['$.urlEvidence.remote', root.urlEvidence?.remote],
    ['$.urls.remote', root.urls?.remote],
    ['$.urls.remoteChanged', root.urls?.remoteChanged],
    ['$.remoteUrl', root.remoteUrl],
    ['$.remoteChangedUrl', root.remoteChangedUrl],
    ['$.topology.remoteUrl', root.topology?.remoteUrl],
    ['$.topology.remoteChanged', root.topology?.remoteChanged],
    ['$.topologyEvidence.topology.remoteChangedDriftSource', root.topologyEvidence?.topology?.remoteChangedDriftSource],
    ['$.topologyEvidence.services.remoteChanged.url', root.topologyEvidence?.services?.remoteChanged?.url],
  ];
}

function normalizeUrlEvidence(value, path, role) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (isRecord(value)) {
    const hash = firstString(value.hash, value.sha256, value.urlHash, value.digest);
    const redacted = firstString(value.redacted, value.redactedUrl, value.safe, value.observed);
    const raw = firstString(value.url, value.value, value.raw);
    const normalizedHash = normalizeSha256(hash);
    const normalizedRedacted = normalizeRedactedUrl(redacted);
    if (normalizedHash || normalizedRedacted) {
      return compactObject({
        role,
        path,
        hash: normalizedHash,
        redacted: normalizedRedacted,
        format: normalizedHash && normalizedRedacted ? 'hash+redacted' : normalizedHash ? 'hash' : 'redacted',
      });
    }
    if (raw) {
      return normalizeUrlEvidence(raw, path, role);
    }
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const normalizedHash = normalizeSha256(trimmed);
  if (normalizedHash) {
    return {
      role,
      path,
      hash: normalizedHash,
      format: 'hash',
    };
  }

  const normalizedRedacted = normalizeRedactedUrl(trimmed);
  if (normalizedRedacted) {
    return {
      role,
      path,
      redacted: normalizedRedacted,
      format: 'redacted',
    };
  }

  if (looksLikeRawSecretValue(trimmed, 'url')) {
    return null;
  }

  const parsed = parseHttpUrl(trimmed);
  if (!parsed) {
    return null;
  }

  return {
    role,
    path,
    hash: `sha256:${sha256(trimmed)}`,
    redacted: redactUrl(parsed),
    format: 'hash+redacted',
  };
}

function resolveVerificationResult(root) {
  const candidates = [
    ['$.verification', root.verification],
    ['$.verifyRelease', root.verifyRelease],
    ['$.verificationCommand', root.verificationCommand],
    ['$.releaseProof', root.releaseProof],
  ];

  for (const [path, value] of candidates) {
    if (!isRecord(value)) {
      continue;
    }
    const command = firstString(
      value.command,
      value.checkedCommand,
      root.checkedCommand,
      root.topologyEvidence?.checkedCommand,
    );
    const exitCode = normalizeExitCode(
      value.exitCode,
      value.status,
      value.code === 0 ? 0 : undefined,
    );
    const ok = typeof value.ok === 'boolean' ? value.ok : undefined;
    if (command && Number.isInteger(exitCode)) {
      return {
        path,
        command,
        exitCode,
        ok: ok ?? exitCode === 0,
        signal: value.signal || null,
        failureReason: firstString(value.failureReason, value.failureReasonCode, value.reasonCode, value.code),
      };
    }
  }

  const command = firstString(root.checkedCommand, root.topologyEvidence?.checkedCommand);
  const exitCode = normalizeExitCode(root.exitCode, root.statusCode);
  if (command && Number.isInteger(exitCode)) {
    return {
      path: '$',
      command,
      exitCode,
      ok: typeof root.ok === 'boolean' ? root.ok : exitCode === 0,
      signal: root.signal || null,
      failureReason: firstString(root.failureReason, root.failureReasonCode, root.reasonCode),
    };
  }

  return null;
}

function resolveBlockedFailureReason(root, verification, releaseMovement) {
  return sanitizeReasonCode(firstString(
    root.failureReasonCode,
    root.failureReason,
    root.reasonCode,
    root.blockedReasonCode,
    root.blockedReason,
    verification?.failureReason,
    root.releaseProof?.failureReasonCode,
    root.releaseProof?.failureReason,
    root.releaseProof?.reasonCode,
    root.releaseProof?.code,
    releaseMovement?.code,
    codeishReason(releaseMovement?.reason),
  ));
}

function sanitizeReleaseMovement(releaseMovement) {
  return compactObject({
    allowed: releaseMovement.allowed,
    state: releaseMovement.state || null,
    gates: releaseMovement.gates || null,
    finalGates: releaseMovement.finalGates || null,
    candidateGates: releaseMovement.candidateGates || null,
    reason: releaseMovement.reason || null,
    code: releaseMovement.code || null,
  });
}

function sanitizeVerification(verification) {
  return compactObject({
    command: verification.command,
    exitCode: verification.exitCode,
    ok: verification.ok,
    signal: verification.signal || null,
    failureReason: sanitizeReasonCode(verification.failureReason) || null,
  });
}

function findRawSecretValues(value, path = '$', key = '') {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...findRawSecretValues(entry, `${path}[${index}]`, String(index)));
    });
    return findings;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && looksLikeRawSecretValue(value, key)) {
      findings.push({ path, key });
    }
    return findings;
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const childPath = `${path}.${escapePathSegment(entryKey)}`;
    findings.push(...findRawSecretValues(entryValue, childPath, entryKey));
  }
  return findings;
}

function looksLikeRawSecretValue(value, key = '') {
  const trimmed = value.trim();
  if (!trimmed || safeRedactedOrHashed(trimmed)) {
    return false;
  }
  const lowerKey = key.toLowerCase();
  const secretLeafKey = /(password|pass|secret|token|authorization|cookie|api[_-]?key|apikey|private[_-]?key|privatekey|client[_-]?secret|clientsecret|access[_-]?key|accesskey|bearer)/i;
  if (secretLeafKey.test(lowerKey)) {
    return true;
  }
  if (/^[a-z]+:\/\/[^\s/@:]+:[^\s/@]+@/i.test(trimmed)) {
    return true;
  }
  if (/[?&](?:password|pass|secret|token|api[_-]?key|key|auth|authorization|nonce)=([^&#]+)/i.test(trimmed)
    && !/[?&](?:password|pass|secret|token|api[_-]?key|key|auth|authorization|nonce)=(?:redacted|%5Bredacted%5D|<redacted>|\*\*\*)/i.test(trimmed)) {
    return true;
  }
  if (/\b[A-Z0-9_]*(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|APPLICATION_PASSWORD)[A-Z0-9_]*=(?!redacted\b|\[redacted\]|<redacted>|\*{3,})[^\s]+/i.test(trimmed)) {
    return true;
  }
  if (/\b(?:authorization:\s*)?bearer\s+(?!redacted|\[redacted\]|<redacted>)[a-z0-9._~+\-/]{12,}\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(?:sk|ghp|github_pat|xox[baprs])-?[a-z0-9_\-]{12,}\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function safeRedactedOrHashed(value) {
  return normalizeSha256(value)
    || /^(?:\[?redacted\]?|<redacted>|\*{3,}|present|not-present|missing|not-configured|none)$/i.test(value.trim());
}

function normalizeInputStatus(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const token = value.trim().toLowerCase();
  if (['ready', 'release-ready', 'ok', 'passed'].includes(token)) {
    return 'ready';
  }
  if (['blocked', 'held', 'failed', 'no-go', 'nogo', 'not-ready'].includes(token)) {
    return 'blocked';
  }
  return null;
}

function sanitizeReasonCode(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /[A-Z]/.test(normalized) ? normalized : null;
}

function codeishReason(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return /^[A-Z][A-Z0-9_:-]{3,}$/.test(trimmed) ? trimmed : '';
}

function firstResolvedString(candidates) {
  for (const [path, read] of candidates) {
    const value = read();
    if (typeof value === 'string' && value.trim()) {
      return { path, value: value.trim() };
    }
  }
  return { path: '', value: '' };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function normalizeExitCode(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
  }
  return null;
}

function normalizeSha256(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  const withPrefix = /^sha256:([a-f0-9]{64})$/i.exec(trimmed);
  if (withPrefix) {
    return `sha256:${withPrefix[1].toLowerCase()}`;
  }
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return `sha256:${trimmed.toLowerCase()}`;
  }
  return '';
}

function normalizeRedactedUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed || normalizeSha256(trimmed)) {
    return '';
  }
  if (/^(?:\[?redacted\]?|<redacted>|\*{3,})$/i.test(trimmed)) {
    return '<redacted>';
  }
  if (!/(redacted|<redacted>|\*{3,}|…|\.\.\.)/i.test(trimmed)) {
    return '';
  }
  if (looksLikeRawSecretValue(trimmed, 'url')) {
    return '';
  }
  return trimmed;
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function redactUrl(parsed) {
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${port}/<redacted>`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''));
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (isRecord(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortForJson(value[key]);
    }
    return sorted;
  }
  return value;
}

function deepFreeze(value) {
  if (isRecord(value) || Array.isArray(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) {
      if ((isRecord(entry) || Array.isArray(entry)) && !Object.isFrozen(entry)) {
        deepFreeze(entry);
      }
    }
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapePathSegment(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function failClosedStatus(reasonCode, details = {}) {
  const code = sanitizeReasonCode(reasonCode) || failureReasons.internal;
  const status = {
    schemaVersion,
    evaluator: 'reprint-push-operator-proof-status',
    generatedAt: null,
    ok: false,
    status: 'blocked',
    ready: false,
    reasonCode: code,
    marker: formatOperatorProofMarker({ status: 'blocked', reasonCode: code }),
    releaseTimestamp: null,
    releaseMovement: null,
    verification: null,
    urlEvidence: {},
    errors: [
      {
        code,
        path: details.path || '$',
        reason: details.reason || 'Operator proof status failed closed.',
      },
    ],
    secretFindings: [],
  };
  return deepFreeze(status);
}

async function readInput(args) {
  if (args.includes('--help') || args.includes('-h')) {
    throw Object.assign(new Error('usage'), { code: failureReasons.usage });
  }
  if (args.length > 1) {
    throw Object.assign(new Error('usage'), { code: failureReasons.usage });
  }
  if (args.length === 0 || args[0] === '-') {
    return readStdin();
  }
  return readFile(args[0], 'utf8');
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

async function main() {
  let rawInput;
  try {
    rawInput = await readInput(process.argv.slice(2));
  } catch (error) {
    const code = error?.code === failureReasons.usage ? failureReasons.usage : failureReasons.internal;
    const output = failClosedStatus(code, {
      reason: code === failureReasons.usage
        ? 'Usage: node scripts/release/operator-proof-status.mjs [evidence.json|-]'
        : 'Unable to read operator proof input.',
    });
    process.stdout.write(`${stableStringify(output)}\n${output.marker}\n`);
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    const output = failClosedStatus(failureReasons.invalidJson, {
      reason: 'Operator proof input must be valid JSON.',
    });
    process.stdout.write(`${stableStringify(output)}\n${output.marker}\n`);
    process.exit(1);
  }

  const output = evaluateOperatorProofStatus(input);
  process.stdout.write(`${stableStringify(output)}\n${output.marker}\n`);
  process.exit(output.ready ? 0 : 1);
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMainModule) {
  main().catch(() => {
    const output = failClosedStatus(failureReasons.internal);
    process.stdout.write(`${stableStringify(output)}\n${output.marker}\n`);
    process.exit(1);
  });
}
