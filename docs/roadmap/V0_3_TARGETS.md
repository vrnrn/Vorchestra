# v0.3 targets

## Status

- **Status:** Implemented; automated and Electron smoke evidence recorded in
  `../acceptance/V0_3.md`
- **Created:** 2026-07-09
- **Updated:** 2026-07-10
- **Theme:** From one-shot Codex workflows to capability-aware,
  worktree-isolated multi-runtime agents
- **Depends on:** The accepted v0.2 AI Agent boundary in `V0_2_TARGETS.md`
- **Research input:** `../research/CLINE_KANBAN_AGENT_ORCHESTRATION.md`
- **Product boundary:** The constraints and trust model in `VISION.md` remain
  authoritative.

v0.2 proved that a specialized AI Agent editor can compile Codex configuration
into the generic process contract without adding agent or provider behavior to
the engine. v0.3 validates that boundary with two additional local Agent
runtimes, Cline and Antigravity, then adds the capability, instruction, model,
and workspace-isolation contracts required to use all three honestly.

The v0.2 baseline remains available: the AI Agent instruction can be passed as
one visible CLI argument, connected context remains a separate declared input,
execution can use the resolved current working directory, read-only is the
default, and explicit workspace-write authority can produce declared
filesystem-reference outputs.

## Reference-use policy

`/Users/vrana/Development/kanban` and the derived Cline Kanban research note are
available as read-only implementation inspiration. They may be used to answer a
concrete design question, compare runtime behavior, or unblock implementation
when Vorchestra needs a proven example.

Kanban is a different product with a different architecture and authority model.
Its board lifecycle, interactive PTY sessions, native Cline SDK path, browser
coordination, autonomous flags, worktree conventions, persistence, and Git
automation are not Vorchestra requirements or defaults. No Kanban behavior
should be copied merely because it already exists there.

Every v0.3 decision must instead be justified against Vorchestra's own product
thesis, generic process contract, engine boundary, DAG semantics, artifact and
runtime-event separation, visible-authority model, and concrete acceptance
workflows. When the two projects differ, `VISION.md`, this roadmap, and
Vorchestra's contracts are authoritative.

## Release thesis

v0.3 is successful when a user can choose Codex, Cline, or Antigravity for an AI
Agent block; configure only capabilities that the selected runtime supports;
inspect the exact effective instruction, invocation, working directory, and
authority; and run the resulting block through the same generic workflow and
runtime-event model.

The release also introduces explicit Git-worktree isolation for workflows whose
agents edit a repository. Isolation is a visible execution choice with defined
creation, sharing, retention, cleanup, and artifact-boundary behavior. It is not
silently inferred from the selected runtime or executable.

The cohesive release story is:

> Compose multiple local Agent runtimes in one visual DAG, give each only
> visible capabilities, and optionally let ordered agents collaborate inside an
> explicit run-scoped Git worktree without weakening Vorchestra's generic
> process model.

## Fixed product decisions

1. **Runtime set:** v0.3 supports Codex, Cline, and Antigravity as explicit
   Agent runtime identities.
2. **Cline boundary:** v0.3 targets the local Cline CLI compiled to a generic
   direct process. Native Cline SDK integration, provider catalogs, OAuth,
   SDK-owned chat history, and SDK session rebinding are not part of this
   release.
3. **Antigravity boundary:** v0.3 targets the local Antigravity CLI through the
   same registry-and-compiler boundary. Vorchestra does not embed an Antigravity
   service or copy its credentials or private session state.
4. **Execution shape:** one-shot direct-process execution remains the required
   and default shape. Interactive PTY sessions are not required for v0.3.
5. **Authoritative representation:** every runtime-specific editor compiles to a
   generic process definition. The compiled executable, argument array,
   environment bindings, input delivery, outputs, and working directory remain
   authoritative for preflight and execution.
6. **Capabilities:** the desktop runtime registry declares supported optional
   capabilities. The UI and compiler consume those declarations instead of
   scattering runtime-ID checks or inferring behavior from executable names.
7. **Model defaults:** an unset per-block model uses the runtime's local
   default. An explicit override is stored as runtime-specific portable editor
   metadata and is checked during preflight when the runtime exposes a reliable
   check. Model identifiers never enter the engine contract.
