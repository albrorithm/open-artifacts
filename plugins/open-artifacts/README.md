# Open Artifacts

One plugin for private interactive HTML artifacts: create, publish, read feedback, and revise, with a shared dark Geist foundation. Choose your host once. Ordinary requests use that default; an explicit host overrides it for one request, and an existing artifact link stays on its original host. There is no fallback between libraries.

## Set up once

The helper creates a configured copy outside this repository. Choose either host:

```sh
# Sites: uses your signed-in browser.
python3 scripts/configure.py --site-url https://your-library.chatgpt.site --output /path/to/configured/open-artifacts

# Tailscale: native MCP or the Python client.
python3 scripts/configure.py --tailscale-url https://your-server.your-tailnet.ts.net:8444/mcp --output /path/to/configured/open-artifacts
```

A single host becomes the default automatically. To keep both, pass both URLs and `--default sites` or `--default tailscale`. For local stdio, replace `--tailscale-url` with `--local-server /path/to/server --tailscale-library-url https://your-server.your-tailnet.ts.net:8444`; `--node /absolute/path/to/node` is optional.

Install the configured copy in Codex and start a new task to pick up the skill and tools. To change the default later, import the current copy with `--import-plugin /path/to/configured/open-artifacts --default sites` (or `tailscale`) into a fresh output and reinstall. The helper never overwrites an existing copy. `settings.json` and `.mcp.json` belong only in configured copies, never in committed source.

## Use

Ask "Create an artifact" or "Revise this artifact using its comments." The routing helper can also be run directly:

```sh
python3 scripts/route.py
python3 scripts/route.py --backend sites
python3 scripts/route.py --artifact-url https://your-library.chatgpt.site/a/ARTIFACT_ID
```

It returns the selected library and workflow reference without a network request. An unknown URL, a conflicting host, or a missing connection is an error rather than a switch to the other library.

- **Sites:** signed-in browser, compact source publication through page tools or plain text fields. Browsers without WebMCP can publish, revise, and read notes through the UI but cannot record addressed agent events.
- **Tailscale:** native `open_artifacts_tailscale` MCP tools, or the standard-library Python `client.py` over HTTPS or local stdio. No browser needed. Supports review batches and addressed events. A Sites-only installation has no native MCP connection.

The host supplies the Library and Comments controls. The starter and packer include the licensed Geist fonts, preserve custom foundations in existing files, and never overwrite source or an existing publication file. The Tailscale client keeps exact retry receipts and verifies stored hashes. Neither proves the artifact behaves correctly; check its output and interactions.

Other harnesses can load the skill and scripts from the same package. Tailscale needs only standard MCP or Python; Sites needs a signed-in browser automation capability.
