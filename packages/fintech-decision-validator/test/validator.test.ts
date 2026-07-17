import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  DecisionValidationError,
  REQUIRED_REPORT_NAMES,
  canonicalJson,
  hashReport,
  validateAndWriteDecision,
  validateDecisionEnvelope,
  type DecisionEnvelope,
  type NamedReport,
  type ReportProvenance,
} from '../src/index.js';

const NOW = '2026-07-16T20:00:00.000Z';

function createEnvelope(): DecisionEnvelope {
  const reports = Object.fromEntries(
    REQUIRED_REPORT_NAMES.map((name, index) => {
      const report = {
        sequence: index,
        symbols: ['NVDA'],
        summary: `${name} evidence`,
      };
      const named: NamedReport = {
        source: `bounded-${name}`,
        observed_at: '2026-07-16T19:55:00.000Z',
        report_hash: hashReport(report),
        report,
      };
      return [name, named];
    }),
  ) as DecisionEnvelope['reports'];
  const sourceReports = Object.fromEntries(
    REQUIRED_REPORT_NAMES.map((name) => {
      const { source, observed_at, report_hash } = reports[name];
      return [
        name,
        { source, observed_at, report_hash } satisfies ReportProvenance,
      ];
    }),
  ) as DecisionEnvelope['candidate']['source_reports'];
  return {
    candidate: {
      schema_version: 1,
      run_id: 'run-fixture-1',
      generated_at: NOW,
      market_data_as_of: '2026-07-16T19:55:00.000Z',
      source_reports: sourceReports,
      signals: [
        {
          symbol: 'NVDA',
          side: 'long',
          strength: 0.7,
          confidence: 0.6,
          rationale: ['evidence agrees'],
          invalidation: 'price loses support',
        },
      ],
      proposed_orders: [
        {
          client_order_id: 'proposal-1',
          symbol: 'NVDA',
          side: 'buy',
          order_type: 'limit',
          quantity: 1,
          limit_price: 100,
          time_in_force: 'day',
        },
      ],
      conflicts: ['X and Reddit disagree'],
      missing_or_stale_sources: [],
      risk_notes: ['proposal only'],
      status: 'proposal_only',
      execution_authority: 'none',
      execution_mode: 'paper',
    },
    reports,
  };
}

const policy = {
  allowedSymbols: ['NVDA'],
  maxReportAgeMs: 10 * 60 * 1_000,
  now: NOW,
};

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

test('validates all reports, preserves decision arrays, and atomically writes canonical JSON', async () => {
  const envelope = createEnvelope();
  const directory = await mkdtemp(join(tmpdir(), 'vorchestra-decision-'));
  const outputPath = join(directory, 'signals-and-orders.json');
  const candidate = await validateAndWriteDecision(envelope, {
    ...policy,
    outputPath,
  });

  assert.deepEqual(candidate.conflicts, ['X and Reddit disagree']);
  assert.deepEqual(candidate.missing_or_stale_sources, []);
  assert.equal(
    await readFile(outputPath, 'utf8'),
    `${canonicalJson(envelope.candidate)}\n`,
  );
  const files = await import('node:fs/promises').then(({ readdir }) =>
    readdir(directory),
  );
  assert.deepEqual(files, ['signals-and-orders.json']);
});

test('accepts the strict workflow-friendly report_bundle envelope', () => {
  const envelope = createEnvelope();
  const workflowEnvelope = {
    candidate: envelope.candidate,
    report_bundle: { reports: envelope.reports },
  };
  assert.equal(
    validateDecisionEnvelope(workflowEnvelope, policy),
    envelope.candidate,
  );

  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(
      {
        ...workflowEnvelope,
        report_bundle: { reports: envelope.reports, unexpected: true },
      },
      policy,
    ),
  );
});

test('rejects a missing required report', () => {
  const envelope = createEnvelope() as unknown as {
    reports: Record<string, unknown>;
  };
  delete envelope.reports.reddit;
  expectCode('decision_inputs_incomplete', () =>
    validateDecisionEnvelope(envelope, policy),
  );
});

test('rejects stale evidence', () => {
  const envelope = createEnvelope();
  envelope.reports.reddit.observed_at = '2026-07-16T18:00:00.000Z';
  envelope.candidate.source_reports.reddit.observed_at =
    '2026-07-16T18:00:00.000Z';
  expectCode('report_stale', () => validateDecisionEnvelope(envelope, policy));
});

