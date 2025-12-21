// Scenario Engine

import { Chat } from "./chat";
import { ChatUI } from "./ui";

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
  const ui = new ChatUI();
  const chat = new Chat();
  await chat.load();

  let waiting = 0;
  let interactionNeeded = false;

  ui.onSendMessage = (text) => chat.sendMessage(text);
  ui.onBrainstorm = () => chat.brainstorm();
  ui.onClear = chat.initial;

  const updatePanel = () =>
    ui.updatePanel(chat.messages, {
      isGenerating: chat.isGenerating,
      waiting,
      interactionNeeded,
    });

  chat.onUpdate = updatePanel;
  ui.onInteract = () => (interactionNeeded = false);

  ui.register();
  updatePanel();
})();
