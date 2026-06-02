import { digest } from './stable-json.js';

export const PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION = 1;
export const PLUGIN_DRIVER_CONTRACT_KIND = 'plugin-owned-row-driver';
export const PLUGIN_DRIVER_REFUSE_ON_CONFLICT_MERGE_POLICY = 'refuse-on-conflict';
export const PLUGIN_DRIVER_REFERENCE_TARGET_PRIMARY_ID_FIELDS = Object.freeze({
  posts: 'ID',
  users: 'ID',
  comments: 'comment_ID',
  terms: 'term_id',
  term_taxonomy: 'term_taxonomy_id',
  blogs: 'blog_id',
  site: 'id',
});

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
  const mergePolicyResult = normalizePluginOwnedRowDriverMergePolicy(
    entry.mergePolicy ?? nestedContract?.mergePolicy ?? null,
  );
  const referenceFieldsResult = normalizePluginOwnedRowDriverReferenceFields(
    entry.referenceFields
      ?? entry.rowReferences
      ?? nestedContract?.referenceFields
      ?? nestedContract?.rowReferences
      ?? null,
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
  if (!mergePolicyResult.valid) {
    issues.push({
      reasonCode: mergePolicyResult.reasonCode,
      field: 'mergePolicy',
      required: mergePolicyResult.required,
      observed: mergePolicyResult.observed,
    });
  }
  if (!referenceFieldsResult.valid) {
    issues.push({
      reasonCode: referenceFieldsResult.reasonCode,
      field: 'referenceFields',
      required: referenceFieldsResult.required,
      observed: referenceFieldsResult.observed,
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
    ...(mergePolicyResult.normalized ? { mergePolicy: mergePolicyResult.normalized } : {}),
    ...(referenceFieldsResult.normalized ? { referenceFields: referenceFieldsResult.normalized } : {}),
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
    ...(mergePolicyResult.normalized ? { mergePolicy: mergePolicyResult.normalized } : {}),
    ...(referenceFieldsResult.normalized ? { referenceFields: referenceFieldsResult.normalized } : {}),
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
    ...(contract?.mergePolicy ? { mergePolicy: normalizePluginOwnedRowDriverMergePolicy(contract.mergePolicy).normalized } : {}),
    ...(contract?.referenceFields || contract?.rowReferences ? {
      referenceFields: normalizePluginOwnedRowDriverReferenceFields(
        contract.referenceFields ?? contract.rowReferences,
      ).normalized,
    } : {}),
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
    ...(evidence.mergePolicy ? { mergePolicy: normalizePluginOwnedRowDriverMergePolicy(evidence.mergePolicy).normalized } : {}),
    ...(evidence.referenceFields ? { referenceFields: normalizePluginOwnedRowDriverReferenceFields(evidence.referenceFields).normalized } : {}),
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

export function normalizePluginOwnedRowDriverMergePolicy(mergePolicy) {
  if (mergePolicy === null || mergePolicy === undefined) {
    return { valid: true, normalized: null };
  }

  const policyIsString = typeof mergePolicy === 'string';
  const policyIsObject = mergePolicy
    && typeof mergePolicy === 'object'
    && !Array.isArray(mergePolicy);
  if (!policyIsString && !policyIsObject) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_MERGE_POLICY',
      required: 'mergePolicy string or object',
      observed: Array.isArray(mergePolicy) ? 'array' : typeof mergePolicy,
    };
  }

  if (
    policyIsObject
    && Object.prototype.hasOwnProperty.call(mergePolicy, 'rawValuesIncluded')
    && mergePolicy.rawValuesIncluded !== false
  ) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_MERGE_POLICY_RAW_VALUES_INCLUDED',
      required: false,
      observed: true,
    };
  }

  const strategy = policyIsString
    ? mergePolicy
    : mergePolicy.strategy ?? mergePolicy.policy ?? null;
  if (strategy !== PLUGIN_DRIVER_REFUSE_ON_CONFLICT_MERGE_POLICY) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY',
      required: PLUGIN_DRIVER_REFUSE_ON_CONFLICT_MERGE_POLICY,
      observed: isNonEmptyString(strategy) ? 'unsupported-strategy' : typeof strategy,
    };
  }

  return {
    valid: true,
    normalized: {
      schemaVersion: 1,
      strategy: PLUGIN_DRIVER_REFUSE_ON_CONFLICT_MERGE_POLICY,
      conflictResolution: 'preserve-remote-and-stop',
      rawValuesIncluded: false,
    },
  };
}

