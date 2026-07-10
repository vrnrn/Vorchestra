# v0.2 targets

## Status

- **Status:** Complete
- **Created:** 2026-07-09
- **Theme:** From runnable workflows to confidently reusable workflows
- **Product boundary:** The constraints and trust model in `VISION.md` remain
  authoritative.

This document turns the v0.1 implementation and its first usability lessons into
a bounded target list for v0.2. It describes outcomes, not a commitment to
specific UI components or storage technologies.

## Baseline

v0.1 proved the core system: a solo developer can visually compose generic local
processes into a validated DAG, route text, JSON, and filesystem references,
inspect live execution, cancel work, and save or load a portable workflow.

The next release should deepen that workflow rather than broaden Vorchestra into
a provider catalog or cloud automation service. Recent usage exposed three
especially important gaps:

- The relationship between ports, argument order, stdin, and the executed
  command must be easier to understand.
- Declaring an output artifact does not cause a process to produce it; file
  paths and output responsibility need clearer presentation.
- A useful workflow needs stronger editing, preflight, recovery, and debugging
  support before scheduling or a catalog of specialized blocks adds more
  complexity.
- A single AI Agent block with Codex as its first Agent runtime can prove that a
  specialized editor improves real tools while the engine and saved execution
  contract remain generic.

## Release targets

### V02-T01 — Exact invocation preview

Make the process that will run understandable while the block is being edited,
not only in the final authority review.

- Show the resolved argument order, including the position of input bindings.
- Distinguish direct executable-and-argument invocation from shell evaluation.
- Show stdin and environment input bindings beside the command preview.
- Make shell-only syntax such as pipes and redirects recognizable before a run.
- Keep values that may contain secrets masked by default while leaving their
  source and authority visible.

**Acceptance:** A user can look at a configured block and correctly state what
executable receives each argument, what arrives through stdin, and whether a
shell will interpret any part of the invocation.

### V02-T02 — First-class filesystem workflow UX

Make file-producing and file-consuming process blocks predictable without
pretending that an output declaration performs the write.

- Label filesystem outputs as references that the command must produce or make
  available.
- Show the resolved absolute path before execution.
- Provide native file and directory selection where a local path is expected.
- Clearly distinguish working directory, input path, command output path, and
  workflow-file location.
- Offer actionable guidance when a command succeeds but its declared filesystem
  output is absent, inaccessible, or the wrong entity type.
- Include at least one generic, shell-free example using stdin and `tee` to
  create or append to a file.

**Acceptance:** A user can route text into a block that creates a file, expose
that file as a filesystem-reference artifact, locate it on disk, and pass it to
a downstream block without guessing how paths resolve.

### V02-T03 — Non-executing preflight

Add a preflight phase that checks local requirements without launching the
workflow's tools.

- Resolve each direct executable through its declared environment.
- Verify working directories and required host-environment references.
- Resolve filesystem paths and identify obvious permission or existence problems
  where they can be checked safely.
- Report missing port bindings and incompatible artifacts using the same typed
  issue model as workflow validation.
- Separate blockers from warnings, including explicit warnings for shell mode
  and potentially destructive output paths.

**Acceptance:** Common failures such as a missing executable, missing host
variable, invalid working directory, or unresolved output path are visible
before the user grants execution authority.

### V02-T04 — Workflow parameters and run inputs

Allow one saved workflow to be reused with different manually supplied inputs.

- Declare workflow-level text, JSON, and filesystem-reference inputs.
- Prompt for those values when a manual run begins.
- Validate parameter kinds before process execution.
- Keep machine-local paths and secret-like values out of the portable workflow
  unless the user explicitly stores a literal.
- Display run inputs in execution inspection with clear provenance.

**Acceptance:** A user can save one workflow, run it twice with different input
values, and confirm that its graph and process configuration did not need to be
edited between runs.

### V02-T05 — Durable local run history

Persist enough execution history to diagnose and compare runs after an
application restart.

- Store run identity, workflow identity, timestamps, block states, typed
  failures, exit results, and artifact metadata locally.
- Restore per-block inspection for retained runs.
- Define a bounded retention policy and provide an explicit clear-history
  action.
- Treat captured stdout, stderr, inline artifacts, and paths as potentially
  sensitive local data.
- Keep history out of portable workflow files.

**Acceptance:** After restarting Vorchestra, a user can open a workflow, inspect
its latest retained run, identify the failed block, and clear the retained data.

### V02-T06 — Editing confidence and recovery

Make workflow construction forgiving enough for regular use.

- Add undo and redo for graph and configuration edits.
- Add duplicate, copy, and paste for process blocks without reusing stable IDs.
- Preserve connection, port, argument, and environment ordering through edits
  and save/load cycles.
- Recover an unsaved draft after an application crash or accidental close.
- Add a deliberate fit or auto-arrange action without moving nodes unexpectedly
  during ordinary editing.
- Maintain stable node rendering and minimap state during sustained dragging and
  larger workflows.

**Acceptance:** A user can make, reverse, duplicate, recover, and reorganize
common edits without hand-editing JSON or reopening the last saved file.

