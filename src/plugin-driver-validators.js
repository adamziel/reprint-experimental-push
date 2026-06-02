import { ABSENT, digest } from './stable-json.js';
import {
  PLUGIN_DRIVER_CONTRACT_KIND,
  PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
  pluginOwnedRowDriverContractValidationEvidenceHash,
  pluginOwnedRowDriverContractValidationEvidenceMatches,
  pluginOwnedRowDriverContractHash,
  normalizePluginOwnedRowDriverRowSchema,
  normalizePluginOwnedRowDriverReferenceFields,
} from './plugin-driver-contracts.js';

export const INVALID_SERIALIZED_OPTION_PAYLOAD = 'INVALID_SERIALIZED_OPTION_PAYLOAD';
export const PLUGIN_DRIVER_CONTRACT_BOUND_VALIDATOR = 'contract-bound-row-driver';
export const PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND = 'plugin-owned-row-driver-registration';
export const PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION = 1;
export const PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION =
  'plugin-driver-registration-provenance-validation';
export const PLUGIN_DRIVER_COMPACT_REGISTRATION_PROVENANCE_OPERATION =
  'plugin-driver-registration-provenance';
export const PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED =
  'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED';
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

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
  const referenceFields = contractValidationEvidence.referenceFields
    ? normalizePluginOwnedRowDriverReferenceFields(contractValidationEvidence.referenceFields).normalized
    : null;
  const referenceValidation = referenceFields
    ? contractBoundReferenceFieldValidationEvidence(referenceFields, value, action)
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
  if (referenceValidation?.status === 'unsupported') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELDS_UNSUPPORTED',
      field: 'referenceFields',
      expected: 'valid contract-bound reference field declarations',
      observed: referenceValidation.reason || null,
    });
  } else if (referenceValidation?.status === 'mismatch') {
    const firstMismatch = referenceValidation.fields.find((field) => field.matched !== true) || null;
    issues.push({
      reasonCode: firstMismatch?.state === 'missing'
        ? 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_MISSING'
        : 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID',
      field: firstMismatch?.path || 'referenceFields',
      expected: firstMismatch ? {
        scalarType: firstMismatch.scalarType,
        targetTable: firstMismatch.targetTable,
        targetIdField: firstMismatch.targetIdField,
        required: firstMismatch.required,
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
    ...(referenceValidation ? { referenceValidation } : {}),
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

export function pluginOwnedRowDriverRegistrationBindingHash(binding) {
  const contractHash = binding?.contractHash || pluginOwnedRowDriverContractHash(binding);
  return digest({
    schemaVersion: 1,
    registrationKind: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
    registrationVersion: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION,
    contractKind: PLUGIN_DRIVER_CONTRACT_KIND,
    contractVersion: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
    resourceKey: binding?.resourceKey || null,
    pluginOwner: binding?.pluginOwner || null,
    driver: binding?.driver || null,
    table: binding?.table || null,
    supportsDelete: binding?.supportsDelete === true,
    contractHash,
  });
}

export function pluginOwnedRowDriverRegistrationProvenanceEvidence(contract, {
  source = 'plugin-owned-row-driver-registry',
  evidenceScope = contract?.evidenceScope || contract?.releaseGateEvidenceScope || 'local-candidate',
} = {}) {
  const contractHash = contract?.contractHash || pluginOwnedRowDriverContractHash(contract);
  const evidence = {
    schemaVersion: 1,
    operation: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION,
    registrationKind: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
    registrationVersion: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION,
    outcome: 'accepted',
    reasonCode: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED,
    issueCodes: [],
    issues: [],
    source,
    evidenceScope,
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: contract?.resourceKey || null,
    pluginOwner: contract?.pluginOwner || null,
    driver: contract?.driver || null,
    table: contract?.table || null,
    supportsDelete: contract?.supportsDelete === true,
    contractKind: PLUGIN_DRIVER_CONTRACT_KIND,
    contractVersion: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
    contractHash,
  };
  return {
    ...evidence,
    registrationHash: pluginOwnedRowDriverRegistrationBindingHash(evidence),
  };
}

export function canonicalPluginOwnedRowDriverRegistrationProvenanceEvidence(evidence) {
  if (!isPlainObject(evidence)) {
    return null;
  }
  return {
    schemaVersion: 1,
    operation: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION,
    registrationKind: evidence.registrationKind || null,
    registrationVersion: Number.isInteger(evidence.registrationVersion)
      ? evidence.registrationVersion
      : null,
    outcome: evidence.outcome || null,
    reasonCode: evidence.reasonCode || null,
    issueCodes: Array.isArray(evidence.issueCodes) ? [...evidence.issueCodes] : [],
    issues: Array.isArray(evidence.issues)
      ? evidence.issues.map(canonicalPluginOwnedRowDriverRegistrationProvenanceIssue)
      : [],
    source: evidence.source || null,
    evidenceScope: evidence.evidenceScope || null,
    format: 'hash-only',
    rawValuesIncluded: evidence.rawValuesIncluded === true,
    resourceKey: evidence.resourceKey || null,
    pluginOwner: evidence.pluginOwner || null,
    driver: evidence.driver || null,
    table: evidence.table || null,
    supportsDelete: evidence.supportsDelete === true,
    contractKind: evidence.contractKind || null,
    contractVersion: Number.isInteger(evidence.contractVersion)
      ? evidence.contractVersion
      : null,
    contractHash: evidence.contractHash || null,
    registrationHash: pluginOwnedRowDriverRegistrationBindingHash(evidence),
  };
}

export function pluginOwnedRowDriverRegistrationProvenanceEvidenceHash(evidence) {
  const canonicalEvidence = canonicalPluginOwnedRowDriverRegistrationProvenanceEvidence(evidence);
  return canonicalEvidence ? digest(canonicalEvidence) : null;
}

export function pluginOwnedRowDriverRegistrationProvenanceEvidenceMatches(evidence) {
  const expectedEvidenceHash = pluginOwnedRowDriverRegistrationProvenanceEvidenceHash(evidence);
  return Boolean(expectedEvidenceHash) && digest(evidence) === expectedEvidenceHash;
}

export function acceptedPluginOwnedRowDriverRegistrationProvenanceEvidence(
  evidence,
  contractValidationEvidence = null,
) {
  const expectedContractHash = contractValidationEvidence?.contractHash || evidence?.contractHash || null;
  const expectedRegistrationHash = pluginOwnedRowDriverRegistrationBindingHash({
    ...evidence,
    contractHash: expectedContractHash,
  });
  return evidence?.reasonCode === PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED
    && evidence.schemaVersion === 1
    && evidence.operation === PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION
    && evidence.registrationKind === PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND
    && evidence.registrationVersion === PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION
    && evidence.outcome === 'accepted'
    && Array.isArray(evidence.issueCodes)
    && evidence.issueCodes.length === 0
    && Array.isArray(evidence.issues)
    && evidence.issues.length === 0
    && evidence.format === 'hash-only'
    && evidence.rawValuesIncluded === false
    && evidence.contractKind === PLUGIN_DRIVER_CONTRACT_KIND
    && evidence.contractVersion === PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION
    && evidence.contractHash === expectedContractHash
    && evidence.registrationHash === expectedRegistrationHash
    && (!contractValidationEvidence
      || (
        evidence.resourceKey === contractValidationEvidence.resourceKey
        && evidence.pluginOwner === contractValidationEvidence.pluginOwner
        && evidence.driver === contractValidationEvidence.driver
        && evidence.table === contractValidationEvidence.table
        && evidence.supportsDelete === contractValidationEvidence.supportsDelete
      ))
    && pluginOwnedRowDriverRegistrationProvenanceEvidenceMatches(evidence);
}

export function validatePluginOwnedRowDriverRegistrationProvenance({
  resource,
  owner = null,
  driver = null,
  table = null,
  supportsDelete = false,
  contractValidationEvidence = null,
  registrationProvenanceEvidence = null,
}) {
  const expected = {
    resourceKey: contractValidationEvidence?.resourceKey || resource?.key || null,
    pluginOwner: contractValidationEvidence?.pluginOwner || owner || null,
    driver: contractValidationEvidence?.driver || driver || null,
    table: contractValidationEvidence?.table || table || null,
    supportsDelete: contractValidationEvidence
      ? contractValidationEvidence.supportsDelete === true
      : supportsDelete === true,
    contractHash: contractValidationEvidence?.contractHash || null,
  };
  const issues = [];
  if (!registrationProvenanceEvidence) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_REQUIRED',
      field: 'registeredDriverProvenanceEvidence',
      expected: 'accepted registered row-driver provenance evidence',
      observed: null,
    });
  } else if (!isPlainObject(registrationProvenanceEvidence)) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_INVALID',
      field: 'registeredDriverProvenanceEvidence',
      expected: 'hash-only evidence object',
      observed: Array.isArray(registrationProvenanceEvidence)
        ? 'array'
        : typeof registrationProvenanceEvidence,
    });
  } else if (compactPluginOwnedRowDriverRegistrationProvenanceEvidence(registrationProvenanceEvidence)) {
    issues.push(...compactPluginOwnedRowDriverRegistrationProvenanceIssues(
      registrationProvenanceEvidence,
      expected,
    ));
  } else {
    if (registrationProvenanceEvidence.rawValuesIncluded !== false) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_RAW_VALUES_INCLUDED',
        field: 'rawValuesIncluded',
        expected: false,
        observed: registrationProvenanceEvidence.rawValuesIncluded ?? null,
      });
    }
    if (registrationProvenanceEvidence.schemaVersion !== 1) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_UNSUPPORTED_VERSION',
        field: 'schemaVersion',
        expected: 1,
        observed: registrationProvenanceEvidence.schemaVersion ?? null,
      });
    }
    if (registrationProvenanceEvidence.operation !== PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_INVALID_OPERATION',
        field: 'operation',
        expected: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION,
        observed: registrationProvenanceEvidence.operation || null,
      });
    }
    if (registrationProvenanceEvidence.registrationKind !== PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_UNSUPPORTED_KIND',
        field: 'registrationKind',
        expected: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
        observed: registrationProvenanceEvidence.registrationKind || null,
      });
    }
    if (registrationProvenanceEvidence.outcome !== 'accepted') {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_NOT_ACCEPTED',
        field: 'outcome',
        expected: 'accepted',
        observed: registrationProvenanceEvidence.outcome || null,
      });
    }
    if (
      !Array.isArray(registrationProvenanceEvidence.issueCodes)
      || registrationProvenanceEvidence.issueCodes.length !== 0
    ) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ISSUES_PRESENT',
        field: 'issueCodes',
        expected: [],
        observedHash: digest(registrationProvenanceEvidence.issueCodes ?? null),
      });
    }
    if (registrationProvenanceEvidence.format !== 'hash-only') {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_NOT_HASH_ONLY',
        field: 'format',
        expected: 'hash-only',
        observed: registrationProvenanceEvidence.format || null,
      });
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (expectedValue === null || expectedValue === undefined) {
        continue;
      }
      const observedValue = registrationProvenanceEvidence[field];
      if (observedValue !== expectedValue) {
        issues.push({
          reasonCode: `PLUGIN_DRIVER_REGISTRATION_PROVENANCE_${field === 'contractHash' ? 'CONTRACT_HASH' : field.toUpperCase()}_MISMATCH`,
          field,
          expected: field === 'contractHash' ? expectedValue : expectedValue,
          ...(field === 'contractHash'
            ? { observedHash: digest(observedValue ?? null) }
            : { observed: observedValue ?? null }),
        });
      }
    }
    if (registrationProvenanceEvidence.contractKind !== PLUGIN_DRIVER_CONTRACT_KIND) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_CONTRACT_KIND_MISMATCH',
        field: 'contractKind',
        expected: PLUGIN_DRIVER_CONTRACT_KIND,
        observed: registrationProvenanceEvidence.contractKind || null,
      });
    }
    if (registrationProvenanceEvidence.contractVersion !== PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_CONTRACT_VERSION_MISMATCH',
        field: 'contractVersion',
        expected: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
        observed: registrationProvenanceEvidence.contractVersion ?? null,
      });
    }
    const expectedRegistrationHash = pluginOwnedRowDriverRegistrationBindingHash({
      ...registrationProvenanceEvidence,
      ...expected,
    });
    if (registrationProvenanceEvidence.registrationHash !== expectedRegistrationHash) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_HASH_MISMATCH',
        field: 'registrationHash',
        expected: expectedRegistrationHash,
        observedHash: digest(registrationProvenanceEvidence.registrationHash ?? null),
      });
    }
    if (!pluginOwnedRowDriverRegistrationProvenanceEvidenceMatches(registrationProvenanceEvidence)) {
      issues.push({
        reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_EVIDENCE_MISMATCH',
        field: 'registeredDriverProvenanceEvidence',
        expected: 'canonical hash-only evidence',
        observedHash: digest(registrationProvenanceEvidence),
      });
    }
  }

  if (issues.length === 0) {
    return {
      supported: true,
      evidence: registrationProvenanceEvidence,
    };
  }

  const evidence = pluginOwnedRowDriverRegistrationProvenanceRefusalEvidence({
    reasonCode: issues[0].reasonCode,
    issues,
    expected,
    source: registrationProvenanceEvidence?.source || contractValidationEvidence?.source || null,
    evidenceScope: registrationProvenanceEvidence?.evidenceScope
      || contractValidationEvidence?.evidenceScope
      || null,
  });
  return {
    supported: false,
    className: issues[0].reasonCode === 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_REQUIRED'
      ? 'missing-plugin-driver-registration-provenance'
      : 'invalid-plugin-driver-registration-provenance',
    reasonCode: issues[0].reasonCode,
    reason: 'Generic plugin-owned custom row drivers require accepted registered-driver provenance evidence.',
    evidence,
  };
}

