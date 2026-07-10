import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeWorkflow,
  InvalidWorkflowError,
  parseWorkflowDefinition,
  type Artifact,
  type ArtifactKind,
  type InputPort,
  type JsonValue,
  type OutputPort,
  type ProcessBlock,
  type ProcessRunner,
  type ProcessRunRequest,
  type ProcessRunResult,
  type RuntimeEvent,
  type WorkflowDefinition,
} from '../src/index.js';

test('resolves artifacts into process inputs and routes every v0.1 artifact kind', async () => {
  const textSource = processBlock(
    'text-source',
    [],
    [outputPort('text', 'text')],
  );
  textSource.invocation.outputs = [{ type: 'stderr', portId: 'text' }];
  const jsonSource = processBlock(
    'json-source',
    [],
    [outputPort('data', 'json')],
  );
  const fileSource = processBlock(
    'file-source',
    [],
    [outputPort('folder', 'filesystem-reference')],
  );
  fileSource.invocation.outputs = [
    {
      type: 'filesystem',
      portId: 'folder',
      path: '/workspace/output',
      entity: 'directory',
    },
  ];
  const sink = processBlock(
    'sink',
    [
      inputPort('text', 'text'),
      inputPort('data', 'json'),
      inputPort('folder', 'filesystem-reference'),
    ],
    [],
  );
  sink.invocation.arguments = [
    { type: 'literal', value: '--text' },
    { type: 'input', portId: 'text' },
    { type: 'input', portId: 'data' },
    { type: 'input', portId: 'folder' },
  ];
  sink.invocation.stdin = { portId: 'text' };
  sink.invocation.environment = {
    STATIC: { source: 'literal', value: 'fixed' },
    TOKEN: { source: 'host', name: 'VORCHESTRA_TEST_TOKEN' },
    JSON_INPUT: { source: 'input', portId: 'data' },
  };

  const workflow = workflowWith(
    [textSource, jsonSource, fileSource, sink],
    [
      connection('text-sink', 'text-source', 'text', 'sink', 'text'),
      connection('json-sink', 'json-source', 'data', 'sink', 'data'),
      connection('file-sink', 'file-source', 'folder', 'sink', 'folder'),
    ],
  );
  const requests: ProcessRunRequest[] = [];
  const runner = runnerFrom(async (request) => {
    requests.push(request);
    switch (request.blockId) {
      case 'text-source':
        return succeeded(request, { stderr: 'hello from stderr' });
      case 'json-source':
        return succeeded(request, { stdout: '{"answer":42}' });
      default:
        return succeeded(request);
    }
  });
  const observed: RuntimeEvent[] = [];

  const result = await executeWorkflow(workflow, runner, {
    runId: 'run-routing',
    hostEnvironment: { VORCHESTRA_TEST_TOKEN: 'local-secret' },
    onEvent: (event) => observed.push(event),
  });

  assert.equal(result.outcome, 'succeeded');
  assert.deepEqual(
    requests
      .slice(0, 3)
      .map((request) => request.blockId)
      .sort(),
    ['file-source', 'json-source', 'text-source'],
  );
  const sinkRequest = requests.find((request) => request.blockId === 'sink');
  assert.ok(sinkRequest);
  assert.deepEqual(sinkRequest.arguments, [
    '--text',
    'hello from stderr',
    '{"answer":42}',
    '/workspace/output',
  ]);
  assert.equal(sinkRequest.stdin, 'hello from stderr');
  assert.deepEqual(
    { ...sinkRequest.environment },
    {
      STATIC: 'fixed',
      TOKEN: 'local-secret',
      JSON_INPUT: '{"answer":42}',
    },
  );
  assert.deepEqual(sinkRequest.outputs, []);

  assert.equal(result.blocks['text-source']?.outputs.text?.kind, 'text');
  assert.deepEqual(result.blocks['json-source']?.outputs.data, {
    id: 'run-routing:json-source:data',
    kind: 'json',
    value: { answer: 42 },
    provenance: {
      runId: 'run-routing',
      blockId: 'json-source',
      portId: 'data',
      createdAt: 'runner-time',
    },
  });
  assert.deepEqual(result.blocks['file-source']?.outputs.folder, {
    id: 'run-routing:file-source:folder',
    kind: 'filesystem-reference',
    path: '/workspace/output',
    entity: 'directory',
    provenance: {
      runId: 'run-routing',
      blockId: 'file-source',
      portId: 'folder',
      createdAt: 'runner-time',
    },
  });
  assert.equal(result.blocks.sink?.inputs.data?.kind, 'json');
  const sinkCompletion = result.events.find(
    (event) => event.type === 'block_completed' && event.blockId === 'sink',
  );
  assert.equal(sinkCompletion?.type, 'block_completed');
  assert.equal(sinkCompletion?.state, 'succeeded');
  assert.equal(sinkCompletion?.exitCode, 0);
  assert.deepEqual(result.events, observed);
  assert.deepEqual(
    result.events.map((event) => event.sequence),
    result.events.map((_, index) => index),
  );
  assert.equal(
    result.events.filter((event) => event.type === 'block_queued').length,
    4,
  );
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'block_inputs_resolved' && event.blockId === 'sink',
    ),
  );
});

