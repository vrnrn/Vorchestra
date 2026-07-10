import { describe, expect, it } from 'vitest';
import {
  parseWorkflowDefinition,
  validateWorkflow,
  type ProcessBlock,
} from '@vorchestra/engine';
import {
  agentEditorConfigFromBlock,
  compileAgentBlock,
  getAgentBlockPresentation,
  removeBlockPresentation,
  setAgentBlockPresentation,
  type AgentBlockEditorConfig,
} from '../src/shared/agent-runtime';
import { createWorkflow } from '../src/shared/defaults';

describe('Codex Agent runtime compiler', () => {
  it('compiles read-only authority, exact instruction, stdin context, and outputs', () => {
    const instruction =
      'Review this exact input.\nDo not rewrite the request.  ';
    const config: AgentBlockEditorConfig = {
      id: 'agent-1',
      name: 'Review input',
      agentRuntime: 'codex',
      instruction,
      textContext: { portId: 'context', name: 'Context' },
      workingDirectory: '/workspace/project',
      authority: 'read-only',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'report',
          name: 'Report',
          path: './reports/result.md',
          entity: 'file',
        },
        {
          portId: 'assets',
          name: 'Assets',
          path: './generated-assets',
          entity: 'directory',
        },
      ],
    };

    const block = compileAgentBlock(config);

    expect(block).toMatchObject({
      id: 'agent-1',
      name: 'Review input',
      kind: 'process',
      inputs: [
        {
          id: 'context',
          name: 'Context',
          artifactKind: 'text',
          required: false,
        },
      ],
      outputs: [
        { id: 'response', name: 'Response', artifactKind: 'text' },
        {
          id: 'report',
          name: 'Report',
          artifactKind: 'filesystem-reference',
        },
        {
          id: 'assets',
          name: 'Assets',
          artifactKind: 'filesystem-reference',
        },
      ],
      invocation: {
        executable: 'codex',
        workingDirectory: '/workspace/project',
        environment: {
          HOME: { source: 'host', name: 'HOME' },
          PATH: { source: 'host', name: 'PATH' },
        },
        stdin: { portId: 'context' },
        shell: false,
        outputs: [
          { type: 'stdout', portId: 'response' },
          {
            type: 'filesystem',
            portId: 'report',
            path: './reports/result.md',
            entity: 'file',
          },
          {
            type: 'filesystem',
            portId: 'assets',
            path: './generated-assets',
            entity: 'directory',
          },
        ],
      },
    });
    expect(argumentValues(block)).toEqual([
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--skip-git-repo-check',
      instruction,
    ]);
    expect(argumentValues(block).at(-1)).toBe(instruction);
    expect(
      argumentValues(block).filter((value) => value === instruction),
    ).toHaveLength(1);
    expect(
      block.invocation.arguments.every(
        (argument) => argument.type === 'literal',
      ),
    ).toBe(true);
    expectValidStandaloneBlock(block);
  });

  it('compiles explicit workspace-write authority without context or a cwd override', () => {
    const block = compileAgentBlock({
      id: 'agent-write',
      name: 'Generate files',
      agentRuntime: 'codex',
      instruction: 'Create the declared output file.',
      authority: 'workspace-write',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'generated',
          name: 'Generated file',
          path: './generated.txt',
          entity: 'file',
        },
      ],
    });

    expect(block.inputs).toEqual([]);
    expect(block.invocation.stdin).toBeUndefined();
    expect(block.invocation.workingDirectory).toBeUndefined();
    expect(argumentValues(block)).toEqual([
      'exec',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '--skip-git-repo-check',
      'Create the declared output file.',
    ]);
    expect(block.invocation.outputs).toContainEqual({
      type: 'filesystem',
      portId: 'generated',
      path: './generated.txt',
      entity: 'file',
    });
    expectValidStandaloneBlock(block);
  });

  it('never emits model, streaming, resume, shell, worktree, or bypass behavior', () => {
    const block = compileAgentBlock({
      id: 'bounded-agent',
      name: 'Bounded agent',
      agentRuntime: 'codex',
      instruction: 'Return a short response.',
      authority: 'workspace-write',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
    });
    const arguments_ = argumentValues(block);

    expect(arguments_).not.toContain('--model');
    expect(arguments_).not.toContain('--json');
    expect(arguments_).not.toContain('resume');
    expect(arguments_).not.toContain('--full-auto');
    expect(arguments_).not.toContain('--ask-for-approval');
    expect(arguments_).not.toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
    expect(arguments_).not.toContain('--dangerously-bypass-hook-trust');
    expect(arguments_).not.toContain('--add-dir');
    expect(block.invocation.shell).toBe(false);
    expect(block.invocation.environment).toEqual({
      HOME: { source: 'host', name: 'HOME' },
      PATH: { source: 'host', name: 'PATH' },
    });
  });

  it('stores only editor identity and reconstructs fields from the compiled process', () => {
    const config: AgentBlockEditorConfig = {
      id: 'agent-metadata',
      name: 'Generate report',
      agentRuntime: 'codex',
      instruction: 'Create report.md',
      authority: 'workspace-write',
      workingDirectory: '/workspace',
      textContext: { portId: 'context', name: 'Context' },
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'report',
          name: 'Report',
          path: './report.md',
          entity: 'file',
        },
      ],
    };
    const block = compileAgentBlock(config);
    const workflow = setAgentBlockPresentation(
      { ...createWorkflow(), blocks: [block] },
      block.id,
      'codex',
    );
    const presentation = getAgentBlockPresentation(workflow, block.id);

    expect(presentation).toEqual({ kind: 'ai-agent', agentRuntime: 'codex' });
    expect(JSON.stringify(workflow.editor)).not.toContain(config.instruction);
    expect(JSON.stringify(workflow.editor)).not.toContain(
      config.workingDirectory,
    );
    expect(agentEditorConfigFromBlock(block, presentation!)).toEqual(config);
    expect(
      getAgentBlockPresentation(
        removeBlockPresentation(workflow, block.id),
        block.id,
      ),
    ).toBeUndefined();
  });
});

function argumentValues(block: ProcessBlock): string[] {
  return block.invocation.arguments.map((argument) => {
    expect(argument.type).toBe('literal');
    return argument.type === 'literal'
      ? argument.value
      : `input:${argument.portId}`;
  });
}

function expectValidStandaloneBlock(block: ProcessBlock): void {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'agent-workflow',
    name: 'Agent workflow',
    blocks: [block],
    connections: [],
  });
  expect(validateWorkflow(workflow)).toEqual({ valid: true, issues: [] });
}