function compactPluginOwnedRowDriverRegistrationProvenanceEvidence(evidence) {
  return isPlainObject(evidence)
    && (
      evidence.operation === PLUGIN_DRIVER_COMPACT_REGISTRATION_PROVENANCE_OPERATION
      || Object.prototype.hasOwnProperty.call(evidence, 'provenanceKind')
      || Object.prototype.hasOwnProperty.call(evidence, 'bindingHash')
      || Object.prototype.hasOwnProperty.call(evidence, 'resourceKeyHash')
    );
}

function compactPluginOwnedRowDriverRegistrationProvenanceIssues(evidence, expected) {
  const issues = [];
  const expectedResourceKeyHash = expected.resourceKey ? digest(expected.resourceKey) : null;
  const expectedBindingHash = compactPluginOwnedRowDriverRegistrationBindingHash(evidence, expected);
  if (!hasExactKeys(evidence, [
    'schemaVersion',
    'operation',
    'provenanceKind',
    'reasonCode',
    'outcome',
    'format',
    'rawValuesIncluded',
    'resourceKeyHash',
    'registrationHash',
    'contractHash',
    'bindingHash',
  ])) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_EVIDENCE_MISMATCH',
      field: 'registrationProvenance',
      expected: 'exact compact hash-only evidence',
      observedHash: digest(evidence),
    });
  }
  if (evidence.schemaVersion !== PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_UNSUPPORTED_VERSION',
      field: 'schemaVersion',
      expected: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION,
      observed: evidence.schemaVersion ?? null,
    });
  }
  if (evidence.operation !== PLUGIN_DRIVER_COMPACT_REGISTRATION_PROVENANCE_OPERATION) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_INVALID_OPERATION',
      field: 'operation',
      expected: PLUGIN_DRIVER_COMPACT_REGISTRATION_PROVENANCE_OPERATION,
      observed: evidence.operation || null,
    });
  }
  if (evidence.provenanceKind !== PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_UNSUPPORTED_KIND',
      field: 'provenanceKind',
      expected: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
      observed: evidence.provenanceKind || null,
    });
  }
  if (evidence.reasonCode !== PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_NOT_ACCEPTED',
      field: 'reasonCode',
      expected: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_ACCEPTED,
      observed: evidence.reasonCode || null,
    });
  }
  if (evidence.outcome !== 'accepted') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_NOT_ACCEPTED',
      field: 'outcome',
      expected: 'accepted',
      observed: evidence.outcome || null,
    });
  }
  if (evidence.format !== 'hash-only') {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_NOT_HASH_ONLY',
      field: 'format',
      expected: 'hash-only',
      observed: evidence.format || null,
    });
  }
  if (evidence.rawValuesIncluded !== false) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_RAW_VALUES_INCLUDED',
      field: 'rawValuesIncluded',
      expected: false,
      observed: evidence.rawValuesIncluded ?? null,
    });
  }
  if (evidence.resourceKeyHash !== expectedResourceKeyHash) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_RESOURCEKEY_MISMATCH',
      field: 'resourceKeyHash',
      expected: expectedResourceKeyHash,
      observedHash: digest(evidence.resourceKeyHash ?? null),
    });
  }
  if (evidence.contractHash !== expected.contractHash) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_CONTRACT_HASH_MISMATCH',
      field: 'contractHash',
      expected: expected.contractHash,
      observedHash: digest(evidence.contractHash ?? null),
    });
  }
  if (!SHA256_HEX_PATTERN.test(evidence.registrationHash || '')) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_HASH_MISMATCH',
      field: 'registrationHash',
      expected: 'sha256 hex',
      observedHash: digest(evidence.registrationHash ?? null),
    });
  }
  if (evidence.bindingHash !== expectedBindingHash) {
    issues.push({
      reasonCode: 'PLUGIN_DRIVER_REGISTRATION_PROVENANCE_HASH_MISMATCH',
      field: 'bindingHash',
      expected: expectedBindingHash,
      observedHash: digest(evidence.bindingHash ?? null),
    });
  }
  return issues;
}

