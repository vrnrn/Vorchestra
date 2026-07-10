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

  it('selects Codex, Cline, or Antigravity through the runtime registry', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    const runtime = getByLabelText('Agent runtime');
    expect(runtime).not.toBeDisabled();
    expect(getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Cline' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Antigravity' })).toBeInTheDocument();

    fireEvent.change(runtime, { target: { value: 'cline' } });
    expect(onChange.mock.calls.at(-1)?.[0].invocation.executable).toBe('cline');
    expect(onChange.mock.calls.at(-1)?.[1]).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'cline',
    });
  });

  it('exposes explicit runtime-default and exact model override states', () => {
    const onChange = vi.fn();
    const withModel = { ...config(), model: 'gpt-5.6-luna' };
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(withModel)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Agent model source')).toHaveValue('override');
    fireEvent.change(getByLabelText('Agent model override'), {
      target: { value: 'gpt-5.6-luna-high' },
    });
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .invocation.arguments.map(
          (argument: { type: string; value?: string }) => argument.value,
        ),
    ).toContain('gpt-5.6-luna-high');

    fireEvent.change(getByLabelText('Agent model source'), {
      target: { value: 'default' },
    });
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .invocation.arguments.map(
          (argument: { type: string; value?: string }) => argument.value,
        ),
    ).not.toContain('--model');
  });

  it('renders capability-driven instruction delivery and context controls', () => {
    const onChange = vi.fn();
    const withContext: AgentBlockEditorConfig = {
      ...config(),
      textContext: { portId: 'context', name: 'Reference material' },
    };
    const { getByLabelText, getAllByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(withContext)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Instruction delivery')).toHaveValue('argument');
    expect(getAllByRole('option', { name: 'Exact CLI argument' })).toHaveLength(
      1,
    );
    fireEvent.change(getByLabelText('Agent context input name'), {
      target: { value: 'Design brief' },
    });
    expect(onChange.mock.calls.at(-1)?.[0].inputs).toContainEqual(
      expect.objectContaining({ name: 'Design brief' }),
    );

    fireEvent.change(getByLabelText('Agent runtime'), {
      target: { value: 'antigravity' },
    });
    expect(onChange.mock.calls.at(-1)?.[0].inputs).toEqual([]);
  });

  it('edits a visible deterministic template that binds exact instruction and context', () => {
    const onChange = vi.fn();
    const templated: AgentBlockEditorConfig = {
      ...config(),
      agentRuntime: 'antigravity',
      instructionDelivery: 'template',
      instructionTemplate: '{{instruction}}\nContext:\n{{context}}',
      textContext: { portId: 'context', name: 'Context' },
    };
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(templated)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'antigravity' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Instruction delivery')).toHaveValue('template');
    fireEvent.change(getByLabelText('Agent instruction template'), {
      target: {
        value: 'Task:\n{{instruction}}\nPrior result:\n{{context}}',
      },
    });
    expect(onChange.mock.calls.at(-1)?.[0].invocation.arguments.at(-1)).toEqual(
      {
        type: 'template',
        template: 'Task:\n{{instruction}}\nPrior result:\n{{context}}',
        inputs: {
          instruction: { value: 'Respond with text.' },
          context: { portId: 'context' },
        },
      },
    );
  });

  it('persists explicit workflow-run worktree settings with presentation metadata', () => {
    const onChange = vi.fn();
    const isolated: AgentBlockEditorConfig = {
      ...config(),
      authority: 'workspace-write',
      isolation: {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/repository',
        baseRef: 'main',
        scope: 'shared-review',
      },
    };
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(isolated)}
        presentation={{
          kind: 'ai-agent',
          agentRuntime: 'codex',
          isolation: isolated.isolation!,
        }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Agent isolation')).toHaveValue(
      'workflow-run-worktree',
    );
    expect(getByLabelText('Worktree repository root')).toHaveValue(
      '/workspace/repository',
    );
    fireEvent.change(getByLabelText('Worktree base ref'), {
      target: { value: 'release/v0.3' },
    });

    expect(onChange.mock.calls.at(-1)?.[1]).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'codex',
      isolation: {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/repository',
        baseRef: 'release/v0.3',
        scope: 'shared-review',
      },
    });
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
