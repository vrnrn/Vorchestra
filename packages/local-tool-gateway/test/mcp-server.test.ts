import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  LocalToolGateway,
  runMcpStdioServer,
  validateManifest,
  type LocalToolManifest,
} from '../src/index.js';

test('MCP stdio negotiates initialize, lists manifest tools, and returns structured tool output', async () => {
  await withExecutable(
    `process.stdout.write(JSON.stringify({ query: process.argv[2] }));`,
    async ({ executable, sha256 }) => {
      const input = new PassThrough();
      const output = new PassThrough();
      const capture = captureLines(output);
      const server = runMcpStdioServer(
        new LocalToolGateway(toolManifest(executable, sha256)),
        input,
        output,
      );

      send(input, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'fixture-client', version: '1' },
        },
      });
      send(input, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      send(input, {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'fixture_read', arguments: { query: 'NVDA' } },
      });

      const messages = await capture.waitFor(3);
      input.end();
      await server;

      assert.deepEqual(messages[0], {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'vorchestra-local-tool-gateway',
            version: '0.0.0',
          },
          instructions:
            'Only tools explicitly declared in the local manifest are available. Executables and arguments are not open-ended.',
        },
      });
      assert.deepEqual(messages[1], {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            {
              name: 'fixture_read',
              description: 'Read fixture data.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', minLength: 1, maxLength: 100 },
                },
                required: ['query'],
                additionalProperties: false,
              },
            },
          ],
        },
      });
      assert.deepEqual(messages[2], {
        jsonrpc: '2.0',
        id: 'call-1',
        result: {
          content: [{ type: 'text', text: '{"output":{"query":"NVDA"}}' }],
          structuredContent: { output: { query: 'NVDA' } },
          isError: false,
        },
      });
    },
  );
});

test('MCP stdio maps gateway failures to error tool results and protocol failures to JSON-RPC errors', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const capture = captureLines(output);
  const gateway = new LocalToolGateway(
    validateManifest({
      schemaVersion: 1,
      tools: [
        {
          name: 'declared_read',
          description: 'Declared only.',
          executable: '/tmp/not-invoked',
          sha256: '0'.repeat(64),
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
          timeoutMs: 100,
          maxOutputBytes: 100,
          output: 'text',
        },
      ],
    }),
  );
  const server = runMcpStdioServer(gateway, input, output);
  input.write('{bad json}\n');
  send(input, { jsonrpc: '2.0', id: 1, method: 'unknown/method' });
  send(input, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'declared_read', arguments: {} },
  });
  send(input, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'not_declared', arguments: {} },
  });

  const messages = await capture.waitFor(4);
  input.end();
  await server;
  assert.deepEqual(messages[0], {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'Parse error.' },
  });
  assert.deepEqual(messages[1], {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Method not found.' },
  });
  assert.deepEqual(messages[2], {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [
        {
          type: 'text',
          text: 'arguments_invalid: Missing required argument "query".',
        },
      ],
      structuredContent: {
        failure: {
          code: 'arguments_invalid',
          message: 'Missing required argument "query".',
        },
        exitCode: null,
        stdout: '',
        stderr: '',
      },
      isError: true,
    },
  });
  assert.deepEqual(messages[3], {
    jsonrpc: '2.0',
    id: 3,
    error: { code: -32602, message: 'Unknown tool: not_declared' },
  });
});

test('MCP notifications/cancelled aborts the matching active tool call', async () => {
  await withExecutable(
    `setInterval(() => {}, 1000);`,
    async ({ executable, sha256 }) => {
      const input = new PassThrough();
      const output = new PassThrough();
      const capture = captureLines(output);
      const server = runMcpStdioServer(
        new LocalToolGateway(toolManifest(executable, sha256), {
          killGracePeriodMs: 10,
        }),
        input,
        output,
      );
      send(input, {
        jsonrpc: '2.0',
        id: 'slow-call',
        method: 'tools/call',
        params: { name: 'fixture_read', arguments: { query: 'SPX' } },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      send(input, {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 'slow-call', reason: 'test cancellation' },
      });

      const messages = await capture.waitFor(1);
      input.end();
      await server;
      const result = messages[0]?.result as {
        isError: boolean;
        structuredContent: { failure: { code: string } };
      };
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.failure.code, 'cancelled');
    },
  );
});

function toolManifest(executable: string, sha256: string): LocalToolManifest {
  return validateManifest({
    schemaVersion: 1,
    tools: [
      {
        name: 'fixture_read',
        description: 'Read fixture data.',
        executable,
        sha256,
        arguments: [{ type: 'input', name: 'query' }],
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 100 },
          },
          required: ['query'],
          additionalProperties: false,
        },
        timeoutMs: 5_000,
        maxOutputBytes: 10_000,
        output: 'json',
      },
    ],
  });
}

function send(input: PassThrough, message: unknown) {
  input.write(`${JSON.stringify(message)}\n`);
}

function captureLines(output: PassThrough) {
  let buffered = '';
  const messages: Array<Record<string, unknown>> = [];
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line !== '')
        messages.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    async waitFor(count: number) {
      const deadline = Date.now() + 2_000;
      while (messages.length < count && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(
        messages.length >= count,
        `Expected ${count} MCP responses, received ${messages.length}.`,
      );
      return messages;
    },
  };
}

async function withExecutable(
  source: string,
  callback: (fixture: { executable: string; sha256: string }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'vorchestra-mcp-server-'));
  const executable = join(directory, 'fixture-tool');
  const contents = `#!${process.execPath}\n${source}\n`;
  try {
    await writeFile(executable, contents, 'utf8');
    await chmod(executable, 0o755);
    await callback({
      executable,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
