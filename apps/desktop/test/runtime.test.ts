import { describe, expect, it, vi, type Mock } from 'vitest';
import type { RuntimeEvent, WorkflowExecutionResult } from '@vorchestra/engine';
import { ActiveRunRegistry } from '../src/main/run-registry';
import {
  projectBlockRuntimeEvent,
  reportExecutionCompletion,
  type ActiveRun,
} from '../src/main/runtime';
import type {
  BlockRunSnapshot,
  DesktopRunEvent,
} from '../src/shared/contracts';

describe('desktop runtime projection', () => {
  it('projects canonical block_completed details into the UI snapshot', () => {
    const event: RuntimeEvent = {
      type: 'block_completed',
      runId: 'run-1',
      sequence: 9,
      occurredAt: '2026-07-09T20:00:01.000Z',
      blockId: 'build',
      state: 'failed',
      exitCode: 2,
      failure: {
        code: 'process_exit_nonzero',
        message: 'Process exited with code 2.',
        exitCode: 2,
      },
    };

    expect(projectBlockRuntimeEvent(event, queuedSnapshot('build'))).toEqual(
      expect.objectContaining({
        blockId: 'build',
        state: 'failed',
        exitCode: 2,
        endedAt: event.occurredAt,
        failure: event.failure,
      }),
    );
  });

  it('turns unexpected coordinator rejection into one terminal event', async () => {
    const events: DesktopRunEvent[] = [];

    await reportExecutionCompletion(
      Promise.reject(new Error('coordinator exploded')),
      'run-failed',
      (event) => events.push(event),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'run_completed',
      runId: 'run-failed',
      outcome: 'failed',
      error: {
        code: 'execution_coordinator_failed',
        message: 'coordinator exploded',
      },
    });
  });

  it('forwards successful coordinator completion', async () => {
    const events: DesktopRunEvent[] = [];
    const result = {
      runId: 'run-ok',
      outcome: 'succeeded',
      completedAt: '2026-07-09T20:00:02.000Z',
    } as WorkflowExecutionResult;

    await reportExecutionCompletion(
      Promise.resolve(result),
      'run-ok',
      (event) => events.push(event),
    );

    expect(events).toEqual([
      {
        type: 'run_completed',
        runId: 'run-ok',
        outcome: 'succeeded',
        endedAt: result.completedAt,
      },
    ]);
  });
});

describe('active run registry', () => {
  it.each(['resolve', 'reject'] as const)(
    'cleans up tracked runs after completion %s',
    async (settlement) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const completion = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const run: ActiveRun = {
        runId: `run-${settlement}`,
        cancel: vi.fn(),
        completion,
      };
      const registry = new ActiveRunRegistry();

      registry.track(run);
      expect(registry.size).toBe(1);
      if (settlement === 'resolve') resolve();
      else reject(new Error('failed'));
      await completion.catch(() => undefined);
      await Promise.resolve();

      expect(registry.size).toBe(0);
    },
  );

  it('cancels one run or every active run', () => {
    const first = fakeRun('first');
    const second = fakeRun('second');
    const registry = new ActiveRunRegistry();
    registry.track(first);
    registry.track(second);

    registry.cancel('first');
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(second.cancel).not.toHaveBeenCalled();

    registry.cancelAll();
    expect(first.cancel).toHaveBeenCalledTimes(2);
    expect(second.cancel).toHaveBeenCalledOnce();
  });
});

function queuedSnapshot(blockId: string): BlockRunSnapshot {
  return {
    blockId,
    state: 'queued',
    inputs: {},
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: null,
  };
}

function fakeRun(runId: string): ActiveRun & { cancel: Mock<() => void> } {
  return {
    runId,
    cancel: vi.fn(),
    completion: new Promise(() => undefined),
  };
}
