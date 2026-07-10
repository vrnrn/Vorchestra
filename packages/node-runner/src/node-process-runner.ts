import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type {
  Artifact,
  ExecutionFailure,
  FilesystemReferenceArtifact,
  JsonValue,
  ProcessOutputSpec,
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from '@vorchestra/engine';

export interface NodeProcessRunnerOptions {
  readonly terminationGracePeriodMs?: number;
  readonly now?: () => Date;
  readonly statPath?: (path: string) => Promise<PathMetadata>;
}

interface PathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
}

const DEFAULT_TERMINATION_GRACE_PERIOD_MS = 1_000;

export class NodeProcessRunner implements ProcessRunner {
  readonly #terminationGracePeriodMs: number;
  readonly #now: () => Date;
  readonly #statPath: (path: string) => Promise<PathMetadata>;

  constructor(options: NodeProcessRunnerOptions = {}) {
    this.#terminationGracePeriodMs =
      options.terminationGracePeriodMs ?? DEFAULT_TERMINATION_GRACE_PERIOD_MS;
    this.#now = options.now ?? (() => new Date());
    this.#statPath = options.statPath ?? stat;
  }

  async run(
    request: ProcessRunRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ProcessRunResult> {
    if (options.signal.aborted) {
      return cancelledResult('', '', null);
    }

    const invalidEnvironmentName = Object.keys(request.environment).find(
      (name) => !isPortableEnvironmentName(name),
    );
    if (invalidEnvironmentName !== undefined) {
      return failedResult('', '', null, {
        code: 'process_launch_failed',
        message: `Environment variable name is not portable: ${JSON.stringify(invalidEnvironmentName)}`,
        nextAction:
          'Use a name containing only letters, digits, and underscores, beginning with a letter or underscore.',
      });
    }

    const workingDirectoryFailure = await validateWorkingDirectory(
      request.workingDirectory,
      this.#statPath,
    );
    if (options.signal.aborted) {
      return cancelledResult('', '', null);
    }
    if (workingDirectoryFailure) {
      return failedResult('', '', null, workingDirectoryFailure);
    }

    const processResult = await runChildProcess(
      request,
      options.signal,
      this.#terminationGracePeriodMs,
    );
    if (processResult.status !== 'succeeded') {
      return processResult;
    }

    if (options.signal.aborted) {
      return cancelledResult(
        processResult.stdout,
        processResult.stderr,
        processResult.exitCode,
      );
    }
    return this.#produceArtifacts(request, processResult, options.signal);
  }

  async #produceArtifacts(
    request: ProcessRunRequest,
    processResult: ProcessRunResult & { readonly status: 'succeeded' },
    signal: AbortSignal,
  ): Promise<ProcessRunResult> {
    const artifacts: Artifact[] = [];
    const createdAt = this.#now().toISOString();

    for (const output of request.outputs) {
      if (signal.aborted) {
        return cancelledResult(
          processResult.stdout,
          processResult.stderr,
          processResult.exitCode,
        );
      }
      const provenance = {
        runId: request.runId,
        blockId: request.blockId,
        portId: output.portId,
        createdAt,
      };
      const id = JSON.stringify([
        request.runId,
        request.blockId,
        output.portId,
      ]);

      if (output.kind === 'filesystem-reference') {
        const filesystemArtifact = await abortable(
          createFilesystemArtifact(
            output,
            request,
            id,
            provenance,
            this.#statPath,
          ),
          signal,
        );
        if (filesystemArtifact === ABORTED) {
          return cancelledResult(
            processResult.stdout,
            processResult.stderr,
            processResult.exitCode,
          );
        }
        if ('failure' in filesystemArtifact) {
          return failedResult(
            processResult.stdout,
            processResult.stderr,
            processResult.exitCode,
            filesystemArtifact.failure,
          );
        }
        artifacts.push(filesystemArtifact.artifact);
        continue;
      }

      if (output.kind === 'text') {
        artifacts.push({
          id,
          kind: 'text',
          provenance,
          value:
            output.source === 'stdout'
              ? processResult.stdout
              : processResult.stderr,
        });
        continue;
      }

      if (output.kind === 'json') {
        const serialized =
          output.source === 'stdout'
            ? processResult.stdout
            : processResult.stderr;
        try {
          artifacts.push({
            id,
            kind: 'json',
            provenance,
            value: JSON.parse(serialized) as JsonValue,
          });
        } catch {
          return failedResult(
            processResult.stdout,
            processResult.stderr,
            processResult.exitCode,
            {
              code: 'invalid_json_output',
              message: `Output port "${output.portId}" did not contain valid JSON.`,
              nextAction: `Inspect ${output.source} or change the output port to text.`,
            },
          );
        }
        continue;
      }
    }

    return { ...processResult, artifacts };
  }
}

