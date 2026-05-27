const receiptGuardScenarioNames = [
  'driver-delete-guard',
  'driver-update-validation-guard',
  'driver-receipt-plan-binding-guard',
  'driver-receipt-expiry-guard',
  'driver-receipt-identity-guard',
  'driver-receipt-rotated-credential-guard',
  'driver-receipt-revoked-credential-guard',
];

const registrationGuardScenarioNames = [
  'driver-missing-export-guard',
  'driver-missing-apply-guard',
  'driver-missing-validate-guard',
  'driver-missing-name-guard',
  'driver-missing-plugin-owner-guard',
  'driver-missing-table-guard',
  'driver-duplicate-name-guard',
  'driver-duplicate-table-guard',
];

const scenarioGroups = {
  'driver-positive-proof': [
    'core-package-routes',
    'driver-delete-apply',
  ],
  'driver-proof': [
    'driver-verifier-guards',
    ...receiptGuardScenarioNames,
    ...registrationGuardScenarioNames,
    'driver-delete-apply',
  ],
  'driver-release-proof': [
    'core-package-routes',
    ...receiptGuardScenarioNames,
    'driver-delete-apply',
  ],
  'driver-receipt-guards': receiptGuardScenarioNames,
  'driver-verifier-guards': [
    ...receiptGuardScenarioNames,
    ...registrationGuardScenarioNames,
  ],
  'driver-registration-guards': registrationGuardScenarioNames,
  'driver-receipt-registration-guards': [
    'driver-receipt-guards',
    ...receiptGuardScenarioNames,
    'driver-registration-guards',
    ...registrationGuardScenarioNames,
  ],
  'driver-callback-guards': [
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
  ],
  'driver-registration-shape-guards': [
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
};

const scenarioNames = [
  'core-package-routes',
  'driver-receipt-guards',
  ...receiptGuardScenarioNames,
  'driver-delete-apply',
  'driver-missing-export-guard',
  'driver-missing-apply-guard',
  'driver-missing-validate-guard',
  'driver-missing-name-guard',
  'driver-missing-plugin-owner-guard',
  'driver-missing-table-guard',
  'driver-duplicate-name-guard',
  'driver-duplicate-table-guard',
];

const knownScenarioNames = new Set([
  ...scenarioNames,
  ...Object.keys(scenarioGroups),
]);

const scenarioNameAliases = new Map([
  ['driverRouteProof', 'core-package-routes'],
  ['driver-route-proof', 'core-package-routes'],
  ['driverReceiptGuards', 'driver-receipt-guards'],
  ['driverDeleteApplyProof', 'driver-delete-apply'],
  ['driver-delete-apply-proof', 'driver-delete-apply'],
  ['driverPositiveProof', 'driver-positive-proof'],
  ['driverProof', 'driver-proof'],
  ['driverReleaseProof', 'driver-release-proof'],
  ['driverMutationProof', 'driver-release-proof'],
  ['driverVerifierGuards', 'driver-verifier-guards'],
  ['driverReceiptRegistrationGuards', 'driver-receipt-registration-guards'],
  ['driverRegistrationGuards', 'driver-registration-guards'],
  ['driverCallbackGuards', 'driver-callback-guards'],
  ['driverRegistrationShapeGuards', 'driver-registration-shape-guards'],
]);

const modeNameMappings = new Map([
  ['driver-guard-only', 'driver-receipt-guards'],
  ['driverGuardOnly', 'driver-receipt-guards'],
  ['driver-receipt-only', 'driver-receipt-guards'],
  ['driverReceiptOnly', 'driver-receipt-guards'],
  ['driver-receipt-guards', 'driver-receipt-guards'],
  ['driverReceiptGuards', 'driver-receipt-guards'],
  ['driver-receipt-guards-only', 'driver-receipt-guards'],
  ['driverReceiptGuardsOnly', 'driver-receipt-guards'],
  ['driver-verifier-only', 'driver-verifier-guards'],
  ['driverVerifierOnly', 'driver-verifier-guards'],
  ['driver-verifier-guards', 'driver-verifier-guards'],
  ['driverVerifierGuards', 'driver-verifier-guards'],
  ['driver-verifier-guards-only', 'driver-verifier-guards'],
  ['driverVerifierGuardsOnly', 'driver-verifier-guards'],
  ['driver-registration-only', 'driver-registration-guards'],
  ['driverRegistrationOnly', 'driver-registration-guards'],
  ['driver-registration-guards', 'driver-registration-guards'],
  ['driverRegistrationGuards', 'driver-registration-guards'],
  ['driver-registration-guards-only', 'driver-registration-guards'],
  ['driverRegistrationGuardsOnly', 'driver-registration-guards'],
  ['driver-receipt-registration-only', 'driver-receipt-registration-guards'],
  ['driverReceiptRegistrationOnly', 'driver-receipt-registration-guards'],
  ['driver-receipt-registration-guards', 'driver-receipt-registration-guards'],
  ['driverReceiptRegistrationGuards', 'driver-receipt-registration-guards'],
  ['driver-receipt-registration-guards-only', 'driver-receipt-registration-guards'],
  ['driverReceiptRegistrationGuardsOnly', 'driver-receipt-registration-guards'],
  ['driver-callback-only', 'driver-callback-guards'],
  ['driverCallbackOnly', 'driver-callback-guards'],
  ['driver-callback-guards', 'driver-callback-guards'],
  ['driverCallbackGuards', 'driver-callback-guards'],
  ['driver-callback-guards-only', 'driver-callback-guards'],
  ['driverCallbackGuardsOnly', 'driver-callback-guards'],
  ['driver-registration-shape-only', 'driver-registration-shape-guards'],
  ['driverRegistrationShapeOnly', 'driver-registration-shape-guards'],
  ['driver-registration-shape-guards', 'driver-registration-shape-guards'],
  ['driverRegistrationShapeGuards', 'driver-registration-shape-guards'],
  ['driver-registration-shape-guards-only', 'driver-registration-shape-guards'],
  ['driverRegistrationShapeGuardsOnly', 'driver-registration-shape-guards'],
  ['driver-delete-only', 'driver-delete-apply'],
  ['driverDeleteOnly', 'driver-delete-apply'],
  ['driver-delete-apply', 'driver-delete-apply'],
  ['driver-delete-apply-proof', 'driver-delete-apply'],
  ['driverDeleteApplyProof', 'driver-delete-apply'],
  ['driver-delete-apply-only', 'driver-delete-apply'],
  ['driverDeleteApplyOnly', 'driver-delete-apply'],
  ['driverDeleteApplyProofOnly', 'driver-delete-apply'],
  ['driver-route-only', 'core-package-routes'],
  ['driverRouteOnly', 'core-package-routes'],
  ['core-package-routes', 'core-package-routes'],
  ['driver-route-proof', 'core-package-routes'],
  ['driverRouteProof', 'core-package-routes'],
  ['driver-route-proof-only', 'core-package-routes'],
  ['driverRouteProofOnly', 'core-package-routes'],
  ['driver-positive-only', 'driver-positive-proof'],
  ['driverPositiveOnly', 'driver-positive-proof'],
  ['driver-positive-proof', 'driver-positive-proof'],
  ['driverPositiveProof', 'driver-positive-proof'],
  ['driver-positive-proof-only', 'driver-positive-proof'],
  ['driverPositiveProofOnly', 'driver-positive-proof'],
  ['driver-release-only', 'driver-release-proof'],
  ['driverReleaseOnly', 'driver-release-proof'],
  ['driver-release-proof', 'driver-release-proof'],
  ['driverReleaseProof', 'driver-release-proof'],
  ['driverMutationProof', 'driver-release-proof'],
  ['driver-release-proof-only', 'driver-release-proof'],
  ['driverReleaseProofOnly', 'driver-release-proof'],
  ['driver-proof', 'driver-proof'],
  ['driverProof', 'driver-proof'],
  ['driver-proof-only', 'driver-proof'],
  ['driverProofOnly', 'driver-proof'],
]);

const modeAliasesByCanonicalMode = Object.freeze(
  Array.from(
    modeNameMappings.entries().reduce((aliases, [alias, canonicalMode]) => {
      const existingAliases = aliases.get(canonicalMode) ?? [];
      existingAliases.push(alias);
      aliases.set(canonicalMode, existingAliases);
      return aliases;
    }, new Map()),
  )
    .sort(([leftMode], [rightMode]) => leftMode.localeCompare(rightMode))
    .reduce((aliases, [canonicalMode, modeAliases]) => {
      aliases[canonicalMode] = Object.freeze(Array.from(new Set(modeAliases)).sort());
      return aliases;
    }, {}),
);

function canonicalizeScenarioName(name) {
  return scenarioNameAliases.get(name) ?? name;
}

function resolveScenarioMode(modeValue) {
  if (!modeValue) {
    return null;
  }
  const scenario = modeNameMappings.get(modeValue);
  if (scenario) {
    return scenario;
  }
  throw new Error(
    `Unknown production plugin package smoke mode: ${modeValue}`,
  );
}

export function resolveProductionPluginPackageScenarios(argv, envValue, modeValue) {
  const explicitArg = argv.find((arg) => arg.startsWith('--scenario='));
  const explicitModeArg = argv.find((arg) => arg.startsWith('--mode='));
  const explicitModeValue = explicitModeArg === undefined
    ? null
    : explicitModeArg.slice('--mode='.length).trim();
  if (explicitModeArg !== undefined && explicitModeValue === '') {
    throw new Error('Production plugin package smoke mode cannot be blank');
  }
  const resolvedModeValue = explicitModeValue ?? modeValue;
  const modeScenario = resolveScenarioMode(resolvedModeValue);
  const resolvedFromMode = !explicitArg && !envValue && Boolean(modeScenario);
  const providedScenarioInput = explicitArg !== undefined || envValue !== undefined;
  const rawValue = explicitArg
    ? explicitArg.slice('--scenario='.length)
    : envValue ?? modeScenario;
  if (!rawValue) {
    if (providedScenarioInput) {
      throw new Error('Production plugin package smoke scenarios cannot be blank');
    }
    return {
      canonicalMode: null,
      resolvedMode: null,
      requestedScenarios: null,
      selectedScenarios: null,
    };
  }
  const requestedNames = rawValue
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (requestedNames.length === 0) {
    throw new Error('Production plugin package smoke scenarios cannot be blank');
  }

  const canonicalRequestedNames = requestedNames.map(canonicalizeScenarioName);
  const unknownNames = canonicalRequestedNames.filter((name) => !knownScenarioNames.has(name));
  if (unknownNames.length > 0) {
    throw new Error(
      `Unknown production plugin package smoke scenario: ${unknownNames.sort().join(', ')}`,
    );
  }

  const uniqueRequestedNames = Array.from(new Set(canonicalRequestedNames));
  const expandedNames = uniqueRequestedNames.flatMap((name) => scenarioGroups[name] ?? [name]);
  return {
    canonicalMode: modeScenario,
    resolvedMode: resolvedFromMode ? resolvedModeValue : null,
    requestedScenarios: uniqueRequestedNames,
    selectedScenarios: new Set([
      ...uniqueRequestedNames,
      ...expandedNames,
    ]),
  };
}

export function parseProductionPluginPackageSelectedScenarios(argv, envValue) {
  return resolveProductionPluginPackageScenarios(argv, envValue).selectedScenarios;
}

export {
  knownScenarioNames,
  modeAliasesByCanonicalMode,
  receiptGuardScenarioNames,
  scenarioGroups,
  scenarioNames,
};
