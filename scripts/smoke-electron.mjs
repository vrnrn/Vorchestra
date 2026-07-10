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
const exceptions = [];

socket.addEventListener('message', (message) => {
  const response = JSON.parse(String(message.data));
  if (response.id === undefined) {
    if (response.method === 'Runtime.exceptionThrown') {
      exceptions.push(response.params.exceptionDetails.text);
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
  'the desktop editor',
);
assert.equal(await evaluate('window.vorchestra !== undefined'), true);
await waitFor(
  `(() => {
    const nodes = document.querySelectorAll('.react-flow__node').length;
    const mapNodes = document.querySelectorAll('.react-flow__minimap-node').length;
    return nodes > 0 && mapNodes === nodes;
  })()`,
  'minimap nodes',
);

const dragStart = await evaluate(`(() => {
  const node = document.querySelector('.react-flow__node');
  const rectangle = node?.getBoundingClientRect();
  return rectangle === undefined
    ? undefined
    : { x: rectangle.left + 100, y: rectangle.top + 22, left: rectangle.left, top: rectangle.top };
})()`);
assert.notEqual(dragStart, undefined);
await command('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: dragStart.x,
  y: dragStart.y,
});
await command('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: dragStart.x,
  y: dragStart.y,
  button: 'left',
  buttons: 1,
  clickCount: 1,
});
for (let step = 1; step <= 12; step += 1) {
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragStart.x + (140 * step) / 12,
    y: dragStart.y + (80 * step) / 12,
    button: 'left',
    buttons: 1,
  });
  assert.equal(
    await evaluate(`
      document.querySelectorAll('.react-flow__node').length === 1 &&
      document.querySelectorAll('.react-flow__minimap-node').length === 1
    `),
    true,
  );
}
await command('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: dragStart.x + 140,
  y: dragStart.y + 80,
  button: 'left',
  buttons: 0,
  clickCount: 1,
});
await waitFor(
  `(() => {
    const rectangle = document.querySelector('.react-flow__node')?.getBoundingClientRect();
    return rectangle !== undefined &&
      rectangle.left > ${dragStart.left + 100} &&
      rectangle.top > ${dragStart.top + 50};
  })()`,
  'persisted node drag',
);
assert.match(
  await evaluate('document.querySelector(".document-title small").innerText'),
  /•/,
);
// React Flow suppresses the click immediately following a drag to prevent
// accidental activation. Let that one-tick guard clear before using the toolbar.
await new Promise((resolve) => setTimeout(resolve, 100));

assert.equal(
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('Review & Run'));
    if (button === undefined) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  `document.querySelector('[aria-label="Review workflow authority"]') !== null`,
  'authority review',
);

const authorityText = await evaluate(
  `document.querySelector('[aria-label="Review workflow authority"]')?.innerText`,
);
assert.match(authorityText, /executable code/i);
assert.match(authorityText, /printf/);
assert.match(authorityText, /PATH ← host:PATH/);

