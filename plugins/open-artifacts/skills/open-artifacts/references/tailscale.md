# Tailscale

Use the configured `open_artifacts_tailscale` native MCP server. The portable `client.py` uses the same connection over HTTPS or local stdio. No browser or Sites tools are needed. Commands below use script filenames; resolve them to absolute paths under this installed plugin’s `scripts` directory. Native tools always target Tailscale, even when Sites is the default for new artifacts.

## Publish

```sh
python3 /path/to/open-artifacts/scripts/artifact.py pack source.html artifact.html
python3 /path/to/open-artifacts/scripts/client.py publish artifact.html
```

The client uses the HTML title, saves a request ID beside the file, and verifies the stored file hash. Retry the same command after an uncertain result, keeping the file, arguments, and `.publish.json` receipt unchanged. Changed work uses a fresh publication filename. Never print embedded font data into model context.

## Read and revise

Use native `get_artifact` and `get_review_context` for metadata, current revision, comments, and original targets/state. Or use these read-only file commands:

```sh
python3 /path/to/open-artifacts/scripts/client.py review ARTIFACT_ID
python3 /path/to/open-artifacts/scripts/client.py download ARTIFACT_ID original.html --revision-id REVISION_ID
```

Interpret each thread's decoded `review_target` using `review-targets.md`. Exact quotes, element labels, captured offsets, and area coverage can identify feedback without a browser. `is_from_earlier_revision` compares the target's revision with the artifact's current revision; native tools do not inspect live layout. Empty, partial, truncated, unlabeled graphic, or legacy targets may require the original source or clarification. Do not infer unseen contents or claim a current placement match from coordinates alone.

1. Read the current revision and review context. An explicit older revision remains historical context; do not publish against it blindly. For feedback edits, call `create_review_batch` and retain its `batchId`. A read-only request stops before this step.
2. Edit a fresh copy, preserving unrelated content, custom styles, and meaningful anchors. `pack` preserves an existing foundation. Never overwrite the original.
3. Publish to the same artifact using the current revision observed before editing:

   ```sh
   python3 /path/to/open-artifacts/scripts/client.py publish revised.html --artifact-id ARTIFACT_ID --base-revision-id REVISION_ID
   ```

4. Call `mark_addressed` for each handled comment with `threadId`, `batchId`, the new `revisionId`, a fresh UUID `requestId`, and a brief explanation. The human note stays open. Do not reply between creating the batch and marking it addressed: that changes the note version.
5. Read back the new revision and review events. A stale-base or changed-comment conflict requires rereading and reconciling; do not force it or create a duplicate artifact.

Native calls can also use `client.py call TOOL --input arguments.json`, so the workflow works in other harnesses with Python even without native tool discovery.

## Connection problems

Use `client.py doctor` or native `probe_identity`. HTTPS needs tailnet access and harness network permission. A sandbox denial is not evidence of a server outage: request the harness’s normal network permission for that command. Stdio needs OS access to the configured server and private settings. Report actual errors; do not change VPN settings, bypass TLS, forge identity headers, or switch to Sites.

Packaging proves structure and a matching hash proves transfer. Verify behavior with suitable checks, and distinguish source checks from actual rendering or interaction. A browser is optional for visual verification, never required for publication or review.
