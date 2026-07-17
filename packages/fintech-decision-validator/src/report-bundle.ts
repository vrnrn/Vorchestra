import { hashReport } from './canonical-json.js';
import {
  DecisionValidationError,
  REQUIRED_REPORT_NAMES,
  type NamedReport,
  type RawReportPolicy,
  type ReportBundle,
  type ReportBundleInput,
  type RequiredReportName,
} from './types.js';

type JsonRecord = Record<string, unknown>;

function fail(reason: string, nextAction: string): never {
  throw new DecisionValidationError({
    code: 'report_schema_invalid',
    reason,
    nextAction,
  });
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${path} must be a JSON object.`, `Provide ${path} as a JSON object.`);
  }
  return value as JsonRecord;
}

function requireExactKeys(
  record: JsonRecord,
  keys: readonly string[],
  path: string,
): void {
  const expected = new Set(keys);
  const missing = keys.filter((key) => !(key in record));
  const extra = Object.keys(record).filter((key) => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${path} has invalid fields (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}).`,
      `Provide exactly these ${path} fields: ${keys.join(', ')}.`,
    );
  }
}

function requireSixNames(record: JsonRecord, path: string): void {
  const missing = REQUIRED_REPORT_NAMES.filter((name) => !(name in record));
  const extra = Object.keys(record).filter(
    (name) => !REQUIRED_REPORT_NAMES.includes(name as RequiredReportName),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new DecisionValidationError({
      code: 'decision_inputs_incomplete',
      reason: `${path} must contain exactly six named entries (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}).`,
      nextAction: `Provide exactly these names in ${path}: ${REQUIRED_REPORT_NAMES.join(', ')}.`,
    });
  }
}

function validatePolicy(value: unknown, path: string): RawReportPolicy {
  const policy = requireRecord(value, path);
  requireExactKeys(policy, ['source', 'observed_at_field'], path);
  if (typeof policy.source !== 'string' || policy.source.length === 0) {
    fail(
      `${path}.source must be a non-empty string.`,
      `Configure a source name for ${path}.`,
    );
  }
  if (
    policy.observed_at_field !== 'asOf' &&
    policy.observed_at_field !== 'observed_at'
  ) {
    fail(
      `${path}.observed_at_field must be asOf or observed_at.`,
      `Configure the timestamp field used by ${path}.`,
    );
  }
  return policy as unknown as RawReportPolicy;
}

function extractObservedAt(
  report: JsonRecord,
  field: string,
  path: string,
): string {
  const value = report[field];
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(
      `${path}.${field} must be a valid ISO 8601 date-time with a timezone.`,
      `Add a valid ${field} timestamp to ${path}.`,
    );
  }
  return value;
}

export function buildReportBundle(value: unknown): ReportBundle {
  const input = requireRecord(value, 'bundle input');
  requireExactKeys(input, ['reports', 'policy'], 'bundle input');
  const rawReports = requireRecord(input.reports, 'reports');
  const policies = requireRecord(input.policy, 'policy');
  requireSixNames(rawReports, 'reports');
  requireSixNames(policies, 'policy');

  const reports = {} as Record<RequiredReportName, NamedReport>;
  for (const name of REQUIRED_REPORT_NAMES) {
    const report = requireRecord(rawReports[name], `reports.${name}`);
    const policy = validatePolicy(policies[name], `policy.${name}`);
    reports[name] = {
      source: policy.source,
      observed_at: extractObservedAt(
        report,
        policy.observed_at_field,
        `reports.${name}`,
      ),
      report_hash: hashReport(report),
      report,
    };
  }
  return { reports };
}

export function parseReportBundleInput(input: string): ReportBundleInput {
  try {
    return JSON.parse(input) as ReportBundleInput;
  } catch (error) {
    fail(
      `stdin is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Provide one complete JSON report-bundle input on stdin.',
    );
  }
}
