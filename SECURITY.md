# Security model

Vorchestra v0.1 runs local executables with the permissions of the user who
launched the desktop application. It is designed for trusted workflows with
visible guardrails; it is not a sandbox for untrusted code.

The v0.1 desktop acceptance target is macOS. POSIX process-group termination is
covered by integration tests, including forced termination when a process
ignores the initial request. Windows and packaged Linux desktop behavior are not
yet release-supported.

## Treat workflows as executable code

Review an imported workflow before running it. A workflow can invoke commands,
read or modify files available to the current user, access explicitly inherited
environment values, and use the network through the tools it launches.

Vorchestra makes direct executable-and-argument invocation the default. Blocks
that enable shell mode have broader interpretation rules and must be visibly
identified in the run preview.

## Secrets

Workflow files store host-environment references, not resolved values. Do not
place secrets in literal arguments, literal environment values, filesystem
paths, examples, or test fixtures.

Process stdout and stderr may still contain sensitive data. v0.1 does not
promise automatic redaction, so inspect run output before sharing it.

## Desktop boundary

The Electron renderer has Node integration disabled and context isolation
enabled. Filesystem access and process execution occur in the main process
behind a narrow preload bridge. Renderer-provided workflow data is parsed and
validated again at that boundary.

## Reporting a vulnerability

Do not open a public issue containing credentials, private workflow content, or
an exploit that could execute unintended local commands. Until a private
reporting channel is established, provide a minimal report without sensitive
data to the project owner directly.
