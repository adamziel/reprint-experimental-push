const scenarioGroups = {
  'driver-verifier-guards': [
    'driver-receipt-guards',
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-registration-guards': [
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
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
  if (modeValue === 'driver-callback-only') {
    return 'driver-callback-guards';
  }
  if (modeValue === 'driver-registration-shape-only') {
    return 'driver-registration-shape-guards';
  }
  if (modeValue === 'driver-delete-only') {
    return 'driver-delete-apply';
  }
  throw new Error(
    `Unknown production plugin package smoke mode: ${modeValue}`,
  );
}

export function resolveProductionPluginPackageScenarios(argv, envValue, modeValue) {
  const explicitArg = argv.find((arg) => arg.startsWith('--scenario='));
  const modeScenario = resolveScenarioMode(modeValue);
  const resolvedFromMode = !explicitArg && !envValue && Boolean(modeScenario);
  const rawValue = explicitArg
    ? explicitArg.slice('--scenario='.length)
    : envValue ?? modeScenario;
  if (!rawValue) {
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
    return {
      resolvedMode: null,
      requestedScenarios: null,
      selectedScenarios: null,
    };
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
    selectedScenarios: new Set(expandedNames),
  };
}

export function parseProductionPluginPackageSelectedScenarios(argv, envValue) {
  return resolveProductionPluginPackageScenarios(argv, envValue).selectedScenarios;
}

export { knownScenarioNames, scenarioGroups, scenarioNames };
