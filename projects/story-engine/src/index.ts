// Scenario Engine

import { Chat } from "./chat";
import { ChatUI } from "./ui";

// Helpers
const log = api.v1.log;

/**
 * Utilities
 */

// const setInterval = (
//   callback: Function,
//   interval: number,
// ): (() => Promise<void>) => {
//   let timerId: number;

//   const tick = async () => {
//     timerId = await api.v1.timers.setTimeout(() => {
//       callback(clear);
//       tick();
//     }, interval);
//   };

//   const clear = async () => api.v1.timers.clearTimeout(timerId);

//   tick();

//   return clear;
// };

(async () => {
  try {
    const ui = new ChatUI();
    const chat = new Chat();
    await chat.load();

    ui.onSendMessage = chat.handleSendMessage;
    ui.onBrainstorm = chat.handleBrainstorm;
    ui.onCritic = chat.handleCritic;
    ui.onClear = chat.handleClear;

    const updatePanel = () => ui.updatePanel(chat);

    chat.onUpdate = updatePanel;

    ui.register();
    updatePanel();
  } catch (e) {
    log("Startup error:", e);
  }
})();
