// Scenario Engine

import { Chat } from "./chat";
import { ChatUI } from "./ui";

// Helpers
const log = api.v1.log;

(async () => {
  try {
    const ui = new ChatUI();
    const chat = new Chat();
    await chat.load();

    // Wiring the UI to the Chat state
    ui.onSendMessage = chat.handleSendMessage;
    ui.onClear = chat.handleClear;
    ui.onCancel = chat.handleCancel;
    ui.onAgentSelect = chat.handleAgentSwitch;
    ui.onAuto = chat.handleAuto;
    chat.onUpdate = ui.render.bind(ui);
    chat.onBudgetWait = async () => ui.handleBudgetWait();

    ui.register();
    ui.render(chat);
  } catch (e) {
    log("Startup error:", e);
  }
})();
