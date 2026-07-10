import type {
  JsonValue,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorchestra/engine';

export type AgentRuntimeId = 'codex';

export type AgentAuthority = 'read-only' | 'workspace-write';

export interface AgentTextContextConfig {
  readonly portId: string;
  readonly name: string;
}

export interface AgentTextResponseConfig {
  readonly portId: string;
  readonly name: string;
}

export interface AgentFilesystemOutputConfig {
  readonly portId: string;
  readonly name: string;
  readonly path: string;
  readonly entity: 'file' | 'directory';
}

/**
 * Runtime-neutral editor state for a specialized AI Agent block.
 *
 * This state belongs to the desktop editor. The engine receives only the
 * generic ProcessBlock produced by compileAgentBlock.
 */
export interface AgentBlockEditorConfig {
  readonly id: string;
  readonly name: string;
  readonly agentRuntime: AgentRuntimeId;
  readonly instruction: string;
  readonly textContext?: AgentTextContextConfig;
  readonly workingDirectory?: string;
  readonly authority: AgentAuthority;
  readonly textResponse: AgentTextResponseConfig;
  readonly filesystemOutputs: readonly AgentFilesystemOutputConfig[];
}

export interface AgentBlockPresentation {
  readonly kind: 'ai-agent';
  readonly agentRuntime: AgentRuntimeId;
}

const desktopEditorKey = 'vorchestra.desktop';

interface DesktopEditorMetadata {
  readonly schemaVersion: 1;
  readonly blockPresentations: Readonly<Record<string, AgentBlockPresentation>>;
}

/** Compile a desktop AI Agent configuration into the generic engine contract. */
export function compileAgentBlock(
  config: AgentBlockEditorConfig,
): ProcessBlock {
  switch (config.agentRuntime) {
    case 'codex':
      return compileCodexAgentBlock(config);
  }
}

export function getAgentBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
): AgentBlockPresentation | undefined {
  const metadata = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  return metadata?.blockPresentations[blockId];
}

export function setAgentBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
  agentRuntime: AgentRuntimeId,
): WorkflowDefinition {
  const current = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  const metadata: DesktopEditorMetadata = {
    schemaVersion: 1,
    blockPresentations: {
      ...(current?.blockPresentations ?? {}),
      [blockId]: { kind: 'ai-agent', agentRuntime },
    },
  };
  return {
    ...workflow,
    editor: {
      ...(workflow.editor ?? {}),
      [desktopEditorKey]: metadata as unknown as JsonValue,
    },
  };
}

export function removeBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  const current = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  if (
    current === undefined ||
    current.blockPresentations[blockId] === undefined
  ) {
    return workflow;
  }
  const blockPresentations = { ...current.blockPresentations };
  delete blockPresentations[blockId];
  return {
    ...workflow,
    editor: {
      ...(workflow.editor ?? {}),
      [desktopEditorKey]: {
        schemaVersion: 1,
        blockPresentations,
      } as unknown as JsonValue,
    },
  };
}

/**
 * Reconstructs editable fields from the authoritative compiled process. The
 * metadata selects the editor/runtime only; it does not duplicate instructions,
 * paths, authority, or outputs.
 */
export function agentEditorConfigFromBlock(
  block: ProcessBlock,
  presentation: AgentBlockPresentation,
): AgentBlockEditorConfig {
  const sandboxIndex = block.invocation.arguments.findIndex(
    (argument) => argument.type === 'literal' && argument.value === '--sandbox',
  );
  const sandboxArgument = block.invocation.arguments[sandboxIndex + 1];
  const authority: AgentAuthority =
    sandboxArgument?.type === 'literal' &&
    sandboxArgument.value === 'workspace-write'
      ? 'workspace-write'
      : 'read-only';
  const instructionArgument = block.invocation.arguments.at(-1);
  const textBinding = block.invocation.outputs.find(
    (output) => output.type === 'stdout',
  );
  const textPort = block.outputs.find(
    (output) => output.id === textBinding?.portId,
  );
  const stdinPort = block.inputs.find(
    (input) => input.id === block.invocation.stdin?.portId,
  );

  return {
    id: block.id,
    name: block.name,
    agentRuntime: presentation.agentRuntime,
    instruction:
      instructionArgument?.type === 'literal' ? instructionArgument.value : '',
    ...(stdinPort === undefined
      ? {}
      : { textContext: { portId: stdinPort.id, name: stdinPort.name } }),
    ...(block.invocation.workingDirectory === undefined
      ? {}
      : { workingDirectory: block.invocation.workingDirectory }),
    authority,
    textResponse: {
      portId: textPort?.id ?? 'response',
      name: textPort?.name ?? 'Response',
    },
    filesystemOutputs: block.invocation.outputs.flatMap((binding) => {
      if (binding.type !== 'filesystem') return [];
      const port = block.outputs.find((output) => output.id === binding.portId);
      return [
        {
          portId: binding.portId,
          name: port?.name ?? binding.portId,
          path: binding.path,
          entity:
            binding.entity === 'directory' ? 'directory' : ('file' as const),
        },
      ];
    }),
  };
}

function compileCodexAgentBlock(config: AgentBlockEditorConfig): ProcessBlock {
  const textContext = config.textContext;

  return {
    id: config.id,
    name: config.name,
    kind: 'process',
    inputs:
      textContext === undefined
        ? []
        : [
            {
              id: textContext.portId,
              name: textContext.name,
              artifactKind: 'text',
              required: false,
            },
          ],
    outputs: [
      {
        id: config.textResponse.portId,
        name: config.textResponse.name,
        artifactKind: 'text',
      },
      ...config.filesystemOutputs.map((output) => ({
        id: output.portId,
        name: output.name,
        artifactKind: 'filesystem-reference' as const,
      })),
    ],
    invocation: {
      executable: 'codex',
      arguments: codexArguments(config),
      ...(config.workingDirectory === undefined
        ? {}
        : { workingDirectory: config.workingDirectory }),
      environment: {
        HOME: { source: 'host', name: 'HOME' },
        PATH: { source: 'host', name: 'PATH' },
      },
      ...(textContext === undefined
        ? {}
        : { stdin: { portId: textContext.portId } }),
      shell: false,
      outputs: [
        { type: 'stdout', portId: config.textResponse.portId },
        ...config.filesystemOutputs.map((output) => ({
          type: 'filesystem' as const,
          portId: output.portId,
          path: output.path,
          entity: output.entity,
        })),
      ],
    },
  };
}

function codexArguments(
  config: AgentBlockEditorConfig,
): ProcessBlock['invocation']['arguments'] {
  return [
    literal('exec'),
    literal('--ephemeral'),
    literal('--sandbox'),
    literal(config.authority),
    literal('--color'),
    literal('never'),
    literal('--skip-git-repo-check'),
    literal(config.instruction),
  ];
}

function literal(value: string) {
  return { type: 'literal' as const, value };
}

function parseDesktopEditorMetadata(
  value: JsonValue | undefined,
): DesktopEditorMetadata | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  if (!isRecord(value.blockPresentations)) return undefined;
  const blockPresentations: Record<string, AgentBlockPresentation> = {};
  for (const [blockId, candidate] of Object.entries(value.blockPresentations)) {
    if (
      isRecord(candidate) &&
      candidate.kind === 'ai-agent' &&
      candidate.agentRuntime === 'codex'
    ) {
      blockPresentations[blockId] = {
        kind: 'ai-agent',
        agentRuntime: 'codex',
      };
    }
  }
  return { schemaVersion: 1, blockPresentations };
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
