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

function resolveScenarioMode(modeValue) {
  if (!modeValue) {
    return null;
  }
  if (modeValue === 'driver-guard-only') {
    return 'driver-receipt-guards';
  }
  if (modeValue === 'driver-receipt-only') {
    return 'driver-receipt-guards';
  }
  if (modeValue === 'driver-verifier-only') {
    return 'driver-verifier-guards';
  }
  if (modeValue === 'driver-registration-only') {
    return 'driver-registration-guards';
  }
  if (modeValue === 'driver-receipt-registration-only') {
    return 'driver-receipt-registration-guards';
  }
  if (modeValue === 'driver-callback-only') {
    return 'driver-callback-guards';
  }
  if (modeValue === 'driver-registration-shape-only') {
    return 'driver-registration-shape-guards';
  }
  if (modeValue === 'driver-delete-only') {
    return 'driver-delete-apply';
  }
  if (modeValue === 'driver-positive-only') {
    return 'driver-positive-proof';
  }
  if (modeValue === 'driver-release-proof-only') {
    return 'driver-release-proof';
  }
  if (modeValue === 'driver-proof-only') {
    return 'driver-proof';
  }
  throw new Error(
    `Unknown production plugin package smoke mode: ${modeValue}`,
  );
}

export function resolveProductionPluginPackageScenarios(argv, envValue, modeValue) {
  const explicitArg = argv.find((arg) => arg.startsWith('--scenario='));
  const modeScenario = resolveScenarioMode(modeValue);
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

  const unknownNames = requestedNames.filter((name) => !knownScenarioNames.has(name));
  if (unknownNames.length > 0) {
    throw new Error(
      `Unknown production plugin package smoke scenario: ${unknownNames.sort().join(', ')}`,
    );
  }

  const uniqueRequestedNames = Array.from(new Set(requestedNames));
  const expandedNames = uniqueRequestedNames.flatMap((name) => scenarioGroups[name] ?? [name]);
  return {
    resolvedMode: resolvedFromMode ? modeValue : null,
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

export { knownScenarioNames, receiptGuardScenarioNames, scenarioGroups, scenarioNames };
