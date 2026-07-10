import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileAgentBlock,
  type AgentBlockEditorConfig,
} from '../src/shared/agent-runtime';
import { AgentBlockInspector } from '../src/renderer/src/AgentBlockInspector';

afterEach(cleanup);

describe('AI Agent block editor', () => {
  it('recompiles exact instructions and visible workspace authority', () => {
    const block = compileAgentBlock(config());
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={block}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText('Agent instruction'), {
      target: { value: 'Create the exact report.' },
    });
    const instructionBlock = onChange.mock.calls.at(-1)?.[0];
    expect(instructionBlock.invocation.arguments.at(-1)).toEqual({
      type: 'literal',
      value: 'Create the exact report.',
    });

    fireEvent.change(getByLabelText('Agent authority'), {
      target: { value: 'workspace-write' },
    });
    const authorityBlock = onChange.mock.calls.at(-1)?.[0];
    expect(
      authorityBlock.invocation.arguments.map(
        (argument: { type: string; value?: string }) => argument.value,
      ),
    ).toContain('workspace-write');
    expect(authorityBlock.invocation.shell).toBe(false);
  });

  it('adds declared filesystem outputs without creating them implicitly', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Add' }));
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.outputs).toContainEqual(
      expect.objectContaining({ artifactKind: 'filesystem-reference' }),
    );
    expect(next.invocation.outputs).toContainEqual(
      expect.objectContaining({ type: 'filesystem', entity: 'file' }),
    );
  });
});

function config(): AgentBlockEditorConfig {
  return {
    id: 'agent',
    name: 'Agent',
    agentRuntime: 'codex',
    instruction: 'Respond with text.',
    authority: 'read-only',
    textResponse: { portId: 'response', name: 'Response' },
    filesystemOutputs: [],
  };
}
