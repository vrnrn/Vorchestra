import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  parseWorkflowRunInputs,
  validateWorkflow,
  type Artifact,
  type ArtifactKind,
  type BlockPreflightPreview,
  type BlockExecutionState,
  type ExecutionFailure,
  type ProcessArgument,
  type ProcessBlock,
  type ProcessStdin,
  type WorkflowPreflightResult,
  type WorkflowRunInputs,
  type WorkflowDefinition,
} from '@vorchestra/engine';
import {
  AlertTriangle,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Copy,
  FileCode2,
  FileInput,
  FolderOpen,
  GitBranch,
  GripVertical,
  History,
  Info,
  Layers3,
  LoaderCircle,
  MonitorUp,
  Network,
  PanelRightClose,
  Play,
  Plus,
  Redo2,
  Save,
  SaveAll,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  BlockRunSnapshot,
  DesktopRunEvent,
  RunHistoryRecord,
  UserModelCatalogResult,
} from '../../shared/contracts';
import {
  AGENT_RUNTIME_REGISTRY,
  agentEditorConfigFromBlock,
  compileAgentBlock,
  getAgentBlockMetadataIssue,
  getAgentBlockPresentation,
  normalizeAgentRuntimeWorkflow,
  removeBlockPresentation,
  setAgentBlockPresentation,
  withResolvedAgentWorkingDirectory,
  type AgentBlockMetadataIssue,
  type AgentBlockPresentation,
  type AgentRuntimeId,
} from '../../shared/agent-runtime';
import {
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
  getComputerUseBlockMetadataIssue,
  getComputerUseBlockPresentation,
  setComputerUseBlockPresentation,
  type ComputerUseBlockPresentation,
} from '../../shared/computer-use-runtime';
import { createProcessBlock, createWorkflow } from '../../shared/defaults';
import { AgentBlockInspector } from './AgentBlockInspector';
import { ComputerUseBlockInspector } from './ComputerUseBlockInspector';
import {
  clearWorkflowDraft,
  readWorkflowDraft,
  writeWorkflowDraft,
} from './draft-store';
import { ProcessNode, type ProcessFlowNode } from './ProcessNode';
import { InvocationPreview } from './InvocationPreview';
import { PreflightPanel } from './PreflightPanel';
import { RunHistoryPanel } from './RunHistoryPanel';
import { RunInputFields, WorkflowInputsEditor } from './WorkflowInputs';
import {
  buildWorkflowRunInputs,
  serializeRunInputValue,
} from './workflow-inputs';
import {
  addInputPort,
  addOutputPort,
  autoArrangeWorkflow,
  connectBlocks,
  copyProcessBlock,
  createWorkflowHistory,
  moveListItem,
  moveRecordEntry,
  pasteProcessBlock,
  removeBlock,
  removeInputPort,
  removeOutputPort,
  reconcileProcessNodes,
  redoWorkflowHistory,
  replaceBlock,
  setBlockPosition,
  pushWorkflowHistory,
  undoWorkflowHistory,
  type ProcessBlockClipboard,
  type WorkflowHistory,
} from './workflow';

type InspectorTab = 'configure' | 'run';
type ReorderGroup = 'arguments' | 'inputs' | 'outputs' | 'environment';
type ReorderLocation = { group: ReorderGroup; index: number };
type InspectorFocusRequest = {
  readonly blockId: string;
  readonly field: string;
  readonly nonce: number;
};

