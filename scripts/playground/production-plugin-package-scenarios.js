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
  'driver-production-boundary-guards': [
    'driver-receipt-guards',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-owner-driver-allowlist-guards': [
    'driver-missing-plugin-owner-guard',
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

export function parseProductionPluginPackageSelectedScenarios(argv, envValue) {
  const explicitArg = argv.find((arg) => arg.startsWith('--scenario='));
  const rawValue = explicitArg ? explicitArg.slice('--scenario='.length) : envValue;
  if (!rawValue) {
    return null;
  }
  const requestedNames = rawValue
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (requestedNames.length === 0) {
    return null;
  }

  const unknownNames = requestedNames.filter((name) => !knownScenarioNames.has(name));
  if (unknownNames.length > 0) {
    throw new Error(
      `Unknown production plugin package smoke scenario: ${unknownNames.sort().join(', ')}`,
    );
  }

  const expandedNames = requestedNames.flatMap((name) => scenarioGroups[name] ?? [name]);
  return new Set(expandedNames);
}

export { scenarioGroups, scenarioNames };
