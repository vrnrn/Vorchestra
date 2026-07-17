#!/usr/bin/env node

import { canonicalJson } from './canonical-json.js';
import { buildReportBundle, parseReportBundleInput } from './report-bundle.js';
import { DecisionValidationError } from './types.js';

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new DecisionValidationError({
      code: 'report_schema_invalid',
      reason:
        'vorchestra-fintech-report-bundle does not accept command-line arguments.',
      nextAction: 'Pipe one JSON bundle input to stdin.',
    });
  }
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const bundle = buildReportBundle(parseReportBundleInput(input));
  process.stdout.write(`${canonicalJson(bundle)}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof DecisionValidationError) {
    process.stderr.write(`${canonicalJson(error.toJSON())}\n`);
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
});
