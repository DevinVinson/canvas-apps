# Pixel Agents

A living pixel office for OpenHands Agent Canvas. Every character represents a real conversation on the selected Agent Server backend. The app reuses [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)' office engine and artwork.

## Install

In **Customize → Apps → Add App**, use this repository as the source and `pixel-agents` as the path. Enable **Pixel Agents** and open its page.

For local development, install this directory's absolute path. A remote backend needs the app on its own filesystem, or a Git source containing it. No backend URLs or credentials are embedded in the bundle.

## Use

- **Office view** fills the page. **Agents** and **Agent desk** open floating panels; close them with × or Escape. **Split view** restores the three-column layout. View preferences persist per backend.
- Click a character or roster entry to see conversation messages, actual tool calls/results, workspace, model, and accumulated spend.
- Send a follow-up from the desk. Conversations explicitly using `NeverConfirm` resume automatically. For approval-enabled or unknown policies, messages are saved without running; **Review & continue** opens the full conversation for approvals. The app rechecks backend policy before sending or resuming.
- **New agent** uses the selected backend's current settings and an absolute workspace path on that backend. Encrypted settings are forwarded without storing model credentials. Confirmation mode, security analyzer, iteration limit, and configured tools are preserved, including an explicitly empty tool list. Missing confirmation settings require approvals.
- Pause an agent or open its full conversation. Pausing the office animation does not pause agents.
- Add existing conversations through **All conversations** and `+`. **Remove from office** hides the character and does not delete the conversation.
- Zoom or fit the room. The office uses the available host height and gives the scene more room when panels are tucked away.

The latest 100 conversations are searched; up to 24 characters are shown. Six recent conversations appear by default, and running conversations or agents created here join automatically unless hidden. Changes poll every three seconds after the previous poll completes, so brief tool calls may fall between polls. Selected and running conversations load their latest 30 events; the desk displays the latest 12 relevant events.

Office preferences live in browser-local storage scoped by app name and backend. Mutable state is never written into the installed app directory. Conversation/tool state remains in OpenHands. No CLI, sidecar, extra service, or Claude Code installation is required.

## Build

Node.js 20+ and npm:

```sh
npm ci --ignore-scripts
npm run check
```

The checked-in `extension.js` is one browser ESM bundle (about 1.2 MB), including React, CSS, decoded sprites, and runtime code. There are no external imports, chunks, image requests, or sibling runtime assets. `canvas-extension.json` declares the office page, including nested conversation routes. The app calls existing authenticated APIs through `host.agentServer.request()`.

Build regenerates `src/assets.json` and `build-meta.json` (both ignored). Rebuild and reinstall the app before reloading Canvas, since the installer copies the bundle.

## Verification

Tested locally on Agent Canvas **1.25.0** and Agent Server/SDK **1.53.0**. `npm run check` covers activity parsing, encrypted creation payloads, approval-preserving controls, persisted-message capacity failures, rename partial success, one-output packaging, nested route mount/navigation, action-error persistence, view switching, unmount cleanup, and remounting.

Local acceptance checklist:

- [x] Build and install from the app's absolute path; enable.
- [x] Real host loads the authenticated Blob module and renders sprites without external asset requests.
- [x] Start an agent with real terminal/file-editor tools; observe its file creation and tool-verified result.
- [x] Send a follow-up, observe the resulting file change, and inspect the file independently.
- [x] Pause/resume a conversation; open its native Canvas chat.
- [x] Check desktop/narrow layouts, expanded office, floating panels, character selection, and split view.
- [x] Reload and retain office/view preferences; hide and restore a conversation.
- [x] Disable, re-enable, and reopen the app.

## Scope

Includes rendering, walking, pathfinding, seating, bundled furniture/artwork, real conversation monitoring, and task interaction. Furniture/layout editing, pet controls, custom asset packs, RTS controls, team grouping, and agent modification of office layouts are not included. Agent-to-app updates are polled conversation state and tool results; this app adds no new Canvas callback API.

AWS deployment was not part of local acceptance. The bundle uses the active Canvas backend rather than a hard-coded server.

## Attribution

Vendored Pixel Agents revision: `d1e007a9fdf3003c252d2973abe1999ae59aec33` (1.4.1). Copyright © 2026 Pablo De Lucca, [MIT license](LICENSE.pixel-agents). The upstream engine, assets, and retained supporting sources are under `vendor/`; Canvas-specific code is in `src/` and `scripts/build.ts`. Unused upstream UI modules are excluded from the runtime bundle. React's license notice is retained in the bundled output.
