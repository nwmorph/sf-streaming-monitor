import * as vscode from "vscode";
import {
  StreamingMonitorClient,
  StreamingMessage,
  discoverChannels,
  publishEvent,
  getChannelSchemaTemplate,
  ChannelConfig,
  ChannelType,
} from "./streamingClient";
import { listOrgs, getOrgAccessInfo, getDefaultOrgAlias, OrgInfo } from "./orgManager";

type WebviewMessage =
  | { type: "subscribe"; channels: Array<{ channel: string; replayFrom: number }> }
  | { type: "unsubscribe" }
  | { type: "discoverChannels" }
  | { type: "discoverPublishableChannels" }
  | { type: "getSchemaTemplate"; channel: string }
  | { type: "selectOrg" }
  | { type: "clearLog" }
  | { type: "publish"; channel: string; payload: Record<string, unknown> };

export class StreamingMonitorPanel {
  public static currentPanel: StreamingMonitorPanel | undefined;
  private static readonly viewType = "sfStreamingMonitor";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];
  private client: StreamingMonitorClient | null = null;
  private currentOrg: OrgInfo | null = null;

  public static createOrShow(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (StreamingMonitorPanel.currentPanel) {
      StreamingMonitorPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      StreamingMonitorPanel.viewType,
      "SF Streaming Monitor",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        retainContextWhenHidden: true,
      }
    );

    const instance = new StreamingMonitorPanel(panel, extensionUri, outputChannel);
    StreamingMonitorPanel.currentPanel = instance;

    // Auto-detect default org from the open workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const wsPath = workspaceFolders[0].uri.fsPath;
      const alias = getDefaultOrgAlias(wsPath);
      if (alias) {
        getOrgAccessInfo(alias).then((org) => instance.setOrg(org)).catch(() => {
          // silently ignore — user can select manually
        });
      }
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.outputChannel = outputChannel;

    this.update();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "selectOrg":
        await this.selectOrg();
        break;
      case "discoverChannels":
        await this.sendDiscoveredChannels();
        break;
      case "subscribe":
        await this.subscribe(message.channels);
        break;
      case "unsubscribe":
        this.unsubscribe();
        break;
      case "clearLog":
        // handled entirely by webview JS
        break;
      case "discoverPublishableChannels":
        await this.sendPublishableChannels();
        break;
      case "getSchemaTemplate":
        await this.sendSchemaTemplate(message.channel);
        break;
      case "publish":
        await this.publish(message.channel, message.payload);
        break;
    }
  }

  private setOrg(org: OrgInfo): void {
    this.currentOrg = org;
    this.panel.webview.postMessage({
      type: "orgSelected",
      alias: org.alias,
      username: org.username,
    });
  }

  public async selectOrg(): Promise<void> {
    // Read org list from ~/.sfdx files (no token needed for the picker)
    const orgs = listOrgs();

    if (orgs.length === 0) {
      vscode.window.showInformationMessage(
        "No authenticated orgs found in ~/.sfdx/. Run `sf org login` first."
      );
      return;
    }

    const items = orgs.map((o) => ({
      label: o.alias,
      description: o.username !== o.alias ? o.username : undefined,
      username: o.username,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a Salesforce org",
    });
    if (!picked) {
      return;
    }

    // Fetch the decrypted access token via sf CLI
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Connecting to ${picked.label}…` },
      async () => {
        try {
          const org = await getOrgAccessInfo(picked.username);
          this.setOrg(org);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to get org credentials: ${String(err)}`);
        }
      }
    );
  }

  private isSessionError(err: unknown): boolean {
    const msg = String(err).toUpperCase();
    return msg.includes("INVALID_SESSION_ID") || msg.includes("EXPIRED_ACCESS") || msg.includes("AUTHENTICATION_FAILURE");
  }

  private async promptReauth(username: string): Promise<void> {
    const action = await vscode.window.showErrorMessage(
      `Session expired for ${username}. Re-authenticate to continue.`,
      "Re-authenticate",
      "Cancel"
    );
    if (action === "Re-authenticate") {
      const terminal = vscode.window.createTerminal("Salesforce Login");
      terminal.show();
      terminal.sendText(`sf org login web --alias "${username}" || sfdx auth:web:login --setalias "${username}"`);
      // After auth completes, prompt the user to re-select the org so the
      // panel picks up the fresh token.
      const retry = await vscode.window.showInformationMessage(
        "Once login completes in the browser, click Refresh to reconnect.",
        "Refresh"
      );
      if (retry === "Refresh") {
        try {
          const org = await getOrgAccessInfo(username);
          this.setOrg(org);
        } catch (e) {
          vscode.window.showErrorMessage(`Still could not connect: ${String(e)}`);
        }
      }
    }
  }

  private async sendDiscoveredChannels(): Promise<void> {
    if (!this.currentOrg) {
      vscode.window.showWarningMessage("Select an org first.");
      return;
    }
    this.panel.webview.postMessage({ type: "discoveringChannels" });
    try {
      const channels = await discoverChannels(
        this.currentOrg.instanceUrl,
        this.currentOrg.accessToken
      );
      this.panel.webview.postMessage({ type: "channelsDiscovered", channels });
    } catch (err) {
      if (this.isSessionError(err)) {
        this.panel.webview.postMessage({ type: "channelsDiscovered", channels: [] });
        await this.promptReauth(this.currentOrg.username);
      } else {
        this.panel.webview.postMessage({
          type: "error",
          message: `Channel discovery failed: ${String(err)}`,
        });
      }
    }
  }

  private async subscribe(
    channelConfigs: Array<{ channel: string; replayFrom: number }>
  ): Promise<void> {
    if (!this.currentOrg) {
      this.panel.webview.postMessage({
        type: "error",
        message: "No org selected.",
      });
      return;
    }

    this.unsubscribe();

    const configs: ChannelConfig[] = channelConfigs.map((c) => ({
      raw: c.channel,
      type: inferType(c.channel),
      replayFrom: c.replayFrom,
    }));

    const log = (msg: string) => {
      const ts = new Date().toISOString();
      this.outputChannel.appendLine(`${ts}  ${msg}`);
    };
    this.outputChannel.show(true); // show without stealing focus

    this.client = new StreamingMonitorClient({
      extensionPath: this.extensionUri.fsPath,
      instanceUrl: this.currentOrg.instanceUrl,
      accessToken: this.currentOrg.accessToken,
      orgId: this.currentOrg.orgId,
      username: this.currentOrg.username,
      log,
    });

    this.client.on("connected", () => {
      this.panel.webview.postMessage({ type: "subscribed" });
    });

    this.client.on("message", (msg: StreamingMessage) => {
      this.panel.webview.postMessage({ type: "event", event: msg });
    });

    this.client.on("disconnected", () => {
      this.panel.webview.postMessage({ type: "unsubscribed" });
    });

    this.client.on("error", (err: string) => {
      if (this.isSessionError(err) && this.currentOrg) {
        this.panel.webview.postMessage({ type: "error", message: err });
        void this.promptReauth(this.currentOrg.username);
      } else {
        this.panel.webview.postMessage({ type: "error", message: err });
      }
    });

    try {
      this.client.connect(configs);
    } catch (err) {
      this.panel.webview.postMessage({
        type: "error",
        message: `Connect failed: ${String(err)}`,
      });
    }
  }

  private async sendSchemaTemplate(channel: string): Promise<void> {
    if (!this.currentOrg) { return; }
    try {
      const template = await getChannelSchemaTemplate({
        extensionPath: this.extensionUri.fsPath,
        instanceUrl: this.currentOrg.instanceUrl,
        accessToken: this.currentOrg.accessToken,
        orgId: this.currentOrg.orgId,
        channel,
      });
      this.panel.webview.postMessage({ type: "schemaTemplate", channel, template });
    } catch (err) {
      this.panel.webview.postMessage({ type: "schemaTemplate", channel, error: String(err) });
    }
  }

  private async sendPublishableChannels(): Promise<void> {
    if (!this.currentOrg) { return; }
    this.panel.webview.postMessage({ type: "publishableChannelsLoading" });
    try {
      const all = await discoverChannels(this.currentOrg.instanceUrl, this.currentOrg.accessToken);
      // discoverChannels already filters to __e (platform events) and ChangeEvent (CDC).
      // Only platform events can be published by external clients.
      const platformEvents = all.filter((c) => c.type === "platform-event");
      this.panel.webview.postMessage({ type: "publishableChannels", channels: platformEvents });
    } catch (err) {
      this.panel.webview.postMessage({ type: "publishableChannels", channels: [], error: String(err) });
    }
  }

  private async publish(channel: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.currentOrg) {
      this.panel.webview.postMessage({ type: "publishResult", ok: false, error: "No org selected." });
      return;
    }
    try {
      const result = await publishEvent({
        extensionPath: this.extensionUri.fsPath,
        instanceUrl: this.currentOrg.instanceUrl,
        accessToken: this.currentOrg.accessToken,
        orgId: this.currentOrg.orgId,
        channel,
        payload,
      });
      this.panel.webview.postMessage({ type: "publishResult", ok: true, replayId: result.replayId });
    } catch (err) {
      this.panel.webview.postMessage({ type: "publishResult", ok: false, error: String(err) });
      if (this.isSessionError(err)) {
        await this.promptReauth(this.currentOrg.username);
      }
    }
  }

  private unsubscribe(): void {
    if (this.client) {
      try { this.client.disconnect(); } catch { /* ignore */ }
      this.client = null;
    }
  }

  public dispose(): void {
    // Clear currentPanel first so a re-open creates a fresh panel
    // rather than trying to reveal the disposed one
    StreamingMonitorPanel.currentPanel = undefined;
    this.unsubscribe();
    try { this.panel.dispose(); } catch { /* already disposed */ }
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];
  }

  private update(): void {
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const mediaPath = vscode.Uri.joinPath(this.extensionUri, "media");
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaPath, "main.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaPath, "main.js")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>SF Streaming Monitor</title>
</head>
<body>
  <div id="app">
    <!-- Toolbar -->
    <div id="toolbar">
      <div id="org-section">
        <button id="btn-select-org" class="btn btn-primary">Select Org</button>
        <span id="org-label" class="org-label">No org selected</span>
      </div>
      <div id="channel-section">
        <button id="btn-discover" class="btn" disabled>Discover Channels</button>
        <div id="channel-input-group">
          <input id="channel-input" type="text" placeholder="/event/MyEvent__e  or  /data/MyObject__ChangeEvent  or  /topic/MyTopic" disabled />
          <button id="btn-add-channel" class="btn" disabled>Add</button>
        </div>
      </div>
      <div id="replay-section">
        <label for="replay-select">Replay:</label>
        <select id="replay-select" disabled>
          <option value="-1">New only (−1)</option>
          <option value="-2">All retained (−2)</option>
        </select>
      </div>
      <div id="action-section">
        <button id="btn-subscribe" class="btn btn-success" disabled>Subscribe</button>
        <button id="btn-unsubscribe" class="btn btn-danger" disabled>Unsubscribe</button>
        <button id="btn-clear" class="btn">Clear</button>
        <button id="btn-publish-open" class="btn" disabled>Publish Event</button>
      </div>
    </div>

    <!-- Channel list -->
    <div id="channel-list-container">
      <div id="channel-list-label">Channels to subscribe:</div>
      <div id="channel-chips"></div>
    </div>

    <!-- Discover modal -->
    <div id="discover-modal" class="modal hidden">
      <div class="modal-content">
        <div class="modal-header">
          <span>Available Channels</span>
          <button id="btn-modal-close" class="btn-icon">✕</button>
        </div>
        <div id="discover-loading" class="spinner-row hidden"><span class="spinner"></span> Discovering…</div>
        <div id="discover-filters">
          <button class="filter-btn active" data-type="all">All</button>
          <button class="filter-btn" data-type="platform-event">Platform Events</button>
          <button class="filter-btn" data-type="cdc">CDC</button>
        </div>
        <div id="discover-search-row">
          <input id="discover-search" type="text" placeholder="Filter…" />
        </div>
        <ul id="discover-list"></ul>
        <div class="modal-footer">
          <button id="btn-add-selected" class="btn btn-primary">Add Selected</button>
        </div>
      </div>
    </div>

    <!-- Publish modal -->
    <div id="publish-modal" class="modal hidden">
      <div class="modal-content">
        <div class="modal-header">
          <span>Publish Event</span>
          <button id="btn-publish-modal-close" class="btn-icon">✕</button>
        </div>
        <div id="publish-form">
          <label class="publish-label">Channel</label>
          <div id="publish-channel-wrap">
            <select id="publish-channel" class="publish-select" disabled>
              <option value="">Loading events…</option>
            </select>
            <span id="publish-channel-spinner" class="spinner"></span>
          </div>
          <label class="publish-label">Payload <span class="publish-hint">(JSON object — omit system fields)</span></label>
          <textarea id="publish-payload" class="publish-textarea" spellcheck="false" placeholder='{&#10;  "MyField__c": "value"&#10;}'></textarea>
          <div id="publish-status"></div>
        </div>
        <div class="modal-footer">
          <button id="btn-publish-send" class="btn btn-success">Publish</button>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div id="status-bar">
      <span id="status-dot" class="dot dot-idle"></span>
      <span id="status-text">Idle</span>
      <span id="event-count" class="event-count">0 events</span>
      <div id="envelope-toggle-group">
        <button class="envelope-mode-btn active" data-env="payload">Payload</button>
        <button class="envelope-mode-btn" data-env="full">Full</button>
      </div>
      <div id="view-toggle-group">
        <button class="view-mode-btn active" data-view="list">List</button>
        <button class="view-mode-btn" data-view="timeline">Timeline</button>
      </div>
    </div>

    <!-- Timeline window filter (hidden in list mode) -->
    <div id="timeline-controls" class="hidden">
      <span class="tl-label">Window:</span>
      <button class="tl-window-btn active" data-minutes="0">All</button>
      <button class="tl-window-btn" data-minutes="1440">1 day</button>
      <button class="tl-window-btn" data-minutes="720">12 hr</button>
      <button class="tl-window-btn" data-minutes="360">6 hr</button>
      <button class="tl-window-btn" data-minutes="180">3 hr</button>
      <button class="tl-window-btn" data-minutes="60">1 hr</button>
      <button class="tl-window-btn" data-minutes="30">30 min</button>
      <button class="tl-window-btn" data-minutes="10">10 min</button>
      <div id="tl-legend"></div>
    </div>

    <!-- Event log (list view) -->
    <div id="event-log"></div>

    <!-- Timeline view -->
    <div id="timeline-view" class="hidden">
      <div id="timeline-track-wrap">
        <div id="timeline-track">
          <div id="timeline-axis"></div>
          <div id="timeline-dots"></div>
        </div>
      </div>
      <div id="timeline-empty" class="hidden">No events in this window</div>
    </div>

    <!-- Tooltip (shared, positioned by JS) -->
    <div id="tl-tooltip" class="hidden"></div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function inferType(channel: string): ChannelType {
  if (channel.startsWith("/event/")) return "platform-event";
  if (channel.startsWith("/data/")) return "cdc";
  if (channel.startsWith("/topic/")) return "pushtopic";
  return "generic";
}
