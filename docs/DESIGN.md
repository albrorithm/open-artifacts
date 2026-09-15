# Design and boundaries

The goal: generate an artifact, review it on any device, and let the next model retrieve exactly what the reviewer meant.

Sites uses browser WebMCP for reads and writes where the browser supports it, with plain text fields elsewhere. Tailscale uses native Streamable HTTP MCP against a portable Node server. Both share one plugin, one library UI, and one review format. Each installation picks its own default host.

## Data and consistency

Sites stores records in D1 and one immutable HTML object per revision in R2. Self-hosting stores the same in one SQLite database with WAL journaling, foreign keys, and transactional batches. The initial migration is bundled and checked against its recorded digest. `/a/<artifact-id>` opens the current revision; `/a/<artifact-id>/r/<revision-id>` opens history.

Every query is constrained by the authenticated owner. Owner identity comes from the hosting boundary (Tailscale Serve header or ChatGPT sign-in), never from tool arguments. The auth provider and storage adapter are fixed at build time.

Publishing writes a fresh HTML object, then inserts the revision and advances the current pointer in one database batch. A revision requires the expected current revision; a stale base fails with a conflict. If the batch fails, the service checks whether it actually committed before deleting the new object. An ambiguous failure may leave an unreferenced object but never deletes a committed revision. Reads verify the stored SHA-256.

Publication, comments, and agent events carry owner-scoped unique request IDs. An identical retry returns the durable result; the same ID with a changed payload is a conflict. Status changes use a version compare-and-swap.

## Review semantics

A comment keeps its original revision, anchor ID, excerpt, section, context fingerprint, marked input state, and a versioned `__oa_target` describing what was selected: an element with its text, label and locator; an exact text selection with surrounding context and UTF-16 offsets; a point; or an area with a container-relative rectangle, container dimensions, and up to eight covered elements. Text selections keep visible paragraph breaks in `text.exact`, with `text.domExact` when the underlying DOM text differs. Editable contents and script or style text are excluded. Total target metadata is bounded to 20,000 characters, and selections over 8,000 characters are refused. Original evidence never changes; there is no migration or inferred upgrade of older comments.

Every returned thread adds `is_from_earlier_revision`, a comparison against the artifact's current revision. Separately, the iframe reports placement for the displayed revision as checking, matching, changed, missing, ambiguous, or not checked. Both are comparisons of captured DOM context, not proof that the artifact is correct.

Across revisions, placement requires a unique stable anchor or a unique exact content match, never a positional path alone. Text matches keep the quote and nearby context when offsets move. Areas and element-relative points also carry a layout fingerprint of visible element boxes and text lines relative to their container, so the container may move but not resize or reflow. Raw page-coordinate points stay on their original revision. Unmatched comments stay in the list with their original context and a link to their revision.

A review batch snapshots open comment IDs and versions plus the current revision. Marking a comment addressed requires a newer published revision and the same comment version. Agent replies and addressed events bump the version but never resolve the note; only the human controls do.

A draft note keeps the revision being reviewed even if an agent publishes meanwhile. Background refreshes hold that revision until the draft is saved or discarded.

## Runtime boundary

The trusted top-level page owns tool registration and human controls. The browser UI and WebMCP call the same validated JSON command route, which requires the exact browser Origin, accepts only JSON, bounds request size, and returns `no-store`. Artifacts are returned as JSON strings or user-initiated downloads, never served as a document on a host route.

Self-hosted MCP calls the same service functions with a request-scoped owner. The stdio entry uses them with the owner from an explicit settings file. Agent tools exclude comment creation and resolve or reopen. `get_artifact` returns metadata by default; HTML needs `includeHtml`. The Python client verifies downloaded digests, keeps TLS verification on, and refuses redirects and ambient proxies.

The iframe has only `allow-scripts`, an opaque origin, no referrer, and a host-controlled CSP. It gets no credentials, storage, or tools. The host accepts one MessageChannel per frame load, validates every report's shape and limits, and binds saved comments to an immutable revision. Reports only fill a draft. The channel closes when the frame is replaced or navigates.

This isolates the host. It does not promise zero egress or truthful reports: artifact scripts can alter their DOM, forge reports, consume resources, or navigate the frame, and navigation can carry data. Do not enter secrets into untrusted artifacts.

## Current limits

Deferred: native remote MCP or OAuth for Sites, view-state restoration, comment editing and deletion, artifact deletion, multi-user access, and automated backups. The library is sized for a small personal collection; pagination and export tooling are future work. Direct Sites database reads through the ChatGPT connector are bounded and may truncate; full HTML comes through the signed-in app tool.

The plugin has one shared workflow, starter, and asset set with separate Sites and Tailscale references. Routing uses the saved default for new artifacts and the original host for links, with no fallback. Private endpoint settings live in a configured copy, never in source.
