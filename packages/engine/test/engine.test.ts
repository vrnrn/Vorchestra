import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExecutionPlan,
  InvalidWorkflowError,
  parseWorkflowDefinition,
  validateWorkflow,
  type ArtifactKind,
  type InputPort,
  type OutputPort,
  type ProcessBlock,
  type WorkflowDefinition,
} from '../src/index.js';

test('parses a versioned workflow and applies safe invocation defaults', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'hello',
    name: 'Hello',
    blocks: [
      {
        id: 'echo',
        name: 'Echo',
        kind: 'process',
        invocation: {
          executable: 'printf',
        },
      },
    ],
    connections: [],
  });

  assert.equal(workflow.blocks[0]?.invocation.shell, false);
  assert.deepEqual(workflow.blocks[0]?.invocation.arguments, []);
  assert.deepEqual(
    Object.keys(workflow.blocks[0]?.invocation.environment ?? {}),
    [],
  );
});

test('rejects unknown serialized fields', () => {
  assert.throws(() =>
    parseWorkflowDefinition({
      schemaVersion: 1,
      id: 'unsafe',
      name: 'Unsafe',
      blocks: [],
      connections: [],
      hiddenCommand: 'rm -rf /',
    }),
  );
});

test('rejects non-portable child and host environment variable names', () => {
  for (const invalidName of [
    'A=B',
    '1TOKEN',
    'HAS-DASH',
    'NULL\0BYTE',
    '__proto__',
    'constructor',
    'prototype',
    'toString',
  ]) {
    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-environment',
        name: 'Invalid environment',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: {
                [invalidName]: { source: 'literal', value: 'value' },
              },
            },
          },
        ],
        connections: [],
      }),
    );

    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-host-environment',
        name: 'Invalid host environment',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: {
                VALID_TARGET: { source: 'host', name: invalidName },
              },
            },
          },
        ],
        connections: [],
      }),
    );
  }

  const declaredProtoBinding = JSON.parse(
    '{"__proto__":{"source":"literal","value":"must-not-disappear"}}',
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(declaredProtoBinding), ['__proto__']);
  assert.throws(() =>
    parseWorkflowDefinition({
      schemaVersion: 1,
      id: 'proto-environment',
      name: 'Proto environment',
      blocks: [
        {
          id: 'process',
          name: 'Process',
          kind: 'process',
          invocation: {
            executable: 'fixture-command',
            environment: declaredProtoBinding,
          },
        },
      ],
      connections: [],
    }),
  );
});

test('accepts portable child and host environment variable names', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'portable-environment',
    name: 'Portable environment',
    blocks: [
      {
        id: 'process',
        name: 'Process',
        kind: 'process',
        invocation: {
          executable: 'fixture-command',
          environment: {
            _PRIVATE: { source: 'literal', value: 'value' },
            TOKEN_2: { source: 'host', name: 'HOST_TOKEN_2' },
          },
        },
      },
    ],
    connections: [],
  });

  assert.deepEqual(
    { ...workflow.blocks[0]?.invocation.environment },
    {
      _PRIVATE: { source: 'literal', value: 'value' },
      TOKEN_2: { source: 'host', name: 'HOST_TOKEN_2' },
    },
  );
});

test('rejects non-record objects for environment and layout records', () => {
  for (const invalidRecord of [new Date(), new Map<string, unknown>()]) {
    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-record',
        name: 'Invalid record',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: invalidRecord,
            },
          },
        ],
        connections: [],
      }),
    );

    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-layout-record',
        name: 'Invalid layout record',
        blocks: [],
        connections: [],
        layout: { blockPositions: invalidRecord },
      }),
    );
  }
});

test('parses explicit stderr and filesystem output declarations', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'declared-outputs',
    name: 'Declared outputs',
    blocks: [
      {
        id: 'producer',
        name: 'Producer',
        kind: 'process',
        outputs: [
          { id: 'diagnostic', name: 'Diagnostic', artifactKind: 'text' },
          {
            id: 'directory',
            name: 'Directory',
            artifactKind: 'filesystem-reference',
          },
        ],
        invocation: {
          executable: 'fixture-command',
          outputs: [
            { type: 'stderr', portId: 'diagnostic' },
            {
              type: 'filesystem',
              portId: 'directory',
              path: '/tmp/output',
              entity: 'directory',
            },
          ],
        },
      },
    ],
    connections: [],
  });

  assert.deepEqual(workflow.blocks[0]?.invocation.outputs, [
    { type: 'stderr', portId: 'diagnostic' },
    {
      type: 'filesystem',
      portId: 'directory',
      path: '/tmp/output',
      entity: 'directory',
    },
  ]);
  assert.equal(validateWorkflow(workflow).valid, true);
});

