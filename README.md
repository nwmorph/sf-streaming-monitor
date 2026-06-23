# SF Streaming Monitor

A Visual Studio Code extension for subscribing to — and publishing on — Salesforce Streaming API channels in real time, directly from your editor. Built on the [Salesforce Pub/Sub API](https://developer.salesforce.com/docs/platform/pub-sub-api/overview) (gRPC).

> **Quick install:** [Download latest .vsix](https://github.com/nwmorph/sf-streaming-monitor/releases/latest) → expand **Assets** → download `sf-streaming-monitor-x.x.x.vsix` → in VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX…**

---

## Features

- **Subscribe** to Platform Events, Change Data Capture (CDC) topics, and Generic Streaming channels
- **Two views** — a scrolling **List** of event cards, or an interactive **Timeline** with dots plotted on a time axis
- **Timeline clustering** — nearby events merge into a single dot with a count badge; click to page through each event with ‹ › arrows
- **Timeline windows** — filter to All, 1 day, 12 hr, 6 hr, 3 hr, 1 hr, 30 min, or 10 min; auto-refreshes as time advances
- **Channel legend** — colour-coded per channel, displayed in the timeline toolbar
- **Replay control** — subscribe from the latest event only, or replay all retained events
- **Payload / Full toggle** — switch all cards simultaneously between the decoded payload and the full envelope (channel, replayId, schemaId, eventId, receivedAt, payload)
- **Publish events** — send a Platform Event to your org directly from the extension; schema is fetched live and a correctly-typed template pre-fills the payload editor
- **Org picker** — select any authenticated Salesforce org from your local `~/.sfdx` credentials; auto-detects the default org from a Salesforce DX workspace
- **Channel discovery** — browse all Platform Event and CDC topics available in the org
- **Diagnostic Output channel** — every gRPC call is logged to the *SF Streaming Monitor* Output channel for easy debugging

---

## Platform support

> **macOS only (for now).** The extension reads Salesforce credentials by invoking `@salesforce/core` from the Salesforce CLI's installation at `/usr/local/lib/sf/`. This path is macOS-specific. Windows/Linux support is planned — if you need it, please [open an issue](https://github.com/nwmorph/sf-streaming-monitor/issues).

---

## Requirements

| Requirement | Details |
|---|---|
| OS | macOS (see Platform support above) |
| VS Code | 1.85 or later |
| Salesforce CLI | `sf` (v2) — install from [developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli) |
| Network | Outbound access to `api.pubsub.salesforce.com:7443` (gRPC / HTTP/2) |

> **Node.js is not required to run the extension.** All dependencies are bundled inside the `.vsix`. Node.js is only needed if you want to [build from source](#option-b--build-from-source).

> **Corporate proxy / VDI note:** The Pub/Sub API uses gRPC over HTTP/2 on port 7443. Corporate proxies that perform SSL/TLS inspection or that only allow HTTP/1.1 will reset the connection before it completes. Symptoms: `ECONNRESET`, `14 UNAVAILABLE: No connection established`, or "Connected — 0 events".
>
> **IT ticket wording:** *"Please whitelist `api.pubsub.salesforce.com:7443` (TCP) for outbound access and exempt it from SSL inspection. This is a Salesforce Pub/Sub gRPC endpoint that requires HTTP/2. Reference: https://developer.salesforce.com/docs/platform/pub-sub-api/overview"*

---

## Installation

### Option A — Install the `.vsix` package (recommended)

1. Go to the [**latest release**](https://github.com/nwmorph/sf-streaming-monitor/releases/latest) on GitHub and download `sf-streaming-monitor-x.x.x.vsix`
2. Open **VS Code**
3. Open the Command Palette (`Cmd+Shift+P` on Mac / `Ctrl+Shift+P` on Windows)
4. Type and run **Extensions: Install from VSIX…**
5. Select the downloaded `.vsix` file and click **Reload** when prompted

> No Node.js, no build tools — just VS Code and the Salesforce CLI.

### Option B — Build from source

Requires **Node.js 18+**.

```bash
git clone https://github.com/nwmorph/sf-streaming-monitor.git
cd sf-streaming-monitor
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --skip-license
# → sf-streaming-monitor-x.x.x.vsix  (install as in Option A)
```

---

## Getting Started

### Step 1 — Authenticate your Salesforce org

If you haven't already, log in with the Salesforce CLI:

```bash
# Production / Developer org
sf org login web --alias myOrg

# Sandbox
sf org login web --alias myOrg --instance-url https://test.salesforce.com
```

This stores credentials in `~/.sfdx/` where the extension can find them. You only need to do this once per org.

### Step 2 — Open the extension

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

```
SF Streaming Monitor: Open
```

### Step 3 — Select your org

Click **Select Org** in the toolbar and choose the org from the dropdown. If you're working inside a Salesforce DX project folder, the default org is selected automatically.

### Step 4 — Add a channel

Type a channel name in the input box and click **Add**, for example:
- `/event/MyPlatformEvent__e` — Platform Event
- `/data/AccountChangeEvent` — Change Data Capture for Account
- `/topic/MyPushTopic` — Generic Streaming

Or click **Discover Channels** to browse all Platform Events and CDC topics available in your org.

### Step 5 — Choose replay mode and subscribe

| Replay option | What it does |
|---|---|
| New only (−1) | Receive only events published after you click Subscribe |
| All retained (−2) | Replay all events still in the event bus (up to 72 hours back) |

Click **Subscribe** — the status dot turns green and events start appearing.

---

## Publishing an Event

1. Click **Publish Event** in the toolbar (enabled once an org is selected)
2. Select the Platform Event from the dropdown — the list shows only events your org allows you to publish
3. The payload textarea is pre-filled with a schema-correct template; edit the field values you need
4. Click **Publish** — the result shows the replayId on success

---

## Views

### List view
Each received event appears as a collapsible card showing channel, type badge, timestamp, and decoded payload. Use the **Payload / Full** toggle in the status bar to switch all cards between the payload fields only and the complete envelope. Consecutive events on the same channel are visually grouped — the channel name is shown in full on the first card and as a muted label on subsequent cards, reducing noise in high-volume streams.

### Timeline view
Events are plotted as coloured dots on a horizontal time axis. Events that fall within 1.5% of each other on the track are clustered into a single dot with a count badge.

- **Click a dot** to open an inline tooltip with Payload/Full toggle, Copy, and ‹ › navigation for clusters
- **Click the same dot again** to close the tooltip
- **Window filter** (All → 1 day → … → 10 min) restricts what's shown; windowed modes auto-refresh every 15–60 seconds
- **Legend** shows which colour belongs to which channel

---

## Output Channel (Diagnostics)

Open the **Output** panel (`View → Output`) and select **SF Streaming Monitor** from the dropdown. Every gRPC call — GetTopic, GetSchema, Subscribe stream lifecycle, keep-alives, and event counts — is logged with timestamps.

---

## Project Structure

```
sf-streaming-monitor/
├── src/
│   ├── extension.ts          # Extension entry point, Output channel
│   ├── streamingPanel.ts     # Webview panel, message routing
│   ├── streamingClient.ts    # gRPC Pub/Sub client, publish, schema helpers
│   └── orgManager.ts         # Org credential resolution via SF CLI's @salesforce/core
├── media/
│   ├── main.js               # Webview UI logic
│   └── main.css              # Webview styles (VS Code theme variables)
├── proto/
│   └── pubsub_api.proto      # Salesforce Pub/Sub API protobuf definition
├── out/                      # Compiled JS (git-ignored)
└── package.json
```

---

## Development

```bash
# One-off build
npm run compile

# Watch mode — rebuilds on every save (esbuild incremental)
npm run watch

# Then press F5 in VS Code to launch the Extension Development Host
```

Changes to `media/main.js` and `media/main.css` take effect after reloading the webview (close and reopen the panel) — no recompile needed for those files.

### Building the `.vsix` for distribution

```bash
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --skip-license
# → sf-streaming-monitor-x.x.x.vsix (~220 KB)
```

The `.vsix` contains only the bundled extension. Recipients only need VS Code and the Salesforce CLI (`sf`) — no Node.js or npm required.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Connected — 0 events" | `replay_preset=0` (LATEST) with no recent events | Switch Replay to *All retained (−2)* |
| "Connected — 0 events" after replay change | Corporate proxy blocking port 7443 | Check Output channel for stream errors; raise with network team |
| `ECONNRESET` / `14 UNAVAILABLE: No connection established` | Port 7443 blocked by VDI or corporate firewall | IT must allow outbound TCP to `api.pubsub.salesforce.com:7443`. Test with: `curl -v --max-time 10 https://api.pubsub.salesforce.com:7443` |
| `invalid "long": undefined` on publish | Schema has required fields not in payload | Use the auto-generated template; it fills all required fields |
| `Not subscribed to /event/...` | Platform Event not visible to this user | Check field-level security and platform event settings in Setup |
| Org not appearing in picker | Not authenticated | Run `sf org login web --alias myAlias` |

---

## Credits

Created by **[Niklas Waller](https://github.com/nwmorph)** — product owner, architect, and domain expert who conceived the extension and directed its development against real Salesforce orgs.

Source code written with the assistance of [Claude](https://claude.ai) (Anthropic) acting as a coding agent under Niklas's direction.

See [CREDITS.md](CREDITS.md) for full details.

---

## License

MIT
