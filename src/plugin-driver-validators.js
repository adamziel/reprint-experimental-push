import { ABSENT, digest } from './stable-json.js';
import {
  PLUGIN_DRIVER_CONTRACT_KIND,
  PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
  pluginOwnedRowDriverContractValidationEvidenceHash,
  pluginOwnedRowDriverContractValidationEvidenceMatches,
  pluginOwnedRowDriverContractHash,
  normalizePluginOwnedRowDriverRowSchema,
} from './plugin-driver-contracts.js';

export const INVALID_SERIALIZED_OPTION_PAYLOAD = 'INVALID_SERIALIZED_OPTION_PAYLOAD';
export const PLUGIN_DRIVER_CONTRACT_BOUND_VALIDATOR = 'contract-bound-row-driver';

export function validatePluginOwnedDriverPayload({
  resource,
  owner = null,
  driver,
  table = null,
  value,
  action = value === ABSENT ? 'delete' : 'put',
  supportsDelete = false,
  contractValidationEvidence = null,
}) {
  if (!isSerializedWpOptionPayload(resource, driver, value)) {
    return validateContractBoundRowDriverPayload({
      resource,
      owner,
      driver,
      table,
      value,
      action,
      supportsDelete,
      contractValidationEvidence,
    });
  }

  if (!value || value === ABSENT || typeof value !== 'object') {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  if (typeof value.option_value !== 'string') {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  const phpSerialized = validatePhpSerializedPayload(value.option_value);
  if (!phpSerialized.valid) {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  return {
    supported: true,
    evidence: serializedOptionValidationEvidence({
      resource,
      driver,
      value,
      outcome: 'accepted',
    }),
  };
}

function validateContractBoundRowDriverPayload({
  resource,
  owner,
  driver,
  table,
  value,
  action,
  supportsDelete,
  contractValidationEvidence,
}) {
  if (!acceptedContractValidationEvidence(contractValidationEvidence)) {
    return { supported: true, evidence: null };
  }

  const expectedTable = contractValidationEvidence.table || table || null;
  const expectedOwner = contractValidationEvidence.pluginOwner || owner || null;
  const expectedDriver = contractValidationEvidence.driver || driver || null;
  const contractSupportsDelete = contractValidationEvidence.supportsDelete === true;
  const rowIdentity = contractBoundRowIdentityEvidence(resource, value, action);
  const rowSchema = contractValidationEvidence.rowSchema
    ? normalizePluginOwnedRowDriverRowSchema(contractValidationEvidence.rowSchema).normalized
    : null;
  const schemaValidation = rowSchema
    ? contractBoundRowSchemaValidationEvidence(rowSchema, value, action)
    : null;
  const issues = [];

  if (contractValidationEvidence.resourceKey !== resource?.key) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_RESOURCE_MISMATCH',
      field: 'resourceKey',
      expected: contractValidationEvidence.resourceKey || null,
      observed: resource?.key || null,
    });
  }
  if (expectedOwner && !isNonEmptyString(owner)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_OWNER_MISSING',
      field: 'pluginOwner',
      expected: expectedOwner,
      observed: owner ?? null,
    });
  } else if (expectedOwner && expectedOwner !== owner) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_OWNER_MISMATCH',
      field: 'pluginOwner',
      expected: expectedOwner,
      observed: owner,
    });
  }
  if (expectedDriver && !isNonEmptyString(driver)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_DRIVER_MISSING',
      field: 'driver',
      expected: expectedDriver,
      observed: driver ?? null,
    });
  } else if (expectedDriver && expectedDriver !== driver) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_DRIVER_MISMATCH',
      field: 'driver',
      expected: expectedDriver,
      observed: driver,
    });
  }
  if (resource?.type !== 'row') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_NON_ROW_RESOURCE',
      field: 'resource.type',
      expected: 'row',
      observed: resource?.type || null,
    });
  }
  if (expectedTable && resource?.table !== expectedTable) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_TABLE_MISMATCH',
      field: 'table',
      expected: expectedTable,
      observed: resource?.table || null,
    });
  }
  if (supportsDelete !== contractSupportsDelete) {
    issues.push({
      reasonCode: action === 'delete' && contractSupportsDelete !== true
        ? 'PLUGIN_DRIVER_CONTRACT_BOUND_DELETE_UNSUPPORTED'
        : 'PLUGIN_DRIVER_CONTRACT_BOUND_DELETE_SUPPORT_MISMATCH',
      field: 'supportsDelete',
      expected: contractSupportsDelete,
      observed: supportsDelete === true,
    });
  } else if (action === 'delete' && contractSupportsDelete !== true) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_DELETE_UNSUPPORTED',
      field: 'supportsDelete',
      expected: true,
      observed: contractSupportsDelete,
    });
  }
  if (expectedOwner && action !== 'delete' && value !== ABSENT) {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || typeof value.__pluginOwner !== 'string'
      || value.__pluginOwner.length === 0
    ) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING',
        field: '__pluginOwner',
        expected: expectedOwner,
        observed: value && typeof value === 'object' && !Array.isArray(value)
          ? 'missing'
          : typeof value,
      });
    } else if (value.__pluginOwner !== expectedOwner) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISMATCH',
        field: '__pluginOwner',
        expected: expectedOwner,
        observedHash: digest(value.__pluginOwner),
      });
    }
  }
  if (rowIdentity.status === 'unsupported') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_UNSUPPORTED',
      field: 'resource.id',
      expected: 'parseable row identity tokens',
      observed: resource?.id || null,
    });
  } else if (rowIdentity.status === 'mismatch') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH',
      field: 'rowIdentity',
      expected: rowIdentity.fields.map((field) => ({
        field: field.field,
        expected: field.expected,
      })),
      observed: rowIdentity.fields.map((field) => ({
        field: field.field,
        observedHash: field.observedHash,
        matched: field.matched,
      })),
    });
  }
  if (schemaValidation?.status === 'unsupported') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_UNSUPPORTED',
      field: 'rowSchema',
      expected: 'valid contract-bound row schema',
      observed: schemaValidation.reason || null,
    });
  } else if (schemaValidation?.status === 'mismatch') {
    const firstMismatch = schemaValidation.fields.find((field) => field.matched !== true) || null;
    issues.push({
      reasonCode: firstMismatch?.state === 'missing'
        ? 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_FIELD_MISSING'
        : firstMismatch?.state === 'unexpected'
          ? 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_UNEXPECTED_FIELD'
          : firstMismatch?.state === 'constraint-mismatch'
            ? 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_CONSTRAINT_MISMATCH'
            : 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH',
      field: firstMismatch?.path || firstMismatch?.field || 'rowSchema',
      expected: firstMismatch ? {
        type: firstMismatch.expectedType,
        required: firstMismatch.required,
        ...(firstMismatch.constraint ? {
          constraint: firstMismatch.constraint,
          constraintHash: firstMismatch.constraintHash,
        } : {}),
      } : null,
      observed: firstMismatch ? {
        state: firstMismatch.state,
        type: firstMismatch.observedType,
        ...(firstMismatch.observedHash ? { hash: firstMismatch.observedHash } : {}),
      } : null,
    });
  }

  const accepted = issues.length === 0;
  const evidence = {
    schemaVersion: 1,
    operation: 'plugin-driver-payload-validation',
    validator: PLUGIN_DRIVER_CONTRACT_BOUND_VALIDATOR,
    reasonCode: accepted
      ? 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED'
      : issues[0].reasonCode,
    outcome: accepted ? 'accepted' : 'refused-before-mutation',
    issueCodes: issues.map((issue) => issue.reasonCode),
    issues,
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: resource?.key || null,
    pluginOwner: expectedOwner,
    driver: expectedDriver,
    table: expectedTable,
    action,
    supportsDelete: supportsDelete === true,
    contractSupportsDelete,
    contractHash: contractValidationEvidence.contractHash || null,
    rowIdentity,
    ...(schemaValidation ? { schemaValidation } : {}),
    value: {
      state: value === ABSENT ? 'absent' : 'present',
      hash: digest(value),
    },
    contractValidationHash: pluginOwnedRowDriverContractValidationEvidenceHash(contractValidationEvidence),
  };

  if (accepted) {
    return { supported: true, evidence };
  }
  return {
    supported: false,
    className: 'invalid-plugin-driver-payload',
    reasonCode: evidence.reasonCode,
    reason: 'Plugin-owned row driver contract-bound payload validation failed.',
    evidence,
  };
}

