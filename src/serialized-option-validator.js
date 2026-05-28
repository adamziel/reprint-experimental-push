import { ABSENT, digest } from './stable-json.js';

export function validateSerializedOptionRow(row) {
  if (!row || row === ABSENT || typeof row !== 'object') {
    return { serialized: false, valid: true, reasonCode: 'SERIALIZED_OPTION_NOT_PRESENT' };
  }

  const optionValue = row.option_value;
  const serialized = row.serialization === 'php-serialize' || looksLikePhpSerializedValue(optionValue);
  if (!serialized) {
    return { serialized: false, valid: true, reasonCode: 'SERIALIZED_OPTION_NOT_DECLARED' };
  }
  if (typeof optionValue !== 'string') {
    return { serialized: true, valid: false, reasonCode: 'SERIALIZED_OPTION_VALUE_NOT_STRING' };
  }

  const parsed = parsePhpSerializedValue(optionValue);
  return parsed.valid
    ? { serialized: true, valid: true, reasonCode: 'SERIALIZED_OPTION_VALID' }
    : { serialized: true, valid: false, reasonCode: parsed.reasonCode };
}

export function serializedOptionValidationEvidenceForRows({ resourceKey, table, rows }) {
  const snapshots = rows.map(({ snapshot, row }) => serializedOptionRowEvidence(snapshot, row));
  const invalid = snapshots.find((entry) => entry.serialized === true && entry.valid === false);
  const serialized = snapshots.some((entry) => entry.serialized === true);

  return {
    schemaVersion: 1,
    evidenceSource: 'plugin-driver-serialized-option-validator',
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey,
    table,
    serialized,
    valid: !invalid,
    reasonCode: invalid?.reasonCode || (serialized ? 'SERIALIZED_OPTION_VALID' : 'SERIALIZED_OPTION_NOT_DECLARED'),
    snapshots,
  };
}

function serializedOptionRowEvidence(snapshot, row) {
  if (!row || row === ABSENT || typeof row !== 'object') {
    return {
      snapshot,
      state: 'absent',
      serialized: false,
      valid: true,
      reasonCode: 'SERIALIZED_OPTION_NOT_PRESENT',
      rowHash: digest(row),
      optionValueHash: null,
    };
  }

  const validation = validateSerializedOptionRow(row);
  return {
    snapshot,
    state: 'present',
    serialized: validation.serialized,
    valid: validation.valid,
    reasonCode: validation.reasonCode,
    serialization: row.serialization === 'php-serialize' ? 'php-serialize' : null,
    rowHash: digest(row),
    optionValueHash: typeof row.option_value === 'string' ? digest(row.option_value) : null,
  };
}

function looksLikePhpSerializedValue(value) {
  return typeof value === 'string'
    && (value === 'N;' || /^(?:a|O|s|i|b|d):/.test(value));
}

function parsePhpSerializedValue(value) {
  try {
    const parser = new PhpSerializedParser(value);
    parser.parseValue();
    if (parser.index !== value.length) {
      return { valid: false, reasonCode: 'SERIALIZED_OPTION_TRAILING_BYTES' };
    }
    return { valid: true, reasonCode: 'SERIALIZED_OPTION_VALID' };
  } catch (error) {
    return { valid: false, reasonCode: error.reasonCode || 'SERIALIZED_OPTION_PARSE_FAILED' };
  }
}

class PhpSerializedParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parseValue() {
    if (this.consume('N;')) {
      return;
    }

    const type = this.source[this.index];
    this.index += 1;
    this.expect(':', 'SERIALIZED_OPTION_MISSING_TYPE_SEPARATOR');

    if (type === 'b') {
      const value = this.readUntil(';', 'SERIALIZED_OPTION_BOOL_MISSING_TERMINATOR');
      if (value !== '0' && value !== '1') {
        this.fail('SERIALIZED_OPTION_BOOL_INVALID');
      }
      return;
    }

    if (type === 'i') {
      const value = this.readUntil(';', 'SERIALIZED_OPTION_INT_MISSING_TERMINATOR');
      if (!/^-?(?:0|[1-9]\d*)$/.test(value)) {
        this.fail('SERIALIZED_OPTION_INT_INVALID');
      }
      return;
    }

