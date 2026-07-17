import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LocalToolGateway,
  ManifestValidationError,
  validateManifest,
  type LocalToolManifest,
  type ToolManifestEntry,
} from '../src/index.js';

test('lists only declared tool metadata and runs a hash-pinned executable without a shell', async () => {
  await withFixture(
    `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), visible: process.env.VISIBLE, hidden: process.env.HIDDEN }));`,
    async ({ executable, sha256, directory }) => {
      const injectedMarker = join(directory, 'shell-injection-marker');
      const tool = fixtureTool(executable, sha256, {
        fixedArguments: ['--mode', 'read-only'],
        arguments: [
          { type: 'literal', value: '--query' },
          { type: 'input', name: 'query' },
          { type: 'literal', value: '--limit' },
          { type: 'input', name: 'limit', encoding: 'json' },
        ],
        environment: { inherit: ['VISIBLE'] },
        output: 'json',
      });
      const gateway = new LocalToolGateway(manifest(tool), {
        hostEnvironment: { VISIBLE: 'allowed', HIDDEN: 'must-not-leak' },
      });

      assert.deepEqual(JSON.parse(JSON.stringify(gateway.listTools())), [
        {
          name: 'fixture_read',
          description: 'Read fixture data.',
          inputSchema: tool.inputSchema,
        },
      ]);
      const result = await gateway.execute('fixture_read', {
        query: `hello; touch ${injectedMarker}`,
        limit: 3,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.output, {
          args: [
            '--mode',
            'read-only',
            '--query',
            `hello; touch ${injectedMarker}`,
            '--limit',
            '3',
          ],
          visible: 'allowed',
        });
      }
      await assert.rejects(readFile(injectedMarker, 'utf8'));
    },
  );
});

test('rejects unknown, missing, and incorrectly typed arguments before launch', async () => {
  await withFixture(
    `require('node:fs').writeFileSync(process.env.MARKER, 'ran');`,
    async ({ executable, sha256, directory }) => {
      const marker = join(directory, 'marker');
      const gateway = new LocalToolGateway(
        manifest(
          fixtureTool(executable, sha256, {
            environment: { literal: { MARKER: marker } },
          }),
        ),
      );
      for (const input of [
        {},
        { query: 3, limit: 2 },
        { query: 'ok', limit: 2, surprise: true },
      ]) {
        const result = await gateway.execute('fixture_read', input);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.failure.code, 'arguments_invalid');
      }
      await assert.rejects(readFile(marker, 'utf8'));
    },
  );
});

test('checks the executable hash immediately before every invocation', async () => {
  await withFixture(
    `process.stdout.write('original');`,
    async ({ executable, sha256 }) => {
      const gateway = new LocalToolGateway(
        manifest(fixtureTool(executable, sha256)),
      );
      await writeFile(
        executable,
        `#!${process.execPath}\nprocess.stdout.write('tampered');\n`,
        'utf8',
      );
      await chmod(executable, 0o755);

      const result = await gateway.execute('fixture_read', {
        query: 'x',
        limit: 1,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.failure.code, 'executable_hash_mismatch');
        assert.equal(result.stdout, '');
        assert.notEqual(result.failure.details?.actualSha256, sha256);
      }
    },
  );
});

