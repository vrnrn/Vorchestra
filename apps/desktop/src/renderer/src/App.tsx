import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import {
  validateWorkflow,
  type Artifact,
  type ArtifactKind,
  type BlockExecutionState,
  type ProcessBlock,
  type WorkflowDefinition,
} from '@vorchestra/engine';
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  FileCode2,
  FileInput,
  FolderOpen,
  GitBranch,
  GripVertical,
  Info,
  Layers3,
  LoaderCircle,
  PanelRightClose,
  Play,
  Plus,
  Save,
  SaveAll,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { BlockRunSnapshot, DesktopRunEvent } from '../../shared/contracts';
import { createProcessBlock, createWorkflow } from '../../shared/defaults';
import { ProcessNode, type ProcessFlowNode } from './ProcessNode';
import {
  addInputPort,
  addOutputPort,
  connectBlocks,
  moveListItem,
  moveRecordEntry,
  removeBlock,
  removeInputPort,
  removeOutputPort,
  reconcileProcessNodes,
  replaceBlock,
  setBlockPosition,
} from './workflow';

const nodeTypes = { process: ProcessNode };
type InspectorTab = 'configure' | 'run';
type ReorderGroup = 'arguments' | 'inputs' | 'outputs' | 'environment';
type ReorderLocation = { group: ReorderGroup; index: number };

