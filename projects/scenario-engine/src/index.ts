// Scenario Engine

import { Chat } from "./chat";
import { ChatUI } from "./ui";

(async () => {
  const ui = new ChatUI();
  const chat = new Chat();

  ui.onSendMessage = (text) => chat.sendMessage(text);
  ui.onClear = chat.initial;
  chat.onGenerate = () => ui.updatePanel(chat.messages, chat.isGenerating);

  ui.register();
  chat.initial();
  ui.updatePanel(chat.messages, chat.isGenerating);
})();