test('starts a downstream block as soon as its own dependency succeeds', async () => {
  const aGate = deferred<void>();
  const bGate = deferred<void>();
  const started: string[] = [];
  const workflow = workflowWith(
    [
      processBlock('a', [], [outputPort('out')]),
      processBlock('b', [], []),
      processBlock('after-a', [inputPort('in')], []),
    ],
    [connection('a-after', 'a', 'out', 'after-a', 'in')],
  );
  const runner = runnerFrom(async (request) => {
    started.push(request.blockId);
    if (request.blockId === 'a') {
      await aGate.promise;
    }
    if (request.blockId === 'b') {
      await bGate.promise;
    }
    return succeeded(request, { stdout: 'a-value' });
  });

  const execution = executeWorkflow(workflow, runner, {
    runId: 'run-parallel',
  });
  await nextTurn();
  assert.deepEqual(started.sort(), ['a', 'b']);

  aGate.resolve();
  await nextTurn();
  assert.ok(started.includes('after-a'));

  bGate.resolve();
  const result = await execution;
  assert.equal(result.outcome, 'succeeded');
});

test('skips downstream work after failure while independent branches finish', async () => {
  const calls: string[] = [];
  const workflow = workflowWith(
    [
      processBlock('fails', [], [outputPort('out')]),
      processBlock('child', [inputPort('in')], []),
      processBlock('independent', [], []),
    ],
    [connection('fails-child', 'fails', 'out', 'child', 'in')],
  );
  const runner = runnerFrom(async (request) => {
    calls.push(request.blockId);
    if (request.blockId === 'fails') {
      return {
        status: 'failed',
        exitCode: 2,
        stdout: '',
        stderr: 'bad input',
        artifacts: [],
        failure: {
          code: 'process_exit_nonzero',
          message: 'Process exited with code 2.',
          exitCode: 2,
        },
      };
    }
    return succeeded(request);
  });

  const result = await executeWorkflow(workflow, runner, {
    runId: 'run-failure',
  });

  assert.equal(result.outcome, 'failed');
  assert.deepEqual(calls.sort(), ['fails', 'independent']);
  assert.equal(result.blocks.fails?.state, 'failed');
  assert.equal(result.blocks.independent?.state, 'succeeded');
  assert.equal(result.blocks.child?.state, 'skipped');
  assert.deepEqual(result.blocks.child?.skipReason, {
    code: 'upstream_failed',
    message: 'Required upstream block fails did not succeed.',
    upstreamBlockIds: ['fails'],
  });
  const failureCompletion = result.events.find(
    (event) => event.type === 'block_completed' && event.blockId === 'fails',
  );
  assert.equal(failureCompletion?.type, 'block_completed');
  assert.equal(failureCompletion?.state, 'failed');
  assert.equal(failureCompletion?.exitCode, 2);
  assert.equal(failureCompletion?.failure?.code, 'process_exit_nonzero');
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'block_stderr' &&
        event.blockId === 'fails' &&
        event.text === 'bad input',
    ),
  );
});