### V02-T07 — Faster debugging and reruns

Shorten the loop from a typed failure to a corrected successful run.

- Navigate directly from a validation, preflight, or runtime issue to the
  responsible block and field.
- Copy stdout, stderr, resolved paths, and actionable failure details.
- Reveal filesystem-reference artifacts in Finder.
- Rerun the complete workflow with the same or revised manual inputs.
- Preserve failed-run evidence until the user deliberately starts or selects
  another run.

Per-block or downstream-only reruns are not required until artifact replay and
staleness semantics are explicitly defined.

**Acceptance:** A user can diagnose a failed local process, correct its
configuration, and rerun the workflow without losing the evidence that explained
the failure.

### V02-T08 — AI Agent block

Add one user-facing AI Agent block with an `Agent runtime` selector while
preserving "processes, not providers" in the engine. Codex is the only
selectable Agent runtime required for v0.2.

- Present stable agent fields for Agent runtime, instruction, optional text
  context through stdin, current working directory, authority level, text
  response output, and optional declared filesystem-reference outputs.
- Put the Agent runtime selector in the primary block configuration from the
  first release, even while `Codex` is its only option, so the workflow records
  the user's agent intent explicitly.
- Compile each Agent runtime configuration in the desktop layer to an ordinary
  generic process block. Do not add AI-agent, Agent runtime, or provider
  concepts to engine validation, scheduling, artifact routing, or execution.
- Treat the compiled executable, arguments, environment, stdin, outputs, and
  working directory as the authoritative runtime representation and keep them
  visible in configuration and run review.
- Pass the instruction exactly as one visible CLI argument. Do not compose it
  with connected context or add hidden instructions.
- Keep optional connected text context as a separate stdin binding.
- Run directly in the block's resolved current working directory. A blank
  override uses the application working directory; v0.2 does not create or
  manage Git worktrees.
- Allow the block to declare file or directory paths that the Agent runtime is
  expected to create or update. After a successful run, expose existing declared
  paths as filesystem-reference artifacts using the same validation rules as a
  generic process block.
- Preserve generic agent fields when changing Agent runtimes and require an
  explicit review of runtime-specific settings that cannot carry across
  compilers.
- Store only runtime-neutral editor metadata needed to restore the AI Agent UI
  and selected Agent runtime; do not infer runtime identity from an executable
  name.
- Do not mutate instructions, inject hidden prompts, or hide runtime-specific
  authority behind the generic editor.

The first Agent runtime compiler targets the locally installed `codex exec` CLI:

- Default to an ephemeral run, `read-only` sandbox, disabled color output, and a
  text response captured from stdout.
- Permit `workspace-write` only through an explicit visible choice. Do not
  generate approval-bypass, sandbox-bypass, or hook-trust-bypass flags.
- In `workspace-write` mode, allow Codex to create or update files inside the
  resolved current working directory. This is a required v0.2 capability, not a
  future worktree feature.
- Keep generated-file responsibility explicit: selecting a filesystem output
  does not create it, and a successful Codex exit with a missing declared path
  produces the normal actionable output-interpretation failure.
- Keep Codex progress on stderr as runtime diagnostics rather than routing it as
  a normal artifact.
- Reuse the user's existing local Codex authentication and configuration.
  Vorchestra does not store API keys, copy authentication files, or manage the
  user's OpenAI account.
- Preflight the `codex` executable. Translate authentication failures returned
  by the CLI into actionable typed failures without inspecting local
  authentication files.
- Use the user's existing Codex model configuration. A per-block model override
  is deferred beyond v0.2.
- Defer session resume and Codex JSONL event translation until Vorchestra has
  explicit replay and streaming-event semantics.