assert.equal(
  await evaluate(`(() => {
    const checkbox = document.querySelector('.consent-row input');
    if (checkbox === null) return false;
    checkbox.click();
    return true;
  })()`),
  true,
);
await waitFor(
  `(() => {
    const button = [...document.querySelectorAll('.run-modal button')]
      .find((candidate) => candidate.textContent?.includes('Run workflow'));
    return button !== undefined && !button.disabled;
  })()`,
  'run consent',
);
assert.equal(
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.run-modal button')]
      .find((candidate) => candidate.textContent?.includes('Run workflow'));
    if (button === undefined) return false;
    button.click();
    return true;
  })()`),
  true,
);

await waitFor(
  'document.querySelector(".statusbar").innerText.includes("Last run: succeeded")',
  'successful workflow completion',
);
assert.equal(
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.tab-list button')]
      .find((candidate) => candidate.textContent?.includes('Run details'));
    if (button === undefined) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor('document.querySelector(".run-details") !== null', 'run details');

const runDetails = await evaluate(
  'document.querySelector(".run-details").innerText',
);
assert.match(runDetails, /succeeded/i);
assert.match(runDetails, /Hello from Vorchestra/);
assert.match(runDetails, /Exit code\s+0/);

const cancelledEvents = await runBridgeWorkflow(
  {
    schemaVersion: 1,
    id: 'desktop-cancel-smoke',
    name: 'Desktop cancel smoke',
    blocks: [
      {
        id: 'wait',
        name: 'Wait',
        kind: 'process',
        inputs: [],
        outputs: [],
        invocation: {
          executable: 'node',
          arguments: [
            { type: 'literal', value: '-e' },
            { type: 'literal', value: 'setInterval(() => {}, 1000)' },
          ],
          environment: { PATH: { source: 'host', name: 'PATH' } },
          shell: false,
          outputs: [],
        },
      },
    ],
    connections: [],
  },
  true,
);
assert.ok(
  cancelledEvents.some(
    (event) => event.type === 'run_completed' && event.outcome === 'cancelled',
  ),
);
assert.ok(
  cancelledEvents.some(
    (event) =>
      event.type === 'block_updated' && event.block.state === 'cancelled',
  ),
);

const missingExecutableEvents = await runBridgeWorkflow({
  schemaVersion: 1,
  id: 'desktop-missing-smoke',
  name: 'Desktop missing executable smoke',
  blocks: [
    {
      id: 'missing',
      name: 'Missing executable',
      kind: 'process',
      inputs: [],
      outputs: [],
      invocation: {
        executable: 'definitely-missing-vorchestra-executable',
        arguments: [],
        environment: { PATH: { source: 'host', name: 'PATH' } },
        shell: false,
        outputs: [],
      },
    },
  ],
  connections: [],
});
assert.ok(
  missingExecutableEvents.some(
    (event) =>
      event.type === 'block_updated' &&
      event.block.failure?.code === 'executable_not_found',
  ),
);
assert.ok(
  missingExecutableEvents.some(
    (event) => event.type === 'run_completed' && event.outcome === 'failed',
  ),
);

assert.equal(
  await evaluate(`(() => {
    const button = document.querySelector('.add-process');
    if (button === null) return false;
    button.click();
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  'document.querySelectorAll(".react-flow__node").length === 3',
  'three visual process blocks',
);
assert.match(
  await evaluate('document.querySelector(".workflow-stat").innerText'),
  /3 blocks/,
);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes('Review & Run'));
  button?.click();
})()`);
await waitFor(
  `document.querySelector('[aria-label="Review workflow authority"]') !== null`,
  'three-block authority review',
);
await evaluate(`document.querySelector('.consent-row input')?.click()`);
await waitFor(
  `(() => {
    const button = [...document.querySelectorAll('.run-modal button')]
      .find((candidate) => candidate.textContent?.includes('Run workflow'));
    return button !== undefined && !button.disabled;
  })()`,
  'three-block run consent',
);
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.run-modal button')]
    .find((candidate) => candidate.textContent?.includes('Run workflow'));
  button?.click();
})()`);
await waitFor(
  'document.querySelector(".statusbar").innerText.includes("Last run: succeeded")',
  'three-block workflow completion',
);
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.tab-list button')]
    .find((candidate) => candidate.textContent?.includes('Run details'));
  button?.click();
})()`);
await waitFor(
  'document.querySelector(".run-details")?.innerText.includes("Exit code") === true',
  'three-block run inspection',
);
assert.deepEqual(exceptions, []);

socket.close();
console.log(
  'Electron smoke passed: editor, authority review, success, cancellation, typed failure, and inspection.',
);

async function runBridgeWorkflow(workflow, cancel = false) {
  return evaluate(`new Promise(async (resolve, reject) => {
    const events = [];
    let runId;
    const timeout = setTimeout(() => {
      dispose();
      reject(new Error('Desktop bridge workflow timed out.'));
    }, 5000);
    const dispose = window.vorchestra.onRunEvent((event) => {
      if (runId !== undefined && event.runId !== runId) return;
      events.push(event);
      if (event.type === 'run_completed') {
        clearTimeout(timeout);
        dispose();
        resolve(events);
      }
    });
    try {
      const started = await window.vorchestra.runWorkflow(${JSON.stringify(workflow)});
      runId = started.runId;
      ${cancel ? 'setTimeout(() => window.vorchestra.cancelRun(runId), 50);' : ''}
    } catch (error) {
      clearTimeout(timeout);
      dispose();
      reject(error);
    }
  })`);
}