test('propagates invalid JSON failures from the process boundary', async () => {
  const workflow = workflowWith(
    [
      processBlock('json', [], [outputPort('out', 'json')]),
      processBlock('child', [inputPort('in', 'json')], []),
    ],
    [connection('json-child', 'json', 'out', 'child', 'in')],
  );
  const runner = runnerFrom(async (request) => {
    if (request.blockId === 'json') {
      return {
        status: 'failed',
        exitCode: 0,
        stdout: 'not-json',
        stderr: '',
        artifacts: [],
        failure: {
          code: 'invalid_json_output',
          message: 'stdout was not valid JSON',
        },
      };
    }
    return succeeded(request);
  });

  const result = await executeWorkflow(workflow, runner, {
    runId: 'run-invalid-json',
  });

  assert.equal(result.blocks.json?.failure?.code, 'invalid_json_output');
  assert.equal(result.blocks.child?.state, 'skipped');
});

test('cancels active work and skips its downstream blocks', async () => {
  const controller = new AbortController();
  let rootStarted = false;
  const workflow = workflowWith(
    [
      processBlock('root', [], [outputPort('out')]),
      processBlock('child', [inputPort('in')], []),
    ],
    [connection('root-child', 'root', 'out', 'child', 'in')],
  );
  const runner = runnerFrom(
    (request, signal) =>
      new Promise<ProcessRunResult>((resolve) => {
        rootStarted = true;
        const cancel = (): void =>
          resolve({
            status: 'cancelled',
            exitCode: null,
            stdout: '',
            stderr: '',
            artifacts: [],
          });
        if (signal.aborted) {
          cancel();
        } else {
          signal.addEventListener('abort', cancel, { once: true });
        }
        assert.equal(request.blockId, 'root');
      }),
  );

  const execution = executeWorkflow(workflow, runner, {
    runId: 'run-cancel',
    signal: controller.signal,
  });
  await nextTurn();
  assert.equal(rootStarted, true);
  controller.abort();
  const result = await execution;

  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.blocks.root?.state, 'cancelled');
  assert.equal(result.blocks.child?.state, 'skipped');
  assert.equal(result.blocks.child?.skipReason?.code, 'upstream_cancelled');
  const cancellationCompletion = result.events.find(
    (event) => event.type === 'block_completed' && event.blockId === 'root',
  );
  assert.equal(cancellationCompletion?.type, 'block_completed');
  assert.equal(cancellationCompletion?.state, 'cancelled');
  assert.equal(cancellationCompletion?.exitCode, null);
  assert.equal(
    result.events.filter((event) => event.type === 'execution_cancel_requested')
      .length,
    1,
  );
});

test('cancellation wins when an abort race returns an ordinary process failure', async () => {
  const controller = new AbortController();
  const workflow = workflowWith(
    [
      processBlock('root', [], [outputPort('out')]),
      processBlock('child', [inputPort('in')], []),
    ],
    [connection('root-child', 'root', 'out', 'child', 'in')],
  );
  const runner = runnerFrom(
    (_request, signal) =>
      new Promise<ProcessRunResult>((resolve) => {
        signal.addEventListener(
          'abort',
          () =>
            resolve({
              status: 'failed',
              exitCode: 143,
              stdout: '',
              stderr: 'terminated',
              artifacts: [],
              failure: {
                code: 'process_exit_nonzero',
                message: 'Process exited during termination.',
                exitCode: 143,
              },
            }),
          { once: true },
        );
      }),
  );

  const execution = executeWorkflow(workflow, runner, {
    runId: 'run-abort-race',
    signal: controller.signal,
  });
  await nextTurn();
  controller.abort();
  const result = await execution;

  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.blocks.root?.state, 'cancelled');
  assert.equal(result.blocks.root?.failure, undefined);
  assert.equal(result.blocks.child?.state, 'skipped');
  assert.equal(result.blocks.child?.skipReason?.code, 'upstream_cancelled');
  const completion = result.events.find(
    (event) => event.type === 'block_completed' && event.blockId === 'root',
  );
  assert.equal(completion?.type, 'block_completed');
  assert.equal(completion?.state, 'cancelled');
  assert.equal(completion?.exitCode, 143);
});

