import { digest } from './stable-json.js';

export const PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION = 1;
export const PLUGIN_DRIVER_CONTRACT_KIND = 'plugin-owned-row-driver';

export function normalizePluginOwnedRowDriverContract(entry, {
  source = null,
  evidenceScope = null,
} = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { explicit: false, valid: true, normalized: null, evidence: null };
  }

  const nestedContract = entry.contract && typeof entry.contract === 'object' && !Array.isArray(entry.contract)
    ? entry.contract
    : null;
  const explicit = hasOwn(entry, 'contractVersion')
    || hasOwn(entry, 'schemaVersion')
    || hasOwn(entry, 'driverContractVersion')
    || hasOwn(entry, 'contractKind')
    || entry.kind === PLUGIN_DRIVER_CONTRACT_KIND
    || nestedContract?.kind === PLUGIN_DRIVER_CONTRACT_KIND
    || hasOwn(nestedContract || {}, 'schemaVersion');

  if (!explicit) {
    return { explicit: false, valid: true, normalized: null, evidence: null };
  }

  const contractVersion = entry.contractVersion
    ?? entry.schemaVersion
    ?? entry.driverContractVersion
    ?? nestedContract?.schemaVersion
    ?? null;
  const contractKind = entry.contractKind
    ?? entry.kind
    ?? nestedContract?.kind
    ?? null;
  const resourceKey = entry.resourceKey || entry.key || entry.resource?.key || null;
  const pluginOwner = entry.pluginOwner || entry.owner || entry.plugin || null;
  const driver = entry.driver || entry.supportedDriver || entry.resourceDriver || null;
  const table = entry.table || entry.resource?.table || null;
  const scope = entry.evidenceScope || entry.releaseGateEvidenceScope || evidenceScope || 'local-candidate';
  const rowSchemaResult = normalizePluginOwnedRowDriverRowSchema(
    entry.rowSchema ?? nestedContract?.rowSchema ?? null,
  );

  const issues = [];
  if (contractVersion !== PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION',
      field: 'contractVersion',
      required: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
      observed: contractVersion ?? null,
    });
  }
  if (!isNonEmptyString(contractKind)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_MISSING_KIND',
      field: 'contractKind',
      required: PLUGIN_DRIVER_CONTRACT_KIND,
      observed: contractKind ?? null,
    });
  } else if (contractKind !== PLUGIN_DRIVER_CONTRACT_KIND) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_KIND',
      field: 'contractKind',
      required: PLUGIN_DRIVER_CONTRACT_KIND,
      observed: contractKind ?? null,
    });
  }
  if (!isNonEmptyString(resourceKey)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_MISSING_RESOURCE_KEY',
      field: 'resourceKey',
      required: 'non-empty resource key',
      observed: resourceKey ?? null,
    });
  }
  if (!isNonEmptyString(pluginOwner)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_MISSING_PLUGIN_OWNER',
      field: 'pluginOwner',
      required: 'non-empty plugin owner',
      observed: pluginOwner ?? null,
    });
  }
  if (!isNonEmptyString(driver)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER',
      field: 'driver',
      required: 'non-empty driver name',
      observed: driver ?? null,
    });
  }
  if (table !== null && !isNonEmptyString(table)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_TABLE',
      field: 'table',
      required: 'non-empty table name or null',
      observed: table,
    });
  }
  if (hasOwn(entry, 'supportsDelete') && typeof entry.supportsDelete !== 'boolean') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_DELETE_SUPPORT',
      field: 'supportsDelete',
      required: 'boolean',
      observed: typeof entry.supportsDelete,
    });
  }
  const rawValuesIncluded = rawValuesIncludedMarker(entry, nestedContract);
  if (rawValuesIncluded.declared && rawValuesIncluded.value !== false) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_RAW_VALUES_INCLUDED',
      field: rawValuesIncluded.field,
      required: false,
      observed: rawValuesIncluded.value,
    });
  }
  if (!rowSchemaResult.valid) {
    issues.push({
      reasonCode: rowSchemaResult.reasonCode,
      field: 'rowSchema',
      required: rowSchemaResult.required,
      observed: rowSchemaResult.observed,
    });
  }

  const accepted = issues.length === 0;
  const normalized = {
    resourceKey: resourceKey || null,
    pluginOwner: pluginOwner || null,
    driver: driver || null,
    table: table || null,
    supportsDelete: entry.supportsDelete === true,
    evidenceScope: scope,
    contractVersion,
    contractKind,
    ...(rowSchemaResult.normalized ? { rowSchema: rowSchemaResult.normalized } : {}),
  };
  const contractHash = pluginOwnedRowDriverContractHash(normalized);
  const evidence = {
    schemaVersion: 1,
    operation: 'plugin-driver-contract-validation',
    contractKind: contractKind || null,
    contractVersion: Number.isInteger(contractVersion) ? contractVersion : null,
    outcome: accepted ? 'accepted' : 'refused-before-mutation',
    reasonCode: accepted
      ? 'PLUGIN_DRIVER_CONTRACT_ACCEPTED'
      : issues[0].reasonCode,
    issueCodes: issues.map((issue) => issue.reasonCode),
    issues,
    source,
    evidenceScope: scope,
    rawValuesIncluded: false,
    resourceKey: resourceKey || null,
    pluginOwner: pluginOwner || null,
    driver: driver || null,
    table: table || null,
    supportsDelete: entry.supportsDelete === true,
    ...(rowSchemaResult.normalized ? { rowSchema: rowSchemaResult.normalized } : {}),
    contractHash,
  };

  return {
    explicit: true,
    valid: accepted,
    normalized: {
      ...normalized,
      contractHash,
    },
    evidence,
  };
}

