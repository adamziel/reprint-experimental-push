import {
  canonicalizeScenarioName,
  modeAliasesByCanonicalMode,
  resolveProductionPluginPackageScenarios,
  scenarioGroups,
} from './production-plugin-package-scenarios.js';

const registrationGuardScenarioNames = [
  ...scenarioGroups['driver-registration-guards'],
];
const callbackGuardScenarioNames = [
  ...scenarioGroups['driver-callback-guards'],
];
const registrationShapeGuardScenarioNames = [
  ...scenarioGroups['driver-registration-shape-guards'],
];

const bundleSummaryGroups = {
  'driver-positive-proof': [
    ...scenarioGroups['driver-positive-proof'],
  ],
  'driver-proof': [
    'driver-receipt-guards',
    ...registrationGuardScenarioNames,
    'driver-delete-apply',
  ],
  'driver-release-proof': [
    'core-package-routes',
    'driver-receipt-guards',
    'driver-delete-apply',
  ],
  'driver-verifier-guards': [
    'driver-receipt-guards',
    ...registrationGuardScenarioNames,
  ],
  'driver-registration-guards': [
    ...registrationGuardScenarioNames,
  ],
  'driver-receipt-registration-guards': [
    'driver-receipt-guards',
    ...registrationGuardScenarioNames,
  ],
  'driver-callback-guards': [
    ...callbackGuardScenarioNames,
  ],
  'driver-registration-shape-guards': [
    ...registrationShapeGuardScenarioNames,
  ],
};

export { bundleSummaryGroups };

const guardProofScenarioMaps = Object.freeze({
  'driver-proof': Object.freeze({
    deleteGuard: 'driver-delete-guard',
    updateValidationGuard: 'driver-update-validation-guard',
    planBinding: 'driver-receipt-plan-binding-guard',
    expiry: 'driver-receipt-expiry-guard',
    identity: 'driver-receipt-identity-guard',
    rotatedCredential: 'driver-receipt-rotated-credential-guard',
    revokedCredential: 'driver-receipt-revoked-credential-guard',
    missingExport: 'driver-missing-export-guard',
    missingApply: 'driver-missing-apply-guard',
    missingValidate: 'driver-missing-validate-guard',
    missingName: 'driver-missing-name-guard',
    missingPluginOwner: 'driver-missing-plugin-owner-guard',
    missingTable: 'driver-missing-table-guard',
    duplicateName: 'driver-duplicate-name-guard',
    duplicateTable: 'driver-duplicate-table-guard',
  }),
  'driver-release-proof': Object.freeze({
    deleteGuard: 'driver-delete-guard',
    updateValidationGuard: 'driver-update-validation-guard',
    planBinding: 'driver-receipt-plan-binding-guard',
    expiry: 'driver-receipt-expiry-guard',
    identity: 'driver-receipt-identity-guard',
    rotatedCredential: 'driver-receipt-rotated-credential-guard',
    revokedCredential: 'driver-receipt-revoked-credential-guard',
  }),
  'driver-verifier-guards': Object.freeze({
    deleteGuard: 'driver-delete-guard',
    updateValidationGuard: 'driver-update-validation-guard',
    planBinding: 'driver-receipt-plan-binding-guard',
    expiry: 'driver-receipt-expiry-guard',
    identity: 'driver-receipt-identity-guard',
    rotatedCredential: 'driver-receipt-rotated-credential-guard',
    revokedCredential: 'driver-receipt-revoked-credential-guard',
    missingExport: 'driver-missing-export-guard',
    missingApply: 'driver-missing-apply-guard',
    missingValidate: 'driver-missing-validate-guard',
    missingName: 'driver-missing-name-guard',
    missingPluginOwner: 'driver-missing-plugin-owner-guard',
    missingTable: 'driver-missing-table-guard',
    duplicateName: 'driver-duplicate-name-guard',
    duplicateTable: 'driver-duplicate-table-guard',
  }),
  'driver-receipt-registration-guards': Object.freeze({
    deleteGuard: 'driver-delete-guard',
    updateValidationGuard: 'driver-update-validation-guard',
    planBinding: 'driver-receipt-plan-binding-guard',
    expiry: 'driver-receipt-expiry-guard',
    identity: 'driver-receipt-identity-guard',
    rotatedCredential: 'driver-receipt-rotated-credential-guard',
    revokedCredential: 'driver-receipt-revoked-credential-guard',
    missingExport: 'driver-missing-export-guard',
    missingApply: 'driver-missing-apply-guard',
    missingValidate: 'driver-missing-validate-guard',
    missingName: 'driver-missing-name-guard',
    missingPluginOwner: 'driver-missing-plugin-owner-guard',
    missingTable: 'driver-missing-table-guard',
    duplicateName: 'driver-duplicate-name-guard',
    duplicateTable: 'driver-duplicate-table-guard',
  }),
  'driver-receipt-guards': Object.freeze({
    deleteGuard: 'driver-delete-guard',
    updateValidationGuard: 'driver-update-validation-guard',
    planBinding: 'driver-receipt-plan-binding-guard',
    expiry: 'driver-receipt-expiry-guard',
    identity: 'driver-receipt-identity-guard',
    rotatedCredential: 'driver-receipt-rotated-credential-guard',
    revokedCredential: 'driver-receipt-revoked-credential-guard',
  }),
  'driver-registration-guards': Object.freeze({
    missingExport: 'driver-missing-export-guard',
    missingApply: 'driver-missing-apply-guard',
    missingValidate: 'driver-missing-validate-guard',
    missingName: 'driver-missing-name-guard',
    missingPluginOwner: 'driver-missing-plugin-owner-guard',
    missingTable: 'driver-missing-table-guard',
    duplicateName: 'driver-duplicate-name-guard',
    duplicateTable: 'driver-duplicate-table-guard',
  }),
  'driver-callback-guards': Object.freeze({
    missingExport: 'driver-missing-export-guard',
    missingApply: 'driver-missing-apply-guard',
    missingValidate: 'driver-missing-validate-guard',
  }),
  'driver-registration-shape-guards': Object.freeze({
    missingName: 'driver-missing-name-guard',
    missingPluginOwner: 'driver-missing-plugin-owner-guard',
    missingTable: 'driver-missing-table-guard',
    duplicateName: 'driver-duplicate-name-guard',
    duplicateTable: 'driver-duplicate-table-guard',
  }),
});

export const guardProofModeNames = Object.freeze(
  Object.keys(guardProofScenarioMaps).sort(),
);

export const guardProofModeAliases = Object.freeze(
  guardProofModeNames.reduce((aliases, canonicalMode) => {
    aliases[canonicalMode] = modeAliasesByCanonicalMode[canonicalMode] ?? Object.freeze([]);
    return aliases;
  }, {}),
);

function isBundleAliasScenario(name) {
  return Object.hasOwn(bundleSummaryGroups, name) || name === 'driver-receipt-guards';
}

function rowRetainedAfterReject(summary) {
  return summary?.rowRetainedAfterReject !== false;
}

function updatedMarkerRetainedAfterReject(summary) {
  return summary?.updatedMarkerAfterReject === undefined
    || summary?.updatedMarkerAfterReject === 'local-update';
}

function payloadModeRetainedAfterReject(summary) {
  return summary?.payloadModeAfterReject === undefined
    || summary?.payloadModeAfterReject === 'local-update';
}

function buildGuardRejectionProof(summary, codeField) {
  return {
    rejectedCode: summary?.[codeField] ?? null,
    rowRetainedAfterReject: summary?.rowRetainedAfterReject ?? null,
    payloadModeAfterReject: summary?.payloadModeAfterReject ?? null,
    updatedMarkerAfterReject: summary?.updatedMarkerAfterReject ?? null,
  };
}

function buildBooleanGuardProof(summary, fieldName) {
  return {
    observed: summary?.[fieldName] ?? false,
  };
}

function buildReceiptGuardProofMap(summary) {
  return {
    deleteGuard: buildGuardRejectionProof(summary?.driverDeleteGuard, 'dryRunRejectedCode'),
    updateValidationGuard: buildGuardRejectionProof(summary?.driverUpdateValidationGuard, 'dryRunRejectedCode'),
    planBinding: buildGuardRejectionProof(summary?.driverReceiptPlanBindingGuard, 'applyRejectedCode'),
    expiry: buildGuardRejectionProof(summary?.driverReceiptExpiryGuard, 'applyRejectedCode'),
    identity: buildGuardRejectionProof(summary?.driverReceiptIdentityGuard, 'applyRejectedCode'),
    rotatedCredential: buildGuardRejectionProof(summary?.driverReceiptRotatedCredentialGuard, 'rotatedCredentialRejectedCode'),
    revokedCredential: buildGuardRejectionProof(summary?.driverReceiptRevokedCredentialGuard, 'applyRejectedCode'),
  };
}

