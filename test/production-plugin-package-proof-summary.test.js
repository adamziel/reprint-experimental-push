import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachProductionPluginPackagePluginDriverProof,
  buildProductionPluginPackageProofSummary,
  bundleSummaryGroups,
  proofKeyByCanonicalMode,
  resolveProductionPluginPackagePluginDriverProof,
  resolveProductionPluginPackageProofSummaryOptions,
  resolveProductionPluginPackageModeProof,
  resolveProductionPluginPackageModeProofKey,
  scenarioDefinitionNames,
} from '../scripts/playground/production-plugin-package-proof-summary.js';
import {
  modeAliasesByCanonicalMode,
  scenarioGroups,
  scenarioNames,
} from '../scripts/playground/production-plugin-package-scenarios.js';

test('plugin-driver proof summary bundle groups stay aligned with shared scenario groups', () => {
  assert.deepEqual(
    bundleSummaryGroups['driver-positive-proof'],
    scenarioGroups['driver-positive-proof'],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-proof'],
    [
      'driver-receipt-guards',
      ...scenarioGroups['driver-registration-guards'],
      'driver-delete-apply',
    ],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-registration-guards'],
    scenarioGroups['driver-registration-guards'],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-receipt-registration-guards'],
    [
      'driver-receipt-guards',
      ...scenarioGroups['driver-registration-guards'],
    ],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-callback-guards'],
    scenarioGroups['driver-callback-guards'],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-registration-shape-guards'],
    scenarioGroups['driver-registration-shape-guards'],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-verifier-guards'],
    [
      'driver-receipt-guards',
      ...scenarioGroups['driver-registration-guards'],
    ],
  );
  assert.deepEqual(
    bundleSummaryGroups['driver-release-proof'],
    [
      'core-package-routes',
      'driver-receipt-guards',
      'driver-delete-apply',
    ],
  );
});

test('plugin-driver proof summary tracks every shared plugin-driver scenario exactly once', () => {
  assert.deepEqual(
    scenarioDefinitionNames.slice().sort(),
    scenarioNames.slice().sort(),
  );
  assert.deepEqual(
    Object.keys(bundleSummaryGroups)
      .concat('driver-receipt-guards')
      .sort(),
    Object.keys(scenarioGroups).sort(),
  );
});

test('plugin-driver proof summary exports canonical proof keys for downstream mode consumers', () => {
  assert.deepEqual(proofKeyByCanonicalMode, {
    'core-package-routes': 'driverRouteProof',
    'driver-callback-guards': 'driverCallbackGuards',
    'driver-delete-apply': 'driverDeleteApplyProof',
    'driver-positive-proof': 'driverPositiveProof',
    'driver-proof': 'driverProof',
    'driver-receipt-guards': 'driverReceiptGuards',
    'driver-receipt-registration-guards': 'driverReceiptRegistrationGuards',
    'driver-registration-guards': 'driverRegistrationGuards',
    'driver-registration-shape-guards': 'driverRegistrationShapeGuards',
    'driver-release-proof': 'driverReleaseProof',
    'driver-verifier-guards': 'driverVerifierGuards',
  });
});

test('plugin-driver proof summary resolves runtime mode aliases to the canonical proof key contract', () => {
  assert.deepEqual(resolveProductionPluginPackageModeProofKey('driverMutationProof'), {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    proofKey: 'driverReleaseProof',
    legacyProofKey: 'driverMutationProof',
  });
  assert.deepEqual(resolveProductionPluginPackageModeProofKey('driverVerifierGuardsOnly'), {
    mode: 'driverVerifierGuardsOnly',
    canonicalMode: 'driver-verifier-guards',
    proofKey: 'driverVerifierGuards',
    legacyProofKey: 'driverVerifierGuards',
  });
  assert.equal(resolveProductionPluginPackageModeProofKey(null), null);
});

test('plugin-driver proof summary resolves every exported runtime mode alias to one canonical proof key', () => {
  const expectations = new Map([
    ['driverRouteOnly', { canonicalMode: 'core-package-routes', proofKey: 'driverRouteProof' }],
    ['driverRouteProof', { canonicalMode: 'core-package-routes', proofKey: 'driverRouteProof' }],
    ['driverRouteProofOnly', { canonicalMode: 'core-package-routes', proofKey: 'driverRouteProof' }],
    ['driverReceiptOnly', { canonicalMode: 'driver-receipt-guards', proofKey: 'driverReceiptGuards' }],
    ['driverReceiptGuards', { canonicalMode: 'driver-receipt-guards', proofKey: 'driverReceiptGuards' }],
    ['driverReceiptGuardsOnly', { canonicalMode: 'driver-receipt-guards', proofKey: 'driverReceiptGuards' }],
    ['driverDeleteOnly', { canonicalMode: 'driver-delete-apply', proofKey: 'driverDeleteApplyProof' }],
    ['driverDeleteApplyProof', { canonicalMode: 'driver-delete-apply', proofKey: 'driverDeleteApplyProof' }],
    ['driverDeleteApplyProofOnly', { canonicalMode: 'driver-delete-apply', proofKey: 'driverDeleteApplyProof' }],
    ['driverPositiveOnly', { canonicalMode: 'driver-positive-proof', proofKey: 'driverPositiveProof' }],
    ['driverPositiveProof', { canonicalMode: 'driver-positive-proof', proofKey: 'driverPositiveProof' }],
    ['driverPositiveProofOnly', { canonicalMode: 'driver-positive-proof', proofKey: 'driverPositiveProof' }],
    ['driverReleaseOnly', { canonicalMode: 'driver-release-proof', proofKey: 'driverReleaseProof' }],
    ['driverReleaseProof', { canonicalMode: 'driver-release-proof', proofKey: 'driverReleaseProof' }],
    ['driverReleaseProofOnly', { canonicalMode: 'driver-release-proof', proofKey: 'driverReleaseProof' }],
    ['driverMutationProof', { canonicalMode: 'driver-release-proof', proofKey: 'driverReleaseProof' }],
    ['driverMutationProofOnly', { canonicalMode: 'driver-release-proof', proofKey: 'driverReleaseProof' }],
    ['driverProof', { canonicalMode: 'driver-proof', proofKey: 'driverProof' }],
    ['driverProofOnly', { canonicalMode: 'driver-proof', proofKey: 'driverProof' }],
    ['driverVerifierOnly', { canonicalMode: 'driver-verifier-guards', proofKey: 'driverVerifierGuards' }],
    ['driverVerifierGuards', { canonicalMode: 'driver-verifier-guards', proofKey: 'driverVerifierGuards' }],
    ['driverVerifierGuardsOnly', { canonicalMode: 'driver-verifier-guards', proofKey: 'driverVerifierGuards' }],
    ['driverRegistrationOnly', { canonicalMode: 'driver-registration-guards', proofKey: 'driverRegistrationGuards' }],
    ['driverRegistrationGuards', { canonicalMode: 'driver-registration-guards', proofKey: 'driverRegistrationGuards' }],
    ['driverRegistrationGuardsOnly', { canonicalMode: 'driver-registration-guards', proofKey: 'driverRegistrationGuards' }],
    ['driverReceiptRegistrationOnly', { canonicalMode: 'driver-receipt-registration-guards', proofKey: 'driverReceiptRegistrationGuards' }],
    ['driverReceiptRegistrationGuards', { canonicalMode: 'driver-receipt-registration-guards', proofKey: 'driverReceiptRegistrationGuards' }],
    ['driverReceiptRegistrationGuardsOnly', { canonicalMode: 'driver-receipt-registration-guards', proofKey: 'driverReceiptRegistrationGuards' }],
    ['driverCallbackOnly', { canonicalMode: 'driver-callback-guards', proofKey: 'driverCallbackGuards' }],
    ['driverCallbackGuards', { canonicalMode: 'driver-callback-guards', proofKey: 'driverCallbackGuards' }],
    ['driverCallbackGuardsOnly', { canonicalMode: 'driver-callback-guards', proofKey: 'driverCallbackGuards' }],
    ['driverRegistrationShapeOnly', { canonicalMode: 'driver-registration-shape-guards', proofKey: 'driverRegistrationShapeGuards' }],
    ['driverRegistrationShapeGuards', { canonicalMode: 'driver-registration-shape-guards', proofKey: 'driverRegistrationShapeGuards' }],
    ['driverRegistrationShapeGuardsOnly', { canonicalMode: 'driver-registration-shape-guards', proofKey: 'driverRegistrationShapeGuards' }],
  ]);

  for (const [mode, expected] of expectations) {
    assert.deepEqual(
      resolveProductionPluginPackageModeProofKey(mode),
      {
        mode,
        canonicalMode: expected.canonicalMode,
        proofKey: expected.proofKey,
        legacyProofKey: mode.startsWith('driverMutationProof')
          ? 'driverMutationProof'
          : expected.proofKey,
      },
      `${mode} should resolve to one canonical proof key`,
    );
  }
});

test('plugin-driver proof summary resolves every shared runtime mode alias to one canonical proof key', () => {
  for (const [canonicalMode, aliases] of Object.entries(modeAliasesByCanonicalMode)) {
    for (const mode of aliases) {
      const resolved = resolveProductionPluginPackageModeProofKey(mode);

      assert.notEqual(
        resolved,
        null,
        `${mode} should resolve to a downstream proof key`,
      );
      assert.equal(
        resolved?.mode,
        mode,
        `${mode} should preserve its exact runtime alias`,
      );
      assert.equal(
        resolved?.canonicalMode,
        canonicalMode,
        `${mode} should resolve to ${canonicalMode}`,
      );
      assert.match(
        resolved?.proofKey ?? '',
        /^driver[A-Z]/,
        `${mode} should resolve to a canonical plugin-driver proof key`,
      );
    }
  }
});

test('plugin-driver proof summary resolves runtime mode aliases directly to proof payloads', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'driver-release-proof',
        ...scenarioGroups['driver-release-proof'],
      ]),
      resolvedMode: 'driverMutationProof',
      canonicalMode: 'driver-release-proof',
    },
  );

  const releaseModeProof = resolveProductionPluginPackageModeProof(summary, 'driverMutationProof');
  assert.equal(releaseModeProof?.mode, 'driverMutationProof');
  assert.equal(releaseModeProof?.canonicalMode, 'driver-release-proof');
  assert.equal(releaseModeProof?.proofKey, 'driverReleaseProof');
  assert.equal(releaseModeProof?.legacyProofKey, 'driverMutationProof');
  assert.equal(releaseModeProof?.proof, summary.driverReleaseProof);
  assert.equal(releaseModeProof?.legacyProof, summary.driverMutationProof);
  assert.deepEqual(releaseModeProof?.requestedBundles, ['driverReleaseProof']);
  assert.equal(releaseModeProof?.requestedBundleStatus, 'passed');
  assert.equal(releaseModeProof?.guardProof?.guardCount, 7);

  const verifierModeProof = resolveProductionPluginPackageModeProof(summary, 'driverVerifierGuardsOnly');
  assert.equal(verifierModeProof?.mode, 'driverVerifierGuardsOnly');
  assert.equal(verifierModeProof?.canonicalMode, 'driver-verifier-guards');
  assert.equal(verifierModeProof?.proofKey, 'driverVerifierGuards');
  assert.equal(verifierModeProof?.legacyProofKey, 'driverVerifierGuards');
  assert.notEqual(verifierModeProof?.proof, summary.driverVerifierGuards);
  assert.notEqual(verifierModeProof?.legacyProof, summary.driverVerifierGuards);
  assert.equal(verifierModeProof?.proof?.status, 'skipped');
  assert.equal(verifierModeProof?.proof?.receiptStatus, 'missing');
  assert.equal(verifierModeProof?.proof?.planBinding, null);
  assert.equal(verifierModeProof?.requestedBundleStatus, null);
  assert.equal(verifierModeProof?.guardProof?.guardCount, 15);
  assert.equal(resolveProductionPluginPackageModeProof(summary, null), null);
});

