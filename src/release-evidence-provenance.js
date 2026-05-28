const VALID_SUBJECT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const DEFAULT_MAX_EVIDENCE_AGE_HOURS = 24;
const FUTURE_CLOCK_SKEW_MS = 60_000;

export const RELEASE_EVIDENCE_PROVENANCE_REASON_CODES = deepFreeze({
  evidenceIdRequired: 'EVIDENCE_ID_REQUIRED',
  rppIdRequired: 'RPP_ID_REQUIRED',
  productionEvidenceRequired: 'PRODUCTION_EVIDENCE_REQUIRED',
  observedAtRequired: 'OBSERVED_AT_REQUIRED',
  observedAtInvalid: 'OBSERVED_AT_INVALID',
  observedAtInFuture: 'OBSERVED_AT_IN_FUTURE',
  observedAtStale: 'OBSERVED_AT_STALE',
  productionSourceRequired: 'PRODUCTION_SOURCE_REQUIRED',
  subjectHashRequired: 'SUBJECT_HASH_REQUIRED',
  subjectHashInvalid: 'SUBJECT_HASH_INVALID',
  artifactPathRequired: 'ARTIFACT_PATH_REQUIRED',
  artifactPathRawUrl: 'ARTIFACT_PATH_RAW_URL',
  artifactPathSecretLike: 'ARTIFACT_PATH_SECRET_LIKE',
  commandStatusUnchecked: 'COMMAND_STATUS_UNCHECKED',
});

export const RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS = deepFreeze({
  operatorProduction: 'operator-production',
  liveProduction: 'live-production',
  productionRun: 'production-run',
  localPlayground: 'local-playground',
  localCandidate: 'local-candidate',
  generatedPlaceholder: 'generated-placeholder',
  fixture: 'fixture',
});

export const RELEASE_EVIDENCE_PROVENANCE_COMMAND_STATUSES = deepFreeze([
  'checked-passed',
  'checked-failed',
  'checked-succeeded',
  'checked-nonzero',
  'verified',
]);

export const RELEASE_EVIDENCE_PROVENANCE_CONTRACT = deepFreeze({
  schemaVersion: 1,
  validator: 'reprint-push-release-evidence-provenance',
  requiredFields: [
    'evidenceId',
    'rppId',
    'sourceKind',
    'artifactPath',
    'observedAt',
    'command',
    'status',
    'subjectHash',
    'operatorScope',
    'productionRequired',
  ],
  acceptedCommandStatuses: RELEASE_EVIDENCE_PROVENANCE_COMMAND_STATUSES,
  productionSourceKinds: [
    RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS.operatorProduction,
    RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS.liveProduction,
    RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS.productionRun,
  ],
  productionOperatorScopes: [
    'final-release',
    'production-release',
    'live-production',
    'release-operator',
  ],
  reasonCodes: RELEASE_EVIDENCE_PROVENANCE_REASON_CODES,
});

const REASON_CODE_ORDER = Object.freeze([
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.evidenceIdRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.rppIdRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionEvidenceRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtInvalid,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtInFuture,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtStale,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionSourceRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashInvalid,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathRequired,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathRawUrl,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathSecretLike,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.commandStatusUnchecked,
]);

const REASON_CODE_PRIORITY = new Map(REASON_CODE_ORDER.map((code, index) => [code, index]));
const PRODUCTION_SOURCE_KINDS = new Set(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.productionSourceKinds);
const PRODUCTION_OPERATOR_SCOPES = new Set(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.productionOperatorScopes);
const CHECKED_COMMAND_STATUSES = new Set(RELEASE_EVIDENCE_PROVENANCE_COMMAND_STATUSES);