function contractBoundRowSchemaValidationEvidence(rowSchema, value, action) {
  const normalized = normalizePluginOwnedRowDriverRowSchema(rowSchema).normalized;
  const schemaHash = digest(normalized);
  if (!normalized) {
    return {
      schemaHash,
      status: 'unsupported',
      reason: 'invalid schema',
      fields: [],
    };
  }
  if (action === 'delete' || value === ABSENT) {
    return {
      schemaHash,
      status: 'not-required',
      fields: [],
    };
  }
  const fields = contractBoundRowSchemaFieldEvidence({
    schemaFields: normalized.fields,
    value,
  });
  return {
    schemaHash,
    status: fields.every((field) => field.matched) ? 'matched' : 'mismatch',
    fields,
  };
}

function contractBoundRowSchemaFieldEvidence({
  schemaFields,
  value,
  pathPrefix = '',
} = {}) {
  const valueIsObject = value && typeof value === 'object' && !Array.isArray(value);
  const fields = [];
  for (const field of schemaFields) {
    const path = pathPrefix ? `${pathPrefix}.${field.field}` : field.field;
    const observedExists = valueIsObject && Object.prototype.hasOwnProperty.call(value, field.field);
    const observed = observedExists ? value[field.field] : undefined;
    const observedType = observedExists ? contractBoundRowSchemaValueType(observed) : null;
    const typeMatched = observedExists
      ? observedType === field.type
      : field.required !== true;
    const constraintEvidence = observedExists && typeMatched
      ? contractBoundRowSchemaConstraintEvidence(field, observed)
      : null;
    const matched = typeMatched && (constraintEvidence?.matched ?? true);
    fields.push({
      field: field.field,
      ...(pathPrefix ? { path } : {}),
      expectedType: field.type,
      required: field.required === true,
      state: observedExists && typeMatched && constraintEvidence?.matched === false
        ? 'constraint-mismatch'
        : observedExists ? 'present' : 'missing',
      observedType,
      ...(constraintEvidence ? {
        constraint: constraintEvidence.constraint,
        constraintHash: constraintEvidence.constraintHash,
        observedHash: constraintEvidence.observedHash,
      } : {}),
      matched,
    });
    if (matched && field.type === 'object' && Array.isArray(field.properties)) {
      fields.push(...contractBoundRowSchemaFieldEvidence({
        schemaFields: field.properties,
        value: observed,
        pathPrefix: path,
      }));
      if (field.additionalProperties === false && observed && typeof observed === 'object' && !Array.isArray(observed)) {
        const allowed = new Set(field.properties.map((property) => property.field));
        const extraFields = Object.keys(observed).filter((extraField) => !allowed.has(extraField));
        if (extraFields.length > 0) {
          fields.push({
            field: field.field,
            path,
            expectedType: 'object',
            required: field.required === true,
            state: 'unexpected',
            observedType: contractBoundRowSchemaValueType(observed),
            observedExtraPropertyCount: extraFields.length,
            matched: false,
          });
        }
      }
    }
  }
  return fields;
}

