#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import electron from 'electron';

const port = await availablePort();
const mainPath = resolve('apps/desktop/out/main/index.js');
const child = spawn(electron, [`--remote-debugging-port=${port}`, mainPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
child.stdout?.on('data', (chunk) => {
  diagnostics += String(chunk);
});
child.stderr?.on('data', (chunk) => {
  diagnostics += String(chunk);
});

try {
  await waitForElectron(port, child);
  await runNode(
    'scripts/capture-electron.mjs',
    String(port),
    'docs/acceptance/V0_1_EDITOR.png',
  );
  await runNode('scripts/smoke-electron.mjs', String(port));
  await runNode(
    'scripts/capture-electron.mjs',
    String(port),
    'docs/acceptance/V0_1_DESKTOP.png',
  );
} catch (error) {
  if (diagnostics.length > 0) process.stderr.write(diagnostics);
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGKILL');
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForElectron(port, electronProcess) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (electronProcess.exitCode !== null) {
      throw new Error(
        `Electron exited before acceptance (code ${electronProcess.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) return;
    } catch {
      // The debugging endpoint is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Timed out waiting for the Electron debugging endpoint.');
}

async function runNode(script, ...arguments_) {
  await new Promise((resolveRun, rejectRun) => {
    const command = spawn(process.execPath, [script, ...arguments_], {
      stdio: 'inherit',
    });
    command.once('error', rejectRun);
    command.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${script} failed (${signal === null ? `code ${code}` : `signal ${signal}`}).`,
          ),
        );
    });
  });
}
