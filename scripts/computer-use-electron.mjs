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
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
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
await waitFor('document.querySelector(".app-shell") !== null', 'editor');
assert.equal(
  await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Add Computer Use"]');
    if (button === null) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  'document.querySelector(".computer-use-inspector") !== null',
  'Computer Use inspector',
);

const evidence = await evaluate(`(() => {
  const inspector = document.querySelector('.computer-use-inspector');
  const node = [...document.querySelectorAll('.process-node')]
    .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('Computer Use'));
  return {
    inspector: inspector?.innerText ?? '',
    invocation: inspector?.querySelector('.invocation-preview')?.innerText ?? inspector?.innerText ?? '',
    node: node?.getAttribute('aria-label') ?? '',
    startUrl: inspector?.querySelector('[data-inspector-field="editor.computerUse.startUrl"] input')?.value ?? '',
  };
})()`);
assert.match(evidence.inspector, /Bounded browser session/);
assert.match(evidence.inspector, /Allowed origins/);
assert.match(evidence.inspector, /Allowed MCP tools/);
assert.match(evidence.inspector, /Visible instruction/i);
assert.match(evidence.invocation, /codex/);
assert.match(evidence.invocation, /mcp_servers\.browser\.required=true/);
assert.match(evidence.invocation, /features\.shell_tool=false/);
assert.match(evidence.node, /^Computer Use/);
assert.equal(evidence.startUrl, 'https://www.tradingview.com/chart/');

socket.close();
console.log(
  'Computer Use editor acceptance passed: bounded Codex/MCP invocation is visible without launching a browser or network call.',
);