test('plugin-driver mode proof resolver infers the full bounded modeProof view from raw smoke metadata', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverUpdateApply: {
      applied: 1,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverMutationProof');

  assert.equal(modeProof?.mode, 'driverMutationProof');
  assert.equal(modeProof?.canonicalMode, 'driver-release-proof');
  assert.equal(modeProof?.proofKey, 'driverReleaseProof');
  assert.equal(modeProof?.legacyProofKey, 'driverMutationProof');
  assert.equal(modeProof?.requestedBundleStatus, 'passed');
  assert.deepEqual(modeProof?.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.deepEqual(modeProof?.legacyRequestedBundleStatuses, {
    driverMutationProof: 'passed',
  });
  assert.deepEqual(modeProof?.guardProof, {
    ok: true,
    status: 'passed',
    guardCount: 7,
    passedGuardCount: 7,
    failedGuardCount: 0,
    guardStatuses: {
      deleteGuard: 'passed',
      updateValidationGuard: 'passed',
      planBinding: 'passed',
      expiry: 'passed',
      identity: 'passed',
      rotatedCredential: 'passed',
      revokedCredential: 'passed',
    },
    passedGuards: [
      'deleteGuard',
      'updateValidationGuard',
      'planBinding',
      'expiry',
      'identity',
      'rotatedCredential',
      'revokedCredential',
    ],
    failedGuards: [],
    deleteGuard: {
      status: 'passed',
      rejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    updateValidationGuard: {
      status: 'passed',
      rejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    planBinding: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    expiry: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_EXPIRED',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    identity: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    rotatedCredential: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    revokedCredential: {
      status: 'passed',
      rejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
  });
});

test('plugin-driver mode proof resolver rebuilds a mismatched attached pluginDriverProof for the requested alias', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  resolveProductionPluginPackagePluginDriverProof(rawSummary);

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverVerifierGuards', {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set([
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ]),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.equal(modeProof?.mode, 'driverVerifierGuards');
  assert.equal(modeProof?.canonicalMode, 'driver-verifier-guards');
  assert.equal(modeProof?.proofKey, 'driverVerifierGuards');
  assert.equal(modeProof?.requestedBundleStatus, 'missing');
  assert.deepEqual(modeProof?.requestedBundleStatuses, {
    driverVerifierGuards: 'missing',
  });
  assert.equal(modeProof?.guardProof?.guardCount, 15);
  assert.equal(modeProof?.guardProof?.passedGuardCount, 15);
  assert.equal(modeProof?.guardProof?.failedGuardCount, 0);
  assert.equal(rawSummary.pluginDriverProof.mode, 'driverMutationProof');
  assert.equal(rawSummary.pluginDriverProof.canonicalMode, 'driver-release-proof');
});

