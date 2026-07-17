import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { LocalToolGateway } from './gateway.js';
import type { ToolExecutionResult } from './types.js';

type RequestId = string | number;

const serverInfo = { name: 'vorchestra-local-tool-gateway', version: '0.0.0' };
const latestProtocolVersion = '2025-11-25';
const supportedProtocolVersions = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  latestProtocolVersion,
]);

/**
 * Runs an MCP stdio transport. MCP stdio messages are JSON-RPC 2.0 objects,
 * one per line. Calls remain concurrent so notifications/cancelled can abort a
 * process while it is running.
 */
export async function runMcpStdioServer(
  gateway: LocalToolGateway,
  input: Readable,
  output: Writable,
): Promise<void> {
  const active = new Map<RequestId, AbortController>();
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      writeError(output, null, -32700, 'Parse error.');
      continue;
    }
    if (
      !isRecord(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      writeError(output, requestIdOrNull(message), -32600, 'Invalid Request.');
      continue;
    }

    const id = requestId(message);
    if (message.method === 'notifications/initialized') continue;
    if (message.method === 'notifications/cancelled') {
      const cancellationId = cancellationRequestId(message.params);
      if (cancellationId !== undefined) active.get(cancellationId)?.abort();
      continue;
    }
    if (id === undefined) continue;

    if (message.method === 'initialize') {
      const requestedVersion = protocolVersion(message.params);
      const selectedVersion =
        requestedVersion !== undefined &&
        supportedProtocolVersions.has(requestedVersion)
          ? requestedVersion
          : latestProtocolVersion;
      writeResult(output, id, {
        protocolVersion: selectedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions:
          'Only tools explicitly declared in the local manifest are available. Executables and arguments are not open-ended.',
      });
      continue;
    }
    if (message.method === 'ping') {
      writeResult(output, id, {});
      continue;
    }
    if (message.method === 'tools/list') {
      writeResult(output, id, { tools: gateway.listTools() });
      continue;
    }
    if (message.method === 'tools/call') {
      const call = parseToolCall(message.params);
      if (call === undefined) {
        writeError(output, id, -32602, 'Invalid tools/call params.');
        continue;
      }
      if (!gateway.hasTool(call.name)) {
        writeError(output, id, -32602, `Unknown tool: ${call.name}`);
        continue;
      }
      if (active.has(id)) {
        writeError(
          output,
          id,
          -32600,
          'A request with this id is already active.',
        );
        continue;
      }
      const controller = new AbortController();
      active.set(id, controller);
      const operation = gateway
        .execute(call.name, call.arguments, controller.signal)
        .then((result) => writeResult(output, id, mcpToolResult(result)))
        .catch((error: unknown) =>
          writeError(
            output,
            id,
            -32603,
            error instanceof Error ? error.message : String(error),
          ),
        )
        .finally(() => {
          active.delete(id);
          pending.delete(operation);
        });
      pending.add(operation);
      continue;
    }
    writeError(output, id, -32601, 'Method not found.');
  }

  for (const controller of active.values()) controller.abort();
  await Promise.allSettled(pending);
}

function mcpToolResult(result: ToolExecutionResult): Record<string, unknown> {
  if (result.ok) {
    const structuredContent = {
      output: result.output,
      ...(result.stderr === '' ? {} : { stderr: result.stderr }),
    };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
      isError: false,
    };
  }
  const structuredContent = {
    failure: result.failure,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  return {
    content: [
      {
        type: 'text',
        text: `${result.failure.code}: ${result.failure.message}`,
      },
    ],
    structuredContent,
    isError: true,
  };
}

function parseToolCall(
  params: unknown,
): { name: string; arguments: unknown } | undefined {
  if (!isRecord(params) || typeof params.name !== 'string') return undefined;
  return { name: params.name, arguments: params.arguments ?? {} };
}

function protocolVersion(params: unknown): string | undefined {
  return isRecord(params) && typeof params.protocolVersion === 'string'
    ? params.protocolVersion
    : undefined;
}

function cancellationRequestId(params: unknown): RequestId | undefined {
  if (!isRecord(params)) return undefined;
  return typeof params.requestId === 'string' ||
    typeof params.requestId === 'number'
    ? params.requestId
    : undefined;
}

function requestId(message: Record<string, unknown>): RequestId | undefined {
  return typeof message.id === 'string' || typeof message.id === 'number'
    ? message.id
    : undefined;
}

function requestIdOrNull(message: unknown): RequestId | null {
  return isRecord(message) ? (requestId(message) ?? null) : null;
}

function writeResult(output: Writable, id: RequestId, result: unknown) {
  write(output, { jsonrpc: '2.0', id, result });
}

function writeError(
  output: Writable,
  id: RequestId | null,
  code: number,
  message: string,
) {
  write(output, { jsonrpc: '2.0', id, error: { code, message } });
}

function write(output: Writable, message: unknown) {
  output.write(`${JSON.stringify(message)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
