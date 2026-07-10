#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { executeWorkflow, parseWorkflowDefinition } from '@vorchestra/engine';
import { NodeProcessRunner } from '@vorchestra/node-runner';

const workflowPath = process.argv[2];

if (workflowPath === undefined) {
  console.error('Usage: npm run workflow:run -- <trusted-workflow-file>');
  process.exitCode = 2;
} else {
  try {
    const serialized = await readFile(workflowPath, 'utf8');
    const workflow = parseWorkflowDefinition(JSON.parse(serialized));
    const runner = new NodeProcessRunner();

    console.log(`Running trusted workflow: ${workflow.name}`);
    const result = await executeWorkflow(workflow, runner, {
      hostEnvironment: process.env,
      onEvent(event) {
        if (event.type === 'block_state_changed') {
          console.log(`${event.blockId}: ${event.to}`);
        }
      },
    });

    for (const block of workflow.blocks) {
      const blockResult = result.blocks[block.id];
      if (blockResult === undefined) continue;
      console.log(`\n[${block.name}] ${blockResult.state}`);
      if (blockResult.stdout.length > 0) {
        console.log(blockResult.stdout);
      }
      if (blockResult.stderr.length > 0) {
        console.error(blockResult.stderr);
      }
      if (blockResult.failure !== undefined) {
        console.error(
          `${blockResult.failure.code}: ${blockResult.failure.message}`,
        );
        if (blockResult.failure.nextAction !== undefined) {
          console.error(`Next action: ${blockResult.failure.nextAction}`);
        }
      }
    }

    console.log(`\nWorkflow ${result.outcome} (${result.runId})`);
    if (result.outcome !== 'succeeded') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to run workflow: ${message}`);
    process.exitCode = 1;
  }
}