export function normalizePluginOwnedRowDriverReferenceFields(referenceFields) {
  if (referenceFields === null || referenceFields === undefined) {
    return { valid: true, normalized: null };
  }
  if (!referenceFields || typeof referenceFields !== 'object' || Array.isArray(referenceFields)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELDS',
      required: 'referenceFields object',
      observed: Array.isArray(referenceFields) ? 'array' : typeof referenceFields,
    };
  }
  if (
    hasOwn(referenceFields, 'rawValuesIncluded')
    && referenceFields.rawValuesIncluded !== false
  ) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_REFERENCE_FIELDS_RAW_VALUES_INCLUDED',
      required: false,
      observed: true,
    };
  }

  const definitions = Array.isArray(referenceFields.fields)
    ? referenceFields.fields
    : Array.isArray(referenceFields.references)
      ? referenceFields.references
      : null;
  if (!definitions) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELDS',
      required: 'referenceFields.fields array',
      observed: typeof referenceFields.fields,
    };
  }
  if (definitions.length === 0) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELDS',
      required: 'at least one reference field',
      observed: 0,
    };
  }

  const fields = [];
  const seenPaths = new Set();
  for (const definition of definitions) {
    const normalized = normalizePluginOwnedRowDriverReferenceField(definition);
    if (!normalized.valid) {
      return normalized;
    }
    if (seenPaths.has(normalized.normalized.path)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELDS',
        required: 'unique reference field paths',
        observed: normalized.normalized.path,
      };
    }
    seenPaths.add(normalized.normalized.path);
    fields.push(normalized.normalized);
  }

  fields.sort((left, right) => left.path.localeCompare(right.path));
  return {
    valid: true,
    normalized: {
      schemaVersion: 1,
      fields,
      rawValuesIncluded: false,
    },
  };
}

function normalizePluginOwnedRowDriverReferenceField(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELD',
      required: 'reference field object',
      observed: Array.isArray(definition) ? 'array' : typeof definition,
    };
  }
  const path = definition.path || definition.field || null;
  const targetTable = definition.targetTable || definition.table || null;
  const targetIdField = definition.targetIdField || definition.targetField || null;
  const scalarType = definition.scalarType || definition.type || 'positive-integer';
  if (!isReferenceFieldPath(path)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELD',
      required: 'dot-separated identifier path',
      observed: path ?? null,
    };
  }
  if (!isNonEmptyString(targetTable)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELD',
      required: 'targetTable',
      observed: targetTable ?? null,
    };
  }
  if (!isNonEmptyString(targetIdField)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELD',
      required: 'targetIdField',
      observed: targetIdField ?? null,
    };
  }
  const expectedTargetIdField = pluginDriverReferenceTargetPrimaryIdField(targetTable);
  if (!expectedTargetIdField || targetIdField !== expectedTargetIdField) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_REFERENCE_TARGET',
      required: expectedTargetIdField
        ? { targetTable, targetIdField: expectedTargetIdField }
        : {
          targetTableSuffixes: Object.keys(PLUGIN_DRIVER_REFERENCE_TARGET_PRIMARY_ID_FIELDS),
          targetIdFields: PLUGIN_DRIVER_REFERENCE_TARGET_PRIMARY_ID_FIELDS,
        },
      observed: { targetTable, targetIdField },
    };
  }
  if (scalarType !== 'positive-integer') {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_REFERENCE_FIELD_TYPE',
      required: 'positive-integer',
      observed: scalarType ?? null,
    };
  }
  if (
    hasOwn(definition, 'rawValuesIncluded')
    && definition.rawValuesIncluded !== false
  ) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_REFERENCE_FIELDS_RAW_VALUES_INCLUDED',
      required: false,
      observed: true,
    };
  }

  return {
    valid: true,
    normalized: {
      path,
      targetTable,
      targetIdField,
      scalarType,
      required: definition.required !== false,
    },
  };
}

