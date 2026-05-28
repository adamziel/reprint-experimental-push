import { digest } from './stable-json.js';

const EVALUATOR = 'reprint-push-protocol-compatibility';
const CONTRACT_ID = 'push-protocol-compatibility-contract-v1';
const CONTRACT_SCHEMA_VERSION = 1;
const MINIMUM_PROTOCOL_VERSION = '1.0.0';
const CURRENT_PROTOCOL_VERSION = '1.1.0';
const REQUIRED_CAPABILITY_GROUPS = ['auth', 'journal', 'lease'];

const VERSION_1_0_REQUIRED = Object.freeze({
  auth: Object.freeze([
    'auth.canonical-push-signature',
    'auth.hmac-sha256',
    'auth.manage-options',
    'auth.session-bound-source',
  ]),
  journal: Object.freeze([
    'journal.append-only',
    'journal.read-only-inspect',
    'journal.restart-readable',
  ]),
  lease: Object.freeze([
    'lease.claim-generation',
    'lease.compare-and-swap-storage-guard',
    'lease.expiry-fence',
  ]),
});

const VERSION_1_1_REQUIRED = Object.freeze({
  auth: Object.freeze([
    'auth.application-password-binding',
    'auth.canonical-push-signature',
    'auth.hmac-sha256',
    'auth.manage-options',
    'auth.session-bound-source',
  ]),
  journal: Object.freeze([
    'journal.append-only',
    'journal.durable-commit-boundary',
    'journal.read-only-inspect',
    'journal.restart-readable',
  ]),
  lease: Object.freeze([
    'lease.claim-generation',
    'lease.compare-and-swap-storage-guard',
    'lease.expiry-fence',
    'lease.monotonic-sequence',
  ]),
});

const VERSION_1_0_CAPABILITIES = sortedUnique([
  ...VERSION_1_0_REQUIRED.auth,
  ...VERSION_1_0_REQUIRED.journal,
  ...VERSION_1_0_REQUIRED.lease,
  'apply.batch-live-revalidation',
  'dry-run.receipt-not-lock',
  'preflight.base-manifest-binding',
  'recovery.inspect-first',
  'snapshot-hashes.planning-only',
]);

const VERSION_1_1_CAPABILITIES = sortedUnique([
  ...VERSION_1_1_REQUIRED.auth,
  ...VERSION_1_1_REQUIRED.journal,
  ...VERSION_1_1_REQUIRED.lease,
  'apply.batch-live-revalidation',
  'apply.storage-boundary-revalidation',
  'dry-run.receipt-not-lock',
  'preflight.base-manifest-binding',
  'recovery.inspect-first',
  'snapshot-hashes.planning-only',
  'topology.local-only-ingress-8080',
]);

const SUPPORTED_PROTOCOL_VERSION_DATA = Object.freeze([
  freezeVersion({
    version: '1.0.0',
    status: 'supported',
    introduced: '2026-05-27',
    capabilities: VERSION_1_0_CAPABILITIES,
    requiredCapabilities: VERSION_1_0_REQUIRED,
  }),
  freezeVersion({
    version: '1.1.0',
    status: 'current',
    introduced: '2026-05-28',
    capabilities: VERSION_1_1_CAPABILITIES,
    requiredCapabilities: VERSION_1_1_REQUIRED,
  }),
]);

export const PROTOCOL_COMPATIBILITY_CONTRACT = deepFreeze({
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  contractId: CONTRACT_ID,
  evaluator: EVALUATOR,
  machineReadable: true,
  minimumVersion: MINIMUM_PROTOCOL_VERSION,
  currentVersion: CURRENT_PROTOCOL_VERSION,
  requiredCapabilityGroups: REQUIRED_CAPABILITY_GROUPS,
  negotiation: {
    failClosedOnUnknownVersion: true,
    failClosedOnDowngrade: true,
    exactCapabilitySetRequired: true,
    fallbackPolicy: 'no-fallback-after-incompatible-offer',
  },
  supportedVersions: SUPPORTED_PROTOCOL_VERSION_DATA,
});

export const PROTOCOL_COMPATIBILITY_ERROR_CODES = Object.freeze({
  missingOffer: 'PUSH_PROTOCOL_OFFER_REQUIRED',
  downgradedVersion: 'PUSH_PROTOCOL_VERSION_DOWNGRADED',
  unsupportedVersion: 'PUSH_PROTOCOL_VERSION_UNSUPPORTED',
  requiredCapabilityMissing: 'PUSH_PROTOCOL_REQUIRED_CAPABILITY_MISSING',
  capabilityMismatch: 'PUSH_PROTOCOL_CAPABILITY_MISMATCH',
});