function buildRegistrationGuardProofMap(summary) {
  return {
    missingExport: buildBooleanGuardProof(summary?.driverExportGuard, 'missingExportRowsCallback'),
    missingApply: buildBooleanGuardProof(summary?.driverApplyGuard, 'missingApplyRowCallback'),
    missingValidate: buildBooleanGuardProof(summary?.driverValidateGuard, 'missingValidateMutationCallback'),
    missingName: buildBooleanGuardProof(summary?.driverMissingNameGuard, 'missingDriverName'),
    missingPluginOwner: buildBooleanGuardProof(summary?.driverPluginOwnerGuard, 'missingPluginOwner'),
    missingTable: buildBooleanGuardProof(summary?.driverMissingTableGuard, 'missingTable'),
    duplicateName: buildBooleanGuardProof(summary?.driverDuplicateNameGuard, 'duplicateDriverName'),
    duplicateTable: buildBooleanGuardProof(summary?.driverDuplicateTableGuard, 'duplicateTable'),
  };
}

function buildRegistrationCallbackGuardProofMap(summary) {
  const registrationGuardProof = buildRegistrationGuardProofMap(summary);
  return {
    missingExport: registrationGuardProof.missingExport,
    missingApply: registrationGuardProof.missingApply,
    missingValidate: registrationGuardProof.missingValidate,
  };
}

function buildRegistrationShapeGuardProofMap(summary) {
  const registrationGuardProof = buildRegistrationGuardProofMap(summary);
  return {
    missingName: registrationGuardProof.missingName,
    missingPluginOwner: registrationGuardProof.missingPluginOwner,
    missingTable: registrationGuardProof.missingTable,
    duplicateName: registrationGuardProof.duplicateName,
    duplicateTable: registrationGuardProof.duplicateTable,
  };
}

function buildModeGuardProof(canonicalMode, summary, scenarioPasses) {
  const guardScenarioMap = guardProofScenarioMaps[canonicalMode];
  if (!guardScenarioMap) {
    return null;
  }

  let guardProof;
  switch (canonicalMode) {
    case 'driver-proof':
    case 'driver-verifier-guards':
    case 'driver-receipt-registration-guards':
      guardProof = {
        ...buildReceiptGuardProofMap(summary),
        ...buildRegistrationGuardProofMap(summary),
      };
      break;
    case 'driver-release-proof':
    case 'driver-receipt-guards':
      guardProof = buildReceiptGuardProofMap(summary);
      break;
    case 'driver-registration-guards':
      guardProof = buildRegistrationGuardProofMap(summary);
      break;
    case 'driver-callback-guards':
      guardProof = buildRegistrationCallbackGuardProofMap(summary);
      break;
    case 'driver-registration-shape-guards':
      guardProof = buildRegistrationShapeGuardProofMap(summary);
      break;
    default:
      return null;
  }

  const guardStatuses = Object.fromEntries(
    Object.entries(guardScenarioMap).map(([proofKey, scenarioName]) => [
      proofKey,
      scenarioPasses.get(scenarioName) === true ? 'passed' : 'missing',
    ]),
  );

  for (const [proofKey, status] of Object.entries(guardStatuses)) {
    guardProof[proofKey].status = status;
  }

  const passedGuards = Object.entries(guardStatuses)
    .filter(([, status]) => status === 'passed')
    .map(([proofKey]) => proofKey);
  const failedGuards = Object.entries(guardStatuses)
    .filter(([, status]) => status !== 'passed')
    .map(([proofKey]) => proofKey);

  return {
    ok: failedGuards.length === 0,
    status: failedGuards.length === 0 ? 'passed' : 'missing',
    guardCount: Object.keys(guardScenarioMap).length,
    passedGuardCount: passedGuards.length,
    failedGuardCount: failedGuards.length,
    guardStatuses,
    passedGuards,
    failedGuards,
    ...guardProof,
  };
}

const scenarioDefinitions = [
  {
    key: 'corePackageRoutes',
    scenario: 'core-package-routes',
    evaluate(summary) {
      return summary?.routes?.namespace === 'reprint/v1'
        && summary?.routes?.labNamespaceDisabled === true
        && summary?.routes?.labBacked === false
        && summary?.cli?.ok === true
        && summary?.final?.finalMatchesLocal === true;
    },
  },
  {
    key: 'driverReceiptGuards',
    scenario: 'driver-receipt-guards',
    evaluate(summary) {
      return summary?.driverUpdateApply?.applied === 1
        && summary?.driverDeleteGuard?.dryRunRejectedCode !== undefined
        && rowRetainedAfterReject(summary?.driverDeleteGuard)
        && payloadModeRetainedAfterReject(summary?.driverDeleteGuard)
        && summary?.driverUpdateValidationGuard?.dryRunRejectedCode !== undefined
        && rowRetainedAfterReject(summary?.driverUpdateValidationGuard)
        && payloadModeRetainedAfterReject(summary?.driverUpdateValidationGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverUpdateValidationGuard)
        && summary?.driverReceiptPlanBindingGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptPlanBindingGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptPlanBindingGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptPlanBindingGuard)
        && summary?.driverReceiptExpiryGuard?.applyRejectedCode === 'AUTH_RECEIPT_EXPIRED'
        && rowRetainedAfterReject(summary?.driverReceiptExpiryGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptExpiryGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptExpiryGuard)
        && summary?.driverReceiptIdentityGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptIdentityGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptIdentityGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptIdentityGuard)
        && summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard)
        && summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode === 'reprint_push_lab_auth_required'
        && rowRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard);
    },
  },
  {
    key: 'driverDeleteGuard',
    scenario: 'driver-delete-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverDeleteGuard?.dryRunRejectedCode !== undefined
        && rowRetainedAfterReject(summary?.driverDeleteGuard)
        && payloadModeRetainedAfterReject(summary?.driverDeleteGuard);
    },
  },
  {
    key: 'driverUpdateValidationGuard',
    scenario: 'driver-update-validation-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverUpdateValidationGuard?.dryRunRejectedCode !== undefined
        && rowRetainedAfterReject(summary?.driverUpdateValidationGuard)
        && payloadModeRetainedAfterReject(summary?.driverUpdateValidationGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverUpdateValidationGuard);
    },
  },
  {
    key: 'driverReceiptPlanBindingGuard',
    scenario: 'driver-receipt-plan-binding-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverReceiptPlanBindingGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptPlanBindingGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptPlanBindingGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptPlanBindingGuard);
    },
  },
  {
    key: 'driverReceiptExpiryGuard',
    scenario: 'driver-receipt-expiry-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverReceiptExpiryGuard?.applyRejectedCode === 'AUTH_RECEIPT_EXPIRED'
        && rowRetainedAfterReject(summary?.driverReceiptExpiryGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptExpiryGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptExpiryGuard);
    },
  },
  {
    key: 'driverReceiptIdentityGuard',
    scenario: 'driver-receipt-identity-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverReceiptIdentityGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptIdentityGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptIdentityGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptIdentityGuard);
    },
  },
  {
    key: 'driverReceiptRotatedCredentialGuard',
    scenario: 'driver-receipt-rotated-credential-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && rowRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptRotatedCredentialGuard);
    },
  },
  {
    key: 'driverReceiptRevokedCredentialGuard',
    scenario: 'driver-receipt-revoked-credential-guard',
    counted: 'explicit-only',
    evaluate(summary) {
      return summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode === 'reprint_push_lab_auth_required'
        && rowRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard)
        && payloadModeRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard)
        && updatedMarkerRetainedAfterReject(summary?.driverReceiptRevokedCredentialGuard);
    },
  },
  {
    key: 'driverDeleteApply',
    scenario: 'driver-delete-apply',
    evaluate(summary) {
      return summary?.driverDeleteApply?.deletedAfterApply === true;
    },
  },
  {
    key: 'driverMissingExportGuard',
    scenario: 'driver-missing-export-guard',
    evaluate(summary) {
      return summary?.driverExportGuard?.missingExportRowsCallback === true;
    },
  },
  {
    key: 'driverMissingApplyGuard',
    scenario: 'driver-missing-apply-guard',
    evaluate(summary) {
      return summary?.driverApplyGuard?.missingApplyRowCallback === true;
    },
  },
  {
    key: 'driverMissingValidateGuard',
    scenario: 'driver-missing-validate-guard',
    evaluate(summary) {
      return summary?.driverValidateGuard?.missingValidateMutationCallback === true;
    },
  },
  {
    key: 'driverMissingNameGuard',
    scenario: 'driver-missing-name-guard',
    evaluate(summary) {
      return summary?.driverMissingNameGuard?.missingDriverName === true;
    },
  },
  {
    key: 'driverMissingPluginOwnerGuard',
    scenario: 'driver-missing-plugin-owner-guard',
    evaluate(summary) {
      return summary?.driverPluginOwnerGuard?.missingPluginOwner === true;
    },
  },
  {
    key: 'driverMissingTableGuard',
    scenario: 'driver-missing-table-guard',
    evaluate(summary) {
      return summary?.driverMissingTableGuard?.missingTable === true;
    },
  },
  {
    key: 'driverDuplicateNameGuard',
    scenario: 'driver-duplicate-name-guard',
    evaluate(summary) {
      return summary?.driverDuplicateNameGuard?.duplicateDriverName === true;
    },
  },
  {
    key: 'driverDuplicateTableGuard',
    scenario: 'driver-duplicate-table-guard',
    evaluate(summary) {
      return summary?.driverDuplicateTableGuard?.duplicateTable === true;
    },
  },
];

