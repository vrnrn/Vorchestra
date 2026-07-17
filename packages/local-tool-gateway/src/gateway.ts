import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  GatewayFailure,
  LocalToolManifest,
  ToolExecutionResult,
  ToolInputProperty,
  ToolManifestEntry,
} from './types.js';

export interface LocalToolGatewayOptions {
  hostEnvironment?: NodeJS.ProcessEnv;
  killGracePeriodMs?: number;
}

export class LocalToolGateway {
  readonly #tools: ReadonlyMap<string, ToolManifestEntry>;
  readonly #hostEnvironment: NodeJS.ProcessEnv;
  readonly #killGracePeriodMs: number;

  constructor(
    manifest: LocalToolManifest,
    options: LocalToolGatewayOptions = {},
  ) {
    this.#tools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
    this.#hostEnvironment = options.hostEnvironment ?? process.env;
    this.#killGracePeriodMs = options.killGracePeriodMs ?? 250;
  }

  listTools() {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  async execute(
    name: string,
    input: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolExecutionResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined)
      return failed(
        name,
        'tool_not_found',
        `Tool ${JSON.stringify(name)} is not declared.`,
      );
    const validation = validateArguments(tool, input);
    if (!validation.ok)
      return failed(name, 'arguments_invalid', validation.message);
    const executableFailure = await verifyExecutable(tool);
    if (executableFailure !== undefined)
      return failed(
        name,
        executableFailure.code,
        executableFailure.message,
        executableFailure.details,
      );
    if (signal.aborted)
      return failed(
        name,
        'cancelled',
        `Tool ${JSON.stringify(name)} was cancelled before launch.`,
      );

    const args = [
      ...(tool.fixedArguments ?? []),
      ...(tool.arguments ?? []).map((argument) =>
        argument.type === 'literal'
          ? argument.value
          : encodeInput(
              validation.value[argument.name],
              argument.encoding ?? 'string',
            ),
      ),
    ];
    const environment: NodeJS.ProcessEnv = Object.create(
      null,
    ) as NodeJS.ProcessEnv;
    for (const envName of tool.environment?.inherit ?? []) {
      const value = this.#hostEnvironment[envName];
      if (value !== undefined) environment[envName] = value;
    }
    Object.assign(environment, tool.environment?.literal ?? {});
    let isolatedHome: string | undefined;
    try {
      if (tool.isolatedHome === true) {
        isolatedHome = await createIsolatedHome();
        environment.HOME = isolatedHome;
        environment.XDG_CONFIG_HOME = join(isolatedHome, '.config');
        environment.XDG_CACHE_HOME = join(isolatedHome, '.cache');
      }
      if (signal.aborted)
        return failed(
          name,
          'cancelled',
          `Tool ${JSON.stringify(name)} was cancelled before launch.`,
        );
      return await runProcess(
        tool,
        args,
        environment,
        signal,
        this.#killGracePeriodMs,
      );
    } catch (error) {
      return failed(
        name,
        'launch_failed',
        `Cannot prepare isolated tool environment: ${errorMessage(error)}`,
      );
    } finally {
      if (isolatedHome !== undefined)
        await rm(isolatedHome, { recursive: true, force: true });
    }
  }
}

async function createIsolatedHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'vorchestra-tool-home-'));
  try {
    await chmod(home, 0o700);
    const configHome = join(home, '.config');
    const cacheHome = join(home, '.cache');
    await mkdir(configHome, { mode: 0o700 });
    await mkdir(cacheHome, { mode: 0o700 });
    await chmod(configHome, 0o700);
    await chmod(cacheHome, 0o700);
    return home;
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

async function verifyExecutable(
  tool: ToolManifestEntry,
): Promise<GatewayFailure | undefined> {
  try {
    const metadata = await lstat(tool.executable);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return {
        code: 'executable_unavailable',
        message: `Executable ${JSON.stringify(tool.executable)} must be a regular, non-symlink file.`,
      };
    }
    const digest = createHash('sha256')
      .update(await readFile(tool.executable))
      .digest('hex');
    if (digest !== tool.sha256) {
      return {
        code: 'executable_hash_mismatch',
        message: `Executable hash mismatch for ${JSON.stringify(tool.executable)}.`,
        details: { expectedSha256: tool.sha256, actualSha256: digest },
      };
    }
  } catch (error) {
    return {
      code: 'executable_unavailable',
      message: `Cannot access executable ${JSON.stringify(tool.executable)}: ${errorMessage(error)}`,
    };
  }
  return undefined;
}