export function App() {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(createWorkflow);
  const [nodes, setNodes] = useState<ProcessFlowNode[]>([]);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [filePath, setFilePath] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string>('welcome');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('configure');
  const [snapshots, setSnapshots] = useState<
    Readonly<Record<string, BlockRunSnapshot>>
  >({});
  const [activeRunId, setActiveRunId] = useState<string>();
  const [runOutcome, setRunOutcome] = useState<
    'succeeded' | 'failed' | 'cancelled'
  >();
  const [runPreviewOpen, setRunPreviewOpen] = useState(false);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [notice, setNotice] = useState<string>();

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const selectedBlock = workflow.blocks.find(
    (block) => block.id === selectedBlockId,
  );
  const isRunning = activeRunId !== undefined && runOutcome === undefined;

  const changeWorkflow = useCallback(
    (update: (current: WorkflowDefinition) => WorkflowDefinition) => {
      setWorkflow((current) => update(current));
      setDirty(true);
      setNotice(undefined);
    },
    [],
  );

  const resetCanvasWorkflow = useCallback((next: WorkflowDefinition): void => {
    setNodes(reconcileProcessNodes(next, [], () => 'idle'));
    setWorkflow(next);
    setCanvasRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    return window.vorchestra.onRunEvent((event: DesktopRunEvent) => {
      if (event.type === 'run_started') {
        setActiveRunId(event.runId);
        setRunOutcome(undefined);
        setSnapshots(
          Object.fromEntries(
            event.blocks.map((block) => [block.blockId, block]),
          ),
        );
      }
      if (event.type === 'block_updated') {
        setSnapshots((current) => ({
          ...current,
          [event.block.blockId]: event.block,
        }));
      }
      if (event.type === 'run_completed') {
        setRunOutcome(event.outcome);
        setNotice(
          event.error === undefined
            ? `Run ${event.outcome}.`
            : `${event.error.message} ${event.error.nextAction}`,
        );
      }
    });
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveWorkflow(event.shiftKey);
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openWorkflow();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  });

  useEffect(() => {
    setNodes((current) =>
      reconcileProcessNodes(
        workflow,
        current,
        (blockId) => snapshots[blockId]?.state ?? 'idle',
      ),
    );
  }, [snapshots, workflow]);

  const edges = useMemo<Edge[]>(
    () =>
      workflow.connections.map((connection) => ({
        id: connection.id,
        source: connection.from.blockId,
        sourceHandle: connection.from.portId,
        target: connection.to.blockId,
        targetHandle: connection.to.portId,
        type: 'smoothstep',
        animated:
          snapshots[connection.from.blockId]?.state === 'running' ||
          snapshots[connection.to.blockId]?.state === 'running',
        style: { stroke: '#67768d', strokeWidth: 1.5 },
      })),
    [snapshots, workflow.connections],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<ProcessFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      const removedIds = new Set(
        changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      if (removedIds.size > 0) {
        changeWorkflow((current) =>
          [...removedIds].reduce(removeBlock, current),
        );
        if (removedIds.has(selectedBlockId)) setSelectedBlockId('');
      }

      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          setSelectedBlockId(change.id);
          break;
        }
      }
    },
    [changeWorkflow, selectedBlockId],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<ProcessFlowNode>>(
    (_event, node) => {
      changeWorkflow((current) =>
        setBlockPosition(current, node.id, node.position),
      );
    },
    [changeWorkflow],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(
        changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      if (removed.size > 0) {
        changeWorkflow((current) => ({
          ...current,
          connections: current.connections.filter(
            (connection) => !removed.has(connection.id),
          ),
        }));
      }
    },
    [changeWorkflow],
  );

  const onConnect = useCallback(
    (connection: FlowConnection) => {
      if (
        connection.source === null ||
        connection.sourceHandle === null ||
        connection.target === null ||
        connection.targetHandle === null
      ) {
        return;
      }
      changeWorkflow((current) =>
        connectBlocks(
          current,
          connection.source!,
          connection.sourceHandle!,
          connection.target!,
          connection.targetHandle!,
        ),
      );
    },
    [changeWorkflow],
  );

  const addBlock = (): void => {
    const block = createProcessBlock();
    changeWorkflow((current) => ({
      ...current,
      blocks: [...current.blocks, block],
      layout: {
        blockPositions: {
          ...(current.layout?.blockPositions ?? {}),
          [block.id]: {
            x: 180 + (current.blocks.length % 3) * 300,
            y: 160 + Math.floor(current.blocks.length / 3) * 220,
          },
        },
      },
    }));
    setSelectedBlockId(block.id);
    setInspectorTab('configure');
  };

  async function saveWorkflow(saveAs = false): Promise<void> {
    try {
      const result = await window.vorchestra.saveWorkflow({
        workflow,
        ...(filePath === undefined ? {} : { filePath }),
        ...(saveAs ? { saveAs: true } : {}),
      });
      if (!result.canceled) {
        setFilePath(result.filePath);
        setDirty(false);
        setNotice('Workflow saved.');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function openWorkflow(): Promise<void> {
    if (
      dirty &&
      !window.confirm('Discard unsaved changes and open a workflow?')
    ) {
      return;
    }
    try {
      const result = await window.vorchestra.openWorkflow();
      if (result.canceled || result.workflow === undefined) return;
      resetCanvasWorkflow(result.workflow);
      setFilePath(result.filePath);
      setDirty(false);
      setSnapshots({});
      setRunOutcome(undefined);
      setActiveRunId(undefined);
      setSelectedBlockId(result.workflow.blocks[0]?.id ?? '');
      setNotice('Workflow opened.');
    } catch (error) {
      setNotice(`Could not open workflow: ${errorMessage(error)}`);
    }
  }

  function newWorkflow(): void {
    if (
      dirty &&
      !window.confirm('Discard unsaved changes and create a workflow?')
    ) {
      return;
    }
    const next = createWorkflow();
    resetCanvasWorkflow(next);
    setFilePath(undefined);
    setDirty(false);
    setSnapshots({});
    setRunOutcome(undefined);
    setActiveRunId(undefined);
    setSelectedBlockId(next.blocks[0]?.id ?? '');
    setNotice('New workflow created.');
  }

  async function startRun(): Promise<void> {
    if (!validation.valid || !trustConfirmed) return;
    try {
      setSnapshots({});
      setRunOutcome(undefined);
      const result = await window.vorchestra.runWorkflow(workflow);
      setActiveRunId(result.runId);
      setRunPreviewOpen(false);
      setTrustConfirmed(false);
      setInspectorTab('run');
    } catch (error) {
      setNotice(`Could not start run: ${errorMessage(error)}`);
    }
  }

  async function cancelRun(): Promise<void> {
    if (activeRunId !== undefined)
      await window.vorchestra.cancelRun(activeRunId);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={18} />
          </div>
          <span>VORCHESTRA</span>
          <em>v0.1</em>
        </div>
        <div className="document-title">
          <input
            aria-label="Workflow name"
            value={workflow.name}
            onChange={(event) =>
              changeWorkflow((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
          <small>
            {filePath ?? 'Not saved'}
            {dirty ? '  •' : ''}
          </small>
        </div>
        <div className="toolbar">
          <ToolbarButton
            icon={<FileCode2 size={15} />}
            label="New"
            onClick={newWorkflow}
          />
          <ToolbarButton
            icon={<FolderOpen size={15} />}
            label="Open"
            onClick={() => void openWorkflow()}
          />
          <ToolbarButton
            icon={<Save size={15} />}
            label="Save"
            onClick={() => void saveWorkflow()}
          />
          <ToolbarButton
            icon={<SaveAll size={15} />}
            label="Save As"
            onClick={() => void saveWorkflow(true)}
          />
          <span className="toolbar-separator" />
          {isRunning ? (
            <button className="button danger" onClick={() => void cancelRun()}>
              <CircleStop size={15} /> Cancel
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => setRunPreviewOpen(true)}
              disabled={!validation.valid}
              title={
                validation.valid
                  ? 'Review and run'
                  : 'Resolve validation issues first'
              }
            >
              <Play size={15} fill="currentColor" /> Review & Run
            </button>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="rail">
          <button className="add-process" onClick={addBlock}>
            <span>
              <TerminalSquare size={17} />
            </span>
            <span>
              <strong>Process</strong>
              <small>Generic local command</small>
            </span>
            <Plus size={15} />
          </button>
          <div className="rail-heading">WORKFLOW</div>
          <div className="workflow-stat">
            <GitBranch size={15} />
            <span>{workflow.blocks.length} blocks</span>
            <span>{workflow.connections.length} links</span>
          </div>
          <div
            className={`validation-summary ${validation.valid ? 'valid' : 'invalid'}`}
          >
            {validation.valid ? (
              <Check size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <div>
              <strong>
                {validation.valid
                  ? 'Ready to run'
                  : `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}`}
              </strong>
              <small>
                {validation.valid
                  ? 'Valid acyclic workflow'
                  : 'Execution is blocked'}
              </small>
            </div>
          </div>
          {!validation.valid && (
            <div className="issues-list">
              {validation.issues.map((issue, index) => (
                <button
                  key={`${issue.path}-${index}`}
                  onClick={() => selectIssueBlock(issue.path)}
                >
                  <XCircle size={13} />
                  <span>
                    {issue.message}
                    <small>{issue.path}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="rail-footer">
            <ShieldAlert size={14} />
            <span>Commands run with your local user permissions.</span>
          </div>
        </aside>

        <section className="canvas" aria-label="Workflow canvas">
          <div className="canvas-label">
            <span>CANVAS</span>
            <ChevronRight size={12} />
            <span>{workflow.name}</span>
          </div>
          <ReactFlow
            key={canvasRevision}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelectedBlockId('')}
            onNodeClick={(_, node) => setSelectedBlockId(node.id)}
            fitView
            fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={1.8}
            deleteKeyCode={['Backspace', 'Delete']}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1.2}
              color="#252a33"
            />
            <MiniMap
              className="minimap"
              pannable
              zoomable
              maskColor="rgba(8, 10, 14, .45)"
              nodeStrokeColor="#929dab"
              nodeStrokeWidth={1.5}
              nodeColor={(node) =>
                statusColor(snapshots[node.id]?.state ?? 'idle')
              }
            />
            <Controls className="flow-controls" showInteractive={false} />
          </ReactFlow>
          {workflow.blocks.length === 0 && (
            <div className="empty-canvas">
              <TerminalSquare size={28} />
              <strong>Add your first process</strong>
              <span>
                Build from generic local commands, then connect their typed
                ports.
              </span>
              <button className="button primary" onClick={addBlock}>
                <Plus size={14} /> Add process
              </button>
            </div>
          )}
        </section>

        <aside className="inspector">
          {selectedBlock === undefined ? (
            <div className="no-selection">
              <PanelRightClose size={24} />
              <strong>No block selected</strong>
              <span>
                Select a process on the canvas to configure or inspect it.
              </span>
            </div>
          ) : (
            <>
              <div className="inspector-header">
                <div>
                  <small>PROCESS BLOCK</small>
                  <strong>{selectedBlock.name}</strong>
                </div>
                <button
                  className="icon-button destructive"
                  title="Delete block"
                  onClick={() => {
                    changeWorkflow((current) =>
                      removeBlock(current, selectedBlock.id),
                    );
                    setSelectedBlockId('');
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="tab-list">
                <button
                  className={inspectorTab === 'configure' ? 'active' : ''}
                  onClick={() => setInspectorTab('configure')}
                >
                  Configure
                </button>
                <button
                  className={inspectorTab === 'run' ? 'active' : ''}
                  onClick={() => setInspectorTab('run')}
                >
                  Run details
                  {snapshots[selectedBlock.id] && (
                    <span
                      className={`tiny-dot ${snapshots[selectedBlock.id]?.state}`}
                    />
                  )}
                </button>
              </div>
              {inspectorTab === 'configure' ? (
                <BlockInspector
                  block={selectedBlock}
                  workflow={workflow}
                  onChange={(block) =>
                    changeWorkflow((current) => replaceBlock(current, block))
                  }
                  onWorkflowChange={(next) => {
                    setWorkflow(next);
                    setDirty(true);
                  }}
                />
              ) : (
                <RunInspector
                  {...(snapshots[selectedBlock.id] === undefined
                    ? {}
                    : { snapshot: snapshots[selectedBlock.id] })}
                />
              )}
            </>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span
          className={`run-indicator ${isRunning ? 'running' : (runOutcome ?? 'idle')}`}
        >
          {isRunning ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <span className="status-led" />
          )}
          {isRunning
            ? 'Execution active'
            : runOutcome
              ? `Last run: ${runOutcome}`
              : 'Idle'}
        </span>
        {notice && <span className="notice">{notice}</span>}
        <span className="status-spacer" />
        <span>Schema v{workflow.schemaVersion}</span>
        <span>Local execution</span>
      </footer>

      {runPreviewOpen && (
        <RunPreview
          workflow={workflow}
          valid={validation.valid}
          trustConfirmed={trustConfirmed}
          onTrustChange={setTrustConfirmed}
          onClose={() => {
            setRunPreviewOpen(false);
            setTrustConfirmed(false);
          }}
          onRun={() => void startRun()}
        />
      )}
    </main>
  );

  function selectIssueBlock(path: string): void {
    const match = /blocks\[(\d+)\]/.exec(path);
    const index = match?.[1] === undefined ? undefined : Number(match[1]);
    const block = index === undefined ? undefined : workflow.blocks[index];
    if (block !== undefined) setSelectedBlockId(block.id);
  }
}

function BlockInspector({
  block,
  workflow,
  onChange,
  onWorkflowChange,
}: {
  block: ProcessBlock;
  workflow: WorkflowDefinition;
  onChange: (block: ProcessBlock) => void;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
}) {
  const [draggedRow, setDraggedRow] = useState<ReorderLocation>();
  const [dropTarget, setDropTarget] = useState<ReorderLocation>();

  const patchInvocation = (patch: Partial<ProcessBlock['invocation']>): void =>
    onChange({ ...block, invocation: { ...block.invocation, ...patch } });

  const startReorder = (
    group: ReorderGroup,
    index: number,
    event: ReactDragEvent<HTMLButtonElement>,
  ): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${group}:${index}`);
    setDraggedRow({ group, index });
    setDropTarget(undefined);
  };

  const finishReorder = (): void => {
    setDraggedRow(undefined);
    setDropTarget(undefined);
  };

  const reorderTargetProps = (
    group: ReorderGroup,
    index: number,
    onMove: (fromIndex: number, toIndex: number) => void,
  ) => ({
    onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      setDropTarget({ group, index });
    },
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      if (draggedRow.index !== index) onMove(draggedRow.index, index);
      finishReorder();
    },
  });

  const reorderRowClass = (
    baseClass: string,
    group: ReorderGroup,
    index: number,
  ): string =>
    [
      baseClass,
      'reorder-row',
      draggedRow?.group === group && draggedRow.index === index
        ? 'is-dragging'
        : '',
      dropTarget?.group === group &&
      dropTarget.index === index &&
      draggedRow?.index !== index
        ? 'is-drop-target'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div className="inspector-scroll">
      <InspectorSection title="Identity">
        <Field label="Display name">
          <input
            value={block.name}
            onChange={(event) =>
              onChange({ ...block, name: event.target.value })
            }
          />
        </Field>
      </InspectorSection>

      <InspectorSection title="Invocation">
        <Field
          label="Executable"
          hint="Resolved using the declared PATH binding"
        >
          <input
            className="mono"
            value={block.invocation.executable}
            onChange={(event) =>
              patchInvocation({ executable: event.target.value })
            }
            spellCheck={false}
          />
        </Field>
        <Field
          label="Working directory"
          hint="Leave blank to use the application working directory"
        >
          <input
            className="mono"
            value={block.invocation.workingDirectory ?? ''}
            placeholder="/absolute/path"
            onChange={(event) =>
              patchInvocation(
                event.target.value.trim() === ''
                  ? { workingDirectory: undefined }
                  : { workingDirectory: event.target.value },
              )
            }
            spellCheck={false}
          />
        </Field>
        <label className="toggle-row shell-toggle">
          <span>
            <strong>Evaluate through shell</strong>
            <small>Enables expansion, pipes, and redirects</small>
          </span>
          <input
            type="checkbox"
            checked={block.invocation.shell}
            onChange={(event) =>
              patchInvocation({ shell: event.target.checked })
            }
          />
          <span className="toggle" />
        </label>
        {block.invocation.shell && (
          <div className="inline-warning">
            <AlertTriangle size={14} />
            <span>
              Shell mode expands the command's authority. Review every argument
              before running.
            </span>
          </div>
        )}
      </InspectorSection>

      <InspectorSection
        title="Arguments"
        action={
          <button
            className="section-action"
            onClick={() =>
              patchInvocation({
                arguments: [
                  ...block.invocation.arguments,
                  { type: 'literal', value: '' },
                ],
              })
            }
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        <div className="argument-list">
          {block.invocation.arguments.map((argument, index) =>
            argument.type === 'literal' ? (
              <div
                className={reorderRowClass('argument-row', 'arguments', index)}
                key={index}
                {...reorderTargetProps('arguments', index, (from, to) =>
                  patchInvocation({
                    arguments: moveListItem(
                      block.invocation.arguments,
                      from,
                      to,
                    ),
                  }),
                )}
              >
                <ReorderHandle
                  label={`argument ${index + 1}`}
                  onDragStart={(event) =>
                    startReorder('arguments', index, event)
                  }
                  onDragEnd={finishReorder}
                  onMove={(offset) =>
                    patchInvocation({
                      arguments: moveListItem(
                        block.invocation.arguments,
                        index,
                        index + offset,
                      ),
                    })
                  }
                />
                <span>{index + 1}</span>
                <input
                  className="mono"
                  value={argument.value}
                  aria-label={`Argument ${index + 1}`}
                  onChange={(event) => {
                    const arguments_ = [...block.invocation.arguments];
                    arguments_[index] = {
                      type: 'literal',
                      value: event.target.value,
                    };
                    patchInvocation({ arguments: arguments_ });
                  }}
                />
                <button
                  className="icon-button"
                  onClick={() =>
                    patchInvocation({
                      arguments: block.invocation.arguments.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div
                className={reorderRowClass(
                  'argument-row input-binding',
                  'arguments',
                  index,
                )}
                key={`input:${argument.portId}`}
                {...reorderTargetProps('arguments', index, (from, to) =>
                  patchInvocation({
                    arguments: moveListItem(
                      block.invocation.arguments,
                      from,
                      to,
                    ),
                  }),
                )}
              >
                <ReorderHandle
                  label={`input argument ${argument.portId}`}
                  onDragStart={(event) =>
                    startReorder('arguments', index, event)
                  }
                  onDragEnd={finishReorder}
                  onMove={(offset) =>
                    patchInvocation({
                      arguments: moveListItem(
                        block.invocation.arguments,
                        index,
                        index + offset,
                      ),
                    })
                  }
                />
                <span>{index + 1}</span>
                <code>input:{argument.portId}</code>
                <small>bound port</small>
              </div>
            ),
          )}
          {block.invocation.arguments.length === 0 && (
            <EmptyLine text="No command arguments" />
          )}
        </div>
      </InspectorSection>

      <InspectorSection
        title="Input ports"
        action={
          <button
            className="section-action"
            onClick={() => onChange(addInputPort(block))}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {block.inputs.map((port, index) => (
          <div
            className={reorderRowClass('port-editor', 'inputs', index)}
            key={port.id}
            {...reorderTargetProps('inputs', index, (from, to) =>
              onChange({
                ...block,
                inputs: moveListItem(block.inputs, from, to),
              }),
            )}
          >
            <div className={`kind-bar kind-${port.artifactKind}`} />
            <ReorderHandle
              label={`input port ${port.name}`}
              onDragStart={(event) => startReorder('inputs', index, event)}
              onDragEnd={finishReorder}
              onMove={(offset) =>
                onChange({
                  ...block,
                  inputs: moveListItem(block.inputs, index, index + offset),
                })
              }
            />
            <input
              value={port.name}
              aria-label="Input name"
              onChange={(event) =>
                onChange({
                  ...block,
                  inputs: block.inputs.map((candidate) =>
                    candidate.id === port.id
                      ? { ...candidate, name: event.target.value }
                      : candidate,
                  ),
                })
              }
            />
            <select
              value={port.artifactKind}
              onChange={(event) =>
                onChange({
                  ...block,
                  inputs: block.inputs.map((candidate) =>
                    candidate.id === port.id
                      ? {
                          ...candidate,
                          artifactKind: event.target.value as ArtifactKind,
                        }
                      : candidate,
                  ),
                })
              }
            >
              <ArtifactOptions />
            </select>
            <select
              aria-label="Input delivery"
              value={
                block.invocation.stdin?.portId === port.id
                  ? 'stdin'
                  : 'argument'
              }
              onChange={(event) => {
                const without = block.invocation.arguments.filter(
                  (argument) =>
                    !(argument.type === 'input' && argument.portId === port.id),
                );
                patchInvocation({
                  arguments:
                    event.target.value === 'argument'
                      ? [...without, { type: 'input', portId: port.id }]
                      : without,
                  stdin:
                    event.target.value === 'stdin'
                      ? { portId: port.id }
                      : block.invocation.stdin?.portId === port.id
                        ? undefined
                        : block.invocation.stdin,
                });
              }}
            >
              <option value="argument">Argument</option>
              <option value="stdin">stdin</option>
            </select>
            <button
              className="icon-button"
              onClick={() =>
                onWorkflowChange(removeInputPort(workflow, block, port.id))
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {block.inputs.length === 0 && (
          <EmptyLine text="No incoming artifacts" />
        )}
      </InspectorSection>

      <InspectorSection
        title="Output ports"
        action={
          <button
            className="section-action"
            onClick={() => onChange(addOutputPort(block))}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {block.outputs.map((port, index) => {
          const binding = block.invocation.outputs.find(
            (candidate) => candidate.portId === port.id,
          );
          return (
            <div
              className={reorderRowClass(
                'port-editor output-editor',
                'outputs',
                index,
              )}
              key={port.id}
              {...reorderTargetProps('outputs', index, (from, to) =>
                onChange({
                  ...block,
                  outputs: moveListItem(block.outputs, from, to),
                }),
              )}
            >
              <div className={`kind-bar kind-${port.artifactKind}`} />
              <ReorderHandle
                label={`output port ${port.name}`}
                onDragStart={(event) => startReorder('outputs', index, event)}
                onDragEnd={finishReorder}
                onMove={(offset) =>
                  onChange({
                    ...block,
                    outputs: moveListItem(block.outputs, index, index + offset),
                  })
                }
              />
              <input
                value={port.name}
                aria-label="Output name"
                onChange={(event) =>
                  onChange({
                    ...block,
                    outputs: block.outputs.map((candidate) =>
                      candidate.id === port.id
                        ? { ...candidate, name: event.target.value }
                        : candidate,
                    ),
                  })
                }
              />
              <select
                value={port.artifactKind}
                onChange={(event) => {
                  const artifactKind = event.target.value as ArtifactKind;
                  const outputs = block.outputs.map((candidate) =>
                    candidate.id === port.id
                      ? { ...candidate, artifactKind }
                      : candidate,
                  );
                  const bindings = block.invocation.outputs.filter(
                    (candidate) => candidate.portId !== port.id,
                  );
                  const nextBinding =
                    artifactKind === 'filesystem-reference'
                      ? {
                          type: 'filesystem' as const,
                          portId: port.id,
                          path: './output',
                        }
                      : { type: 'stdout' as const, portId: port.id };
                  onChange({
                    ...block,
                    outputs,
                    invocation: {
                      ...block.invocation,
                      outputs: [...bindings, nextBinding],
                    },
                  });
                }}
              >
                <ArtifactOptions />
              </select>
              <button
                className="icon-button"
                onClick={() =>
                  onWorkflowChange(removeOutputPort(workflow, block, port.id))
                }
              >
                <Trash2 size={13} />
              </button>
              <div className="binding-row">
                <span>Binding</span>
                <code>{binding?.type ?? 'missing'}</code>
                {binding?.type === 'filesystem' && (
                  <input
                    className="mono"
                    aria-label="Output path"
                    value={binding.path}
                    onChange={(event) =>
                      patchInvocation({
                        outputs: block.invocation.outputs.map((candidate) =>
                          candidate.portId === port.id &&
                          candidate.type === 'filesystem'
                            ? { ...candidate, path: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
        {block.outputs.length === 0 && (
          <EmptyLine text="No produced artifacts" />
        )}
      </InspectorSection>

      <InspectorSection
        title="Environment"
        action={
          <button
            className="section-action"
            onClick={() => {
              let index = 1;
              while (`VARIABLE_${index}` in block.invocation.environment)
                index += 1;
              patchInvocation({
                environment: {
                  ...block.invocation.environment,
                  [`VARIABLE_${index}`]: {
                    source: 'host',
                    name: `VARIABLE_${index}`,
                  },
                },
              });
            }}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {Object.entries(block.invocation.environment).map(
          ([key, value], index) => (
            <div
              className={reorderRowClass(
                'environment-row',
                'environment',
                index,
              )}
              key={key}
              {...reorderTargetProps('environment', index, (from, to) =>
                patchInvocation({
                  environment: moveRecordEntry(
                    block.invocation.environment,
                    from,
                    to,
                  ),
                }),
              )}
            >
              <ReorderHandle
                label={`environment variable ${key}`}
                onDragStart={(event) =>
                  startReorder('environment', index, event)
                }
                onDragEnd={finishReorder}
                onMove={(offset) =>
                  patchInvocation({
                    environment: moveRecordEntry(
                      block.invocation.environment,
                      index,
                      index + offset,
                    ),
                  })
                }
              />
              <EnvironmentRow
                name={key}
                value={value}
                onChange={(nextName, nextValue) => {
                  const environment = { ...block.invocation.environment };
                  const entries = Object.entries(environment).map(
                    ([candidateName, candidateValue]) =>
                      candidateName === key
                        ? ([nextName, nextValue] as const)
                        : ([candidateName, candidateValue] as const),
                  );
                  patchInvocation({ environment: Object.fromEntries(entries) });
                }}
                onRemove={() => {
                  const environment = { ...block.invocation.environment };
                  delete environment[key];
                  patchInvocation({ environment });
                }}
              />
            </div>
          ),
        )}
        {Object.keys(block.invocation.environment).length === 0 && (
          <EmptyLine text="No environment access declared" />
        )}
        <p className="section-note">
          <Info size={12} /> Host values are referenced by name. Literal values
          are stored in the workflow—do not put secrets there.
        </p>
      </InspectorSection>
    </div>
  );
}

type EnvironmentValue = ProcessBlock['invocation']['environment'][string];

function ReorderHandle({
  label,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  label: string;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(event.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <button
      type="button"
      className="reorder-handle"
      draggable
      aria-label={`Reorder ${label}`}
      title="Drag to reorder; use Up and Down arrow keys for keyboard control"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={handleKeyDown}
    >
      <GripVertical size={14} />
    </button>
  );
}

function EnvironmentRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  value: EnvironmentValue;
  onChange: (name: string, value: EnvironmentValue) => void;
  onRemove: () => void;
}) {
  const source = value.source === 'input' ? 'host' : value.source;
  return (
    <>
      <input
        className="mono"
        value={name}
        aria-label="Environment variable"
        onChange={(event) => onChange(event.target.value, value)}
      />
      <select
        value={source}
        onChange={(event) =>
          onChange(
            name,
            event.target.value === 'literal'
              ? { source: 'literal', value: '' }
              : { source: 'host', name },
          )
        }
      >
        <option value="host">Host ref</option>
        <option value="literal">Literal</option>
      </select>
      <input
        className="mono"
        aria-label="Environment value"
        value={
          value.source === 'literal'
            ? value.value
            : value.source === 'host'
              ? value.name
              : value.portId
        }
        onChange={(event) =>
          onChange(
            name,
            value.source === 'literal'
              ? { source: 'literal', value: event.target.value }
              : { source: 'host', name: event.target.value },
          )
        }
      />
      <button className="icon-button" onClick={onRemove}>
        <Trash2 size={13} />
      </button>
    </>
  );
}

function RunInspector({ snapshot }: { snapshot?: BlockRunSnapshot }) {
  if (snapshot === undefined) {
    return (
      <div className="run-empty">
        <Clock3 size={22} />
        <strong>Not run yet</strong>
        <span>
          Run the workflow to inspect resolved inputs, output, and timing.
        </span>
      </div>
    );
  }
  const duration =
    snapshot.startedAt && snapshot.endedAt
      ? `${new Date(snapshot.endedAt).getTime() - new Date(snapshot.startedAt).getTime()} ms`
      : snapshot.startedAt
        ? 'Running…'
        : '—';
  return (
    <div className="inspector-scroll run-details">
      <div className={`run-state-card ${snapshot.state}`}>
        {stateIcon(snapshot.state)}
        <div>
          <small>BLOCK STATE</small>
          <strong>{snapshot.state}</strong>
        </div>
        <span>{duration}</span>
      </div>
      {snapshot.failure && (
        <div className="failure-card">
          <XCircle size={16} />
          <div>
            <strong>{snapshot.failure.code}</strong>
            <p>{snapshot.failure.message}</p>
            {snapshot.failure.nextAction && (
              <small>{snapshot.failure.nextAction}</small>
            )}
          </div>
        </div>
      )}
      {snapshot.skipReason && (
        <div className="failure-card muted">
          <Info size={16} />
          <p>{snapshot.skipReason}</p>
        </div>
      )}
      <DataSection
        title="Resolved inputs"
        count={Object.keys(snapshot.inputs).length}
      >
        {Object.entries(snapshot.inputs).map(([portId, artifact]) => (
          <ArtifactView key={portId} label={portId} artifact={artifact} />
        ))}
        {Object.keys(snapshot.inputs).length === 0 && (
          <EmptyLine text="No inputs" />
        )}
      </DataSection>
      <DataSection title="Produced artifacts" count={snapshot.artifacts.length}>
        {snapshot.artifacts.map((artifact) => (
          <ArtifactView
            key={artifact.id}
            label={artifact.provenance.portId}
            artifact={artifact}
          />
        ))}
        {snapshot.artifacts.length === 0 && <EmptyLine text="No artifacts" />}
      </DataSection>
      <DataSection title="stdout">
        <pre>{snapshot.stdout || 'No stdout captured.'}</pre>
      </DataSection>
      <DataSection title="stderr">
        <pre className={snapshot.stderr ? 'error-output' : ''}>
          {snapshot.stderr || 'No stderr captured.'}
        </pre>
      </DataSection>
      <DataSection title="Process result">
        <dl className="result-grid">
          <dt>Exit code</dt>
          <dd>{snapshot.exitCode ?? '—'}</dd>
          <dt>Started</dt>
          <dd>{formatTime(snapshot.startedAt)}</dd>
          <dt>Ended</dt>
          <dd>{formatTime(snapshot.endedAt)}</dd>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </dl>
      </DataSection>
    </div>
  );
}

function RunPreview({
  workflow,
  valid,
  trustConfirmed,
  onTrustChange,
  onClose,
  onRun,
}: {
  workflow: WorkflowDefinition;
  valid: boolean;
  trustConfirmed: boolean;
  onTrustChange: (checked: boolean) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="run-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review workflow authority"
      >
        <header>
          <div className="modal-icon">
            <ShieldAlert size={20} />
          </div>
          <div>
            <small>AUTHORITY REVIEW</small>
            <h2>Review before running</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="trust-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>This workflow is executable code.</strong>
            <p>
              Processes run locally with your user permissions. Shell blocks can
              interpret expansion, pipes, redirects, and other shell syntax.
              Output may contain sensitive data.
            </p>
          </div>
        </div>
        <div className="preview-meta">
          <span>
            <GitBranch size={14} /> {workflow.blocks.length} processes
          </span>
          <span>
            <FileInput size={14} /> {workflow.connections.length} artifact
            routes
          </span>
          <span>
            <Check size={14} /> Manual run
          </span>
        </div>
        <div className="command-preview">
          {workflow.blocks.map((block, index) => (
            <article
              key={block.id}
              className={block.invocation.shell ? 'uses-shell' : ''}
            >
              <span className="preview-index">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <strong>{block.name}</strong>
                <code>{commandPreview(block)}</code>
                <small>
                  cwd:{' '}
                  {block.invocation.workingDirectory ?? 'application default'}
                </small>
              </div>
              <div className="preview-authority">
                {block.invocation.shell && (
                  <span className="warning-pill">SHELL</span>
                )}
                {Object.entries(block.invocation.environment).map(
                  ([name, value]) => (
                    <span key={name}>
                      {name} ←{' '}
                      {value.source === 'host'
                        ? `host:${value.name}`
                        : value.source}
                    </span>
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
        <label className="consent-row">
          <input
            type="checkbox"
            checked={trustConfirmed}
            onChange={(event) => onTrustChange(event.target.checked)}
          />
          <span className="custom-check">
            <Check size={13} />
          </span>
          <span>
            I reviewed the commands and trust this workflow to run on my
            computer.
          </span>
        </label>
        <footer>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!valid || !trustConfirmed}
            onClick={onRun}
          >
            <Play size={15} fill="currentColor" /> Run workflow
          </button>
        </footer>
      </section>
    </div>
  );
}

function ArtifactView({
  label,
  artifact,
}: {
  label: string;
  artifact: Artifact;
}) {
  const value =
    artifact.kind === 'filesystem-reference'
      ? artifact.path
      : artifact.kind === 'json'
        ? JSON.stringify(artifact.value, null, 2)
        : artifact.value;
  return (
    <div className="artifact-view">
      <div>
        <Braces size={13} />
        <strong>{label}</strong>
        <span>{artifact.kind}</span>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function InspectorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="inspector-section">
      <header>
        <span>{title}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

function DataSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="data-section">
      <header>
        <span>{title}</span>
        {count !== undefined && <em>{count}</em>}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="toolbar-button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ArtifactOptions() {
  return (
    <>
      <option value="text">Text</option>
      <option value="json">JSON</option>
      <option value="filesystem-reference">File ref</option>
    </>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="empty-line">{text}</div>;
}

function commandPreview(block: ProcessBlock): string {
  const args = block.invocation.arguments.map((argument) =>
    argument.type === 'literal'
      ? quoteArgument(argument.value)
      : `<input:${argument.portId}>`,
  );
  return [block.invocation.executable, ...args].join(' ');
}

function quoteArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function formatTime(value?: string): string {
  return value === undefined
    ? '—'
    : new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateIcon(state: BlockExecutionState): React.ReactNode {
  if (state === 'running') return <LoaderCircle size={19} className="spin" />;
  if (state === 'succeeded') return <Check size={19} />;
  if (state === 'failed') return <XCircle size={19} />;
  if (state === 'cancelled') return <CircleStop size={19} />;
  return <Clock3 size={19} />;
}

function statusColor(state: BlockExecutionState | 'idle'): string {
  if (state === 'succeeded') return '#4cc38a';
  if (state === 'failed') return '#f06a6a';
  if (state === 'running') return '#e5b767';
  if (state === 'cancelled') return '#aa8df0';
  return '#526075';
}
