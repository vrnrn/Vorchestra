import { describe, expect, it } from 'vitest';
import { validateWorkflow, type WorkflowDefinition } from '@vorchestra/engine';
import { createProcessBlock, createWorkflow } from '../src/shared/defaults';
import { parseRunnableWorkflow } from '../src/shared/authority';
import {
  addInputPort,
  addOutputPort,
  connectBlocks,
  removeBlock,
  removeInputPort,
  removeOutputPort,
} from '../src/renderer/src/workflow';

describe('desktop workflow editing', () => {
  it('creates a runnable starter workflow with explicit PATH authority', () => {
    const workflow = createWorkflow();

    expect(validateWorkflow(workflow)).toEqual({ valid: true, issues: [] });
    expect(workflow.blocks[0]?.invocation.environment).toEqual({
      PATH: { source: 'host', name: 'PATH' },
    });
    expect(workflow.layout?.blockPositions.welcome).toEqual({ x: 180, y: 160 });
  });

  it('adds ports together with valid invocation bindings', () => {
    const initial = createProcessBlock('producer');
    const withInput = addInputPort(initial, 'json');
    const withOutput = addOutputPort(withInput, 'filesystem-reference');

    expect(withOutput.inputs[0]).toMatchObject({
      artifactKind: 'json',
      required: true,
    });
    expect(withOutput.invocation.arguments).toContainEqual({
      type: 'input',
      portId: withOutput.inputs[0]?.id,
    });
    expect(withOutput.invocation.outputs.at(-1)).toMatchObject({
      type: 'filesystem',
      portId: withOutput.outputs.at(-1)?.id,
    });
  });

  it('removes block connections and persisted layout atomically', () => {
    const upstream = createProcessBlock('upstream');
    const downstream = addInputPort(createProcessBlock('downstream'));
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [upstream, downstream],
      layout: {
        blockPositions: {
          upstream: { x: 10, y: 20 },
          downstream: { x: 300, y: 20 },
        },
      },
    };
    workflow = connectBlocks(
      workflow,
      'upstream',
      'stdout',
      'downstream',
      downstream.inputs[0]!.id,
    );

    const next = removeBlock(workflow, 'upstream');

    expect(next.blocks.map((block) => block.id)).toEqual(['downstream']);
    expect(next.connections).toHaveLength(0);
    expect(next.layout?.blockPositions).not.toHaveProperty('upstream');
  });

  it('removes port connections and process bindings together', () => {
    const upstream = createProcessBlock('upstream');
    const downstream = addInputPort(createProcessBlock('downstream'));
    const inputId = downstream.inputs[0]!.id;
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [upstream, downstream],
    };
    workflow = connectBlocks(
      workflow,
      'upstream',
      'stdout',
      'downstream',
      inputId,
    );

    const withoutInput = removeInputPort(workflow, downstream, inputId);
    const withoutOutput = removeOutputPort(withoutInput, upstream, 'stdout');

    expect(withoutInput.connections).toHaveLength(0);
    expect(withoutInput.blocks[1]?.invocation.arguments).not.toContainEqual({
      type: 'input',
      portId: inputId,
    });
    expect(withoutOutput.blocks[0]?.outputs).toHaveLength(0);
    expect(withoutOutput.blocks[0]?.invocation.outputs).toHaveLength(0);
  });

  it('leaves cycle detection to the canonical engine validation', () => {
    const first = addInputPort(createProcessBlock('first'));
    const second = addInputPort(createProcessBlock('second'));
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [first, second],
      connections: [],
    };
    workflow = connectBlocks(
      workflow,
      'first',
      'stdout',
      'second',
      second.inputs[0]!.id,
    );
    workflow = connectBlocks(
      workflow,
      'second',
      'stdout',
      'first',
      first.inputs[0]!.id,
    );

    expect(validateWorkflow(workflow).issues).toContainEqual(
      expect.objectContaining({ code: 'cycle_detected' }),
    );
    expect(() => parseRunnableWorkflow(workflow)).toThrow(
      /Workflow is not runnable:[\s\S]*directed acyclic graph/,
    );
  });
});