async function validateWorkingDirectory(
  workingDirectory: string | undefined,
  statPath: (path: string) => Promise<PathMetadata>,
): Promise<ExecutionFailure | undefined> {
  if (workingDirectory === undefined) return undefined;

  try {
    const metadata = await statPath(workingDirectory);
    if (metadata.isDirectory()) return undefined;
  } catch {
    // The typed failure below covers missing and inaccessible paths.
  }

  return {
    code: 'working_directory_not_found',
    message: `Working directory is missing, inaccessible, or not a directory: ${workingDirectory}`,
    nextAction: 'Choose an existing, accessible working directory.',
  };
}

async function runChildProcess(
  request: ProcessRunRequest,
  signal: AbortSignal,
  terminationGracePeriodMs: number,
): Promise<ProcessRunResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.executable, [...request.arguments], {
        cwd: request.workingDirectory,
        detached: process.platform !== 'win32',
        env: { ...request.environment },
        shell: request.shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveResult(failedResult('', '', null, launchFailure(request, error)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let cancellationRequested = false;
    let terminationFailure: ExecutionFailure | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // A process may intentionally exit without consuming all input. In that
    // case the pipe can report EPIPE after close; the process exit remains the
    // authoritative outcome and the stream error must not escape uncaught.
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const finish = (result: ProcessRunResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', requestCancellation);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolveResult(result);
    };

    const requestCancellation = (): void => {
      if (cancellationRequested || settled) return;
      cancellationRequested = true;
      try {
        terminate(child, 'SIGTERM');
      } catch (error) {
        terminationFailure = {
          code: 'process_termination_failed',
          message: `Could not terminate process ${child.pid ?? '(unknown)'}: ${errorMessage(error)}`,
          nextAction:
            'Terminate the process manually and inspect its child processes.',
        };
      }

      forceKillTimer = setTimeout(() => {
        if (settled) return;
        try {
          terminate(child, 'SIGKILL');
        } catch (error) {
          terminationFailure = {
            code: 'process_termination_failed',
            message: `Could not force-terminate process ${child.pid ?? '(unknown)'}: ${errorMessage(error)}`,
            nextAction:
              'Terminate the process manually and inspect its child processes.',
          };
        }
      }, terminationGracePeriodMs);
      forceKillTimer.unref();
    };

    signal.addEventListener('abort', requestCancellation, { once: true });
    if (signal.aborted) requestCancellation();

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(failedResult(stdout, stderr, null, launchFailure(request, error)));
    });

    child.on('close', (exitCode, signalCode) => {
      if (terminationFailure) {
        finish(failedResult(stdout, stderr, exitCode, terminationFailure));
      } else if (cancellationRequested) {
        finish(cancelledResult(stdout, stderr, exitCode));
      } else if (signalCode !== null) {
        finish(
          failedResult(stdout, stderr, exitCode, {
            code: 'process_terminated_by_signal',
            signal: signalCode,
            message: `Process was terminated by signal ${signalCode}.`,
            nextAction:
              'Inspect the process diagnostics and determine what sent the signal.',
          }),
        );
      } else if (exitCode === 0) {
        finish({
          status: 'succeeded',
          exitCode: 0,
          stdout,
          stderr,
          artifacts: [],
        });
      } else {
        finish(
          failedResult(stdout, stderr, exitCode, {
            code: 'process_exit_nonzero',
            message: `Process exited with code ${exitCode === null ? 'unknown' : exitCode}.`,
            nextAction: 'Inspect stderr and the process arguments, then retry.',
            ...(exitCode === null ? {} : { exitCode }),
          }),
        );
      }
    });

    if (request.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(request.stdin, 'utf8');
    }
  });
}