test('preserves a process termination failure after cancellation', async () => {
  const controller = new AbortController();
  const block = processBlock('root', [], []);
  const runner = runnerFrom(
    (_request, signal) =>
      new Promise<ProcessRunResult>((resolve) => {
        signal.addEventListener(
          'abort',
          () =>
            resolve({
              status: 'failed',
              exitCode: null,
              stdout: '',
              stderr: '',
              artifacts: [],
              failure: {
                code: 'process_termination_failed',
                message: 'The child process could not be terminated.',
              },
            }),
          { once: true },
        );
      }),
  );

  const execution = executeWorkflow(workflowWith([block]), runner, {
    runId: 'run-termination-failure',
    signal: controller.signal,
  });
  await nextTurn();
  controller.abort();
  const result = await execution;

  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.blocks.root?.state, 'failed');
  assert.equal(result.blocks.root?.failure?.code, 'process_termination_failed');
  const completion = result.events.find(
    (event) => event.type === 'block_completed' && event.blockId === 'root',
  );
  assert.equal(completion?.type, 'block_completed');
  assert.equal(completion?.state, 'failed');
  assert.equal(completion?.failure?.code, 'process_termination_failed');
});

test('fails actionably when a declared host environment value is missing', async () => {
  let calls = 0;
  const block = processBlock('needs-env', [], []);
  block.invocation.environment = {
    API_TOKEN: { source: 'host', name: 'MISSING_TOKEN' },
  };
  const runner = runnerFrom(async (request) => {
    calls += 1;
    return succeeded(request);
  });

  const result = await executeWorkflow(workflowWith([block]), runner, {
    runId: 'run-env',
  });

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'failed');
  assert.equal(
    result.blocks['needs-env']?.failure?.code,
    'host_environment_variable_missing',
  );
  assert.match(
    result.blocks['needs-env']?.failure?.nextAction ?? '',
    /MISSING_TOKEN/,
  );
});

test('omits unconnected optional input bindings from args, stdin, and environment', async () => {
  const block = processBlock(
    'optional',
    [inputPort('maybe', 'text', false)],
    [],
  );
  block.invocation.arguments = [
    { type: 'literal', value: 'always' },
    { type: 'input', portId: 'maybe' },
  ];
  block.invocation.stdin = { portId: 'maybe' };
  block.invocation.environment = {
    OPTIONAL: { source: 'input', portId: 'maybe' },
  };
  let resolvedRequest: ProcessRunRequest | undefined;
  const runner = runnerFrom(async (request) => {
    resolvedRequest = request;
    return succeeded(request);
  });

  const result = await executeWorkflow(workflowWith([block]), runner, {
    runId: 'run-optional',
  });

  assert.equal(result.outcome, 'succeeded');
  assert.deepEqual(resolvedRequest?.arguments, ['always']);
  assert.equal(resolvedRequest?.stdin, undefined);
  assert.deepEqual(Object.keys(resolvedRequest?.environment ?? {}), []);
});

