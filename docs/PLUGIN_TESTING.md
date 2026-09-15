# Testing

Use synthetic artifacts and isolated storage. Keep prompts, traces, receipts, private endpoints, and deployment-specific results out of the source tree and release packages.

## Automated checks

```sh
npm run test:plugins
npm run test:release
npm run lint
npx tsc --noEmit
```

Plugin checks cover packing, Geist assets, file transfer, retry receipts, host selection, and settings import. Release checks cover unconfigured settings, the explicit file list, symlink rejection, fixed ZIP metadata, and refusal to overwrite an existing release.

The local host scripts (see the README) cover publication, immutable history, concurrent retries, stale revisions, review batches, comment events, and status changes. The self-hosted suite also exercises official HTTP and stdio MCP clients, large Python file transfers, restart persistence, and owner isolation. Build the two targets one at a time.

## Comment placement

```sh
node --experimental-strip-types --test tests/review-target.test.mjs tests/comment-point.test.mjs
node tests/review-selection.browser.mjs /path/to/private-selection-check
node tests/review-area-bridge.browser.mjs /path/to/private-bridge-check
```

Serve the generated pages on loopback and open them in the in-app browser. The selection fixture exercises real DOM ranges, capture limits, partial and empty areas, graphics, ambiguity, and matching after content or layout changes. The bridge fixture exercises the sandboxed message channel with synthetic input, cancellation, click suppression, keyboard corners, and revision-scoped reports.

Also check by hand: mouse and keyboard gestures, the 390px layout, normal scrolling outside area mode, save, reload, and Locate, and comments carried across a major rewrite. Synthetic touch events are not the same as a real touch device. Removed or changed targets must keep their context and revision link while their pins disappear. A frame that has not reported yet shows checking or not checked, never missing.

## Fresh-agent workflow checks

When changing either workflow, test both with fresh agents using a configured test copy of the plugin and a new workspace. Give each agent a short user brief with no implementation history or expected outcome. Grant the network or file permissions the chosen transport needs.

Cover:

- An ordinary create request uses the saved default without asking.
- An explicit host request overrides the default for that request only.
- An existing artifact URL selects its original library, even when it differs from the default.
- A new artifact can receive a revision under the same ID.
- A read-only request makes no mutation calls.
- Feedback edits preserve original targets and human open or resolved status.
- Feedback reads distinguish partial regions, empty regions, and evidence from an earlier revision, and browser-free responses do not claim a live placement match.
- Unknown destinations, conflicting requests, and failed connections do not fall back to the other library.

Use small interactive tasks such as a synthetic checklist followed by a Reset revision. Inspect the raw calls and the resulting artifacts rather than the agent's summary.

## What the evidence shows

Source inspection, structural checks, matching hashes, live interaction, remote authentication, and physical-device checks each establish different things. Check derived values and Reset in the published artifact before claiming behavior works. Stdio success does not prove HTTPS reachability. Loopback fixtures do not prove Tailscale identity handling. A few successful tasks do not establish a model success rate.

Browsers without WebMCP can publish, revise, and read notes through the Sites text-field workflow but cannot create review batches or addressed events. Tailscale exposes the full agent workflow through MCP.
