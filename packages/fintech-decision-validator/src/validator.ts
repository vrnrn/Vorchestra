import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { canonicalJson, hashReport } from './canonical-json.js';
import {
  DecisionValidationError,
  REQUIRED_REPORT_NAMES,
  type DecisionCandidate,
  type DecisionEnvelopeInput,
  type DecisionPolicy,
  type DecisionWriteOptions,
  type NamedReport,
  type ReportProvenance,
  type RequiredReportName,
} from './types.js';

type JsonRecord = Record<string, unknown>;

function fail(
  code: DecisionValidationError['code'],
  reason: string,
  nextAction: string,
): never {
  throw new DecisionValidationError({ code, reason, nextAction });
}

function isRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    fail(
      'report_schema_invalid',
      `${path} must be a JSON object.`,
      `Provide ${path} as an object matching the decision validator schema.`,
    );
  }
  return value;
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
      'report_schema_invalid',
      `${path} has invalid fields (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}).`,
      `Provide exactly these ${path} fields: ${keys.join(', ')}.`,
    );
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(
      'report_schema_invalid',
      `${path} must be a non-empty string.`,
      `Provide a non-empty string for ${path}.`,
    );
  }
  return value;
}

function requireDate(
  value: unknown,
  path: string,
): { text: string; milliseconds: number } {
  const text = requireString(value, path);
  const milliseconds = Date.parse(text);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text,
    ) ||
    !Number.isFinite(milliseconds)
  ) {
    fail(
      'report_schema_invalid',
      `${path} must be a valid date-time.`,
      `Provide ${path} as an ISO 8601 date-time with a timezone.`,
    );
  }
  return { text, milliseconds };
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(
      'report_schema_invalid',
      `${path} must be an array of strings.`,
      `Provide only strings in ${path}.`,
    );
  }
  return value;
}

function requireNumber(
  value: unknown,
  path: string,
  options?: { positive?: boolean; unit?: boolean },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (options?.positive === true && value <= 0) ||
    (options?.unit === true && value > 1)
  ) {
    fail(
      'report_schema_invalid',
      `${path} is outside its allowed finite non-negative numeric range.`,
      `Provide a valid finite ${options?.positive === true ? 'positive ' : ''}number for ${path}.`,
    );
  }
  return value;
}

function normalizeHash(value: unknown, path: string): string {
  const text = requireString(value, path).toLowerCase();
  const hash = text.startsWith('sha256:') ? text.slice(7) : text;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    fail(
      'report_schema_invalid',
      `${path} must be a SHA-256 digest.`,
      `Provide ${path} as 64 hexadecimal characters, optionally prefixed with sha256:.`,
    );
  }
  return hash;
}

function validateProvenance(value: unknown, path: string): ReportProvenance {
  const record = requireRecord(value, path);
  requireExactKeys(record, ['source', 'observed_at', 'report_hash'], path);
  requireString(record.source, `${path}.source`);
  requireDate(record.observed_at, `${path}.observed_at`);
  normalizeHash(record.report_hash, `${path}.report_hash`);
  return record as unknown as ReportProvenance;
}

function validateReportMap(
  value: unknown,
): Record<RequiredReportName, NamedReport> {
  const reports = requireRecord(value, 'reports');
  const missing = REQUIRED_REPORT_NAMES.filter((name) => !(name in reports));
  const extra = Object.keys(reports).filter(
    (name) => !REQUIRED_REPORT_NAMES.includes(name as RequiredReportName),
  );
  if (missing.length > 0 || extra.length > 0) {
    fail(
      'decision_inputs_incomplete',
      `Exactly six named reports are required (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}).`,
      `Provide exactly these report names: ${REQUIRED_REPORT_NAMES.join(', ')}.`,
    );
  }

  for (const name of REQUIRED_REPORT_NAMES) {
    const path = `reports.${name}`;
    const report = requireRecord(reports[name], path);
    requireExactKeys(
      report,
      ['source', 'observed_at', 'report_hash', 'report'],
      path,
    );
    validateProvenance(
      {
        source: report.source,
        observed_at: report.observed_at,
        report_hash: report.report_hash,
      },
      path,
    );
    requireRecord(report.report, `${path}.report`);
    canonicalJson(report.report);
  }
  return reports as Record<RequiredReportName, NamedReport>;
}

