import assert from "node:assert/strict";
import test from "node:test";
import { broadcastSettingsUpdated } from "../settingsSync";

function createPanel() {
  const messages: unknown[] = [];
  return {
    messages,
    panel: {
      webview: {
        postMessage(message: unknown): boolean {
          messages.push(message);
          return true;
        }
      }
    }
  };
}

test("broadcasts updated passband settings to every preview panel", async () => {
  const first = createPanel();
  const second = createPanel();
  const settings = {
    presets: [{ label: "2-4 GHz", startGHz: 2, stopGHz: 4 }],
    defaultPresetLabel: "2-4 GHz"
  };

  await broadcastSettingsUpdated([first.panel, second.panel], settings);

  assert.deepEqual(first.messages, [{ type: "settingsUpdated", settings }]);
  assert.deepEqual(second.messages, [{ type: "settingsUpdated", settings }]);
});

test("keeps operation status on the source preview only", async () => {
  const source = createPanel();
  const other = createPanel();
  const settings = {
    presets: [{ label: "1-10 GHz", startGHz: 1, stopGHz: 10 }],
    defaultPresetLabel: "1-10 GHz"
  };

  await broadcastSettingsUpdated([source.panel, other.panel], settings, source.panel, "Preset saved: 1-10 GHz");

  assert.deepEqual(source.messages, [{ type: "settingsUpdated", settings, status: "Preset saved: 1-10 GHz" }]);
  assert.deepEqual(other.messages, [{ type: "settingsUpdated", settings }]);
});
