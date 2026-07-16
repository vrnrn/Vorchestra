import type { ProcessBlock } from '@vorchestra/engine';
import {
  Bot,
  FileOutput,
  FolderOpen,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  AGENT_RUNTIME_REGISTRY,
  CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
  agentEditorConfigFromBlock,
  compileAgentBlock,
  getAgentRuntimeDescriptor,
  modelsForAgentRuntime,
  type AgentBlockEditorConfig,
  type AgentBlockPresentation,
  type AgentFilesystemOutputConfig,
  type AgentIsolationConfig,
  type AgentInstructionDeliveryMode,
  type AgentRuntimeId,
} from '../../shared/agent-runtime';
import type { UserModelCatalog } from '../../shared/contracts';
import { InvocationPreview } from './InvocationPreview';

type PathSelector = (
  kind: 'file' | 'directory' | 'output-file',
  defaultPath?: string,
) => Promise<string | undefined>;

type MutableAgentBlockEditorConfig = {
  -readonly [Key in keyof AgentBlockEditorConfig]: AgentBlockEditorConfig[Key];
};

type WorktreeIsolationConfig = Extract<
  AgentIsolationConfig,
  { readonly mode: 'workflow-run-worktree' }
>;

export function AgentBlockInspector({
  block,
  presentation,
  onChange,
  selectPath,
  modelCatalog,
  modelCatalogPath,
}: {
  block: ProcessBlock;
  presentation: AgentBlockPresentation;
  onChange: (block: ProcessBlock, presentation: AgentBlockPresentation) => void;
  selectPath: PathSelector;
  modelCatalog?: UserModelCatalog;
  modelCatalogPath?: string;
}) {
  const reconstructed = agentEditorConfigFromBlock(block, presentation);
  const configuredModels =
    modelCatalog === undefined
      ? { models: [] as readonly string[] }
      : modelsForAgentRuntime(modelCatalog, reconstructed.agentRuntime);
  const config: AgentBlockEditorConfig =
    reconstructed.model === undefined && configuredModels.default !== undefined
      ? { ...reconstructed, model: configuredModels.default }
      : reconstructed;
  const runtime = getAgentRuntimeDescriptor(config.agentRuntime);
  const commit = (next: AgentBlockEditorConfig): void =>
    onChange(compileAgentBlock(next), presentationFromConfig(next));
  const update = (patch: Partial<AgentBlockEditorConfig>): void =>
    commit({ ...config, ...patch });

  const removeSetting = <Key extends keyof AgentBlockEditorConfig>(
    key: Key,
  ): void => {
    const next = { ...config };
    delete next[key];
    commit(next);
  };

  const selectRuntime = (agentRuntime: AgentRuntimeId): void => {
    const nextRuntime = getAgentRuntimeDescriptor(agentRuntime);
    const next: MutableAgentBlockEditorConfig = { ...config, agentRuntime };
    const nextModels =
      modelCatalog === undefined
        ? undefined
        : modelsForAgentRuntime(modelCatalog, agentRuntime);
    if (nextModels?.default === undefined) delete next.model;
    else next.model = nextModels.default;
    if (
      !nextRuntime.capabilities.separateTextContext &&
      next.textContext !== undefined &&
      (next.instructionDelivery ?? 'argument') !== 'template'
    ) {
      next.instructionDelivery = 'template';
      next.instructionTemplate = CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE;
    }
    if (!nextRuntime.capabilities.modelOverride) {
      delete next.model;
    }
    if (
      !nextRuntime.capabilities.instructionDeliveryModes.includes(
        next.instructionDelivery ?? 'argument',
      )
    ) {
      next.instructionDelivery =
        nextRuntime.capabilities.instructionDeliveryModes[0] ?? 'argument';
    }
    commit(next);
  };

  return (
    <div className="inspector-scroll agent-inspector">
      <section className="inspector-section">
        <header>
          <span>Agent</span>
        </header>
        <label className="field">
          <span>Display name</span>
          <input
            data-inspector-field="identity.name"
            value={config.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Agent runtime</span>
          <select
            data-inspector-field="editor.agentRuntime"
            aria-label="Agent runtime"
            value={config.agentRuntime}
            onChange={(event) =>
              selectRuntime(event.target.value as AgentRuntimeId)
            }
          >
            {AGENT_RUNTIME_REGISTRY.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          <small>
            {runtime.installGuidance} {runtime.authenticationGuidance}
          </small>
        </label>
        {runtime.capabilities.modelOverride && (
          <>
            <label className="field">
              <span>Model</span>
              <select
                data-inspector-field="editor.model"
                aria-label="Agent model"
                value={modelSelection(config.model, configuredModels.models)}
                onChange={(event) => {
                  if (event.target.value === 'runtime-default') {
                    removeSetting('model');
                    return;
                  }
                  if (event.target.value.startsWith('configured:')) {
                    const index = Number(
                      event.target.value.slice('configured:'.length),
                    );
                    const model = configuredModels.models[index];
                    if (model !== undefined) update({ model });
                    return;
                  }
                  update({ model: '' });
                }}
              >
                {configuredModels.default === undefined && (
                  <option value="runtime-default">Use runtime default</option>
                )}
                {configuredModels.models.map((model, index) => (
                  <option key={model} value={`configured:${index}`}>
                    {model}
                    {model === configuredModels.default ? ' (default)' : ''}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <small>
                {modelCatalogPath === undefined
                  ? 'Loading the user model catalog…'
                  : `Configured in ${modelCatalogPath}`}
              </small>
            </label>
            {modelSelection(config.model, configuredModels.models) ===
              'custom' && (
              <label className="field">
                <span>Model identifier</span>
                <input
                  data-inspector-field="editor.model"
                  aria-label="Agent model override"
                  value={config.model}
                  placeholder="Exact runtime model identifier"
                  onChange={(event) => update({ model: event.target.value })}
                />
                <small>
                  Passed exactly to {runtime.displayName}; credentials and the
                  model remain runtime-owned.
                </small>
              </label>
            )}
          </>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Instruction</span>
        </header>
        <label className="field">
          <span>Delivery</span>
          <select
            data-inspector-field="editor.instructionDelivery"
            aria-label="Instruction delivery"
            value={config.instructionDelivery ?? 'argument'}
            onChange={(event) => {
              const instructionDelivery = event.target
                .value as AgentInstructionDeliveryMode;
              if (instructionDelivery === 'template') {
                update({
                  instructionDelivery,
                  instructionTemplate:
                    config.textContext === undefined
                      ? '{{instruction}}'
                      : CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
                });
                return;
              }
              const {
                instructionTemplate: _instructionTemplate,
                ...withoutTemplate
              } = config;
              commit({ ...withoutTemplate, instructionDelivery });
            }}
          >
            {runtime.capabilities.instructionDeliveryModes.map((mode) => (
              <option
                key={mode}
                value={mode}
                disabled={
                  mode !== 'template' &&
                  config.textContext !== undefined &&
                  !runtime.capabilities.separateTextContext
                }
              >
                {instructionDeliveryLabel(mode)}
              </option>
            ))}
          </select>
          <small>
            Only delivery modes implemented deterministically by this runtime
            are available.
          </small>
        </label>
        <label className="field">
          <span>
            {instructionDeliveryLabel(config.instructionDelivery ?? 'argument')}
          </span>
          <textarea
            data-inspector-field="invocation.arguments"
            aria-label="Agent instruction"
            rows={7}
            value={config.instruction}
            onChange={(event) => update({ instruction: event.target.value })}
          />
          <small>
            Vorchestra passes this text exactly through the selected delivery
            mode and does not append hidden instructions. The runtime may still
            load its own local configuration and project guidance.
          </small>
        </label>
        {(config.instructionDelivery ?? 'argument') === 'template' && (
          <label className="field">
            <span>Deterministic template</span>
            <textarea
              data-inspector-field="editor.instructionTemplate"
              aria-label="Agent instruction template"
              rows={5}
              value={
                config.instructionTemplate ??
                (config.textContext === undefined
                  ? '{{instruction}}'
                  : CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE)
              }
              onChange={(event) =>
                update({ instructionTemplate: event.target.value })
              }
            />
            <small>
              Use {'{{instruction}}'} for the exact instruction and
              {' {{context}}'} for the connected text. The resolved argument is
              produced by the generic engine without hidden additions.
            </small>
          </label>
        )}
        {(runtime.capabilities.separateTextContext ||
          (config.instructionDelivery ?? 'argument') === 'template') && (
          <>
            <label className="agent-context-toggle">
              <input
                data-inspector-field="invocation.stdin"
                type="checkbox"
                checked={config.textContext !== undefined}
                onChange={(event) => {
                  if (event.target.checked) {
                    update({
                      textContext: {
                        portId: uniquePortId(block, 'context'),
                        name: 'Context',
                      },
                      ...((config.instructionDelivery ?? 'argument') ===
                      'template'
                        ? {
                            instructionTemplate:
                              CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
                          }
                        : {}),
                    });
                    return;
                  }
                  if (
                    (config.instructionDelivery ?? 'argument') === 'template'
                  ) {
                    const { textContext: _textContext, ...withoutContext } =
                      config;
                    commit({
                      ...withoutContext,
                      instructionTemplate: '{{instruction}}',
                    });
                    return;
                  }
                  removeSetting('textContext');
                }}
              />
              Accept optional connected text as separate context
            </label>
            {config.textContext !== undefined && (
              <label className="field">
                <span>Context input name</span>
                <input
                  data-inspector-field="editor.textContext.name"
                  aria-label="Agent context input name"
                  value={config.textContext.name}
                  onChange={(event) =>
                    update({
                      textContext: {
                        ...config.textContext!,
                        name: event.target.value,
                      },
                    })
                  }
                />
                <small>
                  Instruction and connected context stay visibly distinct; no
                  implicit prompt template is applied.
                </small>
              </label>
            )}
          </>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Workspace authority</span>
        </header>
        <label className="field">
          <span>Sandbox</span>
          <select
            data-inspector-field="invocation.arguments"
            aria-label="Agent authority"
            value={config.authority}
            onChange={(event) =>
              update({
                authority: event.target
                  .value as AgentBlockEditorConfig['authority'],
              })
            }
          >
            {runtime.capabilities.authorities.map((authority) => (
              <option key={authority} value={authority}>
                {authorityLabel(config.agentRuntime, authority)}
              </option>
            ))}
          </select>
          {config.agentRuntime === 'cline' &&
            config.authority === 'read-only' && (
              <small>
                Cline plan mode is visible behavioral intent, not a hard
                filesystem sandbox. Use worktree isolation when repository
                boundaries matter.
              </small>
            )}
        </label>
        {config.authority === 'workspace-write' && (
          <div className="agent-authority-warning">
            <ShieldAlert size={14} />
            <span>
              {runtime.displayName} may create or modify files inside the
              resolved working directory. Generated paths must still be declared
              below.
            </span>
          </div>
        )}
        <label className="field">
          <span>Isolation</span>
          <select
            data-inspector-field="editor.isolation.mode"
            aria-label="Agent isolation"
            value={config.isolation?.mode ?? 'current-directory'}
            onChange={(event) => {
              if (event.target.value === 'workflow-run-worktree') {
                const {
                  workingDirectory: repositoryRoot = '',
                  ...withoutWorkingDirectory
                } = config;
                commit({
                  ...withoutWorkingDirectory,
                  isolation: {
                    mode: 'workflow-run-worktree',
                    repositoryRoot,
                    baseRef: 'HEAD',
                    scope: 'shared',
                  },
                });
                return;
              }
              update({ isolation: { mode: 'current-directory' } });
            }}
          >
            <option value="current-directory">Current working directory</option>
            <option value="workflow-run-worktree">Workflow-run worktree</option>
          </select>
          <small>
            Isolation is explicit and shared only by blocks using the same
            workflow-run scope.
          </small>
        </label>
        {config.isolation?.mode === 'workflow-run-worktree' && (
          <>
            <label className="field">
              <span>Git repository root</span>
              <div className="path-field">
                <input
                  data-inspector-field="editor.isolation.repositoryRoot"
                  aria-label="Worktree repository root"
                  value={config.isolation.repositoryRoot}
                  onChange={(event) =>
                    updateWorktreeIsolation(config, update, {
                      repositoryRoot: event.target.value,
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label="Choose worktree repository root"
                  onClick={() =>
                    void selectPath(
                      'directory',
                      config.isolation?.mode === 'workflow-run-worktree'
                        ? config.isolation.repositoryRoot
                        : undefined,
                    ).then((path) => {
                      if (path !== undefined) {
                        updateWorktreeIsolation(config, update, {
                          repositoryRoot: path,
                        });
                      }
                    })
                  }
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </label>
            <label className="field">
              <span>Base ref</span>
              <input
                data-inspector-field="editor.isolation.baseRef"
                aria-label="Worktree base ref"
                value={config.isolation.baseRef}
                onChange={(event) =>
                  updateWorktreeIsolation(config, update, {
                    baseRef: event.target.value,
                  })
                }
              />
              <small>
                The resolved commit is recorded when the run starts.
              </small>
            </label>
            <label className="field">
              <span>Shared scope</span>
              <input
                data-inspector-field="editor.isolation.scope"
                aria-label="Worktree scope"
                value={config.isolation.scope}
                onChange={(event) =>
                  updateWorktreeIsolation(config, update, {
                    scope: event.target.value,
                  })
                }
              />
              <small>
                Sequential agents with the same scope collaborate in one run
                worktree. Parallel writers need different scopes.
              </small>
            </label>
          </>
        )}
        {(config.isolation?.mode ?? 'current-directory') ===
          'current-directory' && (
          <label className="field">
            <span>Working directory</span>
            <div className="path-field">
              <input
                data-inspector-field="invocation.workingDirectory"
                value={config.workingDirectory ?? ''}
                placeholder="Workflow file directory"
                onChange={(event) => {
                  if (event.target.value !== '') {
                    update({ workingDirectory: event.target.value });
                    return;
                  }
                  const {
                    workingDirectory: _workingDirectory,
                    ...withoutWorkingDirectory
                  } = config;
                  commit(withoutWorkingDirectory);
                }}
              />
              <button
                className="icon-button"
                aria-label="Choose Agent working directory"
                onClick={() =>
                  void selectPath('directory', config.workingDirectory).then(
                    (path) => {
                      if (path !== undefined)
                        update({ workingDirectory: path });
                    },
                  )
                }
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <small>
              Leave blank to use the workflow file directory at run time.
            </small>
          </label>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Generated filesystem references</span>
          <button
            className="section-action"
            onClick={() =>
              update({
                filesystemOutputs: [
                  ...config.filesystemOutputs,
                  newFilesystemOutput(block, config.filesystemOutputs),
                ],
              })
            }
          >
            <Plus size={13} /> Add
          </button>
        </header>
        <p className="section-note">
          Declaring a path does not create it. {runtime.displayName} must
          produce it; Vorchestra verifies it after a successful run.
        </p>
        {config.filesystemOutputs.map((output, index) => (
          <div className="agent-output-row" key={output.portId}>
            <FileOutput size={14} />
            <input
              aria-label={`Generated output ${index + 1} name`}
              value={output.name}
              onChange={(event) =>
                updateFilesystemOutput(config, update, index, {
                  name: event.target.value,
                })
              }
            />
            <select
              data-inspector-field={`invocation.outputs[${index + 1}].entity`}
              aria-label={`Generated output ${index + 1} entity`}
              value={output.entity}
              onChange={(event) =>
                updateFilesystemOutput(config, update, index, {
                  entity: event.target.value as 'file' | 'directory',
                })
              }
            >
              <option value="file">File</option>
              <option value="directory">Directory</option>
            </select>
            <div className="path-field">
              <input
                data-inspector-field={`invocation.outputs[${index + 1}].path`}
                aria-label={`Generated output ${index + 1} path`}
                value={output.path}
                onChange={(event) =>
                  updateFilesystemOutput(config, update, index, {
                    path: event.target.value,
                  })
                }
              />
              <button
                className="icon-button"
                aria-label={`Choose generated output ${index + 1} path`}
                onClick={() =>
                  void selectPath(
                    output.entity === 'directory' ? 'directory' : 'output-file',
                    output.path,
                  ).then((path) => {
                    if (path !== undefined) {
                      updateFilesystemOutput(config, update, index, { path });
                    }
                  })
                }
              >
                <FolderOpen size={13} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={`Remove generated output ${output.name}`}
              onClick={() =>
                update({
                  filesystemOutputs: config.filesystemOutputs.filter(
                    (_, candidateIndex) => candidateIndex !== index,
                  ),
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {config.filesystemOutputs.length === 0 && (
          <div className="empty-line">No generated paths declared</div>
        )}
      </section>

      <section className="agent-compiled-contract">
        <header>
          <Bot size={14} />
          <strong>Compiled generic process</strong>
        </header>
        <InvocationPreview block={compileAgentBlock(config)} />
      </section>
    </div>
  );
}

function modelSelection(
  model: string | undefined,
  configuredModels: readonly string[],
): string {
  if (model === undefined) return 'runtime-default';
  const index = configuredModels.indexOf(model);
  return index < 0 ? 'custom' : `configured:${index}`;
}

function updateFilesystemOutput(
  config: AgentBlockEditorConfig,
  update: (patch: Partial<AgentBlockEditorConfig>) => void,
  index: number,
  patch: Partial<AgentFilesystemOutputConfig>,
): void {
  update({
    filesystemOutputs: config.filesystemOutputs.map((output, candidateIndex) =>
      candidateIndex === index ? { ...output, ...patch } : output,
    ),
  });
}

function updateWorktreeIsolation(
  config: AgentBlockEditorConfig,
  update: (patch: Partial<AgentBlockEditorConfig>) => void,
  patch: Partial<WorktreeIsolationConfig>,
): void {
  if (config.isolation?.mode !== 'workflow-run-worktree') return;
  update({ isolation: { ...config.isolation, ...patch } });
}

function presentationFromConfig(
  config: AgentBlockEditorConfig,
): AgentBlockPresentation {
  return {
    kind: 'ai-agent',
    agentRuntime: config.agentRuntime,
    ...(config.isolation === undefined ? {} : { isolation: config.isolation }),
  };
}

function instructionDeliveryLabel(mode: AgentInstructionDeliveryMode): string {
  switch (mode) {
    case 'argument':
      return 'Exact CLI argument';
    case 'template':
      return 'Deterministic argument template';
    case 'stdin':
      return 'Standard input';
    case 'file':
      return 'Run-local instruction file';
  }
}

function authorityLabel(
  runtime: AgentRuntimeId,
  authority: AgentBlockEditorConfig['authority'],
): string {
  if (authority === 'workspace-write') return 'Workspace write';
  if (runtime === 'cline') return 'Plan mode (behavioral read only)';
  if (runtime === 'antigravity') return 'Sandboxed read-only intent';
  return 'Read only';
}

function newFilesystemOutput(
  block: ProcessBlock,
  current: readonly AgentFilesystemOutputConfig[],
): AgentFilesystemOutputConfig {
  const portId = uniquePortId(block, 'generated');
  return {
    portId,
    name: `Generated ${current.length + 1}`,
    path: `./generated-${current.length + 1}.txt`,
    entity: 'file',
  };
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