function validateCandidate(value: unknown): DecisionCandidate {
  const candidate = requireRecord(value, 'candidate');
  requireExactKeys(
    candidate,
    [
      'schema_version',
      'run_id',
      'generated_at',
      'market_data_as_of',
      'source_reports',
      'signals',
      'proposed_orders',
      'conflicts',
      'missing_or_stale_sources',
      'risk_notes',
      'status',
      'execution_authority',
      'execution_mode',
    ],
    'candidate',
  );

  if (candidate.status !== 'proposal_only') {
    fail(
      'decision_authority_invalid',
      'candidate.status must be proposal_only.',
      'Set status to proposal_only; this validator never authorizes execution.',
    );
  }
  if (candidate.execution_authority !== 'none') {
    fail(
      'decision_authority_invalid',
      'candidate.execution_authority must be none.',
      'Set execution_authority to none and remove every order-execution path.',
    );
  }
  if (candidate.execution_mode !== 'paper') {
    fail(
      'decision_authority_invalid',
      'candidate.execution_mode must be paper.',
      'Set execution_mode to paper; live execution is outside this workflow authority.',
    );
  }
  if (candidate.schema_version !== 1) {
    fail(
      'report_schema_invalid',
      'candidate.schema_version must equal 1.',
      'Emit decision candidate schema version 1.',
    );
  }
  requireString(candidate.run_id, 'candidate.run_id');
  requireDate(candidate.generated_at, 'candidate.generated_at');
  requireDate(candidate.market_data_as_of, 'candidate.market_data_as_of');

  const sourceReports = requireRecord(
    candidate.source_reports,
    'candidate.source_reports',
  );
  requireExactKeys(
    sourceReports,
    REQUIRED_REPORT_NAMES,
    'candidate.source_reports',
  );
  for (const name of REQUIRED_REPORT_NAMES) {
    validateProvenance(sourceReports[name], `candidate.source_reports.${name}`);
  }

  if (!Array.isArray(candidate.signals)) {
    fail(
      'report_schema_invalid',
      'candidate.signals must be an array.',
      'Provide a signals array.',
    );
  }
  const signalSymbols = new Set<string>();
  for (const [index, rawSignal] of candidate.signals.entries()) {
    const path = `candidate.signals[${index}]`;
    const signal = requireRecord(rawSignal, path);
    requireExactKeys(
      signal,
      ['symbol', 'side', 'strength', 'confidence', 'rationale', 'invalidation'],
      path,
    );
    const symbol = requireString(signal.symbol, `${path}.symbol`);
    if (signalSymbols.has(symbol)) {
      fail(
        'report_schema_invalid',
        `${path}.symbol duplicates an earlier signal for ${symbol}.`,
        'Emit at most one signal per symbol.',
      );
    }
    signalSymbols.add(symbol);
    if (!['long', 'short', 'flat'].includes(signal.side as string)) {
      fail(
        'report_schema_invalid',
        `${path}.side is invalid.`,
        'Use long, short, or flat.',
      );
    }
    requireNumber(signal.strength, `${path}.strength`, { unit: true });
    requireNumber(signal.confidence, `${path}.confidence`, { unit: true });
    requireStringArray(signal.rationale, `${path}.rationale`);
    requireString(signal.invalidation, `${path}.invalidation`);
  }

  if (!Array.isArray(candidate.proposed_orders)) {
    fail(
      'report_schema_invalid',
      'candidate.proposed_orders must be an array.',
      'Provide a proposed_orders array.',
    );
  }
  const clientOrderIds = new Set<string>();
  for (const [index, rawOrder] of candidate.proposed_orders.entries()) {
    const path = `candidate.proposed_orders[${index}]`;
    const order = requireRecord(rawOrder, path);
    requireExactKeys(
      order,
      [
        'client_order_id',
        'symbol',
        'side',
        'order_type',
        'quantity',
        'limit_price',
        'time_in_force',
      ],
      path,
    );
    const clientOrderId = requireString(
      order.client_order_id,
      `${path}.client_order_id`,
    );
    if (clientOrderIds.has(clientOrderId)) {
      fail(
        'report_schema_invalid',
        `${path}.client_order_id duplicates ${clientOrderId}.`,
        'Use a unique client_order_id for every proposal.',
      );
    }
    clientOrderIds.add(clientOrderId);
    requireString(order.symbol, `${path}.symbol`);
    if (!['buy', 'sell'].includes(order.side as string)) {
      fail(
        'report_schema_invalid',
        `${path}.side is invalid.`,
        'Use buy or sell.',
      );
    }
    if (order.order_type !== 'limit') {
      fail(
        'report_schema_invalid',
        `${path}.order_type is invalid.`,
        'Use limit orders only.',
      );
    }
    requireNumber(order.quantity, `${path}.quantity`, { positive: true });
    requireNumber(order.limit_price, `${path}.limit_price`, { positive: true });
    if (order.time_in_force !== 'day') {
      fail(
        'report_schema_invalid',
        `${path}.time_in_force is invalid.`,
        'Use day time in force.',
      );
    }
  }

  for (const [index, order] of candidate.proposed_orders.entries()) {
    const signal = candidate.signals.find(
      (candidateSignal) => candidateSignal.symbol === order.symbol,
    );
    const expectedSignalSide = order.side === 'buy' ? 'long' : 'short';
    if (signal === undefined || signal.side !== expectedSignalSide) {
      fail(
        'report_schema_invalid',
        `candidate.proposed_orders[${index}] is not backed by a matching ${expectedSignalSide} signal.`,
        'Remove the order proposal or add one matching non-flat signal for its symbol.',
      );
    }
  }

  requireStringArray(candidate.conflicts, 'candidate.conflicts');
  requireStringArray(
    candidate.missing_or_stale_sources,
    'candidate.missing_or_stale_sources',
  );
  requireStringArray(candidate.risk_notes, 'candidate.risk_notes');
  canonicalJson(candidate);
  return candidate as unknown as DecisionCandidate;
}