8. **Instruction integrity:** instruction-delivery mode and deterministic
   composition are stored explicitly. Vorchestra never adds an undisclosed
   system prompt, approval instruction, or provider-specific prompt mutation.
9. **Isolation scope:** worktree isolation is an explicit block choice. The
   default isolation scope is shared for the workflow run so sequential Agent
   blocks can review and extend the same repository state.
10. **Parallel writes:** write-capable blocks may not execute concurrently in
    the same shared worktree scope. A workflow that requires parallel mutable
    branches must place them in separate explicit isolation scopes.
11. **Git authority:** v0.3 does not automatically commit, merge, push, open a
    pull request, or resolve conflicts. Those are separate visible operations or
    future workflow capabilities.
12. **Artifact boundary:** generated files, diffs, commits, and Git state do not
    become implicit artifacts. A file or directory crosses a block boundary only
    through a declared and validated filesystem-reference output.

## Target architecture

The shared architecture has three layers:

```text
AI Agent editor
  -> desktop runtime registry and runtime-specific compiler
  -> generic process definition
  -> engine validation, DAG scheduling, artifacts, and runtime events
  -> desktop execution host and local process runner
```

Worktree preparation belongs to the desktop execution host. It resolves an
explicit isolation scope to a concrete working directory before the selected
runtime compiler produces the generic process definition. The engine receives
ordinary process and path configuration; it does not gain Git, Cline,
Antigravity, model-provider, or Agent-runtime concepts.

Portable workflow intent, run-local execution state, and runtime-owned state
remain separate:

| State                                                                      | Owner                                   |
| -------------------------------------------------------------------------- | --------------------------------------- |
| Selected Agent runtime and portable runtime settings                       | Workflow editor metadata                |
| Generic executable, arguments, inputs, outputs, and environment references | Compiled process definition             |
| DAG readiness, artifact routing, cancellation, and terminal state          | Engine                                  |
| Worktree path, base commit, scope, and retention state                     | Desktop run state and local run history |
| Authentication, provider credentials, private sessions, and local defaults | Selected local runtime                  |

## Capability contract

The registry should describe capabilities rather than exposing one union of all
possible runtime settings. The initial vocabulary may include:

- per-block model override;
- literal-argument instruction delivery;
- stdin instruction delivery;
- file-backed instruction delivery;
- separate connected text context;
- deterministic instruction templates;
- image inputs;
- structured runtime events;
- session resume;
- read-only execution;
- workspace-write execution; and
- declared filesystem outputs.

A capability declaration means the desktop editor and compiler know how to
represent and validate the behavior. It does not automatically make that
capability part of v0.3 acceptance. Codex, Cline, and Antigravity must each have
an explicit capability matrix backed by current CLI research and compiler tests.

Unsupported settings are not silently ignored. Loading a workflow whose saved
runtime metadata requests an unavailable capability must produce an actionable
validation or preflight issue that identifies the runtime, setting, and next
action.

Session resume and structured events may be represented in the capability
vocabulary, but implementation is required only where a v0.3 runtime and
acceptance workflow prove a concrete need. Any resume handle is runtime-local
run state, not portable workflow data. Runtime-private events may be normalized
into inspectable runtime events, but raw provider payloads never become routed
artifacts automatically.

The implemented v0.3 matrix is:

| Runtime     | Model override        | Instruction delivery                                | Connected context                  | Read-only intent                | Workspace write                                          | Structured events | Resume      |
| ----------- | --------------------- | --------------------------------------------------- | ---------------------------------- | ------------------------------- | -------------------------------------------------------- | ----------------- | ----------- |
| Codex       | Exact `--model` value | Literal argument or deterministic argument template | Separate stdin or template binding | Codex `--sandbox read-only`     | Codex `--sandbox workspace-write`                        | Not normalized    | Not exposed |
| Cline       | Exact `--model` value | Literal argument or deterministic argument template | Separate stdin or template binding | Visible Cline `--plan` behavior | Direct one-shot execution without generated bypass flags | Not normalized    | Not exposed |
| Antigravity | Exact `--model` value | Literal argument or deterministic argument template | Template binding                   | Antigravity `--sandbox`         | Direct print mode without generated bypass flags         | Not normalized    | Not exposed |

Cline's v0.3 read-only selection is visible behavioral intent through its
documented plan mode, not a hard filesystem sandbox. Vorchestra does not claim
otherwise. Users who need a stronger repository boundary should combine it with
an explicit workflow-run worktree and review the effective invocation.

