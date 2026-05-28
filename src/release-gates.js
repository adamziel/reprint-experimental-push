const FINAL_RELEASE_SCOPE = 'final-release';
const LOCAL_CANDIDATE_SCOPE = 'local-candidate';
const UNKNOWN_SCOPE = 'unknown';

const RELEASE_GATE_DATA = [
  {
    id: 'source-url',
    rpp: 'RPP-0001',
    title: 'REPRINT_PUSH_SOURCE_URL gate',
    category: 'topology',
    requiredEvidence: ['REPRINT_PUSH_SOURCE_URL'],
  },
  {
    id: 'local-url',
    rpp: 'RPP-0002',
    title: 'REPRINT_PUSH_LOCAL_URL gate',
    category: 'topology',
    requiredEvidence: ['REPRINT_PUSH_LOCAL_URL'],
  },
  {
    id: 'remote-changed-url',
    rpp: 'RPP-0003',
    title: 'REPRINT_PUSH_REMOTE_CHANGED_URL gate',
    category: 'topology',
    requiredEvidence: ['REPRINT_PUSH_REMOTE_CHANGED_URL'],
  },
  {
    id: 'packaged-fallback',
    rpp: 'RPP-0004',
    title: 'Packaged fallback rejection',
    category: 'boundary',
    requiredEvidence: ['non-packaged release boundary'],
  },
  {
    id: 'remote-alias',
    rpp: 'RPP-0005',
    title: 'Wrong remote alias rejection',
    category: 'topology',
    requiredEvidence: ['REPRINT_PUSH_REMOTE_URL absent or same as REPRINT_PUSH_SOURCE_URL'],
  },
  {
    id: 'auth-source-readback',
    rpp: 'RPP-0006',
    title: 'Auth source command readback drift',
    category: 'auth',
    evidenceKey: 'authSourceCommandReadback',
    requiredEvidence: ['same live source URL at auth issuance and readback'],
  },
  {
    id: 'production-secret',
    rpp: 'RPP-0007',
    title: 'Missing production secret gate',
    category: 'auth',
    evidenceKey: 'productionSecret',
    requiredEvidence: ['production credential or auth session source command'],
  },
  {
    id: 'application-password-binding',
    rpp: 'RPP-0008',
    title: 'Application Password credential binding',
    category: 'auth',
    evidenceKey: 'applicationPasswordCredentialBinding',
    requiredEvidence: ['Application Password bound to checked source identity'],
  },
  {
    id: 'manage-options-capability',
    rpp: 'RPP-0009',
    title: 'manage_options capability proof',
    category: 'auth',
    evidenceKey: 'manageOptionsCapability',
    requiredEvidence: ['authenticated user has manage_options on checked route'],
  },
  {
    id: 'same-source-identity',
    rpp: 'RPP-0010',
    title: 'Same source URL identity proof',
    category: 'identity',
    evidenceKey: 'sourceIdentity',
    requiredEvidence: ['preflight, dry-run, apply, and recovery use the same source URL'],
  },
  {
    id: 'preflight-route-identity',
    rpp: 'RPP-0011',
    title: 'Preflight route identity proof',
    category: 'route',
    evidenceKey: 'preflightRouteIdentity',
    requiredEvidence: ['preflight route identity checked before mutation'],
  },
  {
    id: 'dry-run-route-eligibility',
    rpp: 'RPP-0012',
    title: 'Dry-run route eligibility proof',
    category: 'route',
    evidenceKey: 'dryRunRouteEligibility',
    requiredEvidence: ['dry-run route eligibility checked before apply'],
  },
  {
    id: 'apply-route-pre-mutation',
    rpp: 'RPP-0013',
    title: 'Apply route pre-mutation proof',
    category: 'route',
    evidenceKey: 'applyRoutePreMutation',
    requiredEvidence: ['apply route rejects before mutation when preconditions fail'],
  },
  {
    id: 'journal-route-read-only',
    rpp: 'RPP-0014',
    title: 'Journal route read-only proof',
    category: 'recovery',
    evidenceKey: 'journalRouteReadOnly',
    requiredEvidence: ['journal route read-only proof'],
  },
  {
    id: 'recovery-inspect-read-only',
    rpp: 'RPP-0015',
    title: 'Recovery inspect read-only proof',
    category: 'recovery',
    evidenceKey: 'recoveryInspectReadOnly',
    requiredEvidence: ['recovery inspect read-only proof'],
  },
  {
    id: 'release-movement-summary',
    rpp: 'RPP-0016',
    title: 'releaseMovement allowed/denied summary',
    category: 'summary',
    requiredEvidence: ['machine-readable releaseMovement summary produced by evaluator'],
  },
  {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    evidenceKey: 'tmuxStatusMarker',
    requiredEvidence: ['final bracketed stdout status marker'],
  },
  {
    id: 'progress-release-timestamp',
    rpp: 'RPP-0018',
    title: 'progress.html release timestamp',
    category: 'operator-proof',
    evidenceKey: 'progressReleaseTimestamp',
    requiredEvidence: ['release timestamp tied to current evidence'],
  },
  {
    id: 'agents-release-gates-row',
    rpp: 'RPP-0019',
    title: '.agents/RELEASE_GATES.md status row',
    category: 'operator-proof',
    evidenceKey: 'agentsReleaseGateStatusRow',
    requiredEvidence: ['machine-readable release gate status row'],
  },
  {
    id: 'verify-release-failure-reason',
    rpp: 'RPP-0020',
    title: 'verify:release nonzero failure reason',
    category: 'operator-proof',
    evidenceKey: 'verifyReleaseFailure',
    requiredEvidence: ['nonzero verify:release failure emits a named reason'],
  },
];

