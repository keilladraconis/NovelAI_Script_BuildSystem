import {
  OnBudgetWaitCallback,
  createContinueModalCallback,
  hyperGenerateText,
} from "./hyper-generator";

const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

export class Chat {
  // Properties
  messages: Message[] = [];
  isGenerating = false;
  systemPrompt: string = "";
  brainstormPrompt: string = "";
  criticPrompt: string = "";
  synopsisPrompt: string = "";

  // Hooks
  onUpdate = () => {};
  onBudgetWait: OnBudgetWaitCallback = () => true;

  CHAT_HISTORY_KEY = "kse-chat-history";

  async load() {
    return Promise.all([
      get(this.CHAT_HISTORY_KEY)
        .then((history) => (this.messages = JSON.parse(history)))
        .catch(() => (this.messages = [])),
      getConfig("system_prompt").then(
        (systemPrompt: string) => (this.systemPrompt = systemPrompt),
      ),
      getConfig("brainstorm_prompt").then(
        (brainstormPrompt: string) =>
          (this.brainstormPrompt = brainstormPrompt),
      ),
      getConfig("critic_prompt").then(
        (criticPrompt: string) => (this.criticPrompt = criticPrompt),
      ),
      getConfig("synopsis_prompt").then(
        (synopsisPrompt: string) => (this.synopsisPrompt = synopsisPrompt),
      ),
    ]);
  }

  save() {
    this.messages = this.messages.filter(
      (m) => m.content && m.content.length > 0,
    );
    set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages)).then(
      this.onUpdate,
    );
  }

  initial() {
    this.messages = [];
    this.isGenerating = false;
  }

  generateId() {
    return Math.random().toString(36).substring(2, 9);
  }

  addMessage(role: Message["role"], content: string) {
    this.messages.push({
      role,
      content,
    });
    this.save();
  }

  streamMessage(text: string, final: boolean) {
    const lastMessage = this.messages[this.messages.length - 1];
    lastMessage.content = lastMessage.content + text;
    if (final) {
      set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages));
    }
    this.onUpdate();
  }

  async brainstorm() {
    this.generateResponse(this.brainstormPrompt, 1000);
  }

  private async generateResponse(userMessage: string, length: number) {
    // Build conversation history for AI
    const context: Message[] = [
      ...this.messages,
      {
        role: "user",
        content: `${userMessage} /nothink`,
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
      context,
      {
        minTokens: 50,
        maxTokens: length,
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
  }

  sendMessage(content: string) {
    if (content.trim().length > 0) this.addMessage("user", content);
  }
}
