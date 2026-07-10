import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { parseRunnableWorkflow } from '../shared/authority.js';
import {
  parseWorkflowDefinition,
  parseWorkflowRunInputs,
  preflightWorkflow,
  type WorkflowPreflightResult,
} from '@vorchestra/engine';
import { NodeWorkflowPreflight } from '@vorchestra/node-runner';
import {
  IPC_CHANNELS,
  type PreflightWorkflowRequest,
  type SaveWorkflowRequest,
  type SaveWorkflowResult,
  type SelectFilesystemPathRequest,
  type SelectFilesystemPathResult,
  type RunHistoryRecord,
  type RunWorkflowRequest,
  type WorkflowFileResult,
} from '../shared/contracts.js';
import { revealFilesystemPath, selectFilesystemPath } from './path-actions.js';
import {
  applyDefaultWorkingDirectory,
  resolveDesktopWorkflowBaseDirectory,
  startWorkflowRun,
} from './runtime.js';
import { ActiveRunRegistry } from './run-registry.js';
import { RunHistoryStore } from './run-history.js';
import { readWorkflowFile, writeWorkflowFile } from './workflow-files.js';
import { applyApplicationIdentity } from './application-identity.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const activeRuns = new ActiveRunRegistry();
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');
if (userDataOverride !== '') app.setPath('userData', resolve(userDataOverride));
applyApplicationIdentity(app);

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
  const runHistory = new RunHistoryStore(
    join(app.getPath('userData'), 'run-history.json'),
  );
  registerIpc(runHistory);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeRuns.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(runHistory: RunHistoryStore): void {
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

  ipcMain.handle(
    IPC_CHANNELS.selectFilesystemPath,
    async (
      _event,
      request: SelectFilesystemPathRequest,
    ): Promise<SelectFilesystemPathResult> =>
      selectFilesystemPath(
        {
          showOpenDialog: (options) =>
            dialog.showOpenDialog({
              ...options,
              properties: [...options.properties],
            }),
          showSaveDialog: (options) => dialog.showSaveDialog(options),
        },
        request,
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.revealFilesystemPath,
    (_event, path: string): void => revealFilesystemPath(shell, path),
  );

  ipcMain.handle(
    IPC_CHANNELS.listRunHistory,
    (_event, workflowId: string): Promise<readonly RunHistoryRecord[]> =>
      runHistory.list(workflowId),
  );

  ipcMain.handle(
    IPC_CHANNELS.clearRunHistory,
    (_event, workflowId: string): Promise<void> => runHistory.clear(workflowId),
  );

  ipcMain.handle(
    IPC_CHANNELS.preflightWorkflow,
    async (_event, input: unknown): Promise<WorkflowPreflightResult> => {
      const request = input as Partial<PreflightWorkflowRequest>;
      const baseDirectory = resolveDesktopWorkflowBaseDirectory(
        request.workflowFilePath,
        app.getPath('home'),
      );
      const workflow = applyDefaultWorkingDirectory(
        parseWorkflowDefinition(request.workflow),
        baseDirectory,
      );
      const runInputs = parseWorkflowRunInputs(request.runInputs ?? {});
      return preflightWorkflow(
        workflow,
        new NodeWorkflowPreflight({ baseDirectory }),
        { hostEnvironment: process.env, runInputs },
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.runWorkflow, (event, input: unknown) => {
    const request = input as Partial<RunWorkflowRequest>;
    const baseDirectory = resolveDesktopWorkflowBaseDirectory(
      request.workflowFilePath,
      app.getPath('home'),
    );
    const workflow = applyDefaultWorkingDirectory(
      parseRunnableWorkflow(request.workflow),
      baseDirectory,
    );
    const runInputs = parseWorkflowRunInputs(request.runInputs ?? {});
    const run = startWorkflowRun(
      workflow,
      (runEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.runEvent, runEvent);
        }
      },
      {
        baseDirectory,
        runInputs,
        onCompleted: (record) => runHistory.append(record),
      },
    );
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
