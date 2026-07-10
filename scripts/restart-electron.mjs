#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';

const port = process.argv[2] ?? '9222';
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

socket.addEventListener('message', (message) => {
  const response = JSON.parse(String(message.data));
  if (response.id === undefined) return;
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

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await evaluate(expression)) === true) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

await command('Runtime.enable');
await command('Page.bringToFront');
await waitFor(
  'document.querySelector(".app-shell") !== null',
  'the restarted desktop editor',
);
await waitFor(
  `document.body.innerText.includes('Recovered unsaved draft.')`,
  'recovered unsaved workflow draft',
);
await waitFor(
  `window.vorchestra.listRunHistory().then((records) => records.length > 0)`,
  'retained history records after restart',
);
const recoveredWorkflowId = await evaluate(`(() => {
  const serialized = localStorage.getItem('vorchestra:workflow-draft:v1');
  if (serialized === null) return undefined;
  return JSON.parse(serialized).workflow.id;
})()`);
const retainedRecords = await evaluate(
  `window.vorchestra.listRunHistory().then((records) => records.map((record) => ({
    workflowId: record.workflowId,
    outcome: record.outcome,
    blockCount: record.blocks.length,
  })))`,
);
assert.ok(
  retainedRecords.some(
    (record) =>
      record.workflowId === recoveredWorkflowId &&
      record.outcome === 'succeeded' &&
      record.blockCount >= 1,
  ),
);
await waitFor(
  `document.querySelector('.run-history-list')?.innerText.toLowerCase().includes('succeeded') === true`,
  'retained run history after restart',
);

assert.equal(
  await evaluate(`(() => {
    const button = document.querySelector('.run-history-list button');
    if (button === null) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  `document.querySelector('.run-details')?.innerText.includes('Exit code') === true`,
  'restored per-block run inspection',
);

socket.close();
console.log(
  'Electron restart acceptance passed: recovered draft and retained per-block run history.',
);