test('isolates HOME and XDG state from ambient browser credentials and removes it after success', async () => {
  await withFixture(
    `
      const fs = require('node:fs');
      const path = require('node:path');
      process.stdout.write(JSON.stringify({
        home: process.env.HOME,
        configHome: process.env.XDG_CONFIG_HOME,
        cacheHome: process.env.XDG_CACHE_HOME,
        path: process.env.PATH,
        sentinelVisible: fs.existsSync(path.join(process.env.HOME, 'browser-cookie-sentinel')),
        homeMode: fs.statSync(process.env.HOME).mode & 0o777,
        configMode: fs.statSync(process.env.XDG_CONFIG_HOME).mode & 0o777,
        cacheMode: fs.statSync(process.env.XDG_CACHE_HOME).mode & 0o777
      }));
    `,
    async ({ executable, sha256, directory }) => {
      const realHome = join(directory, 'real-home');
      await mkdir(realHome, { mode: 0o700 });
      await writeFile(join(realHome, 'browser-cookie-sentinel'), 'secret');
      const gateway = new LocalToolGateway(
        manifest(
          fixtureTool(executable, sha256, {
            isolatedHome: true,
            output: 'json',
          }),
        ),
        { hostEnvironment: { HOME: realHome, PATH: '/ambient/bin' } },
      );

      const result = await gateway.execute('fixture_read', {
        query: 'x',
        limit: 1,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        const output = result.output as {
          home: string;
          configHome: string;
          cacheHome: string;
          path?: string;
          sentinelVisible: boolean;
          homeMode: number;
          configMode: number;
          cacheMode: number;
        };
        assert.notEqual(output.home, realHome);
        assert.equal(output.configHome, join(output.home, '.config'));
        assert.equal(output.cacheHome, join(output.home, '.cache'));
        assert.equal(output.path, undefined);
        assert.equal(output.sentinelVisible, false);
        assert.equal(output.homeMode, 0o700);
        assert.equal(output.configMode, 0o700);
        assert.equal(output.cacheMode, 0o700);
        await assert.rejects(access(output.home));
      }
    },
  );
});

test('returns typed timeout and cancellation failures and terminates the child', async () => {
  await withFixture(
    `process.stdout.write(process.env.HOME); setInterval(() => {}, 1000);`,
    async ({ executable, sha256 }) => {
      const timeoutGateway = new LocalToolGateway(
        manifest(
          fixtureTool(executable, sha256, {
            timeoutMs: 500,
            isolatedHome: true,
          }),
        ),
        { killGracePeriodMs: 10 },
      );
      const timedOut = await timeoutGateway.execute('fixture_read', {
        query: 'x',
        limit: 1,
      });
      assert.equal(timedOut.ok, false);
      let timedOutHome = '';
      if (!timedOut.ok) {
        assert.equal(timedOut.failure.code, 'timed_out');
        timedOutHome = timedOut.stdout;
        assert.notEqual(timedOutHome, '');
        await assert.rejects(access(timedOutHome));
      }

      const controller = new AbortController();
      const gateway = new LocalToolGateway(
        manifest(fixtureTool(executable, sha256, { isolatedHome: true })),
        { killGracePeriodMs: 10 },
      );
      const running = gateway.execute(
        'fixture_read',
        { query: 'x', limit: 1 },
        controller.signal,
      );
      setTimeout(() => controller.abort(), 300);
      const cancelled = await running;
      assert.equal(cancelled.ok, false);
      if (!cancelled.ok) {
        assert.equal(cancelled.failure.code, 'cancelled');
        assert.notEqual(cancelled.stdout, '');
        assert.notEqual(cancelled.stdout, timedOutHome);
        await assert.rejects(access(cancelled.stdout));
      }
    },
  );
});

test('enforces a combined output cap and validates declared JSON output', async () => {
  await withFixture(
    `process.stdout.write('x'.repeat(10000));`,
    async ({ executable, sha256 }) => {
      const gateway = new LocalToolGateway(
        manifest(fixtureTool(executable, sha256, { maxOutputBytes: 128 })),
      );
      const result = await gateway.execute('fixture_read', {
        query: 'x',
        limit: 1,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.failure.code, 'output_limit_exceeded');
        assert.ok(Buffer.byteLength(result.stdout) <= 128);
      }
    },
  );
  await withFixture(
    `process.stdout.write('{not-json');`,
    async ({ executable, sha256 }) => {
      const gateway = new LocalToolGateway(
        manifest(fixtureTool(executable, sha256, { output: 'json' })),
      );
      const result = await gateway.execute('fixture_read', {
        query: 'x',
        limit: 1,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, 'output_invalid');
    },
  );
});

test('manifest validation rejects executable ambiguity and undeclared surface area', () => {
  const base = fixtureTool('/tmp/tool', '0'.repeat(64));
  for (const invalid of [
    { schemaVersion: 1, tools: [{ ...base, executable: 'relative/tool' }] },
    { schemaVersion: 1, tools: [{ ...base, sha256: 'latest' }] },
    { schemaVersion: 1, tools: [{ ...base, shell: true }] },
    { schemaVersion: 1, tools: [base, base] },
    {
      schemaVersion: 1,
      tools: [
        {
          ...base,
          isolatedHome: true,
          environment: { inherit: ['HOME'] },
        },
      ],
    },
    {
      schemaVersion: 1,
      tools: [{ ...base, arguments: [{ type: 'input', name: 'undeclared' }] }],
    },
  ]) {
    assert.throws(() => validateManifest(invalid), ManifestValidationError);
  }
});

function fixtureTool(
  executable: string,
  sha256: string,
  overrides: Partial<ToolManifestEntry> = {},
): ToolManifestEntry {
  return {
    name: 'fixture_read',
    description: 'Read fixture data.',
    executable,
    sha256,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query', 'limit'],
      additionalProperties: false,
    },
    arguments: [],
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
    output: 'text',
    ...overrides,
  };
}

function manifest(tool: ToolManifestEntry): LocalToolManifest {
  return validateManifest({ schemaVersion: 1, tools: [tool] });
}

async function withFixture(
  source: string,
  callback: (fixture: {
    directory: string;
    executable: string;
    sha256: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'vorchestra-tool-gateway-'));
  const executable = join(directory, 'fixture-tool');
  const contents = `#!${process.execPath}\n${source}\n`;
  try {
    await writeFile(executable, contents, 'utf8');
    await chmod(executable, 0o755);
    await callback({
      directory,
      executable,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