const scenarioDefinitionNames = scenarioDefinitions.map((definition) => definition.scenario);

export { scenarioDefinitionNames };

function isScenarioSelected(selectedScenarios, name) {
  if (selectedScenarios === null) {
    return true;
  }
  if (name === 'driver-receipt-guards') {
    return selectedScenarios.has(name)
      || scenarioGroups['driver-receipt-guards'].every((scenario) => selectedScenarios.has(scenario));
  }
  return selectedScenarios.has(name);
}

function summarizeScenario(selected, passed) {
  if (!selected) {
    return 'skipped';
  }
  return passed ? 'passed' : 'missing';
}

function toBundleKey(name) {
  return name.replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
}

function requestedScenarioAliases(normalizedRequestedScenarios, scenario) {
  if (normalizedRequestedScenarios === null) {
    return 'all';
  }
  return normalizedRequestedScenarios.filter(
    (requestedScenario) => requestedScenario === scenario
      || bundleSummaryGroups[requestedScenario]?.includes(scenario)
      || scenarioGroups[requestedScenario]?.includes(scenario),
  );
}

function hasFullConcreteReceiptGuardRequest(normalizedRequestedScenarios) {
  return normalizedRequestedScenarios !== null
    && scenarioGroups['driver-receipt-guards'].every(
      (scenario) => normalizedRequestedScenarios.includes(scenario),
    );
}

function hasFullConcreteBundleRequest(normalizedRequestedScenarios, bundleName) {
  return normalizedRequestedScenarios !== null
    && scenarioGroups[bundleName].every(
      (scenario) => normalizedRequestedScenarios.includes(scenario),
    );
}

function summarizeRequestedScenario(selected, passed) {
  return selected && passed ? 'passed' : 'missing';
}

function buildRequestedBundleStatusesForScenario(
  requestedScenarioAliases,
  requestedBundleStatuses,
) {
  if (requestedScenarioAliases === 'all') {
    return 'all';
  }
  if (!Array.isArray(requestedScenarioAliases) || requestedScenarioAliases.length === 0) {
    return null;
  }
  const bundleStatuses = Object.fromEntries(
    requestedScenarioAliases
      .filter(
        (requestedScenario) => Object.hasOwn(bundleSummaryGroups, requestedScenario)
          || requestedScenario === 'driver-receipt-guards',
      )
      .map((requestedScenario) => {
        const bundleKey = toBundleKey(requestedScenario);
        return [bundleKey, requestedBundleStatuses[bundleKey] ?? 'missing'];
      }),
  );
  return Object.keys(bundleStatuses).length > 0 ? bundleStatuses : null;
}

function collapseRequestedBundleStatus(requestedBundleStatusesForScenario) {
  if (
    requestedBundleStatusesForScenario === null
    || requestedBundleStatusesForScenario === 'all'
  ) {
    return requestedBundleStatusesForScenario;
  }
  const statuses = Object.values(requestedBundleStatusesForScenario);
  return statuses.length === 1 ? statuses[0] : null;
}

export const proofKeyByCanonicalMode = Object.freeze({
  'core-package-routes': 'driverRouteProof',
  'driver-receipt-guards': 'driverReceiptGuards',
  'driver-delete-apply': 'driverDeleteApplyProof',
  'driver-positive-proof': 'driverPositiveProof',
  'driver-proof': 'driverProof',
  'driver-release-proof': 'driverReleaseProof',
  'driver-verifier-guards': 'driverVerifierGuards',
  'driver-receipt-registration-guards': 'driverReceiptRegistrationGuards',
  'driver-registration-guards': 'driverRegistrationGuards',
  'driver-callback-guards': 'driverCallbackGuards',
  'driver-registration-shape-guards': 'driverRegistrationShapeGuards',
});

const legacyProofKeyByResolvedMode = Object.freeze({
  'driver-mutation-proof': 'driverMutationProof',
  'driver-mutation-proof-only': 'driverMutationProof',
  driverMutationProof: 'driverMutationProof',
  driverMutationProofOnly: 'driverMutationProof',
});

function legacyProofKeyForResolvedMode(modeValue, canonicalProofKey) {
  if (!modeValue) {
    return canonicalProofKey;
  }
  if (Object.hasOwn(legacyProofKeyByResolvedMode, modeValue)) {
    return legacyProofKeyByResolvedMode[modeValue];
  }
  return canonicalProofKey;
}

export function resolveProductionPluginPackageModeProofKey(modeValue) {
  if (!modeValue) {
    return null;
  }

  const resolved = resolveProductionPluginPackageScenarios([], undefined, modeValue);
  if (resolved.canonicalMode === null || resolved.resolvedMode === null) {
    return null;
  }

  return {
    mode: resolved.resolvedMode,
    canonicalMode: resolved.canonicalMode,
    proofKey: proofKeyByCanonicalMode[resolved.canonicalMode] ?? null,
    legacyProofKey: legacyProofKeyForResolvedMode(
      resolved.resolvedMode,
      proofKeyByCanonicalMode[resolved.canonicalMode] ?? null,
    ),
  };
}

function requestedListsMatch(left, right) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left === null || right === null) {
    return left === right;
  }
  return JSON.stringify(left.slice().sort()) === JSON.stringify(right.slice().sort());
}

function selectedScenariosMatch(left, right) {
  const normalizedLeft = normalizeSelectedScenarios(left);
  const normalizedRight = normalizeSelectedScenarios(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight;
  }
  if (normalizedLeft === undefined || normalizedRight === undefined) {
    return normalizedLeft === normalizedRight;
  }
  return JSON.stringify(Array.from(normalizedLeft).sort()) === JSON.stringify(Array.from(normalizedRight).sort());
}

function modeProofMatchesResolvedContext(summary, modeProof, resolvedOptions) {
  return requestedListsMatch(
    modeProof?.requestedScenarios,
    resolvedOptions.requestedScenarios,
  )
    && selectedScenariosMatch(
      summary?.selectedScenarios,
      resolvedOptions.selectedScenarios,
    )
    && (
      modeProof?.requestedBundles === undefined
      || requestedListsMatch(
        modeProof?.requestedBundles,
        filterRequestedListForMode(
          summary?.requestedBundles ?? [],
          new Set(
            resolvedOptions.canonicalMode === null
              ? []
              : isBundleAliasScenario(resolvedOptions.canonicalMode)
                ? [toBundleKey(resolvedOptions.canonicalMode)]
                : [],
          ),
        ),
      )
    );
}