export function pluginOwnedRowDriverContractHash(contract) {
  return digest({
    schemaVersion: 1,
    contractKind: PLUGIN_DRIVER_CONTRACT_KIND,
    contractVersion: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
    resourceKey: contract?.resourceKey || null,
    pluginOwner: contract?.pluginOwner || null,
    driver: contract?.driver || null,
    table: contract?.table || null,
    supportsDelete: contract?.supportsDelete === true,
    ...(contract?.rowSchema ? { rowSchema: normalizePluginOwnedRowDriverRowSchema(contract.rowSchema).normalized } : {}),
  });
}

export function canonicalPluginOwnedRowDriverContractValidationEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return null;
  }
  return {
    schemaVersion: 1,
    operation: 'plugin-driver-contract-validation',
    contractKind: evidence.contractKind || null,
    contractVersion: Number.isInteger(evidence.contractVersion) ? evidence.contractVersion : null,
    outcome: evidence.outcome || null,
    reasonCode: evidence.reasonCode || null,
    issueCodes: Array.isArray(evidence.issueCodes) ? [...evidence.issueCodes] : [],
    issues: Array.isArray(evidence.issues)
      ? evidence.issues.map(canonicalPluginOwnedRowDriverContractValidationIssue)
      : [],
    source: evidence.source || null,
    evidenceScope: evidence.evidenceScope || null,
    rawValuesIncluded: evidence.rawValuesIncluded === true,
    resourceKey: evidence.resourceKey || null,
    pluginOwner: evidence.pluginOwner || null,
    driver: evidence.driver || null,
    table: evidence.table || null,
    supportsDelete: evidence.supportsDelete === true,
    ...(evidence.rowSchema ? { rowSchema: normalizePluginOwnedRowDriverRowSchema(evidence.rowSchema).normalized } : {}),
    contractHash: pluginOwnedRowDriverContractHash(evidence),
  };
}

export function pluginOwnedRowDriverContractValidationEvidenceHash(evidence) {
  const canonicalEvidence = canonicalPluginOwnedRowDriverContractValidationEvidence(evidence);
  return canonicalEvidence ? digest(canonicalEvidence) : null;
}

export function pluginOwnedRowDriverContractValidationEvidenceMatches(evidence) {
  const expectedEvidenceHash = pluginOwnedRowDriverContractValidationEvidenceHash(evidence);
  return Boolean(expectedEvidenceHash) && digest(evidence) === expectedEvidenceHash;
}

function canonicalPluginOwnedRowDriverContractValidationIssue(issue) {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
    return {
      reasonCode: null,
      field: null,
      required: null,
      observed: null,
    };
  }
  return {
    reasonCode: issue.reasonCode || null,
    field: issue.field || null,
    required: issue.required ?? null,
    observed: issue.observed ?? null,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizePluginOwnedRowDriverRowSchema(rowSchema) {
  if (rowSchema === null || rowSchema === undefined) {
    return { valid: true, normalized: null };
  }
  if (!rowSchema || typeof rowSchema !== 'object' || Array.isArray(rowSchema)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'object row schema',
      observed: typeof rowSchema,
    };
  }
  const fieldsSource = rowSchema.fields;
  if (Array.isArray(fieldsSource)) {
    return normalizePluginOwnedRowDriverRowSchemaFields(fieldsSource);
  }
  if (!fieldsSource || typeof fieldsSource !== 'object') {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'rowSchema.fields object',
      observed: typeof fieldsSource,
    };
  }
  const requiredSource = Array.isArray(rowSchema.required) ? rowSchema.required : [];
  if (rowSchema.required !== undefined && !Array.isArray(rowSchema.required)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'rowSchema.required array',
      observed: typeof rowSchema.required,
    };
  }
  const required = [...new Set(requiredSource)];
  if (!required.every(isNonEmptyString)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'non-empty required field names',
      observed: 'invalid required field',
    };
  }
  const fields = [];
  for (const field of Object.keys(fieldsSource).sort()) {
    if (!isNonEmptyString(field)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'non-empty field names',
        observed: 'invalid field name',
      };
    }
    const definition = fieldsSource[field];
    const type = typeof definition === 'string'
      ? definition
      : definition && typeof definition === 'object' && !Array.isArray(definition)
        ? definition.type
        : null;
    if (!SUPPORTED_ROW_SCHEMA_TYPES.has(type)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE',
        required: Array.from(SUPPORTED_ROW_SCHEMA_TYPES).sort(),
        observed: type ?? null,
      };
    }
    const normalizedField = normalizePluginOwnedRowDriverRowSchemaField({
      field,
      type,
      required: required.includes(field) || definition?.required === true,
      definition,
    });
    if (!normalizedField.valid) {
      return normalizedField;
    }
    fields.push(normalizedField.normalized);
  }
  if (fields.length === 0) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'at least one schema field',
      observed: 0,
    };
  }
  const fieldNames = new Set(fields.map((field) => field.field));
  for (const requiredField of required) {
    if (!fieldNames.has(requiredField)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'required fields must be declared in rowSchema.fields',
        observed: requiredField,
      };
    }
  }
  return {
    valid: true,
    normalized: {
      schemaVersion: 1,
      fields: fields.map((field) => ({
        ...field,
        required: field.required === true,
      })),
    },
  };
}