function compactPluginOwnedRowDriverRegistrationBindingHash(evidence, expected) {
  return digest({
    schemaVersion: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION,
    provenanceKind: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
    resourceKeyHash: expected.resourceKey ? digest(expected.resourceKey) : null,
    pluginOwnerHash: expected.pluginOwner ? digest(expected.pluginOwner) : null,
    driverHash: expected.driver ? digest(expected.driver) : null,
    tableHash: expected.table ? digest(expected.table) : null,
    supportsDeleteHash: digest(expected.supportsDelete === true),
    registrationHash: evidence?.registrationHash || null,
    contractHash: expected.contractHash || null,
  });
}

function pluginOwnedRowDriverRegistrationProvenanceRefusalEvidence({
  reasonCode,
  issues,
  expected,
  source,
  evidenceScope,
}) {
  const base = {
    schemaVersion: 1,
    operation: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_OPERATION,
    registrationKind: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_KIND,
    registrationVersion: PLUGIN_DRIVER_REGISTRATION_PROVENANCE_SCHEMA_VERSION,
    outcome: 'refused-before-mutation',
    reasonCode,
    issueCodes: issues.map((issue) => issue.reasonCode),
    issues,
    source,
    evidenceScope,
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: expected.resourceKey,
    pluginOwner: expected.pluginOwner,
    driver: expected.driver,
    table: expected.table,
    supportsDelete: expected.supportsDelete === true,
    contractKind: PLUGIN_DRIVER_CONTRACT_KIND,
    contractVersion: PLUGIN_DRIVER_CONTRACT_SCHEMA_VERSION,
    contractHash: expected.contractHash,
  };
  return {
    ...base,
    registrationHash: pluginOwnedRowDriverRegistrationBindingHash(base),
  };
}

