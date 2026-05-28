import { digest } from '../../src/stable-json.js';

const scenarioGroups = {
  'arbitrary-plugin-fixture-package': [
    'driver-receipt-guards',
  ],
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

export function buildArbitraryPluginFixturePackageProof({
  resourceKey,
  driver,
  table,
  pluginOwner,
  baseRow,
  localRow,
  afterRejectedRow,
  planMutation,
  dryRunReceipt,
  rejectedApply,
  privateValueProbe,
  evidenceSource = 'packaged-plugin-driver-smoke',
  productionBacked = false,
  releaseGate = 'NO-GO',
} = {}) {
  const baseRowHash = sha256OrNull(baseRow);
  const localRowHash = sha256OrNull(localRow);
  const afterRejectedRowHash = sha256OrNull(afterRejectedRow);
  const applyBody = rejectedApply?.body && typeof rejectedApply.body === 'object'
    ? rejectedApply.body
    : {};
  const mutation = planMutation && typeof planMutation === 'object' ? planMutation : null;
  const proof = {
    rpp: 'RPP-0440',
    evidenceSource,
    evidenceScope: productionBacked
      ? 'production-backed-arbitrary-plugin-fixture-package'
      : 'local-playground-arbitrary-plugin-fixture-package',
    productionBacked: productionBacked === true,
    releaseGate,
    format: 'hash-only',
    rawValuesIncluded: false,
    fixturePackage: {
      arbitraryPluginOwnedPackage: true,
      resourceKey: resourceKey || null,
      driver: driver || null,
      table: table || null,
      pluginOwner: pluginOwner || null,
    },
    hashes: {
      baseRow: baseRowHash,
      localRow: localRowHash,
      afterRejectedRow: afterRejectedRowHash,
      mutation: sha256OrNull(mutation),
      mutationValue: sha256OrNull(mutation?.value),
      dryRunReceipt: sha256OrNull(dryRunReceipt),
      privateValueProbe: sha256OrNull(privateValueProbe),
    },
    mutation: mutation
      ? {
          action: mutation.action || null,
          remoteBeforeHash: prefixedHashOrNull(mutation.remoteBeforeHash),
          localAfterHash: prefixedHashOrNull(mutation.localAfterHash),
          resourceKey: mutation.resourceKey || null,
        }
      : null,
    dryRun: {
      receiptHash: dryRunReceipt?.receiptHash || null,
    },
    applyRefusal: {
      status: rejectedApply?.status ?? null,
      code: applyBody.code || null,
      messageHash: sha256OrNull(applyBody.message),
    },
    preservation: {
      rowRetainedAfterReject: afterRejectedRow !== undefined,
      remoteDataPreserved: baseRowHash !== null
        && afterRejectedRowHash !== null
        && baseRowHash === afterRejectedRowHash,
    },
  };

  return {
    ...proof,
    proofHash: sha256OrNull(proof),
  };
}

function prefixedHashOrNull(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ? `sha256:${value}`
    : null;
}

function sha256OrNull(value) {
  if (value === undefined) {
    return null;
  }
  return `sha256:${digest(value)}`;
}

export { scenarioGroups, scenarioNames };