export function pluginDriverReferenceTargetPrimaryIdField(table) {
  const suffix = pluginDriverReferenceTargetTableSuffix(table);
  return suffix ? PLUGIN_DRIVER_REFERENCE_TARGET_PRIMARY_ID_FIELDS[suffix] : null;
}

export function pluginDriverReferenceTargetTableSuffix(table) {
  if (!isNonEmptyString(table)) {
    return null;
  }
  return Object.keys(PLUGIN_DRIVER_REFERENCE_TARGET_PRIMARY_ID_FIELDS)
    .find((suffix) => table === `wp_${suffix}` || table.endsWith(`_${suffix}`)) || null;
}

function isReferenceFieldPath(path) {
  return isNonEmptyString(path)
    && path.split('.').every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment));
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
  const rootAdditionalProperties = normalizePluginOwnedRowDriverRowSchemaRootAdditionalProperties(rowSchema);
  if (!rootAdditionalProperties.valid) {
    return rootAdditionalProperties;
  }
  const fieldsSource = rowSchema.fields;
  if (Array.isArray(fieldsSource)) {
    const fieldsResult = normalizePluginOwnedRowDriverRowSchemaFields(fieldsSource);
    if (!fieldsResult.valid) {
      return fieldsResult;
    }
    return {
      valid: true,
      normalized: {
        ...fieldsResult.normalized,
        ...rootAdditionalProperties.normalized,
      },
    };
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
      ...rootAdditionalProperties.normalized,
      fields: fields.map((field) => ({
        ...field,
        required: field.required === true,
      })),
    },
  };
}

