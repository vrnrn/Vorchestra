import type {
  Artifact,
  BlockExecutionState,
  ExecutionFailure,
  WorkflowDefinition,
} from '@vorchestra/engine';

export interface WorkflowFileResult {
  readonly canceled: boolean;
  readonly filePath?: string;
  readonly workflow?: WorkflowDefinition;
}

export interface SaveWorkflowRequest {
  readonly workflow: WorkflowDefinition;
  readonly filePath?: string;
  readonly saveAs?: boolean;
}

export interface SaveWorkflowResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface BlockRunSnapshot {
  readonly blockId: string;
  readonly state: BlockExecutionState;
  readonly inputs: Readonly<Record<string, Artifact>>;
  readonly artifacts: readonly Artifact[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly failure?: ExecutionFailure;
  readonly skipReason?: string;
}

export type DesktopRunEvent =
  | {
      readonly type: 'run_started';
      readonly runId: string;
      readonly blocks: readonly BlockRunSnapshot[];
    }
  | {
      readonly type: 'block_updated';
      readonly runId: string;
      readonly block: BlockRunSnapshot;
    }
  | {
      readonly type: 'run_completed';
      readonly runId: string;
      readonly outcome: 'succeeded' | 'failed' | 'cancelled';
      readonly endedAt: string;
      readonly error?: {
        readonly code: 'execution_coordinator_failed';
        readonly message: string;
        readonly nextAction: string;
      };
    };

export interface RunWorkflowResult {
  readonly runId: string;
}

export interface VorchestraBridge {
  openWorkflow(): Promise<WorkflowFileResult>;
  saveWorkflow(request: SaveWorkflowRequest): Promise<SaveWorkflowResult>;
  runWorkflow(workflow: WorkflowDefinition): Promise<RunWorkflowResult>;
  cancelRun(runId: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}

export const IPC_CHANNELS = {
  openWorkflow: 'workflow:open',
  saveWorkflow: 'workflow:save',
  runWorkflow: 'run:start',
  cancelRun: 'run:cancel',
  runEvent: 'run:event',
} as const;