test('plugin-driver proof summary resolves the bounded pluginDriverProof object from raw smoke summary input', () => {
  const rawSummary = {
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverUpdateApply: {
      applied: 1,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const pluginDriverProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: new Set([
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(pluginDriverProof, rawSummary.pluginDriverProof);
  assert.equal(pluginDriverProof.modeProof?.proofKey, 'driverReleaseProof');
  assert.equal(pluginDriverProof.modeProof?.legacyProofKey, 'driverMutationProof');
  assert.deepEqual(pluginDriverProof.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(pluginDriverProof.modeProof?.legacyRequestedBundles, ['driverMutationProof']);
});

test('plugin-driver proof summary infers build options from raw smoke metadata when explicit options are omitted', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverUpdateApply: {
      applied: 1,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const pluginDriverProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);

  assert.equal(pluginDriverProof, rawSummary.pluginDriverProof);
  assert.equal(pluginDriverProof.mode, 'driverMutationProof');
  assert.equal(pluginDriverProof.canonicalMode, 'driver-release-proof');
  assert.equal(pluginDriverProof.modeProof?.proofKey, 'driverReleaseProof');
  assert.deepEqual(pluginDriverProof.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(pluginDriverProof.modeProof?.legacyRequestedBundles, ['driverMutationProof']);
});

test('plugin-driver proof summary attach helper persists top-level modeProof on raw smoke summaries', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverUpdateApply: {
      applied: 1,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const pluginDriverProof = attachProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set([
      'driverReleaseProof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(rawSummary.pluginDriverProof, pluginDriverProof);
  assert.equal(rawSummary.modeProof, pluginDriverProof.modeProof);
  assert.equal(rawSummary.modeProof?.mode, 'driverReleaseProof');
  assert.equal(rawSummary.modeProof?.canonicalMode, 'driver-release-proof');
  assert.equal(rawSummary.modeProof?.proofKey, 'driverReleaseProof');
  assert.deepEqual(rawSummary.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(rawSummary.modeProof?.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.deepEqual(rawSummary.modeProof?.requestedScenarios, ['driverReleaseProof']);
});

test('plugin-driver proof summary reuses an attached pluginDriverProof for repeated direct alias mode requests', () => {
  const rawSummary = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const options = {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set([
      'driverReleaseProof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  };

  const firstProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, options);
  const secondProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, options);

  assert.equal(secondProof, firstProof);
  assert.equal(rawSummary.pluginDriverProof, firstProof);
  assert.equal(rawSummary.modeProof, firstProof.modeProof);
  assert.deepEqual(firstProof.modeProof?.requestedScenarios, ['driverReleaseProof']);
});

test('plugin-driver proof summary reuses an already attached pluginDriverProof object without rebuilding it', () => {
  const pluginDriverProof = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driverVerifierGuards'],
    requestedBundles: ['driverVerifierGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-verifier-guards'])).sort(),
    modeProof: {
      mode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
      proofKey: 'driverVerifierGuards',
      legacyProofKey: 'driverVerifierGuards',
      requestedScenarios: ['driverVerifierGuards'],
      requestedBundles: ['driverVerifierGuards'],
    },
    ok: true,
  };

  const rawSummary = {
    pluginDriverProof,
  };

  assert.equal(
    resolveProductionPluginPackagePluginDriverProof(rawSummary, {
      requestedScenarios: ['driverVerifierGuards'],
      selectedScenarios: new Set(bundleSummaryGroups['driver-verifier-guards']),
      resolvedMode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
    }),
    pluginDriverProof,
  );
});

test('plugin-driver proof summary reuses an attached pluginDriverProof and repairs a matching stale top-level modeProof cache', () => {
  const pluginDriverProof = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driverVerifierGuards'],
    requestedBundles: ['driverVerifierGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-verifier-guards'])).sort(),
    modeProof: {
      mode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
      proofKey: 'driverVerifierGuards',
      legacyProofKey: 'driverVerifierGuards',
      requestedScenarios: ['driverVerifierGuards'],
      requestedBundles: ['driverVerifierGuards'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-verifier-guards'])).sort(),
      requestedBundleStatus: 'passed',
    },
    ok: true,
  };

  const rawSummary = {
    pluginDriverProof,
    modeProof: {
      ...pluginDriverProof.modeProof,
      requestedBundleStatus: 'missing',
    },
  };

  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverVerifierGuards'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-verifier-guards']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.equal(reusedProof, pluginDriverProof);
  assert.equal(rawSummary.modeProof, pluginDriverProof.modeProof);
  assert.equal(rawSummary.modeProof?.requestedBundleStatus, 'passed');
});

test('plugin-driver proof summary repairs an alias-stale top-level modeProof cache when the nested proof is reused', () => {
  const pluginDriverProof = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    modeProof: {
      mode: 'driverReleaseProof',
      canonicalMode: 'driver-release-proof',
      proofKey: 'driverReleaseProof',
      legacyProofKey: 'driverReleaseProof',
      requestedScenarios: ['driverReleaseProof'],
      requestedBundles: ['driverReleaseProof'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
      requestedBundleStatus: 'passed',
    },
    ok: true,
  };

  const rawSummary = {
    pluginDriverProof,
    modeProof: {
      ...pluginDriverProof.modeProof,
      mode: 'driverMutationProof',
      legacyProofKey: 'driverMutationProof',
      requestedScenarios: ['driverMutationProof'],
      requestedBundles: ['driverMutationProof'],
      requestedBundleStatus: 'missing',
    },
  };

  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(reusedProof, pluginDriverProof);
  assert.equal(rawSummary.modeProof, pluginDriverProof.modeProof);
  assert.equal(rawSummary.modeProof?.mode, 'driverReleaseProof');
  assert.deepEqual(rawSummary.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.equal(rawSummary.modeProof?.requestedBundleStatus, 'passed');
});

test('plugin-driver mode proof resolver repairs an alias-stale top-level modeProof cache when the nested proof is reused', () => {
  const pluginDriverProof = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    modeProof: {
      mode: 'driverReleaseProof',
      canonicalMode: 'driver-release-proof',
      proofKey: 'driverReleaseProof',
      legacyProofKey: 'driverReleaseProof',
      requestedScenarios: ['driverReleaseProof'],
      requestedBundles: ['driverReleaseProof'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
      requestedBundleStatus: 'passed',
      marker: 'nested-canonical',
    },
    ok: true,
  };

  const rawSummary = {
    pluginDriverProof,
    modeProof: {
      ...pluginDriverProof.modeProof,
      mode: 'driverMutationProof',
      legacyProofKey: 'driverMutationProof',
      requestedScenarios: ['driverMutationProof'],
      requestedBundles: ['driverMutationProof'],
      requestedBundleStatus: 'missing',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverReleaseProof', {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(modeProof, pluginDriverProof.modeProof);
  assert.equal(rawSummary.modeProof, pluginDriverProof.modeProof);
  assert.equal(rawSummary.modeProof?.mode, 'driverReleaseProof');
  assert.deepEqual(rawSummary.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.equal(rawSummary.modeProof?.requestedBundleStatus, 'passed');
});

test('plugin-driver proof summary reuses an attached nested mode proof when requested bundle aliases are legacy-only', () => {
  const pluginDriverProof = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driverMutationProof'],
    requestedBundles: ['driverMutationProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    modeProof: {
      mode: 'driverMutationProof',
      canonicalMode: 'driver-release-proof',
      proofKey: 'driverReleaseProof',
      legacyProofKey: 'driverMutationProof',
      requestedScenarios: ['driverMutationProof'],
      requestedBundles: ['driverMutationProof'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
      requestedBundleStatus: 'passed',
      marker: 'legacy-bundle-alias',
    },
    requestedBundles: ['driverMutationProof'],
    driverReleaseProof: {
      status: 'passed',
    },
  };

  const rawSummary = {
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    pluginDriverProof,
    driverReleaseProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverMutationProof', {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(modeProof?.marker, 'legacy-bundle-alias');
  assert.deepEqual(modeProof?.requestedBundles, ['driverMutationProof']);
  assert.equal(modeProof?.proofKey, 'driverReleaseProof');
  assert.equal(modeProof?.legacyProofKey, 'driverMutationProof');
});

test('plugin-driver mode proof resolver reuses an attached top-level modeProof when the raw summary widened to all bundles', () => {
  const attachedModeProof = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    proofKey: 'driverReleaseProof',
    legacyProofKey: 'driverReleaseProof',
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    requestedBundleStatus: 'passed',
    marker: 'attached',
  };

  const rawSummary = {
    requestedScenarios: 'all',
    requestedBundles: 'all',
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    modeProof: attachedModeProof,
    driverReleaseProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverReleaseProof', {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(modeProof?.marker, 'attached');
  assert.deepEqual(modeProof?.requestedScenarios, ['driverReleaseProof']);
  assert.deepEqual(modeProof?.requestedBundles, ['driverReleaseProof']);
});

test('plugin-driver mode proof resolver reuses an attached top-level modeProof across canonical alias requests', () => {
  const attachedModeProof = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    proofKey: 'driverReleaseProof',
    legacyProofKey: 'driverReleaseProof',
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    requestedBundleStatus: 'passed',
    marker: 'attached-canonical',
  };

  const rawSummary = {
    modeProof: attachedModeProof,
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    driverReleaseProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverReleaseProofOnly', {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverReleaseProofOnly',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(modeProof?.marker, 'attached-canonical');
  assert.equal(modeProof?.mode, 'driverReleaseProof');
  assert.equal(modeProof?.proofKey, 'driverReleaseProof');
  assert.deepEqual(modeProof?.requestedBundles, ['driverReleaseProof']);
});

test('plugin-driver mode proof resolver repairs a matching top-level modeProof copy from the nested canonical cache', () => {
  const nestedModeProof = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    proofKey: 'driverReleaseProof',
    legacyProofKey: 'driverReleaseProof',
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    requestedBundleStatus: 'passed',
    marker: 'nested-canonical',
  };

  const rawSummary = {
    modeProof: {
      ...nestedModeProof,
      marker: 'top-level-copy',
    },
    pluginDriverProof: {
      mode: 'driverReleaseProof',
      canonicalMode: 'driver-release-proof',
      requestedScenarios: ['driverReleaseProof'],
      requestedBundles: ['driverReleaseProof'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
      modeProof: nestedModeProof,
    },
    requestedScenarios: ['driverReleaseProof'],
    requestedBundles: ['driverReleaseProof'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-release-proof'])).sort(),
    driverReleaseProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverReleaseProofOnly', {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-release-proof']),
    resolvedMode: 'driverReleaseProofOnly',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(modeProof, nestedModeProof);
  assert.equal(rawSummary.modeProof, nestedModeProof);
  assert.equal(rawSummary.modeProof?.marker, 'nested-canonical');
});

test('plugin-driver proof summary attach helper preserves an unrelated top-level modeProof cache', () => {
  const unrelatedModeProof = {
    mode: 'releaseProof',
    canonicalMode: 'release-proof',
    proofKey: 'releaseProof',
    legacyProofKey: 'releaseProof',
    requestedBundleStatus: 'passed',
  };
  const rawSummary = {
    modeProof: unrelatedModeProof,
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const pluginDriverProof = attachProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set([
      'driverReleaseProof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(rawSummary.pluginDriverProof, pluginDriverProof);
  assert.equal(rawSummary.modeProof, unrelatedModeProof);
  assert.equal(rawSummary.pluginDriverProof?.modeProof?.mode, 'driverReleaseProof');
});

test('plugin-driver proof summary attach helper does not null an unrelated top-level modeProof when no plugin-driver mode proof is available', () => {
  const unrelatedModeProof = {
    mode: 'releaseProof',
    canonicalMode: 'release-proof',
    proofKey: 'releaseProof',
    legacyProofKey: 'releaseProof',
  };
  const rawSummary = {
    modeProof: unrelatedModeProof,
  };

  const pluginDriverProof = attachProductionPluginPackagePluginDriverProof(rawSummary);

  assert.equal(rawSummary.pluginDriverProof, pluginDriverProof);
  assert.equal(rawSummary.modeProof, unrelatedModeProof);
  assert.equal(pluginDriverProof?.modeProof, null);
});

test('plugin-driver proof summary rebuilds a mismatched attached pluginDriverProof for the requested alias', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const rebuiltProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set([
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ]),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltProof, originalProof);
  assert.equal(rebuiltProof, rawSummary.pluginDriverProof);
  assert.equal(rebuiltProof.mode, 'driverVerifierGuards');
  assert.equal(rebuiltProof.canonicalMode, 'driver-verifier-guards');
  assert.equal(rebuiltProof.modeProof?.proofKey, 'driverVerifierGuards');
  assert.deepEqual(rebuiltProof.modeProof?.requestedBundles, ['driverVerifierGuards']);
});

test('plugin-driver proof summary rebuilds an attached pluginDriverProof and repairs a matching stale top-level modeProof cache', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: ['core-package-routes', 'driver-missing-export-guard'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const narrowProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(['core-package-routes', 'driver-missing-export-guard']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });
  rawSummary.modeProof = {
    ...narrowProof.modeProof,
    requestedBundleStatus: 'missing',
  };

  const rebuiltProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set([
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ]),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltProof, narrowProof);
  assert.equal(rebuiltProof, rawSummary.pluginDriverProof);
  assert.equal(rawSummary.modeProof, rebuiltProof.modeProof);
  assert.equal(
    rawSummary.modeProof?.requestedBundleStatus,
    rebuiltProof.modeProof?.requestedBundleStatus,
  );
});

test('plugin-driver proof summary rebuilds an attached pluginDriverProof when the selected scenario scope changes', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: ['core-package-routes', 'driver-export-guard'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const narrowProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(['core-package-routes', 'driver-export-guard']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  const fullVerifierSelection = new Set([
    'driver-verifier-guards',
    ...scenarioGroups['driver-verifier-guards'],
  ]);
  const rebuiltProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltProof, narrowProof);
  assert.equal(rebuiltProof, rawSummary.pluginDriverProof);
  assert.deepEqual(rebuiltProof.selectedScenarios, Array.from(fullVerifierSelection).sort());
  assert.equal(rebuiltProof.modeProof?.proofKey, 'driverVerifierGuards');
  assert.deepEqual(rebuiltProof.modeProof?.requestedBundles, ['driverVerifierGuards']);
});

test('plugin-driver proof summary reuses an attached pluginDriverProof when requested scenarios are reordered', () => {
  const fullVerifierSelection = new Set([
    'driver-verifier-guards',
    ...scenarioGroups['driver-verifier-guards'],
  ]);
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-receipt-guards', 'driver-verifier-guards'],
    selectedScenarios: Array.from(fullVerifierSelection).sort(),
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-receipt-guards', 'driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards', 'driver-receipt-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.deepEqual(reusedProof.requestedScenarios, ['driver-receipt-guards', 'driver-verifier-guards']);
});

test('plugin-driver proof summary rebuilds an attached pluginDriverProof when only the nested modeProof alias is stale', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: [
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const fullVerifierSelection = new Set([
    'driver-verifier-guards',
    ...scenarioGroups['driver-verifier-guards'],
  ]);
  const staleProof = buildProductionPluginPackageProofSummary(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });
  staleProof.modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverMutationProof', {
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: new Set([
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
  });
  rawSummary.pluginDriverProof = staleProof;

  const rebuiltProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltProof, staleProof);
  assert.equal(rebuiltProof, rawSummary.pluginDriverProof);
  assert.equal(rebuiltProof.mode, 'driverVerifierGuards');
  assert.equal(rebuiltProof.canonicalMode, 'driver-verifier-guards');
  assert.equal(rebuiltProof.modeProof?.mode, 'driverVerifierGuards');
  assert.equal(rebuiltProof.modeProof?.canonicalMode, 'driver-verifier-guards');
  assert.equal(rebuiltProof.modeProof?.proofKey, 'driverVerifierGuards');
  assert.equal(rebuiltProof.modeProof?.legacyProofKey, 'driverVerifierGuards');
  assert.deepEqual(rebuiltProof.modeProof?.requestedBundles, ['driverVerifierGuards']);
});

test('plugin-driver proof summary reuses attached pluginDriverProof across alias-equivalent requested scenarios', () => {
  const rawSummary = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: [
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set([
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.deepEqual(reusedProof.requestedScenarios, ['driver-release-proof']);
});

test('plugin-driver proof summary reuses attached pluginDriverProof across alias-equivalent selected scenarios', () => {
  const rawSummary = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: [
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProof'],
    selectedScenarios: new Set(['driverReleaseProof']),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.deepEqual(reusedProof.selectedScenarios, originalProof.selectedScenarios);
  assert.ok(reusedProof.selectedScenarios.includes('driver-release-proof'));
});

test('plugin-driver proof summary reuses attached pluginDriverProof for mode-only aliases under the same canonical mode', () => {
  const rawSummary = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: [
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverReleaseProofOnly'],
    selectedScenarios: ['driverReleaseProofOnly'],
    resolvedMode: 'driverReleaseProofOnly',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.deepEqual(reusedProof.requestedScenarios, ['driver-release-proof']);
  assert.deepEqual(reusedProof.modeProof?.requestedBundles, ['driverReleaseProof']);
});

test('plugin-driver proof summary reuses a canonical attached pluginDriverProof for legacy release aliases', () => {
  const rawSummary = {
    mode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: [
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverMutationProofOnly'],
    selectedScenarios: ['driverMutationProofOnly'],
    resolvedMode: 'driverMutationProofOnly',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.equal(reusedProof.mode, 'driverReleaseProof');
  assert.deepEqual(reusedProof.requestedScenarios, ['driver-release-proof']);
  assert.deepEqual(reusedProof.modeProof?.requestedBundles, ['driverReleaseProof']);
});

test('plugin-driver proof summary reuses attached pluginDriverProof for direct scenario aliases under the same canonical mode', () => {
  const rawSummary = {
    mode: 'driverRouteProof',
    canonicalMode: 'core-package-routes',
    requestedScenarios: ['core-package-routes'],
    selectedScenarios: ['core-package-routes'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driver-route-proof'],
    selectedScenarios: new Set(['driver-route-proof']),
    resolvedMode: 'driverRouteProof',
    canonicalMode: 'core-package-routes',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.deepEqual(reusedProof.requestedScenarios, ['core-package-routes']);
  assert.ok(reusedProof.selectedScenarios.includes('core-package-routes'));
});

test('plugin-driver proof summary reuses attached pluginDriverProof for positive-proof aliases under the same canonical mode', () => {
  const rawSummary = {
    mode: 'driverPositiveProof',
    canonicalMode: 'driver-positive-proof',
    requestedScenarios: ['driver-positive-proof'],
    selectedScenarios: [
      'driver-positive-proof',
      ...scenarioGroups['driver-positive-proof'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  const reusedProof = resolveProductionPluginPackagePluginDriverProof(rawSummary, {
    requestedScenarios: ['driverPositiveProofOnly'],
    selectedScenarios: ['driver-positive-proof-only'],
    resolvedMode: 'driver-positive-proof-only',
    canonicalMode: 'driver-positive-proof',
  });

  assert.equal(reusedProof, originalProof);
  assert.equal(reusedProof, rawSummary.pluginDriverProof);
  assert.equal(reusedProof.mode, 'driverPositiveProof');
  assert.deepEqual(reusedProof.requestedScenarios, ['driver-positive-proof']);
  assert.deepEqual(reusedProof.modeProof?.requestedBundles, ['driverPositiveProof']);
});

test('plugin-driver mode proof resolver reuses the attached callback modeProof object for canonical alias requests', () => {
  const attachedModeProof = {
    mode: 'driverCallbackGuards',
    canonicalMode: 'driver-callback-guards',
    proofKey: 'driverCallbackGuards',
    legacyProofKey: 'driverCallbackGuards',
    requestedScenarios: ['driverCallbackGuards'],
    requestedBundles: ['driverCallbackGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-callback-guards'])).sort(),
    requestedBundleStatus: 'passed',
    marker: 'callback-attached',
  };

  const rawSummary = {
    requestedScenarios: ['driverCallbackGuards'],
    requestedBundles: ['driverCallbackGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-callback-guards'])).sort(),
    pluginDriverProof: {
      mode: 'driverCallbackGuards',
      canonicalMode: 'driver-callback-guards',
      requestedScenarios: ['driverCallbackGuards'],
      requestedBundles: ['driverCallbackGuards'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-callback-guards'])).sort(),
      modeProof: attachedModeProof,
    },
    driverCallbackGuards: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverCallbackGuardsOnly', {
    requestedScenarios: ['driverCallbackGuards'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-callback-guards']),
    resolvedMode: 'driverCallbackGuardsOnly',
    canonicalMode: 'driver-callback-guards',
  });

  assert.equal(modeProof, attachedModeProof);
  assert.equal(modeProof?.marker, 'callback-attached');
});

test('plugin-driver mode proof resolver reuses the attached registration-shape modeProof object for canonical alias requests', () => {
  const attachedModeProof = {
    mode: 'driverRegistrationShapeGuards',
    canonicalMode: 'driver-registration-shape-guards',
    proofKey: 'driverRegistrationShapeGuards',
    legacyProofKey: 'driverRegistrationShapeGuards',
    requestedScenarios: ['driverRegistrationShapeGuards'],
    requestedBundles: ['driverRegistrationShapeGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-registration-shape-guards'])).sort(),
    requestedBundleStatus: 'passed',
    marker: 'registration-shape-attached',
  };

  const rawSummary = {
    requestedScenarios: ['driverRegistrationShapeGuards'],
    requestedBundles: ['driverRegistrationShapeGuards'],
    selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-registration-shape-guards'])).sort(),
    pluginDriverProof: {
      mode: 'driverRegistrationShapeGuards',
      canonicalMode: 'driver-registration-shape-guards',
      requestedScenarios: ['driverRegistrationShapeGuards'],
      requestedBundles: ['driverRegistrationShapeGuards'],
      selectedScenarios: Array.from(new Set(bundleSummaryGroups['driver-registration-shape-guards'])).sort(),
      modeProof: attachedModeProof,
    },
    driverRegistrationShapeGuards: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverRegistrationShapeGuardsOnly', {
    requestedScenarios: ['driverRegistrationShapeGuards'],
    selectedScenarios: new Set(bundleSummaryGroups['driver-registration-shape-guards']),
    resolvedMode: 'driverRegistrationShapeGuardsOnly',
    canonicalMode: 'driver-registration-shape-guards',
  });

  assert.equal(modeProof, attachedModeProof);
  assert.equal(modeProof?.marker, 'registration-shape-attached');
});

test('plugin-driver mode proof resolver reuses the attached route modeProof object for canonical alias requests', () => {
  const attachedModeProof = {
    mode: 'driverRouteProof',
    canonicalMode: 'core-package-routes',
    proofKey: 'driverRouteProof',
    legacyProofKey: 'driverRouteProof',
    requestedScenarios: ['driverRouteProof'],
    requestedBundles: ['driverRouteProof'],
    selectedScenarios: ['core-package-routes'],
    requestedBundleStatus: 'passed',
    marker: 'route-attached',
  };

  const rawSummary = {
    requestedScenarios: ['driverRouteProof'],
    requestedBundles: ['driverRouteProof'],
    selectedScenarios: ['core-package-routes'],
    pluginDriverProof: {
      mode: 'driverRouteProof',
      canonicalMode: 'core-package-routes',
      requestedScenarios: ['driverRouteProof'],
      requestedBundles: ['driverRouteProof'],
      selectedScenarios: ['core-package-routes'],
      modeProof: attachedModeProof,
    },
    driverRouteProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverRouteProofOnly', {
    requestedScenarios: ['driverRouteProof'],
    selectedScenarios: new Set(['core-package-routes']),
    resolvedMode: 'driverRouteProofOnly',
    canonicalMode: 'core-package-routes',
  });

  assert.equal(modeProof, attachedModeProof);
  assert.equal(modeProof?.marker, 'route-attached');
});

test('plugin-driver mode proof resolver reuses the attached delete-apply modeProof object for canonical alias requests', () => {
  const attachedModeProof = {
    mode: 'driverDeleteApplyProof',
    canonicalMode: 'driver-delete-apply',
    proofKey: 'driverDeleteApplyProof',
    legacyProofKey: 'driverDeleteApplyProof',
    requestedScenarios: ['driverDeleteApplyProof'],
    requestedBundles: ['driverDeleteApplyProof'],
    selectedScenarios: ['driver-delete-apply'],
    requestedBundleStatus: 'passed',
    marker: 'delete-apply-attached',
  };

  const rawSummary = {
    requestedScenarios: ['driverDeleteApplyProof'],
    requestedBundles: ['driverDeleteApplyProof'],
    selectedScenarios: ['driver-delete-apply'],
    pluginDriverProof: {
      mode: 'driverDeleteApplyProof',
      canonicalMode: 'driver-delete-apply',
      requestedScenarios: ['driverDeleteApplyProof'],
      requestedBundles: ['driverDeleteApplyProof'],
      selectedScenarios: ['driver-delete-apply'],
      modeProof: attachedModeProof,
    },
    driverDeleteApplyProof: {
      status: 'passed',
    },
  };

  const modeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverDeleteApplyProofOnly', {
    requestedScenarios: ['driverDeleteApplyProof'],
    selectedScenarios: new Set(['driver-delete-apply']),
    resolvedMode: 'driverDeleteApplyProofOnly',
    canonicalMode: 'driver-delete-apply',
  });

  assert.equal(modeProof, attachedModeProof);
  assert.equal(modeProof?.marker, 'delete-apply-attached');
});

test('plugin-driver mode proof resolver rebuilds a stale attached top-level modeProof when the selected scenario scope changes', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: ['core-package-routes', 'driver-missing-export-guard'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const narrowSummary = buildProductionPluginPackageProofSummary(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(['core-package-routes', 'driver-missing-export-guard']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });
  rawSummary.modeProof = narrowSummary.modeProof;

  const fullVerifierSelection = new Set([
    'driver-verifier-guards',
    ...scenarioGroups['driver-verifier-guards'],
  ]);
  const rebuiltModeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverVerifierGuards', {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltModeProof, rawSummary.modeProof);
  assert.equal(rebuiltModeProof?.mode, 'driverVerifierGuards');
  assert.equal(rebuiltModeProof?.canonicalMode, 'driver-verifier-guards');
  assert.equal(rebuiltModeProof?.proofKey, 'driverVerifierGuards');
  assert.deepEqual(rebuiltModeProof?.requiredScenarios, bundleSummaryGroups['driver-verifier-guards'].slice().sort());
  assert.deepEqual(rebuiltModeProof?.requestedBundles, ['driverVerifierGuards']);
  assert.equal(rawSummary.modeProof?.failedScenarioCount, narrowSummary.modeProof?.failedScenarioCount);
});

test('plugin-driver mode proof resolver rebuilds a narrow attached top-level modeProof when the raw summary selection has already widened', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: [
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const narrowSummary = buildProductionPluginPackageProofSummary(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(['core-package-routes', 'driver-missing-export-guard']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });
  rawSummary.modeProof = narrowSummary.modeProof;

  const rebuiltModeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverVerifierGuards', {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(rawSummary.selectedScenarios),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltModeProof, rawSummary.modeProof);
  assert.equal(rebuiltModeProof?.mode, 'driverVerifierGuards');
  assert.deepEqual(rebuiltModeProof?.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(
    rebuiltModeProof?.selectedScenarios,
    rawSummary.selectedScenarios.slice().sort(),
  );
  assert.equal(rawSummary.modeProof, rawSummary.pluginDriverProof?.modeProof);
  assert.deepEqual(
    rawSummary.modeProof?.selectedScenarios,
    rebuiltModeProof?.selectedScenarios,
  );
});

test('plugin-driver mode proof resolver rebuilds a stale attached nested modeProof when the selected scenario scope changes', () => {
  const rawSummary = {
    mode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: ['core-package-routes', 'driver-missing-export-guard'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  };

  const narrowSummary = buildProductionPluginPackageProofSummary(rawSummary, {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: new Set(['core-package-routes', 'driver-missing-export-guard']),
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });
  rawSummary.pluginDriverProof = narrowSummary;

  const fullVerifierSelection = new Set([
    'driver-verifier-guards',
    ...scenarioGroups['driver-verifier-guards'],
  ]);
  const rebuiltModeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverVerifierGuards', {
    requestedScenarios: ['driver-verifier-guards'],
    selectedScenarios: fullVerifierSelection,
    resolvedMode: 'driverVerifierGuards',
    canonicalMode: 'driver-verifier-guards',
  });

  assert.notEqual(rebuiltModeProof, rawSummary.pluginDriverProof.modeProof);
  assert.equal(rebuiltModeProof?.mode, 'driverVerifierGuards');
  assert.equal(rebuiltModeProof?.canonicalMode, 'driver-verifier-guards');
  assert.equal(rebuiltModeProof?.proofKey, 'driverVerifierGuards');
  assert.deepEqual(rebuiltModeProof?.requiredScenarios, bundleSummaryGroups['driver-verifier-guards'].slice().sort());
  assert.deepEqual(rebuiltModeProof?.requestedBundles, ['driverVerifierGuards']);
  assert.equal(rawSummary.pluginDriverProof.modeProof?.failedScenarioCount, narrowSummary.modeProof?.failedScenarioCount);
});

test('plugin-driver mode proof resolver rebuilds a stale attached mode alias for the same canonical proof key', () => {
  const rawSummary = {
    mode: 'driverMutationProof',
    canonicalMode: 'driver-release-proof',
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverDeleteGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      deletedAfterApply: true,
    },
  };

  const originalProof = resolveProductionPluginPackagePluginDriverProof(rawSummary);
  assert.equal(originalProof.modeProof?.mode, 'driverMutationProof');
  assert.equal(originalProof.modeProof?.legacyProofKey, 'driverMutationProof');
  assert.deepEqual(originalProof.modeProof?.legacyRequestedBundles, ['driverMutationProof']);

  const rebuiltModeProof = resolveProductionPluginPackageModeProof(rawSummary, 'driverReleaseProof', {
    requestedScenarios: ['driver-release-proof'],
    selectedScenarios: new Set([
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ]),
    resolvedMode: 'driverReleaseProof',
    canonicalMode: 'driver-release-proof',
  });

  assert.equal(rebuiltModeProof?.mode, 'driverReleaseProof');
  assert.equal(rebuiltModeProof?.canonicalMode, 'driver-release-proof');
  assert.equal(rebuiltModeProof?.proofKey, 'driverReleaseProof');
  assert.equal(rebuiltModeProof?.legacyProofKey, 'driverReleaseProof');
  assert.deepEqual(rebuiltModeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(rebuiltModeProof?.legacyRequestedBundles, ['driverReleaseProof']);
  assert.deepEqual(rebuiltModeProof?.proof, originalProof.driverReleaseProof);
  assert.deepEqual(rebuiltModeProof?.legacyProof, originalProof.driverReleaseProof);
  assert.equal(rawSummary.pluginDriverProof.modeProof?.mode, 'driverMutationProof');
  assert.equal(rawSummary.pluginDriverProof.modeProof?.legacyProofKey, 'driverMutationProof');
});

test('plugin-driver proof summary option inference preserves explicit overrides over raw smoke metadata', () => {
  assert.deepEqual(
    resolveProductionPluginPackageProofSummaryOptions(
      {
        mode: 'driverMutationProof',
        canonicalMode: 'driver-release-proof',
        requestedScenarios: ['driver-release-proof'],
        selectedScenarios: ['core-package-routes', 'driver-delete-apply', 'driver-receipt-guards'],
      },
      {
        requestedScenarios: ['driver-verifier-guards'],
        selectedScenarios: new Set(bundleSummaryGroups['driver-verifier-guards']),
        resolvedMode: 'driverVerifierGuards',
        canonicalMode: 'driver-verifier-guards',
      },
    ),
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set(bundleSummaryGroups['driver-verifier-guards']),
      resolvedMode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
    },
  );
});

test('plugin-driver proof summary resolves exported runtime mode aliases directly to their canonical proof payloads', () => {
  const summary = {
    driverRouteProof: { id: 'route' },
    driverReceiptGuards: { id: 'receipt' },
    driverDeleteApplyProof: { id: 'delete' },
    driverPositiveProof: { id: 'positive' },
    driverReleaseProof: { id: 'release' },
    driverProof: { id: 'proof' },
    driverVerifierGuards: { id: 'verifier' },
    driverReceiptRegistrationGuards: { id: 'receipt-registration' },
    driverRegistrationGuards: { id: 'registration' },
    driverCallbackGuards: { id: 'callback' },
    driverRegistrationShapeGuards: { id: 'registration-shape' },
  };

  const expectations = new Map([
    ['driverRouteProofOnly', summary.driverRouteProof],
    ['driverReceiptGuardsOnly', summary.driverReceiptGuards],
    ['driverDeleteApplyProofOnly', summary.driverDeleteApplyProof],
    ['driverPositiveProofOnly', summary.driverPositiveProof],
    ['driverMutationProofOnly', summary.driverReleaseProof],
    ['driverProofOnly', summary.driverProof],
    ['driverVerifierGuardsOnly', summary.driverVerifierGuards],
    ['driverReceiptRegistrationGuardsOnly', summary.driverReceiptRegistrationGuards],
    ['driverRegistrationGuardsOnly', summary.driverRegistrationGuards],
    ['driverCallbackGuardsOnly', summary.driverCallbackGuards],
    ['driverRegistrationShapeGuardsOnly', summary.driverRegistrationShapeGuards],
  ]);

  for (const [mode, expectedProof] of expectations) {
    assert.equal(
      resolveProductionPluginPackageModeProof(summary, mode)?.proof,
      expectedProof,
      `${mode} should resolve directly to the canonical proof payload`,
    );
  }
});

test('plugin-driver proof summary reports driver-proof as a first-class requested bundle', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-proof'],
      selectedScenarios: new Set([
        'driver-proof',
        ...scenarioGroups['driver-proof'],
        ...scenarioGroups['driver-verifier-guards'],
      ]),
    },
  );

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.requestedScenarios, ['driver-proof']);
  assert.deepEqual(summary.requestedBundles, ['driverProof']);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-proof']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverProof']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-proof': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverProof: 'passed',
  });
  assert.equal(summary.bundles.driverProof, 'passed');
  assert.deepEqual(summary.driverProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    verifierStatus: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    deleteStatus: 'passed',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    requiredScenarioCount: 10,
    passedScenarioCount: 10,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-delete-apply',
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'driver-delete-apply',
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverProof: 'passed',
    },
  });
});

