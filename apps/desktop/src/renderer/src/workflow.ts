import type {
  ArtifactKind,
  BlockExecutionState,
  Connection,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorchestra/engine';
import type { ProcessFlowNode } from './ProcessNode';

export function moveListItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const reordered = [...items];
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= reordered.length ||
    toIndex >= reordered.length
  ) {
    return reordered;
  }

  const [item] = reordered.splice(fromIndex, 1);
  if (item !== undefined) reordered.splice(toIndex, 0, item);
  return reordered;
}

export function moveRecordEntry<T>(
  record: Readonly<Record<string, T>>,
  fromIndex: number,
  toIndex: number,
): Record<string, T> {
  return Object.fromEntries(
    moveListItem(Object.entries(record), fromIndex, toIndex),
  );
}

export function reconcileProcessNodes(
  workflow: WorkflowDefinition,
  currentNodes: readonly ProcessFlowNode[],
  statusForBlock: (blockId: string) => BlockExecutionState | 'idle',
): ProcessFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return workflow.blocks.map((block, index) => {
    const current = currentById.get(block.id);
    return {
      ...current,
      id: block.id,
      type: 'process',
      position:
        current?.position ??
        workflow.layout?.blockPositions[block.id] ??
        defaultBlockPosition(index),
      data: {
        block,
        status: statusForBlock(block.id),
      },
    };
  });
}

export function setBlockPosition(
  workflow: WorkflowDefinition,
  blockId: string,
  position: { readonly x: number; readonly y: number },
): WorkflowDefinition {
  return {
    ...workflow,
    layout: {
      blockPositions: {
        ...(workflow.layout?.blockPositions ?? {}),
        [blockId]: position,
      },
    },
  };
}

export function replaceBlock(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
): WorkflowDefinition {
  return {
    ...workflow,
    blocks: workflow.blocks.map((candidate) =>
      candidate.id === block.id ? block : candidate,
    ),
  };
}

export function removeBlock(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  const positions = { ...(workflow.layout?.blockPositions ?? {}) };
  delete positions[blockId];
  return {
    ...workflow,
    blocks: workflow.blocks.filter((block) => block.id !== blockId),
    connections: workflow.connections.filter(
      (connection) =>
        connection.from.blockId !== blockId &&
        connection.to.blockId !== blockId,
    ),
    layout: { blockPositions: positions },
  };
}

export function connectBlocks(
  workflow: WorkflowDefinition,
  sourceBlockId: string,
  sourcePortId: string,
  targetBlockId: string,
  targetPortId: string,
): WorkflowDefinition {
  const connection: Connection = {
    id: crypto.randomUUID(),
    from: { blockId: sourceBlockId, portId: sourcePortId },
    to: { blockId: targetBlockId, portId: targetPortId },
  };
  return { ...workflow, connections: [...workflow.connections, connection] };
}

export function addInputPort(
  block: ProcessBlock,
  artifactKind: ArtifactKind = 'text',
): ProcessBlock {
  const id = uniquePortId(block, 'input');
  return {
    ...block,
    inputs: [...block.inputs, { id, name: id, artifactKind, required: true }],
    invocation: {
      ...block.invocation,
      arguments: [...block.invocation.arguments, { type: 'input', portId: id }],
    },
  };
}

export function addOutputPort(
  block: ProcessBlock,
  artifactKind: ArtifactKind = 'text',
): ProcessBlock {
  const id = uniquePortId(block, 'output');
  return {
    ...block,
    outputs: [...block.outputs, { id, name: id, artifactKind }],
    invocation: {
      ...block.invocation,
      outputs: [
        ...block.invocation.outputs,
        artifactKind === 'filesystem-reference'
          ? { type: 'filesystem' as const, portId: id, path: './output' }
          : { type: 'stdout' as const, portId: id },
      ],
    },
  };
}

export function removeInputPort(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  portId: string,
): WorkflowDefinition {
  return replaceBlock(
    {
      ...workflow,
      connections: workflow.connections.filter(
        (connection) =>
          !(
            connection.to.blockId === block.id &&
            connection.to.portId === portId
          ),
      ),
    },
    {
      ...block,
      inputs: block.inputs.filter((port) => port.id !== portId),
      invocation: {
        ...block.invocation,
        arguments: block.invocation.arguments.filter(
          (argument) =>
            !(argument.type === 'input' && argument.portId === portId),
        ),
        environment: Object.fromEntries(
          Object.entries(block.invocation.environment).filter(
            ([, value]) =>
              !(value.source === 'input' && value.portId === portId),
          ),
        ),
        ...(block.invocation.stdin?.portId === portId
          ? { stdin: undefined }
          : {}),
      },
    },
  );
}

export function removeOutputPort(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  portId: string,
): WorkflowDefinition {
  return replaceBlock(
    {
      ...workflow,
      connections: workflow.connections.filter(
        (connection) =>
          !(
            connection.from.blockId === block.id &&
            connection.from.portId === portId
          ),
      ),
    },
    {
      ...block,
      outputs: block.outputs.filter((port) => port.id !== portId),
      invocation: {
        ...block.invocation,
        outputs: block.invocation.outputs.filter(
          (binding) => binding.portId !== portId,
        ),
      },
    },
  );
}

function uniquePortId(block: ProcessBlock, prefix: string): string {
  const used = new Set([
    ...block.inputs.map((port) => port.id),
    ...block.outputs.map((port) => port.id),
  ]);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function defaultBlockPosition(index: number): { x: number; y: number } {
  return {
    x: 160 + (index % 3) * 310,
    y: 140 + Math.floor(index / 3) * 240,
  };
}
