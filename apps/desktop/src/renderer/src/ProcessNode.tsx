import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { BlockExecutionState, ProcessBlock } from '@vorchestra/engine';
import { Box, TerminalSquare } from 'lucide-react';

export interface ProcessNodeData extends Record<string, unknown> {
  readonly block: ProcessBlock;
  readonly status: BlockExecutionState | 'idle';
}

export type ProcessFlowNode = Node<ProcessNodeData, 'process'>;

export const ProcessNode = memo(function ProcessNode({
  data,
  selected,
}: NodeProps<ProcessFlowNode>) {
  const { block, status } = data;
  return (
    <article
      className={`process-node state-${status} ${selected ? 'selected' : ''}`}
    >
      <div className="node-accent" />
      <header>
        <span className="node-icon">
          <TerminalSquare size={14} />
        </span>
        <span className="node-title">{block.name}</span>
        <span className={`status-dot ${status}`} title={status} />
      </header>
      <div className="node-command">
        <code>{block.invocation.executable}</code>
        {block.invocation.shell && <span className="shell-pill">shell</span>}
      </div>
      <div className="ports inputs">
        {block.inputs.map((port) => (
          <div className="port-row input-port" key={port.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              className={`flow-handle kind-${port.artifactKind}`}
            />
            <span>{port.name}</span>
            <small>{kindLabel(port.artifactKind)}</small>
          </div>
        ))}
      </div>
      <div className="ports outputs">
        {block.outputs.map((port) => (
          <div className="port-row output-port" key={port.id}>
            <small>{kindLabel(port.artifactKind)}</small>
            <span>{port.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              className={`flow-handle kind-${port.artifactKind}`}
            />
          </div>
        ))}
      </div>
      {block.inputs.length === 0 && block.outputs.length === 0 && (
        <div className="node-empty">
          <Box size={13} /> No ports
        </div>
      )}
    </article>
  );
});

function kindLabel(kind: string): string {
  if (kind === 'filesystem-reference') return 'file';
  return kind;
}
