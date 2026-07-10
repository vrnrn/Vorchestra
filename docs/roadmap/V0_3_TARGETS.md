# v0.3 targets

## Status

- **Status:** Candidate release targets
- **Created:** 2026-07-09
- **Theme:** From one-shot agents to adaptable, isolated agent runtimes
- **Depends on:** The v0.2 AI Agent boundary in `V0_2_TARGETS.md`
- **Product boundary:** The constraints and trust model in `VISION.md` remain
  authoritative.

This document holds work deliberately deferred from v0.2. These targets are
directional until v0.2 validates the first Codex Agent runtime and the contracts
below receive their own acceptance criteria.

The v0.2 baseline remains fixed: the AI Agent instruction is one visible CLI
argument, connected context is a separate stdin binding, execution uses the
resolved current working directory, read-only is the default, and explicit
workspace-write can create declared filesystem-reference outputs.

## Candidate release targets

### V03-T01 — Additional Agent runtimes and capabilities

- Add a second Agent runtime to validate the compiler boundary.
- Introduce capability metadata only for differences proven by multiple
  runtimes, such as model selection, images, structured events, or session
  resume.
- Keep runtime-specific settings outside engine scheduling and artifact
  semantics.
- Preserve the generic compiled process as the authoritative execution
  representation.

### V03-T02 — Runtime-specific model configuration

- Allow an Agent runtime to expose an optional per-block model override.
- Define how runtime-local defaults, unavailable models, and portable workflow
  metadata interact.
- Continue to leave authentication and provider-owned credentials with the local
  runtime.
- Keep model selection out of the engine contract.

### V03-T03 — Richer instruction and context delivery

- Evaluate stdin instructions, file-backed prompts, and deterministic templates
  in addition to the v0.2 literal CLI argument.
- Define exact composition and invocation-preview rules before combining
  instructions with connected context.
- Preserve the prohibition on hidden prompt mutation.
- Record delivery mode explicitly so saved workflows remain understandable.

### V03-T04 — Worktree-backed agent isolation

- Define explicit creation, branch, cleanup, retention, and failure semantics.
- Decide how files and changes leave the worktree as declared artifacts.
- Define merge and conflict behavior before multiple agents can edit isolated
  copies of the same repository.
- Keep ordinary current-working-directory execution available when isolation is
  unnecessary.
- Make worktree creation visible before execution rather than treating it as an
  internal runtime detail.

## Decisions required before implementation

1. Which second Agent runtime is the smallest useful test of the compiler and
   capability model.
2. Whether model identifiers are portable literals, local bindings, or both.
3. Which additional instruction-delivery mode is required by a concrete workflow
   that v0.2 cannot express.
4. Whether a worktree is created per block, per workflow run, or through an
   explicit shared isolation scope.
5. How generated files, uncommitted changes, commits, and merge conflicts cross
   a worktree boundary without becoming implicit artifacts.

## Explicit carry-forward constraints

- The engine remains independent of Agent runtimes and model providers.
- Direct process execution remains the default; shell evaluation remains
  explicit.
- Instructions and effective invocation remain visible before execution.
- Authentication and provider-owned credentials stay with the local runtime.
- Generated files become artifacts only through declared and validated
  filesystem-reference outputs.
- No worktree or model behavior is inferred silently from an executable name.
