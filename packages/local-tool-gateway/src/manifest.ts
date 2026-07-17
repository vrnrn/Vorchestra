import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  ManifestValidationError,
  type LocalToolManifest,
  type ToolInputProperty,
  type ToolManifestEntry,
} from './types.js';

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const toolName = /^[a-z][a-z0-9_]{0,63}$/;
const sha256 = /^[a-f0-9]{64}$/;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);

export async function loadManifest(path: string): Promise<LocalToolManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new ManifestValidationError(
      `Cannot read manifest ${JSON.stringify(path)}: ${errorMessage(error)}`,
    );
  }
  return validateManifest(parsed);
}

export function validateManifest(value: unknown): LocalToolManifest {
  const root = record(value, 'manifest');
  exactKeys(root, ['schemaVersion', 'tools'], 'manifest');
  if (root.schemaVersion !== 1) fail('manifest.schemaVersion must be 1.');
  if (!Array.isArray(root.tools) || root.tools.length === 0) {
    fail('manifest.tools must be a non-empty array.');
  }
  const tools = root.tools.map((entry, index) =>
    validateTool(entry, `manifest.tools[${index}]`),
  );
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name))
      fail(`Duplicate tool name ${JSON.stringify(tool.name)}.`);
    names.add(tool.name);
  }
  return { schemaVersion: 1, tools };
}

function validateTool(value: unknown, path: string): ToolManifestEntry {
  const tool = record(value, path);
  exactKeys(
    tool,
    [
      'name',
      'description',
      'executable',
      'sha256',
      'fixedArguments',
      'arguments',
      'inputSchema',
      'environment',
      'isolatedHome',
      'workingDirectory',
      'timeoutMs',
      'maxOutputBytes',
      'output',
    ],
    path,
  );
  if (typeof tool.name !== 'string' || !toolName.test(tool.name))
    fail(`${path}.name must match ${toolName}.`);
  if (typeof tool.description !== 'string' || tool.description.length === 0)
    fail(`${path}.description must be a non-empty string.`);
  if (typeof tool.executable !== 'string' || !isAbsolute(tool.executable))
    fail(`${path}.executable must be an absolute path.`);
  if (typeof tool.sha256 !== 'string' || !sha256.test(tool.sha256))
    fail(`${path}.sha256 must be a lowercase SHA-256 digest.`);
  const inputSchema = validateInputSchema(
    tool.inputSchema,
    `${path}.inputSchema`,
  );
  const fixedArguments = optionalStringArray(
    tool.fixedArguments,
    `${path}.fixedArguments`,
  );
  const arguments_ =
    tool.arguments === undefined
      ? undefined
      : array(tool.arguments, `${path}.arguments`).map((argument, index) => {
          const itemPath = `${path}.arguments[${index}]`;
          const item = record(argument, itemPath);
          if (item.type === 'literal') {
            exactKeys(item, ['type', 'value'], itemPath);
            if (typeof item.value !== 'string')
              fail(`${itemPath}.value must be a string.`);
            return { type: 'literal' as const, value: item.value };
          }
          if (item.type === 'input') {
            exactKeys(item, ['type', 'name', 'encoding'], itemPath);
            if (
              typeof item.name !== 'string' ||
              !(item.name in inputSchema.properties)
            )
              fail(
                `${itemPath}.name must reference a declared input property.`,
              );
            if (
              item.encoding !== undefined &&
              item.encoding !== 'string' &&
              item.encoding !== 'json'
            )
              fail(`${itemPath}.encoding must be "string" or "json".`);
            const encoding = item.encoding as 'string' | 'json' | undefined;
            return {
              type: 'input' as const,
              name: item.name,
              ...(encoding === undefined ? {} : { encoding }),
            };
          }
          fail(`${itemPath}.type must be "literal" or "input".`);
        });
  if (!positiveInteger(tool.timeoutMs) || tool.timeoutMs > 3_600_000)
    fail(`${path}.timeoutMs must be an integer from 1 through 3600000.`);
  if (
    !positiveInteger(tool.maxOutputBytes) ||
    tool.maxOutputBytes > 100_000_000
  )
    fail(`${path}.maxOutputBytes must be an integer from 1 through 100000000.`);
  if (tool.output !== 'text' && tool.output !== 'json')
    fail(`${path}.output must be "text" or "json".`);
  if (
    tool.workingDirectory !== undefined &&
    (typeof tool.workingDirectory !== 'string' ||
      !isAbsolute(tool.workingDirectory))
  )
    fail(`${path}.workingDirectory must be an absolute path.`);
  const environment = validateEnvironment(
    tool.environment,
    `${path}.environment`,
  );
  if (tool.isolatedHome !== undefined && typeof tool.isolatedHome !== 'boolean')
    fail(`${path}.isolatedHome must be a boolean.`);
  if (tool.isolatedHome === true) {
    for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
      if (
        environment?.inherit?.includes(name) === true ||
        environment?.literal?.[name] !== undefined
      )
        fail(
          `${path}.environment cannot declare ${JSON.stringify(name)} when isolatedHome is true.`,
        );
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    executable: tool.executable,
    sha256: tool.sha256,
    inputSchema,
    timeoutMs: tool.timeoutMs,
    maxOutputBytes: tool.maxOutputBytes,
    output: tool.output,
    ...(fixedArguments === undefined ? {} : { fixedArguments }),
    ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    ...(environment === undefined ? {} : { environment }),
    ...(tool.isolatedHome === undefined
      ? {}
      : { isolatedHome: tool.isolatedHome }),
    ...(tool.workingDirectory === undefined
      ? {}
      : { workingDirectory: tool.workingDirectory }),
  };
}

