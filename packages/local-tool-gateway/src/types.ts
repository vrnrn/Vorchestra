export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean';

export interface ToolInputProperty {
  type: PrimitiveType;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number | boolean>;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolInputProperty>;
  required?: string[];
  additionalProperties: false;
}

export type ToolArgument =
  | { type: 'literal'; value: string }
  | { type: 'input'; name: string; encoding?: 'string' | 'json' };

export interface ToolManifestEntry {
  name: string;
  description: string;
  executable: string;
  sha256: string;
  fixedArguments?: string[];
  arguments?: ToolArgument[];
  inputSchema: ToolInputSchema;
  environment?: {
    inherit?: string[];
    literal?: Record<string, string>;
  };
  isolatedHome?: boolean;
  workingDirectory?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  output: 'text' | 'json';
}

export interface LocalToolManifest {
  schemaVersion: 1;
  tools: ToolManifestEntry[];
}

export type GatewayFailureCode =
  | 'manifest_invalid'
  | 'tool_not_found'
  | 'arguments_invalid'
  | 'executable_unavailable'
  | 'executable_hash_mismatch'
  | 'launch_failed'
  | 'timed_out'
  | 'cancelled'
  | 'output_limit_exceeded'
  | 'process_failed'
  | 'output_invalid';

export interface GatewayFailure {
  code: GatewayFailureCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ToolExecutionResult =
  | {
      ok: true;
      tool: string;
      output: string | unknown;
      stderr: string;
      exitCode: 0;
    }
  | {
      ok: false;
      tool: string;
      failure: GatewayFailure;
      stdout: string;
      stderr: string;
      exitCode: number | null;
    };

export class ManifestValidationError extends Error {
  readonly code = 'manifest_invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}