test('plugin-driver proof summary reports full packaged guard coverage', () => {
  const summary = buildProductionPluginPackageProofSummary({
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
    },
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverUpdateApply: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      remoteSupportsDelete: false,
      applied: 1,
    },
    driverDeleteGuard: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      forgedPlanAcceptedByDryRun: false,
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      remoteSupportsDelete: true,
      deletedAfterApply: true,
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  });

  assert.equal(summary.kind, 'production-plugin-package-driver-proof');
  assert.equal(summary.ok, true);
  assert.equal(summary.checkedScenarioCount, 11);
  assert.equal(summary.passedScenarioCount, 11);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.skippedScenarioCount, 0);
  assert.equal(summary.checkedBundleCount, 8);
  assert.equal(summary.passedBundleCount, 8);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.skippedBundleCount, 0);
  assert.equal(summary.requestedScenarioCount, 'all');
  assert.equal(summary.passedRequestedScenarioCount, 'all');
  assert.equal(summary.failedRequestedScenarioCount, 'all');
  assert.equal(summary.requestedBundleCount, 'all');
  assert.equal(summary.passedRequestedBundleCount, 'all');
  assert.equal(summary.failedRequestedBundleCount, 'all');
  assert.equal(summary.requestedConcreteScenarioCount, 'all');
  assert.equal(summary.passedRequestedConcreteScenarioCount, 'all');
  assert.equal(summary.failedRequestedConcreteScenarioCount, 'all');
  assert.equal(summary.requestedScenarios, 'all');
  assert.equal(summary.requestedBundles, 'all');
  assert.equal(summary.requestedConcreteScenarios, 'all');
  assert.equal(summary.passedRequestedScenarios, 'all');
  assert.equal(summary.failedRequestedScenarios, 'all');
  assert.equal(summary.passedRequestedBundles, 'all');
  assert.equal(summary.failedRequestedBundles, 'all');
  assert.equal(summary.passedRequestedConcreteScenarios, 'all');
  assert.equal(summary.failedRequestedConcreteScenarios, 'all');
  assert.equal(summary.requestedScenarioStatuses, 'all');
  assert.equal(summary.requestedBundleStatuses, 'all');
  assert.equal(summary.requestedConcreteScenarioStatuses, 'all');
  assert.equal(summary.checkedScenarios, 'all');
  assert.deepEqual(summary.passedScenarios, [
    'core-package-routes',
    'driver-delete-apply',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, []);
  assert.equal(summary.checkedBundles, 'all');
  assert.deepEqual(summary.passedBundles, [
    'driverCallbackGuards',
    'driverPositiveProof',
    'driverProof',
    'driverReceiptRegistrationGuards',
    'driverRegistrationGuards',
    'driverRegistrationShapeGuards',
    'driverReleaseProof',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.selectedScenarios, 'all');
  assert.equal(summary.routes.labBacked, false);
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatus: 'all',
    requestedBundleStatuses: 'all',
  });
  assert.equal(summary.driverRouteProof, summary.routeProof);
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: 'all',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
    remoteSupportsDelete: true,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatus: 'all',
    requestedBundleStatuses: 'all',
  });
  assert.equal(summary.driverDeleteApplyProof, summary.deleteApplyProof);
  assert.equal(summary.mutationProof.deleteRejected, true);
  assert.equal(summary.driverMutationProof, summary.mutationProof);
  assert.deepEqual(summary.bundles, {
    driverPositiveProof: 'passed',
    driverProof: 'passed',
    driverReleaseProof: 'passed',
    driverVerifierGuards: 'passed',
    driverReceiptRegistrationGuards: 'passed',
    driverRegistrationGuards: 'passed',
    driverCallbackGuards: 'passed',
    driverRegistrationShapeGuards: 'passed',
  });
  assert.deepEqual(summary.scenarios, {
    corePackageRoutes: 'passed',
    driverReceiptGuards: 'passed',
    driverDeleteApply: 'passed',
    driverMissingExportGuard: 'passed',
    driverMissingApplyGuard: 'passed',
    driverMissingValidateGuard: 'passed',
    driverMissingNameGuard: 'passed',
    driverMissingPluginOwnerGuard: 'passed',
    driverMissingTableGuard: 'passed',
    driverDuplicateNameGuard: 'passed',
    driverDuplicateTableGuard: 'passed',
  });
});

