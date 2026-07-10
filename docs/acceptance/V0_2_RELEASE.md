# v0.2 unsigned macOS release acceptance

This checklist supplies the release-quality evidence required by V02-T09.
Vorchestra v0.2 is intentionally unsigned and unnotarized; acceptance must not
imply an Apple-verified developer identity or malware review.

## Automated artifact gate

Run from the repository root on macOS:

```sh
npm run verify
npm run desktop:smoke:packaged
npm run desktop:performance:packaged
npm run release:mac
```

The official release command must produce Apple silicon DMG and ZIP artifacts
plus `SHA256SUMS.txt`. The verifier checks version and arm64 metadata, the
branded icon, matching DMG/ZIP payloads, ASAR contents, absence of sources and
maps, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and
absence of a Developer ID distribution identity.

Performance, keyboard, accessibility-tree, and VoiceOver evidence is defined in
[`V0_2_RELEASE_QUALITY.md`](./V0_2_RELEASE_QUALITY.md). The recorded packaged
performance, keyboard, and VoiceOver checks pass.

## Installation documentation contract

The public installation documentation must tell an Apple silicon user how to:

1. Verify the matching DMG or ZIP using the published `SHA256SUMS.txt`.
2. Install Vorchestra in Applications.
3. Understand the expected warning for an unsigned and unnotarized app and use
   **System Settings → Privacy & Security → Open Anyway** for Vorchestra without
   disabling Gatekeeper globally.
4. Review workflow execution authority before running imported workflows.
5. Remove the application and, separately, its retained local data.

This is a documentation requirement. v0.2 does not require a fresh macOS user,
fresh machine, or manual Gatekeeper and uninstall exercise as release evidence.
