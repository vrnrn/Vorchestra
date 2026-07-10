import {
  executeWorkflow,
  type Artifact,
  type RuntimeEvent,
  type WorkflowExecutionResult,
  type WorkflowDefinition,
} from '@vorchestra/engine';
import { NodeProcessRunner } from '@vorchestra/node-runner';
import type { BlockRunSnapshot, DesktopRunEvent } from '../shared/contracts.js';

type EventSink = (event: DesktopRunEvent) => void;

export interface ActiveRun {
  readonly runId: string;
  cancel(): void;
  readonly completion: Promise<void>;
}

/**
 * Thin Electron-host adapter. The engine owns validation, DAG scheduling,
 * artifact routing, state transitions, and cancellation semantics. The node
 * runner owns child-process authority. This module only shapes sequenced engine
 * events into renderer-friendly snapshots.
 */
export function startWorkflowRun(
  workflow: WorkflowDefinition,
  onEvent: EventSink,
): ActiveRun {
  const runId = crypto.randomUUID();
  const controller = new AbortController();
  const snapshots = new Map<string, BlockRunSnapshot>(
    workflow.blocks.map((block) => [block.id, emptySnapshot(block.id)]),
  );
  const runner = new NodeProcessRunner();

  const execution = executeWorkflow(workflow, runner, {
    runId,
    signal: controller.signal,
    hostEnvironment: process.env,
    onEvent: (event) => forwardEvent(event, snapshots, onEvent),
  });
  const completion = reportExecutionCompletion(execution, runId, onEvent);

  return {
    runId,
    cancel: () => controller.abort(),
    completion,
  };
}

function forwardEvent(
  event: RuntimeEvent,
  snapshots: Map<string, BlockRunSnapshot>,
  onEvent: EventSink,
): void {
  if (event.type === 'execution_started') {
    onEvent({
      type: 'run_started',
      runId: event.runId,
      blocks: [...snapshots.values()],
    });
    return;
  }

  if (event.type === 'execution_completed') return;

  if (!('blockId' in event)) return;
  const current = snapshots.get(event.blockId) ?? emptySnapshot(event.blockId);
  const next = projectBlockRuntimeEvent(event, current);
  if (next === undefined) return;

  snapshots.set(event.blockId, next);
  onEvent({
    type: 'block_updated',
    runId: event.runId,
    block: next,
  });
}

export async function reportExecutionCompletion(
  execution: Promise<WorkflowExecutionResult>,
  runId: string,
  onEvent: EventSink,
): Promise<void> {
  try {
    const result = await execution;
    onEvent({
      type: 'run_completed',
      runId: result.runId,
      outcome: result.outcome,
      endedAt: result.completedAt,
    });
  } catch (error) {
    onEvent({
      type: 'run_completed',
      runId,
      outcome: 'failed',
      endedAt: new Date().toISOString(),
      error: {
        code: 'execution_coordinator_failed',
        message: error instanceof Error ? error.message : String(error),
        nextAction:
          'Review workflow validation and application logs, then retry the run.',
      },
    });
  }
}

export function projectBlockRuntimeEvent(
  event: RuntimeEvent,
  current: BlockRunSnapshot,
): BlockRunSnapshot | undefined {
  if (!('blockId' in event)) return undefined;
  let next = current;

  if (event.type === 'block_state_changed') {
    next = {
      ...current,
      state: event.to,
      ...(event.to === 'running' ? { startedAt: event.occurredAt } : {}),
      ...(isTerminal(event.to) ? { endedAt: event.occurredAt } : {}),
      ...(event.failure === undefined ? {} : { failure: event.failure }),
      ...(event.skipReason === undefined
        ? {}
        : { skipReason: event.skipReason.message }),
    };
  }
  if (event.type === 'block_inputs_resolved') {
    next = { ...current, inputs: event.inputs };
  }
  if (event.type === 'block_outputs_produced') {
    next = { ...current, artifacts: Object.values(event.outputs) };
  }
  if (event.type === 'block_stdout') {
    next = { ...current, stdout: `${current.stdout}${event.text}` };
  }
  if (event.type === 'block_stderr') {
    next = { ...current, stderr: `${current.stderr}${event.text}` };
  }
  if (event.type === 'block_completed') {
    next = {
      ...current,
      state: event.state,
      exitCode: event.exitCode,
      endedAt: event.occurredAt,
      ...(event.failure === undefined ? {} : { failure: event.failure }),
      ...(event.skipReason === undefined
        ? {}
        : { skipReason: event.skipReason.message }),
    };
  }

  return next;
}

function emptySnapshot(blockId: string): BlockRunSnapshot {
  return {
    blockId,
    state: 'queued',
    inputs: {} as Readonly<Record<string, Artifact>>,
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: null,
  };
}

function isTerminal(state: string): boolean {
  return (
    state === 'succeeded' ||
    state === 'failed' ||
    state === 'skipped' ||
    state === 'cancelled'
  );
}