function contractBoundRowSchemaConstraintEvidence(field, observed) {
  const observedHash = digest(observed);
  if (field.constHash) {
    return {
      constraint: 'const',
      constraintHash: field.constHash,
      observedHash,
      matched: observedHash === field.constHash,
    };
  }
  if (Array.isArray(field.enumHashes)) {
    return {
      constraint: 'enum',
      constraintHash: digest(field.enumHashes),
      observedHash,
      matched: field.enumHashes.includes(observedHash),
    };
  }
  return null;
}

function contractBoundRowSchemaValueType(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
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
  if (typeof value === 'object') {
    return 'object';
  }
  return typeof value;
}

function contractBoundRowIdentityEvidence(resource, value, action) {
  const resourceId = resource?.id || null;
  if (action === 'delete' || value === ABSENT) {
    return {
      resourceId,
      status: 'not-required',
      fields: [],
    };
  }
  const tokens = parseContractBoundRowIdentityTokens(resourceId);
  if (tokens.length === 0) {
    return {
      resourceId,
      status: 'unsupported',
      fields: [],
    };
  }
  const valueIsObject = value && typeof value === 'object' && !Array.isArray(value);
  const fields = tokens.map((token) => {
    const observed = valueIsObject ? value[token.field] : undefined;
    const matched = observed !== undefined && String(observed) === token.expected;
    return {
      field: token.field,
      expected: token.expected,
      observedHash: observed === undefined ? null : digest(String(observed)),
      matched,
    };
  });
  return {
    resourceId,
    status: fields.every((field) => field.matched) ? 'matched' : 'mismatch',
    fields,
  };
}

