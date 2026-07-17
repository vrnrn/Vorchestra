import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { LocalToolGateway } from './gateway.js';

type RequestId = string | number;

export async function runJsonLineServer(
  gateway: LocalToolGateway,
  input: Readable,
  output: Writable,
): Promise<void> {
  const active = new Map<RequestId, AbortController>();
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let request: unknown;
    try {
      request = JSON.parse(line) as unknown;
    } catch {
      write(output, {
        id: null,
        error: {
          code: 'invalid_request',
          message: 'Request is not valid JSON.',
        },
      });
      continue;
    }
    const parsed = parseRequest(request);
    if (!parsed.ok) {
      write(output, {
        id: parsed.id,
        error: { code: 'invalid_request', message: parsed.message },
      });
      continue;
    }
    if (parsed.method === 'tools/list') {
      write(output, { id: parsed.id, result: { tools: gateway.listTools() } });
      continue;
    }
    if (parsed.method === 'tools/cancel') {
      const controller = active.get(parsed.requestId);
      if (controller !== undefined) controller.abort();
      write(output, {
        id: parsed.id,
        result: { cancelled: controller !== undefined },
      });
      continue;
    }
    if (active.has(parsed.id)) {
      write(output, {
        id: parsed.id,
        error: {
          code: 'invalid_request',
          message: 'A request with this id is already active.',
        },
      });
      continue;
    }
    const controller = new AbortController();
    active.set(parsed.id, controller);
    const operation = gateway
      .execute(parsed.name, parsed.arguments, controller.signal)
      .then((result) => write(output, { id: parsed.id, result }))
      .finally(() => {
        active.delete(parsed.id);
        pending.delete(operation);
      });
    pending.add(operation);
  }
  for (const controller of active.values()) controller.abort();
  await Promise.allSettled(pending);
}

function parseRequest(value: unknown):
  | { ok: true; id: RequestId; method: 'tools/list' }
  | {
      ok: true;
      id: RequestId;
      method: 'tools/call';
      name: string;
      arguments: unknown;
    }
  | { ok: true; id: RequestId; method: 'tools/cancel'; requestId: RequestId }
  | { ok: false; id: RequestId | null; message: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, id: null, message: 'Request must be an object.' };
  const request = value as Record<string, unknown>;
  const id =
    typeof request.id === 'string' || typeof request.id === 'number'
      ? request.id
      : null;
  if (id === null)
    return { ok: false, id, message: 'Request id must be a string or number.' };
  if (request.method === 'tools/list')
    return { ok: true, id, method: request.method };
  const params =
    typeof request.params === 'object' &&
    request.params !== null &&
    !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : undefined;
  if (
    request.method === 'tools/call' &&
    params !== undefined &&
    typeof params.name === 'string'
  )
    return {
      ok: true,
      id,
      method: request.method,
      name: params.name,
      arguments: params.arguments ?? {},
    };
  if (
    request.method === 'tools/cancel' &&
    params !== undefined &&
    (typeof params.requestId === 'string' ||
      typeof params.requestId === 'number')
  )
    return {
      ok: true,
      id,
      method: request.method,
      requestId: params.requestId,
    };
  return { ok: false, id, message: 'Unsupported method or invalid params.' };
}

function write(output: Writable, value: unknown) {
  output.write(`${JSON.stringify(value)}\n`);
}