function terminate(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;

  try {
    if (process.platform === 'win32') {
      // Windows has no POSIX process groups; Node maps these signals to
      // forceful process termination. Descendant cleanup is best-effort.
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function launchFailure(
  request: ProcessRunRequest,
  error: unknown,
): ExecutionFailure {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' && request.shell === false) {
    return {
      code: 'executable_not_found',
      message: `Executable was not found: ${request.executable}`,
      nextAction: 'Install the executable or select its absolute path.',
    };
  }
  return {
    code: 'process_launch_failed',
    message: `Process could not be launched: ${errorMessage(error)}`,
    nextAction:
      'Check the executable, arguments, permissions, and environment.',
  };
}

async function createFilesystemArtifact(
  output: Extract<ProcessOutputSpec, { kind: 'filesystem-reference' }>,
  request: ProcessRunRequest,
  id: string,
  provenance: Artifact['provenance'],
  statPath: (path: string) => Promise<PathMetadata>,
): Promise<
  | { readonly artifact: FilesystemReferenceArtifact }
  | { readonly failure: ExecutionFailure }
> {
  const path = isAbsolute(output.path)
    ? output.path
    : resolve(request.workingDirectory ?? process.cwd(), output.path);
  try {
    const metadata = await statPath(path);
    const actualEntity = metadata.isFile()
      ? 'file'
      : metadata.isDirectory()
        ? 'directory'
        : 'unknown';
    if (actualEntity === 'unknown') {
      return {
        failure: {
          code: 'filesystem_reference_inaccessible',
          message: `Filesystem output "${output.portId}" is neither a regular file nor a directory: ${path}`,
          nextAction: 'Produce a regular file or directory at the output path.',
        },
      };
    }
    if (
      output.entity !== undefined &&
      output.entity !== 'unknown' &&
      actualEntity !== output.entity
    ) {
      return {
        failure: {
          code: 'filesystem_reference_inaccessible',
          message: `Filesystem output "${output.portId}" expected a ${output.entity}, but found ${actualEntity}: ${path}`,
          nextAction: 'Correct the output path or its expected entity type.',
        },
      };
    }
    return {
      artifact: {
        id,
        kind: 'filesystem-reference',
        provenance,
        path,
        entity: actualEntity,
      },
    };
  } catch {
    return {
      failure: {
        code: 'filesystem_reference_inaccessible',
        message: `Filesystem output "${output.portId}" is missing or inaccessible: ${path}`,
        nextAction:
          'Confirm the process created the path and that it is accessible.',
      },
    };
  }
}

function failedResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  failure: ExecutionFailure,
): ProcessRunResult {
  return { status: 'failed', exitCode, stdout, stderr, artifacts: [], failure };
}

function cancelledResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): ProcessRunResult {
  return { status: 'cancelled', exitCode, stdout, stderr, artifacts: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPortableEnvironmentName(name: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    name !== '__proto__' &&
    name !== 'constructor' &&
    name !== 'prototype'
  );
}

const ABORTED = Symbol('aborted');

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> {
  if (signal.aborted) return ABORTED;

  return new Promise<T | typeof ABORTED>((resolveValue, rejectValue) => {
    const handleAbort = (): void => {
      resolveValue(ABORTED);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolveValue(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        rejectValue(error);
      },
    );
  });
}