test('plugin-driver proof summary marks unselected scenarios as skipped', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
        remoteSupportsDelete: false,
        applied: 1,
      },
      driverDeleteGuard: {
        forgedPlanAcceptedByDryRun: false,
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.checkedScenarioCount, 9);
  assert.equal(summary.passedScenarioCount, 9);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.skippedScenarioCount, 2);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 1);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.skippedBundleCount, 7);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 1);
  assert.equal(summary.failedRequestedScenarioCount, 0);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 1);
  assert.equal(summary.failedRequestedBundleCount, 0);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.requestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.passedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, []);
  assert.deepEqual(summary.checkedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {});
  assert.deepEqual(summary.selectedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.bundles, {
    driverPositiveProof: 'skipped',
    driverProof: 'skipped',
    driverReleaseProof: 'skipped',
    driverReceiptRegistrationGuards: 'skipped',
    driverVerifierGuards: 'passed',
    driverRegistrationGuards: 'skipped',
    driverCallbackGuards: 'skipped',
    driverRegistrationShapeGuards: 'skipped',
  });
  assert.equal(summary.scenarios.corePackageRoutes, 'skipped');
  assert.equal(summary.scenarios.driverReceiptGuards, 'passed');
  assert.equal(summary.scenarios.driverDeleteApply, 'skipped');
  assert.equal(summary.scenarios.driverDuplicateTableGuard, 'passed');
});

test('plugin-driver proof summary exposes direct requested route-proof state', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteApply: {
        resourceKey: 'row:["wp_reprint_push_driver_fixture_delete","entry_id:1"]',
        remoteSupportsDelete: true,
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(['core-package-routes']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'core-package-routes': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.positiveProof, {
    ...summary.positiveProof,
    status: 'skipped',
    requiredScenarioCount: 2,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.releaseProof, {
    ...summary.releaseProof,
    status: 'skipped',
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
  });
  assert.deepEqual(summary.verifierGuards, {
    ...summary.verifierGuards,
    status: 'skipped',
    requiredScenarioCount: 9,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
  });
});

test('plugin-driver proof summary marks missing requested route-proof state directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'core-package-routes': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    namespace: null,
    profile: null,
    labBacked: null,
    labNamespaceDisabled: null,
    authBootstrapDisabled: null,
    cliOk: null,
    finalMatchesLocal: null,
    requestedStatus: 'missing',
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary fails core package routes when packaged routes still report lab-backed mode', () => {
  const summary = buildProductionPluginPackageProofSummary({
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
    },
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: true,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
  }, {
    requestedScenarios: ['driver-positive-proof'],
    selectedScenarios: new Set(scenarioGroups['driver-positive-proof']),
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.scenarios.corePackageRoutes, 'missing');
  assert.equal(summary.bundles.driverPositiveProof, 'missing');
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-positive-proof']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverPositiveProof']);
});

test('plugin-driver proof summary fails requested bundle verdict when a requested guard is missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: false,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 0);
  assert.equal(summary.failedBundleCount, 1);
  assert.equal(summary.skippedBundleCount, 7);
  assert.equal(summary.checkedScenarioCount, 9);
  assert.equal(summary.passedScenarioCount, 8);
  assert.equal(summary.failedScenarioCount, 1);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.passedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, ['driver-missing-validate-guard']);
  assert.deepEqual(summary.checkedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedBundles, []);
  assert.deepEqual(summary.failedBundles, ['driverVerifierGuards']);
  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 0);
  assert.equal(summary.failedRequestedScenarioCount, 1);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 0);
  assert.equal(summary.failedRequestedBundleCount, 1);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.equal(summary.bundles.driverReceiptGuards, undefined);
  assert.equal(summary.bundles.driverVerifierGuards, 'missing');
  assert.equal(summary.scenarios.driverMissingValidateGuard, 'missing');
  assert.equal(summary.bundles.driverReceiptRegistrationGuards, 'skipped');
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
});

test('plugin-driver proof summary reports verifier bundle status inside driver-proof coverage', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-proof'],
      selectedScenarios: new Set([
        'driver-proof',
        ...scenarioGroups['driver-proof'],
        ...scenarioGroups['driver-verifier-guards'],
      ]),
    },
  );

  assert.equal(summary.driverProof.status, 'missing');
  assert.equal(summary.driverProof.verifierStatus, 'missing');
  assert.equal(summary.driverProof.exportStatus, 'passed');
  assert.equal(summary.driverProof.applyStatus, 'passed');
  assert.equal(summary.driverProof.validateStatus, 'missing');
  assert.equal(summary.receiptGuards.status, 'passed');
  assert.equal(summary.verifierGuards.status, 'skipped');
  assert.deepEqual(summary.failedScenarios, ['driver-missing-validate-guard']);
  assert.equal(summary.bundles.driverProof, 'missing');
  assert.equal(summary.bundles.driverVerifierGuards, 'skipped');
});

test('plugin-driver proof summary scopes requested bundle verdicts to requested bundles only', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: false,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-positive-proof'],
      selectedScenarios: new Set([
        ...scenarioGroups['driver-positive-proof'],
        ...scenarioGroups['driver-verifier-guards'],
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 1);
  assert.equal(summary.failedRequestedScenarioCount, 0);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 1);
  assert.equal(summary.failedRequestedBundleCount, 0);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-positive-proof']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverPositiveProof']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-positive-proof': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverPositiveProof: 'passed',
  });
  assert.equal(summary.bundles.driverPositiveProof, 'passed');
  assert.equal(summary.bundles.driverVerifierGuards, 'skipped');
  assert.equal(summary.scenarios.driverMissingValidateGuard, 'missing');
  assert.deepEqual(summary.positiveProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    routeStatus: 'passed',
    deleteStatus: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    finalMatchesLocal: true,
    requiredScenarioCount: 2,
    passedScenarioCount: 2,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    passedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
  });
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
  });
});