export function negotiatePushProtocolCompatibility(offer, options = {}) {
  const contract = normalizeProtocolCompatibilityContract(options.contract || PROTOCOL_COMPATIBILITY_CONTRACT);
  const offers = normalizeOffers(offer);

  if (offers.length === 0) {
    return failClosed({
      code: PROTOCOL_COMPATIBILITY_ERROR_CODES.missingOffer,
      reason: 'A protocol version offer is required before preflight, dry-run, apply, journal, or recovery may run.',
      contract,
      offers,
    });
  }

  const versionReports = offers.map((entry, index) => classifyVersionOffer(entry, contract, index));
  const blockingVersion = versionReports.find((entry) => entry.status !== 'supported');

  if (blockingVersion) {
    return failClosed({
      code: blockingVersion.code,
      reason: blockingVersion.reason,
      contract,
      offers,
      versionReports,
      selectedOffer: blockingVersion.offer,
    });
  }

  const selected = highestSupportedOffer(versionReports);
  const capabilityComparison = compareCapabilities(
    selected.definition.capabilities,
    selected.offer.capabilities,
    selected.definition.requiredCapabilities,
    contract.requiredCapabilityGroups,
  );

  if (capabilityComparison.missingRequiredCapabilities.length > 0) {
    return failClosed({
      code: PROTOCOL_COMPATIBILITY_ERROR_CODES.requiredCapabilityMissing,
      reason: 'Required auth, journal, or lease capabilities are missing; mutation stays fail-closed.',
      contract,
      offers,
      versionReports,
      selectedOffer: selected.offer,
      selectedDefinition: selected.definition,
      capabilityComparison,
    });
  }

  if (capabilityComparison.missingCapabilities.length > 0 || capabilityComparison.unexpectedCapabilities.length > 0) {
    return failClosed({
      code: PROTOCOL_COMPATIBILITY_ERROR_CODES.capabilityMismatch,
      reason: 'The offered capability set does not exactly match the negotiated protocol version.',
      contract,
      offers,
      versionReports,
      selectedOffer: selected.offer,
      selectedDefinition: selected.definition,
      capabilityComparison,
    });
  }

  return deepFreeze({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    evaluator: EVALUATOR,
    contractId: contract.contractId,
    status: 'negotiated',
    ok: true,
    failClosed: false,
    mutationAllowed: true,
    code: 'PUSH_PROTOCOL_NEGOTIATED',
    reason: 'Protocol version and capabilities match the compatibility contract exactly.',
    negotiatedVersion: selected.definition.version,
    selectedVersion: selected.definition.version,
    offeredVersions: offers.map((entry) => entry.version),
    capabilities: [...selected.definition.capabilities],
    capabilityDigest: protocolCapabilityDigest(selected.definition.version, selected.definition.capabilities),
    capabilityComparison,
    requiredCapabilityEvidence: capabilityComparison.requiredCapabilityEvidence,
    versionReports,
  });
}

export function expectedCapabilitiesForVersion(version, options = {}) {
  const contract = normalizeProtocolCompatibilityContract(options.contract || PROTOCOL_COMPATIBILITY_CONTRACT);
  const definition = findVersion(contract, version);
  return definition ? [...definition.capabilities] : [];
}

export function protocolCompatibilitySummary(result) {
  return deepFreeze({
    evaluator: result?.evaluator || EVALUATOR,
    status: result?.status || 'failed-closed',
    ok: result?.ok === true,
    mutationAllowed: result?.mutationAllowed === true,
    failClosed: result?.failClosed !== false,
    code: result?.code || PROTOCOL_COMPATIBILITY_ERROR_CODES.missingOffer,
    negotiatedVersion: result?.negotiatedVersion || null,
    offeredVersions: Array.isArray(result?.offeredVersions) ? [...result.offeredVersions] : [],
    missingRequiredCapabilities: Array.isArray(result?.capabilityComparison?.missingRequiredCapabilities)
      ? [...result.capabilityComparison.missingRequiredCapabilities]
      : [],
    missingCapabilities: Array.isArray(result?.capabilityComparison?.missingCapabilities)
      ? [...result.capabilityComparison.missingCapabilities]
      : [],
    unexpectedCapabilities: Array.isArray(result?.capabilityComparison?.unexpectedCapabilities)
      ? [...result.capabilityComparison.unexpectedCapabilities]
      : [],
  });
}

