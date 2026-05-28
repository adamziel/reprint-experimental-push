import { ABSENT, digest } from './stable-json.js';

export const INVALID_SERIALIZED_OPTION_PAYLOAD = 'INVALID_SERIALIZED_OPTION_PAYLOAD';

export function validatePluginOwnedDriverPayload({ resource, driver, value }) {
  if (!isSerializedWpOptionPayload(resource, driver, value)) {
    return { supported: true, evidence: null };
  }

  if (!value || value === ABSENT || typeof value !== 'object') {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  if (typeof value.option_value !== 'string') {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  const phpSerialized = validatePhpSerializedPayload(value.option_value);
  if (!phpSerialized.valid) {
    return invalidSerializedOptionEvidence({ resource, driver, value });
  }

  return {
    supported: true,
    evidence: serializedOptionValidationEvidence({
      resource,
      driver,
      value,
      outcome: 'accepted',
    }),
  };
}

function isSerializedWpOptionPayload(resource, driver, value) {
  return driver === 'wp-option'
    && resource?.type === 'row'
    && resource.table === 'wp_options'
    && value !== ABSENT
    && value?.serialization === 'php-serialize';
}

function invalidSerializedOptionEvidence({ resource, driver, value }) {
  return {
    supported: false,
    className: 'invalid-plugin-driver-payload',
    reasonCode: INVALID_SERIALIZED_OPTION_PAYLOAD,
    reason: 'Plugin-owned serialized wp_options payload failed php-serialize validation.',
    evidence: serializedOptionValidationEvidence({
      resource,
      driver,
      value,
      outcome: 'refused',
    }),
  };
}

function serializedOptionValidationEvidence({ resource, driver, value, outcome }) {
  return {
    schemaVersion: 1,
    operation: 'plugin-driver-payload-validation',
    validator: 'php-serialized-option',
    reasonCode: INVALID_SERIALIZED_OPTION_PAYLOAD,
    outcome,
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: resource?.key || null,
    table: resource?.table || null,
    id: resource?.id || null,
    driver,
    valueHash: digest(value),
    optionValueHash: typeof value?.option_value === 'string' ? digest(value.option_value) : null,
  };
}

function validatePhpSerializedPayload(payload) {
  if (typeof payload !== 'string') {
    return { valid: false };
  }
  const bytes = Buffer.from(payload, 'utf8');
  const offset = parsePhpSerializedValue(bytes, 0, 0);
  return { valid: offset === bytes.length };
}

function parsePhpSerializedValue(bytes, offset, depth) {
  if (depth > 100 || offset >= bytes.length) {
    return -1;
  }

  switch (bytes[offset]) {
    case 78: // N
      return bytes[offset + 1] === 59 ? offset + 2 : -1;
    case 98: // b
      return parsePhpScalar(bytes, offset, /^[01]$/);
    case 105: // i
      return parsePhpScalar(bytes, offset, /^-?(?:0|[1-9]\d*)$/);
    case 100: // d
      return parsePhpScalar(bytes, offset, /^(?:NAN|INF|-INF|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)$/);
    case 115: // s
      return parsePhpByteString(bytes, offset);
    case 97: // a
      return parsePhpKeyValueContainer(bytes, offset, depth, 'a');
    case 79: // O
      return parsePhpObject(bytes, offset, depth);
    case 82: // R
    case 114: // r
      return parsePhpScalar(bytes, offset, /^[1-9]\d*$/);
    default:
      return -1;
  }
}

function parsePhpScalar(bytes, offset, pattern) {
  if (bytes[offset + 1] !== 58) {
    return -1;
  }
  const end = indexOfByte(bytes, 59, offset + 2);
  if (end === -1) {
    return -1;
  }
  const value = bytes.toString('utf8', offset + 2, end);
  return pattern.test(value) ? end + 1 : -1;
}

function parsePhpByteString(bytes, offset) {
  if (bytes[offset] !== 115 || bytes[offset + 1] !== 58) {
    return -1;
  }
  const lengthResult = readUnsignedInteger(bytes, offset + 2);
  if (!lengthResult || bytes[lengthResult.offset] !== 58 || bytes[lengthResult.offset + 1] !== 34) {
    return -1;
  }
  const start = lengthResult.offset + 2;
  const end = start + lengthResult.value;
  if (end + 1 >= bytes.length || bytes[end] !== 34 || bytes[end + 1] !== 59) {
    return -1;
  }
  return end + 2;
}

function parsePhpKeyValueContainer(bytes, offset, depth, type) {
  if (bytes[offset] !== type.charCodeAt(0) || bytes[offset + 1] !== 58) {
    return -1;
  }
  const countResult = readUnsignedInteger(bytes, offset + 2);
  if (!countResult || bytes[countResult.offset] !== 58 || bytes[countResult.offset + 1] !== 123) {
    return -1;
  }
  let cursor = countResult.offset + 2;
  for (let index = 0; index < countResult.value; index++) {
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
  }
  return bytes[cursor] === 125 ? cursor + 1 : -1;
}

function parsePhpObject(bytes, offset, depth) {
  if (bytes[offset] !== 79 || bytes[offset + 1] !== 58) {
    return -1;
  }
  const classLength = readUnsignedInteger(bytes, offset + 2);
  if (!classLength || bytes[classLength.offset] !== 58 || bytes[classLength.offset + 1] !== 34) {
    return -1;
  }
  const classStart = classLength.offset + 2;
  const classEnd = classStart + classLength.value;
  if (classEnd + 1 >= bytes.length || bytes[classEnd] !== 34 || bytes[classEnd + 1] !== 58) {
    return -1;
  }
  const countResult = readUnsignedInteger(bytes, classEnd + 2);
  if (!countResult || bytes[countResult.offset] !== 58 || bytes[countResult.offset + 1] !== 123) {
    return -1;
  }
  let cursor = countResult.offset + 2;
  for (let index = 0; index < countResult.value; index++) {
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
    cursor = parsePhpSerializedValue(bytes, cursor, depth + 1);
    if (cursor === -1) {
      return -1;
    }
  }
  return bytes[cursor] === 125 ? cursor + 1 : -1;
}

function readUnsignedInteger(bytes, offset) {
  let cursor = offset;
  while (cursor < bytes.length && bytes[cursor] >= 48 && bytes[cursor] <= 57) {
    cursor++;
  }
  if (cursor === offset) {
    return null;
  }
  const raw = bytes.toString('utf8', offset, cursor);
  if (raw.length > 1 && raw.startsWith('0')) {
    return null;
  }
  return {
    value: Number.parseInt(raw, 10),
    offset: cursor,
  };
}

function indexOfByte(bytes, byte, offset) {
  for (let cursor = offset; cursor < bytes.length; cursor++) {
    if (bytes[cursor] === byte) {
      return cursor;
    }
  }
  return -1;
}