test('creates stable parallel execution layers for a valid DAG', () => {
  const workflow = workflowWith(
    [
      processBlock('news', [], [outputPort('summary')]),
      processBlock('notes', [], [outputPort('summary')]),
      processBlock(
        'combine',
        [inputPort('news'), inputPort('notes')],
        [outputPort('report')],
      ),
    ],
    [
      connection('news-to-combine', 'news', 'summary', 'combine', 'news'),
      connection('notes-to-combine', 'notes', 'summary', 'combine', 'notes'),
    ],
  );

  assert.deepEqual(createExecutionPlan(workflow).layers, [
    ['news', 'notes'],
    ['combine'],
  ]);
});

test('reports cycles instead of planning them', () => {
  const workflow = workflowWith(
    [
      processBlock('a', [inputPort('in')], [outputPort('out')]),
      processBlock('b', [inputPort('in')], [outputPort('out')]),
    ],
    [
      connection('a-to-b', 'a', 'out', 'b', 'in'),
      connection('b-to-a', 'b', 'out', 'a', 'in'),
    ],
  );

  const validation = validateWorkflow(workflow);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'cycle_detected'));
  assert.throws(
    () => createExecutionPlan(workflow),
    (error: unknown) => error instanceof InvalidWorkflowError,
  );
});

test('reports incompatible artifact kinds', () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('out', 'text')]),
      processBlock('target', [inputPort('in', 'json')], []),
    ],
    [connection('source-to-target', 'source', 'out', 'target', 'in')],
  );

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'incompatible_artifact_kinds',
    ),
  );
});

test('reports required inputs that have no connection', () => {
  const workflow = workflowWith([
    processBlock('target', [inputPort('required')], []),
  ]);

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'required_input_unconnected',
    ),
  );
});

test('tracks required input connections without delimiter collisions', () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('out')]),
      processBlock('a:b', [inputPort('c')], []),
      processBlock('a', [inputPort('b:c')], []),
    ],
    [connection('connected', 'source', 'out', 'a', 'b:c')],
  );

  const validation = validateWorkflow(workflow);

  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === 'required_input_unconnected' &&
        issue.path === 'blocks[1].inputs[0]',
    ),
  );
});

test('requires every declared port to have an invocation binding', () => {
  const block = processBlock('broken', [], [outputPort('result')]);
  block.invocation.outputs = [];
  const workflow = workflowWith([block]);

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some((issue) => issue.code === 'output_port_unbound'),
  );
});

test('rejects multiple output bindings for the same port', () => {
  const block = processBlock('duplicate-binding', [], [outputPort('result')]);
  block.invocation.outputs = [
    { type: 'stdout', portId: 'result' },
    { type: 'stderr', portId: 'result' },
  ];
  const workflow = workflowWith([block]);

  const validation = validateWorkflow(workflow);

  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.issues.find(
      (issue) => issue.code === 'duplicate_output_binding',
    ),
    {
      code: 'duplicate_output_binding',
      message:
        'Output port "result" on block "duplicate-binding" has more than one output binding.',
      path: 'blocks[0].invocation.outputs[1]',
    },
  );
  assert.throws(
    () => createExecutionPlan(workflow),
    (error: unknown) => error instanceof InvalidWorkflowError,
  );
});

function workflowWith(
  blocks: ProcessBlock[],
  connections: WorkflowDefinition['connections'] = [],
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'test-workflow',
    name: 'Test workflow',
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
      executable: 'fixture-command',
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
              path: './fixture-output',
            }
          : { type: 'stdout' as const, portId: output.id },
      ),
    },
  };
}

function inputPort(id: string, artifactKind: ArtifactKind = 'text'): InputPort {
  return { id, name: id, artifactKind, required: true };
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