export function resolveProductionPluginPackageModeProof(summary, modeValue, options = {}) {
  const resolved = resolveProductionPluginPackageModeProofKey(modeValue);
  if (resolved === null) {
    return null;
  }

  const proof = summary?.[resolved.proofKey] ?? null;
  const legacyProof = summary?.[resolved.legacyProofKey] ?? null;
  const baseModeProof = {
    ...resolved,
    proof,
    legacyProof,
  };

  const hasModeProofContext = (
    options?.requestedScenarios !== undefined
    || options?.selectedScenarios !== undefined
    || options?.resolvedMode !== undefined
    || options?.canonicalMode !== undefined
    || summary?.mode !== undefined
    || summary?.canonicalMode !== undefined
    || summary?.requestedScenarios !== undefined
    || summary?.selectedScenarios !== undefined
  );
  const resolvedModeProofOptions = hasModeProofContext
    ? resolveProductionPluginPackageProofSummaryOptions(summary, {
      ...options,
      resolvedMode: options?.resolvedMode ?? resolved.mode,
      canonicalMode: options?.canonicalMode ?? resolved.canonicalMode,
    })
    : null;

  const attachedModeProof = summary?.modeProof;
  if (
    attachedModeProof?.mode === resolved.mode
    && attachedModeProof?.canonicalMode === resolved.canonicalMode
    && attachedModeProof?.proofKey === resolved.proofKey
    && attachedModeProof?.legacyProofKey === resolved.legacyProofKey
    && (
      resolvedModeProofOptions === null
      || modeProofMatchesResolvedContext(summary, attachedModeProof, resolvedModeProofOptions)
    )
  ) {
    return {
      ...baseModeProof,
      ...attachedModeProof,
      proof: attachedModeProof?.proof ?? proof,
      legacyProof: attachedModeProof?.legacyProof ?? legacyProof,
    };
  }

  const attachedPluginDriverModeProof = summary?.pluginDriverProof?.modeProof;
  if (
    attachedPluginDriverModeProof?.mode === resolved.mode
    && attachedPluginDriverModeProof?.canonicalMode === resolved.canonicalMode
    && attachedPluginDriverModeProof?.proofKey === resolved.proofKey
    && attachedPluginDriverModeProof?.legacyProofKey === resolved.legacyProofKey
    && (
      resolvedModeProofOptions === null
      || modeProofMatchesResolvedContext(
        summary?.pluginDriverProof,
        attachedPluginDriverModeProof,
        resolvedModeProofOptions,
      )
    )
  ) {
    return {
      ...baseModeProof,
      ...attachedPluginDriverModeProof,
      proof: attachedPluginDriverModeProof?.proof ?? proof,
      legacyProof: attachedPluginDriverModeProof?.legacyProof ?? legacyProof,
    };
  }

  if (!hasModeProofContext) {
    return baseModeProof;
  }

  const modeProofOptions = resolvedModeProofOptions;
  const pluginDriverProof = summary?.pluginDriverProof === undefined
    ? resolveProductionPluginPackagePluginDriverProof(summary, modeProofOptions)
    : buildProductionPluginPackageProofSummary(summary, modeProofOptions);
  const inferredModeProof = pluginDriverProof?.modeProof;
  if (
    inferredModeProof?.canonicalMode === resolved.canonicalMode
    && inferredModeProof?.proofKey === resolved.proofKey
  ) {
    return {
      ...baseModeProof,
      ...inferredModeProof,
      proof: inferredModeProof?.proof ?? proof,
      legacyProof: inferredModeProof?.legacyProof ?? legacyProof,
    };
  }

  return baseModeProof;
}

export function resolveProductionPluginPackagePluginDriverProof(
  summary,
  options = {},
) {
  const attachedPluginDriverProof = summary?.pluginDriverProof;
  if (attachedPluginDriverProof !== undefined) {
    const resolvedOptions = resolveProductionPluginPackageProofSummaryOptions(summary, options);
    const requestedScenariosMatch = (
      resolvedOptions.requestedScenarios === undefined
      || requestedListsMatch(
        attachedPluginDriverProof?.requestedScenarios ?? [],
        resolvedOptions.requestedScenarios,
      )
    );
    const modeMatches = (
      resolvedOptions.resolvedMode === undefined
      || attachedPluginDriverProof?.mode === resolvedOptions.resolvedMode
    );
    const canonicalModeMatches = (
      resolvedOptions.canonicalMode === undefined
      || attachedPluginDriverProof?.canonicalMode === resolvedOptions.canonicalMode
    );
    const selectedScenariosMatch = (() => {
      if (resolvedOptions.selectedScenarios === undefined) {
        return true;
      }

      const attachedSelectedScenarios = normalizeSelectedScenarios(
        attachedPluginDriverProof?.selectedScenarios,
      );
      const resolvedSelectedScenarios = normalizeSelectedScenarios(
        resolvedOptions.selectedScenarios,
      );

      if (attachedSelectedScenarios === null || resolvedSelectedScenarios === null) {
        return attachedSelectedScenarios === resolvedSelectedScenarios;
      }
      if (attachedSelectedScenarios === undefined || resolvedSelectedScenarios === undefined) {
        return attachedSelectedScenarios === resolvedSelectedScenarios;
      }

      const attachedSelectedScenarioNames = Array.from(attachedSelectedScenarios).sort();
      const resolvedSelectedScenarioNames = Array.from(resolvedSelectedScenarios).sort();
      return JSON.stringify(attachedSelectedScenarioNames) === JSON.stringify(resolvedSelectedScenarioNames);
    })();
    const expectedModeProof = resolvedOptions.resolvedMode === undefined || resolvedOptions.resolvedMode === null
      ? null
      : resolveProductionPluginPackageModeProofKey(resolvedOptions.resolvedMode);
    const resolvedModeProofOptions = expectedModeProof === null
      ? null
      : (() => {
        const allowedRequestedScenarioNames = new Set([
          expectedModeProof.canonicalMode,
          ...(modeAliasesByCanonicalMode[expectedModeProof.canonicalMode] ?? []),
          ...(scenarioGroups[expectedModeProof.canonicalMode] ?? []),
        ]);
        return {
        ...resolvedOptions,
        canonicalMode: expectedModeProof.canonicalMode,
        requestedScenarios: resolvedOptions.requestedScenarios === undefined
          || resolvedOptions.requestedScenarios === null
          ? resolvedOptions.requestedScenarios
          : resolvedOptions.requestedScenarios.filter(
            (scenarioName) => allowedRequestedScenarioNames.has(scenarioName),
          ),
      };
      })();
    const nestedModeProofMatches = expectedModeProof === null
      || (
        attachedPluginDriverProof?.modeProof?.mode === expectedModeProof.mode
        && attachedPluginDriverProof?.modeProof?.canonicalMode === expectedModeProof.canonicalMode
        && attachedPluginDriverProof?.modeProof?.proofKey === expectedModeProof.proofKey
        && attachedPluginDriverProof?.modeProof?.legacyProofKey === expectedModeProof.legacyProofKey
        && modeProofMatchesResolvedContext(
          attachedPluginDriverProof,
          attachedPluginDriverProof?.modeProof,
          resolvedModeProofOptions,
        )
      );

    if (
      requestedScenariosMatch
      && modeMatches
      && canonicalModeMatches
      && selectedScenariosMatch
      && nestedModeProofMatches
    ) {
      return attachedPluginDriverProof;
    }
  }
  const pluginDriverProof = buildProductionPluginPackageProofSummary(
    summary,
    resolveProductionPluginPackageProofSummaryOptions(summary, options),
  );
  if (summary && typeof summary === 'object') {
    summary.pluginDriverProof = pluginDriverProof;
  }
  return pluginDriverProof;
}

function normalizeSelectedScenarios(selectedScenarios) {
  if (selectedScenarios === undefined) {
    return undefined;
  }
  if (selectedScenarios === null || selectedScenarios === 'all') {
    return null;
  }
  if (selectedScenarios instanceof Set) {
    return selectedScenarios;
  }
  if (Array.isArray(selectedScenarios)) {
    return new Set(selectedScenarios);
  }
  return undefined;
}

function normalizeRequestedScenarios(requestedScenarios) {
  if (requestedScenarios === undefined) {
    return undefined;
  }
  if (requestedScenarios === null || requestedScenarios === 'all') {
    return null;
  }
  if (Array.isArray(requestedScenarios)) {
    return requestedScenarios.slice();
  }
  return undefined;
}

export function resolveProductionPluginPackageProofSummaryOptions(
  summary,
  {
    requestedScenarios,
    selectedScenarios,
    resolvedMode,
    canonicalMode,
  } = {},
) {
  return {
    requestedScenarios: normalizeRequestedScenarios(requestedScenarios)
      ?? normalizeRequestedScenarios(summary?.requestedScenarios)
      ?? null,
    selectedScenarios: normalizeSelectedScenarios(selectedScenarios)
      ?? normalizeSelectedScenarios(summary?.selectedScenarios)
      ?? null,
    resolvedMode: resolvedMode ?? summary?.mode ?? null,
    canonicalMode: canonicalMode ?? summary?.canonicalMode ?? null,
  };
}

function buildBundleScenarioDetails(bundleName, scenarioPasses, includeCoverageDetails = true) {
  const requiredScenarios = bundleSummaryGroups[bundleName].slice().sort();
  if (!includeCoverageDetails) {
    return {
      requiredScenarioCount: requiredScenarios.length,
      passedScenarioCount: 0,
      failedScenarioCount: 0,
      requiredScenarios,
      passedScenarios: [],
      failedScenarios: [],
    };
  }
  const passedScenarios = requiredScenarios.filter((scenario) => scenarioPasses.get(scenario) === true);
  const failedScenarios = requiredScenarios.filter((scenario) => scenarioPasses.get(scenario) !== true);
  return {
    requiredScenarioCount: requiredScenarios.length,
    passedScenarioCount: passedScenarios.length,
    failedScenarioCount: failedScenarios.length,
    requiredScenarios,
    passedScenarios,
    failedScenarios,
  };
}

function isBundleSelected(selectedScenarios, bundleName) {
  return selectedScenarios === null
    || bundleSummaryGroups[bundleName].every((scenario) => isScenarioSelected(selectedScenarios, scenario));
}

