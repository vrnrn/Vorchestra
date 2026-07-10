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
  agentEditorConfigFromBlock,
  compileAgentBlock,
  type AgentBlockEditorConfig,
  type AgentBlockPresentation,
  type AgentFilesystemOutputConfig,
} from '../../shared/agent-runtime';
import { InvocationPreview } from './InvocationPreview';

type PathSelector = (
  kind: 'file' | 'directory' | 'output-file',
  defaultPath?: string,
) => Promise<string | undefined>;

export function AgentBlockInspector({
  block,
  presentation,
  onChange,
  selectPath,
}: {
  block: ProcessBlock;
  presentation: AgentBlockPresentation;
  onChange: (block: ProcessBlock) => void;
  selectPath: PathSelector;
}) {
  const config = agentEditorConfigFromBlock(block, presentation);
  const update = (patch: Partial<AgentBlockEditorConfig>): void =>
    onChange(compileAgentBlock({ ...config, ...patch }));

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
            disabled
          >
            <option value="codex">Codex</option>
          </select>
          <small>
            Codex is the only v0.2 runtime. Provider and model settings remain
            owned by the local CLI.
          </small>
        </label>
      </section>

      <section className="inspector-section">
        <header>
          <span>Instruction</span>
        </header>
        <label className="field">
          <span>Exact CLI argument</span>
          <textarea
            data-inspector-field="invocation.arguments"
            aria-label="Agent instruction"
            rows={7}
            value={config.instruction}
            onChange={(event) => update({ instruction: event.target.value })}
          />
          <small>
            Vorchestra passes this text as one argument and does not append
            hidden instructions. Codex may still load its local configuration
            and project guidance.
          </small>
        </label>
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
                });
                return;
              }
              const { textContext: _textContext, ...withoutContext } = config;
              onChange(compileAgentBlock(withoutContext));
            }}
          />
          Accept optional connected text through stdin
        </label>
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
            <option value="read-only">Read only</option>
            <option value="workspace-write">Workspace write</option>
          </select>
        </label>
        {config.authority === 'workspace-write' && (
          <div className="agent-authority-warning">
            <ShieldAlert size={14} />
            <span>
              Codex may create or modify files inside the resolved working
              directory. Generated paths must still be declared below.
            </span>
          </div>
        )}
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
                onChange(compileAgentBlock(withoutWorkingDirectory));
              }}
            />
            <button
              className="icon-button"
              aria-label="Choose Agent working directory"
              onClick={() =>
                void selectPath('directory', config.workingDirectory).then(
                  (path) => {
                    if (path !== undefined) update({ workingDirectory: path });
                  },
                )
              }
            >
              <FolderOpen size={14} />
            </button>
          </div>
          <small>No worktree is created in v0.2.</small>
        </label>
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
          Declaring a path does not create it. Codex must produce it; Vorchestra
          verifies it after a successful run.
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
        <InvocationPreview block={block} />
      </section>
    </div>
  );
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