test('rejects malformed runner artifacts instead of routing them', async () => {
  const block = processBlock('source', [], [outputPort('out')]);
  const runner = runnerFrom(async () => ({
    status: 'succeeded',
    exitCode: 0,
    stdout: 'value',
    stderr: '',
    artifacts: [textArtifact('run-artifact', 'source', 'wrong-port', 'value')],
  }));

  const result = await executeWorkflow(workflowWith([block]), runner, {
    runId: 'run-artifact',
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.blocks.source?.failure?.code, 'artifact_routing_failed');
  assert.deepEqual(Object.keys(result.blocks.source?.outputs ?? {}), []);
});

test('rejects an invalid workflow before invoking the runner', async () => {
  let calls = 0;
  const runner = runnerFrom(async (request) => {
    calls += 1;
    return succeeded(request);
  });
  const workflow = workflowWith([
    processBlock('invalid', [inputPort('required')], []),
  ]);

  await assert.rejects(
    executeWorkflow(workflow, runner),
    (error: unknown) => error instanceof InvalidWorkflowError,
  );
  assert.equal(calls, 0);
});

test('preserves and executes prototype-like generic block and port IDs', async () => {
  const source = processBlock('__proto__', [], [outputPort('constructor')]);
  const target = processBlock('toString', [inputPort('prototype')], []);
  const serialized = workflowWith(
    [source, target],
    [
      connection(
        'prototype-route',
        '__proto__',
        'constructor',
        'toString',
        'prototype',
      ),
    ],
  );
  serialized.layout = {
    blockPositions: JSON.parse(
      '{"__proto__":{"x":10,"y":20},"toString":{"x":30,"y":40}}',
    ) as Record<string, { x: number; y: number }>,
  };
  const workflow = parseWorkflowDefinition(serialized);

  assert.equal(
    Object.hasOwn(workflow.layout?.blockPositions ?? {}, '__proto__'),
    true,
  );
  assert.match(JSON.stringify(workflow), /"__proto__"/);

  const runner = runnerFrom(async (request) =>
    succeeded(request, { stdout: 'reserved-looking value' }),
  );
  const result = await executeWorkflow(workflow, runner, {
    runId: 'reserved-id-run',
  });

  assert.equal(result.outcome, 'succeeded');
  assert.equal(Object.hasOwn(result.blocks, '__proto__'), true);
  assert.equal(Object.hasOwn(result.blocks, 'toString'), true);
  assert.equal(
    Object.hasOwn(result.blocks['__proto__']?.outputs ?? {}, 'constructor'),
    true,
  );
  assert.equal(
    Object.hasOwn(result.blocks['toString']?.inputs ?? {}, 'prototype'),
    true,
  );
  const serializedResults = JSON.parse(JSON.stringify(result.blocks)) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(serializedResults), ['__proto__', 'toString']);
});

test('event observers cannot mutate nested artifacts or execution semantics', async () => {
  const source = processBlock('source', [], [outputPort('data', 'json')]);
  const sink = processBlock('sink', [inputPort('data', 'json')], []);
  const workflow = workflowWith(
    [source, sink],
    [connection('source-sink', 'source', 'data', 'sink', 'data')],
  );
  let sinkRequest: ProcessRunRequest | undefined;
  const runner = runnerFrom(async (request) => {
    if (request.blockId === 'sink') {
      sinkRequest = request;
      return succeeded(request);
    }
    return succeeded(request, {
      stdout: '{"nested":{"value":"safe"}}',
    });
  });

  const result = await executeWorkflow(workflow, runner, {
    runId: 'observer-isolation',
    onEvent: (event) => {
      if (
        (event.type === 'block_outputs_produced' ||
          event.type === 'block_inputs_resolved') &&
        event.blockId ===
          (event.type === 'block_outputs_produced' ? 'source' : 'sink')
      ) {
        const artifacts =
          event.type === 'block_outputs_produced'
            ? event.outputs
            : event.inputs;
        const artifact = artifacts.data;
        if (artifact?.kind === 'json') {
          const value = artifact.value as {
            nested: { value: string };
          };
          value.nested.value = 'PWNED';
        }
      }
    },
  });

  assert.deepEqual(sinkRequest?.arguments, ['{"nested":{"value":"safe"}}']);
  const sourceArtifact = result.blocks.source?.outputs.data;
  assert.equal(sourceArtifact?.kind, 'json');
  assert.deepEqual(sourceArtifact?.value, { nested: { value: 'safe' } });
  const outputEvent = result.events.find(
    (event) =>
      event.type === 'block_outputs_produced' && event.blockId === 'source',
  );
  assert.equal(outputEvent?.type, 'block_outputs_produced');
  const eventArtifact = outputEvent?.outputs.data;
  assert.equal(eventArtifact?.kind, 'json');
  assert.deepEqual(eventArtifact?.value, { nested: { value: 'safe' } });
  assert.equal(Object.isFrozen(outputEvent), true);
  assert.equal(Object.isFrozen(eventArtifact), true);
  assert.equal(
    eventArtifact?.kind === 'json' &&
      typeof eventArtifact.value === 'object' &&
      eventArtifact.value !== null
      ? Object.isFrozen(eventArtifact.value)
      : false,
    true,
  );
});