function filterRequestedListForMode(requestedValues, allowedValues) {
  if (requestedValues === 'all') {
    return 'all';
  }
  return requestedValues.filter((value) => allowedValues.has(value));
}

function filterRequestedStatusMapForMode(statusMap, allowedValues) {
  if (statusMap === 'all') {
    return 'all';
  }
  return Object.fromEntries(
    Object.entries(statusMap)
      .filter(([key]) => allowedValues.has(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function aliasRequestedBundleStatusMap(canonicalStatusMap, canonicalKey, legacyKey) {
  if (canonicalStatusMap === null || canonicalStatusMap === 'all') {
    return canonicalStatusMap;
  }
  if (!canonicalKey || !legacyKey || canonicalKey === legacyKey) {
    return canonicalStatusMap;
  }

  const canonicalStatus = canonicalStatusMap[canonicalKey];
  if (canonicalStatus === undefined) {
    return canonicalStatusMap;
  }

  return {
    [legacyKey]: canonicalStatus,
  };
}

function requestedStatusesSatisfied(statusMap) {
  if (statusMap === null || statusMap === 'all') {
    return true;
  }
  const statuses = Object.values(statusMap);
  return statuses.length === 0 || statuses.every((status) => status === 'passed');
}

export function buildProductionPluginPackageProofSummary(
  summary,
  {
    requestedScenarios = null,
    selectedScenarios = null,
    resolvedMode = null,
    canonicalMode = null,
  } = {},
) {
  const normalizedRequestedScenarios = requestedScenarios === null
    ? null
    : Array.from(new Set(requestedScenarios));
  const canonicalRequestedScenarios = normalizedRequestedScenarios === null
    ? null
    : Array.from(new Set(normalizedRequestedScenarios.map(canonicalizeScenarioName)));
  const requestedBundleAliases = canonicalRequestedScenarios === null
    ? 'all'
    : canonicalRequestedScenarios.filter((scenario) => isBundleAliasScenario(scenario));
  const requestedBundles = canonicalRequestedScenarios === null
    ? 'all'
    : Array.from(new Set(requestedBundleAliases.map((bundleName) => toBundleKey(bundleName))));
  const requestedConcreteScenarios = canonicalRequestedScenarios === null
    ? 'all'
    : canonicalRequestedScenarios.filter((scenario) => !isBundleAliasScenario(scenario));
  const requestedConcreteScenarioSet = requestedConcreteScenarios === 'all'
    ? null
    : new Set(requestedConcreteScenarios);
  const requestedBundleSet = requestedBundles === 'all'
    ? null
    : new Set(requestedBundles);
  const hasRequestedBundles = requestedBundles === 'all'
    || requestedBundles.length > 0;
  const scenarioResults = {};
  const bundleResults = {};
  const checkedBundles = [];
  const passedBundles = [];
  const failedBundles = [];
  const checkedScenarios = [];
  const passedScenarios = [];
  const failedScenarios = [];
  const passedRequestedBundles = [];
  const failedRequestedBundles = [];
  const passedRequestedConcreteScenarios = [];
  const failedRequestedConcreteScenarios = [];
  const passedRequestedScenarios = [];
  const failedRequestedScenarios = [];
  const requestedBundleStatuses = {};
  const requestedConcreteScenarioStatuses = {};
  const requestedScenarioStatuses = {};
  let requestedBundleCount = 0;
  let passedRequestedBundleCount = 0;
  let failedRequestedBundleCount = 0;
  let checkedBundleCount = 0;
  let passedBundleCount = 0;
  let failedBundleCount = 0;
  let skippedBundleCount = 0;
  const scenarioPasses = new Map();
  const requestedScenarioAliasMap = new Map();
  let checkedScenarioCount = 0;
  let passedScenarioCount = 0;
  let failedScenarioCount = 0;
  let skippedScenarioCount = 0;

  for (const definition of scenarioDefinitions) {
    requestedScenarioAliasMap.set(
      definition.scenario,
      requestedScenarioAliases(canonicalRequestedScenarios, definition.scenario),
    );
    const selected = isScenarioSelected(selectedScenarios, definition.scenario);
    const countScenario = definition.counted !== 'explicit-only'
      || requestedConcreteScenarioSet?.has(definition.scenario) === true;
    const passed = definition.evaluate(summary);
    scenarioPasses.set(definition.scenario, passed);
    const status = summarizeScenario(selected, passed);
    if (countScenario) {
      scenarioResults[definition.key] = status;
    }
    if (selected && countScenario) {
      checkedScenarioCount += 1;
      checkedScenarios.push(definition.scenario);
      if (passed) {
        passedScenarioCount += 1;
        passedScenarios.push(definition.scenario);
        if (requestedConcreteScenarioSet?.has(definition.scenario)) {
          passedRequestedConcreteScenarios.push(definition.scenario);
          requestedConcreteScenarioStatuses[definition.scenario] = 'passed';
        }
      } else {
        failedScenarioCount += 1;
        failedScenarios.push(definition.scenario);
        if (requestedConcreteScenarioSet?.has(definition.scenario)) {
          failedRequestedConcreteScenarios.push(definition.scenario);
          requestedConcreteScenarioStatuses[definition.scenario] = 'missing';
        }
      }
    } else if (countScenario) {
      skippedScenarioCount += 1;
    }
  }

  for (const [bundleName, bundleScenarios] of Object.entries(bundleSummaryGroups)) {
    const selected = canonicalRequestedScenarios === null
      ? selectedScenarios === null || bundleScenarios.some((scenario) => isScenarioSelected(selectedScenarios, scenario))
      : canonicalRequestedScenarios.includes(bundleName);
    const bundleCoverageSatisfied = selectedScenarios === null
      || bundleScenarios.every((scenario) => isScenarioSelected(selectedScenarios, scenario));
    const passed = bundleCoverageSatisfied
      && bundleScenarios.every((scenario) => scenarioPasses.get(scenario) === true);
    const bundleKey = toBundleKey(bundleName);
    bundleResults[bundleKey] = summarizeScenario(selected, passed);
    if (selected) {
      checkedBundleCount += 1;
      checkedBundles.push(bundleKey);
      if (passed) {
        passedBundleCount += 1;
      }
    } else {
      skippedBundleCount += 1;
    }
    if (selected && passed) {
      passedBundles.push(bundleKey);
      if (requestedBundleSet?.has(bundleKey)) {
        requestedBundleCount += 1;
        passedRequestedBundleCount += 1;
        passedRequestedBundles.push(bundleKey);
        passedRequestedScenarios.push(bundleName);
        requestedBundleStatuses[bundleKey] = 'passed';
        requestedScenarioStatuses[bundleName] = 'passed';
      }
    } else if (selected) {
      failedBundles.push(bundleKey);
      failedBundleCount += 1;
      if (requestedBundleSet?.has(bundleKey)) {
        requestedBundleCount += 1;
        failedRequestedBundleCount += 1;
        failedRequestedBundles.push(bundleKey);
        failedRequestedScenarios.push(bundleName);
        requestedBundleStatuses[bundleKey] = 'missing';
        requestedScenarioStatuses[bundleName] = 'missing';
      }
    }
  }

  const directReceiptBundleSelected = requestedBundleSet?.has('driverReceiptGuards') === true
    && isScenarioSelected(selectedScenarios, 'driver-receipt-guards');
  if (directReceiptBundleSelected) {
    const passed = scenarioPasses.get('driver-receipt-guards') === true;
    bundleResults.driverReceiptGuards = summarizeScenario(true, passed);
    checkedBundleCount += 1;
    checkedBundles.push('driverReceiptGuards');
    if (passed) {
      passedBundleCount += 1;
      passedBundles.push('driverReceiptGuards');
    } else {
      failedBundleCount += 1;
      failedBundles.push('driverReceiptGuards');
    }
  }

  if (requestedBundleSet?.has('driverReceiptGuards')) {
    requestedBundleCount += 1;
    const selected = isScenarioSelected(selectedScenarios, 'driver-receipt-guards');
    const passed = selected && scenarioPasses.get('driver-receipt-guards') === true;
    requestedBundleStatuses.driverReceiptGuards = passed ? 'passed' : 'missing';
    requestedScenarioStatuses['driver-receipt-guards'] = passed ? 'passed' : 'missing';
    if (passed) {
      passedRequestedBundleCount += 1;
      passedRequestedBundles.push('driverReceiptGuards');
      passedRequestedScenarios.push('driver-receipt-guards');
    } else {
      failedRequestedBundleCount += 1;
      failedRequestedBundles.push('driverReceiptGuards');
      failedRequestedScenarios.push('driver-receipt-guards');
    }
  }

  if (requestedConcreteScenarios !== 'all') {
    for (const scenario of requestedConcreteScenarios) {
      if (!requestedConcreteScenarioStatuses[scenario]) {
        failedRequestedConcreteScenarios.push(scenario);
        requestedConcreteScenarioStatuses[scenario] = 'missing';
      }
    }
    for (const scenario of passedRequestedConcreteScenarios) {
      requestedScenarioStatuses[scenario] = 'passed';
    }
    for (const scenario of failedRequestedConcreteScenarios) {
      requestedScenarioStatuses[scenario] = 'missing';
    }
    passedRequestedScenarios.push(...passedRequestedConcreteScenarios);
    failedRequestedScenarios.push(...failedRequestedConcreteScenarios);
  }

  const receiptRequestedAliases = requestedScenarioAliasMap.get('driver-receipt-guards');
  const hasConcreteReceiptGuardRequest = hasFullConcreteReceiptGuardRequest(normalizedRequestedScenarios);
  const receiptRequested = receiptRequestedAliases === 'all'
    || receiptRequestedAliases.length > 0
    || hasConcreteReceiptGuardRequest;
  const receiptRequestedStatus = receiptRequested
    ? summarizeRequestedScenario(
      isScenarioSelected(selectedScenarios, 'driver-receipt-guards'),
      scenarioPasses.get('driver-receipt-guards') === true,
    )
    : null;
  const receiptRequestedBundleStatuses = receiptRequestedAliases === 'all'
    ? 'all'
    : receiptRequestedAliases.length > 0
      ? buildRequestedBundleStatusesForScenario(
        receiptRequestedAliases,
        requestedBundleStatuses,
      )
      : hasConcreteReceiptGuardRequest
        ? {
          driverReceiptGuards: receiptRequestedStatus,
        }
        : null;
  const receiptRequestedBundleStatus = requestedBundleStatuses.driverReceiptGuards
    ?? (hasConcreteReceiptGuardRequest ? receiptRequestedStatus : null);
  const concreteBundleRequests = Object.fromEntries(
    Object.keys(bundleSummaryGroups).map((bundleName) => [
      bundleName,
      hasFullConcreteBundleRequest(canonicalRequestedScenarios, bundleName),
    ]),
  );
  function buildConcreteRequestedBundleStatus(bundleName) {
    const bundleKey = toBundleKey(bundleName);
    if (requestedBundleStatuses[bundleKey] !== undefined) {
      return requestedBundleStatuses[bundleKey];
    }
    if (!concreteBundleRequests[bundleName]) {
      return null;
    }
    const concreteBundlePassed = bundleSummaryGroups[bundleName].every(
      (scenario) => scenarioPasses.get(scenario) === true,
    );
    return summarizeRequestedScenario(
      isBundleSelected(selectedScenarios, bundleName),
      concreteBundlePassed,
    );
  }
  function buildConcreteRequestedBundleStatuses(bundleName) {
    const aliasStatuses = buildRequestedBundleStatusesForScenario(
      requestedScenarioAliases(canonicalRequestedScenarios, bundleName),
      requestedBundleStatuses,
    );
    if (aliasStatuses !== null) {
      return aliasStatuses;
    }
    const requestedBundleStatus = buildConcreteRequestedBundleStatus(bundleName);
    if (requestedBundleStatus === null) {
      return null;
    }
    return {
      [toBundleKey(bundleName)]: requestedBundleStatus,
    };
  }
  function buildObjectBundleSelected(bundleName) {
    if (canonicalRequestedScenarios === null) {
      return isBundleSelected(selectedScenarios, bundleName);
    }
    if (
      canonicalRequestedScenarios.includes(bundleName)
      || concreteBundleRequests[bundleName]
    ) {
      return isBundleSelected(selectedScenarios, bundleName);
    }
    return false;
  }
  function buildObjectBundleStatus(bundleName) {
    const bundleKey = toBundleKey(bundleName);
    if (bundleResults[bundleKey] !== 'skipped') {
      return bundleResults[bundleKey];
    }
    if (!concreteBundleRequests[bundleName]) {
      return bundleResults[bundleKey];
    }
    const passed = bundleSummaryGroups[bundleName].every(
      (scenario) => scenarioPasses.get(scenario) === true,
    );
    return summarizeScenario(
      isBundleSelected(selectedScenarios, bundleName),
      passed,
    );
  }
  function buildNestedBundleStatus(bundleName) {
    const passed = bundleSummaryGroups[bundleName].every(
      (scenario) => scenarioPasses.get(scenario) === true,
    );
    return summarizeScenario(
      isBundleSelected(selectedScenarios, bundleName),
      passed,
    );
  }

  const positiveProof = {
    requested: normalizedRequestedScenarios === null
      ? true
      : canonicalRequestedScenarios.includes('driver-positive-proof')
        || concreteBundleRequests['driver-positive-proof'],
    selected: buildObjectBundleSelected('driver-positive-proof'),
    ok: buildObjectBundleStatus('driver-positive-proof') === 'passed',
    status: buildObjectBundleStatus('driver-positive-proof'),
    routeStatus: scenarioResults.corePackageRoutes,
    deleteStatus: scenarioResults.driverDeleteApply,
    namespace: summary?.routes?.namespace ?? null,
    profile: summary?.routes?.profile ?? null,
    labBacked: summary?.routes?.labBacked ?? null,
    labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
    authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
    resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
    remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
    deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
    finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
    ...buildBundleScenarioDetails(
      'driver-positive-proof',
      scenarioPasses,
      buildObjectBundleStatus('driver-positive-proof') !== 'skipped',
    ),
    requestedStatus: requestedScenarioStatuses['driver-positive-proof']
      ?? buildConcreteRequestedBundleStatus('driver-positive-proof'),
    requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-positive-proof'),
    requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-positive-proof'),
  };

  const releaseProof = {
    requested: normalizedRequestedScenarios === null
      ? true
      : canonicalRequestedScenarios.includes('driver-release-proof')
        || concreteBundleRequests['driver-release-proof'],
    selected: buildObjectBundleSelected('driver-release-proof'),
    ok: buildObjectBundleStatus('driver-release-proof') === 'passed',
    status: buildObjectBundleStatus('driver-release-proof'),
    routeStatus: scenarioResults.corePackageRoutes,
    receiptStatus: scenarioResults.driverReceiptGuards,
    deleteStatus: scenarioResults.driverDeleteApply,
    namespace: summary?.routes?.namespace ?? null,
    profile: summary?.routes?.profile ?? null,
    labBacked: summary?.routes?.labBacked ?? null,
    labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
    authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
    planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
    identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
    expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
    rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
    revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
    resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
    remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
    deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
    finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
    ...buildBundleScenarioDetails(
      'driver-release-proof',
      scenarioPasses,
      buildObjectBundleStatus('driver-release-proof') !== 'skipped',
    ),
    requestedStatus: requestedScenarioStatuses['driver-release-proof']
      ?? buildConcreteRequestedBundleStatus('driver-release-proof'),
    requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-release-proof'),
    requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-release-proof'),
  };

  const routeRequestedBundleStatuses = buildRequestedBundleStatusesForScenario(
    requestedScenarioAliasMap.get('core-package-routes'),
    requestedBundleStatuses,
  );
  const deleteRequestedBundleStatuses = buildRequestedBundleStatusesForScenario(
    requestedScenarioAliasMap.get('driver-delete-apply'),
    requestedBundleStatuses,
  );

  const proofSummary = {
    kind: 'production-plugin-package-driver-proof',
    mode: resolvedMode,
    canonicalMode,
    ok: checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount,
    checkedScenarioCount,
    passedScenarioCount,
    failedScenarioCount,
    skippedScenarioCount,
    checkedBundleCount,
    passedBundleCount,
    failedBundleCount,
    skippedBundleCount,
    requestedScenarioCount: normalizedRequestedScenarios === null
      ? 'all'
      : canonicalRequestedScenarios.length,
    passedRequestedScenarioCount: normalizedRequestedScenarios === null
      ? 'all'
      : passedRequestedScenarios.length,
    failedRequestedScenarioCount: normalizedRequestedScenarios === null
      ? 'all'
      : failedRequestedScenarios.length,
    requestedBundleCount: requestedBundles === 'all'
      ? 'all'
      : requestedBundleCount,
    passedRequestedBundleCount: requestedBundles === 'all'
      ? 'all'
      : passedRequestedBundleCount,
    failedRequestedBundleCount: requestedBundles === 'all'
      ? 'all'
      : failedRequestedBundleCount,
    requestedConcreteScenarioCount: requestedConcreteScenarios === 'all'
      ? 'all'
      : requestedConcreteScenarios.length,
    passedRequestedConcreteScenarioCount: requestedConcreteScenarios === 'all'
      ? 'all'
      : passedRequestedConcreteScenarios.length,
    failedRequestedConcreteScenarioCount: requestedConcreteScenarios === 'all'
      ? 'all'
      : failedRequestedConcreteScenarios.length,
    requestedScenarios: normalizedRequestedScenarios === null ? 'all' : normalizedRequestedScenarios.slice(),
    requestedBundles,
    requestedConcreteScenarios,
    passedRequestedScenarios: normalizedRequestedScenarios === null
      ? 'all'
      : passedRequestedScenarios.sort(),
    failedRequestedScenarios: normalizedRequestedScenarios === null
      ? 'all'
      : failedRequestedScenarios.sort(),
    passedRequestedBundles: requestedBundles === 'all'
      ? 'all'
      : passedRequestedBundles.sort(),
    failedRequestedBundles: requestedBundles === 'all'
      ? 'all'
      : failedRequestedBundles.sort(),
    passedRequestedConcreteScenarios: requestedConcreteScenarios === 'all'
      ? 'all'
      : passedRequestedConcreteScenarios.sort(),
    failedRequestedConcreteScenarios: requestedConcreteScenarios === 'all'
      ? 'all'
      : failedRequestedConcreteScenarios.sort(),
    requestedScenarioStatuses: normalizedRequestedScenarios === null
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedScenarioStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    requestedBundleStatuses: requestedBundles === 'all'
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedBundleStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    requestedConcreteScenarioStatuses: requestedConcreteScenarios === 'all'
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedConcreteScenarioStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    checkedScenarios: normalizedRequestedScenarios === null && selectedScenarios === null ? 'all' : checkedScenarios.sort(),
    passedScenarios: passedScenarios.sort(),
    failedScenarios: failedScenarios.sort(),
    checkedBundles: normalizedRequestedScenarios === null && selectedScenarios === null ? 'all' : checkedBundles.sort(),
    passedBundles: passedBundles.sort(),
    failedBundles: failedBundles.sort(),
    requestedScenariosSatisfied: normalizedRequestedScenarios === null
      ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
      : (
        (hasRequestedBundles
          ? (
            requestedBundles === 'all'
              ? checkedBundleCount > 0 && checkedBundleCount === passedBundleCount
              : requestedBundleCount > 0 && failedRequestedBundleCount === 0
          )
          : true)
        && (
          requestedConcreteScenarios === 'all'
            ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
            : failedRequestedConcreteScenarios.length === 0
        )
      ),
    requestedBundlesSatisfied: hasRequestedBundles
      ? (
        requestedBundles === 'all'
          ? checkedBundleCount > 0 && checkedBundleCount === passedBundleCount
          : requestedBundleCount > 0 && failedRequestedBundleCount === 0
      )
      : true,
    requestedConcreteScenariosSatisfied: requestedConcreteScenarios === 'all'
      ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
      : failedRequestedConcreteScenarios.length === 0,
    selectedScenarios: selectedScenarios === null ? 'all' : Array.from(selectedScenarios).sort(),
    package: {
      plugin: summary?.package?.plugin ?? null,
      mountedAs: summary?.package?.mountedAs ?? null,
    },
    driverResource: {
      resourceKey: summary?.driverUpdateApply?.resourceKey
        ?? summary?.driverDeleteApply?.resourceKey
        ?? summary?.driverDeleteGuard?.resourceKey
        ?? null,
      remoteSupportsDelete: summary?.driverUpdateApply?.remoteSupportsDelete ?? null,
      deleteSupportedByDriver: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
    },
    routes: {
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
    },
    routeProof: {
      requested: requestedScenarioAliasMap.get('core-package-routes') === 'all'
        || requestedScenarioAliasMap.get('core-package-routes').length > 0,
      selected: selectedScenarios === null
        || selectedScenarios.has('core-package-routes'),
      ok: scenarioResults.corePackageRoutes === 'passed',
      status: scenarioResults.corePackageRoutes,
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
      cliOk: summary?.cli?.ok ?? null,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
      requestedStatus: requestedScenarioAliasMap.get('core-package-routes') === 'all'
        || requestedScenarioAliasMap.get('core-package-routes').length > 0
        ? summarizeRequestedScenario(
          selectedScenarios === null || selectedScenarios.has('core-package-routes'),
          scenarioPasses.get('core-package-routes') === true,
        )
        : null,
      requestedBundleStatus: collapseRequestedBundleStatus(routeRequestedBundleStatuses),
      requestedBundleStatuses: routeRequestedBundleStatuses,
    },
    receiptGuards: {
      requested: receiptRequested,
      selected: isScenarioSelected(selectedScenarios, 'driver-receipt-guards'),
      ok: scenarioResults.driverReceiptGuards === 'passed',
      status: scenarioResults.driverReceiptGuards,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      requestedStatus: receiptRequestedStatus,
      requestedBundleStatus: receiptRequestedBundleStatus,
      requestedBundleStatuses: receiptRequestedBundleStatuses,
    },
    deleteApplyProof: {
      requested: requestedScenarioAliasMap.get('driver-delete-apply') === 'all'
        || requestedScenarioAliasMap.get('driver-delete-apply').length > 0,
      selected: selectedScenarios === null
        || selectedScenarios.has('driver-delete-apply'),
      ok: scenarioResults.driverDeleteApply === 'passed',
      status: scenarioResults.driverDeleteApply,
      resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
      remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
      deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      requestedStatus: requestedScenarioAliasMap.get('driver-delete-apply') === 'all'
        || requestedScenarioAliasMap.get('driver-delete-apply').length > 0
        ? summarizeRequestedScenario(
          selectedScenarios === null || selectedScenarios.has('driver-delete-apply'),
          scenarioPasses.get('driver-delete-apply') === true,
        )
        : null,
      requestedBundleStatus: collapseRequestedBundleStatus(deleteRequestedBundleStatuses),
      requestedBundleStatuses: deleteRequestedBundleStatuses,
    },
    mutationProof: {
      updateApplied: summary?.driverUpdateApply?.applied ?? 0,
      deleteRejected: summary?.driverDeleteGuard?.forgedPlanAcceptedByDryRun === false,
      deleteApplied: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? false,
    },
    positiveProof,
    driverPositiveProof: positiveProof,
    driverProof: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-proof')
          || concreteBundleRequests['driver-proof'],
      selected: buildObjectBundleSelected('driver-proof'),
      ok: buildObjectBundleStatus('driver-proof') === 'passed',
      status: buildObjectBundleStatus('driver-proof'),
      verifierStatus: buildNestedBundleStatus('driver-verifier-guards'),
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      deleteStatus: scenarioResults.driverDeleteApply,
      resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
      remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
      deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      ...buildBundleScenarioDetails(
        'driver-proof',
        scenarioPasses,
        buildObjectBundleStatus('driver-proof') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-proof']
        ?? buildConcreteRequestedBundleStatus('driver-proof'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-proof'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-proof'),
    },
    releaseProof,
    driverReleaseProof: releaseProof,
    verifierGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-verifier-guards')
          || concreteBundleRequests['driver-verifier-guards'],
      selected: buildObjectBundleSelected('driver-verifier-guards'),
      ok: buildObjectBundleStatus('driver-verifier-guards') === 'passed',
      status: buildObjectBundleStatus('driver-verifier-guards'),
      receiptStatus: scenarioResults.driverReceiptGuards,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails(
        'driver-verifier-guards',
        scenarioPasses,
        buildObjectBundleStatus('driver-verifier-guards') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-verifier-guards']
        ?? buildConcreteRequestedBundleStatus('driver-verifier-guards'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-verifier-guards'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-verifier-guards'),
    },
    receiptRegistrationGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-receipt-registration-guards')
          || concreteBundleRequests['driver-receipt-registration-guards'],
      selected: buildObjectBundleSelected('driver-receipt-registration-guards'),
      ok: buildObjectBundleStatus('driver-receipt-registration-guards') === 'passed',
      status: buildObjectBundleStatus('driver-receipt-registration-guards'),
      receiptStatus: scenarioResults.driverReceiptGuards,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails(
        'driver-receipt-registration-guards',
        scenarioPasses,
        buildObjectBundleStatus('driver-receipt-registration-guards') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-receipt-registration-guards']
        ?? buildConcreteRequestedBundleStatus('driver-receipt-registration-guards'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-receipt-registration-guards'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-receipt-registration-guards'),
    },
    registrationGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-registration-guards')
          || concreteBundleRequests['driver-registration-guards'],
      selected: buildObjectBundleSelected('driver-registration-guards'),
      ok: buildObjectBundleStatus('driver-registration-guards') === 'passed',
      status: buildObjectBundleStatus('driver-registration-guards'),
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails(
        'driver-registration-guards',
        scenarioPasses,
        buildObjectBundleStatus('driver-registration-guards') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-registration-guards']
        ?? buildConcreteRequestedBundleStatus('driver-registration-guards'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-registration-guards'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-registration-guards'),
    },
    callbackGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-callback-guards')
          || concreteBundleRequests['driver-callback-guards'],
      selected: buildObjectBundleSelected('driver-callback-guards'),
      ok: buildObjectBundleStatus('driver-callback-guards') === 'passed',
      status: buildObjectBundleStatus('driver-callback-guards'),
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      ...buildBundleScenarioDetails(
        'driver-callback-guards',
        scenarioPasses,
        buildObjectBundleStatus('driver-callback-guards') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-callback-guards']
        ?? buildConcreteRequestedBundleStatus('driver-callback-guards'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-callback-guards'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-callback-guards'),
    },
    registrationShapeGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : canonicalRequestedScenarios.includes('driver-registration-shape-guards')
          || concreteBundleRequests['driver-registration-shape-guards'],
      selected: buildObjectBundleSelected('driver-registration-shape-guards'),
      ok: buildObjectBundleStatus('driver-registration-shape-guards') === 'passed',
      status: buildObjectBundleStatus('driver-registration-shape-guards'),
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails(
        'driver-registration-shape-guards',
        scenarioPasses,
        buildObjectBundleStatus('driver-registration-shape-guards') !== 'skipped',
      ),
      requestedStatus: requestedScenarioStatuses['driver-registration-shape-guards']
        ?? buildConcreteRequestedBundleStatus('driver-registration-shape-guards'),
      requestedBundleStatus: buildConcreteRequestedBundleStatus('driver-registration-shape-guards'),
      requestedBundleStatuses: buildConcreteRequestedBundleStatuses('driver-registration-shape-guards'),
    },
    bundles: bundleResults,
    scenarios: scenarioResults,
  };

  proofSummary.driverRouteProof = proofSummary.routeProof;
  proofSummary.driverReceiptGuards = proofSummary.receiptGuards;
  proofSummary.driverDeleteApplyProof = proofSummary.deleteApplyProof;
  proofSummary.driverMutationProof = proofSummary.mutationProof;
  proofSummary.driverVerifierGuards = proofSummary.verifierGuards;
  proofSummary.driverReceiptRegistrationGuards = proofSummary.receiptRegistrationGuards;
  proofSummary.driverRegistrationGuards = proofSummary.registrationGuards;
  proofSummary.driverCallbackGuards = proofSummary.callbackGuards;
  proofSummary.driverRegistrationShapeGuards = proofSummary.registrationShapeGuards;
  const canonicalProofKey = canonicalMode === null
    ? null
    : proofKeyByCanonicalMode[canonicalMode] ?? null;
  const legacyModeProofKey = legacyProofKeyForResolvedMode(resolvedMode, canonicalProofKey);
  const canonicalProof = canonicalProofKey === null
    ? null
    : proofSummary[canonicalProofKey] ?? null;
  const canonicalModeScenarios = canonicalMode === null
    ? []
    : scenarioGroups[canonicalMode] ?? [canonicalMode];
  const canonicalModePassedScenarios = canonicalModeScenarios.filter(
    (scenarioName) => scenarioPasses.get(scenarioName) === true,
  );
  const canonicalModeFailedScenarios = canonicalModeScenarios.filter(
    (scenarioName) => scenarioPasses.get(scenarioName) !== true,
  );
  const canonicalModeRequestedScenarioNames = new Set([
    canonicalMode,
    ...canonicalModeScenarios,
  ]);
  const canonicalModeRequestedBundleNames = canonicalMode === null
    ? new Set()
    : isBundleAliasScenario(canonicalMode)
      ? new Set([toBundleKey(canonicalMode)])
      : new Set();
  const modeRequestedScenarios = canonicalMode === null
    ? []
    : filterRequestedListForMode(
      proofSummary.requestedScenarios,
      canonicalModeRequestedScenarioNames,
    );
  const modeRequestedBundles = canonicalMode === null
    ? []
    : filterRequestedListForMode(
      proofSummary.requestedBundles,
      canonicalModeRequestedBundleNames,
    );
  const modeRequestedConcreteScenarios = canonicalMode === null
    ? []
    : filterRequestedListForMode(
      proofSummary.requestedConcreteScenarios,
      new Set(canonicalModeScenarios),
    );
  const modeRequestedScenarioStatuses = canonicalMode === null
    ? {}
    : filterRequestedStatusMapForMode(
      proofSummary.requestedScenarioStatuses,
      canonicalModeRequestedScenarioNames,
    );
  const modeRequestedConcreteScenarioStatuses = canonicalMode === null
    ? {}
    : filterRequestedStatusMapForMode(
      proofSummary.requestedConcreteScenarioStatuses,
      new Set(canonicalModeScenarios),
    );
  const modeRequestedBundleStatuses = canonicalMode === null
    ? null
    : canonicalModeRequestedBundleNames.size === 0
      ? null
      : filterRequestedStatusMapForMode(
        canonicalProof?.requestedBundleStatuses ?? {},
        canonicalModeRequestedBundleNames,
      );
  const modeRequestedBundleStatus = canonicalMode === null
    ? null
    : collapseRequestedBundleStatus(modeRequestedBundleStatuses);
  const modeLegacyRequestedBundles = canonicalMode === null
    ? []
    : modeRequestedBundles === 'all'
      ? 'all'
      : canonicalProofKey === null
        ? modeRequestedBundles
        : modeRequestedBundles.map((bundleKey) => (
          bundleKey === canonicalProofKey ? legacyModeProofKey : bundleKey
        ));
  const modeLegacyRequestedBundleStatuses = canonicalMode === null
    ? null
    : aliasRequestedBundleStatusMap(
      modeRequestedBundleStatuses,
      canonicalProofKey,
      legacyModeProofKey,
    );
  const modeLegacyRequestedBundleStatus = canonicalMode === null
    ? null
    : collapseRequestedBundleStatus(modeLegacyRequestedBundleStatuses);
  const modeGuardProof = canonicalMode === null
    ? null
    : buildModeGuardProof(canonicalMode, summary, scenarioPasses);
  proofSummary.modeProof = canonicalProof === null
    ? null
    : {
      mode: resolvedMode,
      canonicalMode,
      proofKey: canonicalProofKey,
      proof: canonicalProof,
      legacyProofKey: legacyModeProofKey,
      legacyProof: proofSummary?.[legacyModeProofKey] ?? null,
      requestedScenarios: modeRequestedScenarios,
      requestedBundles: modeRequestedBundles,
      legacyRequestedBundles: modeLegacyRequestedBundles,
      requestedConcreteScenarios: modeRequestedConcreteScenarios,
      requested: canonicalProof.requested,
      selected: canonicalProof.selected,
      ok: canonicalProof.ok,
      status: canonicalProof.status,
      requiredScenarioCount: canonicalProof.requiredScenarioCount ?? canonicalModeScenarios.length,
      passedScenarioCount: canonicalProof.passedScenarioCount ?? canonicalModePassedScenarios.length,
      failedScenarioCount: canonicalProof.failedScenarioCount ?? canonicalModeFailedScenarios.length,
      requiredScenarios: canonicalProof.requiredScenarios ?? canonicalModeScenarios,
      scenarioStatuses: Object.fromEntries(
        (canonicalProof.requiredScenarios ?? canonicalModeScenarios)
          .map((scenarioName) => [
            scenarioName,
            scenarioPasses.get(scenarioName) === true ? 'passed' : 'missing',
          ])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
      passedScenarios: canonicalProof.passedScenarios ?? canonicalModePassedScenarios,
      failedScenarios: canonicalProof.failedScenarios ?? canonicalModeFailedScenarios,
      guardProof: modeGuardProof,
      requestedStatus: canonicalProof.requestedStatus ?? null,
      requestedScenarioStatuses: modeRequestedScenarioStatuses,
      requestedConcreteScenarioStatuses: modeRequestedConcreteScenarioStatuses,
      requestedSatisfied: requestedStatusesSatisfied(modeRequestedScenarioStatuses),
      requestedScenariosSatisfied: requestedStatusesSatisfied(modeRequestedScenarioStatuses),
      requestedBundlesSatisfied: requestedStatusesSatisfied(modeRequestedBundleStatuses),
      requestedConcreteScenariosSatisfied: requestedStatusesSatisfied(modeRequestedConcreteScenarioStatuses),
      requestedBundleStatus: modeRequestedBundleStatus,
      requestedBundleStatuses: modeRequestedBundleStatuses,
      legacyRequestedBundleStatus: modeLegacyRequestedBundleStatus,
      legacyRequestedBundleStatuses: modeLegacyRequestedBundleStatuses,
    };

  return proofSummary;
}
