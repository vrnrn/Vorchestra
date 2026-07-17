#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCK = join(SCRIPT_DIRECTORY, 'third-party-cli-lock.json');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_REPOSITORIES = new Set([
  'https://github.com/public-clis/rdt-cli.git',
  'https://github.com/public-clis/twitter-cli.git',
]);
const BINARY_EXTENSIONS = new Set([
  '.a',
  '.class',
  '.dll',
  '.dylib',
  '.exe',
  '.jar',
  '.o',
  '.pyc',
  '.so',
  '.wasm',
]);
const CRITICAL_SOURCE_PATTERNS = [
  ['dynamic_eval', /\b(?:eval|exec)\s*\(/g],
  ['os_system', /\bos\.system\s*\(/g],
  ['dynamic_import', /\b__import__\s*\(/g],
  ['unsafe_deserialization', /\b(?:pickle|marshal)\.loads?\s*\(/g],
  [
    'embedded_private_key',
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  ],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
];
const OBSERVED_RISK_PATTERNS = [
  [
    'browser_cookie_access',
    /browser[_-]cookie|cookie_string|reddit_session|auth_token/g,
  ],
  [
    'subprocess',
    /\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\(/g,
  ],
  ['shell_mode', /\bshell\s*=\s*True/g],
  ['network_client', /\b(?:httpx|requests|urllib3?|curl_cffi)\b/g],
  [
    'account_mutation_terms',
    /\b(?:post|reply|comment|vote|upvote|save|subscribe|like|retweet|bookmark|follow|unfollow|delete)\b/g,
  ],
];

export function parseArguments(argv) {
  const parsed = {
    lock: DEFAULT_LOCK,
    outputDirectory: undefined,
    only: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--lock')
      parsed.lock = resolve(requireValue(argv, ++index, argument));
    else if (argument === '--output-dir')
      parsed.outputDirectory = resolve(requireValue(argv, ++index, argument));
    else if (argument === '--only')
      parsed.only = requireValue(argv, ++index, argument);
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--'))
    throw new Error(`${option} requires a value`);
  return value;
}

export function validateLock(lock) {
  if (
    lock?.schemaVersion !== 1 ||
    !Array.isArray(lock.projects) ||
    lock.projects.length === 0
  )
    throw new Error(
      'Lock file must contain schemaVersion 1 and at least one project',
    );
  const ids = new Set();
  for (const project of lock.projects) {
    if (!/^[a-z0-9-]+$/.test(project.id ?? ''))
      throw new Error('Project id is invalid');
    if (ids.has(project.id))
      throw new Error(`Duplicate project id: ${project.id}`);
    ids.add(project.id);
    if (!SAFE_REPOSITORIES.has(project.repository))
      throw new Error(
        `${project.id}: repository is not in the source allowlist`,
      );
    if (!SHA_PATTERN.test(project.commit ?? ''))
      throw new Error(
        `${project.id}: commit must be an exact lowercase 40-character SHA`,
      );
    if (project.buildBackend !== 'hatchling.build')
      throw new Error(`${project.id}: build backend is not allowlisted`);
    if (!/^[A-Za-z0-9_]+$/.test(project.packageDirectory ?? ''))
      throw new Error(`${project.id}: package directory is invalid`);
  }
  return lock;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function commandExists(command, environment) {
  for (const directory of (environment.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)) {
    try {
      await access(join(directory, command));
      return true;
    } catch {
      // Continue through the explicitly inherited PATH without invoking a shell.
    }
  }
  return false;
}

async function run(command, args, options = {}) {
  const {
    cwd,
    environment = process.env,
    allowFailure = false,
    input,
  } = options;
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      const result = {
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (!allowFailure && result.code !== 0) {
        const detail =
          result.stderr.toString('utf8').trim() ||
          result.stdout.toString('utf8').trim();
        rejectPromise(
          new Error(
            `${basename(command)} ${args[0] ?? ''} failed (${result.code}): ${detail}`,
          ),
        );
      } else resolvePromise(result);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function safeEnvironment(homeDirectory) {
  const keep = [
    'PATH',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const environment = {};
  for (const key of keep)
    if (process.env[key]) environment[key] = process.env[key];
  return {
    ...environment,
    HOME: homeDirectory,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    UV_NO_PROGRESS: '1',
  };
}

function textMatches(text, patterns) {
  const findings = [];
  for (const [id, pattern] of patterns) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches?.length) findings.push({ id, count: matches.length });
  }
  return findings;
}

function parsePyproject(text) {
  const backend = text.match(/^build-backend\s*=\s*["']([^"']+)["']/m)?.[1];
  const requires = text.match(/^requires\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
  const buildRequirements = [...requires.matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  return { backend, buildRequirements };
}

export function scanSourceRecords(records, project) {
  const gateFailures = [];
  const observedRisks = [];
  const inventory = [];
  let pyproject;
  let lockfile;

  for (const record of records) {
    const { mode, path, content } = record;
    if (mode === '120000') gateFailures.push({ id: 'symlink', path });
    if (mode === '160000') gateFailures.push({ id: 'submodule', path });
    const extension = path.includes('.')
      ? path.slice(path.lastIndexOf('.')).toLowerCase()
      : '';
    if (
      BINARY_EXTENSIONS.has(extension) ||
      content.subarray(0, 8192).includes(0)
    )
      gateFailures.push({ id: 'tracked_binary', path });
    if (content.length > 2 * 1024 * 1024)
      gateFailures.push({ id: 'oversized_file', path });

    const text = content.toString('utf8');
    if (path === 'pyproject.toml') pyproject = text;
    if (path === 'uv.lock') lockfile = text;
    for (const finding of textMatches(text, CRITICAL_SOURCE_PATTERNS))
      gateFailures.push({ ...finding, path });
    for (const finding of textMatches(text, OBSERVED_RISK_PATTERNS))
      observedRisks.push({ ...finding, path });
    inventory.push({
      path,
      mode,
      size: content.length,
      sha256: sha256(content),
    });
  }

  if (!pyproject) gateFailures.push({ id: 'missing_pyproject' });
  if (!lockfile) gateFailures.push({ id: 'missing_uv_lock' });
  if (records.some((record) => record.path === '.gitmodules'))
    gateFailures.push({ id: 'gitmodules_present' });

  if (pyproject) {
    const parsed = parsePyproject(pyproject);
    if (parsed.backend !== project.buildBackend)
      gateFailures.push({
        id: 'build_backend_mismatch',
        observed: parsed.backend ?? null,
      });
    if (/^\[tool\.hatch\.build\.hooks\./m.test(pyproject))
      gateFailures.push({ id: 'custom_hatch_build_hook' });
    if (
      /^\[tool\.uv\.sources\]/m.test(pyproject) ||
      /(?:https?:|git\+|file:|\.\.\/)/i.test(
        parsed.buildRequirements.join('\n'),
      )
    )
      gateFailures.push({ id: 'non_registry_build_requirement' });
  }
  if (lockfile) {
    for (const dependency of parseLockedPackages(lockfile)) {
      const isOwnEditable =
        dependency.name === project.distribution &&
        dependency.source === 'editable = "."';
      if (
        /^(?:git|url|path|editable)\s*=/.test(dependency.source ?? '') &&
        !isOwnEditable
      )
        gateFailures.push({
          id: 'non_registry_locked_dependency',
          dependency: dependency.name,
          source: dependency.source,
        });
    }
  }

  return { gateFailures, observedRisks, inventory };
}

function parseLockedPackages(lockfile) {
  return lockfile
    .split('[[package]]')
    .slice(1)
    .map((block) => ({
      name: block.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown',
      version: block.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null,
      source: block.match(/^source\s*=\s*\{\s*([^}]+)\}/m)?.[1]?.trim() ?? null,
    }));
}

function parseJunitSummary(xml) {
  const attributes = xml.match(/<testsuite\s+name="pytest"([^>]*)>/)?.[1];
  if (!attributes) throw new Error('Cannot find pytest testsuite summary');
  const value = (name) => {
    const match = attributes.match(new RegExp(`${name}="([^"]+)"`));
    if (!match) throw new Error(`Pytest summary is missing ${name}`);
    return Number(match[1]);
  };
  return {
    tests: value('tests'),
    failures: value('failures'),
    errors: value('errors'),
    skipped: value('skipped'),
    durationSeconds: value('time'),
  };
}

async function trackedRecords(repositoryDirectory, environment) {
  const listing = await run('git', ['ls-files', '-s', '-z'], {
    cwd: repositoryDirectory,
    environment,
  });
  const records = [];
  for (const entry of listing.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)) {
    const match = entry.match(/^(\d+) [0-9a-f]+ \d+\t(.+)$/s);
    if (!match) throw new Error(`Cannot parse tracked-file entry: ${entry}`);
    const path = match[2];
    records.push({
      mode: match[1],
      path,
      content: await readFile(join(repositoryDirectory, path)),
    });
  }
  return records;
}

async function toolVersion(command, args, environment) {
  if (!(await commandExists(command, environment))) return null;
  const result = await run(command, args, { environment, allowFailure: true });
  const output =
    `${result.stdout.toString('utf8')} ${result.stderr.toString('utf8')}`.trim();
  return output.split('\n')[0].slice(0, 240) || `exit ${result.code}`;
}

async function optionalScans(
  project,
  repositoryDirectory,
  reportDirectory,
  environment,
) {
  const scans = [];
  const packagePath = join(repositoryDirectory, project.packageDirectory);
  const definitions = [
    {
      name: 'gitleaks',
      args: [
        'detect',
        '--source',
        repositoryDirectory,
        '--no-git',
        '--report-format',
        'json',
        '--report-path',
        join(reportDirectory, 'gitleaks.json'),
      ],
    },
    {
      name: 'bandit',
      args: [
        '-r',
        packagePath,
        '-f',
        'json',
        '-o',
        join(reportDirectory, 'bandit.json'),
      ],
    },
  ];
  for (const definition of definitions) {
    if (!(await commandExists(definition.name, environment))) {
      scans.push({ name: definition.name, status: 'not_installed' });
      continue;
    }
    const result = await run(definition.name, definition.args, {
      cwd: repositoryDirectory,
      environment,
      allowFailure: true,
    });
    scans.push({
      name: definition.name,
      status: result.code === 0 ? 'passed' : 'failed',
      exitCode: result.code,
    });
  }

  const requirements = join(reportDirectory, 'requirements.txt');
  await run(
    'uv',
    [
      'export',
      '--frozen',
      '--no-dev',
      '--no-emit-project',
      '--output-file',
      requirements,
    ],
    {
      cwd: repositoryDirectory,
      environment,
    },
  );
  if (await commandExists('pip-audit', environment)) {
    const result = await run(
      'pip-audit',
      [
        '-r',
        requirements,
        '--format',
        'json',
        '--output',
        join(reportDirectory, 'pip-audit.json'),
      ],
      { environment, allowFailure: true },
    );
    scans.push({
      name: 'pip-audit',
      status: result.code === 0 ? 'passed' : 'failed',
      exitCode: result.code,
    });
  } else scans.push({ name: 'pip-audit', status: 'not_installed' });
  return scans;
}

async function auditProject(project, rootDirectory, environment) {
  const repositoryDirectory = join(rootDirectory, 'sources', project.id);
  const reportDirectory = join(rootDirectory, 'reports', project.id);
  const wheelDirectory = join(rootDirectory, 'wheels', project.id);
  await mkdir(repositoryDirectory, { recursive: true, mode: 0o700 });
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  await mkdir(wheelDirectory, { recursive: true, mode: 0o700 });

  console.log(`[${project.id}] fetching pinned commit ${project.commit}`);
  await run('git', ['init', '--quiet'], {
    cwd: repositoryDirectory,
    environment,
  });
  await run('git', ['remote', 'add', 'origin', project.repository], {
    cwd: repositoryDirectory,
    environment,
  });
  await run(
    'git',
    [
      '-c',
      'protocol.file.allow=never',
      'fetch',
      '--quiet',
      '--depth=1',
      'origin',
      project.commit,
    ],
    {
      cwd: repositoryDirectory,
      environment,
    },
  );
  await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], {
    cwd: repositoryDirectory,
    environment,
  });
  const resolvedCommit = (
    await run('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDirectory,
      environment,
    })
  ).stdout
    .toString('utf8')
    .trim();
  if (resolvedCommit !== project.commit)
    throw new Error(
      `${project.id}: fetched commit ${resolvedCommit} does not match ${project.commit}`,
    );

  const records = await trackedRecords(repositoryDirectory, environment);
  const sourceScan = scanSourceRecords(records, project);
  const archive = await run('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: repositoryDirectory,
    environment,
  });
  const pyproject =
    records
      .find((record) => record.path === 'pyproject.toml')
      ?.content.toString('utf8') ?? '';
  const lockfile =
    records
      .find((record) => record.path === 'uv.lock')
      ?.content.toString('utf8') ?? '';
  const audit = {
    schemaVersion: 1,
    project: project.id,
    repository: project.repository,
    requestedCommit: project.commit,
    resolvedCommit,
    sourceArchiveSha256: sha256(archive.stdout),
    declaredBuild: parsePyproject(pyproject),
    lockedPackages: parseLockedPackages(lockfile),
    knownAuthorityRisks: project.knownAuthorityRisks,
    sourceScan,
  };
  await writeFile(
    join(reportDirectory, 'source-audit.json'),
    `${JSON.stringify(audit, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  if (sourceScan.gateFailures.length > 0)
    throw new Error(
      `${project.id}: mandatory source scan failed; see source-audit.json`,
    );

  await run('uv', ['lock', '--check', '--offline'], {
    cwd: repositoryDirectory,
    environment,
  });
  const optional = await optionalScans(
    project,
    repositoryDirectory,
    reportDirectory,
    environment,
  );
  await writeFile(
    join(reportDirectory, 'optional-scans.json'),
    `${JSON.stringify(optional, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  if (optional.some((scan) => scan.status === 'failed'))
    throw new Error(
      `${project.id}: an installed optional security scanner failed`,
    );

  console.log(`[${project.id}] scan gates passed; building pinned source`);
  await run('uv', ['build', '--wheel', '--out-dir', wheelDirectory], {
    cwd: repositoryDirectory,
    environment,
  });
  const syncArguments = ['sync', '--frozen'];
  if (/^\[project\.optional-dependencies\][\s\S]*?^dev\s*=/m.test(pyproject))
    syncArguments.push('--extra', 'dev');
  await run('uv', syncArguments, {
    cwd: repositoryDirectory,
    environment,
  });

  const sandboxExec = await commandExists('sandbox-exec', environment);
  if (!sandboxExec)
    throw new Error(
      `${project.id}: sandbox-exec is required to prove denied-network tests on macOS`,
    );
  const testArgs = [
    '-p',
    '(version 1) (allow default) (deny network*)',
    'uv',
    'run',
    '--offline',
    '--frozen',
    'pytest',
    '-m',
    'not smoke',
    '--disable-warnings',
    '--junitxml',
    join(reportDirectory, 'pytest.xml'),
  ];
  console.log(
    `[${project.id}] running non-smoke tests with OS-level network denial`,
  );
  const tests = await run('sandbox-exec', testArgs, {
    cwd: repositoryDirectory,
    environment,
    allowFailure: true,
  });
  await writeFile(join(reportDirectory, 'pytest.stdout.txt'), tests.stdout, {
    mode: 0o600,
  });
  await writeFile(join(reportDirectory, 'pytest.stderr.txt'), tests.stderr, {
    mode: 0o600,
  });
  if (tests.code !== 0)
    throw new Error(`${project.id}: denied-network unit tests failed`);
  const testSummary = parseJunitSummary(
    await readFile(join(reportDirectory, 'pytest.xml'), 'utf8'),
  );

  const wheels = [];
  for (const name of await readdir(wheelDirectory)) {
    if (!name.endsWith('.whl')) continue;
    const path = join(wheelDirectory, name);
    const content = await readFile(path);
    wheels.push({
      filename: name,
      size: (await stat(path)).size,
      sha256: sha256(content),
    });
  }
  if (wheels.length !== 1)
    throw new Error(
      `${project.id}: expected exactly one wheel, found ${wheels.length}`,
    );
  return {
    id: project.id,
    repository: project.repository,
    commit: resolvedCommit,
    sourceArchiveSha256: audit.sourceArchiveSha256,
    inventory: sourceScan.inventory,
    lockedPackages: audit.lockedPackages,
    knownAuthorityRisks: project.knownAuthorityRisks,
    optionalScans: optional,
    tests: {
      selector: "pytest -m 'not smoke'",
      networkIsolation: 'macOS sandbox-exec deny network*',
      exitCode: tests.code,
      ...testSummary,
    },
    wheels,
  };
}

function usage() {
  return `Usage: node scripts/security/audit-third-party-clis.mjs [options]

Options:
  --lock PATH        Pinned source lock (default: adjacent lock file)
  --output-dir PATH  Empty/new report root (default: mktemp under /tmp)
  --only ID          Audit only one locked project
  --help             Show this help

The command never authenticates or invokes either built CLI. Smoke/live tests
are excluded, and unit tests run with operating-system network denial.`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const lock = validateLock(JSON.parse(await readFile(options.lock, 'utf8')));
  const projects = options.only
    ? lock.projects.filter((project) => project.id === options.only)
    : lock.projects;
  if (projects.length === 0)
    throw new Error(`Unknown locked project: ${options.only}`);

  const rootDirectory = options.outputDirectory
    ? options.outputDirectory
    : await mkdtemp(join(tmpdir(), 'vorchestra-third-party-audit-'));
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const privateHome = join(rootDirectory, '.audit-home');
  await mkdir(privateHome, { recursive: true, mode: 0o700 });
  const environment = safeEnvironment(privateHome);
  if (!(await commandExists('git', environment)))
    throw new Error('git is required');
  if (!(await commandExists('uv', environment)))
    throw new Error('uv is required');

  const startedAt = new Date().toISOString();
  const toolVersions = {
    git: await toolVersion('git', ['--version'], environment),
    uv: await toolVersion('uv', ['--version'], environment),
    python: await toolVersion('python3', ['--version'], environment),
    sandboxExec: await toolVersion('sandbox-exec', ['-h'], environment),
    gitleaks: await toolVersion('gitleaks', ['version'], environment),
    bandit: await toolVersion('bandit', ['--version'], environment),
    pipAudit: await toolVersion('pip-audit', ['--version'], environment),
  };
  const results = [];
  for (const project of projects)
    results.push(await auditProject(project, rootDirectory, environment));
  const manifest = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    toolVersions,
    projects: results,
    guarantees: {
      authenticated: false,
      builtCliInvoked: false,
      smokeOrLiveTestsRun: false,
      unitTestNetworkAllowed: false,
    },
  };
  const manifestPath = join(rootDirectory, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(manifestPath, 0o600);
  console.log(`Audit complete: ${manifestPath}`);
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`Audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