test('plugin-driver proof summary reports requested receipt guard verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 1);
  assert.equal(summary.failedBundleCount, 0);
  assert.deepEqual(summary.requestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.checkedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.passedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.failedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptGuards: 'passed',
  });
  assert.deepEqual(summary.passedRequestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.equal(summary.bundles.driverReceiptGuards, 'passed');
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReceiptGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary reports requested callback bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
    },
    {
      requestedScenarios: ['driver-callback-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-callback-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-callback-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverCallbackGuards: 'passed',
  });
  assert.equal(summary.bundles.driverCallbackGuards, 'passed');
  assert.deepEqual(summary.callbackGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 3,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverCallbackGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary fails revoked credential receipt guards when the row mutates after rejection', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: false,
        updatedMarkerAfterReject: 'forged-update',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.scenarios.driverReceiptGuards, 'missing');
  assert.equal(summary.bundles.driverReceiptGuards, 'missing');
  assert.equal(summary.receiptGuards.ok, false);
  assert.equal(summary.receiptGuards.status, 'missing');
  assert.equal(summary.receiptGuards.revokedCredential, 'reprint_push_lab_auth_required');
  assert.equal(summary.receiptGuards.requestedStatus, 'missing');
  assert.equal(summary.receiptGuards.requestedBundleStatus, 'missing');
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptGuards: 'missing',
  });
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverReceiptGuards']);
});

test('plugin-driver proof summary fails revoked credential receipt guards when the payload mode mutates after rejection', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'forged-update',
        updatedMarkerAfterReject: 'local-update',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.receiptGuards.ok, false);
  assert.equal(summary.receiptGuards.status, 'missing');
  assert.equal(summary.scenarios.driverReceiptGuards, 'missing');
  assert.deepEqual(summary.failedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverReceiptGuards']);
});

test('plugin-driver proof summary fails receipt guards when the forged delete payload mutates after rejection', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'forged-update',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.receiptGuards.ok, false);
  assert.equal(summary.receiptGuards.status, 'missing');
  assert.equal(summary.scenarios.driverReceiptGuards, 'missing');
  assert.deepEqual(summary.failedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverReceiptGuards']);
});

test('plugin-driver proof summary fails receipt guards when the invalid update payload mutates after rejection', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'forged-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.receiptGuards.ok, false);
  assert.equal(summary.receiptGuards.status, 'missing');
  assert.equal(summary.scenarios.driverReceiptGuards, 'missing');
  assert.deepEqual(summary.failedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-receipt-guards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverReceiptGuards']);
});

test('plugin-driver proof summary exposes bounded release-proof bundle status', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set(scenarioGroups['driver-release-proof']),
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarios, ['driver-release-proof']);
  assert.deepEqual(summary.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-release-proof']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-release-proof': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.equal(summary.bundles.driverReleaseProof, 'passed');
  assert.deepEqual(summary.releaseProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    routeStatus: 'passed',
    receiptStatus: 'passed',
    deleteStatus: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 3,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
});

test('plugin-driver proof summary canonicalizes mixed release-proof aliases before deriving requested bundles', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labBacked: false,
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driverReleaseProof', 'driverMutationProof'],
      selectedScenarios: new Set(scenarioGroups['driver-release-proof']),
    },
  );

  assert.deepEqual(summary.requestedScenarios, ['driverReleaseProof', 'driverMutationProof']);
  assert.deepEqual(summary.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.passedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-release-proof': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReleaseProof: 'missing',
  });
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
});

test('plugin-driver proof summary tracks combined receipt and registration guard bundles', () => {
  const requestedScenarios = [
    'driver-receipt-registration-guards',
  ];
  const selectedScenarios = new Set([
    'driver-receipt-registration-guards',
    ...scenarioGroups['driver-receipt-registration-guards'],
  ]);
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        payloadModeAfterReject: 'local-update',
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios,
      selectedScenarios,
    },
  );

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.requestedScenarios, requestedScenarios);
  assert.deepEqual(summary.requestedBundles, ['driverReceiptRegistrationGuards']);
  assert.deepEqual(summary.passedRequestedScenarios, requestedScenarios);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverReceiptRegistrationGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-registration-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptRegistrationGuards: 'passed',
  });
  assert.deepEqual(summary.checkedBundles, ['driverReceiptRegistrationGuards']);
  assert.deepEqual(summary.passedBundles, ['driverReceiptRegistrationGuards']);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.receiptGuards.requested, true);
  assert.equal(summary.receiptGuards.selected, true);
  assert.equal(summary.receiptGuards.ok, true);
  assert.equal(summary.receiptGuards.status, 'passed');
  assert.deepEqual(summary.receiptGuards.requestedBundleStatuses, {
    driverReceiptRegistrationGuards: 'passed',
  });
  assert.deepEqual(summary.receiptRegistrationGuards, {
    ...summary.receiptRegistrationGuards,
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    receiptStatus: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReceiptRegistrationGuards: 'passed',
    },
  });
  assert.equal(summary.registrationGuards.requested, false);
  assert.equal(summary.registrationGuards.selected, false);
  assert.equal(summary.registrationGuards.ok, false);
  assert.equal(summary.registrationGuards.status, 'skipped');
  assert.deepEqual(summary.registrationGuards.requestedBundleStatuses, {
    driverReceiptRegistrationGuards: 'passed',
  });
  assert.deepEqual(summary.bundles, {
    driverProof: 'skipped',
    driverPositiveProof: 'skipped',
    driverReleaseProof: 'skipped',
    driverVerifierGuards: 'skipped',
    driverReceiptRegistrationGuards: 'passed',
    driverRegistrationGuards: 'skipped',
    driverCallbackGuards: 'skipped',
    driverRegistrationShapeGuards: 'skipped',
  });
});

test('plugin-driver proof summary treats bundled receipt alias as selected for release-proof coverage', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'driver-release-proof',
        'core-package-routes',
        'driver-receipt-guards',
        'driver-delete-apply',
      ]),
    },
  );

  assert.equal(summary.releaseProof.selected, true);
  assert.equal(summary.releaseProof.status, 'missing');
  assert.equal(summary.releaseProof.receiptStatus, 'missing');
  assert.equal(summary.releaseProof.requestedStatus, 'missing');
  assert.deepEqual(summary.releaseProof.requestedBundleStatuses, {
    driverReleaseProof: 'missing',
  });
  assert.deepEqual(summary.driverReleaseProof, summary.releaseProof);
});

test('plugin-driver proof summary exposes release and positive proof aliases alongside the canonical objects', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteApply: {
        resourceKey: 'row:[\"wp_reprint_push_driver_fixture\",\"entry_id:1\"]',
        remoteSupportsDelete: true,
        deletedAfterApply: true,
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-positive-proof', 'driver-release-proof'],
      selectedScenarios: new Set([
        'driver-positive-proof',
        ...scenarioGroups['driver-positive-proof'],
        'driver-release-proof',
        ...scenarioGroups['driver-release-proof'],
      ]),
    },
  );

  assert.equal(summary.driverRouteProof, summary.routeProof);
  assert.deepEqual(summary.driverPositiveProof, summary.positiveProof);
  assert.deepEqual(summary.driverReleaseProof, summary.releaseProof);
  assert.equal(summary.driverReceiptGuards, summary.receiptGuards);
  assert.equal(summary.driverDeleteApplyProof, summary.deleteApplyProof);
  assert.equal(summary.driverMutationProof, summary.mutationProof);
  assert.equal(summary.driverVerifierGuards, summary.verifierGuards);
  assert.equal(summary.driverReceiptRegistrationGuards, summary.receiptRegistrationGuards);
  assert.equal(summary.driverRegistrationGuards, summary.registrationGuards);
  assert.equal(summary.driverCallbackGuards, summary.callbackGuards);
  assert.equal(summary.driverRegistrationShapeGuards, summary.registrationShapeGuards);
  assert.equal(summary.routeProof.requestedBundleStatus, null);
  assert.deepEqual(summary.routeProof.requestedBundleStatuses, {
    driverPositiveProof: 'passed',
    driverReleaseProof: 'missing',
  });
  assert.equal(summary.deleteApplyProof.requestedBundleStatus, null);
  assert.deepEqual(summary.deleteApplyProof.requestedBundleStatuses, {
    driverPositiveProof: 'passed',
    driverReleaseProof: 'missing',
  });
});

test('plugin-driver proof summary carries the resolved smoke mode for bounded consumers', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteApply: {
        resourceKey: 'row:["wp_reprint_push_driver_fixture_delete","entry_id:1"]',
        remoteSupportsDelete: true,
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-positive-proof'],
      selectedScenarios: new Set([
        'driver-positive-proof',
        ...scenarioGroups['driver-positive-proof'],
      ]),
      resolvedMode: 'driverPositiveProof',
      canonicalMode: 'driver-positive-proof',
    },
  );

  assert.equal(summary.mode, 'driverPositiveProof');
  assert.equal(summary.canonicalMode, 'driver-positive-proof');
  assert.equal(summary.driverPositiveProof.status, 'passed');
  assert.deepEqual(summary.requestedBundles, ['driverPositiveProof']);
  assert.deepEqual(summary.modeProof, {
    mode: 'driverPositiveProof',
    canonicalMode: 'driver-positive-proof',
    proofKey: 'driverPositiveProof',
    proof: summary.driverPositiveProof,
    legacyProofKey: 'driverPositiveProof',
    legacyProof: summary.driverPositiveProof,
    requestedScenarios: ['driver-positive-proof'],
    selectedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-positive-proof',
    ],
    requestedBundles: ['driverPositiveProof'],
    legacyRequestedBundles: ['driverPositiveProof'],
    requestedConcreteScenarios: [],
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    requiredScenarioCount: 2,
    passedScenarioCount: 2,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    scenarioStatuses: {
      'core-package-routes': 'passed',
      'driver-delete-apply': 'passed',
    },
    passedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    failedScenarios: [],
    guardProof: null,
    requestedStatus: 'passed',
    requestedScenarioStatuses: {
      'driver-positive-proof': 'passed',
    },
    requestedConcreteScenarioStatuses: {},
    requestedSatisfied: true,
    requestedScenariosSatisfied: true,
    requestedBundlesSatisfied: true,
    requestedConcreteScenariosSatisfied: true,
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
    legacyRequestedBundleStatus: 'passed',
    legacyRequestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
  });
});

test('plugin-driver proof summary exposes direct mode proof for scenario modes', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
    },
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(['core-package-routes']),
      resolvedMode: 'driverRouteProof',
      canonicalMode: 'core-package-routes',
    },
  );

  assert.deepEqual(summary.modeProof, {
    mode: 'driverRouteProof',
    canonicalMode: 'core-package-routes',
    proofKey: 'driverRouteProof',
    proof: summary.driverRouteProof,
    legacyProofKey: 'driverRouteProof',
    legacyProof: summary.driverRouteProof,
    requestedScenarios: ['core-package-routes'],
    selectedScenarios: ['core-package-routes'],
    requestedBundles: [],
    legacyRequestedBundles: [],
    requestedConcreteScenarios: ['core-package-routes'],
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    requiredScenarioCount: 1,
    passedScenarioCount: 1,
    failedScenarioCount: 0,
    requiredScenarios: ['core-package-routes'],
    scenarioStatuses: {
      'core-package-routes': 'passed',
    },
    passedScenarios: ['core-package-routes'],
    failedScenarios: [],
    guardProof: null,
    requestedStatus: 'passed',
    requestedScenarioStatuses: {
      'core-package-routes': 'passed',
    },
    requestedConcreteScenarioStatuses: {
      'core-package-routes': 'passed',
    },
    requestedSatisfied: true,
    requestedScenariosSatisfied: true,
    requestedBundlesSatisfied: true,
    requestedConcreteScenariosSatisfied: true,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
    legacyRequestedBundleStatus: null,
    legacyRequestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary fails mode proof requested satisfaction when the selected mode is missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(['core-package-routes']),
      resolvedMode: 'driverRouteProof',
      canonicalMode: 'core-package-routes',
    },
  );

  assert.deepEqual(summary.modeProof, {
    mode: 'driverRouteProof',
    canonicalMode: 'core-package-routes',
    proofKey: 'driverRouteProof',
    proof: summary.driverRouteProof,
    legacyProofKey: 'driverRouteProof',
    legacyProof: summary.driverRouteProof,
    requestedScenarios: ['core-package-routes'],
    selectedScenarios: ['core-package-routes'],
    requestedBundles: [],
    legacyRequestedBundles: [],
    requestedConcreteScenarios: ['core-package-routes'],
    requested: true,
    selected: true,
    ok: false,
    status: 'missing',
    requiredScenarioCount: 1,
    passedScenarioCount: 0,
    failedScenarioCount: 1,
    requiredScenarios: ['core-package-routes'],
    scenarioStatuses: {
      'core-package-routes': 'missing',
    },
    passedScenarios: [],
    failedScenarios: ['core-package-routes'],
    guardProof: null,
    requestedStatus: 'missing',
    requestedScenarioStatuses: {
      'core-package-routes': 'missing',
    },
    requestedConcreteScenarioStatuses: {
      'core-package-routes': 'missing',
    },
    requestedSatisfied: false,
    requestedScenariosSatisfied: false,
    requestedBundlesSatisfied: true,
    requestedConcreteScenariosSatisfied: false,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
    legacyRequestedBundleStatus: null,
    legacyRequestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary accepts array selectedScenarios for bundle-backed mode summaries', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driverReleaseProof'],
      selectedScenarios: ['driverReleaseProof'],
      resolvedMode: 'driverReleaseProof',
      canonicalMode: 'driver-release-proof',
    },
  );

  assert.equal(summary.releaseProof.selected, true);
  assert.equal(summary.releaseProof.status, 'passed');
  assert.equal(summary.modeProof?.mode, 'driverReleaseProof');
  assert.equal(summary.modeProof?.selected, true);
  assert.equal(summary.modeProof?.status, 'passed');
  assert.deepEqual(summary.modeProof?.selectedScenarios, ['driverReleaseProof']);
});