function runnerFrom(
  handler: (
    request: ProcessRunRequest,
    signal: AbortSignal,
  ) => Promise<ProcessRunResult>,
): ProcessRunner {
  return {
    run: (request, options) => handler(request, options.signal),
  };
}

function succeeded(
  request: ProcessRunRequest,
  streams: { readonly stdout?: string; readonly stderr?: string } = {},
): ProcessRunResult {
  const stdout = streams.stdout ?? '';
  const stderr = streams.stderr ?? '';
  const artifacts = request.outputs.map((output): Artifact => {
    const value =
      'source' in output && output.source === 'stderr' ? stderr : stdout;
    if (output.kind === 'filesystem-reference') {
      return {
        id: `${request.runId}:${request.blockId}:${output.portId}`,
        kind: 'filesystem-reference',
        path: output.path,
        entity: output.entity ?? 'unknown',
        provenance: provenance(request, output.portId),
      };
    }
    if (output.kind === 'text') {
      return textArtifact(request.runId, request.blockId, output.portId, value);
    }
    return {
      id: `${request.runId}:${request.blockId}:${output.portId}`,
      kind: 'json',
      value: JSON.parse(value) as JsonValue,
      provenance: provenance(request, output.portId),
    };
  });
  return { status: 'succeeded', exitCode: 0, stdout, stderr, artifacts };
}

function textArtifact(
  runId: string,
  blockId: string,
  portId: string,
  value: string,
): Artifact {
  return {
    id: `${runId}:${blockId}:${portId}`,
    kind: 'text',
    value,
    provenance: { runId, blockId, portId, createdAt: 'runner-time' },
  };
}

function provenance(request: ProcessRunRequest, portId: string) {
  return {
    runId: request.runId,
    blockId: request.blockId,
    portId,
    createdAt: 'runner-time',
  };
}

function workflowWith(
  blocks: ProcessBlock[],
  connections: WorkflowDefinition['connections'] = [],
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'execution-workflow',
    name: 'Execution workflow',
    blocks,
    connections,
  };
}

function processBlock(
  id: string,
  inputs: InputPort[],
  outputs: OutputPort[],
): ProcessBlock {
  return {
    id,
    name: id,
    kind: 'process',
    inputs,
    outputs,
    invocation: {
      executable: `fixture-${id}`,
      arguments: inputs.map((input) => ({
        type: 'input' as const,
        portId: input.id,
      })),
      environment: {},
      shell: false,
      outputs: outputs.map((output) =>
        output.artifactKind === 'filesystem-reference'
          ? {
              type: 'filesystem' as const,
              portId: output.id,
              path: `/fixture/${output.id}`,
            }
          : { type: 'stdout' as const, portId: output.id },
      ),
    },
  };
}

function inputPort(
  id: string,
  artifactKind: ArtifactKind = 'text',
  required = true,
): InputPort {
  return { id, name: id, artifactKind, required };
}

function outputPort(
  id: string,
  artifactKind: ArtifactKind = 'text',
): OutputPort {
  return { id, name: id, artifactKind };
}

function connection(
  id: string,
  sourceBlockId: string,
  sourcePortId: string,
  targetBlockId: string,
  targetPortId: string,
): WorkflowDefinition['connections'][number] {
  return {
    id,
    from: { blockId: sourceBlockId, portId: sourcePortId },
    to: { blockId: targetBlockId, portId: targetPortId },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
