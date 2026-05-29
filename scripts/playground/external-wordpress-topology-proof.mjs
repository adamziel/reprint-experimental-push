#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { digest } from '../../src/stable-json.js';

export const externalWordPressTopologyEvent = 'external-wordpress-topology-proof';
export const externalWordPressTopologyVariant = 'RPP-0803-variant-1';
export const externalWordPressTopologyRuntime = 'external-wordpress';
export const externalWordPressTopologyGate = 'GATE-3';
export const externalWordPressTopologyCommand = 'node scripts/playground/external-wordpress-topology-proof.mjs';

export const requiredExternalTopologyUrlRoles = Object.freeze([
  Object.freeze({ role: 'source', label: 'source', envKey: 'REPRINT_PUSH_SOURCE_URL', missingCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED' }),
  Object.freeze({ role: 'localEdited', label: 'local edited', envKey: 'REPRINT_PUSH_LOCAL_URL', missingCode: 'REPRINT_PUSH_LOCAL_URL_REQUIRED' }),
  Object.freeze({ role: 'remoteChanged', label: 'remote changed', envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL', missingCode: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED' }),
]);

export const optionalExternalTopologyUrlRoles = Object.freeze([
  Object.freeze({ role: 'remoteAlias', label: 'remote alias', envKey: 'REPRINT_PUSH_REMOTE_URL' }),
  Object.freeze({ role: 'applyRevalidationSource', label: 'apply revalidation source', envKey: 'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL' }),
]);

export const externalTopologyRouteSourceEnv = Object.freeze({
  preflight: Object.freeze(['REPRINT_PUSH_PREFLIGHT_SOURCE_URL', 'REPRINT_PUSH_PREFLIGHT_ROUTE_SOURCE_URL']),
  dryRun: Object.freeze(['REPRINT_PUSH_DRY_RUN_SOURCE_URL', 'REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL', 'REPRINT_PUSH_DRYRUN_SOURCE_URL']),
  apply: Object.freeze(['REPRINT_PUSH_APPLY_SOURCE_URL', 'REPRINT_PUSH_APPLY_ROUTE_SOURCE_URL']),
  journal: Object.freeze(['REPRINT_PUSH_JOURNAL_SOURCE_URL', 'REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL']),
  recovery: Object.freeze(['REPRINT_PUSH_RECOVERY_SOURCE_URL', 'REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL', 'REPRINT_PUSH_RECOVERY_INSPECT_ROUTE_SOURCE_URL']),
});

export const forbiddenPackagedFallbackEnvKeys = Object.freeze([
  'REPRINT_PUSH_PACKAGED_FALLBACK',
  'REPRINT_PUSH_PACKAGE_FALLBACK',
  'REPRINT_PUSH_PACKAGE_SMOKE_MODE',
]);

export const forbiddenTunnelHostRules = Object.freeze([
  Object.freeze({ label: 'ngrok', suffixes: Object.freeze(['ngrok.io', 'ngrok-free.app', 'ngrok.app']) }),
  Object.freeze({ label: 'cloudflared tunnel', suffixes: Object.freeze(['trycloudflare.com']) }),
  Object.freeze({ label: 'localtunnel', suffixes: Object.freeze(['loca.lt', 'localtunnel.me']) }),
  Object.freeze({ label: 'serveo', suffixes: Object.freeze(['serveo.net']) }),
  Object.freeze({ label: 'localhost.run', suffixes: Object.freeze(['localhost.run']) }),
  Object.freeze({ label: 'lhr.life', suffixes: Object.freeze(['lhr.life']) }),
  Object.freeze({ label: 'tailscale funnel', suffixes: Object.freeze(['ts.net']) }),
]);

export function collectExternalWordPressTopologyProof({
  env = process.env,
  now = new Date(),
  scope = 'local-candidate',
} = {}) {
  const checkedAt = isoTimestamp(now);
  const capture = captureExternalTopologyUrls(env);
  const validation = validateExternalTopologyCapture(capture, env);
  const evidenceScope = validation.ok ? normalizeEvidenceScope(scope) : 'missing';
  const evidence = buildExternalTopologyEvidence({ capture, validation, scope: evidenceScope });
  const statusMarker = validation.ok
    ? '[RPP-0803-EXTERNAL-WORDPRESS:TOPOLOGY-OK]'
    : '[RPP-0803-EXTERNAL-WORDPRESS:FAIL-CLOSED]';

  return {
    schemaVersion: 1,
    event: externalWordPressTopologyEvent,
    topologyVariant: externalWordPressTopologyVariant,
    gate: externalWordPressTopologyGate,
    runtime: externalWordPressTopologyRuntime,
    checkedAt,
    ok: validation.ok,
    status: validation.ok ? 'captured-and-identity-checked' : 'blocked',
    failClosed: validation.ok !== true,
    exitCode: validation.ok ? 0 : 2,
    scope: evidenceScope,
    statusMarker,
    command: externalWordPressTopologyCommand,
    constraints: {
      networkProbePerformed: false,
      reason: 'RPP-0803 variant 1 validates operator-supplied external WordPress topology URLs locally without opening sockets.',
      sandboxIngressPort: 8080,
      localLoopbackIngressRule: 'loopback URLs are accepted only on the sandbox-provided 8080 ingress',
      tunnelsProhibited: true,
      packagedFallbackAllowed: false,
    },
    urlCapture: capture.urlCapture,
    routeSourceCapture: capture.routeSourceCapture,
    credentialConfig: captureCredentialConfig(env),
    topology: buildTopologySummary(capture, validation),
    identityChecks: validation.identityChecks,
    failures: validation.failures,
    evidence,
    rppEvidence: {
      item: 'RPP-0803',
      variant: externalWordPressTopologyVariant,
      successCriterion: 'source/local/changed URLs are captured and identity-checked',
      sourceLocalChangedUrlsCaptured: capture.requiredProvided,
      identityChecked: validation.identityChecks.sourceLocalChangedUrlsDistinct.ok
        && validation.identityChecks.sameSourceAcrossRoutes.ok
        && validation.identityChecks.remoteAliasMatchesSource.ok,
      noNetworkProbe: true,
      noTunnelPolicyEnforced: validation.identityChecks.noTunnelHosts.ok,
      readyForReleaseMovement: false,
      releaseHoldReason: 'This proves the external topology capture/identity contract only; live credentials, route receipts, and durable mutation proof remain separate gates.',
    },
  };
}

export function captureExternalTopologyUrls(env = process.env) {
  const roles = [...requiredExternalTopologyUrlRoles, ...optionalExternalTopologyUrlRoles];
  const urlCapture = Object.fromEntries(roles.map((definition) => [
    definition.role,
    captureUrlRole(definition, env[definition.envKey]),
  ]));
  const routeSourceCapture = captureRouteSourceUrls(env);
  const requiredProvided = requiredExternalTopologyUrlRoles.every((definition) => urlCapture[definition.role].provided);

  return {
    urlCapture,
    routeSourceCapture,
    requiredProvided,
  };
}

export function validateExternalTopologyCapture(capture, env = process.env) {
  const failures = [];
  const identityChecks = {
    requiredUrlsPresent: { ok: true, roles: [] },
    requiredUrlsValid: { ok: true, roles: [] },
    sourceLocalChangedUrlsDistinct: { ok: true, identities: {} },
    remoteAliasMatchesSource: { ok: true, observed: 'not-configured' },
    sameSourceAcrossRoutes: { ok: true, observed: 'same-source-url', routes: {} },
    noTunnelHosts: { ok: true, observed: 'no-forbidden-tunnel-hosts', hosts: [] },
    localLoopbackIngress: { ok: true, observed: 'no-loopback-url-outside-8080', roles: [] },
    noUrlSecrets: { ok: true, observed: 'no-userinfo-query-or-fragment', roles: [] },
    packagedFallbackDisabled: { ok: true, observed: 'packaged-fallback-env-absent' },
  };

  for (const definition of requiredExternalTopologyUrlRoles) {
    const captured = capture.urlCapture[definition.role];
    if (!captured?.provided) {
      identityChecks.requiredUrlsPresent.ok = false;
      identityChecks.requiredUrlsPresent.roles.push(definition.role);
      failures.push({
        code: definition.missingCode,
        role: definition.role,
        envKey: definition.envKey,
        reason: `${definition.envKey} is required for the external WordPress source/local/changed topology.`,
      });
      continue;
    }
    if (captured.valid !== true) {
      identityChecks.requiredUrlsValid.ok = false;
      identityChecks.requiredUrlsValid.roles.push(definition.role);
      failures.push({
        code: `${definition.envKey}_INVALID`,
        role: definition.role,
        envKey: definition.envKey,
        reason: captured.invalidReason || `${definition.envKey} must be an absolute http(s) URL.`,
      });
    }
  }

  for (const captured of [...Object.values(capture.urlCapture), ...Object.values(capture.routeSourceCapture)]) {
    if (!captured?.provided) {
      continue;
    }
    if (captured.valid && captured.forbiddenTunnel) {
      identityChecks.noTunnelHosts.ok = false;
      identityChecks.noTunnelHosts.hosts.push({ role: captured.role, host: captured.host, rule: captured.forbiddenTunnel });
      failures.push({
        code: 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED',
        role: captured.role,
        envKey: captured.envKey,
        reason: `${captured.envKey} points at a prohibited remote tunnel host (${captured.forbiddenTunnel}).`,
      });
    }
    if (captured.valid && captured.loopback && !captured.loopbackAllowed) {
      identityChecks.localLoopbackIngress.ok = false;
      identityChecks.localLoopbackIngress.roles.push({ role: captured.role, port: captured.port });
      failures.push({
        code: 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080',
        role: captured.role,
        envKey: captured.envKey,
        reason: `${captured.envKey} uses loopback but not the sandbox-provided 8080 ingress.`,
      });
    }
    if (captured.valid && (captured.hadUserInfo || captured.hadQuery || captured.hadFragment)) {
      identityChecks.noUrlSecrets.ok = false;
      identityChecks.noUrlSecrets.roles.push({
        role: captured.role,
        userInfo: captured.hadUserInfo,
        query: captured.hadQuery,
        fragment: captured.hadFragment,
      });
      failures.push({
        code: 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS',
        role: captured.role,
        envKey: captured.envKey,
        reason: `${captured.envKey} must not include URL userinfo, query strings, or fragments in release topology evidence.`,
      });
    }
  }

  const source = capture.urlCapture.source;
  const localEdited = capture.urlCapture.localEdited;
  const remoteChanged = capture.urlCapture.remoteChanged;
  const requiredIdentities = {
    source: source?.identityHash || '',
    localEdited: localEdited?.identityHash || '',
    remoteChanged: remoteChanged?.identityHash || '',
  };
  identityChecks.sourceLocalChangedUrlsDistinct.identities = requiredIdentities;
  if (source?.valid && localEdited?.valid && remoteChanged?.valid) {
    const unique = new Set([source.normalizedUrl, localEdited.normalizedUrl, remoteChanged.normalizedUrl]);
    if (unique.size !== 3) {
      identityChecks.sourceLocalChangedUrlsDistinct.ok = false;
      failures.push({
        code: 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT',
        reason: 'REPRINT_PUSH_SOURCE_URL, REPRINT_PUSH_LOCAL_URL, and REPRINT_PUSH_REMOTE_CHANGED_URL must identify three distinct WordPress surfaces.',
        identities: requiredIdentities,
      });
    }
  }

  const remoteAlias = capture.urlCapture.remoteAlias;
  if (remoteAlias?.provided && remoteAlias.valid && source?.valid) {
    const same = remoteAlias.normalizedUrl === source.normalizedUrl;
    identityChecks.remoteAliasMatchesSource.ok = same;
    identityChecks.remoteAliasMatchesSource.observed = same ? 'same-as-source' : 'remote-alias-mismatch';
    identityChecks.remoteAliasMatchesSource.sourceIdentityHash = source.identityHash;
    identityChecks.remoteAliasMatchesSource.remoteAliasIdentityHash = remoteAlias.identityHash;
    if (!same) {
      failures.push({
        code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        envKey: 'REPRINT_PUSH_REMOTE_URL',
        reason: 'REPRINT_PUSH_REMOTE_URL must be absent or normalize to the same source URL identity as REPRINT_PUSH_SOURCE_URL.',
        sourceIdentityHash: source.identityHash,
        remoteAliasIdentityHash: remoteAlias.identityHash,
      });
    }
  }

  if (source?.valid) {
    for (const [route, captured] of Object.entries(capture.routeSourceCapture)) {
      if (!captured.provided) {
        identityChecks.sameSourceAcrossRoutes.routes[route] = {
          configured: false,
          sameSource: true,
          sourceIdentityHash: source.identityHash,
        };
        continue;
      }
      const same = captured.valid && captured.normalizedUrl === source.normalizedUrl;
      identityChecks.sameSourceAcrossRoutes.routes[route] = {
        configured: true,
        sameSource: same,
        sourceIdentityHash: source.identityHash,
        routeIdentityHash: captured.identityHash || '',
        envKey: captured.envKey,
      };
      if (!same) {
        identityChecks.sameSourceAcrossRoutes.ok = false;
        identityChecks.sameSourceAcrossRoutes.observed = `${route}-source-url-mismatch`;
        failures.push({
          code: 'SAME_SOURCE_IDENTITY_REQUIRED',
          route,
          envKey: captured.envKey,
          reason: `${captured.envKey} must normalize to the same source URL identity as REPRINT_PUSH_SOURCE_URL.`,
          sourceIdentityHash: source.identityHash,
          routeIdentityHash: captured.identityHash || '',
        });
      }
    }
  }

  for (const key of forbiddenPackagedFallbackEnvKeys) {
    const value = String(env[key] || '').trim();
    if (/^(1|true|yes|packaged|driver-guard-only)$/i.test(value)) {
      identityChecks.packagedFallbackDisabled.ok = false;
      identityChecks.packagedFallbackDisabled.observed = key;
      failures.push({
        code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
        envKey: key,
        reason: `${key} enables packaged fallback evidence, which is not accepted for external WordPress topology proof.`,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    identityChecks,
  };
}

export function buildExternalTopologyEvidence({ capture, validation, scope = 'local-candidate' } = {}) {
  const source = capture?.urlCapture?.source || emptyCapturedUrl('source', 'REPRINT_PUSH_SOURCE_URL');
  const localEdited = capture?.urlCapture?.localEdited || emptyCapturedUrl('localEdited', 'REPRINT_PUSH_LOCAL_URL');
  const remoteChanged = capture?.urlCapture?.remoteChanged || emptyCapturedUrl('remoteChanged', 'REPRINT_PUSH_REMOTE_CHANGED_URL');
  const remoteAlias = capture?.urlCapture?.remoteAlias || emptyCapturedUrl('remoteAlias', 'REPRINT_PUSH_REMOTE_URL');
  const evidenceScope = normalizeEvidenceScope(scope);
  const topologyOk = validation?.ok === true;
  const sourceIdentityOk = topologyOk
    && validation.identityChecks.sameSourceAcrossRoutes.ok === true
    && validation.identityChecks.remoteAliasMatchesSource.ok === true;

  return {
    schemaVersion: 1,
    producer: externalWordPressTopologyEvent,
    scope: evidenceScope,
    env: {},
    packagedFallback: {
      ok: validation?.identityChecks?.packagedFallbackDisabled?.ok === true,
      observed: validation?.identityChecks?.packagedFallbackDisabled?.ok === true ? false : true,
      source: externalWordPressTopologyEvent,
      scope: evidenceScope,
    },
    sourceUrl: urlGateEvidence(source, evidenceScope, 'REPRINT_PUSH_SOURCE_URL'),
    localUrl: urlGateEvidence(localEdited, evidenceScope, 'REPRINT_PUSH_LOCAL_URL'),
    remoteChangedUrl: urlGateEvidence(remoteChanged, evidenceScope, 'REPRINT_PUSH_REMOTE_CHANGED_URL'),
    remoteAlias: {
      ok: validation?.identityChecks?.remoteAliasMatchesSource?.ok === true,
      same: validation?.identityChecks?.remoteAliasMatchesSource?.ok === true,
      observed: remoteAlias.provided ? remoteAlias.normalizedUrl || 'invalid-remote-alias-url' : 'not-configured',
      url: remoteAlias.provided ? remoteAlias.normalizedUrl || '' : source.normalizedUrl || '',
      sourceIdentityHash: source.identityHash || '',
      remoteAliasIdentityHash: remoteAlias.identityHash || '',
      scope: evidenceScope,
    },
    sourceIdentity: {
      ok: sourceIdentityOk,
      same: sourceIdentityOk,
      sameSource: sourceIdentityOk,
      observed: sourceIdentityOk ? 'external-topology-same-source-url' : firstFailureCode(validation, 'SAME_SOURCE_IDENTITY_REQUIRED'),
      sourceUrl: source.normalizedUrl || '',
      localUrl: localEdited.normalizedUrl || '',
      remoteChangedUrl: remoteChanged.normalizedUrl || '',
      sourceIdentityHash: source.identityHash || '',
      localIdentityHash: localEdited.identityHash || '',
      remoteChangedIdentityHash: remoteChanged.identityHash || '',
      checkedRoutes: Object.keys(externalTopologyRouteSourceEnv),
      routeSourceIdentities: validation?.identityChecks?.sameSourceAcrossRoutes?.routes || {},
      required: ['preflight, dry-run, apply, journal, and recovery use the same source URL'],
      scope: evidenceScope,
    },
    externalWordPressTopology: {
      ok: topologyOk,
      topologyVariant: externalWordPressTopologyVariant,
      sourceLocalChangedUrlsCaptured: Boolean(capture?.requiredProvided),
      sourceLocalChangedUrlsDistinct: validation?.identityChecks?.sourceLocalChangedUrlsDistinct?.ok === true,
      noTunnelHosts: validation?.identityChecks?.noTunnelHosts?.ok === true,
      noUrlSecrets: validation?.identityChecks?.noUrlSecrets?.ok === true,
      localLoopbackIngress: validation?.identityChecks?.localLoopbackIngress?.ok === true,
      networkProbePerformed: false,
      failures: validation?.failures || [],
      scope: evidenceScope,
    },
    tmuxStatusMarker: {
      ok: true,
      marker: topologyOk
        ? '[RPP-0803-EXTERNAL-WORDPRESS:TOPOLOGY-OK]'
        : '[RPP-0803-EXTERNAL-WORDPRESS:FAIL-CLOSED]',
      scope: evidenceScope,
    },
  };
}

export function normalizeExternalTopologyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { valid: false, normalizedUrl: '', invalidReason: 'missing URL' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, normalizedUrl: '', invalidReason: 'URL must be absolute and parseable' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalizedUrl: '', invalidReason: 'URL protocol must be http or https' };
  }

  const hadUserInfo = parsed.username !== '' || parsed.password !== '';
  const hadQuery = parsed.search !== '';
  const hadFragment = parsed.hash !== '';
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  parsed.pathname = parsed.pathname.replace(/\/+$|^$/g, '') || '/';

  const normalizedUrl = parsed.toString();
  const origin = parsed.origin;
  const pathname = parsed.pathname;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const loopback = isLoopbackHost(parsed.hostname);
  const loopbackAllowed = !loopback || port === '8080';
  const forbiddenTunnel = forbiddenTunnelHostLabel(parsed.hostname);

  return {
    valid: true,
    normalizedUrl,
    origin,
    pathname,
    protocol: parsed.protocol.replace(/:$/, ''),
    host: parsed.host,
    hostname: parsed.hostname,
    port,
    loopback,
    loopbackAllowed,
    forbiddenTunnel,
    hadUserInfo,
    hadQuery,
    hadFragment,
    identityHash: digest({ normalizedUrl }),
    originHash: digest({ origin }),
  };
}

function captureUrlRole(definition, value) {
  const raw = String(value || '').trim();
  const normalized = normalizeExternalTopologyUrl(raw);
  if (!raw) {
    return emptyCapturedUrl(definition.role, definition.envKey, definition.label);
  }
  if (!normalized.valid) {
    return {
      role: definition.role,
      label: definition.label,
      envKey: definition.envKey,
      provided: true,
      valid: false,
      normalizedUrl: '',
      identityHash: '',
      originHash: '',
      invalidReason: normalized.invalidReason,
    };
  }

  return {
    role: definition.role,
    label: definition.label,
    envKey: definition.envKey,
    provided: true,
    valid: true,
    normalizedUrl: normalized.normalizedUrl,
    origin: normalized.origin,
    pathname: normalized.pathname,
    protocol: normalized.protocol,
    host: normalized.host,
    hostname: normalized.hostname,
    port: normalized.port,
    serviceKind: classifyExternalTopologyService(normalized),
    loopback: normalized.loopback,
    loopbackAllowed: normalized.loopbackAllowed,
    forbiddenTunnel: normalized.forbiddenTunnel,
    hadUserInfo: normalized.hadUserInfo,
    hadQuery: normalized.hadQuery,
    hadFragment: normalized.hadFragment,
    identityHash: normalized.identityHash,
    originHash: normalized.originHash,
  };
}

function emptyCapturedUrl(role, envKey, label = role) {
  return {
    role,
    label,
    envKey,
    provided: false,
    valid: false,
    normalizedUrl: '',
    identityHash: '',
    originHash: '',
    invalidReason: 'missing URL',
  };
}

function captureRouteSourceUrls(env) {
  const captured = {};
  for (const [route, envKeys] of Object.entries(externalTopologyRouteSourceEnv)) {
    const envKey = envKeys.find((key) => String(env[key] || '').trim()) || envKeys[0];
    captured[route] = captureUrlRole({
      role: `${route}Source`,
      label: `${route} source`,
      envKey,
    }, env[envKey]);
  }
  return captured;
}

function captureCredentialConfig(env) {
  return {
    usernamePresent: Boolean(env.REPRINT_PUSH_USERNAME || env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER),
    applicationPasswordPresent: Boolean(env.REPRINT_PUSH_APPLICATION_PASSWORD || env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD),
    authSessionSourceCommandPresent: Boolean(env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND),
    valuesRedacted: true,
  };
}

function buildTopologySummary(capture, validation) {
  const source = capture.urlCapture.source;
  const localEdited = capture.urlCapture.localEdited;
  const remoteChanged = capture.urlCapture.remoteChanged;
  return {
    sourceUrl: source.normalizedUrl || '',
    localEditedSite: localEdited.normalizedUrl || '',
    remoteChangedDriftSource: remoteChanged.normalizedUrl || '',
    sourceIdentityHash: source.identityHash || '',
    localIdentityHash: localEdited.identityHash || '',
    remoteChangedIdentityHash: remoteChanged.identityHash || '',
    sameRemoteIdentity: validation.identityChecks.sourceLocalChangedUrlsDistinct.ok === true ? 'identity-checked-by-distinct-url-roles' : false,
    sourceLocalChangedUrlsCaptured: capture.requiredProvided,
    identityChecked: validation.ok === true,
    noTunnelPolicy: 'enforced-by-static-url-validation',
  };
}

function urlGateEvidence(captured, scope, required) {
  return {
    ok: captured.provided === true && captured.valid === true,
    url: captured.normalizedUrl || '',
    observed: captured.normalizedUrl || (captured.provided ? 'invalid-url' : 'missing-url'),
    normalizedUrl: captured.normalizedUrl || '',
    identityHash: captured.identityHash || '',
    originHash: captured.originHash || '',
    required,
    envKey: captured.envKey,
    scope,
  };
}

function classifyExternalTopologyService(normalized) {
  if (normalized.forbiddenTunnel) {
    return 'forbidden-remote-tunnel';
  }
  if (normalized.loopback) {
    return normalized.loopbackAllowed ? 'sandbox-local-8080-wordpress' : 'loopback-outside-sandbox-8080';
  }
  return normalized.protocol === 'https' ? 'external-wordpress-https' : 'external-wordpress-http';
}

function forbiddenTunnelHostLabel(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  for (const rule of forbiddenTunnelHostRules) {
    if (rule.suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))) {
      return rule.label;
    }
  }
  return '';
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || normalized.startsWith('127.');
}

function firstFailureCode(validation, fallback) {
  return validation?.failures?.[0]?.code || fallback;
}

function normalizeEvidenceScope(scope) {
  if (scope === 'final-release' || scope === 'final' || scope === 'live-release') {
    return 'final-release';
  }
  if (scope === 'missing') {
    return 'missing';
  }
  return 'local-candidate';
}

function isoTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value || Date.now());
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function main() {
  const proof = collectExternalWordPressTopologyProof();
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${proof.statusMarker}\n`);
  process.exitCode = proof.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
