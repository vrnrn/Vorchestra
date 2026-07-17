# v0.4 targets

## Status

- **Status:** Automated acceptance complete; bounded live sample completed with
  explicit remote-source limitations
- **Created:** 2026-07-16
- **Theme:** Bounded Computer Use and evidence-bearing fintech research
- **Depends on:** The accepted v0.3 capability-aware Agent boundary in
  `V0_3_TARGETS.md`
- **Product boundary:** `../../VISION.md`, especially VOR-031 through VOR-035

## Reference outcome

The release reference workflow is a visible DAG with six parallel research
branches feeding one decision Agent:

1. Reddit research through an audited, read-only `rdt-cli` binding.
2. X research through an audited, read-only `twitter-cli` binding.
3. Perplexity Finance research through Computer Use.
4. TradingView chart review for ticker A through Computer Use.
5. TradingView chart review for ticker B through Computer Use.
6. TradingView chart review for ticker C through Computer Use.
7. A highest-intelligence Agent consumes the six named reports.
8. A deterministic validator writes `signals-and-orders.json` only when its
   proposal-only schema and provenance rules pass.

The reference workflow is analysis software, not an execution venue. It must not
connect a brokerage account, click TradingView Buy, Sell, Trade, or order
controls, or submit an order through any other path.

## Release targets

### V04-T01 — Generic Computer Use compiler boundary

- Add a desktop-owned Computer Use editor and compiler.
- Compile the block to a direct, inspectable Codex CLI invocation with a bounded
  browser MCP configuration; shell evaluation remains off.
- Keep browser, MCP, website, ticker, and model concepts out of
  `packages/engine`.
- Expose the resolved executable, arguments, working directory, sandbox, browser
  profile, allowed origins, timeout, action budget, and declared artifacts
  during preflight and review.
- Support visible-browser acceptance first and headless execution after the two
  modes have evidence parity.

### V04-T02 — Browser authority and hostile-content boundary

- Give each Computer Use block an exact origin allowlist and a minimal action
  allowlist.
- Treat page content as untrusted data. Retrieved instructions cannot alter the
  block instruction, invoke shell commands, add an origin, grant a tool, or
  authorize a write action.
- Disable arbitrary JavaScript evaluation, file upload, download, credential
  export, extension installation, and browser-profile mutation unless a future
  product decision explicitly adds them.
- Use a dedicated automation browser profile. Never serialize cookies, tokens,
  account identifiers, or profile paths containing credentials into portable
  workflows or captured output.
- Terminate the Codex, MCP, and browser subprocess tree on cancellation.

### V04-T03 — Audited read-only social research bindings

- Pin `public-clis/rdt-cli` and `public-clis/twitter-cli` to exact commit SHAs.
- Clone and build only in a unique temporary directory after mandatory source,
  manifest, lockfile, symlink/submodule, binary, and secret-pattern checks pass.
- Run optional installed scanners, non-smoke tests with network access denied,
  and record source, dependency, tool-version, wheel-hash, and test evidence.
- Put the resulting executables behind a typed local-tool allowlist. Agents may
  use only bounded read methods such as search, read, thread, and user posts.
- Never expose login/logout, cookie extraction, post, reply, comment, vote,
  save, subscribe, like, retweet, bookmark, follow, unfollow, or delete.
- A scan, commit, lockfile, wheel-hash, schema, or command-allowlist mismatch is
  a typed blocking preflight failure.

The upstream tools are not inherently read-only. Both can access browser
cookies, and both contain account-mutating commands. The audit/build result is
therefore supply-chain evidence, not permission to place the raw tools in an
unrestricted Agent `PATH`.

### V04-T04 — Perplexity Finance research lane

- Open only `https://www.perplexity.ai/finance` and necessary same-site pages.
- Search the configured ticker or market and collect the visible market summary,
  relevant stories and links, sector/heatmap context, sentiment, and observation
  time.
- Produce a schema-valid JSON report and evidence screenshots.
- Report authentication, navigation, stale-data, missing-section, and schema
  failures explicitly rather than inventing values.

