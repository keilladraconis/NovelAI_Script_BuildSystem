// Scenario Engine

import { Chat } from "./chat";
import { ChatUI } from "./ui";

/**
 * Utilities
 */

const setInterval = (
  callback: Function,
  interval: number,
): (() => Promise<void>) => {
  let timerId: number;

  const tick = async () => {
    timerId = await api.v1.timers.setTimeout(() => {
      callback(clear);
      tick();
    }, interval);
  };

  const clear = async () => api.v1.timers.clearTimeout(timerId);

  tick();

  return clear;
};

(async () => {
  const ui = new ChatUI();
  const chat = new Chat();
  await chat.load();

  let waiting = 0;
  let interactionNeeded = false;

  ui.onSendMessage = (text) => chat.sendMessage(text);
  ui.onClear = chat.initial;

  const updatePanel = () =>
    ui.updatePanel(chat.messages, {
      isGenerating: chat.isGenerating,
      waiting,
      interactionNeeded,
    });

  // chat.onBudgetWait = (_available, _needed, time) => {
  //   interactionNeeded = true;
  //   const epoch = Date.now();
  //   const then = new Date(epoch + time).getTime();
  //   setInterval((clear: Function) => {
  //     const now = Date.now();
  //     if (now < then) {
  //       waiting = Math.floor((then - now) / 1000);
  //     } else {
  //       waiting = 0;
  //       clear();
  //     }
  //     updatePanel();
  //   }, 1000);
  // };
  chat.onUpdate = updatePanel;
  ui.onInteract = () => (interactionNeeded = false);

  ui.register();
  updatePanel();
})();