## Release targets

### V03-T01 — Runtime registry and capability-aware editor

- Add stable runtime identities for `codex`, `cline`, and `antigravity`.
- Store the selected runtime explicitly in generic opaque editor metadata.
- Define a desktop-owned registry containing display metadata, executable
  discovery, supported capabilities, compiler selection, and actionable
  installation or authentication guidance.
- Render settings according to declared capabilities rather than hard-coded
  runtime-name branches spread across the editor.
- Preserve unknown runtime metadata when possible and fail safely when the
  selected runtime is unavailable.
- Keep the registry and every runtime compiler outside `packages/engine`.

### V03-T02 — Cline CLI Agent runtime

- Add Cline as a selectable Agent runtime.
- Compile Cline settings to a direct executable-and-argument invocation using
  the selected instruction-delivery mode, model override when supported, input
  bindings, authority, and resolved working directory.
- Detect a missing executable and translate launch or authentication failures
  into typed, actionable preflight or runtime failures.
- Never generate Cline approval-bypass, sandbox-bypass, or trust-bypass options.
- Keep Cline-owned provider settings, credentials, sessions, and history under
  Cline ownership.
- Do not introduce native Cline SDK chat, OAuth, provider-store, or session
  infrastructure in v0.3.

### V03-T03 — Antigravity CLI Agent runtime

- Add Antigravity as a selectable Agent runtime.
- Compile Antigravity settings to a direct executable-and-argument invocation
  using the same generic process boundary.
- Expose only model, instruction, context, event, image, resume, and authority
  options that current Antigravity CLI behavior can support deterministically.
- Detect a missing executable and translate launch or authentication failures
  into typed, actionable preflight or runtime failures.
- Never generate permission, sandbox, trust, or approval bypasses.
- Leave Antigravity authentication, local configuration, credentials, and
  private conversation state under Antigravity ownership.

### V03-T04 — Runtime-specific model configuration

- Allow a runtime that declares model-selection capability to expose an optional
  per-block model override.
- Make `Use runtime default` an explicit UI state rather than copying an ambient
  local default into the workflow.
- Store an explicit override with the selected runtime's editor metadata.
- Show the override in the effective configuration and invocation preview.
- Report unavailable or invalid models through preflight when reliable local
  validation exists; otherwise preserve the exact runtime failure and next
  action.
- Do not normalize provider-specific model names into a false cross-runtime
  model catalog.
- Keep authentication and provider-owned credentials with the local runtime.

### V03-T05 — Richer instruction and context delivery

- Preserve the v0.2 literal CLI-argument mode.
- Add explicit capability-gated stdin and file-backed delivery modes where a
  runtime requires them.
- Support deterministic templates for workflows that need to combine a visible
  instruction with named connected context.
- Store the chosen delivery mode and template literally in portable editor
  metadata.
- Keep instruction, connected context, and generated delivery files as distinct
  inspectable inputs even when the runtime ultimately receives combined text.
- Show the fully resolved instruction, composition boundaries, temporary-file
  path when applicable, and effective invocation before execution.
- Create generated prompt files only in run-local application storage or the
  explicit isolation scope, use restrictive local permissions, and clean them up
  according to the run-retention policy.
- Never append hidden text, mutate the user's instruction, or treat runtime
  events as prompt context.

### V03-T06 — Explicit worktree-backed isolation

- Offer `Current working directory` and `Workflow-run worktree` as visible
  execution choices for write-capable Agent blocks.
- Resolve a shared run scope from an explicit Git repository root and visible
  base commit.
- Create the worktree and branch before launching a participating process and
  record their resolved paths and identifiers in local run history.
- Allow sequential Agent blocks in the same DAG to share the scope so, for
  example, one runtime can create a change and another can inspect or revise it.
- Reject or preflight-block concurrent workspace-write blocks that target the
  same scope. Separate named scopes are required for parallel mutable branches.
- Make dirty source-worktree state and the selected base commit visible; do not
  silently copy uncommitted source-worktree changes into the run worktree.
- Default to retaining a changed or failed worktree for inspection. Never delete
  uncommitted changes automatically.
- Permit automatic cleanup only when the scope is clean, no retained artifact
  depends on its path, and the configured retention policy allows it.