function normalizePluginOwnedRowDriverRowSchemaRootAdditionalProperties(rowSchema) {
  if (!hasOwn(rowSchema, 'additionalProperties')) {
    return { valid: true, normalized: {} };
  }
  if (rowSchema.additionalProperties !== false) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'rowSchema.additionalProperties false when declared',
      observed: rowSchema.additionalProperties,
    };
  }
  return {
    valid: true,
    normalized: {
      additionalProperties: false,
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
  const constraints = normalizePluginOwnedRowDriverRowSchemaFieldConstraints({
    type,
    definition,
  });
  if (!constraints.valid) {
    return constraints;
  }
  Object.assign(normalized, constraints.normalized);
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

function normalizePluginOwnedRowDriverRowSchemaFieldConstraints({
  type,
  definition,
}) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { valid: true, normalized: {} };
  }
  const hasRawConst = hasOwn(definition, 'const');
  const hasConstHash = hasOwn(definition, 'constHash');
  const hasRawEnum = hasOwn(definition, 'enum');
  const hasEnumHashes = hasOwn(definition, 'enumHashes');
  const hasMinimum = hasOwn(definition, 'minimum');
  const hasMaximum = hasOwn(definition, 'maximum');
  const hasRange = hasMinimum || hasMaximum;
  const constraintCount = Number(hasRawConst || hasConstHash)
    + Number(hasRawEnum || hasEnumHashes)
    + Number(hasRange);
  if (constraintCount === 0) {
    return { valid: true, normalized: {} };
  }
  if (hasRange && !SUPPORTED_ROW_SCHEMA_RANGE_CONSTRAINT_TYPES.has(type)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'minimum or maximum constraints only on integer or number fields',
      observed: type ?? null,
    };
  }
  if (!hasRange && !SUPPORTED_ROW_SCHEMA_CONSTRAINT_TYPES.has(type)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'const or enum constraints only on scalar fields',
      observed: type ?? null,
    };
  }
  if (constraintCount > 1 || (hasRawConst && hasConstHash) || (hasRawEnum && hasEnumHashes)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'exactly one const, enum, or range constraint representation',
      observed: 'multiple constraints',
    };
  }
  if (hasRange) {
    const normalizedRange = {};
    if (hasMinimum) {
      const minimum = normalizePluginOwnedRowDriverRowSchemaRangeBoundary({
        type,
        value: definition.minimum,
      });
      if (!minimum.valid) {
        return minimum;
      }
      normalizedRange.minimum = minimum.normalized;
    }
    if (hasMaximum) {
      const maximum = normalizePluginOwnedRowDriverRowSchemaRangeBoundary({
        type,
        value: definition.maximum,
      });
      if (!maximum.valid) {
        return maximum;
      }
      normalizedRange.maximum = maximum.normalized;
    }
    if (
      hasOwn(normalizedRange, 'minimum')
      && hasOwn(normalizedRange, 'maximum')
      && normalizedRange.minimum > normalizedRange.maximum
    ) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'minimum less than or equal to maximum',
        observed: 'range boundary order',
      };
    }
    return {
      valid: true,
      normalized: normalizedRange,
    };
  }
  if (hasRawConst) {
    const constType = rowSchemaConstraintValueType(definition.const);
    if (constType !== type) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: `${type} const value`,
        observed: constType,
      };
    }
    return {
      valid: true,
      normalized: {
        constHash: digest(definition.const),
      },
    };
  }
  if (hasConstHash) {
    if (!isSha256Hex(definition.constHash)) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'sha256 constHash',
        observed: definition.constHash ?? null,
      };
    }
    return {
      valid: true,
      normalized: {
        constHash: definition.constHash,
      },
    };
  }
  if (hasRawEnum) {
    if (!Array.isArray(definition.enum) || definition.enum.length === 0) {
      return {
        valid: false,
        normalized: null,
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
        required: 'non-empty enum array',
        observed: Array.isArray(definition.enum) ? 0 : typeof definition.enum,
      };
    }
    const enumHashes = [];
    for (const value of definition.enum) {
      const valueType = rowSchemaConstraintValueType(value);
      if (valueType !== type) {
        return {
          valid: false,
          normalized: null,
          reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
          required: `${type} enum values`,
          observed: valueType,
        };
      }
      enumHashes.push(digest(value));
    }
    return {
      valid: true,
      normalized: {
        enumHashes: [...new Set(enumHashes)].sort(),
      },
    };
  }
  if (!Array.isArray(definition.enumHashes) || definition.enumHashes.length === 0) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'non-empty enumHashes array',
      observed: Array.isArray(definition.enumHashes) ? 0 : typeof definition.enumHashes,
    };
  }
  if (!definition.enumHashes.every(isSha256Hex)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'sha256 enumHashes',
      observed: 'invalid enum hash',
    };
  }
  return {
    valid: true,
    normalized: {
      enumHashes: [...new Set(definition.enumHashes)].sort(),
    },
  };
}

function normalizePluginOwnedRowDriverRowSchemaRangeBoundary({
  type,
  value,
}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: `${type} finite range boundary`,
      observed: rowSchemaConstraintValueType(value),
    };
  }
  if (type === 'integer' && !Number.isInteger(value)) {
    return {
      valid: false,
      normalized: null,
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA',
      required: 'integer range boundary',
      observed: 'number',
    };
  }
  return {
    valid: true,
    normalized: value,
  };
}

function rowSchemaConstraintValueType(value) {
  if (value === null) {
    return 'null';
  }
  if (Number.isInteger(value)) {
    return 'integer';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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

const SUPPORTED_ROW_SCHEMA_CONSTRAINT_TYPES = new Set([
  'boolean',
  'integer',
  'null',
  'number',
  'string',
]);
const SUPPORTED_ROW_SCHEMA_RANGE_CONSTRAINT_TYPES = new Set([
  'integer',
  'number',
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
