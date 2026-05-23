import crypto from 'node:crypto';

export const ABSENT = Symbol.for('reprint-push.absent');

export function stableStringify(value) {
  if (value === ABSENT) {
    return '"__REPRINT_PUSH_ABSENT__"';
  }
  return JSON.stringify(sortForJson(value));
}

export function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function deepClone(value) {
  if (value === undefined || value === ABSENT) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortForJson(value[key]);
    }
    return sorted;
  }
  return value;
}