### V04-T05 — TradingView chart-review lanes

- Configure each lane with an exact symbol, venue, timeframe, and required
  indicator preset.
- Verify the visible chart header, timeframe, market state, and required
  indicators before analysis.
- Capture price, trend, support/resistance, indicator states, relevant overlay
  labels, observation time, and screenshots in a schema-valid report.
- Refuse completion with typed failures such as `ticker_not_confirmed`,
  `timeframe_not_confirmed`, or `indicator_missing` when visual evidence is
  insufficient.
- Forbid Buy, Sell, Trade, Publish, broker connection, paper-trading, and order
  ticket actions even when those controls are visible.

### V04-T06 — Named multi-report Agent context

- Extend the desktop Agent editor to accept multiple explicitly named text or
  JSON inputs while compiling them through existing generic arguments,
  templates, stdin, and artifact ports.
- Preserve input identity, upstream block identity, artifact hash, and
  observation time in the context shown to the decision Agent.
- Require exactly the configured Reddit, X, Perplexity Finance, and three
  TradingView reports for the reference workflow.
- Resolve “highest intelligence” through a visible user-owned runtime/model
  configuration to an exact model and reasoning setting; do not add a portable
  cross-provider alias to the engine.

### V04-T07 — Proposal-only decision artifact

- Require the decision Agent to emit structured JSON and pass it through a
  separate deterministic validator/writer.
- Atomically write `signals-and-orders.json` only after validation succeeds.
- Require `schema_version`, `run_id`, `generated_at`, `market_data_as_of`,
  source report hashes/freshness, `signals`, `proposed_orders`, `conflicts`,
  `missing_or_stale_sources`, `risk_notes`, `status: "proposal_only"`, and
  `execution_authority: "none"`.
- Reject unknown symbols, invalid numeric values, expired evidence, missing
  required reports, provenance mismatches, non-proposal status, or any execution
  authority other than `none`.
- Never interpret the resulting file as permission to execute an order.

### V04-T08 — Reference workflow and operator experience

- Support a reviewable private workflow with three social/news branches, three
  chart branches, a central decision Agent, and deterministic validation.
- Make parallel progress, evidence artifacts, typed failures, skipped
  dependents, and final provenance inspectable on the canvas and in retained run
  history.
- Keep all tickers, venues, timeframes, indicator presets, freshness limits,
  output paths, and runtime/model selections visible and editable.
- Keep machine-bound workflow definitions, market reports, screenshots, and
  authenticated manifests in the user's `~/.vorchestra` directory rather than
  publishing them with the repository.

### V04-T09 — Verification and real-site acceptance

- Unit and integration tests use fake CLIs, fake MCP/browser servers, and static
  fixtures. They do not access real sites, cookies, accounts, or ambient tools.
- Prove compiler exactness, origin and action allowlists, prompt-injection
  resistance, report schemas, cancellation, provenance, freshness, and
  proposal-only enforcement.
- Run `npm run verify` and `npm run desktop:smoke` before release disposition.
- Run real-site acceptance only after a fresh explicit opt-in, using dedicated
  low-privilege browser profiles. Record visible and headless parity separately.

## Typed failure vocabulary

At minimum, v0.4 surfaces stable codes for:

- `third_party_scan_failed`
- `third_party_commit_mismatch`
- `third_party_hash_mismatch`
- `third_party_command_not_allowed`
- `browser_backend_unavailable`
- `browser_auth_required`
- `browser_origin_not_allowed`
- `browser_action_not_allowed`
- `browser_action_budget_exhausted`
- `ticker_not_confirmed`
- `timeframe_not_confirmed`
- `indicator_missing`
- `report_schema_invalid`
- `report_stale`
- `decision_inputs_incomplete`
- `decision_provenance_mismatch`
- `decision_authority_invalid`

Each failure must include a human-readable reason and a concrete next action.

## Release exclusions

v0.4 does not include order transmission, broker authentication, portfolio sync,
autonomous scheduling, hidden retries, bypass flags, unrestricted browser or
shell access, provider behavior in the engine, or a claim that browser UI data
is authoritative exchange data.