test('rejects report hash mismatches', () => {
  const envelope = createEnvelope();
  envelope.reports.x.report.summary = 'tampered';
  expectCode('decision_provenance_mismatch', () =>
    validateDecisionEnvelope(envelope, policy),
  );
});

test('rejects authority, status, and execution mode changes', () => {
  for (const [field, value] of [
    ['execution_authority', 'submit'],
    ['status', 'approved'],
    ['execution_mode', 'live'],
  ] as const) {
    const envelope = createEnvelope();
    (envelope.candidate as unknown as Record<string, unknown>)[field] = value;
    expectCode('decision_authority_invalid', () =>
      validateDecisionEnvelope(envelope, policy),
    );
  }
});

test('rejects unknown symbols', () => {
  const envelope = createEnvelope();
  envelope.candidate.proposed_orders[0]!.symbol = 'TSLA';
  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(envelope, policy),
  );
});

test('rejects duplicate signals, duplicate order IDs, and signal-order conflicts', () => {
  const duplicateSignal = createEnvelope();
  duplicateSignal.candidate.signals.push({
    ...duplicateSignal.candidate.signals[0]!,
  });
  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(duplicateSignal, policy),
  );

  const duplicateOrder = createEnvelope();
  duplicateOrder.candidate.proposed_orders.push({
    ...duplicateOrder.candidate.proposed_orders[0]!,
  });
  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(duplicateOrder, policy),
  );

  const conflictingOrder = createEnvelope();
  conflictingOrder.candidate.proposed_orders[0]!.side = 'sell';
  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(conflictingOrder, policy),
  );
});

test('binds decision timestamps to the policy clock and newest report', () => {
  const mismatchedMarketTime = createEnvelope();
  mismatchedMarketTime.candidate.market_data_as_of = '2026-07-16T19:54:00.000Z';
  expectCode('decision_provenance_mismatch', () =>
    validateDecisionEnvelope(mismatchedMarketTime, policy),
  );

  const futureDecision = createEnvelope();
  futureDecision.candidate.generated_at = '2026-07-16T20:01:00.000Z';
  expectCode('decision_provenance_mismatch', () =>
    validateDecisionEnvelope(futureDecision, policy),
  );
});

test('rejects negative, NaN, and infinite numbers from the programmatic API', () => {
  for (const number of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const envelope = createEnvelope();
    envelope.candidate.proposed_orders[0]!.quantity = number;
    expectCode('report_schema_invalid', () =>
      validateDecisionEnvelope(envelope, policy),
    );
  }

  const envelope = createEnvelope();
  envelope.reports.reddit.report.invalid = -1;
  expectCode('report_schema_invalid', () =>
    validateDecisionEnvelope(envelope, policy),
  );
});

test('does not write or replace output when validation fails', async () => {
  const envelope = createEnvelope();
  envelope.candidate.status = 'approved' as 'proposal_only';
  const directory = await mkdtemp(
    join(tmpdir(), 'vorchestra-decision-no-write-'),
  );
  const missingPath = join(directory, 'missing.json');
  await assert.rejects(
    validateAndWriteDecision(envelope, { ...policy, outputPath: missingPath }),
    (error: unknown) => error instanceof DecisionValidationError,
  );
  await assert.rejects(stat(missingPath), { code: 'ENOENT' });

  const existingPath = join(directory, 'existing.json');
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(existingPath, 'keep me'),
  );
  await assert.rejects(
    validateAndWriteDecision(envelope, { ...policy, outputPath: existingPath }),
    (error: unknown) => error instanceof DecisionValidationError,
  );
  assert.equal(await readFile(existingPath, 'utf8'), 'keep me');
});

test('CLI consumes one stdin envelope and prints the written canonical candidate', async () => {
  const envelope = createEnvelope();
  const directory = await mkdtemp(join(tmpdir(), 'vorchestra-decision-cli-'));
  const outputPath = join(directory, 'signals-and-orders.json');
  const cliPath = new URL('../src/cli.js', import.meta.url);
  const child = spawn(
    process.execPath,
    [
      cliPath.pathname,
      '--output',
      outputPath,
      '--allowed-symbol',
      'NVDA',
      '--max-age-ms',
      String(365 * 24 * 60 * 60 * 1_000),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(envelope));
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });

  assert.equal(Buffer.concat(stderr).toString(), '');
  assert.equal(exitCode, 0);
  const expected = `${canonicalJson(envelope.candidate)}\n`;
  assert.equal(Buffer.concat(stdout).toString(), expected);
  assert.equal(await readFile(outputPath, 'utf8'), expected);
});