export function validateProtocolCompatibilityContract(rawContract = PROTOCOL_COMPATIBILITY_CONTRACT) {
  const errors = [];
  const contract = normalizeProtocolCompatibilityContract(rawContract);

  if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CONTRACT_SCHEMA_VERSION}`);
  }
  if (contract.contractId !== CONTRACT_ID) {
    errors.push(`contractId must be ${CONTRACT_ID}`);
  }
  if (contract.machineReadable !== true) {
    errors.push('machineReadable must be true');
  }
  if (!contract.minimumVersion) {
    errors.push('minimumVersion is required');
  }
  if (!contract.currentVersion) {
    errors.push('currentVersion is required');
  }
  if (contract.negotiation.failClosedOnUnknownVersion !== true) {
    errors.push('negotiation.failClosedOnUnknownVersion must be true');
  }
  if (contract.negotiation.failClosedOnDowngrade !== true) {
    errors.push('negotiation.failClosedOnDowngrade must be true');
  }
  if (contract.negotiation.exactCapabilitySetRequired !== true) {
    errors.push('negotiation.exactCapabilitySetRequired must be true');
  }
  if (contract.negotiation.fallbackPolicy !== 'no-fallback-after-incompatible-offer') {
    errors.push('negotiation.fallbackPolicy must be no-fallback-after-incompatible-offer');
  }
  if (!Array.isArray(contract.requiredCapabilityGroups) || contract.requiredCapabilityGroups.length === 0) {
    errors.push('requiredCapabilityGroups must be a non-empty array');
  }
  for (const group of REQUIRED_CAPABILITY_GROUPS) {
    if (!contract.requiredCapabilityGroups.includes(group)) {
      errors.push(`requiredCapabilityGroups must include ${group}`);
    }
  }

  const versions = contract.supportedVersions.map((entry) => entry.version);
  const duplicateVersions = duplicates(versions);
  if (duplicateVersions.length > 0) {
    errors.push(`supportedVersions must not contain duplicate versions: ${duplicateVersions.join(', ')}`);
  }
  if (!versions.includes(contract.minimumVersion)) {
    errors.push(`minimumVersion ${contract.minimumVersion} must be listed as supported`);
  }
  if (!versions.includes(contract.currentVersion)) {
    errors.push(`currentVersion ${contract.currentVersion} must be listed as supported`);
  }
  if (contract.supportedVersions.length < 2) {
    errors.push('at least two supported versions are required to prove exact-version negotiation');
  }

  for (const definition of contract.supportedVersions) {
    if (!definition.version) {
      errors.push('supported version entries must include version');
      continue;
    }
    if (definition.capabilities.length === 0) {
      errors.push(`supported version ${definition.version} must include capabilities`);
    }
    const duplicateCaps = duplicates(definition.capabilities);
    if (duplicateCaps.length > 0) {
      errors.push(`supported version ${definition.version} has duplicate capabilities: ${duplicateCaps.join(', ')}`);
    }
    if (!isSorted(definition.capabilities)) {
      errors.push(`supported version ${definition.version} capabilities must be sorted for stable machine diffs`);
    }
    for (const group of contract.requiredCapabilityGroups) {
      const required = definition.requiredCapabilities[group];
      if (!Array.isArray(required) || required.length === 0) {
        errors.push(`supported version ${definition.version} must list required ${group} capabilities`);
        continue;
      }
      const missingFromCapabilities = required.filter((capability) => !definition.capabilities.includes(capability));
      if (missingFromCapabilities.length > 0) {
        errors.push(
          `supported version ${definition.version} required ${group} capabilities are missing from the exact set: ${missingFromCapabilities.join(', ')}`,
        );
      }
      if (!isSorted(required)) {
        errors.push(`supported version ${definition.version} required ${group} capabilities must be sorted`);
      }
    }
  }

  return deepFreeze({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    evaluator: EVALUATOR,
    contractId: contract.contractId,
    ok: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'failed',
    errors,
    supportedVersions: contract.supportedVersions.map((definition) => ({
      version: definition.version,
      capabilityDigest: protocolCapabilityDigest(definition.version, definition.capabilities),
      capabilityCount: definition.capabilities.length,
      requiredCapabilityGroups: Object.fromEntries(
        contract.requiredCapabilityGroups.map((group) => [group, definition.requiredCapabilities[group]?.length || 0]),
      ),
    })),
  });
}

export function normalizeProtocolCompatibilityContract(rawContract = PROTOCOL_COMPATIBILITY_CONTRACT) {
  const rawNegotiation = rawContract?.negotiation || {};
  const supportedVersions = rawContract?.supportedVersions || rawContract?.supported_versions || [];
  const requiredCapabilityGroups = rawContract?.requiredCapabilityGroups
    || rawContract?.required_capability_groups
    || REQUIRED_CAPABILITY_GROUPS;

  return {
    schemaVersion: Number(rawContract?.schemaVersion ?? rawContract?.schema_version ?? 0),
    contractId: rawContract?.contractId || rawContract?.contract_id || '',
    evaluator: rawContract?.evaluator || EVALUATOR,
    machineReadable: Boolean(rawContract?.machineReadable ?? rawContract?.machine_readable),
    minimumVersion: rawContract?.minimumVersion || rawNegotiation.minimumVersion || rawNegotiation.minimum_version || '',
    currentVersion: rawContract?.currentVersion || rawNegotiation.currentVersion || rawNegotiation.current_version || '',
    requiredCapabilityGroups: sortedUnique(requiredCapabilityGroups),
    negotiation: {
      failClosedOnUnknownVersion: Boolean(
        rawNegotiation.failClosedOnUnknownVersion ?? rawNegotiation.fail_closed_on_unknown_version,
      ),
      failClosedOnDowngrade: Boolean(rawNegotiation.failClosedOnDowngrade ?? rawNegotiation.fail_closed_on_downgrade),
      exactCapabilitySetRequired: Boolean(
        rawNegotiation.exactCapabilitySetRequired ?? rawNegotiation.exact_capability_set_required,
      ),
      fallbackPolicy: rawNegotiation.fallbackPolicy || rawNegotiation.fallback_policy || '',
    },
    supportedVersions: supportedVersions.map((definition) => ({
      version: String(definition.version || ''),
      status: String(definition.status || ''),
      introduced: String(definition.introduced || ''),
      capabilities: normalizeCapabilities(definition.capabilities),
      requiredCapabilities: normalizeRequiredCapabilities(definition.requiredCapabilities || definition.required_capabilities || {}),
    })),
  };
}

export function protocolCapabilityDigest(version, capabilities) {
  return `sha256:${digest({ version, capabilities: normalizeCapabilities(capabilities) })}`;
}

function failClosed({
  code,
  reason,
  contract,
  offers,
  versionReports = [],
  selectedOffer = null,
  selectedDefinition = null,
  capabilityComparison = null,
}) {
  const expectedCapabilities = selectedDefinition ? [...selectedDefinition.capabilities] : [];
  const offeredCapabilities = selectedOffer ? normalizeCapabilities(selectedOffer.capabilities) : [];
  const comparison = capabilityComparison || (selectedDefinition
    ? compareCapabilities(
      expectedCapabilities,
      offeredCapabilities,
      selectedDefinition.requiredCapabilities,
      contract.requiredCapabilityGroups,
    )
    : emptyCapabilityComparison(contract.requiredCapabilityGroups));

  return deepFreeze({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    evaluator: EVALUATOR,
    contractId: contract.contractId,
    status: 'failed-closed',
    ok: false,
    failClosed: true,
    mutationAllowed: false,
    code,
    reason,
    negotiatedVersion: null,
    selectedVersion: selectedDefinition?.version || selectedOffer?.version || null,
    offeredVersions: offers.map((entry) => entry.version),
    capabilities: [],
    expectedCapabilities,
    offeredCapabilities,
    capabilityComparison: comparison,
    requiredCapabilityEvidence: comparison.requiredCapabilityEvidence,
    versionReports,
  });
}

function classifyVersionOffer(offer, contract, index) {
  const minimumComparison = compareProtocolVersions(offer.version, contract.minimumVersion);
  if (minimumComparison !== null && minimumComparison < 0) {
    return {
      index,
      offer,
      status: 'downgraded',
      code: PROTOCOL_COMPATIBILITY_ERROR_CODES.downgradedVersion,
      reason: `Protocol version ${offer.version} is below minimum supported version ${contract.minimumVersion}.`,
    };
  }

  const definition = findVersion(contract, offer.version);
  if (!definition) {
    return {
      index,
      offer,
      status: 'unsupported',
      code: PROTOCOL_COMPATIBILITY_ERROR_CODES.unsupportedVersion,
      reason: `Protocol version ${offer.version || '(missing)'} is not in the supported compatibility contract.`,
    };
  }

  return {
    index,
    offer,
    status: 'supported',
    code: 'PUSH_PROTOCOL_VERSION_SUPPORTED',
    reason: `Protocol version ${offer.version} is supported by the compatibility contract.`,
    definition,
  };
}

function highestSupportedOffer(versionReports) {
  return [...versionReports].sort((left, right) => {
    const byVersion = compareProtocolVersions(right.definition.version, left.definition.version);
    if (byVersion !== 0 && byVersion !== null) {
      return byVersion;
    }
    return left.index - right.index;
  })[0];
}

function emptyCapabilityComparison(requiredCapabilityGroups) {
  const requiredCapabilityEvidence = Object.fromEntries(
    requiredCapabilityGroups.map((group) => [group, {
      status: 'not-evaluated',
      required: [],
      observed: [],
      missing: [],
    }]),
  );

  return deepFreeze({
    status: 'not-evaluated',
    expectedCapabilities: [],
    offeredCapabilities: [],
    missingCapabilities: [],
    unexpectedCapabilities: [],
    missingRequiredCapabilities: [],
    requiredCapabilityEvidence,
  });
}

function compareCapabilities(expected, offered, requiredCapabilities, requiredCapabilityGroups) {
  const expectedCapabilities = normalizeCapabilities(expected);
  const offeredCapabilities = normalizeCapabilities(offered);
  const expectedSet = new Set(expectedCapabilities);
  const offeredSet = new Set(offeredCapabilities);
  const missingCapabilities = expectedCapabilities.filter((capability) => !offeredSet.has(capability));
  const unexpectedCapabilities = offeredCapabilities.filter((capability) => !expectedSet.has(capability));
  const requiredCapabilityEvidence = {};
  const missingRequiredCapabilities = [];

  for (const group of requiredCapabilityGroups) {
    const required = normalizeCapabilities(requiredCapabilities[group] || []);
    const observed = required.filter((capability) => offeredSet.has(capability));
    const missing = required.filter((capability) => !offeredSet.has(capability));
    missingRequiredCapabilities.push(...missing);
    requiredCapabilityEvidence[group] = {
      status: missing.length === 0 ? 'passed' : 'missing',
      required,
      observed,
      missing,
    };
  }

  return deepFreeze({
    status: missingCapabilities.length === 0 && unexpectedCapabilities.length === 0 ? 'exact' : 'mismatch',
    expectedCapabilities,
    offeredCapabilities,
    missingCapabilities,
    unexpectedCapabilities,
    missingRequiredCapabilities: sortedUnique(missingRequiredCapabilities),
    requiredCapabilityEvidence,
  });
}

function findVersion(contract, version) {
  return contract.supportedVersions.find((definition) => definition.version === version) || null;
}

function normalizeOffers(offer) {
  if (!offer || typeof offer !== 'object') {
    return [];
  }

  const rawOffers = Array.isArray(offer.offers)
    ? offer.offers
    : (Array.isArray(offer.offeredVersions) || Array.isArray(offer.offered_versions)
      ? (offer.offeredVersions || offer.offered_versions)
      : [offer]);

  return rawOffers.map((entry) => normalizeOfferEntry(entry, offer));
}

function normalizeOfferEntry(entry, rootOffer) {
  if (typeof entry === 'string') {
    return {
      version: entry,
      capabilities: normalizeCapabilities(rootOffer.capabilitiesByVersion?.[entry] || rootOffer.capabilities_by_version?.[entry] || []),
    };
  }

  const version = String(entry?.version || entry?.protocolVersion || entry?.protocol_version || '');
  const rootCapabilities = Array.isArray(rootOffer.capabilities) && (rootOffer.offers || rootOffer.offeredVersions || rootOffer.offered_versions)
    ? []
    : rootOffer.capabilities;

  return {
    version,
    capabilities: normalizeCapabilities(
      entry?.capabilities
        || rootOffer.capabilitiesByVersion?.[version]
        || rootOffer.capabilities_by_version?.[version]
        || rootCapabilities
        || [],
    ),
  };
}

function normalizeCapabilities(capabilities) {
  return sortedUnique(Array.isArray(capabilities) ? capabilities.filter((capability) => typeof capability === 'string') : []);
}

function normalizeRequiredCapabilities(requiredCapabilities) {
  return Object.fromEntries(
    Object.entries(requiredCapabilities)
      .filter(([group]) => typeof group === 'string')
      .map(([group, capabilities]) => [group, normalizeCapabilities(capabilities)]),
  );
}

function compareProtocolVersions(left, right) {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function semverParts(version) {
  if (typeof version !== 'string' || !/^\d+(\.\d+){0,2}$/.test(version)) {
    return null;
  }
  return version.split('.').map((part) => Number(part));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function duplicates(values) {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return [...duplicated].sort();
}

function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

function freezeVersion(definition) {
  return deepFreeze({
    ...definition,
    capabilities: [...definition.capabilities],
    requiredCapabilities: Object.fromEntries(
      Object.entries(definition.requiredCapabilities).map(([group, capabilities]) => [group, [...capabilities]]),
    ),
  });
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