function runProcess(
  tool: ToolManifestEntry,
  args: string[],
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
  killGracePeriodMs: number,
): Promise<ToolExecutionResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let terminal: GatewayFailure['code'] | undefined;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const finish = (result: ToolExecutionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const terminate = (code: GatewayFailure['code']) => {
      if (terminal !== undefined) return;
      terminal = code;
      killTree(child, 'SIGTERM');
      forceKillTimer = setTimeout(
        () => killTree(child, 'SIGKILL'),
        killGracePeriodMs,
      );
      forceKillTimer.unref();
    };
    const onAbort = () => terminate('cancelled');
    const timeout = setTimeout(() => terminate('timed_out'), tool.timeoutMs);
    timeout.unref();
    try {
      child = spawn(tool.executable, args, {
        cwd: tool.workingDirectory,
        env: environment,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin.end();
    } catch (error) {
      finish(failed(tool.name, 'launch_failed', errorMessage(error)));
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    const capture = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      if (target === 'stdout') stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
      if (stdout.byteLength + stderr.byteLength > tool.maxOutputBytes)
        terminate('output_limit_exceeded');
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.once('error', (error) =>
      finish(
        failed(
          tool.name,
          'launch_failed',
          errorMessage(error),
          undefined,
          stdout,
          stderr,
        ),
      ),
    );
    child.once('close', (code) => {
      const out = truncateUtf8(stdout, tool.maxOutputBytes);
      const err = truncateUtf8(
        stderr,
        Math.max(0, tool.maxOutputBytes - Buffer.byteLength(out)),
      );
      if (terminal !== undefined) {
        const messages = {
          cancelled: `Tool ${JSON.stringify(tool.name)} was cancelled.`,
          timed_out: `Tool ${JSON.stringify(tool.name)} exceeded its ${tool.timeoutMs} ms timeout.`,
          output_limit_exceeded: `Tool ${JSON.stringify(tool.name)} exceeded its ${tool.maxOutputBytes} byte output limit.`,
        } as const;
        finish(
          failed(
            tool.name,
            terminal,
            messages[terminal as keyof typeof messages],
            undefined,
            out,
            err,
            code,
          ),
        );
      } else if (code !== 0) {
        finish(
          failed(
            tool.name,
            'process_failed',
            `Tool ${JSON.stringify(tool.name)} exited with code ${String(code)}.`,
            undefined,
            out,
            err,
            code,
          ),
        );
      } else if (tool.output === 'json') {
        try {
          finish({
            ok: true,
            tool: tool.name,
            output: JSON.parse(out) as unknown,
            stderr: err,
            exitCode: 0,
          });
        } catch (error) {
          finish(
            failed(
              tool.name,
              'output_invalid',
              `Tool ${JSON.stringify(tool.name)} did not produce valid JSON: ${errorMessage(error)}`,
              undefined,
              out,
              err,
              code,
            ),
          );
        }
      } else {
        finish({
          ok: true,
          tool: tool.name,
          output: out,
          stderr: err,
          exitCode: 0,
        });
      }
    });
  });
}

function validateArguments(
  tool: ToolManifestEntry,
  input: unknown,
):
  | { ok: true; value: Record<string, string | number | boolean> }
  | { ok: false; message: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, message: 'Tool arguments must be an object.' };
  const value = input as Record<string, unknown>;
  const required = new Set(tool.inputSchema.required ?? []);
  for (const name of required)
    if (!(name in value))
      return {
        ok: false,
        message: `Missing required argument ${JSON.stringify(name)}.`,
      };
  for (const [name, argument] of Object.entries(value)) {
    const property = tool.inputSchema.properties[name];
    if (property === undefined)
      return {
        ok: false,
        message: `Unknown argument ${JSON.stringify(name)}.`,
      };
    const message = validateValue(name, argument, property);
    if (message !== undefined) return { ok: false, message };
  }
  return {
    ok: true,
    value: value as Record<string, string | number | boolean>,
  };
}

function validateValue(
  name: string,
  value: unknown,
  schema: ToolInputProperty,
): string | undefined {
  if (
    schema.type === 'integer'
      ? !(typeof value === 'number' && Number.isInteger(value))
      : typeof value !== schema.type
  )
    return `Argument ${JSON.stringify(name)} must be ${schema.type}.`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      return `Argument ${JSON.stringify(name)} must be finite.`;
    if (schema.minimum !== undefined && value < schema.minimum)
      return `Argument ${JSON.stringify(name)} is below its minimum.`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `Argument ${JSON.stringify(name)} is above its maximum.`;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return `Argument ${JSON.stringify(name)} is shorter than minLength.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return `Argument ${JSON.stringify(name)} is longer than maxLength.`;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value as never))
    return `Argument ${JSON.stringify(name)} is not an allowed enum value.`;
  return undefined;
}

function encodeInput(
  value: string | number | boolean | undefined,
  encoding: 'string' | 'json',
): string {
  return encoding === 'json' ? JSON.stringify(value) : String(value);
}
function killTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* Process already exited. */
  }
}
function truncateUtf8(buffer: Buffer, limit: number): string {
  return buffer.subarray(0, Math.max(0, limit)).toString('utf8');
}
function failed(
  tool: string,
  code: GatewayFailure['code'],
  message: string,
  details?: Record<string, unknown>,
  stdout: Buffer | string = '',
  stderr: Buffer | string = '',
  exitCode: number | null = null,
): ToolExecutionResult {
  return {
    ok: false,
    tool,
    failure: { code, message, ...(details === undefined ? {} : { details }) },
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    exitCode,
  };
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