test('plugin-driver proof summary distinguishes canonical and legacy proof objects for mutation aliases', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'driver-release-proof',
        ...scenarioGroups['driver-release-proof'],
      ]),
      resolvedMode: 'driverMutationProof',
      canonicalMode: 'driver-release-proof',
    },
  );

  assert.equal(summary.modeProof?.proofKey, 'driverReleaseProof');
  assert.equal(summary.modeProof?.proof, summary.driverReleaseProof);
  assert.equal(summary.modeProof?.legacyProofKey, 'driverMutationProof');
  assert.equal(summary.modeProof?.legacyProof, summary.driverMutationProof);
  assert.deepEqual(summary.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.modeProof?.legacyRequestedBundles, ['driverMutationProof']);
  assert.equal(summary.modeProof?.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.modeProof?.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.equal(summary.modeProof?.legacyRequestedBundleStatus, 'passed');
  assert.deepEqual(summary.modeProof?.legacyRequestedBundleStatuses, {
    driverMutationProof: 'passed',
  });
  assert.notEqual(summary.modeProof?.proof, summary.modeProof?.legacyProof);
});

test('plugin-driver proof summary leaves mode proof null without a canonical mode', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: null,
      selectedScenarios: null,
    },
  );

  assert.equal(summary.canonicalMode, null);
  assert.equal(summary.modeProof, null);
});

test('plugin-driver proof summary carries the full selected verifier guard proof on modeProof', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-verifier-guards',
        ...scenarioGroups['driver-verifier-guards'],
      ]),
      resolvedMode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
    },
  );

  assert.equal(summary.modeProof?.proof, summary.driverVerifierGuards);
  assert.equal(summary.modeProof?.proof.receiptStatus, 'passed');
  assert.equal(summary.modeProof?.proof.revokedCredential, 'reprint_push_lab_auth_required');
  assert.equal(summary.modeProof?.proof.missingExportRowsCallback, true);
  assert.equal(summary.modeProof?.proof.missingPluginOwner, true);
  assert.deepEqual(summary.modeProof?.guardProof, {
    ok: true,
    status: 'passed',
    guardCount: 15,
    passedGuardCount: 15,
    failedGuardCount: 0,
    guardStatuses: {
      deleteGuard: 'passed',
      updateValidationGuard: 'passed',
      planBinding: 'passed',
      expiry: 'passed',
      identity: 'passed',
      rotatedCredential: 'passed',
      revokedCredential: 'passed',
      missingExport: 'passed',
      missingApply: 'passed',
      missingValidate: 'passed',
      missingName: 'passed',
      missingPluginOwner: 'passed',
      missingTable: 'passed',
      duplicateName: 'passed',
      duplicateTable: 'passed',
    },
    passedGuards: [
      'deleteGuard',
      'updateValidationGuard',
      'planBinding',
      'expiry',
      'identity',
      'rotatedCredential',
      'revokedCredential',
      'missingExport',
      'missingApply',
      'missingValidate',
      'missingName',
      'missingPluginOwner',
      'missingTable',
      'duplicateName',
      'duplicateTable',
    ],
    failedGuards: [],
    deleteGuard: {
      status: 'passed',
      rejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    updateValidationGuard: {
      status: 'passed',
      rejectedCode: 'INVALID_PLAN',
      rowRetainedAfterReject: null,
      payloadModeAfterReject: null,
      updatedMarkerAfterReject: null,
    },
    planBinding: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    expiry: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_EXPIRED',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    identity: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    rotatedCredential: {
      status: 'passed',
      rejectedCode: 'AUTH_RECEIPT_MISMATCH',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    revokedCredential: {
      status: 'passed',
      rejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      payloadModeAfterReject: 'local-update',
      updatedMarkerAfterReject: 'local-update',
    },
    missingExport: {
      status: 'passed',
      observed: true,
    },
    missingApply: {
      status: 'passed',
      observed: true,
    },
    missingValidate: {
      status: 'passed',
      observed: true,
    },
    missingName: {
      status: 'passed',
      observed: true,
    },
    missingPluginOwner: {
      status: 'passed',
      observed: true,
    },
    missingTable: {
      status: 'passed',
      observed: true,
    },
    duplicateName: {
      status: 'passed',
      observed: true,
    },
    duplicateTable: {
      status: 'passed',
      observed: true,
    },
  });
});

test('plugin-driver proof summary marks failing selected verifier guards directly on modeProof.guardProof', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        payloadModeAfterReject: 'local-delete',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-verifier-guards',
        ...scenarioGroups['driver-verifier-guards'],
      ]),
      resolvedMode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
    },
  );

  assert.equal(summary.modeProof?.guardProof?.ok, false);
  assert.equal(summary.modeProof?.guardProof?.status, 'missing');
  assert.equal(summary.modeProof?.guardProof?.passedGuardCount, 14);
  assert.equal(summary.modeProof?.guardProof?.failedGuardCount, 1);
  assert.deepEqual(summary.modeProof?.guardProof?.guardStatuses, {
    deleteGuard: 'passed',
    updateValidationGuard: 'missing',
    planBinding: 'passed',
    expiry: 'passed',
    identity: 'passed',
    rotatedCredential: 'passed',
    revokedCredential: 'passed',
    missingExport: 'passed',
    missingApply: 'passed',
    missingValidate: 'passed',
    missingName: 'passed',
    missingPluginOwner: 'passed',
    missingTable: 'passed',
    duplicateName: 'passed',
    duplicateTable: 'passed',
  });
  assert.deepEqual(summary.modeProof?.guardProof?.failedGuards, [
    'updateValidationGuard',
  ]);
  assert.equal(summary.modeProof?.guardProof?.updateValidationGuard.status, 'missing');
  assert.equal(summary.modeProof?.guardProof?.updateValidationGuard.payloadModeAfterReject, 'local-delete');
  assert.deepEqual(summary.modeProof?.guardProof?.missingValidate, {
    status: 'passed',
    observed: true,
  });
});

test('plugin-driver proof summary carries combined receipt and registration guards on mixed modeProof', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-receipt-registration-guards'],
      selectedScenarios: new Set([
        'driver-receipt-registration-guards',
        ...scenarioGroups['driver-receipt-registration-guards'],
      ]),
      resolvedMode: 'driverReceiptRegistrationOnly',
      canonicalMode: 'driver-receipt-registration-guards',
    },
  );

  assert.equal(summary.modeProof?.guardProof?.ok, true);
  assert.equal(summary.modeProof?.guardProof?.guardCount, 15);
  assert.equal(summary.modeProof?.guardProof?.passedGuardCount, 15);
  assert.equal(summary.modeProof?.guardProof?.failedGuardCount, 0);
  assert.deepEqual(summary.modeProof?.guardProof?.guardStatuses, {
    deleteGuard: 'passed',
    updateValidationGuard: 'passed',
    planBinding: 'passed',
    expiry: 'passed',
    identity: 'passed',
    rotatedCredential: 'passed',
    revokedCredential: 'passed',
    missingExport: 'passed',
    missingApply: 'passed',
    missingValidate: 'passed',
    missingName: 'passed',
    missingPluginOwner: 'passed',
    missingTable: 'passed',
    duplicateName: 'passed',
    duplicateTable: 'passed',
  });
  assert.deepEqual(summary.modeProof?.guardProof?.missingApply, {
    status: 'passed',
    observed: true,
  });
  assert.deepEqual(summary.modeProof?.guardProof?.planBinding, {
    status: 'passed',
    rejectedCode: 'AUTH_RECEIPT_MISMATCH',
    rowRetainedAfterReject: true,
    payloadModeAfterReject: 'local-update',
    updatedMarkerAfterReject: 'local-update',
  });
});

test('plugin-driver proof summary carries bounded registration guard proof on modeProof', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-registration-guards'],
      selectedScenarios: new Set([
        'driver-registration-guards',
        ...scenarioGroups['driver-registration-guards'],
      ]),
      resolvedMode: 'driverRegistrationGuards',
      canonicalMode: 'driver-registration-guards',
    },
  );

  assert.deepEqual(summary.modeProof?.guardProof, {
    ok: true,
    status: 'passed',
    guardCount: 8,
    passedGuardCount: 8,
    failedGuardCount: 0,
    guardStatuses: {
      missingExport: 'passed',
      missingApply: 'passed',
      missingValidate: 'passed',
      missingName: 'passed',
      missingPluginOwner: 'passed',
      missingTable: 'passed',
      duplicateName: 'passed',
      duplicateTable: 'passed',
    },
    passedGuards: [
      'missingExport',
      'missingApply',
      'missingValidate',
      'missingName',
      'missingPluginOwner',
      'missingTable',
      'duplicateName',
      'duplicateTable',
    ],
    failedGuards: [],
    missingExport: {
      status: 'passed',
      observed: true,
    },
    missingApply: {
      status: 'passed',
      observed: true,
    },
    missingValidate: {
      status: 'passed',
      observed: true,
    },
    missingName: {
      status: 'passed',
      observed: true,
    },
    missingPluginOwner: {
      status: 'passed',
      observed: true,
    },
    missingTable: {
      status: 'passed',
      observed: true,
    },
    duplicateName: {
      status: 'passed',
      observed: true,
    },
    duplicateTable: {
      status: 'passed',
      observed: true,
    },
  });
});

test('plugin-driver proof summary marks failing selected registration guards directly on modeProof.guardProof', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: false,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-registration-guards'],
      selectedScenarios: new Set([
        'driver-registration-guards',
        ...scenarioGroups['driver-registration-guards'],
      ]),
      resolvedMode: 'driverRegistrationGuards',
      canonicalMode: 'driver-registration-guards',
    },
  );

  assert.equal(summary.modeProof?.guardProof?.ok, false);
  assert.equal(summary.modeProof?.guardProof?.status, 'missing');
  assert.equal(summary.modeProof?.guardProof?.passedGuardCount, 7);
  assert.equal(summary.modeProof?.guardProof?.failedGuardCount, 1);
  assert.deepEqual(summary.modeProof?.guardProof?.guardStatuses, {
    missingExport: 'passed',
    missingApply: 'passed',
    missingValidate: 'missing',
    missingName: 'passed',
    missingPluginOwner: 'passed',
    missingTable: 'passed',
    duplicateName: 'passed',
    duplicateTable: 'passed',
  });
  assert.deepEqual(summary.modeProof?.guardProof?.failedGuards, [
    'missingValidate',
  ]);
  assert.deepEqual(summary.modeProof?.guardProof?.missingValidate, {
    status: 'missing',
    observed: false,
  });
});

