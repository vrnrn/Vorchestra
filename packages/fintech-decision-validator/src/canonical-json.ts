import { createHash } from 'node:crypto';

import { DecisionValidationError } from './types.js';

function schemaError(reason: string): never {
  throw new DecisionValidationError({
    code: 'report_schema_invalid',
    reason,
    nextAction:
      'Provide JSON containing only objects, arrays, strings, booleans, null, and finite non-negative numbers.',
  });
}

function canonicalValue(
  value: unknown,
  path: string,
  seen: Set<object>,
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value) || value < 0) {
        schemaError(`${path} must be a finite non-negative number.`);
      }
      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) schemaError(`${path} contains a cycle.`);
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((item, index) => canonicalValue(item, `${path}[${index}]`, seen)).join(',')}]`;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) {
          schemaError(`${path} must be a plain JSON object.`);
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonicalValue(record[key], `${path}.${key}`, seen)}`,
          )
          .join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      schemaError(`${path} contains a non-JSON ${typeof value} value.`);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, '$', new Set());
}

export function hashReport(report: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalJson(report), 'utf8')
    .digest('hex');
}
