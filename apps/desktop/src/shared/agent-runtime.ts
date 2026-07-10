import type {
  JsonValue,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorchestra/engine';

export type AgentRuntimeId = 'codex' | 'cline' | 'antigravity';

export type AgentAuthority = 'read-only' | 'workspace-write';

export type AgentInstructionDeliveryMode =
  'argument' | 'template' | 'stdin' | 'file';

export interface AgentRuntimeCapabilities {
  readonly modelOverride: boolean;
  readonly instructionDeliveryModes: readonly AgentInstructionDeliveryMode[];
  readonly separateTextContext: boolean;
  readonly authorities: readonly AgentAuthority[];
  readonly declaredFilesystemOutputs: boolean;
  readonly images: boolean;
  readonly structuredEvents: boolean;
  readonly sessionResume: boolean;
}

export interface AgentRuntimeDescriptor {
  readonly id: AgentRuntimeId;
  readonly displayName: string;
  readonly executable: string;
  readonly guidance: string;
  readonly modelOverride: boolean;
  readonly instructionDeliveryModes: readonly AgentInstructionDeliveryMode[];
  readonly separateTextContext: boolean;
  readonly authorities: readonly AgentAuthority[];
  readonly declaredFilesystemOutputs: boolean;
  readonly capabilities: AgentRuntimeCapabilities;
  readonly installGuidance: string;
  readonly authenticationGuidance: string;
}

/**
 * Desktop-owned runtime catalog. A declared capability means this compiler can
 * represent it faithfully in a generic ProcessBlock; it is not inferred from
 * an executable name at run time.
 */
export const AGENT_RUNTIME_REGISTRY: readonly AgentRuntimeDescriptor[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    executable: 'codex',
    guidance: 'Runs one-shot Codex exec using the local Codex configuration.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: true,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: true,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: false,
      sessionResume: false,
    },
    installGuidance: 'Install the Codex CLI and ensure `codex` is on PATH.',
    authenticationGuidance: 'Authenticate with the Codex CLI before running.',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    executable: 'cline',
    guidance: 'Runs one-shot Cline CLI using Cline-owned authentication.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: true,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: true,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: false,
      sessionResume: false,
    },
    installGuidance: 'Install the Cline CLI and ensure `cline` is on PATH.',
    authenticationGuidance: 'Run `cline auth` before non-interactive use.',
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    executable: 'agy',
    guidance:
      'Runs Antigravity print mode using Antigravity-owned authentication.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: false,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: false,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: false,
      sessionResume: false,
    },
    installGuidance: 'Install Antigravity CLI and ensure `agy` is on PATH.',
    authenticationGuidance:
      'Sign in through Antigravity before non-interactive use.',
  },
];

export function getAgentRuntimeDescriptor(
  runtimeId: AgentRuntimeId,
): AgentRuntimeDescriptor {
  const descriptor = AGENT_RUNTIME_REGISTRY.find(
    (candidate) => candidate.id === runtimeId,
  );
  if (descriptor === undefined) {
    throw new Error(`Unknown Agent runtime: ${runtimeId}`);
  }
  return descriptor;
}

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

export type AgentIsolationConfig =
  | { readonly mode: 'current-directory' }
  | {
      readonly mode: 'workflow-run-worktree';
      readonly repositoryRoot: string;
      readonly baseRef: string;
      readonly scope: string;
    };

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
  readonly instructionDelivery?: AgentInstructionDeliveryMode;
  readonly instructionTemplate?: string;
  readonly model?: string;
  readonly isolation?: AgentIsolationConfig;
  readonly textContext?: AgentTextContextConfig;
  readonly workingDirectory?: string;
  readonly authority: AgentAuthority;
  readonly textResponse: AgentTextResponseConfig;
  readonly filesystemOutputs: readonly AgentFilesystemOutputConfig[];
}

export interface AgentBlockPresentation {
  readonly kind: 'ai-agent';
  readonly agentRuntime: AgentRuntimeId;
  readonly isolation?: AgentIsolationConfig;
}