    if (type === 'd') {
      const value = this.readUntil(';', 'SERIALIZED_OPTION_FLOAT_MISSING_TERMINATOR');
      if (!/^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|-?INF|NAN)$/.test(value)) {
        this.fail('SERIALIZED_OPTION_FLOAT_INVALID');
      }
      return;
    }

    if (type === 's') {
      const length = this.readNonNegativeInteger('SERIALIZED_OPTION_STRING_LENGTH_INVALID');
      this.expect(':', 'SERIALIZED_OPTION_STRING_LENGTH_SEPARATOR_MISSING');
      this.expect('"', 'SERIALIZED_OPTION_STRING_QUOTE_MISSING');
      this.consumeByteLengthString(length, 'SERIALIZED_OPTION_STRING_LENGTH_MISMATCH');
      this.expect('"', 'SERIALIZED_OPTION_STRING_END_QUOTE_MISSING');
      this.expect(';', 'SERIALIZED_OPTION_STRING_TERMINATOR_MISSING');
      return;
    }

    if (type === 'a') {
      const count = this.readNonNegativeInteger('SERIALIZED_OPTION_ARRAY_LENGTH_INVALID');
      this.expect(':', 'SERIALIZED_OPTION_ARRAY_LENGTH_SEPARATOR_MISSING');
      this.expect('{', 'SERIALIZED_OPTION_ARRAY_OPEN_MISSING');
      for (let i = 0; i < count * 2; i += 1) {
        this.parseValue();
      }
      this.expect('}', 'SERIALIZED_OPTION_ARRAY_CLOSE_MISSING');
      return;
    }

    if (type === 'O') {
      const classLength = this.readNonNegativeInteger('SERIALIZED_OPTION_OBJECT_CLASS_LENGTH_INVALID');
      this.expect(':', 'SERIALIZED_OPTION_OBJECT_CLASS_SEPARATOR_MISSING');
      this.expect('"', 'SERIALIZED_OPTION_OBJECT_CLASS_QUOTE_MISSING');
      this.consumeByteLengthString(classLength, 'SERIALIZED_OPTION_OBJECT_CLASS_LENGTH_MISMATCH');
      this.expect('"', 'SERIALIZED_OPTION_OBJECT_CLASS_END_QUOTE_MISSING');
      this.expect(':', 'SERIALIZED_OPTION_OBJECT_PROP_SEPARATOR_MISSING');
      const propertyCount = this.readNonNegativeInteger('SERIALIZED_OPTION_OBJECT_PROP_COUNT_INVALID');
      this.expect(':', 'SERIALIZED_OPTION_OBJECT_PROP_COUNT_SEPARATOR_MISSING');
      this.expect('{', 'SERIALIZED_OPTION_OBJECT_OPEN_MISSING');
      for (let i = 0; i < propertyCount * 2; i += 1) {
        this.parseValue();
      }
      this.expect('}', 'SERIALIZED_OPTION_OBJECT_CLOSE_MISSING');
      return;
    }

    this.fail('SERIALIZED_OPTION_TYPE_UNSUPPORTED');
  }

  readNonNegativeInteger(reasonCode) {
    const start = this.index;
    while (/\d/.test(this.source[this.index] || '')) {
      this.index += 1;
    }
    const value = this.source.slice(start, this.index);
    if (!/^(?:0|[1-9]\d*)$/.test(value)) {
      this.fail(reasonCode);
    }
    return Number.parseInt(value, 10);
  }

  readUntil(delimiter, reasonCode) {
    const end = this.source.indexOf(delimiter, this.index);
    if (end === -1) {
      this.fail(reasonCode);
    }
    const value = this.source.slice(this.index, end);
    this.index = end + delimiter.length;
    return value;
  }

  consumeByteLengthString(expectedLength, reasonCode) {
    let byteLength = 0;
    while (this.index < this.source.length && byteLength < expectedLength) {
      const codePoint = this.source.codePointAt(this.index);
      const char = String.fromCodePoint(codePoint);
      this.index += char.length;
      byteLength += Buffer.byteLength(char, 'utf8');
      if (byteLength > expectedLength) {
        this.fail(reasonCode);
      }
    }
    if (byteLength !== expectedLength) {
      this.fail(reasonCode);
    }
  }

  consume(token) {
    if (this.source.startsWith(token, this.index)) {
      this.index += token.length;
      return true;
    }
    return false;
  }

  expect(token, reasonCode) {
    if (!this.consume(token)) {
      this.fail(reasonCode);
    }
  }

  fail(reasonCode) {
    const error = new Error(reasonCode);
    error.reasonCode = reasonCode;
    throw error;
  }
}
