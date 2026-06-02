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
  });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

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
