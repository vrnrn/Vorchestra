#!/usr/bin/env node

import { canonicalJson } from './canonical-json.js';
import {
  parseDecisionEnvelope,
  validateAndWriteDecision,
} from './validator.js';
import { DecisionValidationError } from './types.js';

interface CliOptions {
  outputPath: string;
  allowedSymbols: string[];
  maxReportAgeMs: number;
}

function usage(): never {
  throw new Error(
    'Usage: vorchestra-fintech-decision-validator --output PATH --allowed-symbol SYMBOL [--allowed-symbol SYMBOL ...] --max-age-ms NUMBER',
  );
}

function parseArguments(arguments_: string[]): CliOptions {
  let outputPath: string | undefined;
  let maxReportAgeMs: number | undefined;
  const allowedSymbols: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === '--output' && value !== undefined) {
      outputPath = value;
      index += 1;
    } else if (argument === '--allowed-symbol' && value !== undefined) {
      allowedSymbols.push(value);
      index += 1;
    } else if (argument === '--max-age-ms' && value !== undefined) {
      maxReportAgeMs = Number(value);
      index += 1;
    } else {
      usage();
    }
  }
  if (
    outputPath === undefined ||
    maxReportAgeMs === undefined ||
    allowedSymbols.length === 0
  )
    usage();
  return { outputPath, allowedSymbols, maxReportAgeMs };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const envelope = parseDecisionEnvelope(input);
  const candidate = await validateAndWriteDecision(envelope, options);
  process.stdout.write(`${canonicalJson(candidate)}\n`);
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
