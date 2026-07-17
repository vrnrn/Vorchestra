import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseArguments,
  scanSourceRecords,
  validateLock,
} from './audit-third-party-clis.mjs';

const project = {
  id: 'rdt-cli',
  repository: 'https://github.com/public-clis/rdt-cli.git',
  commit: 'a'.repeat(40),
  packageDirectory: 'rdt_cli',
  distribution: 'rdt-cli',
  buildBackend: 'hatchling.build',
};

function record(path, text, mode = '100644') {
  return { path, mode, content: Buffer.from(text) };
}

test('lock validation requires an allowlisted repository and exact SHA', () => {
  assert.doesNotThrow(() =>
    validateLock({ schemaVersion: 1, projects: [project] }),
  );
  assert.throws(
    () =>
      validateLock({
        schemaVersion: 1,
        projects: [{ ...project, repository: 'https://example.test/evil.git' }],
      }),
    /source allowlist/,
  );
  assert.throws(
    () =>
      validateLock({
        schemaVersion: 1,
        projects: [{ ...project, commit: 'main' }],
      }),
    /exact lowercase 40-character SHA/,
  );
});

test('argument parser rejects unknown options', () => {
  assert.deepEqual(parseArguments(['--only', 'rdt-cli']).only, 'rdt-cli');
  assert.throws(() => parseArguments(['--network']), /Unknown argument/);
});

test('source scan accepts a minimal locked hatchling project', () => {
  const result = scanSourceRecords(
    [
      record(
        'pyproject.toml',
        '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
      ),
      record(
        'uv.lock',
        'version = 1\n[[package]]\nname = "demo"\nsource = { registry = "x" }\n',
      ),
      record('rdt_cli/main.py', 'def main():\n    return 0\n'),
    ],
    project,
  );
  assert.deepEqual(result.gateFailures, []);
  assert.equal(result.inventory.length, 3);
});

test('source scan blocks symlinks, build hooks, direct sources, and dynamic execution', () => {
  const result = scanSourceRecords(
    [
      record(
        'pyproject.toml',
        '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n[tool.hatch.build.hooks.custom]\n',
      ),
      record(
        'uv.lock',
        '[[package]]\nname = "evil"\nsource = { git = "https://example.test/repo" }\n',
      ),
      record('link', 'target', '120000'),
      record('rdt_cli/main.py', 'exec("danger")\n'),
    ],
    project,
  );
  const ids = result.gateFailures.map((failure) => failure.id);
  assert.ok(ids.includes('symlink'));
  assert.ok(ids.includes('custom_hatch_build_hook'));
  assert.ok(ids.includes('non_registry_locked_dependency'));
  assert.ok(ids.includes('dynamic_eval'));
});

test('source scan records cookie, subprocess, and mutation terms without silently approving them', () => {
  const result = scanSourceRecords(
    [
      record(
        'pyproject.toml',
        '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
      ),
      record('uv.lock', 'version = 1\n'),
      record(
        'rdt_cli/auth.py',
        "import subprocess\nbrowser_cookie = True\nsubprocess.run(['safe'])\ndef upvote(): pass\n",
      ),
    ],
    project,
  );
  assert.deepEqual(result.gateFailures, []);
  const ids = result.observedRisks.map((risk) => risk.id);
  assert.ok(ids.includes('browser_cookie_access'));
  assert.ok(ids.includes('subprocess'));
  assert.ok(ids.includes('account_mutation_terms'));
});