export function App() {
  const [recoveredDraft] = useState(readWorkflowDraft);
  const [history, setHistory] = useState<WorkflowHistory>(() =>
    createWorkflowHistory(recoveredDraft?.workflow ?? createWorkflow()),
  );
  const workflow = history.present;
  const [nodes, setNodes] = useState<ProcessFlowNode[]>([]);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [filePath, setFilePath] = useState<string | undefined>(
    recoveredDraft?.filePath,
  );
  const [dirty, setDirty] = useState(recoveredDraft !== undefined);
  const [historyBaselineDirty, setHistoryBaselineDirty] = useState(
    recoveredDraft !== undefined,
  );
  const canvasRef = useRef<HTMLElement>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    ProcessFlowNode,
    Edge
  > | null>(null);
  const lastCanvasPointerRef = useRef<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string>(
    workflow.blocks[0]?.id ?? '',
  );
  const [blockClipboard, setBlockClipboard] = useState<ProcessBlockClipboard>();
  const [blockClipboardPresentation, setBlockClipboardPresentation] = useState<
    AgentBlockPresentation | ComputerUseBlockPresentation
  >();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('configure');
  const [snapshots, setSnapshots] = useState<
    Readonly<Record<string, BlockRunSnapshot>>
  >({});
  const [activeRunId, setActiveRunId] = useState<string>();
  const [runOutcome, setRunOutcome] = useState<
    'succeeded' | 'failed' | 'cancelled'
  >();
  const [runPreviewOpen, setRunPreviewOpen] = useState(false);
  const [plannedRunId, setPlannedRunId] = useState(() => crypto.randomUUID());
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [runInputValues, setRunInputValues] = useState<
    Readonly<Record<string, string>>
  >({});
  const [preflight, setPreflight] = useState<WorkflowPreflightResult>();
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [runHistory, setRunHistory] = useState<readonly RunHistoryRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [inspectorFocusRequest, setInspectorFocusRequest] =
    useState<InspectorFocusRequest>();
  const [userModelCatalog, setUserModelCatalog] =
    useState<UserModelCatalogResult>();
  const [notice, setNotice] = useState<string | undefined>(
    recoveredDraft === undefined ? undefined : 'Recovered unsaved draft.',
  );

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const selectedBlock = workflow.blocks.find(
    (block) => block.id === selectedBlockId,
  );
  const selectedPresentation =
    selectedBlock === undefined
      ? undefined
      : getAgentBlockPresentation(workflow, selectedBlock.id);
  const selectedMetadataIssue =
    selectedBlock === undefined
      ? undefined
      : getAgentBlockMetadataIssue(workflow, selectedBlock.id);
  const selectedComputerUsePresentation =
    selectedBlock === undefined
      ? undefined
      : getComputerUseBlockPresentation(workflow, selectedBlock.id);
  const selectedComputerUseMetadataIssue =
    selectedBlock === undefined
      ? undefined
      : getComputerUseBlockMetadataIssue(workflow, selectedBlock.id);
  const runInputBuild = useMemo(
    () => buildWorkflowRunInputs(workflow, runInputValues),
    [runInputValues, workflow],
  );
  const isRunning = activeRunId !== undefined && runOutcome === undefined;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const selectFilesystemPath = useCallback(
    async (
      kind: 'file' | 'directory' | 'output-file',
      defaultPath?: string,
    ): Promise<string | undefined> => {
      const result = await window.vorchestra.selectFilesystemPath({
        kind,
        ...(defaultPath === undefined ? {} : { defaultPath }),
      });
      return result.canceled ? undefined : result.path;
    },
    [],
  );

  const refreshRunHistory = useCallback(async (): Promise<void> => {
    try {
      setRunHistory(await window.vorchestra.listRunHistory(workflow.id));
    } catch (error) {
      setNotice(`Could not load run history: ${errorMessage(error)}`);
    }
  }, [workflow.id]);

  const changeWorkflow = useCallback(
    (update: (current: WorkflowDefinition) => WorkflowDefinition) => {
      setHistory((current) =>
        pushWorkflowHistory(current, update(current.present)),
      );
      setDirty(true);
      setNotice(undefined);
    },
    [],
  );

  const resetCanvasWorkflow = useCallback((next: WorkflowDefinition): void => {
    setNodes(reconcileProcessNodes(next, [], () => 'idle'));
    setHistory(createWorkflowHistory(next));
    setCanvasRevision((revision) => revision + 1);
  }, []);

  const restoreHistory = useCallback(
    (next: WorkflowHistory): void => {
      setHistory(next);
      setNodes(
        reconcileProcessNodes(
          next.present,
          [],
          (blockId) => snapshots[blockId]?.state ?? 'idle',
        ),
      );
      setCanvasRevision((revision) => revision + 1);
      setDirty(historyBaselineDirty || next.past.length > 0);
      setNotice(undefined);
    },
    [historyBaselineDirty, snapshots],
  );

  const undo = useCallback((): void => {
    const next = undoWorkflowHistory(history);
    if (next !== history) restoreHistory(next);
  }, [history, restoreHistory]);

  const redo = useCallback((): void => {
    const next = redoWorkflowHistory(history);
    if (next !== history) restoreHistory(next);
  }, [history, restoreHistory]);

  const copyBlock = useCallback(
    (blockId: string): void => {
      const copied = copyProcessBlock(workflow, blockId);
      if (copied === undefined) return;
      setBlockClipboard(copied);
      setBlockClipboardPresentation(
        getAgentBlockPresentation(workflow, blockId) ??
          getComputerUseBlockPresentation(workflow, blockId),
      );
      setNotice(`Copied ${copied.block.name}.`);
    },
    [workflow],
  );

  const copySelectedBlock = useCallback((): void => {
    copyBlock(selectedBlockId);
  }, [copyBlock, selectedBlockId]);

  const getPastePosition = useCallback(() => {
    const reactFlow = reactFlowInstanceRef.current;
    if (reactFlow === null) return undefined;
    if (lastCanvasPointerRef.current !== null) {
      return reactFlow.screenToFlowPosition(lastCanvasPointerRef.current);
    }
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const bounds = canvas.getBoundingClientRect();
    return reactFlow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  }, []);

  const pasteCopiedBlock = useCallback((): void => {
    if (blockClipboard === undefined) return;
    const position = getPastePosition();
    const pasted = pasteProcessBlock(
      workflow,
      blockClipboard,
      position === undefined ? {} : { position },
    );
    const nextWorkflow = (() => {
      if (blockClipboardPresentation === undefined) return pasted.workflow;
      if (blockClipboardPresentation.kind === 'computer-use') {
        return setComputerUseBlockPresentation(
          pasted.workflow,
          pasted.blockId,
          {
            ...blockClipboardPresentation.config,
            id: pasted.blockId,
            name: blockClipboard.block.name,
          },
        );
      }
      return setAgentBlockPresentation(
        pasted.workflow,
        pasted.blockId,
        blockClipboardPresentation.agentRuntime,
        blockClipboardPresentation.isolation,
      );
    })();
    setHistory(pushWorkflowHistory(history, nextWorkflow));
    setSelectedBlockId(pasted.blockId);
    setInspectorTab('configure');
    setDirty(true);
    setNotice(`Pasted ${blockClipboard.block.name}.`);
  }, [
    blockClipboard,
    blockClipboardPresentation,
    getPastePosition,
    history,
    workflow,
  ]);

  const nodeTypes = useMemo(
    () => ({
      process: (props: NodeProps<ProcessFlowNode>) => (
        <ProcessNode
          {...props}
          onCopy={() => copyBlock(props.id)}
          onPaste={pasteCopiedBlock}
          pasteDisabled={blockClipboard === undefined}
        />
      ),
    }),
    [blockClipboard, copyBlock, pasteCopiedBlock],
  );

  const autoArrange = useCallback((): void => {
    const arranged = autoArrangeWorkflow(workflow);
    setHistory(pushWorkflowHistory(history, arranged));
    setNodes(
      reconcileProcessNodes(
        arranged,
        [],
        (blockId) => snapshots[blockId]?.state ?? 'idle',
      ),
    );
    setCanvasRevision((revision) => revision + 1);
    setDirty(true);
    setNotice('Workflow arranged.');
  }, [history, snapshots, workflow]);

  useEffect(() => {
    let active = true;
    void window.vorchestra
      .getUserModelCatalog()
      .then((result) => {
        if (!active) return;
        setUserModelCatalog(result);
        if (result.issue !== undefined) setNotice(result.issue);
      })
      .catch((error: unknown) => {
        if (active)
          setNotice(`Could not load model settings: ${errorMessage(error)}`);
      });
    return () => {
      active = false;
    };
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
        void refreshRunHistory();
      }
    });
  }, [refreshRunHistory]);

  useEffect(() => {
    void refreshRunHistory();
  }, [refreshRunHistory]);

  useEffect(() => {
    let active = true;
    setPreflightLoading(true);
    void window.vorchestra
      .preflightWorkflow({
        runId: plannedRunId,
        workflow,
        runInputs: runInputBuild.inputs,
        ...(filePath === undefined ? {} : { workflowFilePath: filePath }),
      })
      .then((result) => {
        if (active) setPreflight(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setPreflight(undefined);
          setNotice(`Preflight failed: ${errorMessage(error)}`);
        }
      })
      .finally(() => {
        if (active) setPreflightLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filePath, plannedRunId, runInputBuild.inputs, workflow]);

  useEffect(() => {
    if (dirty) {
      writeWorkflowDraft({
        workflow,
        ...(filePath === undefined ? {} : { filePath }),
      });
    } else {
      clearWorkflowDraft();
    }
  }, [dirty, filePath, workflow]);

  useEffect(() => {
    if (
      selectedBlockId !== '' &&
      !workflow.blocks.some((block) => block.id === selectedBlockId)
    ) {
      setSelectedBlockId(workflow.blocks[0]?.id ?? '');
    }
  }, [selectedBlockId, workflow.blocks]);

  useEffect(() => {
    if (
      inspectorFocusRequest === undefined ||
      inspectorTab !== 'configure' ||
      selectedBlockId !== inspectorFocusRequest.blockId
    ) {
      return;
    }
    const animationFrame = requestAnimationFrame(() => {
      const fields = document
        .querySelector<HTMLElement>('.inspector')
        ?.querySelectorAll<HTMLElement>('[data-inspector-field]');
      const target =
        fields === undefined
          ? undefined
          : [...fields].find((candidate) =>
              inspectorFieldMatches(
                candidate.dataset.inspectorField,
                inspectorFocusRequest.field,
              ),
            );
      target?.focus();
      target?.scrollIntoView?.({ block: 'center' });
      setInspectorFocusRequest(undefined);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [inspectorFocusRequest, inspectorTab, selectedBlockId]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        void saveWorkflow(event.shiftKey);
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        void openWorkflow();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (key === 'c') {
        event.preventDefault();
        copySelectedBlock();
      }
      if (key === 'v') {
        event.preventDefault();
        pasteCopiedBlock();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [copySelectedBlock, pasteCopiedBlock, redo, undo]);

  useEffect(() => {
    setNodes((current) =>
      reconcileProcessNodes(
        workflow,
        current,
        (blockId) => snapshots[blockId]?.state ?? 'idle',
      ).map((node) => {
        const selected = node.id === selectedBlockId;
        return node.selected === selected ? node : { ...node, selected };
      }),
    );
  }, [selectedBlockId, snapshots, workflow]);

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
          [...removedIds].reduce(removeEditorBlock, current),
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

  const onCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.react-flow__node-toolbar') !== null
      ) {
        return;
      }
      const reactFlow = reactFlowInstanceRef.current;
      if (reactFlow === null) return;
      lastCanvasPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    },
    [],
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

  const addAgentBlock = (): void => {
    const block = compileAgentBlock({
      id: crypto.randomUUID(),
      name: 'AI Agent',
      agentRuntime: 'codex',
      instruction: 'Complete the requested task and return a concise response.',
      ...(userModelCatalog?.catalog.codex.default === undefined
        ? {}
        : { model: userModelCatalog.catalog.codex.default }),
      authority: 'read-only',
      textContext: { portId: 'context', name: 'Context' },
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
      isolation: { mode: 'current-directory' },
    });
    changeWorkflow((current) =>
      setAgentBlockPresentation(
        {
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
        },
        block.id,
        'codex',
        { mode: 'current-directory' },
      ),
    );
    setSelectedBlockId(block.id);
    setInspectorTab('configure');
  };

  const addComputerUseBlock = (): void => {
    const id = crypto.randomUUID();
    const config = createDefaultComputerUseConfig({
      id,
      ...(userModelCatalog?.catalog.codex.default === undefined
        ? {}
        : { model: userModelCatalog.catalog.codex.default }),
    });
    const block = compileComputerUseBlock(config);
    changeWorkflow((current) =>
      setComputerUseBlockPresentation(
        {
          ...current,
          blocks: [...current.blocks, block],
          layout: {
            blockPositions: {
              ...(current.layout?.blockPositions ?? {}),
              [id]: {
                x: 180 + (current.blocks.length % 3) * 300,
                y: 160 + Math.floor(current.blocks.length / 3) * 220,
              },
            },
          },
        },
        id,
        config,
      ),
    );
    setSelectedBlockId(id);
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
        setHistory(createWorkflowHistory(workflow));
        setHistoryBaselineDirty(false);
        setDirty(false);
        clearWorkflowDraft();
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
      const normalized = normalizeAgentRuntimeWorkflow(result.workflow);
      resetCanvasWorkflow(normalized.workflow);
      setFilePath(result.filePath);
      setHistoryBaselineDirty(normalized.migratedBlockIds.length > 0);
      setDirty(normalized.migratedBlockIds.length > 0);
      clearWorkflowDraft();
      setSnapshots({});
      setRunOutcome(undefined);
      setActiveRunId(undefined);
      setBlockClipboard(undefined);
      setBlockClipboardPresentation(undefined);
      setRunInputValues({});
      setSelectedRunId(undefined);
      setSelectedBlockId(normalized.workflow.blocks[0]?.id ?? '');
      setNotice(
        normalized.migratedBlockIds.length > 0
          ? 'Workflow opened. Updated legacy Cline context delivery; save to keep the repair.'
          : 'Workflow opened.',
      );
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
    setHistoryBaselineDirty(false);
    setDirty(false);
    clearWorkflowDraft();
    setSnapshots({});
    setRunOutcome(undefined);
    setActiveRunId(undefined);
    setBlockClipboard(undefined);
    setBlockClipboardPresentation(undefined);
    setRunInputValues({});
    setSelectedRunId(undefined);
    setSelectedBlockId(next.blocks[0]?.id ?? '');
    setNotice('New workflow created.');
  }

  async function startRun(): Promise<void> {
    if (
      !validation.valid ||
      !runInputBuild.valid ||
      preflight?.ready !== true ||
      !trustConfirmed
    )
      return;
    try {
      setSnapshots({});
      setRunOutcome(undefined);
      setSelectedRunId(undefined);
      const result = await window.vorchestra.runWorkflow({
        runId: plannedRunId,
        workflow,
        runInputs: runInputBuild.inputs,
        ...(filePath === undefined ? {} : { workflowFilePath: filePath }),
      });
      setActiveRunId(result.runId);
      setPlannedRunId(crypto.randomUUID());
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

  async function copyToClipboard(value: string, label: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error('Clipboard access is unavailable.');
      }
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch (error) {
      setNotice(`Could not copy ${label}: ${errorMessage(error)}`);
    }
  }

  async function revealArtifact(path: string): Promise<void> {
    await window.vorchestra.revealFilesystemPath(path);
    setNotice('Revealed filesystem reference in Finder.');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={18} />
          </div>
          <span>VORCHESTRA</span>
          <em>v0.3</em>
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
          <ToolbarButton
            icon={<Undo2 size={15} />}
            label="Undo"
            title="Undo (Cmd/Ctrl-Z)"
            disabled={!canUndo}
            onClick={undo}
          />
          <ToolbarButton
            icon={<Redo2 size={15} />}
            label="Redo"
            title="Redo (Cmd/Ctrl-Shift-Z)"
            disabled={!canRedo}
            onClick={redo}
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
          <button
            className="add-process"
            aria-label="Add process"
            onClick={addBlock}
          >
            <span>
              <TerminalSquare size={17} />
            </span>
            <span>
              <strong>Process</strong>
              <small>Generic local command</small>
            </span>
            <Plus size={15} />
          </button>
          <button
            className="add-process add-agent"
            aria-label="Add AI Agent"
            onClick={addAgentBlock}
          >
            <span>
              <Bot size={17} />
            </span>
            <span>
              <strong>AI Agent</strong>
              <small>Codex Agent runtime</small>
            </span>
            <Plus size={15} />
          </button>
          <button
            className="add-process add-agent"
            aria-label="Add Computer Use"
            onClick={addComputerUseBlock}
          >
            <span>
              <MonitorUp size={17} />
            </span>
            <span>
              <strong>Computer Use</strong>
              <small>Codex + bounded browser MCP</small>
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
          <WorkflowInputsEditor
            workflow={workflow}
            onChange={(next) => changeWorkflow(() => next)}
            selectPath={selectFilesystemPath}
          />
          <RunHistoryPanel
            records={runHistory}
            {...(selectedRunId === undefined ? {} : { selectedRunId })}
            onSelect={(record) => {
              setSnapshots(
                Object.fromEntries(
                  record.blocks.map((block) => [block.blockId, block]),
                ),
              );
              setActiveRunId(record.runId);
              setRunOutcome(record.outcome);
              setSelectedRunId(record.runId);
              setRunInputValues(serializedHistoryInputs(record.runInputs));
              const focusBlock =
                record.blocks.find((block) => block.state === 'failed') ??
                record.blocks[0];
              if (focusBlock !== undefined) {
                setSelectedBlockId(focusBlock.blockId);
                setInspectorTab('run');
              }
              setNotice(`Viewing retained run ${record.runId}.`);
            }}
            onReveal={(path) => void revealArtifact(path)}
            onWorktreeChanged={() => void refreshRunHistory()}
            onClear={() => {
              void window.vorchestra
                .clearRunHistory(workflow.id)
                .then(() => {
                  setRunHistory([]);
                  setSelectedRunId(undefined);
                  setNotice('Run history cleared.');
                })
                .catch((error: unknown) =>
                  setNotice(`Could not clear history: ${errorMessage(error)}`),
                );
            }}
          />
          <div className="rail-footer">
            <ShieldAlert size={14} />
            <span>Commands run with your local user permissions.</span>
          </div>
        </aside>

        <section
          ref={canvasRef}
          className="canvas"
          aria-label="Workflow canvas"
          onPointerMove={onCanvasPointerMove}
        >
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
            onInit={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
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
            <Controls
              className="flow-controls"
              aria-label="Canvas controls"
              showInteractive={false}
            >
              <ControlButton
                aria-label="Auto arrange"
                title="Arrange workflow by dependency layer"
                disabled={workflow.blocks.length === 0}
                onClick={autoArrange}
              >
                <Network size={14} />
              </ControlButton>
            </Controls>
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
                  <small>
                    {selectedPresentation === undefined
                      ? 'PROCESS BLOCK'
                      : 'AI AGENT BLOCK'}
                  </small>
                  <strong>{selectedBlock.name}</strong>
                </div>
                <button
                  className="icon-button destructive"
                  title="Delete block"
                  aria-label="Delete block"
                  onClick={() => {
                    changeWorkflow((current) =>
                      removeEditorBlock(current, selectedBlock.id),
                    );
                    setSelectedBlockId('');
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="tab-list" role="tablist">
                <button
                  id="inspector-configure-tab"
                  role="tab"
                  aria-selected={inspectorTab === 'configure'}
                  aria-controls="inspector-configure-panel"
                  tabIndex={inspectorTab === 'configure' ? 0 : -1}
                  className={inspectorTab === 'configure' ? 'active' : ''}
                  onClick={() => setInspectorTab('configure')}
                  onKeyDown={(event) =>
                    handleInspectorTabKeyDown(
                      event,
                      'configure',
                      setInspectorTab,
                    )
                  }
                >
                  Configure
                </button>
                <button
                  id="inspector-run-tab"
                  role="tab"
                  aria-selected={inspectorTab === 'run'}
                  aria-controls="inspector-run-panel"
                  tabIndex={inspectorTab === 'run' ? 0 : -1}
                  className={inspectorTab === 'run' ? 'active' : ''}
                  onClick={() => setInspectorTab('run')}
                  onKeyDown={(event) =>
                    handleInspectorTabKeyDown(event, 'run', setInspectorTab)
                  }
                >
                  Run details
                  {snapshots[selectedBlock.id] && (
                    <span
                      className={`tiny-dot ${snapshots[selectedBlock.id]?.state}`}
                    />
                  )}
                </button>
              </div>
              <div
                id={
                  inspectorTab === 'configure'
                    ? 'inspector-configure-panel'
                    : 'inspector-run-panel'
                }
                className="inspector-tab-panel"
                role="tabpanel"
                aria-labelledby={
                  inspectorTab === 'configure'
                    ? 'inspector-configure-tab'
                    : 'inspector-run-tab'
                }
              >
                {inspectorTab === 'configure' ? (
                  selectedComputerUsePresentation !== undefined ? (
                    <ComputerUseBlockInspector
                      block={selectedBlock}
                      presentation={selectedComputerUsePresentation}
                      selectPath={selectFilesystemPath}
                      onChange={(block, presentation) =>
                        changeWorkflow((current) =>
                          setComputerUseBlockPresentation(
                            replaceBlock(current, block),
                            block.id,
                            presentation.config,
                          ),
                        )
                      }
                    />
                  ) : selectedPresentation === undefined ? (
                    selectedMetadataIssue?.code === 'runtime-unsupported' ? (
                      <UnsupportedAgentRuntimeInspector
                        issue={selectedMetadataIssue}
                        onChoose={(agentRuntime) =>
                          changeWorkflow((current) =>
                            setAgentBlockPresentation(
                              replaceBlock(
                                current,
                                compileAgentBlock(
                                  agentEditorConfigFromBlock(selectedBlock, {
                                    kind: 'ai-agent',
                                    agentRuntime,
                                    isolation: {
                                      mode: 'current-directory',
                                    },
                                  }),
                                ),
                              ),
                              selectedBlock.id,
                              agentRuntime,
                              { mode: 'current-directory' },
                            ),
                          )
                        }
                        onTreatAsProcess={() =>
                          changeWorkflow((current) =>
                            removeBlockPresentation(current, selectedBlock.id),
                          )
                        }
                      />
                    ) : (
                      <>
                        {selectedComputerUseMetadataIssue !== undefined && (
                          <div className="inline-notice error">
                            {selectedComputerUseMetadataIssue.message}
                          </div>
                        )}
                        <BlockInspector
                          block={selectedBlock}
                          workflow={workflow}
                          {...(preflight?.blocks.find(
                            (block) => block.blockId === selectedBlock.id,
                          ) === undefined
                            ? {}
                            : {
                                resolved: preflight.blocks.find(
                                  (block) => block.blockId === selectedBlock.id,
                                )!,
                              })}
                          selectPath={selectFilesystemPath}
                          onChange={(block) =>
                            changeWorkflow((current) =>
                              replaceBlock(current, block),
                            )
                          }
                          onWorkflowChange={(next) =>
                            changeWorkflow(() => next)
                          }
                        />
                      </>
                    )
                  ) : (
                    <AgentBlockInspector
                      block={selectedBlock}
                      presentation={selectedPresentation}
                      selectPath={selectFilesystemPath}
                      {...(userModelCatalog === undefined
                        ? {}
                        : {
                            modelCatalog: userModelCatalog.catalog,
                            modelCatalogPath: userModelCatalog.filePath,
                          })}
                      onChange={(block, presentation) =>
                        changeWorkflow((current) =>
                          setAgentBlockPresentation(
                            replaceBlock(current, block),
                            block.id,
                            presentation.agentRuntime,
                            presentation.isolation,
                          ),
                        )
                      }
                    />
                  )
                ) : (
                  <RunInspector
                    {...(snapshots[selectedBlock.id] === undefined
                      ? {}
                      : { snapshot: snapshots[selectedBlock.id] })}
                    {...(selectedPresentation?.agentRuntime === undefined
                      ? {}
                      : { agentRuntime: selectedPresentation.agentRuntime })}
                    onCopy={(value, label) =>
                      void copyToClipboard(value, label)
                    }
                    onReveal={(path) => void revealArtifact(path)}
                    onNavigateFailure={(failure) => {
                      const field = runtimeFailureInspectorField(
                        failure.code,
                        selectedPresentation !== undefined,
                      );
                      navigateToInspectorField(selectedBlock.id, field);
                      setNotice(`Review ${field} for ${failure.code}.`);
                    }}
                  />
                )}
              </div>
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
        {notice && (
          <span className="notice" role="status" aria-live="polite">
            {notice}
          </span>
        )}
        <span className="status-spacer" />
        <span>Schema v{workflow.schemaVersion}</span>
        <span>Local execution</span>
      </footer>

      {runPreviewOpen && (
        <RunPreview
          workflow={workflow}
          valid={
            validation.valid && runInputBuild.valid && preflight?.ready === true
          }
          inputValues={runInputValues}
          inputErrors={runInputBuild.errors}
          onInputChange={(inputId, value) =>
            setRunInputValues((current) => ({
              ...current,
              [inputId]: value,
            }))
          }
          selectPath={selectFilesystemPath}
          {...(preflight === undefined ? {} : { preflight })}
          preflightLoading={preflightLoading}
          onSelectIssue={(blockId, field) => {
            if (blockId === undefined && field.startsWith('runInputs.')) {
              const inputId = field.slice('runInputs.'.length);
              requestAnimationFrame(() => {
                const field = [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-run-input-id]',
                  ),
                ].find((candidate) => candidate.dataset.runInputId === inputId);
                field?.focus();
              });
              setNotice(`Provide run input ${inputId}.`);
              return;
            }
            if (blockId !== undefined) {
              const agent = getAgentBlockPresentation(workflow, blockId);
              navigateToInspectorField(
                blockId,
                agent !== undefined && field === 'invocation.executable'
                  ? 'editor.agentRuntime'
                  : field,
              );
            }
            setRunPreviewOpen(false);
            setTrustConfirmed(false);
            setNotice(`Review ${field}.`);
          }}
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
    const blockMatch = /blocks\[(\d+)\](?:\.(.*))?/.exec(path);
    const index =
      blockMatch?.[1] === undefined ? undefined : Number(blockMatch[1]);
    const block = index === undefined ? undefined : workflow.blocks[index];
    if (block !== undefined) {
      navigateToInspectorField(block.id, blockMatch?.[2] ?? 'block');
      return;
    }
    const connectionMatch = /connections\[(\d+)\]/.exec(path);
    const connectionIndex =
      connectionMatch?.[1] === undefined
        ? undefined
        : Number(connectionMatch[1]);
    const connection =
      connectionIndex === undefined
        ? undefined
        : workflow.connections[connectionIndex];
    if (connection !== undefined) {
      navigateToInspectorField(connection.to.blockId, 'inputs');
    }
  }

  function navigateToInspectorField(blockId: string, field: string): void {
    setSelectedBlockId(blockId);
    setInspectorTab('configure');
    setInspectorFocusRequest({ blockId, field, nonce: Date.now() });
  }
}

function inspectorFieldMatches(
  candidate: string | undefined,
  requested: string,
): boolean {
  if (candidate === undefined) return false;
  const normalizedRequested = requested.replace(/^blocks\[\d+]\./, '');
  if (candidate === normalizedRequested) return true;
  if (
    candidate.startsWith(`${normalizedRequested}.`) ||
    normalizedRequested.startsWith(`${candidate}.`)
  ) {
    return true;
  }
  if (/^invocation\.arguments(?:\[\d+])?/.test(normalizedRequested)) {
    return candidate.startsWith('invocation.arguments');
  }
  if (/^invocation\.outputs(?:\[\d+])?/.test(normalizedRequested)) {
    return candidate.startsWith('invocation.outputs');
  }
  return false;
}

function handleInspectorTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: InspectorTab,
  onChange: (tab: InspectorTab) => void,
): void {
  let next: InspectorTab | undefined;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    next = current === 'configure' ? 'run' : 'configure';
  } else if (event.key === 'Home') {
    next = 'configure';
  } else if (event.key === 'End') {
    next = 'run';
  }
  if (next === undefined) return;
  event.preventDefault();
  onChange(next);
  const tabId =
    next === 'configure' ? 'inspector-configure-tab' : 'inspector-run-tab';
  requestAnimationFrame(() => document.getElementById(tabId)?.focus());
}

function UnsupportedAgentRuntimeInspector({
  issue,
  onChoose,
  onTreatAsProcess,
}: {
  issue: AgentBlockMetadataIssue;
  onChoose: (runtime: AgentRuntimeId) => void;
  onTreatAsProcess: () => void;
}) {
  const [runtime, setRuntime] = useState<AgentRuntimeId>('codex');
  return (
    <div className="inspector-scroll">
      <section className="inspector-section">
        <header>
          <span>Unsupported Agent runtime</span>
        </header>
        <div className="agent-authority-warning">
          <AlertTriangle size={14} />
          <span>{issue.message}</span>
        </div>
        <label className="field">
          <span>Replacement runtime</span>
          <select
            data-inspector-field="editor.agentRuntime"
            aria-label="Replacement Agent runtime"
            value={runtime}
            onChange={(event) =>
              setRuntime(event.target.value as AgentRuntimeId)
            }
          >
            {AGENT_RUNTIME_REGISTRY.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          <small>
            The saved metadata is preserved until you explicitly choose how to
            recover this block.
          </small>
        </label>
        <div className="unsupported-agent-actions">
          <button className="button primary" onClick={() => onChoose(runtime)}>
            Use selected runtime
          </button>
          <button className="button" onClick={onTreatAsProcess}>
            Treat as generic process
          </button>
        </div>
      </section>
    </div>
  );
}

function BlockInspector({
  block,
  workflow,
  resolved,
  selectPath,
  onChange,
  onWorkflowChange,
}: {
  block: ProcessBlock;
  workflow: WorkflowDefinition;
  resolved?: BlockPreflightPreview;
  selectPath: (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ) => Promise<string | undefined>;
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
            data-inspector-field="identity.name"
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
            data-inspector-field="invocation.executable"
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
          <div className="path-field">
            <input
              data-inspector-field="invocation.workingDirectory"
              className="mono"
              value={block.invocation.workingDirectory ?? ''}
              placeholder="Workflow file directory"
              onChange={(event) =>
                patchInvocation(
                  event.target.value.trim() === ''
                    ? { workingDirectory: undefined }
                    : { workingDirectory: event.target.value },
                )
              }
              spellCheck={false}
            />
            <button
              className="icon-button"
              aria-label="Choose working directory"
              onClick={() =>
                void selectPath(
                  'directory',
                  block.invocation.workingDirectory,
                ).then((path) => {
                  if (path !== undefined) {
                    patchInvocation({ workingDirectory: path });
                  }
                })
              }
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </Field>
        <label className="toggle-row shell-toggle">
          <span>
            <strong>Evaluate through shell</strong>
            <small>Enables expansion, pipes, and redirects</small>
          </span>
          <input
            data-inspector-field="invocation.shell"
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
                  data-inspector-field={`invocation.arguments[${index}]`}
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
                  aria-label={`Remove argument ${index + 1}`}
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
            ) : argument.type === 'input' ? (
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
            ) : (
              <div
                className={reorderRowClass(
                  'argument-row input-binding',
                  'arguments',
                  index,
                )}
                key={`template:${index}`}
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
                  label={`template argument ${index + 1}`}
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
                <code>template:{argument.template}</code>
                <small>
                  {Object.keys(argument.inputs).length} template bindings
                </small>
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
              data-inspector-field={`inputs[${index}].name`}
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
              data-inspector-field={`inputs[${index}].artifactKind`}
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
              data-inspector-field={`inputs[${index}].delivery`}
              aria-label="Input delivery"
              value={inputDelivery(block, port.id)}
              onChange={(event) => {
                const without = block.invocation.arguments.filter(
                  (argument) => !argumentUsesInputPort(argument, port.id),
                );
                patchInvocation({
                  arguments:
                    event.target.value === 'argument'
                      ? [...without, { type: 'input', portId: port.id }]
                      : without,
                  stdin:
                    event.target.value === 'stdin'
                      ? { portId: port.id }
                      : stdinUsesInputPort(block.invocation.stdin, port.id)
                        ? undefined
                        : block.invocation.stdin,
                });
              }}
            >
              <option value="argument">Argument</option>
              <option value="stdin">stdin</option>
              {inputDelivery(block, port.id) === 'template' && (
                <option value="template">Template</option>
              )}
            </select>
            <button
              className="icon-button"
              aria-label={`Remove input port ${port.name}`}
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
                data-inspector-field={`outputs[${index}].name`}
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
                data-inspector-field={`outputs[${index}].artifactKind`}
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
                aria-label={`Remove output port ${port.name}`}
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
                  <>
                    <select
                      data-inspector-field={`invocation.outputs[${block.invocation.outputs.findIndex((candidate) => candidate.portId === port.id)}].entity`}
                      aria-label="Output entity"
                      value={binding.entity ?? 'unknown'}
                      onChange={(event) =>
                        patchInvocation({
                          outputs: block.invocation.outputs.map((candidate) =>
                            candidate.portId === port.id &&
                            candidate.type === 'filesystem'
                              ? {
                                  ...candidate,
                                  entity: event.target.value as
                                    'file' | 'directory' | 'unknown',
                                }
                              : candidate,
                          ),
                        })
                      }
                    >
                      <option value="file">File</option>
                      <option value="directory">Directory</option>
                      <option value="unknown">File or directory</option>
                    </select>
                    <div className="path-field">
                      <input
                        data-inspector-field={`invocation.outputs[${block.invocation.outputs.findIndex((candidate) => candidate.portId === port.id)}].path`}
                        className="mono"
                        aria-label="Output path"
                        value={binding.path}
                        onChange={(event) =>
                          patchInvocation({
                            outputs: block.invocation.outputs.map(
                              (candidate) =>
                                candidate.portId === port.id &&
                                candidate.type === 'filesystem'
                                  ? { ...candidate, path: event.target.value }
                                  : candidate,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={`Choose output path for ${port.name}`}
                        onClick={() =>
                          void selectPath(
                            binding.entity === 'directory'
                              ? 'directory'
                              : 'output-file',
                            binding.path,
                          ).then((path) => {
                            if (path !== undefined) {
                              patchInvocation({
                                outputs: block.invocation.outputs.map(
                                  (candidate) =>
                                    candidate.portId === port.id &&
                                    candidate.type === 'filesystem'
                                      ? { ...candidate, path }
                                      : candidate,
                                ),
                              });
                            }
                          })
                        }
                      >
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  </>
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
      <InspectorSection title="Invocation preview">
        <InvocationPreview
          block={block}
          {...(resolved === undefined ? {} : { resolved })}
        />
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
        data-inspector-field={`invocation.environment.${name}`}
        className="mono"
        value={name}
        aria-label="Environment variable"
        onChange={(event) => onChange(event.target.value, value)}
      />
      <select
        aria-label={`Environment source for ${name}`}
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
      <button
        className="icon-button"
        aria-label={`Remove environment variable ${name}`}
        onClick={onRemove}
      >
        <Trash2 size={13} />
      </button>
    </>
  );
}

function RunInspector({
  snapshot,
  agentRuntime,
  onCopy,
  onReveal,
  onNavigateFailure,
}: {
  snapshot?: BlockRunSnapshot;
  agentRuntime?: AgentRuntimeId;
  onCopy: (value: string, label: string) => void;
  onReveal: (path: string) => void;
  onNavigateFailure: (failure: ExecutionFailure) => void;
}) {
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
          <button
            className="icon-button"
            aria-label="Copy failure details"
            onClick={() =>
              onCopy(
                [
                  snapshot.failure!.code,
                  snapshot.failure!.message,
                  snapshot.failure!.nextAction ?? '',
                ]
                  .filter(Boolean)
                  .join('\n'),
                'Failure details',
              )
            }
          >
            <Copy size={13} />
          </button>
          <button
            className="icon-button"
            aria-label="Review responsible setting"
            title="Open the most relevant configuration field"
            onClick={() => onNavigateFailure(snapshot.failure!)}
          >
            <ChevronRight size={13} />
          </button>
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
          <ArtifactView
            key={portId}
            label={portId}
            artifact={artifact}
            onCopy={onCopy}
            onReveal={onReveal}
          />
        ))}
        {Object.keys(snapshot.inputs).length === 0 && (
          <EmptyLine text="No inputs" />
        )}
      </DataSection>
      <DataSection title="Produced artifacts" count={snapshot.artifacts.length}>
        {snapshot.artifacts.map((artifact) => (
          <ArtifactView
            key={artifact.id}
            label={
              'portId' in artifact.provenance
                ? artifact.provenance.portId
                : artifact.provenance.inputId
            }
            artifact={artifact}
            onCopy={onCopy}
            onReveal={onReveal}
          />
        ))}
        {snapshot.artifacts.length === 0 && <EmptyLine text="No artifacts" />}
      </DataSection>
      <DataSection
        title="stdout"
        action={
          <button
            className="icon-button"
            aria-label="Copy stdout"
            onClick={() => onCopy(snapshot.stdout, 'stdout')}
          >
            <Copy size={13} />
          </button>
        }
      >
        <pre>{snapshot.stdout || 'No stdout captured.'}</pre>
      </DataSection>
      {agentRuntime === 'codex' && snapshot.stderr && (
        <p className="stream-note">
          Codex writes progress and session metadata to stderr. It is shown as
          session output here; the block state and failure details identify
          actual run failures.
        </p>
      )}
      <DataSection
        title={agentRuntime === 'codex' ? 'Session output (stderr)' : 'stderr'}
        action={
          <button
            className="icon-button"
            aria-label={
              agentRuntime === 'codex' ? 'Copy session output' : 'Copy stderr'
            }
            onClick={() =>
              onCopy(
                snapshot.stderr,
                agentRuntime === 'codex' ? 'Session output' : 'stderr',
              )
            }
          >
            <Copy size={13} />
          </button>
        }
      >
        <pre
          className={
            snapshot.stderr && agentRuntime !== 'codex' ? 'error-output' : ''
          }
        >
          {snapshot.stderr ||
            (agentRuntime === 'codex'
              ? 'No session output captured.'
              : 'No stderr captured.')}
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
  inputValues,
  inputErrors,
  onInputChange,
  selectPath,
  preflight,
  preflightLoading,
  onSelectIssue,
  trustConfirmed,
  onTrustChange,
  onClose,
  onRun,
}: {
  workflow: WorkflowDefinition;
  valid: boolean;
  inputValues: Readonly<Record<string, string>>;
  inputErrors: Readonly<Record<string, string>>;
  onInputChange: (inputId: string, value: string) => void;
  selectPath: (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ) => Promise<string | undefined>;
  preflight?: WorkflowPreflightResult;
  preflightLoading: boolean;
  onSelectIssue: (blockId: string | undefined, field: string) => void;
  trustConfirmed: boolean;
  onTrustChange: (checked: boolean) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
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
          <button
            ref={closeButtonRef}
            className="icon-button"
            aria-label="Close run review"
            onClick={onClose}
          >
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
        <RunInputFields
          workflow={workflow}
          values={inputValues}
          errors={inputErrors}
          onChange={onInputChange}
          selectPath={selectPath}
        />
        <PreflightPanel
          {...(preflight === undefined ? {} : { result: preflight })}
          loading={preflightLoading}
          onSelectIssue={onSelectIssue}
        />
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
                <RunInvocationPreview
                  workflow={workflow}
                  block={block}
                  {...(preflight?.blocks.find(
                    (preview) => preview.blockId === block.id,
                  ) === undefined
                    ? {}
                    : {
                        resolved: preflight.blocks.find(
                          (preview) => preview.blockId === block.id,
                        )!,
                      })}
                />
                <AgentIsolationPreview workflow={workflow} blockId={block.id} />
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

function RunInvocationPreview({
  workflow,
  block,
  resolved,
}: {
  workflow: WorkflowDefinition;
  block: ProcessBlock;
  resolved?: BlockPreflightPreview;
}) {
  const workingDirectory =
    resolved?.workingDirectory ?? block.invocation.workingDirectory;
  const effectiveBlock =
    workingDirectory === undefined
      ? block
      : withResolvedAgentWorkingDirectory(
          block,
          getAgentBlockPresentation(workflow, block.id),
          workingDirectory,
        );
  return (
    <InvocationPreview
      block={effectiveBlock}
      {...(resolved === undefined ? {} : { resolved })}
    />
  );
}

function AgentIsolationPreview({
  workflow,
  blockId,
}: {
  workflow: WorkflowDefinition;
  blockId: string;
}) {
  const presentation = getAgentBlockPresentation(workflow, blockId);
  const isolation = presentation?.isolation;
  if (isolation?.mode !== 'workflow-run-worktree') return null;
  return (
    <div className="isolation-preview">
      <GitBranch size={12} />
      <span>
        <strong>Workflow-run worktree · {isolation.scope}</strong>
        <small>
          {isolation.repositoryRoot} @ {isolation.baseRef}
        </small>
        <small>
          A run-scoped branch and worktree will be created before this process
          starts. Vorchestra will not commit, merge, push, or discard changes.
        </small>
      </span>
    </div>
  );
}

function inputDelivery(
  block: ProcessBlock,
  portId: string,
): 'argument' | 'stdin' | 'template' {
  if (stdinUsesInputPort(block.invocation.stdin, portId)) return 'stdin';
  if (
    block.invocation.arguments.some(
      (argument) =>
        argument.type === 'template' && argumentUsesInputPort(argument, portId),
    )
  ) {
    return 'template';
  }
  return 'argument';
}

function argumentUsesInputPort(
  argument: ProcessArgument,
  portId: string,
): boolean {
  if (argument.type === 'input') return argument.portId === portId;
  if (argument.type !== 'template') return false;
  return Object.values(argument.inputs).some(
    (binding) => 'portId' in binding && binding.portId === portId,
  );
}

function stdinUsesInputPort(
  stdin: ProcessStdin | undefined,
  portId: string,
): boolean {
  if (stdin === undefined) return false;
  if ('portId' in stdin) return stdin.portId === portId;
  return Object.values(stdin.inputs).some(
    (binding) => 'portId' in binding && binding.portId === portId,
  );
}

function ArtifactView({
  label,
  artifact,
  onCopy,
  onReveal,
}: {
  label: string;
  artifact: Artifact;
  onCopy?: (value: string, label: string) => void;
  onReveal?: (path: string) => void;
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
        <small className="artifact-provenance">
          {artifactProvenanceLabel(artifact)}
        </small>
        <span>{artifact.kind}</span>
        {onCopy !== undefined && (
          <button
            className="icon-button"
            aria-label={`Copy ${label}`}
            onClick={() => onCopy(value, label)}
          >
            <Copy size={12} />
          </button>
        )}
        {artifact.kind === 'filesystem-reference' && onReveal !== undefined && (
          <button
            className="icon-button"
            aria-label={`Reveal ${label} in Finder`}
            onClick={() => onReveal(artifact.path)}
          >
            <FolderOpen size={12} />
          </button>
        )}
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function artifactProvenanceLabel(artifact: Artifact): string {
  if ('source' in artifact.provenance) {
    return `workflow input · ${artifact.provenance.valueSource}`;
  }
  return `block output · ${artifact.provenance.blockId}`;
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
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="data-section">
      <header>
        <span>{title}</span>
        {count !== undefined && <em>{count}</em>}
        {action}
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
  disabled = false,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className="toolbar-button"
      aria-label={label}
      data-tooltip={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
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

function removeEditorBlock(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  return removeBlockPresentation(removeBlock(workflow, blockId), blockId);
}

function serializedHistoryInputs(
  inputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  try {
    const parsed: WorkflowRunInputs = parseWorkflowRunInputs(inputs);
    return Object.fromEntries(
      Object.entries(parsed).map(([inputId, value]) => [
        inputId,
        serializeRunInputValue(value),
      ]),
    );
  } catch {
    return {};
  }
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

export function runtimeFailureInspectorField(
  code: ExecutionFailure['code'],
  agentBlock: boolean,
): string {
  switch (code) {
    case 'executable_not_found':
    case 'process_launch_failed':
      return 'invocation.executable';
    case 'working_directory_not_found':
      return 'invocation.workingDirectory';
    case 'host_environment_variable_missing':
      return 'invocation.environment';
    case 'filesystem_reference_inaccessible':
    case 'invalid_json_output':
    case 'artifact_routing_failed':
      return 'invocation.outputs';
    case 'process_authentication_failed':
      return agentBlock ? 'editor.agentRuntime' : 'invocation.executable';
    case 'process_exit_nonzero':
    case 'process_timeout':
    case 'process_terminated_by_signal':
    case 'process_termination_failed':
      return 'invocation.arguments';
  }
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

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}
