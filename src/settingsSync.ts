export interface SettingsWebviewLike {
  postMessage(message: unknown): PromiseLike<boolean> | boolean;
}

export interface SettingsPanelLike {
  webview: SettingsWebviewLike;
}

export async function broadcastSettingsUpdated<TPanel extends SettingsPanelLike>(
  panels: Iterable<TPanel>,
  settings: unknown,
  statusPanel?: TPanel,
  status?: string
): Promise<void> {
  const messages: Array<PromiseLike<boolean> | boolean> = [];

  for (const panel of panels) {
    messages.push(panel.webview.postMessage({
      type: "settingsUpdated",
      settings,
      ...(panel === statusPanel && status ? { status } : {})
    }));
  }

  await Promise.all(messages);
}
