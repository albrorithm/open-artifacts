# Licensing

The repository is MIT licensed. See the root `LICENSE` file.

## Geist fonts

The plugin bundles `Geist-Variable.woff2` and `GeistMono-Variable.woff2` in `plugins/open-artifacts/assets`. They are copyright Vercel and basement.studio and licensed under the SIL Open Font License 1.1, copied in `OFL.txt` next to them. The MIT license does not cover them.

How the OFL conditions are met, checked 2026-09-15:

- `OFL.txt` ships next to the font files in the source tree and in the plugin ZIP.
- The fonts are distributed only as part of the plugin, never on their own.
- The font files are unmodified upstream releases. No step in the repo subsets or renames them. Geist's OFL declares no Reserved Font Name, so the naming restriction on modified versions does not apply either way.
- There is one copy of the fonts. The host build imports them from the plugin assets directory and inlines them, together with the OFL text as an HTML comment, into each published artifact. The packer script does the same for Tailscale publications.
- Both READMEs state that the fonts carry their own license.