- Provide explicit reveal, inspect-diff, retain, and safe-cleanup actions.
- Do not automatically commit, merge, rebase, push, open a pull request, or
  resolve conflicts.
- Keep ordinary current-working-directory execution available when isolation is
  unnecessary.

### V03-T07 — Common lifecycle and inspection

- Continue using the existing generic queued, running, succeeded, failed,
  skipped, and cancelled runtime states as the scheduling authority.
- Preserve stdout, stderr, exit status, timing, cancellation, input provenance,
  and output provenance for all three runtimes.
- Allow capability-gated structured details to enrich inspection without
  changing DAG readiness or becoming artifacts.
- Keep process exit and ordinary output interpretation sufficient for one-shot
  v0.3 acceptance; do not require provider-private rollout-file parsing or
  browser-owned lifecycle transitions.
- Keep runtime-owned session identifiers and resume handles in sensitive local
  run history, never in portable workflow definitions by default.

## Worktree lifecycle contract

The acceptance specification must cover the following state transitions:

1. Preflight resolves the repository root, base commit, requested scope, Git
   availability, and whether participating blocks have compatible authority.
2. Authority review shows that a new branch and worktree will be created, which
   blocks will share it, and whether they may write.
3. The desktop host creates the scope and records its actual path, branch, and
   base commit before the first participating process starts.
4. Each compiler receives that resolved path as the generic process working
   directory. No runtime independently creates a hidden worktree.
5. Ordered blocks may observe prior changes in the shared scope. Parallel
   write-capable blocks require different scopes.
6. Declared filesystem outputs are resolved and validated inside the scope after
   the producing process succeeds.
7. Run completion records whether the scope is clean, changed, failed, retained,
   or eligible for cleanup.
8. A retained filesystem-reference artifact prevents cleanup that would make its
   path invalid.
9. Cleanup refuses to remove a scope with uncommitted changes or another active
   run dependency unless the user performs a separately designed explicit
   destructive action.

Merge and conflict behavior in v0.3 is intentionally simple: Vorchestra does not
merge. A retained worktree and its visible diff are the handoff to the user or
to a later explicit workflow step. Merge conflicts therefore cannot be silently
created or resolved by worktree cleanup or run completion.

## Trust and authority requirements

- Read-only remains the default for every Agent runtime.
- Workspace-write and worktree creation are separate visible authority choices.
- Direct executable-and-argument invocation remains the default; shell
  evaluation remains explicit and is never generated merely because a runtime
  was selected.
- Effective instructions, model override, input delivery, executable, arguments,
  environment references, working directory, isolation scope, and generated
  temporary files are inspectable before execution.
- Vorchestra does not generate autonomous approval, sandbox, permission, or
  trusted-workspace bypass flags for Codex, Cline, or Antigravity.
- Runtime-owned credentials are never copied into workflows, fixtures, logs, or
  Vorchestra-owned provider stores.
- Process output may contain secrets and retains the existing sensitive local
  run-history treatment.
- Imported workflows with runtime-specific settings or worktree authority are
  treated as executable code and require the same visible review as generic
  process workflows.

## Acceptance strategy

### Automated acceptance

- Add registry and compiler contract tests for Codex, Cline, and Antigravity.
- Use fake executables and temporary Git repositories; automated unit and
  integration tests must not invoke real user tools, network calls, ambient
  authenticated sessions, or provider APIs.
- Golden-test each runtime's exact executable, argument order, environment
  references, input delivery, output declarations, model selection, authority,
  and resolved working directory.
- Test every unsupported capability as an actionable failure rather than a
  silently ignored field.
- Test missing executable, invalid working directory, unavailable model where
  locally detectable, authentication-shaped failure translation, non-zero exit,
  malformed output, cancellation, and generated-file validation.
- Exercise worktree creation, shared sequential changes, rejection of parallel
  writers in one scope, failed-run retention, clean cleanup, dirty cleanup
  refusal, and retained-artifact cleanup refusal in disposable repositories.
- Prove that `packages/engine` contains no Codex, Cline, Antigravity, provider,
  model, or Git-worktree scheduling concepts.
- Run `npm run verify` before the release is considered complete.

### Opt-in real-runtime smoke

Real-runtime smoke is separate from the normal automated gate because it can
consume account usage, depend on authentication, access a network, or modify
local files.

- Provide one explicit smoke workflow for each supported runtime.
- Run only after fresh user opt-in against disposable directories and disposable
  Git repositories.
