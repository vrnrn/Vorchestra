import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflow } from '../src/shared/defaults';
import {
  readWorkflowFile,
  writeWorkflowFile,
} from '../src/main/workflow-files';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('workflow files', () => {
  it('round-trips structure, layout, and host environment references', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'workflow.vorchestra.json');
    const workflow = createWorkflow();

    await writeWorkflowFile(filePath, workflow);
    const loaded = await readWorkflowFile(filePath);
    const serialized = await readFile(filePath, 'utf8');

    expect(JSON.parse(JSON.stringify(loaded))).toEqual(
      JSON.parse(JSON.stringify(workflow)),
    );
    expect(serialized).toContain('"source": "host"');
    expect(serialized).toContain('"name": "PATH"');
    expect(serialized).not.toContain(process.env.PATH ?? '__missing_path__');
  });

  it('rejects invalid workflow data without replacing an existing file', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'workflow.vorchestra.json');
    const workflow = createWorkflow();
    await writeWorkflowFile(filePath, workflow);
    const before = await readFile(filePath, 'utf8');

    await expect(
      writeWorkflowFile(filePath, { ...workflow, schemaVersion: 99 }),
    ).rejects.toThrow();

    expect(await readFile(filePath, 'utf8')).toBe(before);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vorchestra-desktop-'));
  temporaryDirectories.push(directory);
  return directory;
}