export function validateReleaseEvidenceProvenance(input = {}, options = {}) {
  const rows = evidenceRows(input);
  const requiredProductionEvidence = productionEvidenceRequirements(input, options);
  const now = normalizeNow(firstDefined(options.now, input?.referenceNow, input?.now));
  const maxEvidenceAgeHours = normalizePositiveNumber(
    firstDefined(options.maxEvidenceAgeHours, input?.maxEvidenceAgeHours),
    DEFAULT_MAX_EVIDENCE_AGE_HOURS,
  );
  const context = {
    nowMs: now.date.valueOf(),
    nowIso: now.iso,
    maxEvidenceAgeHours,
    maxEvidenceAgeMs: maxEvidenceAgeHours * 60 * 60 * 1000,
    requiredProductionEvidence,
    productionRequiredEvidenceIds: stringSet([
      ...requiredProductionEvidence.map((requirement) => requirement.evidenceId),
      ...arrayValue(firstDefined(options.productionRequiredEvidenceIds, input?.productionRequiredEvidenceIds)),
    ]),
    productionRequiredRppIds: stringSet([
      ...requiredProductionEvidence.map((requirement) => requirement.rppId),
      ...arrayValue(firstDefined(options.productionRequiredRppIds, input?.productionRequiredRppIds)),
    ]),
  };

  const rowResults = [
    ...rows.map((row, index) => validateProvenanceRow(row, index, context)),
    ...missingRequiredProductionEvidenceResults(context.requiredProductionEvidence, rows),
  ];
  const acceptedRows = rowResults
    .filter((result) => result.reasonCodes.length === 0)
    .sort(compareEvidenceResults);
  const rejectedRows = rowResults
    .filter((result) => result.reasonCodes.length > 0)
    .sort(compareEvidenceResults);
  const productionRequiredTotal = rowResults.filter((result) => result.productionRequired).length;
  const productionRequiredRejected = rejectedRows.filter((result) => result.productionRequired).length;
  const productionRequiredAccepted = productionRequiredTotal - productionRequiredRejected;
  const ok = rejectedRows.length === 0;

  return deepFreeze({
    schemaVersion: 1,
    validator: RELEASE_EVIDENCE_PROVENANCE_CONTRACT.validator,
    generatedAt: now.iso,
    maxEvidenceAgeHours,
    ok,
    releaseReady: ok && productionRequiredTotal > 0 && productionRequiredAccepted === productionRequiredTotal,
    acceptedEvidenceIds: acceptedRows.map((result) => result.evidenceId),
    rejectedEvidence: rejectedRows.map((result) => ({
      evidenceId: result.evidenceId,
      rppId: result.rppId,
      productionRequired: result.productionRequired,
      reasonCodes: result.reasonCodes,
    })),
    productionRequired: {
      total: productionRequiredTotal,
      accepted: productionRequiredAccepted,
      rejected: productionRequiredRejected,
    },
    requiredProductionEvidenceIds: context.requiredProductionEvidence.map((requirement) => requirement.evidenceId),
    counts: {
      total: rowResults.length,
      accepted: acceptedRows.length,
      rejected: rejectedRows.length,
      productionRequired: {
        total: productionRequiredTotal,
        accepted: productionRequiredAccepted,
        rejected: productionRequiredRejected,
      },
    },
  });
}

export function releaseGateProvenanceRequirements(evaluationOrGates, options = {}) {
  const gates = Array.isArray(evaluationOrGates)
    ? evaluationOrGates
    : (Array.isArray(evaluationOrGates?.gates) ? evaluationOrGates.gates : []);
  const category = normalizeString(options.category || 'operator-proof');
  return deepFreeze(gates
    .filter((gate) => gate && normalizeString(gate.category) === category)
    .map((gate) => ({
      evidenceId: `release-gate:${gate.id}`,
      rppId: normalizeString(gate.rpp),
      gateId: normalizeString(gate.id),
      title: normalizeString(gate.title),
      productionRequired: true,
    }))
    .sort((left, right) => compareStrings(left.rppId, right.rppId) || compareStrings(left.evidenceId, right.evidenceId)));
}

function validateProvenanceRow(row, index, context) {
  const normalized = normalizeRow(row, index);
  const productionRequired = normalized.productionRequired
    || context.productionRequiredEvidenceIds.has(normalized.evidenceId)
    || context.productionRequiredRppIds.has(normalized.rppId);
  const reasonCodes = [];

  if (!normalized.evidenceId) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.evidenceIdRequired);
  }

  if (!normalized.rppId) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.rppIdRequired);
  }

  validateObservedAt(normalized.observedAt, context, reasonCodes);

  if (productionRequired && !hasProductionProvenance(normalized)) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionSourceRequired);
  }

  if (!normalized.subjectHash) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashRequired);
  } else if (!VALID_SUBJECT_HASH_PATTERN.test(normalized.subjectHash)) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashInvalid);
  }

  validateArtifactValues(normalized.artifactValues, reasonCodes);

  if (!normalized.command || !CHECKED_COMMAND_STATUSES.has(normalized.status)) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.commandStatusUnchecked);
  }

  return {
    evidenceId: normalized.evidenceId || `__missing-evidence-id-${String(index + 1).padStart(4, '0')}`,
    rppId: normalized.rppId || 'unknown-rpp',
    artifactSortKey: normalized.artifactValues[0] || '',
    productionRequired,
    reasonCodes: orderReasonCodes(reasonCodes),
  };
}

