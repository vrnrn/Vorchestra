# Vorchestra desktop

Electron host and React canvas for the v0.1 local workflow experience.

## Boundaries

- `src/renderer` edits portable `@vorchestra/engine` workflow definitions. It
  cannot access Node.js, the filesystem, or process APIs.
- `src/preload` exposes the narrow `VorchestraBridge` declared in
  `src/shared/contracts.ts`. Context isolation and Electron sandboxing stay
  enabled.
- `src/main` owns native file dialogs and local execution authority. It
  delegates DAG scheduling and artifact routing to `executeWorkflow` and
  delegates child process behavior to `@vorchestra/node-runner`.
- Saved files contain only the versioned workflow definition. Canvas positions
  live in `workflow.layout`; run snapshots are not persisted.

## Integration assumptions

- A direct executable name requires an explicit environment binding such as
  `PATH: { source: 'host', name: 'PATH' }`. New process blocks include this
  binding and the authority review displays it.
- Only environment names declared by the workflow are resolved from the host.
  Literal environment values are portable and therefore must not contain
  secrets.
- The execution coordinator emits the canonical state/event stream. The desktop
  runtime adapter only projects those events into UI snapshots.
- Workflow file reads are structurally parsed in the Electron main process.
  Semantic validation remains visible in the editor, blocks the Run action, and
  is repeated in the main process before execution authority is granted.

## Commands

```sh
npm run dev --workspace @vorchestra/desktop
npm run build --workspace @vorchestra/desktop
npm run test --workspace @vorchestra/desktop
```
