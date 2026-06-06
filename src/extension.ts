import * as vscode from "vscode";
import { StreamingMonitorPanel } from "./streamingPanel";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("SF Streaming Monitor");
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand("sfStreaming.openMonitor", () => {
      StreamingMonitorPanel.createOrShow(context.extensionUri, outputChannel);
    }),

    vscode.commands.registerCommand("sfStreaming.selectOrg", () => {
      if (StreamingMonitorPanel.currentPanel) {
        void StreamingMonitorPanel.currentPanel.selectOrg();
      } else {
        StreamingMonitorPanel.createOrShow(context.extensionUri, outputChannel);
      }
    })
  );
}

export function deactivate(): void {
  // Extension host cleans up via disposables
}
