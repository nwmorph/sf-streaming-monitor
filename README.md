# SF Streaming Monitor

A Visual Studio Code extension for subscribing to — and publishing on — Salesforce Streaming API channels in real time, directly from your editor. Built on the [Salesforce Pub/Sub API](https://developer.salesforce.com/docs/platform/pub-sub-api/overview) (gRPC).

[![Latest Release](https://img.shields.io/github/v/release/nwmorph/sf-streaming-monitor?label=Download%20latest%20.vsix&style=for-the-badge)](https://github.com/nwmorph/sf-streaming-monitor/releases/latest)

> **Quick install:** Click the badge above → expand **Assets** → download `sf-streaming-monitor-x.x.x.vsix` → in VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX…**

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

## Requirements

| Requirement | Details |
|---|---|
| VS Code | 1.85 or later |
| Salesforce CLI | `sf` (v2) installed and at least one org authenticated via `sf org login` |
| Node.js | 18 or later (used at extension build time only) |
| Network | Outbound access to `api.pubsub.salesforce.com:7443` (gRPC / HTTP/2) |

> **Corporate proxy note:** The Pub/Sub API uses a long-lived HTTP/2 stream on port 7443. Some corporate proxies allow HTTPS (443) but silently drop this connection. If you see "Connected — 0 events", check with your network team.

---

## Installation

### Option A — Install the `.vsix` package (recommended for colleagues)

1. Go to the [**latest release**](https://github.com/nwmorph/sf-streaming-monitor/releases/latest) on GitHub
   — always use the latest release, it has the most recent fixes
2. Scroll down to **Assets** and click `sf-streaming-monitor-x.x.x.vsix` to download it
3. Open **VS Code**
4. Open the Command Palette (`Cmd+Shift+P` on Mac / `Ctrl+Shift+P` on Windows)
5. Type and run **Extensions: Install from VSIX…**
6. Select the downloaded `.vsix` file
7. Click **Reload** when prompted

> No Node.js, no build tools — just VS Code and the `.vsix` file.

### Option B — Build from source

```bash
# 1. Clone the repository
git clone https://github.com/nwmorph/sf-streaming-monitor.git
cd sf-streaming-monitor

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile

# 4. Package into a .vsix (requires vsce)
npm install -g @vscode/vsce
vsce package

# 5. Install the generated .vsix (see Option A, step 2–6)
```

---

## Building the `.vsix` for distribution

```bash
npm install
npm run compile
npx @vscode/vsce package
# → sf-streaming-monitor-0.1.0.vsix
```

Send the `.vsix` file to colleagues — they only need VS Code to install it (no Node.js required at runtime).

---

## Getting Started

1. **Authenticate your org** (if not already done):
   ```bash
   sf org login web --alias myOrg
   ```

2. Open the Command Palette and run **Salesforce: Open Streaming Monitor**

3. Click **Select Org** and choose your org from the picker

4. Type a channel in the input (e.g. `/event/MyEvent__e`) and click **Add**, or use **Discover Channels** to browse

5. Choose a **Replay** option:
   - *New only (−1)* — receive only events published after you subscribe
   - *All retained (−2)* — replay all events still in the event bus (up to 72 hours)

6. Click **Subscribe**

---

## Publishing an Event

1. Click **Publish Event** in the toolbar (enabled once an org is selected)
2. Select the Platform Event from the dropdown — the list shows only events your org allows you to publish
3. The payload textarea is pre-filled with a schema-correct template; edit the field values you need
4. Click **Publish** — the result shows the replayId on success

---

## Views

### List view
Each received event appears as a collapsible card showing channel, type badge, timestamp, and decoded payload. Use the **Payload / Full** toggle in the status bar to switch all cards between the payload fields only and the complete envelope.

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
│   └── orgManager.ts         # Org credential resolution via @salesforce/core
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
# Watch mode — recompiles on every save
npm run watch

# Then press F5 in VS Code to launch the Extension Development Host
```

Changes to `media/main.js` and `media/main.css` take effect after reloading the webview (close and reopen the panel) — no recompile needed for those files.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Connected — 0 events" | `replay_preset=0` (LATEST) with no recent events | Switch Replay to *All retained (−2)* |
| "Connected — 0 events" after replay change | Corporate proxy blocking port 7443 | Check Output channel for stream errors; raise with network team |
| `invalid "long": undefined` on publish | Schema has required fields not in payload | Use the auto-generated template; it fills all required fields |
| `Not subscribed to /event/...` | Platform Event not visible to this user | Check field-level security and platform event settings in Setup |
| Org not appearing in picker | Not authenticated | Run `sf org login web --alias myAlias` |

---

## License

MIT
