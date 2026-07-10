import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { parseRunnableWorkflow } from '../shared/authority.js';
import {
  IPC_CHANNELS,
  type SaveWorkflowRequest,
  type SaveWorkflowResult,
  type WorkflowFileResult,
} from '../shared/contracts.js';
import { startWorkflowRun } from './runtime.js';
import { ActiveRunRegistry } from './run-registry.js';
import { readWorkflowFile, writeWorkflowFile } from './workflow-files.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const activeRuns = new ActiveRunRegistry();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#090b0f',
    show: false,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeRuns.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.openWorkflow,
    async (): Promise<WorkflowFileResult> => {
      const selection = await dialog.showOpenDialog({
        title: 'Open workflow',
        properties: ['openFile'],
        filters: [
          { name: 'Vorchestra workflow', extensions: ['json', 'vorchestra'] },
        ],
      });
      const filePath = selection.filePaths[0];
      if (selection.canceled || filePath === undefined)
        return { canceled: true };
      const workflow = await readWorkflowFile(filePath);
      return { canceled: false, filePath, workflow };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.saveWorkflow,
    async (
      _event,
      request: SaveWorkflowRequest,
    ): Promise<SaveWorkflowResult> => {
      const workflow = request.workflow;
      let filePath = request.saveAs ? undefined : request.filePath;
      if (filePath === undefined) {
        const selection = await dialog.showSaveDialog({
          title: 'Save workflow',
          defaultPath: `${safeFileName(workflow.name)}.vorchestra.json`,
          filters: [
            {
              name: 'Vorchestra workflow',
              extensions: ['json'],
            },
          ],
        });
        if (selection.canceled || selection.filePath === undefined) {
          return { canceled: true };
        }
        filePath = selection.filePath;
      }

      await writeWorkflowFile(filePath, workflow);
      return { canceled: false, filePath };
    },
  );

  ipcMain.handle(IPC_CHANNELS.runWorkflow, (event, input: unknown) => {
    const workflow = parseRunnableWorkflow(input);
    const run = startWorkflowRun(workflow, (runEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.runEvent, runEvent);
      }
    });
    activeRuns.track(run);
    return { runId: run.runId };
  });

  ipcMain.handle(IPC_CHANNELS.cancelRun, (_event, runId: string) => {
    activeRuns.cancel(runId);
  });
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return safe || 'workflow';
}