export const RELEASE_GATE_SCOPES = Object.freeze({
  finalRelease: FINAL_RELEASE_SCOPE,
  localCandidate: LOCAL_CANDIDATE_SCOPE,
});

export const RELEASE_GATE_DEFINITIONS = Object.freeze(
  RELEASE_GATE_DATA.map((definition) => Object.freeze({ ...definition })),
);

export function evaluateReleaseGates(options = {}) {
  const env = normalizeEnv(options.env || {});
  const evidence = isObject(options.evidence) ? options.evidence : {};
  const scope = normalizeScope(options.scope || options.evidenceScope || evidence.scope || LOCAL_CANDIDATE_SCOPE);
  const now = isoTimestamp(options.now);
  const context = {
    env,
    evidence,
    scope,
    now,
    packagedFallback: normalizePackagedFallback(options.packagedFallback, evidence.packagedFallback, env),
  };

  const gates = RELEASE_GATE_DEFINITIONS.map((definition) => evaluateGate(definition, context));
  const total = gates.length;
  const passed = gates.filter((gate) => gate.status === 'passed').length;
  const candidate = gates.filter((gate) => gate.status === 'candidate').length;
  const missing = gates.filter((gate) => gate.status === 'missing').length;
  const failed = gates.filter((gate) => gate.status === 'failed').length;
  const candidateSatisfied = gates.filter((gate) => gate.status === 'passed' || gate.status === 'candidate').length;
  const blockers = gates.filter((gate) => gate.blocking === true);
  const finalReady = failed === 0 && missing === 0 && candidate === 0 && passed === total;
  const candidateReady = failed === 0 && missing === 0 && candidateSatisfied === total && !finalReady;
  const gateState = finalReady ? 'release-ready' : (candidateReady ? 'candidate-for-review' : 'held');
  const firstBlocker = blockers[0] || null;

  const candidateMovement = {
    allowed: failed === 0 && missing === 0 && candidateSatisfied === total,
    state: failed === 0 && missing === 0 && candidateSatisfied === total
      ? (finalReady ? 'release-ready' : 'candidate-for-review')
      : 'held',
    gates: `${candidateSatisfied}/${total}`,
    missingEvidence: gateSummaries(gates.filter((gate) => gate.status === 'missing' || gate.status === 'failed')),
  };

  const releaseMovement = {
    allowed: finalReady,
    state: gateState,
    gates: finalReady ? `${total}/${total}` : (candidateReady ? 'candidate-for-review' : `${passed}/${total}`),
    finalGates: `${passed}/${total}`,
    candidateGates: `${candidateSatisfied}/${total}`,
    reason: finalReady
      ? 'all release gates are backed by final release evidence'
      : holdReason(firstBlocker, candidateReady),
    missingEvidence: gateSummaries(gates.filter((gate) => gate.status !== 'passed')),
  };

  return deepFreeze({
    schemaVersion: 1,
    evaluator: 'reprint-push-release-gates',
    generatedAt: now,
    status: gateState,
    gateState,
    scope,
    totals: {
      gates: total,
      passed,
      candidate,
      missing,
      failed,
      blocking: blockers.length,
    },
    candidateMovement,
    releaseMovement,
    gates,
  });
}

