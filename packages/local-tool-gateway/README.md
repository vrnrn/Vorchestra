# Local tool gateway

`@vorchestra/local-tool-gateway` is a small, provider-neutral boundary for
granting an agent a finite set of local CLI operations. A machine-local JSON
manifest is the complete authority surface. The gateway never exposes an
arbitrary command, executable, argument, environment variable, or shell.

## Security contract

- Every executable is an absolute path to a regular, non-symlink file.
- Its SHA-256 digest is verified immediately before every invocation.
- Arguments are built from fixed literals and typed input slots. Inputs are
  passed as individual process arguments and are never shell-evaluated.
- Child environments start empty. Only manifest-listed host variables and
  literal values are included. Missing inherited values remain missing; the
  invoked tool should report authentication requirements without revealing a
  secret.
- `isolatedHome: true` replaces `HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME`
  with a unique mode-`0700` temporary tree for that invocation. It is removed
  after success, failure, timeout, or cancellation. `PATH` remains absent unless
  the manifest explicitly inherits or defines it.
- Each operation has a wall-clock timeout and a combined stdout/stderr byte cap.
  Cancellation terminates the process group, including descendants.
- JSON output is parsed before being returned when `output` is `json`.
- Manifests reject unknown properties, duplicate tools, relative executables,
  undeclared input references, and open-ended JSON Schema properties.

The gateway does not prove that an executable is safe. The digest pins the exact
artifact that was reviewed; installation and security scanning happen before its
path and digest are added to the machine-local manifest.

## Codex MCP setup

The MCP entrypoint exposes the manifest through the standard MCP stdio transport
(`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, and
`notifications/cancelled`). Register a reviewed machine-local manifest with
Codex CLI:

```sh
codex mcp add local-social-tools -- vorchestra-local-tool-mcp --manifest /absolute/path/to/tools.json
```

Confirm the registered server and advertised tools before granting it to an
agent:

```sh
codex mcp list
```

MCP calls return both text content and structured content. Tool execution
failures are MCP tool results with `isError: true` and retain the gateway's
stable failure code. JSON-RPC errors are reserved for malformed or unsupported
protocol requests.

## Lower-level JSON-line protocol

The package also retains a small non-MCP newline-delimited JSON server for
direct integrations:

```sh
vorchestra-local-tool-gateway --manifest /absolute/path/tools.json
```

Each input line contains one request. Responses can arrive out of order, keyed
by `id`, so long-running calls do not block cancellation.

```json
{"id":1,"method":"tools/list"}
{"id":2,"method":"tools/call","params":{"name":"reddit_search","arguments":{"query":"NVDA earnings","limit":20}}}
{"id":3,"method":"tools/cancel","params":{"requestId":2}}
```

Failures are values rather than transport errors. They include stable codes such
as `arguments_invalid`, `executable_hash_mismatch`, `timed_out`, `cancelled`,
`output_limit_exceeded`, `process_failed`, and `output_invalid`.

## Read-only social example

[`examples/read-only-social-tools.manifest.example.json`](examples/read-only-social-tools.manifest.example.json)
shows bounded search operations for locally audited `rdt-cli` and `twitter-cli`
builds. It intentionally contains placeholder paths and zero digests. Replace
these with the exact installed paths and SHA-256 values after reviewing and
building pinned commits. Confirm argument spelling against those pinned
versions.

The public `rdt-cli` authentication path checks saved and browser cookies even
for public search operations. Its example therefore requires
`isolatedHome: true` and does not inherit an authentication cookie. This keeps
automatic cookie discovery away from the user's real home directory. The X
example is isolated as well, while retaining only its explicitly named auth
variables. Home isolation reduces credential discovery; it does not make an
untrusted executable safe or constrain its network access.

The example contains no post, comment, vote, like, retweet, follow, delete,
bookmark, or account-management tools. Do not add a broad passthrough command to
work around that boundary; declare and review each new read operation instead.
