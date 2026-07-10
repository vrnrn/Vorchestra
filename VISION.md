# Vorchestra

> **A visual operating system for local automation.**

## Status and purpose

- **Status:** Living product vision
- **Last updated:** 2026-07-09
- **Current horizon:** v0.1 implemented for macOS

This document is Vorchestra's durable product compass. It records the problem we
are solving, the product boundaries, and the decisions that should guide design
and implementation.

It is intentionally not a detailed technical specification or roadmap. Those
documents may change more frequently. When a proposed feature or architecture
conflicts with this vision, the conflict must be resolved here rather than left
implicit.

## Product statement

Vorchestra is a local-first desktop application that lets solo developers
compose trusted command-line tools into reusable visual workflows.

A Vorchestra workflow is a graph of local processes. Processes receive
artifacts, perform work, and produce artifacts for downstream processes. The
canvas makes that execution visible, inspectable, and repeatable.

AI tools such as Claude Code, Codex CLI, and Gemini CLI are important examples,
but AI is not the platform. Python, Git, FFmpeg, Docker, Make, and custom
executables belong to the same system.

## Target user and problem

### Primary user

Vorchestra v0.1 is for a solo developer who already uses local command-line
tools and wants to combine them without writing and maintaining a bespoke
orchestration script for every task.

The initial user is comfortable with executables, arguments, environment
variables, and filesystem paths. Vorchestra should make orchestration clearer
and faster without pretending that local processes are risk-free.

### Problem

Useful local automations are often trapped in shell history, one-off scripts, or
tool-specific interfaces. Their dependencies are difficult to see, intermediate
results are awkward to inspect, and failures require reconstructing what ran.

Existing workflow products commonly start from cloud services, provider-specific
integrations, or proprietary plugin catalogs. That is the wrong center of
gravity for a developer whose tools, credentials, source files, and compute
already live on their computer.

Vorchestra gives those tools a shared visual execution model while leaving each
tool responsible for its own installation, authentication, and behavior.

## Product thesis

### Processes, not providers

The engine orchestrates executable processes rather than integrations tied to a
specific vendor or product category.

Every process participates in the same runtime contract: declared inputs start a
process, the process runs with explicit configuration, and its outputs and
runtime events are captured. This does not require every tool to have an
identical editor. Specialized block interfaces may improve configuration later,
provided they compile to the generic process contract.

### The operating system is the integration layer

If a tool is installed locally and can be invoked as a process, Vorchestra
should be able to orchestrate it. Vorchestra will not create a separate plugin
marketplace for v0.1.

The operating system does not remove Vorchestra's responsibilities. Vorchestra
must make the executable, arguments, working directory, environment access, and
missing-tool failures understandable. Installation, authentication, and tool
versioning remain the responsibility of the invoked tool and the user.

### Visual where it improves understanding

The canvas is the primary interface because graphs are useful for seeing
dependencies, parallel branches, and intermediate results. Vorchestra is not
trying to replace the terminal. Raw commands, outputs, and errors remain visible
when precision matters.

### Local first

Execution and workflow storage happen on the user's computer. v0.1 requires no
Vorchestra account or cloud service and remains usable offline, subject to the
requirements of the tools a workflow invokes.

Cloud execution, synchronization, and collaboration may be considered later, but
they must not become prerequisites for local workflows.

## Guiding principles

When trade-offs arise, prefer the option that best preserves these principles:

1. **Processes, not providers.** Keep the engine independent of any AI or SaaS
   ecosystem.
2. **Local capability is real capability.** Preserve native filesystem and CLI
   access rather than forcing local tools through remote abstractions.
3. **Visible authority.** Show what will run and what local context it can use.
4. **Artifacts carry data; runtime events explain execution.** Do not overload
   one model with both responsibilities.
5. **Portable definitions, local bindings.** Workflow structure should be
   shareable even when executable locations, secrets, and files are
   machine-local.
6. **The engine is UI-independent.** The canvas consumes the engine; it does not
   define execution semantics.
7. **Prefer operating-system conventions.** Use stdin, stdout, stderr, exit
   codes, arguments, environment variables, and paths when they fit.
8. **Make failures actionable.** A failed or missing process is an inspectable
   result, not a generic broken state.
9. **Earn complexity.** Defer infrastructure that does not prove the core
   product.
10. **Simplicity beats cleverness.** A small predictable contract is more
    valuable than a broad magical one.

## Core conceptual model

### Workflow

A workflow is a portable, versioned definition containing blocks, connections,
configuration, and canvas layout. In v0.1, its executable topology is a directed
acyclic graph (DAG).

The editor must reject cycles before execution. Loops, feedback edges, and
long-running reactive graphs require separate iteration and termination
semantics and are not part of v0.1.

### Block

A block is the smallest executable unit. The only executable block required in
v0.1 is a generic process block.

A process block declares:

- A stable ID and display name
- An executable and argument array
- A working directory
- Explicit environment configuration
- Input and output ports
- How inputs are delivered and outputs are interpreted

