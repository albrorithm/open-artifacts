# Releasing

## Plugin ZIP

From a clean checkout:

```sh
npm run test:release
npm run package:plugin -- releases/open-artifacts-1.0.0.zip
```

The packager reads an explicit file list under `plugins/open-artifacts`, refuses configured connection settings and development version suffixes, rejects symlinks, writes fixed timestamps and modes, prints a SHA-256 digest, and will not overwrite an existing file.

Distribute that ZIP only. Do not distribute an installed or configured copy, a workspace ZIP, or an old development archive. It does not install anything or publish to a marketplace.

## Source repository

Keep `.openai/hosting.json` limited to the `d1` and `r2` bindings; deployment tooling may add a project ID locally. Keep the plugin's `settings.json` empty and `.mcp.json` free of connections. Ignore rules do not remove files already tracked or values in earlier commits, so check history as well as the working tree.

## Self-hosted server

Build a fresh self-hosted target and package it as described in the [self-hosting guide](SELF_HOSTING.md). Keep settings and data outside the build directory. It is a separate deliverable from the plugin ZIP.

## Before publishing

- Inspect the exact archive members for private endpoints, identity details, and credentials.
- Confirm setup points at the recipient's own host, not yours.
- Exercise changed workflows with fresh test agents as described in the [testing guide](PLUGIN_TESTING.md).
- Keep checksums and release notes separate from private test records.