function resolveNow(now: DecisionPolicy['now']): number {
  const milliseconds = now === undefined ? Date.now() : new Date(now).getTime();
  if (!Number.isFinite(milliseconds)) {
    fail(
      'report_schema_invalid',
      'The policy now value is invalid.',
      'Provide a valid policy clock value.',
    );
  }
  return milliseconds;
}

export function validateDecisionEnvelope(
  value: unknown,
  policy: DecisionPolicy,
): DecisionCandidate {
  if (
    !Number.isSafeInteger(policy.maxReportAgeMs) ||
    policy.maxReportAgeMs < 0 ||
    !Array.isArray(policy.allowedSymbols) ||
    policy.allowedSymbols.length === 0 ||
    policy.allowedSymbols.some(
      (symbol) =>
        typeof symbol !== 'string' ||
        symbol.length === 0 ||
        symbol.trim() !== symbol,
    ) ||
    new Set(policy.allowedSymbols).size !== policy.allowedSymbols.length
  ) {
    fail(
      'report_schema_invalid',
      'Decision policy requires non-empty allowedSymbols and a finite non-negative maxReportAgeMs.',
      'Configure an explicit symbol allowlist and freshness duration.',
    );
  }
  const envelope = requireRecord(value, 'envelope');
  const keys = Object.keys(envelope).sort();
  let rawReports: unknown;
  if (keys.length === 2 && keys[0] === 'candidate' && keys[1] === 'reports') {
    rawReports = envelope.reports;
  } else if (
    keys.length === 2 &&
    keys[0] === 'candidate' &&
    keys[1] === 'report_bundle'
  ) {
    const reportBundle = requireRecord(
      envelope.report_bundle,
      'envelope.report_bundle',
    );
    requireExactKeys(reportBundle, ['reports'], 'envelope.report_bundle');
    rawReports = reportBundle.reports;
  } else {
    fail(
      'report_schema_invalid',
      'envelope must have exactly candidate plus either reports or report_bundle.',
      'Provide {candidate, reports} or {candidate, report_bundle: {reports}} with no extra fields.',
    );
  }
  const reports = validateReportMap(rawReports);
  const candidate = validateCandidate(envelope.candidate);
  const allowed = new Set(policy.allowedSymbols);
  for (const [path, symbols] of [
    ['candidate.signals', candidate.signals],
    ['candidate.proposed_orders', candidate.proposed_orders],
  ] as const) {
    for (const [index, entry] of symbols.entries()) {
      if (!allowed.has(entry.symbol)) {
        fail(
          'report_schema_invalid',
          `${path}[${index}].symbol ${JSON.stringify(entry.symbol)} is not allowed.`,
          `Use only configured symbols: ${policy.allowedSymbols.join(', ')}.`,
        );
      }
    }
  }

  const now = resolveNow(policy.now);
  let latestObserved = Number.NEGATIVE_INFINITY;
  for (const name of REQUIRED_REPORT_NAMES) {
    const report = reports[name];
    const linked = candidate.source_reports[name];
    const actualHash = hashReport(report.report);
    const declaredHash = normalizeHash(
      report.report_hash,
      `reports.${name}.report_hash`,
    );
    const linkedHash = normalizeHash(
      linked.report_hash,
      `candidate.source_reports.${name}.report_hash`,
    );
    if (
      actualHash !== declaredHash ||
      actualHash !== linkedHash ||
      report.source !== linked.source ||
      report.observed_at !== linked.observed_at
    ) {
      fail(
        'decision_provenance_mismatch',
        `Provenance for report ${name} does not match its canonical content or candidate linkage.`,
        `Recompute the SHA-256 over canonical report JSON and copy the exact source, hash, and observed_at into candidate.source_reports.${name}.`,
      );
    }
    const observed = requireDate(
      report.observed_at,
      `reports.${name}.observed_at`,
    ).milliseconds;
    const age = now - observed;
    latestObserved = Math.max(latestObserved, observed);
    if (age < 0) {
      fail(
        'decision_provenance_mismatch',
        `Report ${name} has a future observed_at timestamp.`,
        'Correct the report clock and regenerate its provenance.',
      );
    }
    if (age > policy.maxReportAgeMs) {
      fail(
        'report_stale',
        `Report ${name} is stale by policy (${age} ms old; maximum ${policy.maxReportAgeMs} ms).`,
        `Refresh report ${name}, recompute its hash, and regenerate the decision candidate.`,
      );
    }
  }

  const generatedAt = requireDate(
    candidate.generated_at,
    'candidate.generated_at',
  ).milliseconds;
  const marketDataAsOf = requireDate(
    candidate.market_data_as_of,
    'candidate.market_data_as_of',
  ).milliseconds;
  if (generatedAt > now) {
    fail(
      'decision_provenance_mismatch',
      'candidate.generated_at is in the future.',
      'Correct the decision clock and regenerate the candidate.',
    );
  }
  if (marketDataAsOf !== latestObserved || marketDataAsOf > generatedAt) {
    fail(
      'decision_provenance_mismatch',
      'candidate.market_data_as_of must equal the newest linked report timestamp and cannot follow generated_at.',
      'Set market_data_as_of to the newest exact source report observed_at value and regenerate the candidate.',
    );
  }

  return candidate;
}

export async function validateAndWriteDecision(
  value: unknown,
  options: DecisionWriteOptions,
): Promise<DecisionCandidate> {
  const candidate = validateDecisionEnvelope(value, options);
  const outputPath = resolve(options.outputPath);
  const directory = dirname(outputPath);
  const temporaryPath = join(
    directory,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const output = `${canonicalJson(candidate)}\n`;
  try {
    await writeFile(temporaryPath, output, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return candidate;
}

export function parseDecisionEnvelope(input: string): DecisionEnvelopeInput {
  try {
    return JSON.parse(input) as DecisionEnvelopeInput;
  } catch (error) {
    fail(
      'report_schema_invalid',
      `stdin is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Provide one complete JSON decision envelope on stdin.',
    );
  }
}
