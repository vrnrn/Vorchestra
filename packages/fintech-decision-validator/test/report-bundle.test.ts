import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  DecisionValidationError,
  REQUIRED_REPORT_NAMES,
  buildReportBundle,
  canonicalJson,
  hashReport,
  parseReportBundleInput,
  type ReportBundleInput,
} from '../src/index.js';

function createInput(): ReportBundleInput {
  const reports = Object.fromEntries(
    REQUIRED_REPORT_NAMES.map((name, index) => [
      name,
      name.startsWith('tradingview')
        ? {
            symbol: `SYMBOL-${index}`,
            observed_at: '2026-07-16T20:00:00.000Z',
            confidence: 0.75,
          }
        : {
            source_label: name,
            asOf: '2026-07-16T19:55:00.000Z',
            confidence: 0.5,
          },
    ]),
  ) as unknown as ReportBundleInput['reports'];
  const policy = Object.fromEntries(
    REQUIRED_REPORT_NAMES.map((name) => [
      name,
      {
        source: `bounded-${name}`,
        observed_at_field: name.startsWith('tradingview')
          ? 'observed_at'
          : 'asOf',
      },
    ]),
  ) as ReportBundleInput['policy'];
  return { reports, policy };
}

function expectCode(
  code: DecisionValidationError['code'],
  operation: () => unknown,
): void {
  assert.throws(operation, (error: unknown) => {
    assert(error instanceof DecisionValidationError);
    assert.equal(error.code, code);
    assert.ok(error.reason.length > 0);
    assert.ok(error.nextAction.length > 0);
    return true;
  });
}

test('wraps exactly six raw reports with configured source, extracted time, and canonical hash', () => {
  const input = createInput();
  const bundle = buildReportBundle(input);

  assert.deepEqual(Object.keys(bundle.reports), [...REQUIRED_REPORT_NAMES]);
  assert.equal(bundle.reports.reddit.source, 'bounded-reddit');
  assert.equal(bundle.reports.reddit.observed_at, '2026-07-16T19:55:00.000Z');
  assert.equal(
    bundle.reports.tradingview_a.observed_at,
    '2026-07-16T20:00:00.000Z',
  );
  for (const name of REQUIRED_REPORT_NAMES) {
    assert.equal(bundle.reports[name].report, input.reports[name]);
    assert.equal(
      bundle.reports[name].report_hash,
      hashReport(input.reports[name]),
    );
  }
});

test('rejects missing and unexpected report names', () => {
  const missing = createInput() as unknown as {
    reports: Record<string, unknown>;
  };
  delete missing.reports.x;
  expectCode('decision_inputs_incomplete', () => buildReportBundle(missing));

  const extra = createInput() as unknown as {
    reports: Record<string, unknown>;
  };
  extra.reports.extra = { asOf: '2026-07-16T20:00:00.000Z' };
  expectCode('decision_inputs_incomplete', () => buildReportBundle(extra));
});

test('rejects malformed policy, raw reports, timestamps, and stdin JSON', () => {
  const invalidField = createInput();
  invalidField.policy.reddit.observed_at_field = 'timestamp' as 'asOf';
  expectCode('report_schema_invalid', () => buildReportBundle(invalidField));

  const invalidReport = createInput();
  invalidReport.reports.x = [] as unknown as Record<string, unknown>;
  expectCode('report_schema_invalid', () => buildReportBundle(invalidReport));

  const missingTime = createInput();
  delete missingTime.reports.perplexity_finance.asOf;
  expectCode('report_schema_invalid', () => buildReportBundle(missingTime));

  expectCode('report_schema_invalid', () => parseReportBundleInput('{'));
});

test('report-bundle CLI reads stdin and emits only the canonical wrapped bundle', async () => {
  const input = createInput();
  const cliPath = new URL('../src/bundle-cli.js', import.meta.url);
  const child = spawn(process.execPath, [cliPath.pathname], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(input));
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });

  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(stderr).toString(), '');
  assert.equal(
    Buffer.concat(stdout).toString(),
    `${canonicalJson(buildReportBundle(input))}\n`,
  );
});
