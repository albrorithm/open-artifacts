# Self-hosting with Tailscale

A portable Node server with SQLite storage and standard Streamable HTTP MCP. Agents publish, read comments, and revise without a browser. You use the private web library and viewer.

## Topology

```text
owner-user agent or browser in the tailnet
    -> private Tailscale Serve HTTPS
    -> Node backend on 127.0.0.1 only
    -> private SQLite data directory
```

Serve strips caller-supplied identity headers and adds `Tailscale-User-Login` for user-owned devices. The app requires an exact match with its configured owner login. Tagged devices have no user login and are denied. Cookies, bearer tokens, Sites headers, and tool arguments cannot grant access.

The backend trusts Serve and local processes. A local process can forge requests to the loopback listener, so use a dedicated host or process isolation if other local workloads are untrusted. Never expose the raw Node port to the LAN or tailnet, and do not enable Funnel. Tailnet access rules should let only the intended owner reach the Serve port.

## Build and package

Requires Node 22.13 or newer and a working Tailscale Serve setup.

```sh
npm ci
npm run build:selfhost
npm run test:probe:selfhost
npm run test:artifacts:selfhost
npm run package:selfhost -- outputs/open-artifacts-selfhost
```

Use a fresh output directory. The package contains the standalone server, its dependencies, the initial SQL migration, and the startup runner. It contains no settings or data and runs outside the source checkout. The two build targets share `dist/`, so build them one at a time.

## Configure and start

Copy the release to a server directory. Create a private `.env.selfhost` there, or set these through your service manager:

```dotenv
OPEN_ARTIFACTS_OWNER_LOGIN=owner@example.invalid
OPEN_ARTIFACTS_ORIGIN=https://artifacts.example.invalid:8444
OPEN_ARTIFACTS_DATA_DIR=/path/to/private/artifact-data
PORT=3000
```

Keep the data directory outside the release. Restrict the settings file to its owner. The origin must be a canonical HTTPS origin with no path, trailing slash, credentials, query, or fragment. Owner matching is exact and case-sensitive. Environment variables take precedence over the file.

Run `npm start` from the release, or `npm run start:selfhost` from the source checkout. The runner validates settings, forces `HOST=127.0.0.1`, applies a private file creation mask, checks the build marker, and limits forwarded-host trust to the configured origin. Do not start the generated standalone entry directly; its default bind is not loopback-only.

Check existing Serve routes before adding one:

```sh
tailscale serve status
tailscale serve --bg --https=8444 http://127.0.0.1:3000
tailscale serve status
```

To remove only this route: `tailscale serve --https=8444 off`. Confirm the raw backend listens only on loopback and Funnel is off.

## Connect agents

Point a Streamable HTTP MCP client at the private origin plus `/mcp`. Do not copy browser cookies or add a bearer token. The agent needs tailnet connectivity from an owner-user device; cloud-only clients without tailnet access are not supported.

The [plugin README](../plugins/open-artifacts/README.md) covers the Codex setup helper. Other harnesses can use the same MCP URL. The bundled Python client publishes local HTML and downloads exact revision HTML without putting embedded font payloads in model context.

The server offers the seven artifact tools listed in the [README](../README.md) plus `probe_identity`. Native `get_artifact` omits HTML unless `includeHtml` is true. Only human controls create, resolve, or reopen notes.

The transport is stateless and POST-only. GET and DELETE return 405. Browser requests must send the exact configured Origin; native clients may omit it. Request bodies are bounded and responses use `no-store`.

## Local agents on the server host

An agent on the server machine can use stdio MCP instead of a network round trip. Configure its command as Node with:

```text
/path/to/server/dist/standalone/mcp/server.mjs --config /path/to/server/.env.selfhost
```

Use absolute paths for Node and the settings file. The stdio entry reads that settings file, uses the OS user's access to the data directory, and opens no network listener. It shares the SQLite library and tools with the HTTPS server. The plugin helper creates this configuration with `configure.py --local-server /path/to/server --tailscale-library-url https://artifacts.example.invalid:8444 --output /path/to/configured/open-artifacts`. Stdio success does not prove HTTPS reachability.

## Storage and backups

The data directory holds `artifacts.sqlite` and its WAL files: artifact HTML, revision history, comments with their original context, review batches, and agent events. The server creates the database on first use and applies the bundled migration. Migration hashes must match; do not edit an applied migration.

To back up, stop the server, copy the whole data directory, and restart. Restore the whole directory while stopped, preserving permissions. Do not copy only the main database file while the server is writing.

## Deployment checks

- Your browser or phone can open the private library and add a comment.
- A fresh owner-user agent can publish and read that comment through native MCP, including after a server restart.
- Real Serve traffic replaces caller-supplied identity headers. Non-owner and tagged devices cannot read owner data.
- Another device cannot connect to the raw backend port.

Loopback fixtures do not prove real Tailscale identity handling. See the [testing guide](PLUGIN_TESTING.md).

## References

- [Tailscale Serve and identity headers](https://tailscale.com/docs/features/tailscale-serve)
- [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Node SQLite](https://nodejs.org/api/sqlite.html)
