import { memo } from 'react';
import {
  Handle,
  NodeToolbar,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { BlockExecutionState, ProcessBlock } from '@vorchestra/engine';
import { Bot, Box, ClipboardPaste, Copy, TerminalSquare } from 'lucide-react';
import type { AgentRuntimeId } from '../../shared/agent-runtime';

export interface ProcessNodeData extends Record<string, unknown> {
  readonly block: ProcessBlock;
  readonly status: BlockExecutionState | 'idle';
  readonly agentRuntime?: AgentRuntimeId;
}

export type ProcessFlowNode = Node<ProcessNodeData, 'process'>;

export interface ProcessNodeActions {
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly pasteDisabled: boolean;
}

export const ProcessNode = memo(function ProcessNode({
  data,
  selected,
  onCopy,
  onPaste,
  pasteDisabled,
}: NodeProps<ProcessFlowNode> & ProcessNodeActions) {
  const { agentRuntime, block, status } = data;
  return (
    <>
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="node-action-toolbar"
      >
        <button
          type="button"
          className="node-action-button nodrag nowheel"
          aria-label="Copy block"
          title="Copy block"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          className="node-action-button nodrag nowheel"
          aria-label="Paste block"
          title="Paste block at the canvas pointer"
          disabled={pasteDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onPaste();
          }}
        >
          <ClipboardPaste size={13} />
        </button>
      </NodeToolbar>
      <article
        className={`process-node state-${status} ${selected ? 'selected' : ''}`}
        aria-label={`${agentRuntime === undefined ? 'Process' : 'AI Agent'} ${block.name}, ${status}`}
      >
        <div className="node-accent" />
        <header>
          <span className="node-icon">
            {agentRuntime === undefined ? (
              <TerminalSquare size={14} />
            ) : (
              <Bot size={14} />
            )}
          </span>
          <span className="node-title">{block.name}</span>
          <span
            className={`status-dot ${status}`}
            title={status}
            aria-hidden="true"
          />
        </header>
        <div className="node-command">
          <code>{block.invocation.executable}</code>
          {agentRuntime !== undefined && (
            <span className="agent-runtime-pill">{agentRuntime}</span>
          )}
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
    </>
  );
});

function kindLabel(kind: string): string {
  if (kind === 'filesystem-reference') return 'file';
  return kind;
}