The supported invocation surface is grounded in the official
[Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
contract: `codex exec` accepts piped context, emits its final message on stdout,
uses stderr for progress, supports ephemeral execution, and exposes explicit
sandbox modes.

**Acceptance:** A user can add an AI Agent block, select the Codex Agent
runtime, see its instruction as one exact CLI argument, connect separate
upstream text as stdin context, and run it in the resolved current working
directory. The user can review its exact compiled read-only authority or
deliberately select `workspace-write`, execute without shell evaluation, route
the final response as a text artifact, create a declared file, and route that
path downstream as a filesystem-reference artifact. Automated tests use a fake
process runner and never invoke the user's real Codex CLI.

### V02-T09 — Distributable macOS release quality

Turn the accepted development build into a release another macOS user can
install and evaluate.

- Produce versioned, intentionally unsigned Apple silicon DMG and ZIP artifacts
  with a SHA-256 checksum manifest.
- State clearly that Apple has not verified the developer identity or reviewed
  the application for malware, and document macOS's per-application manual-open
  path without disabling system-wide security controls.
- Document installation, local execution authority, workflow trust, and
  uninstallation.
- Preserve the context-isolated preload boundary in packaged builds.
- Add workflow-format migration tests before introducing any schema change.
- Define a performance acceptance fixture for a representative multi-block DAG.
- Complete keyboard and screen-reader checks for the primary editor and run
  controls.

**Acceptance:** The Apple silicon DMG and ZIP pass automated integrity and
packaged-runtime checks on supported hardware; an existing v1 workflow migrates;
the representative DAG meets the performance thresholds; and the primary editor
and run controls pass packaged keyboard and screen-reader checks. Installation,
the expected unsigned-app warning, the per-application macOS override, and
removal are documented user procedures, not clean-account acceptance gates.

## v0.2 success scenario

v0.2 is successful when a solo developer can:

1. Install the packaged macOS application.
2. Open or create a reusable parameterized workflow with generic process blocks
   and one AI Agent block using the Codex Agent runtime.
3. Understand the exact direct or shell invocation of every block before
   execution.
4. Pass a manual text or filesystem input into the workflow.
5. Preflight local executables, environment references, working directories, and
   output paths without running the tools.
6. Run the workflow and create a real file through an explicit process action.
7. Inspect and reveal the resulting filesystem-reference artifact.
8. Pass upstream text into the AI Agent block, review the Codex Agent runtime's
   exact instruction and sandbox authority, and route its final response
   downstream as text.
9. Explicitly grant the AI Agent workspace-write authority, have it create a
   declared file in the current working directory, and route that file reference
   to a downstream block.
10. Diagnose a failed run, correct it, and rerun successfully.
11. Restart Vorchestra and inspect the retained run history.
12. Undo an edit, recover an unsaved draft, and save a portable workflow that
    contains no resolved secret values by default.

## Explicit non-targets

The following remain outside v0.2 unless `VISION.md` records a superseding
decision:

- Scheduled, file-event, webhook, or remote triggers
- Cycles, loops, feedback edges, or streaming execution
- Automatic retries and configurable recovery policies
- Cloud or distributed execution, synchronization, or collaboration
- Accounts or authentication for Vorchestra itself
- Agent-runtime- or provider-specific engine behavior or a plugin marketplace
- AI Agent runtimes beyond Codex, additional specialized AI blocks, and
  specialized Git, Docker, HTTP, MCP, or filesystem block types
- Per-block AI model overrides, alternate instruction-delivery modes, and
  worktree-backed agent isolation
- Full process sandboxing or fine-grained capability grants
- Managed installation or authentication for invoked tools
- Intel macOS, Windows, or Linux releases
- Developer ID signing or Apple notarization
- Per-block reruns that rely on undefined artifact-replay semantics

## Resolved AI Agent decisions

The initial AI Agent boundary is fixed for v0.2:

1. The selector is named `Agent runtime`; `Codex` is its only v0.2 value.
2. The instruction is passed exactly as one CLI argument. Optional connected
   text context remains a separate stdin binding.
3. The runtime executes directly in the block's resolved current working
   directory. Vorchestra does not create or manage a worktree in v0.2.
4. Per-block model overrides and other runtime-specific capability settings are
   future work.
5. Read-only remains the default, but the user can explicitly select
   `workspace-write` and declare filesystem-reference outputs for files or
   directories the Agent runtime creates or updates.

## Resolved cross-cutting decisions

The contracts shared by multiple v0.2 targets are fixed as follows:

1. Local run history is retained for 30 days and capped at 100 MiB across the
   application. The oldest runs are pruned first, and the user can clear history
   explicitly.
2. Vorchestra does not keep a separate remembered-value cache for workflow
   inputs. Explicit defaults may be stored in the portable workflow; executed
   values remain only in sensitive local run history for inspection and rerun.
3. A filesystem output declaration resolves and verifies a reference after the
   process succeeds. It never performs the create or update itself.
4. The canonical workflow format advances to schema v2. Existing v1 files are
   migrated on load; v2 adds workflow inputs and a generic opaque
   editor-metadata record that engine validation and execution do not interpret.
5. In the desktop application, a blank working directory resolves to the opened
   workflow file's directory. An unsaved workflow uses the user's home
   directory. The effective path remains visible before execution.
6. Explicit relative working directories and filesystem run inputs resolve
   against that same desktop workflow base for both preflight and execution.
   Portable saved values remain relative; run-local resolved values and history
   use canonical absolute paths.
7. v0.2 macOS artifacts are intentionally unsigned and unnotarized. The release
   includes checksums and explicit trust guidance, and never presents itself as
   verified by Apple or an identified developer.
8. The v0.2 packaged release supports Apple silicon only. Intel macOS packaging
   and acceptance are outside this release.

## Deferred to v0.3

Additional Agent runtimes, runtime-specific model configuration, richer
instruction delivery, and worktree-backed isolation are intentionally excluded
from this release. They are tracked separately in
[`V0_3_TARGETS.md`](./V0_3_TARGETS.md).

## Suggested sequence

1. Exact invocation preview and filesystem UX
2. Non-executing preflight
3. Editing confidence and recovery
4. Workflow parameters
5. AI Agent block with a Codex Agent runtime compiler targeting the established
   generic process contract
6. Durable run history and rerun flow
7. Packaged-release, performance, and accessibility acceptance

This order attacks observed authoring confusion first and delays new persistent
contracts until their product decisions are explicit.