export function formatReleaseGateStatusMarker(evaluation, options = {}) {
  const label = sanitizeMarkerToken(options.label || 'release-gates');
  const releaseMovement = evaluation?.releaseMovement || {};
  const state = sanitizeMarkerToken(releaseMovement.state || evaluation?.gateState || 'held');
  const finalGates = sanitizeMarkerToken(releaseMovement.finalGates || releaseMovement.gates || '0/0');
  const candidateGates = sanitizeMarkerToken(releaseMovement.candidateGates || '0/0');
  const reason = sanitizeMarkerToken(firstReleaseGateReason(evaluation) || releaseMovement.reason || 'unknown');
  return `[${label}:${state} final=${finalGates} candidate=${candidateGates} reason=${reason}]`;
}

export function releaseGateSummary(evaluation) {
  return deepFreeze({
    status: evaluation?.gateState || 'held',
    releaseMovement: evaluation?.releaseMovement || null,
    candidateMovement: evaluation?.candidateMovement || null,
    totals: evaluation?.totals || null,
    missingEvidence: evaluation?.releaseMovement?.missingEvidence || [],
  });
}

function evaluateGate(definition, context) {
  switch (definition.id) {
    case 'source-url':
      return evaluateSourceUrlGate(definition, context);
    case 'local-url':
      return evaluateRequiredUrlGate(definition, context, {
        envKey: 'REPRINT_PUSH_LOCAL_URL',
        evidenceKey: 'localUrl',
        missingCode: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
        missingObserved: 'missing-local-edited-site',
        missingReason: 'REPRINT_PUSH_LOCAL_URL is required to prove the local edited site boundary.',
      });
    case 'remote-changed-url':
      return evaluateRequiredUrlGate(definition, context, {
        envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
        evidenceKey: 'remoteChangedUrl',
        missingCode: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
        missingObserved: 'missing-remote-changed-source',
        missingReason: 'REPRINT_PUSH_REMOTE_CHANGED_URL is required to prove stale remote replay fails before mutation.',
      });
    case 'packaged-fallback':
      return evaluatePackagedFallbackGate(definition, context);
    case 'remote-alias':
      return evaluateRemoteAliasGate(definition, context);
    case 'auth-source-readback':
      return evaluateAuthSourceReadbackGate(definition, context);
    case 'production-secret':
      return evaluateProductionSecretGate(definition, context);
    case 'application-password-binding':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        failureCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        okFields: ['ok', 'bound', 'sameSource'],
        missingReason: 'Application Password credential binding must be proven against the checked source identity.',
        failureReason: 'Application Password credential binding drifted from the checked source identity.',
      });
    case 'manage-options-capability':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        failureCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        okFields: ['ok', 'hasManageOptions'],
        missingReason: 'manage_options capability proof is required for the checked production user.',
        failureReason: 'The checked production user does not prove manage_options capability.',
      });
    case 'same-source-identity':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'SAME_SOURCE_IDENTITY_REQUIRED',
        failureCode: 'SAME_SOURCE_IDENTITY_REQUIRED',
        okFields: ['ok', 'same', 'sameSource'],
        missingReason: 'Same source URL identity proof is required across preflight, dry-run, apply, journal, and recovery.',
        failureReason: 'Source URL identity drifted across the checked release path.',
      });
    case 'preflight-route-identity':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        failureCode: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        okFields: ['ok', 'sameRoute'],
        missingReason: 'Preflight route identity proof is required before release movement.',
        failureReason: 'Preflight route identity proof failed.',
      });
    case 'dry-run-route-eligibility':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        failureCode: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        okFields: ['ok', 'eligible'],
        missingReason: 'Dry-run route eligibility proof is required before release movement.',
        failureReason: 'Dry-run route eligibility proof failed.',
      });
    case 'apply-route-pre-mutation':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        failureCode: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        okFields: ['ok', 'preMutation'],
        missingReason: 'Apply route pre-mutation rejection proof is required before release movement.',
        failureReason: 'Apply route pre-mutation proof failed or mutated before rejection.',
      });
    case 'journal-route-read-only':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        failureCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        okFields: ['ok', 'readOnly'],
        missingReason: 'Journal route read-only proof is required before release movement.',
        failureReason: 'Journal route was not proven read-only.',
      });
    case 'recovery-inspect-read-only':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        failureCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        okFields: ['ok', 'readOnly'],
        missingReason: 'Recovery inspect read-only proof is required before release movement.',
        failureReason: 'Recovery inspect route was not proven read-only.',
      });
    case 'release-movement-summary':
      return satisfiedGate(definition, context, {
        producedBy: 'evaluateReleaseGates',
        schemaVersion: 1,
        observed: 'releaseMovement summary will be emitted with this evaluation',
      });
    case 'tmux-status-marker':
      return evaluateStatusMarkerGate(definition, context);
    case 'progress-release-timestamp':
      return evaluateTimestampGate(definition, context);
    case 'agents-release-gates-row':
      return evaluateBooleanEvidenceGate(definition, context, {
        missingCode: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
        failureCode: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
        okFields: ['ok', 'present'],
        missingReason: '.agents/RELEASE_GATES.md status row evidence is required before release movement.',
        failureReason: '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
      });
    case 'verify-release-failure-reason':
      return evaluateVerifyReleaseFailureGate(definition, context);
    default:
      return missingGate(definition, context, {
        code: 'UNKNOWN_RELEASE_GATE',
        reason: `No evaluator is registered for release gate ${definition.id}.`,
        evidence: {
          required: definition.requiredEvidence,
          observed: 'missing-evaluator',
          scope: 'missing',
        },
      });
  }
}

