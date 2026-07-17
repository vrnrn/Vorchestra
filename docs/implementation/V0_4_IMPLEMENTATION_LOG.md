# v0.4 implementation log

## 2026-07-16

- Read `AGENTS.md`, `VISION.md`, the v0.3 runtime contracts, desktop compiler,
  engine schema, runner, tests, and existing acceptance flow before changing
  scope.
- Verified locally that `codex exec` is the supported non-interactive controller
  and that browser control belongs behind MCP; recorded the controller/browser
  headless distinction in VOR-036.
- Added the v0.4 product decisions, roadmap targets, typed failure vocabulary,
  safety exclusions, and acceptance record.
- Pinned `rdt-cli` and `twitter-cli` to exact commits. The isolated `/tmp` audit
  checked source inventories, hashes, build metadata, risky patterns, dependency
  locks, symlinks/submodules/binaries, then built wheels only after mandatory
  gates passed. Denied-network non-smoke suites passed 123 and 242 tests. No
  CLI, login, live test, cookie, or account operation was invoked.
- Added a hash-pinned, manifest-driven local tool gateway with direct
  `shell: false` execution, typed inputs, output schemas, environment isolation,
  limits, cancellation, native MCP, and read-only Reddit/X examples. Each call
  gets a unique 0700 HOME/XDG tree so optional-auth code cannot discover the
  operator's normal browser-cookie locations.
- Added a provider-neutral MCP policy proxy. It enforces exact browser tools,
  HTTPS origins, prohibited action families, a tool-call budget, environment
  allowlisting, and upstream process-tree cleanup independently of Codex and
  page content. Ref-based click/type/select/keypress/drag tools are hard-denied
  until a future policy can bind each reference to verified snapshot semantics.
- Added generic portable `timeoutMs` semantics to the engine and node runner,
  including preflight visibility, timeout failures, process-group termination,
  escalation, and cancellation precedence.
- Added the desktop Computer Use editor/compiler. It exposes exact symbol,
  venue, timeframe, indicator preset, URL/origins, policy proxy and manifest,
  MCP tools, action budget, timeout, model/reasoning, schema, report,
  screenshot, prompt, and effective invocation. It still compiles to a generic
  process.
- Added copy/paste, canvas icon/pill, metadata preservation, inspector routing,
  and production Electron UI acceptance for Computer Use.
- Extended AI Agent blocks to accept multiple independently named text/JSON
  contexts and explicit Codex model, reasoning, ephemeral, JSONL, schema, and
  final-message options. Added user-owned intelligence profiles.
- Kept the strict research/chart schemas and captured evidence with the private
  acceptance workflow instead of publishing generated market fixtures.
- Added the deterministic fintech evidence bundler and proposal validator. The
  bundler canonicalizes and hashes exactly six reports. The validator checks
  provenance, freshness, allowed symbols, finite numeric bounds, paper mode,
  proposal-only status, and zero execution authority, then atomically renames
  the output. Failure never creates or replaces the destination.
- Built and locally accepted a private `fintech-signal-desk.vorchestra.json`:
  six parallel research lanes, evidence bundler, highest-intelligence Chief
  Agent, and final deterministic validator. The workflow remains in the user's
  `~/.vorchestra` directory and is deliberately excluded from the repository.
- Updated the workspace lockfile; the repository dependency audit reported zero
  vulnerabilities.
- Ran the full verification gate: formatting, all workspace typechecks, and all
  tests passed.
- Ran production Electron smoke: build, editor behavior, Computer Use bounded
  invocation inspection, screenshot, restart, draft recovery, and retained
  history passed.
- Completed one local end-to-end acceptance run with authenticated Reddit and X
  research plus three TradingView chart captures. Perplexity Finance returned a
  Cloudflare HTTP 403, which was preserved as typed missing evidence; the final
  validator correctly emitted a proposal-only, paper-mode no-trade result.

## Evidence index

- Product boundary: `VISION.md`
- Targets: `docs/roadmap/V0_4_TARGETS.md`
- Acceptance and audit hashes: `docs/acceptance/V0_4.md`
- Computer Use screenshot: `docs/acceptance/V0_4_COMPUTER_USE.png`
- Private acceptance workflow and evidence: `~/.vorchestra/fintech-signal-desk/`
- Social supply-chain audit: `scripts/security/`
- Social MCP gateway: `packages/local-tool-gateway/`
- Browser MCP enforcement: `packages/mcp-policy-proxy/`
- Decision boundary: `packages/fintech-decision-validator/`
