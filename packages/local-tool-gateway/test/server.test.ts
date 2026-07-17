import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  LocalToolGateway,
  runJsonLineServer,
  validateManifest,
} from '../src/index.js';

test('JSON-line server exposes list, typed unknown-tool failure, and invalid-request errors', async () => {
  const gateway = new LocalToolGateway(
    validateManifest({
      schemaVersion: 1,
      tools: [
        {
          name: 'declared_read',
          description: 'Declared only for listing.',
          executable: '/tmp/not-invoked',
          sha256: '0'.repeat(64),
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          timeoutMs: 100,
          maxOutputBytes: 100,
          output: 'text',
        },
      ],
    }),
  );
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    captured += chunk;
  });
  const server = runJsonLineServer(gateway, input, output);

  input.write('{bad json}\n');
  input.write(`${JSON.stringify({ id: 1, method: 'tools/list' })}\n`);
  input.write(
    `${JSON.stringify({ id: 2, method: 'tools/call', params: { name: 'not_declared', arguments: {} } })}\n`,
  );
  input.end();
  await server;
  const messages = captured
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], {
    id: null,
    error: { code: 'invalid_request', message: 'Request is not valid JSON.' },
  });
  assert.equal((messages[1]?.result as { tools: unknown[] }).tools.length, 1);
  assert.equal(
    (messages[2]?.result as { failure: { code: string } }).failure.code,
    'tool_not_found',
  );
});