function evaluateSourceUrlGate(definition, context) {
  const observed = firstNonEmpty(
    context.env.REPRINT_PUSH_SOURCE_URL,
    evidenceValue(context.evidence.sourceUrl, 'observed'),
    evidenceValue(context.evidence.sourceUrl, 'url'),
  );
  if (!observed) {
    return missingGate(definition, context, {
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      reason: 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.',
      evidence: {
        required: 'REPRINT_PUSH_SOURCE_URL',
        observed: 'missing-live-source',
        envKey: 'REPRINT_PUSH_SOURCE_URL',
        scope: 'missing',
      },
    });
  }
  const normalizedUrl = normalizeUrl(observed);
  if (!normalizedUrl) {
    return failedGate(definition, context, {
      code: 'REPRINT_PUSH_SOURCE_URL_INVALID',
      reason: 'REPRINT_PUSH_SOURCE_URL must be an absolute http(s) URL for release movement.',
      evidence: {
        required: 'absolute http(s) REPRINT_PUSH_SOURCE_URL',
        observed,
        envKey: 'REPRINT_PUSH_SOURCE_URL',
        scope: context.scope,
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: 'REPRINT_PUSH_SOURCE_URL',
    observed,
    normalizedUrl,
    envKey: 'REPRINT_PUSH_SOURCE_URL',
  });
}

function evaluateRequiredUrlGate(definition, context, config) {
  const observed = firstNonEmpty(
    context.env[config.envKey],
    evidenceValue(context.evidence[config.evidenceKey], 'observed'),
    evidenceValue(context.evidence[config.evidenceKey], 'url'),
  );
  if (!observed) {
    return missingGate(definition, context, {
      code: config.missingCode,
      reason: config.missingReason,
      evidence: {
        required: config.envKey,
        observed: config.missingObserved,
        envKey: config.envKey,
        scope: 'missing',
      },
    });
  }
  const normalizedUrl = normalizeUrl(observed);
  if (!normalizedUrl) {
    return failedGate(definition, context, {
      code: `${config.missingCode.replace(/_REQUIRED$/, '')}_INVALID`,
      reason: `${config.envKey} must be an absolute http(s) URL for release movement.`,
      evidence: {
        required: `absolute http(s) ${config.envKey}`,
        observed,
        envKey: config.envKey,
        scope: context.scope,
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: config.envKey,
    observed,
    normalizedUrl,
    envKey: config.envKey,
  });
}

function evaluatePackagedFallbackGate(definition, context) {
  if (context.packagedFallback.observed === true) {
    return failedGate(definition, context, {
      code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
      reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
      evidence: {
        required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
        observed: context.packagedFallback.reason || 'packaged-production-plugin-fallback',
        scope: context.scope,
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: 'non-packaged release boundary',
    observed: 'not-packaged-production-plugin-fallback',
    source: context.packagedFallback.source,
  });
}

function evaluateRemoteAliasGate(definition, context) {
  const sourceUrl = firstNonEmpty(
    context.env.REPRINT_PUSH_SOURCE_URL,
    evidenceValue(context.evidence.sourceUrl, 'observed'),
    evidenceValue(context.evidence.sourceUrl, 'url'),
  );
  const remoteAliasUrl = firstNonEmpty(
    context.env.REPRINT_PUSH_REMOTE_URL,
    evidenceValue(context.evidence.remoteAlias, 'observed'),
    evidenceValue(context.evidence.remoteAlias, 'url'),
  );

  if (remoteAliasUrl && !sourceUrl) {
    return missingGate(definition, context, {
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      reason: 'REPRINT_PUSH_SOURCE_URL is required before REPRINT_PUSH_REMOTE_URL can be accepted as an alias.',
      evidence: {
        required: 'REPRINT_PUSH_SOURCE_URL matching REPRINT_PUSH_REMOTE_URL',
        observed: {
          sourceUrl: 'missing-live-source',
          remoteAliasUrl,
        },
        scope: 'missing',
      },
    });
  }

  if (remoteAliasUrl && sourceUrl && !sameReleaseTopologyUrl(sourceUrl, remoteAliasUrl)) {
    return failedGate(definition, context, {
      code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
      reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
      evidence: {
        required: sourceUrl,
        observed: remoteAliasUrl,
        envKey: 'REPRINT_PUSH_REMOTE_URL',
        sourceEnvKey: 'REPRINT_PUSH_SOURCE_URL',
        scope: context.scope,
      },
    });
  }

  return satisfiedGate(definition, context, {
    required: 'REPRINT_PUSH_REMOTE_URL absent or same as REPRINT_PUSH_SOURCE_URL',
    observed: remoteAliasUrl || 'not-configured',
    sourceUrl: sourceUrl || '',
  });
}

function evaluateAuthSourceReadbackGate(definition, context) {
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  if (!evidence) {
    return missingGate(definition, context, {
      code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      reason: 'Auth source command readback must prove the same live source URL used at issuance and readback.',
      evidence: missingEvidence(definition),
    });
  }

  const issued = firstNonEmpty(evidence.issuedSourceUrl, evidence.sourceUrl, evidence.requiredSourceUrl);
  const readback = firstNonEmpty(evidence.readbackSourceUrl, evidence.observedSourceUrl, evidence.observed);
  const explicitOk = booleanField(evidence, ['ok', 'same', 'sameSource']);
  const same = issued && readback ? sameReleaseTopologyUrl(issued, readback) : explicitOk === true;
  if (explicitOk === false || same === false) {
    return failedGate(definition, context, {
      code: evidence.code || 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      reason: evidence.reason || 'Auth source command readback drifted from the checked live source URL.',
      evidence: {
        required: issued || evidence.required || 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
        observed: readback || evidence.observed || 'mismatched-production-auth-session-source',
        issuedSourceUrl: issued || '',
        readbackSourceUrl: readback || '',
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }

  if (same !== true && explicitOk !== true) {
    return missingGate(definition, context, {
      code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      reason: 'Auth source command readback evidence is incomplete.',
      evidence: missingEvidence(definition, evidence),
    });
  }

  return satisfiedGate(definition, context, {
    required: 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
    observed: readback || issued || evidence.observed || 'same-source-readback',
    issuedSourceUrl: issued || '',
    readbackSourceUrl: readback || '',
    command: evidence.command || '',
    scope: evidence.scope,
  });
}

function evaluateProductionSecretGate(definition, context) {
  const sourceUrl = firstNonEmpty(context.env.REPRINT_PUSH_SOURCE_URL, evidenceValue(context.evidence.sourceUrl, 'observed'));
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  const username = firstNonEmpty(context.env.REPRINT_PUSH_USERNAME, context.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER);
  const applicationPassword = firstNonEmpty(
    context.env.REPRINT_PUSH_APPLICATION_PASSWORD,
    context.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD,
  );
  const authSourceCommand = firstNonEmpty(context.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND);
  const hasEnvCredential = Boolean((username && applicationPassword) || authSourceCommand);
  const evidenceOk = evidence ? booleanField(evidence, ['ok', 'present', 'bound']) : null;

  if (sourceUrl && !hasEnvCredential && evidenceOk !== true) {
    return failedGate(definition, context, {
      code: 'REPRINT_PUSH_SECRET_REQUIRED',
      reason: 'A live source URL is present but production credentials or an auth session source command are missing.',
      evidence: {
        required: [
          'REPRINT_PUSH_USERNAME + REPRINT_PUSH_APPLICATION_PASSWORD',
          'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
        ],
        observed: 'missing-production-credentials',
        sourceUrl,
        scope: evidence?.scope || context.scope,
      },
    });
  }

  if (!hasEnvCredential && evidenceOk !== true) {
    return missingGate(definition, context, {
      code: 'REPRINT_PUSH_SECRET_REQUIRED',
      reason: 'Production credential evidence is required before release movement.',
      evidence: missingEvidence(definition, evidence),
    });
  }

  if (evidenceOk === false) {
    return failedGate(definition, context, {
      code: evidence.code || 'REPRINT_PUSH_SECRET_REQUIRED',
      reason: evidence.reason || 'Production credential evidence failed.',
      evidence: {
        ...evidence,
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }

  return satisfiedGate(definition, context, {
    required: 'production credential or auth session source command',
    observed: authSourceCommand ? 'auth-session-source-command' : 'production-credential-present',
    username: username ? 'configured' : '',
    applicationPassword: applicationPassword ? 'configured' : '',
    authSessionSourceCommand: authSourceCommand ? 'configured' : '',
    scope: evidence?.scope,
  });
}

function evaluateBooleanEvidenceGate(definition, context, config) {
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  if (!evidence) {
    return missingGate(definition, context, {
      code: config.missingCode,
      reason: config.missingReason,
      evidence: missingEvidence(definition),
    });
  }
  const ok = booleanField(evidence, config.okFields);
  if (ok !== true) {
    return failedGate(definition, context, {
      code: evidence.code || config.failureCode,
      reason: evidence.reason || config.failureReason,
      evidence: {
        ...evidence,
        required: evidence.required || definition.requiredEvidence,
        observed: evidence.observed || (ok === false ? 'failed' : 'incomplete'),
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }
  return satisfiedGate(definition, context, {
    ...evidence,
    required: evidence.required || definition.requiredEvidence,
    observed: evidence.observed || 'proven',
    scope: evidence.scope,
  });
}

function evaluateStatusMarkerGate(definition, context) {
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  if (!evidence) {
    return missingGate(definition, context, {
      code: 'TMUX_STATUS_MARKER_REQUIRED',
      reason: 'A final bracketed stdout status marker is required for tmux-visible release gate proof.',
      evidence: missingEvidence(definition),
    });
  }
  const marker = firstNonEmpty(evidence.marker, evidence.observed);
  const ok = booleanField(evidence, ['ok', 'present']);
  if (ok === false || !isBracketedStatusMarker(marker)) {
    return failedGate(definition, context, {
      code: evidence.code || 'TMUX_STATUS_MARKER_REQUIRED',
      reason: evidence.reason || 'The tmux stdout status marker is missing or not bracketed.',
      evidence: {
        required: 'final bracketed stdout status marker',
        observed: marker || 'missing-status-marker',
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: 'final bracketed stdout status marker',
    observed: marker,
    scope: evidence.scope,
  });
}

function evaluateTimestampGate(definition, context) {
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  if (!evidence) {
    return missingGate(definition, context, {
      code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      reason: 'A release timestamp tied to current evidence is required before release movement.',
      evidence: missingEvidence(definition),
    });
  }
  const timestamp = firstNonEmpty(evidence.iso, evidence.timestamp, evidence.observed);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return failedGate(definition, context, {
      code: evidence.code || 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      reason: evidence.reason || 'Release timestamp evidence must be an ISO-parseable timestamp.',
      evidence: {
        required: 'ISO-parseable release timestamp',
        observed: timestamp || 'missing-release-timestamp',
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: 'ISO-parseable release timestamp',
    observed: timestamp,
    scope: evidence.scope,
  });
}

function evaluateVerifyReleaseFailureGate(definition, context) {
  const evidence = evidenceObject(context.evidence[definition.evidenceKey]);
  if (!evidence) {
    return missingGate(definition, context, {
      code: 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
      reason: 'verify:release must prove nonzero failures include a named reason before release movement.',
      evidence: missingEvidence(definition),
    });
  }
  const exitCode = numberField(evidence, ['exitCode', 'status']);
  const reason = firstNonEmpty(evidence.reason, evidence.code, evidence.observed);
  const ok = booleanField(evidence, ['ok', 'present']);
  if (ok === false || !Number.isInteger(exitCode) || exitCode === 0 || !reason) {
    return failedGate(definition, context, {
      code: evidence.code || 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
      reason: evidence.reason || 'verify:release nonzero failure evidence must include a nonzero exit code and named reason.',
      evidence: {
        required: 'nonzero verify:release exit with named reason',
        observed: {
          exitCode: Number.isInteger(exitCode) ? exitCode : 'missing-exit-code',
          reason: reason || 'missing-failure-reason',
        },
        scope: normalizeScope(evidence.scope || context.scope),
      },
    });
  }
  return satisfiedGate(definition, context, {
    required: 'nonzero verify:release exit with named reason',
    observed: reason,
    exitCode,
    scope: evidence.scope,
  });
}

function satisfiedGate(definition, context, evidence) {
  const scope = normalizeScope(evidence.scope || context.scope);
  const status = scope === FINAL_RELEASE_SCOPE ? 'passed' : 'candidate';
  return gateResult(definition, {
    status,
    blocking: status !== 'passed',
    code: status === 'passed' ? 'OK' : 'LOCAL_CANDIDATE_EVIDENCE_ONLY',
    reason: status === 'passed'
      ? `${definition.title} is backed by final release evidence.`
      : `${definition.title} has local candidate evidence only; final release evidence is still required.`,
    evidence: {
      ...stripUndefined(evidence),
      scope,
      requiredScope: FINAL_RELEASE_SCOPE,
    },
  });
}

function missingGate(definition, context, { code, reason, evidence }) {
  return gateResult(definition, {
    status: 'missing',
    blocking: true,
    code,
    reason,
    evidence: normalizeGateEvidence(evidence, context, 'missing'),
  });
}

function failedGate(definition, context, { code, reason, evidence }) {
  return gateResult(definition, {
    status: 'failed',
    blocking: true,
    code,
    reason,
    evidence: normalizeGateEvidence(evidence, context, context.scope),
  });
}

function gateResult(definition, result) {
  return deepFreeze({
    id: definition.id,
    rpp: definition.rpp,
    title: definition.title,
    category: definition.category,
    status: result.status,
    blocking: result.blocking,
    code: result.code,
    reason: result.reason,
    evidence: result.evidence,
  });
}

function normalizeGateEvidence(evidence, context, fallbackScope) {
  if (!isObject(evidence)) {
    return {
      required: evidence || 'release gate evidence',
      observed: 'missing-evidence',
      scope: fallbackScope,
    };
  }
  return stripUndefined({
    ...evidence,
    scope: normalizeScope(evidence.scope || fallbackScope || context.scope),
  });
}

function missingEvidence(definition, observed = null) {
  return stripUndefined({
    required: definition.requiredEvidence,
    observed: observed || 'missing-evidence',
    evidenceKey: definition.evidenceKey,
    scope: 'missing',
  });
}

function gateSummaries(gates) {
  return gates.map((gate) => ({
    id: gate.id,
    rpp: gate.rpp,
    status: gate.status,
    code: gate.code,
    reason: gate.reason,
    evidence: gate.evidence,
  }));
}

function holdReason(firstBlocker, candidateReady) {
  if (candidateReady) {
    return 'local candidate evidence is complete, but final release evidence is still required; release hold remains fail-closed';
  }
  return firstBlocker?.reason || 'release gates are held until every required evidence item passes';
}

function firstReleaseGateReason(evaluation) {
  const missing = evaluation?.releaseMovement?.missingEvidence;
  if (Array.isArray(missing) && missing.length > 0) {
    return missing[0].code || missing[0].reason;
  }
  return evaluation?.releaseMovement?.reason || '';
}

function normalizeEnv(env) {
  const normalized = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (value === undefined || value === null) {
      continue;
    }
    normalized[key] = typeof value === 'string' ? value.trim() : String(value).trim();
  }
  return normalized;
}

function normalizePackagedFallback(optionValue, evidenceValueForGate, env) {
  const evidence = evidenceObject(evidenceValueForGate);
  if (optionValue === true || evidence?.observed === true || evidence?.ok === false) {
    return {
      observed: true,
      source: optionValue === true ? 'options.packagedFallback' : 'evidence.packagedFallback',
      reason: evidence?.reason || evidence?.observedReason || 'packaged-production-plugin-fallback',
    };
  }
  const envFlag = firstNonEmpty(
    env.REPRINT_PUSH_PACKAGED_FALLBACK,
    env.REPRINT_PUSH_PACKAGE_FALLBACK,
    env.REPRINT_PUSH_PACKAGE_SMOKE_MODE,
  );
  if (/^(1|true|yes|packaged|driver-guard-only)$/i.test(envFlag)) {
    return {
      observed: true,
      source: 'environment',
      reason: 'packaged-production-plugin-fallback',
    };
  }
  return {
    observed: false,
    source: evidence ? 'evidence.packagedFallback' : 'default-fail-closed-context',
    reason: '',
  };
}

function evidenceObject(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return { ok: value, observed: value };
  }
  if (typeof value === 'string') {
    return { observed: value };
  }
  if (isObject(value)) {
    return value;
  }
  return { observed: value };
}

function evidenceValue(value, key) {
  const evidence = evidenceObject(value);
  if (!evidence) {
    return '';
  }
  return firstNonEmpty(evidence[key]);
}

function booleanField(object, fields) {
  for (const field of fields) {
    if (typeof object[field] === 'boolean') {
      return object[field];
    }
  }
  if (typeof object.verdict === 'string') {
    if (/(_OK|PROVEN|PASSED|BOUND|ELIGIBLE)$/i.test(object.verdict)) {
      return true;
    }
    if (/(REQUIRED|FAILED|MISMATCH|REJECTED|DRIFT)/i.test(object.verdict)) {
      return false;
    }
  }
  return null;
}

function numberField(object, fields) {
  for (const field of fields) {
    if (Number.isInteger(object[field])) {
      return object[field];
    }
    if (typeof object[field] === 'string' && object[field].trim() !== '') {
      const parsed = Number.parseInt(object[field], 10);
      if (Number.isInteger(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') {
        return trimmed;
      }
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
  }
  return '';
}

function sameReleaseTopologyUrl(left, right) {
  const normalizedLeft = normalizeUrl(left);
  const normalizedRight = normalizeUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.pathname = pathname;
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeScope(scope) {
  if (scope === FINAL_RELEASE_SCOPE || scope === 'final' || scope === 'live-release') {
    return FINAL_RELEASE_SCOPE;
  }
  if (scope === LOCAL_CANDIDATE_SCOPE || scope === 'candidate' || scope === 'local') {
    return LOCAL_CANDIDATE_SCOPE;
  }
  if (scope === 'missing') {
    return 'missing';
  }
  return UNKNOWN_SCOPE;
}

function isoTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function isBracketedStatusMarker(marker) {
  return typeof marker === 'string' && /^\[[^\]]+\]$/.test(marker.trim());
}

function sanitizeMarkerToken(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^A-Za-z0-9_./:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function stripUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!isObject(value) && !Array.isArray(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if ((isObject(child) || Array.isArray(child)) && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}