function normalizePluginOwnedRowDriverRowSchemaFields(fieldsSource) {
  const fields = [];
  const seenFields = new Set();
  for (const definition of fieldsSource) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'normalized rowSchema fields',
        observed: typeof definition,
      };
    }
    const field = definition.field;
    const type = definition.type;
    if (!isNonEmptyString(field)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'non-empty field names',
        observed: field ?? null,
      };
    }
    if (seenFields.has(field)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'unique field names',
        observed: field,
      };
    }
    seenFields.add(field);
    if (!SUPPORTED_ROW_SCHEMA_TYPES.has(type)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE',
        required: Array.from(SUPPORTED_ROW_SCHEMA_TYPES).sort(),
        observed: type ?? null,
      };
    }
    const normalizedField = normalizePluginOwnedRowDriverRowSchemaField({
      field,
      type,
      required: definition.required === true,
      definition,
    });
    if (!normalizedField.valid) {
      return normalizedField;
    }
    fields.push(normalizedField.normalized);
  }
  if (fields.length === 0) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'at least one schema field',
      observed: 0,
    };
  }
  fields.sort((left, right) => {
    if (left.field < right.field) {
      return -1;
    }
    if (left.field > right.field) {
      return 1;
    }
    return 0;
  });
  return {
    valid: true,
    normalized: {
      schemaVersion: 1,
      fields,
    },
  };
}

function normalizePluginOwnedRowDriverRowSchemaField({
  field,
  type,
  required,
  definition,
}) {
  const normalized = {
    field,
    type,
    required: required === true,
  };
  if (
    definition
    && typeof definition === 'object'
    && !Array.isArray(definition)
    && Object.prototype.hasOwnProperty.call(definition, 'additionalProperties')
  ) {
    if (type !== 'object') {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'additionalProperties only on object fields',
        observed: type ?? null,
      };
    }
    if (!Object.prototype.hasOwnProperty.call(definition, 'properties')) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'additionalProperties false requires object properties',
        observed: 'missing properties',
      };
    }
    if (definition.additionalProperties !== false) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'additionalProperties false when declared',
        observed: definition.additionalProperties,
      };
    }
    normalized.additionalProperties = false;
  }
  if (
    definition
    && typeof definition === 'object'
    && !Array.isArray(definition)
    && Object.prototype.hasOwnProperty.call(definition, 'properties')
  ) {
    if (type !== 'object') {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'properties only on object fields',
        observed: type ?? null,
      };
    }
    const nested = normalizePluginOwnedRowDriverRowSchema({
      fields: definition.properties,
      required: Array.isArray(definition.required) ? definition.required : [],
    });
    if (!nested.valid) {
      return nested;
    }
    normalized.properties = nested.normalized.fields;
  }
  return {
    valid: true,
    normalized,
  };
}

const SUPPORTED_ROW_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

function hasOwn(value, key) {
  return value && Object.prototype.hasOwnProperty.call(value, key);
}

function rawValuesIncludedMarker(entry, nestedContract) {
  if (hasOwn(entry, 'rawValuesIncluded')) {
    return {
      declared: true,
      field: 'rawValuesIncluded',
      value: entry.rawValuesIncluded,
    };
  }
  if (hasOwn(nestedContract, 'rawValuesIncluded')) {
    return {
      declared: true,
      field: 'contract.rawValuesIncluded',
      value: nestedContract.rawValuesIncluded,
    };
  }
  return { declared: false, field: 'rawValuesIncluded', value: false };
}