function parseContractBoundRowIdentityTokens(resourceId) {
  if (!isNonEmptyString(resourceId)) {
    return [];
  }
  const segments = resourceId.split('|');
  const tokens = [];
  for (const segment of segments) {
    const separator = segment.indexOf(':');
    if (separator <= 0 || separator === segment.length - 1) {
      return [];
    }
    const field = segment.slice(0, separator);
    const expected = segment.slice(separator + 1);
    if (!isNonEmptyString(field) || !isNonEmptyString(expected)) {
      return [];
    }
    tokens.push({ field, expected });
  }
  return tokens;
}

function acceptedContractValidationEvidence(evidence) {
  const expectedContractHash = pluginOwnedRowDriverContractHash(evidence);
  return evidence?.reasonCode === 'PLUGIN_DRIVER_CONTRACT_ACCEPTED'
    && evidence.schemaVersion === 1
    && evidence.operation === 'plugin-driver-contract-validation'
    && evidence.contractKind === PLUGIN_DRIVER_CONTRACT_KIND
    && evidence.contractVersion === PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION
    && evidence.outcome === 'accepted'
    && Array.isArray(evidence.issueCodes)
    && evidence.issueCodes.length === 0
    && evidence.rawValuesIncluded === false
    && evidence.contractHash === expectedContractHash
    && pluginOwnedRowDriverContractValidationEvidenceMatches(evidence);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSerializedWpOptionPayload(resource, driver, value) {
  return driver === 'wp-option'
    && resource?.type === 'row'
    && resource.table === 'wp_options'
    && value !== ABSENT
    && value?.serialization === 'php-serialize';
}

function invalidSerializedOptionEvidence({ resource, driver, value }) {
  return {
    supported: false,
    className: 'invalid-plugin-driver-payload',
    reasonCode: INVALID_SERIALIZED_OPTION_PAYLOAD,
    reason: 'Plugin-owned serialized wp_options payload failed php-serialize validation.',
    evidence: serializedOptionValidationEvidence({
      resource,
      driver,
      value,
      outcome: 'refused',
    }),
  };
}

function serializedOptionValidationEvidence({ resource, driver, value, outcome }) {
  return {
    schemaVersion: 1,
    operation: 'plugin-driver-payload-validation',
    validator: 'php-serialized-option',
    reasonCode: INVALID_SERIALIZED_OPTION_PAYLOAD,
    outcome,
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: resource?.key || null,
    table: resource?.table || null,
    id: resource?.id || null,
    driver,
    valueHash: digest(value),
    optionValueHash: typeof value?.option_value === 'string' ? digest(value.option_value) : null,
  };
}

function validatePhpSerializedPayload(payload) {
  if (typeof payload !== 'string') {
    return { valid: false };
  }
  const bytes = Buffer.from(payload, 'utf8');
  const offset = parsePhpSerializedValue(bytes, 0, 0);
  return { valid: offset === bytes.length };
}

function parsePhpSerializedValue(bytes, offset, depth) {
  if (depth > 100 || offset >= bytes.length) {
    return -1;
  }

  switch (bytes[offset]) {
    case 78: // N
      return bytes[offset + 1] === 59 ? offset + 2 : -1;
    case 98: // b
      return parsePhpScalar(bytes, offset, /^[01]$/);
    case 105: // i
      return parsePhpScalar(bytes, offset, /^-?(?:0|[1-9]\d*)$/);
    case 100: // d
      return parsePhpScalar(bytes, offset, /^(?:NAN|INF|-INF|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)$/);
    case 115: // s
      return parsePhpByteString(bytes, offset);
    case 97: // a
      return parsePhpKeyValueContainer(bytes, offset, depth, 'a');
    case 79: // O
      return parsePhpObject(bytes, offset, depth);
    case 82: // R
    case 114: // r
      return parsePhpScalar(bytes, offset, /^[1-9]\d*$/);
    default:
      return -1;
  }
}

function parsePhpScalar(bytes, offset, pattern) {
  if (bytes[offset + 1] !== 58) {
    return -1;
  }
  const end = indexOfByte(bytes, 59, offset + 2);
  if (end === -1) {
    return -1;
  }
  const value = bytes.toString('utf8', offset + 2, end);
  return pattern.test(value) ? end + 1 : -1;
}

function parsePhpByteString(bytes, offset) {
  if (bytes[offset] !== 115 || bytes[offset + 1] !== 58) {
    return -1;
  }
  const lengthResult = readUnsignedInteger(bytes, offset + 2);
  if (!lengthResult || bytes[lengthResult.offset] !== 58 || bytes[lengthResult.offset + 1] !== 34) {
    return -1;
  }
  const start = lengthResult.offset + 2;
  const end = start + lengthResult.value;
  if (end + 1 >= bytes.length || bytes[end] !== 34 || bytes[end + 1] !== 59) {
    return -1;
  }
  return end + 2;
}

function parsePhpKeyValueContainer(bytes, offset, depth, type) {
  if (bytes[offset] !== type.charCodeAt(0) || bytes[offset + 1] !== 58) {
    return -1;
  }
  const countResult = readUnsignedInteger(bytes, offset + 2);
  if (!countResult || bytes[countResult.offset] !== 58 || bytes[countResult.offset + 1] !== 123) {
    return -1;
  }
  let cursor = countResult.offset + 2;
  for (let index = 0; index < countResult.value; index++) {
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
  }
  return bytes[cursor] === 125 ? cursor + 1 : -1;
}

function parsePhpObject(bytes, offset, depth) {
  if (bytes[offset] !== 79 || bytes[offset + 1] !== 58) {
    return -1;
  }
  const classLength = readUnsignedInteger(bytes, offset + 2);
  if (!classLength || bytes[classLength.offset] !== 58 || bytes[classLength.offset + 1] !== 34) {
    return -1;
  }
  const classStart = classLength.offset + 2;
  const classEnd = classStart + classLength.value;
  if (classEnd + 1 >= bytes.length || bytes[classEnd] !== 34 || bytes[classEnd + 1] !== 58) {
    return -1;
  }
  const countResult = readUnsignedInteger(bytes, classEnd + 2);
  if (!countResult || bytes[countResult.offset] !== 58 || bytes[countResult.offset + 1] !== 123) {
    return -1;
  }
  let cursor = countResult.offset + 2;
  for (let index = 0; index < countResult.value; index++) {
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
  }
  return bytes[cursor] === 125 ? cursor + 1 : -1;
}

function readUnsignedInteger(bytes, offset) {
  let cursor = offset;
  while (cursor < bytes.length && bytes[cursor] >= 48 && bytes[cursor] <= 57) {
    cursor++;
  }
  if (cursor === offset) {
    return null;
  }
  const raw = bytes.toString('utf8', offset, cursor);
  if (raw.length > 1 && raw.startsWith('0')) {
    return null;
  }
  return {
    value: Number.parseInt(raw, 10),
    offset: cursor,
  };
}

function indexOfByte(bytes, byte, offset) {
  for (let cursor = offset; cursor < bytes.length; cursor++) {
    if (bytes[cursor] === byte) {
      return cursor;
    }
  }
  return -1;
}