function canonicalPluginOwnedRowDriverRegistrationProvenanceIssue(issue) {
  if (!isPlainObject(issue)) {
    return {
      reasonCode: null,
      field: null,
      expected: null,
      observed: null,
      observedHash: null,
    };
  }
  return {
    reasonCode: issue.reasonCode || null,
    field: issue.field || null,
    expected: issue.expected ?? null,
    observed: issue.observed ?? null,
    observedHash: issue.observedHash ?? null,
  };
}

function contractBoundReferenceFieldValidationEvidence(referenceFields, value, action) {
  const normalized = normalizePluginOwnedRowDriverReferenceFields(referenceFields).normalized;
  const referenceFieldsHash = digest(normalized);
  if (!normalized) {
    return {
      referenceFieldsHash,
      status: 'unsupported',
      reason: 'invalid reference fields',
      fields: [],
    };
  }
  if (action === 'delete' || value === ABSENT) {
    return {
      referenceFieldsHash,
      status: 'not-required',
      fields: [],
    };
  }
  const fields = normalized.fields.map((field) =>
    contractBoundReferenceFieldEvidence(field, value));
  return {
    referenceFieldsHash,
    status: fields.every((field) => field.matched) ? 'matched' : 'mismatch',
    fields,
  };
}

function contractBoundReferenceFieldEvidence(field, value) {
  const resolved = resolveContractBoundReferencePath(value, field.path);
  if (!resolved.exists) {
    return {
      path: field.path,
      targetTable: field.targetTable,
      targetIdField: field.targetIdField,
      scalarType: field.scalarType,
      required: field.required === true,
      state: 'missing',
      observedType: null,
      matched: field.required !== true,
    };
  }

  const targetId = normalizeReferencePositiveInteger(resolved.value);
  const observedType = contractBoundRowSchemaValueType(resolved.value);
  if (targetId === null) {
    return {
      path: field.path,
      targetTable: field.targetTable,
      targetIdField: field.targetIdField,
      scalarType: field.scalarType,
      required: field.required === true,
      state: 'invalid',
      observedType,
      observedHash: digest(String(resolved.value)),
      matched: false,
    };
  }

  return {
    path: field.path,
    targetTable: field.targetTable,
    targetIdField: field.targetIdField,
    scalarType: field.scalarType,
    required: field.required === true,
    state: 'present',
    observedType,
    observedHash: digest(String(resolved.value)),
    targetResourceKey: `row:${JSON.stringify([field.targetTable, `${field.targetIdField}:${targetId}`])}`,
    matched: true,
  };
}