test('plugin-driver proof summary narrows modeProof requests to the selected canonical mode', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
        rowRetainedAfterReject: true,
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-positive-proof', 'driver-release-proof'],
      selectedScenarios: new Set([
        'driver-positive-proof',
        'driver-release-proof',
        ...scenarioGroups['driver-positive-proof'],
        ...scenarioGroups['driver-release-proof'],
      ]),
      resolvedMode: 'driverReleaseProof',
      canonicalMode: 'driver-release-proof',
    },
  );

  assert.deepEqual(summary.requestedScenarios, [
    'driver-positive-proof',
    'driver-release-proof',
  ]);
  assert.deepEqual(summary.modeProof?.requestedScenarios, [
    'driver-release-proof',
  ]);
  assert.deepEqual(summary.modeProof?.requestedBundles, [
    'driverReleaseProof',
  ]);
  assert.deepEqual(summary.modeProof?.requestedConcreteScenarios, []);
  assert.deepEqual(summary.modeProof?.requestedScenarioStatuses, {
    'driver-release-proof': 'passed',
  });
  assert.deepEqual(summary.modeProof?.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.deepEqual(summary.modeProof?.requestedConcreteScenarioStatuses, {});
  assert.equal(summary.modeProof?.requestedSatisfied, true);
  assert.equal(summary.modeProof?.requestedScenariosSatisfied, true);
  assert.equal(summary.modeProof?.requestedBundlesSatisfied, true);
  assert.equal(summary.modeProof?.requestedConcreteScenariosSatisfied, true);
});

test('plugin-driver proof summary canonicalizes direct mode-only aliases before deriving modeProof requests', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driverReleaseProofOnly'],
      selectedScenarios: new Set([
        'driver-release-proof',
        ...scenarioGroups['driver-release-proof'],
      ]),
      resolvedMode: 'driverReleaseProofOnly',
      canonicalMode: 'driver-release-proof',
    },
  );

  assert.deepEqual(summary.requestedScenarios, ['driverReleaseProofOnly']);
  assert.equal(summary.modeProof?.mode, 'driverReleaseProofOnly');
  assert.deepEqual(summary.modeProof?.requestedScenarios, ['driverReleaseProofOnly']);
  assert.deepEqual(summary.modeProof?.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.modeProof?.legacyRequestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.modeProof?.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.equal(summary.modeProof?.requestedBundleStatus, 'passed');
  assert.equal(summary.modeProof?.requestedSatisfied, true);
  assert.equal(summary.modeProof?.requestedScenariosSatisfied, true);
  assert.equal(summary.modeProof?.requestedBundlesSatisfied, true);
});

test('plugin-driver proof summary keeps modeProof satisfaction scoped to the selected canonical mode', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-release-proof', 'driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-verifier-guards',
        ...scenarioGroups['driver-verifier-guards'],
      ]),
      resolvedMode: 'driverVerifierGuards',
      canonicalMode: 'driver-verifier-guards',
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.deepEqual(summary.modeProof?.requestedScenarioStatuses, {
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.modeProof?.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.equal(summary.modeProof?.requestedSatisfied, true);
  assert.equal(summary.modeProof?.requestedScenariosSatisfied, true);
  assert.equal(summary.modeProof?.requestedBundlesSatisfied, true);
  assert.equal(summary.modeProof?.requestedConcreteScenariosSatisfied, true);
});

test('plugin-driver proof summary reports requested verifier bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-verifier-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.verifierGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    receiptStatus: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 9,
    passedScenarioCount: 9,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverVerifierGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary treats fully requested concrete receipt guards as a requested receipt bundle', () => {
  const concreteReceiptScenarios = scenarioGroups['driver-receipt-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: concreteReceiptScenarios,
      selectedScenarios: new Set(concreteReceiptScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundles, []);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.receiptGuards.requested, true);
  assert.equal(summary.receiptGuards.requestedStatus, 'passed');
  assert.equal(summary.receiptGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.receiptGuards.requestedBundleStatuses, {
    driverReceiptGuards: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete release proof as a requested release bundle on the object', () => {
  const concreteReleaseScenarios = scenarioGroups['driver-release-proof'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: concreteReleaseScenarios,
      selectedScenarios: new Set(concreteReleaseScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.releaseProof.requested, true);
  assert.equal(summary.releaseProof.requestedStatus, 'passed');
  assert.equal(summary.releaseProof.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.releaseProof.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete verifier guards as a requested verifier bundle on the object', () => {
  const concreteVerifierScenarios = scenarioGroups['driver-verifier-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: concreteVerifierScenarios,
      selectedScenarios: new Set(concreteVerifierScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.verifierGuards.requested, true);
  assert.equal(summary.verifierGuards.requestedStatus, 'passed');
  assert.equal(summary.verifierGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.verifierGuards.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete positive proof as a selected bundle on the object', () => {
  const concretePositiveScenarios = scenarioGroups['driver-positive-proof'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteApply: {
        resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
        remoteSupportsDelete: true,
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: concretePositiveScenarios,
      selectedScenarios: new Set(concretePositiveScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.positiveProof.requested, true);
  assert.equal(summary.positiveProof.selected, true);
  assert.equal(summary.positiveProof.ok, true);
  assert.equal(summary.positiveProof.status, 'passed');
  assert.equal(summary.positiveProof.requestedStatus, 'passed');
  assert.equal(summary.positiveProof.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.positiveProof.requestedBundleStatuses, {
    driverPositiveProof: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete registration guards as a selected bundle on the object', () => {
  const concreteRegistrationScenarios = scenarioGroups['driver-registration-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: concreteRegistrationScenarios,
      selectedScenarios: new Set(concreteRegistrationScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.registrationGuards.requested, true);
  assert.equal(summary.registrationGuards.selected, true);
  assert.equal(summary.registrationGuards.ok, true);
  assert.equal(summary.registrationGuards.status, 'passed');
  assert.equal(summary.registrationGuards.requestedStatus, 'passed');
  assert.equal(summary.registrationGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.registrationGuards.requestedBundleStatuses, {
    driverRegistrationGuards: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete callback guards as a selected bundle on the object', () => {
  const concreteCallbackScenarios = scenarioGroups['driver-callback-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
    },
    {
      requestedScenarios: concreteCallbackScenarios,
      selectedScenarios: new Set(concreteCallbackScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.callbackGuards.requested, true);
  assert.equal(summary.callbackGuards.selected, true);
  assert.equal(summary.callbackGuards.ok, true);
  assert.equal(summary.callbackGuards.status, 'passed');
  assert.equal(summary.callbackGuards.requestedStatus, 'passed');
  assert.equal(summary.callbackGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.callbackGuards.requestedBundleStatuses, {
    driverCallbackGuards: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete registration-shape guards as a selected bundle on the object', () => {
  const concreteRegistrationShapeScenarios = scenarioGroups['driver-registration-shape-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: concreteRegistrationShapeScenarios,
      selectedScenarios: new Set(concreteRegistrationShapeScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.registrationShapeGuards.requested, true);
  assert.equal(summary.registrationShapeGuards.selected, true);
  assert.equal(summary.registrationShapeGuards.ok, true);
  assert.equal(summary.registrationShapeGuards.status, 'passed');
  assert.equal(summary.registrationShapeGuards.requestedStatus, 'passed');
  assert.equal(summary.registrationShapeGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.registrationShapeGuards.requestedBundleStatuses, {
    driverRegistrationShapeGuards: 'passed',
  });
});

test('plugin-driver proof summary reports requested registration-shape bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-registration-shape-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-registration-shape-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-registration-shape-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverRegistrationShapeGuards: 'passed',
  });
  assert.equal(summary.bundles.driverRegistrationShapeGuards, 'passed');
  assert.deepEqual(summary.registrationShapeGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 5,
    passedScenarioCount: 5,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverRegistrationShapeGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary dedupes repeated requested bundle aliases', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-verifier-guards',
        'driver-registration-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.deepEqual(summary.requestedScenarios, [
    'driver-verifier-guards',
    'driver-registration-guards',
  ]);
  assert.deepEqual(summary.requestedBundles, [
    'driverVerifierGuards',
    'driverRegistrationGuards',
  ]);
  assert.deepEqual(summary.passedRequestedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.checkedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.passedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.checkedBundleCount, 2);
  assert.equal(summary.passedBundleCount, 2);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
});

test('plugin-driver proof summary exposes requested concrete scenarios separately from bundle aliases', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-delete-apply',
        'driver-delete-apply',
      ],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.deepEqual(summary.requestedScenarios, [
    'driver-verifier-guards',
    'driver-delete-apply',
  ]);
  assert.deepEqual(summary.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-delete-apply',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.equal(summary.checkedScenarioCount, 10);
  assert.equal(summary.passedScenarioCount, 10);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
});

test('plugin-driver proof summary exposes failing requested concrete scenarios without subtracting bundle expansions', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: false,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-delete-apply',
      ],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'missing',
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.releaseProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'skipped',
    receiptStatus: 'passed',
    deleteStatus: 'missing',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: false,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary keeps requested scenario verdict scoped to the requested proof set', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: false,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedScenarios, ['driver-delete-apply']);
});

test('plugin-driver proof summary treats bundle verdicts as satisfied when only concrete scenarios were requested', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-delete-apply'],
      selectedScenarios: new Set(['driver-delete-apply']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.equal(summary.checkedBundleCount, 0);
  assert.equal(summary.passedBundleCount, 0);
  assert.equal(summary.failedBundleCount, 0);
  assert.deepEqual(summary.requestedBundles, []);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'passed',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.checkedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedScenarios, []);
  assert.equal(summary.bundles.driverVerifierGuards, 'skipped');
  assert.equal(summary.scenarios.driverDeleteApply, 'passed');
});

test('plugin-driver proof summary fails requested concrete scenarios omitted from the selected proof set', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
    },
    {
      requestedScenarios: ['driver-delete-apply'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    requestedStatus: 'missing',
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary exposes failed requested bundles directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: null,
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-registration-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-registration-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverRegistrationGuards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-registration-guards': 'passed',
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverRegistrationGuards: 'passed',
    driverVerifierGuards: 'missing',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {});
  assert.deepEqual(summary.registrationGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 8,
    passedScenarioCount: 8,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverRegistrationGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary fails requested bundles when the selected proof set omits bundle scenarios', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'missing',
  });
  assert.equal(summary.bundles.driverVerifierGuards, 'missing');
  assert.equal(summary.scenarios.driverDuplicateTableGuard, 'skipped');
  assert.deepEqual(summary.releaseProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'skipped',
    receiptStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.registrationGuards, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 8,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.callbackGuards, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.registrationShapeGuards, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 5,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary exposes missing requested release bundle state directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'core-package-routes',
        'driver-receipt-guards',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-release-proof': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReleaseProof: 'missing',
  });
  assert.deepEqual(summary.releaseProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'missing',
    routeStatus: 'passed',
    receiptStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 2,
    failedScenarioCount: 1,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: ['core-package-routes', 'driver-receipt-guards'],
    failedScenarios: ['driver-delete-apply'],
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverReleaseProof: 'missing',
    },
  });
  assert.deepEqual(summary.positiveProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 2,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary marks incomplete requested verifier bundle as missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 0);
  assert.equal(summary.failedRequestedScenarioCount, 1);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 0);
  assert.equal(summary.failedRequestedBundleCount, 1);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'missing',
  });
  assert.deepEqual(summary.verifierGuards, {
    requested: true,
    selected: false,
    ok: false,
    status: 'missing',
    receiptStatus: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'skipped',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: false,
    duplicateTable: false,
    requiredScenarioCount: 9,
    passedScenarioCount: 7,
    failedScenarioCount: 2,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    failedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
    ],
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverVerifierGuards: 'missing',
    },
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: {
      driverVerifierGuards: 'missing',
    },
  });
});

test('plugin-driver proof summary marks incomplete requested receipt guard scenario as missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptGuards: 'missing',
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    planBinding: null,
    identity: null,
    expiry: null,
    rotatedCredential: null,
    revokedCredential: null,
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverReceiptGuards: 'missing',
    },
  });
});