export interface AgentBlockMetadataIssue {
  readonly code: 'runtime-unsupported' | 'isolation-invalid';
  readonly field: 'editor.agentRuntime' | 'editor.isolation';
  readonly message: string;
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
  assertSupportedConfiguration(config);
  switch (config.agentRuntime) {
    case 'codex':
      return compileCodexAgentBlock(config);
    case 'cline':
      return compileClineAgentBlock(config);
    case 'antigravity':
      return compileAntigravityAgentBlock(config);
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

export function getAgentBlockMetadataIssue(
  workflow: WorkflowDefinition,
  blockId: string,
): AgentBlockMetadataIssue | undefined {
  const value = workflow.editor?.[desktopEditorKey];
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  if (!isRecord(value.blockPresentations)) return undefined;
  const candidate = value.blockPresentations[blockId];
  if (!isRecord(candidate) || candidate.kind !== 'ai-agent') return undefined;
  if (!isAgentRuntimeId(candidate.agentRuntime)) {
    const runtime =
      typeof candidate.agentRuntime === 'string'
        ? candidate.agentRuntime
        : 'unknown';
    return {
      code: 'runtime-unsupported',
      field: 'editor.agentRuntime',
      message: `Agent runtime ${JSON.stringify(runtime)} is not supported by this Vorchestra installation. Choose Codex, Cline, or Antigravity before running.`,
    };
  }
  if (
    candidate.isolation !== undefined &&
    parseAgentIsolation(candidate.isolation) === undefined
  ) {
    return {
      code: 'isolation-invalid',
      field: 'editor.isolation',
      message:
        'The saved Agent worktree isolation metadata is invalid or unsupported. Review the repository root, base ref, and scope before running.',
    };
  }
  return undefined;
}

export function setAgentBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
  agentRuntime: AgentRuntimeId,
  isolation?: AgentIsolationConfig,
): WorkflowDefinition {
  const current = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  const metadata: DesktopEditorMetadata = {
    schemaVersion: 1,
    blockPresentations: {
      ...(current?.blockPresentations ?? {}),
      [blockId]: {
        kind: 'ai-agent',
        agentRuntime,
        ...(isolation === undefined ? {} : { isolation }),
      },
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
  const current = workflow.editor?.[desktopEditorKey];
  if (
    !isRecord(current) ||
    current.schemaVersion !== 1 ||
    !isRecord(current.blockPresentations) ||
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
  const arguments_ = literalArgumentValues(block);
  const templateArgument = block.invocation.arguments.find(
    (argument) => argument.type === 'template',
  );
  const authority = authorityFromArguments(
    presentation.agentRuntime,
    arguments_,
  );
  const model = optionValue(arguments_, '--model');
  const textBinding = block.invocation.outputs.find(
    (output) => output.type === 'stdout',
  );
  const textPort = block.outputs.find(
    (output) => output.id === textBinding?.portId,
  );
  const contextPortId =
    block.invocation.stdin !== undefined && 'portId' in block.invocation.stdin
      ? block.invocation.stdin.portId
      : templateArgument?.inputs.context !== undefined &&
          'portId' in templateArgument.inputs.context
        ? templateArgument.inputs.context.portId
        : undefined;
  const stdinPort = block.inputs.find((input) => input.id === contextPortId);
  const templateInstruction = templateArgument?.inputs.instruction;

  return {
    id: block.id,
    name: block.name,
    agentRuntime: presentation.agentRuntime,
    instruction:
      templateInstruction !== undefined && 'value' in templateInstruction
        ? templateInstruction.value
        : instructionFromArguments(presentation.agentRuntime, arguments_),
    ...(templateArgument === undefined
      ? {}
      : {
          instructionDelivery: 'template',
          instructionTemplate: templateArgument.template,
        }),
    ...(model === undefined ? {} : { model }),
    ...(presentation.isolation === undefined
      ? {}
      : { isolation: presentation.isolation }),
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

function assertSupportedConfiguration(config: AgentBlockEditorConfig): void {
  const descriptor = getAgentRuntimeDescriptor(config.agentRuntime);
  const delivery = config.instructionDelivery ?? 'argument';
  if (!descriptor.capabilities.instructionDeliveryModes.includes(delivery)) {
    throw new Error(
      `${descriptor.displayName} does not support ${delivery} instruction delivery. Choose ${descriptor.capabilities.instructionDeliveryModes.join(' or ')}.`,
    );
  }
  if (config.model !== undefined && !descriptor.capabilities.modelOverride) {
    throw new Error(
      `${descriptor.displayName} does not support model overrides.`,
    );
  }
  if (!descriptor.capabilities.authorities.includes(config.authority)) {
    throw new Error(
      `${descriptor.displayName} does not support ${config.authority} authority.`,
    );
  }
  if (
    config.textContext !== undefined &&
    !descriptor.capabilities.separateTextContext &&
    delivery !== 'template'
  ) {
    throw new Error(
      `${descriptor.displayName} cannot receive separate connected text context in one-shot mode.`,
    );
  }
  if (delivery === 'template') {
    if (config.instructionTemplate === undefined) {
      throw new Error(
        'Template instruction delivery requires a visible instruction template.',
      );
    }
    const template = config.instructionTemplate;
    if (!template.includes('{{instruction}}')) {
      throw new Error('Instruction templates must include {{instruction}}.');
    }
    if (config.textContext !== undefined && !template.includes('{{context}}')) {
      throw new Error(
        'Instruction templates with connected context must include {{context}}.',
      );
    }
    if (config.textContext === undefined && template.includes('{{context}}')) {
      throw new Error(
        'Enable connected text context before using {{context}} in the instruction template.',
      );
    }
  }
}

function compileCodexAgentBlock(config: AgentBlockEditorConfig): ProcessBlock {
  const textContext = config.textContext;
  const delivery = config.instructionDelivery ?? 'argument';

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
      ...(textContext === undefined || delivery === 'template'
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
    ...(config.model === undefined
      ? []
      : [literal('--model'), literal(config.model)]),
    agentInstructionArgument(config),
  ];
}

function compileClineAgentBlock(config: AgentBlockEditorConfig): ProcessBlock {
  return compileDirectAgentBlock(config, {
    executable: 'cline',
    arguments: [
      ...(config.authority === 'read-only' ? [literal('--plan')] : []),
      ...(config.model === undefined
        ? []
        : [literal('--model'), literal(config.model)]),
      agentInstructionArgument(config),
    ],
  });
}

function compileAntigravityAgentBlock(
  config: AgentBlockEditorConfig,
): ProcessBlock {
  return compileDirectAgentBlock(config, {
    executable: 'agy',
    arguments: [
      ...(config.authority === 'read-only' ? [literal('--sandbox')] : []),
      ...(config.model === undefined
        ? []
        : [literal('--model'), literal(config.model)]),
      literal('--print'),
      agentInstructionArgument(config),
    ],
  });
}

function compileDirectAgentBlock(
  config: AgentBlockEditorConfig,
  invocation: Pick<ProcessBlock['invocation'], 'executable' | 'arguments'>,
): ProcessBlock {
  const textContext = config.textContext;
  const delivery = config.instructionDelivery ?? 'argument';
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
      ...invocation,
      ...(config.workingDirectory === undefined
        ? {}
        : { workingDirectory: config.workingDirectory }),
      environment: {
        HOME: { source: 'host', name: 'HOME' },
        PATH: { source: 'host', name: 'PATH' },
      },
      ...(textContext === undefined || delivery === 'template'
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

function literalArgumentValues(block: ProcessBlock): string[] {
  return block.invocation.arguments.flatMap((argument) =>
    argument.type === 'literal' ? [argument.value] : [],
  );
}

function optionValue(
  arguments_: readonly string[],
  option: string,
): string | undefined {
  const index = arguments_.indexOf(option);
  return index < 0 ? undefined : arguments_[index + 1];
}

function instructionFromArguments(
  runtime: AgentRuntimeId,
  arguments_: readonly string[],
): string {
  switch (runtime) {
    case 'codex':
    case 'cline':
    case 'antigravity':
      return arguments_.at(-1) ?? '';
  }
}

function authorityFromArguments(
  runtime: AgentRuntimeId,
  arguments_: readonly string[],
): AgentAuthority {
  switch (runtime) {
    case 'codex':
      return optionValue(arguments_, '--sandbox') === 'workspace-write'
        ? 'workspace-write'
        : 'read-only';
    case 'cline':
      return arguments_.includes('--plan') ? 'read-only' : 'workspace-write';
    case 'antigravity':
      return arguments_.includes('--sandbox') ? 'read-only' : 'workspace-write';
  }
}

function literal(value: string) {
  return { type: 'literal' as const, value };
}

function agentInstructionArgument(
  config: AgentBlockEditorConfig,
): ProcessBlock['invocation']['arguments'][number] {
  if ((config.instructionDelivery ?? 'argument') !== 'template') {
    return literal(config.instruction);
  }
  return {
    type: 'template',
    template: config.instructionTemplate!,
    inputs: {
      instruction: { value: config.instruction },
      ...(config.textContext === undefined
        ? {}
        : { context: { portId: config.textContext.portId } }),
    },
  };
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
      isAgentRuntimeId(candidate.agentRuntime)
    ) {
      blockPresentations[blockId] = {
        kind: 'ai-agent',
        agentRuntime: candidate.agentRuntime,
        ...(parseAgentIsolation(candidate.isolation) === undefined
          ? {}
          : { isolation: parseAgentIsolation(candidate.isolation)! }),
      };
    }
  }
  return { schemaVersion: 1, blockPresentations };
}

function parseAgentIsolation(
  value: JsonValue | undefined,
): AgentIsolationConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (value.mode === 'current-directory') {
    return { mode: 'current-directory' };
  }
  if (
    value.mode === 'workflow-run-worktree' &&
    typeof value.repositoryRoot === 'string' &&
    typeof value.baseRef === 'string' &&
    typeof value.scope === 'string'
  ) {
    return {
      mode: 'workflow-run-worktree',
      repositoryRoot: value.repositoryRoot,
      baseRef: value.baseRef,
      scope: value.scope,
    };
  }
  return undefined;
}

function isAgentRuntimeId(
  value: JsonValue | undefined,
): value is AgentRuntimeId {
  return value === 'codex' || value === 'cline' || value === 'antigravity';
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
