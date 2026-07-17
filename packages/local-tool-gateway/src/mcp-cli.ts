#!/usr/bin/env node
import { resolve } from 'node:path';

import { LocalToolGateway } from './gateway.js';
import { loadManifest } from './manifest.js';
import { runMcpStdioServer } from './mcp-server.js';

const manifestFlag = process.argv.indexOf('--manifest');
const manifestPath =
  manifestFlag < 0 ? undefined : process.argv[manifestFlag + 1];
if (manifestPath === undefined) {
  process.stderr.write(
    'Usage: vorchestra-local-tool-mcp --manifest /absolute/path/to/manifest.json\n',
  );
  process.exitCode = 2;
} else {
  try {
    const manifest = await loadManifest(resolve(manifestPath));
    await runMcpStdioServer(
      new LocalToolGateway(manifest),
      process.stdin,
      process.stdout,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
