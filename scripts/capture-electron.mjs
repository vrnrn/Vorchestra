#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const port = process.argv[2] ?? '9222';
const outputPath = process.argv[3] ?? 'docs/acceptance/V0_1_DESKTOP.png';
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
  response.json(),
);
const page = targets.find((target) => target.type === 'page');

if (page?.webSocketDebuggerUrl === undefined) {
  throw new Error(`No Electron page target found on CDP port ${port}.`);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const diagnostics = [];

socket.addEventListener('message', (message) => {
  const response = JSON.parse(String(message.data));
  if (response.id === undefined) {
    if (
      response.method === 'Runtime.exceptionThrown' ||
      response.method === 'Log.entryAdded'
    ) {
      diagnostics.push(response.params);
    }
    return;
  }
  const handler = pending.get(response.id);
  if (handler === undefined) return;
  pending.delete(response.id);
  if (response.error === undefined) handler.resolve(response.result);
  else handler.reject(new Error(response.error.message));
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

await command('Page.enable');
await command('Runtime.enable');
await command('Log.enable');
await command('Page.bringToFront');

let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  const probe = await command('Runtime.evaluate', {
    expression: 'document.querySelector(".app-shell") !== null',
    returnByValue: true,
  });
  if (probe.result.value === true) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

if (!ready) {
  const diagnostic = await command('Runtime.evaluate', {
    expression:
      '({ title: document.title, text: document.body.innerText, html: document.body.innerHTML })',
    returnByValue: true,
  });
  throw new Error(
    `Electron renderer did not mount: ${JSON.stringify({ page: diagnostic.result.value, diagnostics })}`,
  );
}

const result = await command('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
});
await writeFile(outputPath, Buffer.from(result.data, 'base64'));
socket.close();
console.log(`Captured ${page.title} to ${outputPath}`);
