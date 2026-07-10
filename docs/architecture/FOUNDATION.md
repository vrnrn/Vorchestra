# Foundation architecture

## Purpose

This document describes the initial code boundaries that protect Vorchestra's
product vision. It is narrower than `VISION.md` and should evolve as executable
adapters and the desktop application are introduced.

## Dependency direction

```text
Electron desktop application
        |
        v
Runtime adapters (future)
        |
        v
@vorchestra/engine
```

`@vorchestra/engine` has no dependency on a UI framework, desktop runtime, or
provider SDK. It contains:

- The versioned workflow definition schema
- Artifact and runtime-event contracts
- Semantic workflow validation
- Deterministic execution planning
- The interface a local process runner must implement

## Data plane and control plane

Artifacts form the data plane. Text, JSON, and filesystem references can move
through workflow connections.

Runtime events form the control and diagnostic plane. States, failures, stderr,
timing, and cancellation are recorded for inspection but are not implicitly
routed as artifacts.

Keeping the models separate prevents failure behavior from becoming accidental
graph dataflow.

## Validation boundary

Workflow loading has two distinct checks:

1. Structural parsing verifies the versioned serialized shape.
2. Semantic validation verifies identifiers, port references, artifact
   compatibility, required inputs, and DAG topology.

Only a structurally and semantically valid workflow may be planned for
execution. Planning is deterministic and does not launch processes.

## Authority boundary

The engine defines a process-runner interface but does not currently implement
local process execution. The future adapter must receive a fully resolved
request and an abort signal. It must not infer hidden shell behavior or
environment authority.

This boundary gives the desktop layer a place to preview authority and collect
consent before process creation.

## Deliberately unresolved

- Persistence and execution-history storage
- Process-tree termination details by operating system
- Sandboxing beyond the trusted-with-guardrails v0.1 model
- UI state management and canvas implementation

These choices should be validated without changing the engine's public concepts.

## Desktop runtime decision

Electron is the v0.1 desktop runtime. The renderer runs with Node integration
disabled and context isolation enabled. A narrow preload bridge exposes only
typed workflow-file and execution operations; arbitrary Electron IPC is never
made available to renderer code.
