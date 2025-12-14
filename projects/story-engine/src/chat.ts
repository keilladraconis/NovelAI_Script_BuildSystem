import { robustGenerate } from "./generation";

const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

export class Chat {
  messages: Message[] = [];
  isGenerating = false;
  onGenerate = () => {};

  CHAT_HISTORY_KEY = "kse-chat-history";

  constructor() {
    get(this.CHAT_HISTORY_KEY)
      .then((history) => (this.messages = JSON.parse(history)))
      .catch(() => (this.messages = []));
  }

  initial = () => {
    this.messages = [];
    this.isGenerating = false;
    getConfig("system_prompt")
      .then((system_prompt: string) => this.addMessage("system", system_prompt))
      .finally(this.onGenerate);
  };

  generateId = () => Math.random().toString(36).substring(2, 9);

  addMessage = (role: Message["role"], content: string) => {
    this.messages.push({
      role,
      content,
    });
    set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages));
  };

  generateResponse = async () => {
    // Build conversation history for AI
    const messages: Message[] = [
      ...this.messages,
      {
        role: "user",
        content: "Continue the conversation. /nothink",
      },
      {
        role: "assistant",
        content: "<think></think>Understood.\n[Continuing:]",
      },
    ];

    const params = await api.v1.generationParameters.get();

    this.isGenerating = true;
    this.onGenerate();
    robustGenerate(messages, params, "Story Engine Chat")
      .then((response) => this.addMessage("assistant", response))
      .catch((error) => api.v1.log("AI generation failed:", error))
      .finally(() => {
        this.isGenerating = false;
        this.onGenerate();
      });
  };

  sendMessage = (content: string) => {
    this.addMessage("user", content);
    this.generateResponse();
  };
}
