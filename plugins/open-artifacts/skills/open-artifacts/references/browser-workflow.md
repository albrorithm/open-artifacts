# Browser workflow

Use the CUA runtime's supported APIs and first-call instructions. Leave unrelated tabs and Safari alone.

## Page tools, when supported

After selecting the tab:

```js
const webmcp = await tab.capabilities.get('webmcp');
const tools = await webmcp.fetchTools();
nodeRepl.write(tools.description());
// Follow the discovered schema: await tools.call(name, arguments).
```

Some models in the Codex browser runtime cannot call WebMCP. If discovery reports an unsupported command, use the plain UI route below. This is a model capability limit, not evidence of an old host. Do not repeat discovery or switch to a file chooser.

| Tool | Arguments and role |
| --- | --- |
| `publish_geist_artifact` | `requestId`, `title`, small source `html`, optional `note`; add `artifactId` and `baseRevisionId` for revisions. The host fills the empty Geist foundation slot and verifies the stored hash. |
| `get_editable_artifact` | `artifactId`, optional `revisionId`; metadata and small source, stripping only the recognized standard foundation. |
| `get_artifact` | `artifactId`, optional `revisionId`, optional `includeHtml`; metadata by default. |
| `get_review_context` | `artifactId`; original comments, targets, captured state, history, and events. |
| `create_review_batch` | `artifactId`; snapshot open comments before editing and retain `batchId`. |
| `mark_addressed` | `threadId`, `revisionId`, `batchId`, `requestId`, `body`; record handled feedback while leaving the human note open. |
| `reply_to_comment` | `threadId`, `requestId`, `body`; agent reply, no resolution. |
| `publish_artifact` | Same publication arguments, but `html` is already fully packed and stays byte-exact. |
| `open_publisher` | `{}`; open this page's publication dialog. |
| `list_artifacts` | `{}`; locate only the requested artifact. |

Never add `action` to tool arguments. Pass HTML text, not a file path. Resolve relative result URLs against the selected Site origin. Keep a tool handle until it becomes stale; refetch after navigation when needed.

## Plain UI route

Use the small editable source with `<style id="oa-foundation"></style>`. Do not pack fonts into it. The publication form fills the empty slot automatically.

- **New artifact:** Open `/publish` on the same origin as the library returned by `route.py` → fill Title → paste the small source into Paste HTML → Publish artifact. This authenticated page opens the publication form; the library has no creation button. Stay on the routed host; do not guess another host or endpoint.
- **Revision:** Comments icon → View all comments → Artifact options → Publish revision. The form starts with small editable HTML for standard Geist artifacts. Read that source, preserve its other content, paste the revised source, and publish. Unknown or custom foundations require preserving the original through a supported exact-file workflow; do not substitute the default theme.
- **Read comments:** Comments icon → View all comments. Expand Captured context only when needed. A read-only request must stop here.

Read fresh AX state at each step. Plain UI supports publication, revisions, and reading comments; review batches and labeled agent addressed events require WebMCP. When that capability is unavailable, leave the notes open and say that no addressed event was recorded. Never use Resolve note as a substitute.

Do not use the automated file chooser: it stalls in the tested browser runtime. If a host does not accept small source or supply editable revision HTML, report that the host needs updating rather than uploading font data or waiting repeatedly.

## Verification

The iframe is titled Artifact preview. Test with Comments mode off; that mode intentionally captures clicks. Use real pointer or keyboard interactions and the accessibility tree, plus a screenshot when visual confirmation is needed. Keep the sandbox and CSP intact. Read the displayed revision or tool metadata before reporting a link; uncertain publication means inspect history before retrying. Mark the final result tab as a deliverable.
