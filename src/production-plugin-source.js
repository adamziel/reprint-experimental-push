const routeProfiles = {
  'lab-authenticated': {
    name: 'lab-authenticated',
    namespace: 'reprint-push-lab/v1',
    routePrefix: '/authenticated',
    namespacePath: '/wp-json/reprint-push-lab/v1/authenticated',
    sourceMode: 'lab',
  },
  'production-shaped': {
    name: 'production-shaped',
    namespace: 'reprint/v1',
    routePrefix: '/push',
    namespacePath: '/wp-json/reprint/v1/push',
    sourceMode: 'packaged-production-plugin',
  },
};

export function resolveProductionPluginSource({
  requireProductionAuthSession = false,
  routeProfile = 'lab-authenticated',
} = {}) {
  const profile = resolveRouteProfile(routeProfile);
  const effectiveProfile = requireProductionAuthSession
    ? routeProfiles['production-shaped']
    : profile;

  return {
    ...effectiveProfile,
    requestedProfile: profile.name,
    requireProductionAuthSession: requireProductionAuthSession === true,
  };
}

export function resolveProductionPluginSourceCommand({
  requireProductionAuthSession = false,
  routeProfile = 'lab-authenticated',
  command = 'npm run verify:release',
} = {}) {
  const source = resolveProductionPluginSource({
    requireProductionAuthSession,
    routeProfile,
  });

  return {
    command,
    env: source.requireProductionAuthSession
      ? { REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1' }
      : {},
    source,
    packagedProductionPluginSource: isPackagedProductionPluginSource(source),
  };
}

export function resolveRouteProfile(routeProfile) {
  const key = String(routeProfile || 'lab-authenticated');
  if (key === 'lab') {
    return routeProfiles['lab-authenticated'];
  }
  if (key === 'production' || key === 'prod') {
    return routeProfiles['production-shaped'];
  }
  if (routeProfiles[key]) {
    return routeProfiles[key];
  }
  throw new Error(`Unknown routeProfile: ${routeProfile}`);
}

export function isPackagedProductionPluginSource(source) {
  return source?.sourceMode === 'packaged-production-plugin'
    || source?.name === 'production-shaped';
}
