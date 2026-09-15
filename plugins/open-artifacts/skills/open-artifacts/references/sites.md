# Sites

Use the library URL returned by `route.py`. Use the harness’s signed-in browser and its supported APIs; in Codex use `mcp__cua_repl`. Read `browser-workflow.md` for page-tool discovery and the plain UI route. If sign-in is needed, leave the tab ready and report it. Leave unrelated tabs and Safari alone. Do not use the native Tailscale MCP tools for this route, derive a Sites MCP endpoint, extract credentials, or deploy a Site to publish an artifact.

## Publish

Keep the small editable source with its empty foundation slot. Run `artifact.py check source.html`. Do not pack fonts into model context.

Call the page’s `publish_geist_artifact` with source HTML, title, and a fresh UUID `requestId`. The host adds Geist. For an uncertain response, keep the request ID and exact payload. Without WebMCP, open `/publish` on the same origin as the library returned by `route.py`, then fill Title → Paste HTML → Publish artifact. This authenticated page opens the publication form; the library has no creation button. Do not change hosts or derive another endpoint. The form also adds Geist; never fall back to the automated file chooser. Read the actual URL and revision after publication.

## Read and revise

Use `get_artifact` for metadata and `get_review_context` for comments and original targets/state. `get_editable_artifact` supplies compact source by stripping only the recognized standard Geist foundation. Unknown/custom foundations require preserving the exact original styles; do not replace them with the default. Fully packed source uses `publish_artifact`.

Read `review-targets.md` when interpreting feedback. Page tools return decoded `review_target` evidence and `is_from_earlier_revision`; the plain UI shows the target kind, quote or area coverage, original revision link, and placement status for the displayed revision. Keep captured evidence distinct from that live status. A missing or changed target remains in the comment list even when it has no pin.

Without WebMCP, read comments and open Publish revision using `browser-workflow.md`. The form supplies editable source for standard Geist artifacts. Revise the existing artifact, not a new library entry. On an exact historical revision link, read the current revision before editing; the old version remains review context.

With WebMCP: create a review batch before edits; publish with the artifact ID and current base revision; then call `mark_addressed` for handled notes with the batch ID, new revision ID, and a fresh request ID. Never reply between the batch and addressed event because it changes the note version. Read back the revision and events. A conflict requires rereading and reconciling.

Without WebMCP, the UI can read feedback and publish revisions but cannot create batches or addressed agent events. Leave human notes open and report that no addressed event was recorded. Never use Resolve note as a substitute.

Verify the main interaction, derived output, and an edge case in the published iframe with comment mode off. Mark the result tab as a deliverable. A read-only request must stop after reading.
