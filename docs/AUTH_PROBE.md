# Authentication boundaries

## Sites

Sites relies on the platform's owner-private access controls and signed-in browser identity. Configure owner-only access when you provision your Site. The app scopes every record to the authenticated owner.

The Sites build exposes `/mcp` as a read-only identity probe only. It does not implement the artifact tools or a remote OAuth connection. Use the signed-in browser workflow. Do not copy browser credentials or make the library public to get around sign-in.

The local simulator tests cover anonymous access, forged headers, invalid credentials, origin checks, and identity fingerprints. They do not prove production authentication; check that on your deployment.

## Tailscale

The self-hosted build exposes the artifact tools through native MCP. It requires the exact configured owner login from Tailscale Serve and binds to loopback. Stdio relies on OS access to the settings file and data directory. Neither transport uses OAuth or browser cookies. Local processes are inside the trust boundary; see the [self-hosting guide](SELF_HOSTING.md).

## What a comment stores

A comment stores its text, original revision, nearby excerpt, placement, and any input state you marked with `data-review-state`. Password fields are excluded; other marked fields may contain private information. Collapsing Context in the UI only hides it. Agents can read all of it, and review batches keep snapshots.

Artifacts run in an isolated iframe, but that does not guarantee zero network egress. Do not enter secrets into untrusted artifacts. See [design and boundaries](DESIGN.md).
