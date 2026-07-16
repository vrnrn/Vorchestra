# Vorchestra

Vorchestra is a local-first desktop application for composing trusted
command-line tools into visual workflows.

v0.3 adds capability-aware Codex, Cline, and Antigravity Agent runtimes,
deterministic instruction templates, and explicit workflow-run Git worktrees.
The accepted v0.2 macOS release remains intentionally unsigned and unnotarized,
with Apple silicon as its packaged target. The product direction and release
boundaries live in [VISION.md](./VISION.md); the current release scope is
recorded in [docs/roadmap/V0_3_TARGETS.md](./docs/roadmap/V0_3_TARGETS.md).

## Repository layout

```text
apps/
  desktop/      Electron main/preload host and React Flow editor
packages/
  engine/       Workflow contracts, validation, scheduling, and execution
  node-runner/  Node child-process authority adapter
examples/
  workflows/    Portable workflow examples
docs/
  architecture/ Technical boundaries
  acceptance/   Versioned product and release acceptance contracts
  roadmap/      Proposed release targets
```

The engine remains usable without the desktop UI. The Electron renderer has no
direct Node, filesystem, or process access.

## Requirements

- macOS 12 or newer for the v0.2 desktop application
- Node.js 22 or newer
- npm 11 or newer

## Getting started

```sh
npm install
npm run verify
npm run dev
```

## User model settings

Vorchestra reads the machine-local model catalog from
`~/.vorchestra/models.json`. The file contains `codex`, `cline`, and `agy`
entries; each entry has a `models` array and an optional `default` that must
match one item in that array. Configured models appear in the Agent model
selector, while **Custom** accepts an exact runtime-owned identifier.

Model identifiers and defaults are user settings, not compiled application
constants. They are never inferred from provider APIs or added to portable
workflow files unless a block explicitly selects a model. When a block has no
explicit model, its tool's machine-local `default` is applied during preflight
and execution.

## Commands

- `npm run build` compiles every workspace.
- `npm run dev` launches the Electron desktop application in development mode.
- `npm run desktop:smoke` builds and exercises the real Electron authority
  review, success, cancellation, typed failure, run-inspection, and post-restart
  history-recovery path in isolated application data.
- `npm run desktop:smoke:packaged` repeats the production smoke against the
  unsigned packaged application for the current Mac architecture.
- `npm run desktop:performance:packaged` runs the packaged 51-node canvas,
  minimap, auto-arrange, and sustained-drag performance acceptance.
- `npm run typecheck` checks strict TypeScript contracts without emitting files.
- `npm test` builds and runs the test suite.
- `npm run format` formats maintained files.
- `npm run verify` runs the complete local quality gate.
- `npm run workflow:check -- <file>` validates a workflow without executing it.
- `npm run workflow:run -- <file> [--inputs <run-inputs.json>]` explicitly
  executes a trusted workflow headlessly through the same engine and Node
  runner. Keep sensitive input files outside the repository.
- `npm run package:mac:dir` creates an unsigned unpacked application for local
  packaged-build verification.
- `npm run package:mac:unsigned` creates unsigned current-host DMG and ZIP
  artifacts for local evaluation only.
- `npm run release:mac` creates and verifies the official unsigned Apple silicon
  artifacts and writes `SHA256SUMS.txt`. See
  [`docs/release/MACOS.md`](./docs/release/MACOS.md).

## Workflow examples

- [`hello-report.vorchestra.json`](./examples/workflows/hello-report.vorchestra.json)
  demonstrates a portable v1 process DAG and migration compatibility.
- [`text-to-file.vorchestra.json`](./examples/workflows/text-to-file.vorchestra.json)
  accepts a manual text input, uses shell-free `tee -a` to append it to a file,
  validates the generated filesystem reference, and passes that path downstream.
  Its non-sensitive example run values are in
  [`text-to-file.example.json`](./examples/inputs/text-to-file.example.json).
- [`codex-file-agent.vorchestra.json`](./examples/workflows/codex-file-agent.vorchestra.json)
  is an opt-in real Codex acceptance workflow. It uses the exact AI Agent
  workspace-write contract, creates a declared report in the current workflow
  directory, and routes that filesystem reference to `wc`. Running it consumes
  Codex account usage and should be done only in a disposable directory with
  [`codex-file-agent.example.json`](./examples/inputs/codex-file-agent.example.json).
- [`multi-runtime-worktree.vorchestra.json`](./examples/workflows/multi-runtime-worktree.vorchestra.json)
  composes Codex, Cline, and Antigravity in one ordered DAG. The agents share an
  explicit run-scoped worktree, exchange visible text handoffs, and expose only
  declared generated files. Running it consumes each runtime's account usage and
  should be done only after reviewing the three local CLI configurations.

## Current boundaries

- Workflows remain directed acyclic graphs in v0.3.
- Artifacts and runtime events are separate models.
- Direct executable invocation is the default; shell execution is explicit.
- The engine does not import UI or provider-specific code.
- Workflow files contain declared environment references, not resolved host
  secret values.
- Local processes run with the current user's ambient operating-system
  permissions; v0.3 is not a general process sandbox.
- Codex, Cline, and Antigravity remain desktop-owned runtime compilers. The
  engine receives only generic process, artifact, template, and runtime-event
  contracts.
- Worktree isolation is explicit. Vorchestra does not automatically commit,
  merge, push, open pull requests, or discard changed worktrees.
- Apple silicon macOS is the accepted v0.2 desktop target. Intel macOS, Windows,
  and Linux releases remain future work.
- v0.2 macOS artifacts are not signed or notarized. Installation requires the
  documented per-application macOS security override.
