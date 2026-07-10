import { z } from 'zod';

export const artifactKindSchema = z.enum([
  'text',
  'json',
  'filesystem-reference',
]);

const identifierSchema = z.string().trim().min(1);

const reservedEnvironmentVariableNames = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

export const environmentVariableNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Environment variable names must be portable identifiers.',
  )
  .refine(
    (name) => !reservedEnvironmentVariableNames.has(name),
    'Environment variable name is reserved.',
  );

export const inputPortSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    artifactKind: artifactKindSchema,
    required: z.boolean().default(true),
  })
  .strict();

export const outputPortSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    artifactKind: artifactKindSchema,
  })
  .strict();

const literalArgumentSchema = z
  .object({
    type: z.literal('literal'),
    value: z.string(),
  })
  .strict();

const inputArgumentSchema = z
  .object({
    type: z.literal('input'),
    portId: identifierSchema,
  })
  .strict();

export const argumentSchema = z.discriminatedUnion('type', [
  literalArgumentSchema,
  inputArgumentSchema,
]);

const literalEnvironmentValueSchema = z
  .object({
    source: z.literal('literal'),
    value: z.string(),
  })
  .strict();

const hostEnvironmentValueSchema = z
  .object({
    source: z.literal('host'),
    name: environmentVariableNameSchema,
  })
  .strict();

const inputEnvironmentValueSchema = z
  .object({
    source: z.literal('input'),
    portId: identifierSchema,
  })
  .strict();

export const environmentValueSchema = z.discriminatedUnion('source', [
  literalEnvironmentValueSchema,
  hostEnvironmentValueSchema,
  inputEnvironmentValueSchema,
]);

type EnvironmentValue = z.infer<typeof environmentValueSchema>;

const environmentRecordSchema = objectRecordSchema(
  environmentVariableNameSchema,
  environmentValueSchema,
) as z.ZodType<Record<string, EnvironmentValue>>;

const stdoutOutputBindingSchema = z
  .object({
    type: z.literal('stdout'),
    portId: identifierSchema,
  })
  .strict();

const stderrOutputBindingSchema = z
  .object({
    type: z.literal('stderr'),
    portId: identifierSchema,
  })
  .strict();

const filesystemOutputBindingSchema = z
  .object({
    type: z.literal('filesystem'),
    portId: identifierSchema,
    path: z.string().trim().min(1),
    entity: z.enum(['file', 'directory', 'unknown']).optional(),
  })
  .strict();

export const outputBindingSchema = z.discriminatedUnion('type', [
  stdoutOutputBindingSchema,
  stderrOutputBindingSchema,
  filesystemOutputBindingSchema,
]);

export const processInvocationSchema = z
  .object({
    executable: z.string().trim().min(1),
    arguments: z.array(argumentSchema).default([]),
    workingDirectory: z.string().trim().min(1).optional(),
    environment: environmentRecordSchema
      .optional()
      .transform(
        (environment) => environment ?? nullPrototypeRecord<EnvironmentValue>(),
      ),
    stdin: z
      .object({
        portId: identifierSchema,
      })
      .strict()
      .optional(),
    shell: z.boolean().default(false),
    outputs: z.array(outputBindingSchema).default([]),
  })
  .strict();

export const processBlockSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    kind: z.literal('process'),
    inputs: z.array(inputPortSchema).default([]),
    outputs: z.array(outputPortSchema).default([]),
    invocation: processInvocationSchema,
  })
  .strict();

export const connectionSchema = z
  .object({
    id: identifierSchema,
    from: z
      .object({
        blockId: identifierSchema,
        portId: identifierSchema,
      })
      .strict(),
    to: z
      .object({
        blockId: identifierSchema,
        portId: identifierSchema,
      })
      .strict(),
  })
  .strict();

const blockPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

type BlockPosition = z.infer<typeof blockPositionSchema>;

const blockPositionsSchema = objectRecordSchema(
  identifierSchema,
  blockPositionSchema,
) as z.ZodType<Record<string, BlockPosition>>;

export const workflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifierSchema,
    name: z.string().trim().min(1),
    blocks: z.array(processBlockSchema),
    connections: z.array(connectionSchema),
    layout: z
      .object({
        blockPositions: blockPositionsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type InputPort = z.infer<typeof inputPortSchema>;
export type OutputPort = z.infer<typeof outputPortSchema>;
export type ProcessBlock = z.infer<typeof processBlockSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(input);
}

const invalidRecordInput = Symbol('invalid-record-input');

function objectRecordSchema<Value>(
  keySchema: z.ZodType<string>,
  valueSchema: z.ZodType<Value>,
) {
  return z
    .preprocess(
      (input) => {
        if (
          typeof input !== 'object' ||
          input === null ||
          Array.isArray(input) ||
          !hasRecordPrototype(input)
        ) {
          return invalidRecordInput;
        }
        return Object.keys(input).map((key) => [
          key,
          (input as Record<string, unknown>)[key],
        ]);
      },
      z.array(z.tuple([keySchema, valueSchema])),
    )
    .transform((entries) => nullPrototypeRecord(entries));
}

function hasRecordPrototype(input: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function nullPrototypeRecord<Value>(
  entries: readonly (readonly [string, Value])[] = [],
): Record<string, Value> {
  const record = Object.create(null) as Record<string, Value>;
  for (const [key, value] of entries) {
    record[key] = value;
  }
  return record;
}