An executable plus an argument array is the default invocation model. Shell
evaluation is an explicit mode because quoting, expansion, pipes, redirects, and
arbitrary shell expressions materially change the trust boundary.

### Port and connection

A port is a declared location where a block receives or emits an artifact. A
connection is a directed edge from an output port to a compatible input port.

For v0.1, a block becomes runnable after every required input has arrived.
Independent runnable blocks may execute in parallel. A downstream block does not
run when a required upstream dependency fails or is cancelled; the UI must show
why it was skipped.

### Artifact

Artifacts are the data plane of a workflow. v0.1 has three artifact kinds:

- **Text:** UTF-8 text, commonly delivered through stdin or captured from
  stdout.
- **JSON:** Valid JSON whose structure is preserved and inspectable.
- **Filesystem reference:** An explicit local path referring to a file or
  directory. Vorchestra passes the reference; it does not copy or own the
  referenced content.

Filesystem references make file-oriented tools useful without treating arbitrary
binary data as inline workflow state. A path remains machine-local and may be
missing, inaccessible, or changed between runs; those conditions must be
reported clearly.

### Runtime event

Runtime events are the control and diagnostic plane, not artifacts. They
include:

- Queued, running, succeeded, failed, skipped, and cancelled states
- Start and end times
- Standard error
- Exit code or launch failure
- Cancellation requests and outcomes
- Input and output provenance for the current run

Runtime events are inspectable for each block and execution. They are not routed
through normal artifact connections unless a future feature explicitly converts
one into data.

### Execution

An execution is one manual run of a validated workflow and receives a unique run
ID. The scheduler starts runnable blocks, permits independent branches to run in
parallel, routes successful outputs, and completes after all blocks reach a
terminal state.

Cancellation is part of the v0.1 contract. A user can cancel an execution;
Vorchestra attempts to terminate its active child processes, prevents new blocks
from starting, and records the resulting states without reporting cancellation
as success.

## v0.1 experience and scope

The v0.1 experience should be immediate:

1. Create a workflow on a canvas.
2. Add and configure generic process blocks.
3. Connect compatible ports.
4. Validate the workflow and see actionable configuration errors.
5. Review the processes and local context that will be used.
6. Press Run.
7. Watch block states update while independent branches execute.
8. Inspect each block's inputs, artifacts, stdout, stderr, exit code, and
   timing.
9. Cancel a running execution when needed.
10. Save the workflow, reload it, and run it again.

v0.1 includes:

- A local macOS desktop application
- A drag-and-drop workflow canvas
- Generic process blocks
- DAG validation and dependency-driven scheduling
- Text, JSON, and filesystem-reference artifacts
- Manual execution
- Parallel execution of independent branches
- Live block and execution state
- Execution cancellation
- Per-block input, output, and failure inspection
- Local save and load using a versioned workflow format

## Safety and trust boundaries

Vorchestra workflows are executable code. A visual representation does not make
a command safe.

v0.1 is designed for trusted workflows with guardrails, not hostile workflow
isolation:

- The executable, arguments, working directory, input bindings, and configured
  environment access must be inspectable before a run.
- Direct process execution is the default. Shell evaluation must be visibly and
  explicitly enabled for a block.
- Workflows do not silently embed the user's full environment. Environment
  values are declared or deliberately inherited.
- Secret values are referenced from local environment configuration and are not
  stored in workflow files by default.
- Outputs and diagnostics must avoid presenting secret values as safe to share.
  Automatic redaction is not guaranteed in v0.1, so the UI must communicate that
  process output may contain sensitive data.
- Filesystem references confer no additional protection. Invoked processes run
  with the user's ambient operating-system permissions.
- Importing a workflow from another person must be treated like receiving a
  script: inspect it before running it.

Full process sandboxing and fine-grained filesystem or network grants are
valuable future directions, but they are not promised by v0.1. The product must
state this limitation plainly rather than imply that local-first means safe by
default.

## Architectural constraints

These constraints protect the product thesis without prescribing every internal
implementation detail:

- The orchestration engine has no dependency on the visual editor.
- The workflow format is versioned, locally stored, and readable without the
  canvas implementation.
- Scheduling, dependency resolution, process launching, artifact routing, and
  runtime events have explicit boundaries.
- Tool-specific interfaces may compile to the generic process contract; they may
  not introduce provider-specific behavior into the scheduler.
- Runtime failures are typed and actionable, including missing executables,
  invalid working directories, malformed JSON, inaccessible filesystem
  references, non-zero exits, and cancellation.
- Machine-local bindings such as secret values are kept separate from the
  portable workflow definition by default.

The current provisional implementation direction is React, TypeScript, React
Flow, Tailwind CSS, and shadcn/ui for the desktop interface, with a standalone
TypeScript engine package. These are implementation hypotheses, not product
principles, and may change after technical validation.

## Non-goals for v0.1

The following are explicitly deferred:

