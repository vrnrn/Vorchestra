# Vorchestra

Vorchestra is a local-first desktop application for composing trusted
command-line tools into visual workflows.

The v0.1 vertical slice is implemented for macOS. The product direction and
release boundaries live in [VISION.md](./VISION.md).

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
  acceptance/   v0.1 contract and rendered evidence
```

The engine remains usable without the desktop UI. The Electron renderer has no
direct Node, filesystem, or process access.

## Requirements

- macOS for the v0.1 desktop application
- Node.js 22 or newer
- npm 11 or newer

## Getting started

```sh
npm install
npm run verify
npm run dev
```

## Commands

- `npm run build` compiles every workspace.
- `npm run dev` launches the Electron desktop application in development mode.
- `npm run desktop:smoke` builds and exercises the real Electron authority
  review, success, cancellation, typed failure, and run-inspection path.
- `npm run typecheck` checks strict TypeScript contracts without emitting files.
- `npm test` builds and runs the test suite.
- `npm run format` formats maintained files.
- `npm run verify` runs the complete local quality gate.
- `npm run workflow:check -- <file>` validates a workflow without executing it.
- `npm run workflow:run -- <file>` explicitly executes a trusted workflow
  headlessly through the same engine and Node runner.

## Current boundaries

- v0.1 workflows are directed acyclic graphs.
- Artifacts and runtime events are separate models.
- Direct executable invocation is the default; shell execution is explicit.
- The engine does not import UI or provider-specific code.
- Workflow files contain declared environment references, not resolved host
  secret values.
- Local processes run with the current user's ambient operating-system
  permissions; v0.1 is not a sandbox.
- macOS is the accepted v0.1 desktop target. Packaged Windows and Linux releases
  remain future work.