function resolveContractBoundReferencePath(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { exists: false, value: undefined };
  }
  let cursor = value;
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { exists: false, value: undefined };
    }
    cursor = cursor[segment];
  }
  return { exists: true, value: cursor };
}

function normalizeReferencePositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
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
  if (normalized.additionalProperties === false && value && typeof value === 'object' && !Array.isArray(value)) {
    const allowed = new Set(normalized.fields.map((field) => field.field));
    const extraFields = Object.keys(value).filter((extraField) => !allowed.has(extraField));
    if (extraFields.length > 0) {
      fields.push({
        field: 'row',
        expectedType: 'object',
        required: true,
        state: 'unexpected',
        observedType: contractBoundRowSchemaValueType(value),
        observedExtraPropertyCount: extraFields.length,
        matched: false,
      });
    }
  }
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
  const range = contractBoundRowSchemaRangeConstraint(field);
  if (range) {
    return {
      constraint: 'range',
      constraintHash: digest(range),
      observedHash,
      matched: contractBoundRowSchemaRangeConstraintMatches(range, observed),
    };
  }
  return null;
}

function contractBoundRowSchemaRangeConstraint(field) {
  const range = {};
  if (Object.prototype.hasOwnProperty.call(field, 'minimum')) {
    range.minimum = field.minimum;
  }
  if (Object.prototype.hasOwnProperty.call(field, 'maximum')) {
    range.maximum = field.maximum;
  }
  return Object.keys(range).length > 0 ? range : null;
}

function contractBoundRowSchemaRangeConstraintMatches(range, observed) {
  if (typeof observed !== 'number' || !Number.isFinite(observed)) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(range, 'minimum')
    && observed < range.minimum
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(range, 'maximum')
    && observed > range.maximum
  ) {
    return false;
  }
  return true;
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
  const postmetaMatch = /^post_id:([^:]+):meta_key:(.+)$/.exec(resourceId);
  if (postmetaMatch) {
    return [
      { field: 'post_id', expected: postmetaMatch[1] },
      { field: 'meta_key', expected: postmetaMatch[2] },
    ];
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
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