- Exercise read-only behavior first, then separately exercise visible
  workspace-write and declared output behavior.
- Record the CLI version, effective invocation, expected authority, produced
  artifacts, and cleanup result without recording credentials or unnecessary
  prompt/output contents.
- A missing or unauthenticated optional runtime produces explicit degraded
  evidence and a next action; it must not be represented as passing real-runtime
  acceptance.

## v0.3 success scenario

v0.3 is successful when a solo developer can:

1. Create a workflow containing Codex, Cline, and Antigravity Agent blocks.
2. See only the model, instruction, context, authority, and lifecycle settings
   supported by each selected runtime.
3. Supply a visible instruction and connected context through an explicit,
   inspectable delivery mode with no hidden prompt composition.
4. Review the exact generic process invocation and actionable preflight result
   for every runtime.
5. Choose ordinary current-directory execution or opt participating blocks into
   a visible workflow-run worktree.
6. Run ordered agents in the shared scope so one runtime can create a declared
   change and another can review or revise the same files.
7. Route declared text, JSON, and filesystem-reference outputs through the
   existing DAG while runtime events remain diagnostic rather than data-plane
   artifacts.
8. Diagnose a missing runtime, invalid model, unavailable authentication,
   incompatible capability, worktree conflict, process failure, or output
   validation failure from typed evidence and a concrete next action.
9. Cancel the run and understand which processes stopped, which blocks were
   skipped, and why the worktree was retained.
10. Inspect the final diff and explicitly retain or safely clean the worktree
    without Vorchestra silently committing, merging, pushing, or deleting
    uncommitted changes.

## Implemented sequence

1. Verify current Codex, Cline, and Antigravity CLI contracts and record a
   capability matrix.
2. Extract the v0.2 Codex compiler behind the desktop runtime-registry interface
   without changing its emitted generic process behavior.
3. Add Cline and Antigravity preflight and direct-process compilers.
4. Add capability-driven model and instruction-delivery controls.
5. Add deterministic generic argument and stdin templates. No supported v0.3
   runtime required generated prompt-file delivery, so file-backed delivery is
   rejected rather than simulated.
6. Define and implement the desktop-owned worktree lifecycle and concurrency
   validation.
7. Add shared lifecycle inspection and any proven structured-event translation.
8. Complete automated and production Electron smoke acceptance. Keep
   authenticated real-runtime execution explicitly opt-in.

This order proves the runtime abstraction before worktree lifecycle broadens the
execution host, while still delivering the complete v0.3 release thesis.

## Explicit non-goals

The following remain outside v0.3 unless `VISION.md` records a superseding
decision:

- native Cline SDK embedding, provider catalogs, OAuth, or SDK chat history;
- interactive PTY or terminal multiplexing as a required Agent execution mode;
- cloud execution, accounts, synchronization, or collaboration;
- automatic commits, merges, rebases, pushes, pull requests, or conflict
  resolution;
- hidden prompt mutation or generated system instructions;
- automatic approval, sandbox, permission, or workspace-trust bypasses;
- importing runtime credentials or private session stores into Vorchestra;
- treating diffs, Git status, commits, runtime events, or private session data
  as implicit workflow artifacts;
- provider-specific scheduling or artifact semantics in the engine;
- cyclic graphs, feedback edges, or browser-owned dependency transitions; and
- inferring runtime, model, instruction mode, authority, or isolation from an
  executable name.

## Post-implementation follow-ups

The v0.3 implementation decisions above are resolved. These operational checks
and future capability questions remain outside the normal automated gate:

1. Repair or reinstall the local Cline native binary before recording an
   authenticated real-Cline smoke; the currently installed 3.0.39 binary exits
   with status 137 before printing help.
2. Run the multi-runtime smoke only with fresh user opt-in, authenticated local
   runtimes, and a disposable repository because it can consume account usage
   and create files.
3. Add structured-event normalization or session resume only when a concrete
   workflow establishes durable replay and staleness semantics.
4. Perform a new packaged VoiceOver walkthrough if v0.3 is promoted to a public
   packaged release. The implementation pass retains the existing automated
   accessibility gate without making manual accessibility work a blocker.

Follow-up work must not weaken the fixed engine boundary, visible-authority
requirements, or prohibition on hidden prompt and permission mutation.
