import { ABSENT, deepClone, digest } from './stable-json.js';

export function enumerateResources(...sites) {
  const files = new Set();
  const plugins = new Set();
  const rows = new Map();

  for (const site of sites) {
    for (const path of Object.keys(site?.files || {})) {
      files.add(path);
    }
    for (const plugin of Object.keys(site?.plugins || {})) {
      plugins.add(plugin);
    }
    for (const [table, tableRows] of Object.entries(site?.db || {})) {
      if (!rows.has(table)) {
        rows.set(table, new Set());
      }
      for (const id of Object.keys(tableRows || {})) {
        rows.get(table).add(id);
      }
    }
  }

  return [
    ...Array.from(files).sort().map((path) => ({
      type: 'file',
      path,
      key: `file:${path}`,
    })),
    ...Array.from(plugins).sort().map((name) => ({
      type: 'plugin',
      name,
      key: `plugin:${name}`,
    })),
    ...Array.from(rows.keys()).sort().flatMap((table) =>
      Array.from(rows.get(table)).sort().map((id) => ({
        type: 'row',
        table,
        id,
        key: `row:${JSON.stringify([table, id])}`,
      })),
    ),
  ];
}

export function getResource(site, resource) {
  if (resource.type === 'file') {
    return Object.hasOwn(site?.files || {}, resource.path)
      ? normalizeFile(site.files[resource.path])
      : ABSENT;
  }
  if (resource.type === 'plugin') {
    return Object.hasOwn(site?.plugins || {}, resource.name)
      ? deepClone(site.plugins[resource.name])
      : ABSENT;
  }
  if (resource.type === 'row') {
    return Object.hasOwn(site?.db?.[resource.table] || {}, resource.id)
      ? deepClone(site.db[resource.table][resource.id])
      : ABSENT;
  }
  throw new Error(`Unknown resource type: ${resource.type}`);
}

export function setResource(site, resource, value) {
  if (resource.type === 'file') {
    site.files ||= {};
    if (value === ABSENT) {
      delete site.files[resource.path];
    } else {
      site.files[resource.path] = denormalizeFile(value);
    }
    return;
  }
  if (resource.type === 'plugin') {
    site.plugins ||= {};
    if (value === ABSENT) {
      delete site.plugins[resource.name];
    } else {
      site.plugins[resource.name] = deepClone(value);
    }
    return;
  }
  if (resource.type === 'row') {
    site.db ||= {};
    site.db[resource.table] ||= {};
    if (value === ABSENT) {
      delete site.db[resource.table][resource.id];
    } else {
      site.db[resource.table][resource.id] = deepClone(value);
    }
    return;
  }
  throw new Error(`Unknown resource type: ${resource.type}`);
}

export function resourceHash(site, resource) {
  return digest(getResource(site, resource));
}

export function serializeResourceValue(value) {
  return value === ABSENT ? { absent: true } : { value: deepClone(value) };
}

export function deserializeResourceValue(payload) {
  return payload?.absent ? ABSENT : deepClone(payload.value);
}

export function pluginOwnerFor(resource, ...values) {
  if (resource.type === 'plugin') {
    return resource.name;
  }
  for (const value of values) {
    if (value && value !== ABSENT && typeof value === 'object' && value.__pluginOwner) {
      return value.__pluginOwner;
    }
  }
  if (resource.type === 'file') {
    const match = resource.path.match(/^wp-content\/plugins\/([^/]+)/);
    return match?.[1] || null;
  }
  return null;
}

export function hasPlugin(site, pluginName) {
  return Object.hasOwn(site?.plugins || {}, pluginName);
}

function normalizeFile(value) {
  if (typeof value === 'string') {
    return { type: 'file', content: value };
  }
  return deepClone(value);
}

function denormalizeFile(value) {
  if (value?.type === 'file' && Object.keys(value).length === 2 && Object.hasOwn(value, 'content')) {
    return value.content;
  }
  return deepClone(value);
}