function missingRequiredProductionEvidenceResults(requiredProductionEvidence, rows) {
  if (requiredProductionEvidence.length === 0) {
    return [];
  }

  const presentEvidenceIds = new Set();
  const presentRppIds = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = normalizeRow(rows[index], index);
    if (normalized.evidenceId) {
      presentEvidenceIds.add(normalized.evidenceId);
    }
    if (normalized.rppId) {
      presentRppIds.add(normalized.rppId);
    }
  }

  return requiredProductionEvidence
    .filter((requirement) => {
      if (requirement.evidenceId) {
        return !presentEvidenceIds.has(requirement.evidenceId);
      }
      return requirement.rppId && !presentRppIds.has(requirement.rppId);
    })
    .map((requirement) => ({
      evidenceId: requirement.evidenceId || `${requirement.rppId}:production-evidence`,
      rppId: requirement.rppId || 'unknown-rpp',
      artifactSortKey: '',
      productionRequired: true,
      reasonCodes: [RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionEvidenceRequired],
    }));
}

function normalizeRow(row, index) {
  const value = isObject(row) ? row : {};
  const evidenceId = normalizeString(firstDefined(value.evidenceId, value.id));
  const rppId = normalizeString(firstDefined(value.rppId, value.rpp, value.rpp_id));
  const sourceKind = normalizeToken(firstDefined(value.sourceKind, value.source_kind));
  const operatorScope = normalizeToken(firstDefined(value.operatorScope, value.operator_scope, value.scope));
  return {
    index,
    evidenceId,
    rppId,
    sourceKind,
    operatorScope,
    artifactValues: artifactValuesForRow(value),
    observedAt: normalizeString(firstDefined(value.observedAt, value.observed_at, value.timestamp, value.iso)),
    command: normalizeString(value.command),
    status: normalizeToken(firstDefined(value.status, value.commandStatus, value.command_status)),
    subjectHash: normalizeString(firstDefined(value.subjectHash, value.subject_hash, value.hash)),
    productionRequired: normalizeBoolean(firstDefined(value.productionRequired, value.production_required)),
  };
}

function validateObservedAt(observedAt, context, reasonCodes) {
  if (!observedAt) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtRequired);
    return;
  }

  const observedAtMs = Date.parse(observedAt);
  if (Number.isNaN(observedAtMs)) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtInvalid);
    return;
  }

  if (observedAtMs - context.nowMs > FUTURE_CLOCK_SKEW_MS) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtInFuture);
    return;
  }

  if (context.nowMs - observedAtMs > context.maxEvidenceAgeMs) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtStale);
  }
}

function validateArtifactValues(artifactValues, reasonCodes) {
  if (artifactValues.length === 0) {
    reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathRequired);
    return;
  }

  for (const artifactValue of artifactValues) {
    if (isRawUrl(artifactValue)) {
      reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathRawUrl);
    }
    if (looksLikeSecretArtifactValue(artifactValue)) {
      reasonCodes.push(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathSecretLike);
    }
  }
}

function hasProductionProvenance(row) {
  return PRODUCTION_SOURCE_KINDS.has(row.sourceKind) && PRODUCTION_OPERATOR_SCOPES.has(row.operatorScope);
}

function evidenceRows(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (!isObject(input)) {
    return [];
  }
  for (const key of ['evidenceRows', 'evidence', 'artifacts', 'rows']) {
    if (Array.isArray(input[key])) {
      return input[key];
    }
  }
  return [];
}