- Scheduled, file-event, webhook, or remote triggers
- Cyclic graphs, loops, feedback edges, and streaming graphs
- Automatic retries and configurable failure recovery policies
- Cloud or distributed execution
- Cloud synchronization
- Multi-user collaboration
- Vorchestra accounts or authentication
- A Vorchestra plugin marketplace
- Specialized AI, Git, Docker, HTTP, MCP, or filesystem block types
- Full process sandboxing or granular capability grants
- Managed installation, authentication, or versioning of invoked tools
- A general-purpose observability platform
- Packaged Windows or Linux desktop releases

Deferral does not mean rejection. It means these capabilities must not expand
the first product before the generic local process workflow is demonstrably
useful.

## Definition of success for v0.1

v0.1 succeeds when a solo developer can build, run, understand, and reuse a
meaningful local workflow without editing its serialized definition by hand.

Specifically, a user can:

1. Create and visually edit a workflow with multiple generic process blocks.
2. Connect those blocks into a valid DAG and receive a clear error for a cycle
   or invalid configuration.
3. Pass text, JSON, and filesystem references between compatible blocks.
4. Run the workflow manually, with independent branches executing in parallel.
5. See live queued, running, succeeded, failed, skipped, and cancelled states.
6. Inspect every block's resolved inputs, produced artifacts, stdout, stderr,
   timing, and exit or launch result.
7. Cancel an active execution and understand which work stopped or was skipped.
8. Diagnose a missing executable, inaccessible path, malformed JSON output, or
   non-zero process exit from the information Vorchestra provides.
9. Save the versioned workflow locally, reload it, and reproduce its structure
   and configuration without storing secret values in the file by default.
10. Complete at least one useful multi-process workflow involving an existing
    local CLI tool, rather than a Vorchestra-specific integration.

Smooth completion of these outcomes matters more than the number of block types
or integrations available.

## Decision log

Decisions remain in this log even if superseded. A replacement decision must
cite the decision it changes.

| ID      | Date       | Decision                                                                                     | Rationale                                                                                                                                               |
| ------- | ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VOR-001 | 2026-07-09 | Target solo developers as the primary v0.1 user.                                             | A narrow initial audience gives product and usability decisions a concrete center.                                                                      |
| VOR-002 | 2026-07-09 | Ship v0.1 as a local desktop application.                                                    | The editor and local process engine need a coherent experience with direct operating-system access.                                                     |
| VOR-003 | 2026-07-09 | Use a trusted-with-guardrails execution model.                                               | Arbitrary local execution must be visible and explicit, while full sandboxing would overwhelm the first product.                                        |
| VOR-004 | 2026-07-09 | Support text, JSON, and filesystem references as v0.1 artifacts.                             | File-oriented CLIs must be useful without storing binary content inside workflow state.                                                                 |
| VOR-005 | 2026-07-09 | Restrict v0.1 workflows to validated DAGs.                                                   | Cycles require iteration, buffering, termination, and deadlock semantics that are outside the MVP.                                                      |
| VOR-006 | 2026-07-09 | Separate artifacts from runtime events.                                                      | Workflow data should not be conflated with failures, status, cancellation, or diagnostics.                                                              |
| VOR-007 | 2026-07-09 | Make direct executable-and-argument invocation the default and shell evaluation explicit.    | This preserves predictable process boundaries and makes additional shell authority visible.                                                             |
| VOR-008 | 2026-07-09 | Keep the execution engine independent of the UI and provider-specific concepts.              | Alternative interfaces and future specialized editors must share one predictable runtime.                                                               |
| VOR-009 | 2026-07-09 | Use Electron as the v0.1 desktop runtime with context isolation and a narrow preload bridge. | Electron keeps the first vertical slice in TypeScript and provides local process and filesystem APIs without coupling them to renderer code.            |
| VOR-010 | 2026-07-09 | Accept and distribute the v0.1 desktop release for macOS first.                              | The current environment can prove macOS process-tree cancellation and desktop behavior; other packaged platforms require their own acceptance evidence. |

## Open questions

These questions concern post-v0.1 direction or implementation validation. They
do not block the v0.1 product contract above.

- What is the smallest useful sandboxing or capability-grant model after v0.1?
- Should execution history persist across application restarts, and what
  retention policy should it use?
- How should portable workflows declare tool-version expectations without making
  Vorchestra a package manager?
- Which trigger type should be introduced first after manual execution?
- When specialized block editors arrive, how will their compiled generic process
  representation remain visible and debuggable?
- What explicit iteration model, if any, should eventually permit cycles?
- Which artifact kinds should follow filesystem references: managed files,
  streams, binary blobs, or structured datasets?

## Update policy

This is a living document, but it should not drift silently.

- Update the relevant section whenever a product decision changes the target
  user, product thesis, trust boundary, v0.1 scope, or architectural
  constraints.
- Add a dated decision-log entry for every material choice. Superseding entries
  reference the earlier decision rather than deleting it.
- Keep unresolved future choices in **Open questions**. Do not use that section
  to avoid decisions required by the current release.
- Move implementation detail into dedicated specifications when it no longer
  helps decide what Vorchestra is.
- Review this document at each release boundary and update its status and
  horizon.
