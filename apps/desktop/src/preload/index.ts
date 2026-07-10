import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type DesktopRunEvent,
  type SaveWorkflowRequest,
  type SaveWorkflowResult,
  type VorchestraBridge,
  type WorkflowFileResult,
} from '../shared/contracts.js';

const bridge: VorchestraBridge = {
  openWorkflow: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.openWorkflow,
    ) as Promise<WorkflowFileResult>,
  saveWorkflow: (request: SaveWorkflowRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.saveWorkflow,
      request,
    ) as Promise<SaveWorkflowResult>,
  runWorkflow: (workflow) =>
    ipcRenderer.invoke(IPC_CHANNELS.runWorkflow, workflow) as Promise<{
      runId: string;
    }>,
  cancelRun: (runId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelRun, runId) as Promise<void>,
  onRunEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopRunEvent,
    ) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler);
  },
};

contextBridge.exposeInMainWorld('vorchestra', bridge);