function productionEvidenceRequirements(input, options) {
  const requirements = [];
  appendProductionEvidenceRequirements(
    requirements,
    firstDefined(options.requiredProductionEvidence, input?.requiredProductionEvidence),
  );

  for (const evidenceId of arrayValue(firstDefined(options.productionRequiredEvidenceIds, input?.productionRequiredEvidenceIds))) {
    appendProductionEvidenceRequirements(requirements, { evidenceId });
  }

  for (const rppId of arrayValue(firstDefined(options.productionRequiredRppIds, input?.productionRequiredRppIds))) {
    appendProductionEvidenceRequirements(requirements, { rppId });
  }

  const byKey = new Map();
  for (const requirement of requirements) {
    const key = requirement.evidenceId || `rpp:${requirement.rppId}`;
    if (!byKey.has(key)) {
      byKey.set(key, requirement);
    }
  }
  return [...byKey.values()].sort(
    (left, right) => compareStrings(left.rppId, right.rppId) || compareStrings(left.evidenceId, right.evidenceId),
  );
}

function appendProductionEvidenceRequirements(requirements, value) {
  if (value === undefined || value === null || value === false) {
    return;
  }
  if (typeof value === 'string') {
    const evidenceId = normalizeString(value);
    if (!evidenceId) {
      return;
    }
    requirements.push({
      evidenceId,
      rppId: rppIdFromEvidenceId(evidenceId),
      productionRequired: true,
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendProductionEvidenceRequirements(requirements, entry);
    }
    return;
  }
  if (isObject(value)) {
    const evidenceId = normalizeString(firstDefined(value.evidenceId, value.id));
    const rppId = normalizeString(firstDefined(value.rppId, value.rpp, value.rpp_id, rppIdFromEvidenceId(evidenceId)));
    if (!evidenceId && !rppId) {
      return;
    }
    requirements.push({
      evidenceId: evidenceId || `${rppId}:production-evidence`,
      rppId,
      gateId: normalizeString(value.gateId),
      title: normalizeString(value.title),
      productionRequired: true,
    });
  }
}

function artifactValuesForRow(row) {
  const values = [];
  appendArtifactValue(values, row.artifactPath);
  appendArtifactValue(values, row.artifact_path);
  appendArtifactValue(values, row.artifact);
  appendArtifactValue(values, row.artifactRef);
  appendArtifactValue(values, row.artifact_ref);
  appendArtifactValue(values, row.artifactValue);
  appendArtifactValue(values, row.artifact_value);
  appendArtifactValue(values, row.artifactPaths);
  appendArtifactValue(values, row.artifact_paths);
  appendArtifactValue(values, row.artifacts);
  return [...new Set(values.map(normalizeString).filter(Boolean))];
}

function appendArtifactValue(values, value) {
  if (typeof value === 'string') {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendArtifactValue(values, entry);
    }
    return;
  }
  if (isObject(value)) {
    appendArtifactValue(values, firstDefined(value.artifactPath, value.artifact_path, value.path, value.ref));
  }
}

function isRawUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function looksLikeSecretArtifactValue(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value)) {
    return true;
  }
  if (/(?:^|[?&#;\s])(?:password|passwd|secret|token|api[_-]?key|authorization|application[_-]?password)\s*[:=]/i.test(value)) {
    return true;
  }
  return /(?:^|\s)bearer\s+[a-z0-9._~+/=-]{12,}/i.test(value);
}

function orderReasonCodes(reasonCodes) {
  return [...new Set(reasonCodes)].sort((left, right) => {
    const leftPriority = REASON_CODE_PRIORITY.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = REASON_CODE_PRIORITY.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.localeCompare(right);
  });
}

function compareEvidenceResults(left, right) {
  return compareStrings(left.rppId, right.rppId)
    || compareStrings(left.evidenceId, right.evidenceId)
    || compareStrings(left.artifactSortKey, right.artifactSortKey);
}

function compareStrings(left, right) {
  return String(left).localeCompare(String(right));
}

function normalizeNow(value) {
  const fallback = new Date();
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return { date: value, iso: value.toISOString() };
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return { date: parsed, iso: parsed.toISOString() };
    }
  }
  return { date: fallback, iso: fallback.toISOString() };
}

function normalizePositiveNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function stringSet(value) {
  return new Set(arrayValue(value).map(normalizeString).filter(Boolean));
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function normalizeToken(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    if (/^(1|true|yes|required)$/i.test(value.trim())) {
      return true;
    }
    if (/^(0|false|no|optional)$/i.test(value.trim())) {
      return false;
    }
  }
  return false;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function rppIdFromEvidenceId(evidenceId) {
  const match = normalizeString(evidenceId).match(/RPP-\d{4}/);
  return match ? match[0] : '';
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
