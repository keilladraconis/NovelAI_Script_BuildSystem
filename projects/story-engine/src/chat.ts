import {
  OnBudgetWaitCallback,
  createContinueModalCallback,
  hyperGenerateText,
} from "./hyper-generator";

const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

export class Chat {
  messages: Message[] = [];
  isGenerating = false;

  // Hooks
  onUpdate = () => {};
  onBudgetWait: OnBudgetWaitCallback = () => true;

  CHAT_HISTORY_KEY = "kse-chat-history";

  load = () =>
    get(this.CHAT_HISTORY_KEY)
      .then((history) => (this.messages = JSON.parse(history)))
      .catch(() => (this.messages = []));

  save = () =>
    set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages)).then(
      this.onUpdate,
    );

  initial = () => {
    this.messages = [];
    this.isGenerating = false;
    getConfig("system_prompt")
      .then((system_prompt: string) => this.addMessage("system", system_prompt))
      .then(this.save);
  };

  generateId = () => Math.random().toString(36).substring(2, 9);

  addMessage = (role: Message["role"], content: string) => {
    this.messages.push({
      role,
      content,
    });
    this.save();
  };

  streamMessage = (text: string, final: boolean) => {
    const lastMessage = this.messages[this.messages.length - 1];
    lastMessage.content = lastMessage.content + text;
    if (final) {
      set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages));
    }
    this.onUpdate();
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

    this.isGenerating = true;
    const signal = await api.v1.createCancellationSignal();
    // Add an empty assistant message
    this.addMessage("assistant", "");
    hyperGenerateText(
      messages,
      {
        minTokens: 50,
        maxTokens: 350,
        onBudgetWait: createContinueModalCallback(signal),
      },
      this.streamMessage,
      "blocking",
      signal,
    )
      .catch((error) => api.v1.log("Generation failed:", error))
      .finally(() => {
        this.isGenerating = false;
        this.onUpdate();
      });
  };

  sendMessage = (content: string) => {
    if (content.trim().length > 0) this.addMessage("user", content);
    this.generateResponse();
  };
}
