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

async function waitFor(expression, description, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await evaluate(expression)) === true) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

await command('Runtime.enable');
await command('Page.bringToFront');
await waitFor('document.querySelector(".app-shell") !== null', 'the editor');
await evaluate(`(() => {
  window.confirm = () => true;
  document.querySelector('[aria-label="New"]')?.click();
})()`);
await waitFor(
  `document.querySelectorAll('.react-flow__node').length === 1 &&
   document.querySelectorAll('.react-flow__minimap-node').length === 1`,
  'a clean workflow',
);

const loadMeasurement = await evaluate(`new Promise((resolve) => {
  const add = document.querySelector('[aria-label="Add process"]');
  const startedAt = performance.now();
  const timeout = setTimeout(() => resolve({ timedOut: true }), 5_000);
  for (let index = 1; index < 51; index += 1) add.click();
  const check = () => {
    const nodes = document.querySelectorAll('.react-flow__node').length;
    const minimap = document.querySelectorAll('.react-flow__minimap-node').length;
    if (nodes === 51 && minimap === 51) {
      clearTimeout(timeout);
      requestAnimationFrame(() => resolve({
        timedOut: false,
        durationMs: performance.now() - startedAt,
      }));
    } else {
      requestAnimationFrame(check);
    }
  };
  check();
})`);
assert.equal(loadMeasurement.timedOut, false, '51-node render timed out');
const loadMs = loadMeasurement.durationMs;
assert.ok(loadMs <= 2_000, `51-node render took ${loadMs.toFixed(1)} ms`);

const arrangeDurations = [];
for (let index = 0; index < 10; index += 1) {
  arrangeDurations.push(
    await evaluate(`new Promise((resolve) => {
      const button = document.querySelector('[aria-label="Auto arrange"]');
      const startedAt = performance.now();
      button.click();
      requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve(performance.now() - startedAt)));
    })`),
  );
}
assert.ok(
  arrangeDurations.every((duration) => duration <= 250),
  `Auto-arrange exceeded 250 ms: ${JSON.stringify(arrangeDurations)}`,
);

await evaluate(`(() => {
  const frames = [];
  let previous = performance.now();
  let minimumNodes = 51;
  let minimumMinimapNodes = 51;
  const startedAt = previous;
  const sample = (now) => {
    frames.push(now - previous);
    previous = now;
    minimumNodes = Math.min(
      minimumNodes,
      document.querySelectorAll('.react-flow__node').length,
    );
    minimumMinimapNodes = Math.min(
      minimumMinimapNodes,
      document.querySelectorAll('.react-flow__minimap-node').length,
    );
    if (now - startedAt < 5_200) requestAnimationFrame(sample);
    else window.__vorchestraPerformance = {
      complete: true,
      frames,
      minimumNodes,
      minimumMinimapNodes,
    };
  };
  window.__vorchestraPerformance = { complete: false };
  requestAnimationFrame(sample);
})()`);

const dragStart = await evaluate(`(() => {
  const node = document.querySelector('.react-flow__node');
  const rectangle = node?.getBoundingClientRect();
  return rectangle === undefined
    ? undefined
    : { x: rectangle.left + 100, y: rectangle.top + 22 };
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
const dragStartedAt = performance.now();
while (performance.now() - dragStartedAt < 5_050) {
  const progress = Math.min(1, (performance.now() - dragStartedAt) / 5_000);
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragStart.x + 170 * progress,
    y: dragStart.y + 70 * progress,
    button: 'left',
    buttons: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 16));
}
await command('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: dragStart.x + 170,
  y: dragStart.y + 70,
  button: 'left',
  buttons: 0,
  clickCount: 1,
});
await waitFor(
  'window.__vorchestraPerformance?.complete === true',
  'frame measurement',
);

const measurement = await evaluate('window.__vorchestraPerformance');
const intervals = measurement.frames
  .slice(2)
  .sort((left, right) => left - right);
const medianMs = percentile(intervals, 0.5);
const p95Ms = percentile(intervals, 0.95);
assert.equal(measurement.minimumNodes, 51);
assert.equal(measurement.minimumMinimapNodes, 51);
assert.ok(
  medianMs <= 20,
  `Median frame interval was ${medianMs.toFixed(2)} ms`,
);
assert.ok(p95Ms <= 34, `p95 frame interval was ${p95Ms.toFixed(2)} ms`);
assert.deepEqual(exceptions, []);

console.log(
  JSON.stringify(
    {
      blocks: 51,
      minimapNodes: 51,
      initialRenderMs: Number(loadMs.toFixed(2)),
      autoArrangeMaxMs: Number(Math.max(...arrangeDurations).toFixed(2)),
      dragDurationMs: 5_050,
      medianFrameIntervalMs: Number(medianMs.toFixed(2)),
      p95FrameIntervalMs: Number(p95Ms.toFixed(2)),
    },
    null,
    2,
  ),
);
socket.close();

function percentile(sorted, fraction) {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}