function validateInputSchema(value: unknown, path: string) {
  const schema = record(value, path);
  exactKeys(
    schema,
    ['type', 'properties', 'required', 'additionalProperties'],
    path,
  );
  if (schema.type !== 'object') fail(`${path}.type must be "object".`);
  if (schema.additionalProperties !== false)
    fail(`${path}.additionalProperties must be false.`);
  const rawProperties = record(schema.properties, `${path}.properties`);
  const properties: Record<string, ToolInputProperty> = Object.create(
    null,
  ) as Record<string, ToolInputProperty>;
  for (const [name, property] of Object.entries(rawProperties)) {
    if (!identifier.test(name) || forbiddenKeys.has(name))
      fail(`${path}.properties has invalid name ${JSON.stringify(name)}.`);
    const propertyPath = `${path}.properties.${name}`;
    const item = record(property, propertyPath);
    exactKeys(
      item,
      [
        'type',
        'description',
        'minLength',
        'maxLength',
        'minimum',
        'maximum',
        'enum',
      ],
      propertyPath,
    );
    if (!['string', 'number', 'integer', 'boolean'].includes(String(item.type)))
      fail(`${propertyPath}.type is unsupported.`);
    validateOptionalNumber(item.minLength, `${propertyPath}.minLength`, true);
    validateOptionalNumber(item.maxLength, `${propertyPath}.maxLength`, true);
    validateOptionalNumber(item.minimum, `${propertyPath}.minimum`, false);
    validateOptionalNumber(item.maximum, `${propertyPath}.maximum`, false);
    if (item.description !== undefined && typeof item.description !== 'string')
      fail(`${propertyPath}.description must be a string.`);
    if (
      item.enum !== undefined &&
      (!Array.isArray(item.enum) || !item.enum.every(isPrimitive))
    )
      fail(`${propertyPath}.enum must contain primitive values.`);
    properties[name] = item as unknown as ToolInputProperty;
  }
  const required = optionalStringArray(schema.required, `${path}.required`);
  for (const name of required ?? []) {
    if (!(name in properties))
      fail(
        `${path}.required references undeclared property ${JSON.stringify(name)}.`,
      );
  }
  return {
    type: 'object' as const,
    properties,
    ...(required === undefined ? {} : { required }),
    additionalProperties: false as const,
  };
}

function validateEnvironment(value: unknown, path: string) {
  if (value === undefined) return undefined;
  const environment = record(value, path);
  exactKeys(environment, ['inherit', 'literal'], path);
  const inherit = optionalStringArray(environment.inherit, `${path}.inherit`);
  const literalRaw =
    environment.literal === undefined
      ? undefined
      : record(environment.literal, `${path}.literal`);
  const literal: Record<string, string> | undefined =
    literalRaw === undefined
      ? undefined
      : (Object.create(null) as Record<string, string>);
  for (const name of [...(inherit ?? []), ...Object.keys(literalRaw ?? {})]) {
    if (!identifier.test(name) || forbiddenKeys.has(name))
      fail(
        `${path} contains invalid environment name ${JSON.stringify(name)}.`,
      );
  }
  if (new Set(inherit).size !== (inherit?.length ?? 0))
    fail(`${path}.inherit contains duplicates.`);
  for (const [name, value_] of Object.entries(literalRaw ?? {})) {
    if (typeof value_ !== 'string')
      fail(`${path}.literal.${name} must be a string.`);
    if (inherit?.includes(name))
      fail(
        `${path} declares ${JSON.stringify(name)} as both inherited and literal.`,
      );
    literal![name] = value_;
  }
  return {
    ...(inherit === undefined ? {} : { inherit }),
    ...(literal === undefined ? {} : { literal }),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value;
}
function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      fail(`${path} contains unknown property ${JSON.stringify(key)}.`);
}
function optionalStringArray(
  value: unknown,
  path: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    fail(`${path} must be an array of strings.`);
  return value;
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
function validateOptionalNumber(
  value: unknown,
  path: string,
  integer: boolean,
) {
  if (
    value !== undefined &&
    (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (integer && !Number.isInteger(value)))
  )
    fail(`${path} must be ${integer ? 'an integer' : 'a finite number'}.`);
}
function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
function fail(message: string): never {
  throw new ManifestValidationError(message);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
