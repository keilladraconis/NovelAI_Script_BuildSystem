import {
  OnBudgetWaitCallback,
  createContinueModalCallback,
  hyperGenerateText,
} from "./hyper-generator";

const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

export class Chat {
  // Constants
  CHAT_HISTORY_KEY = "kse-chat-history";

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

  // Handlers
  handleClear = () => {
    this.messages = [];
    this.isGenerating = false;
    this.save();
  };

  handleStreamMessage = (text: string, final: boolean) => {
    const messageToAppend = this.messages.at(-1);
    if (messageToAppend !== undefined)
      messageToAppend.content = messageToAppend.content + text;
    if (final) {
      this.save();
    } else {
      this.onUpdate();
    }
  };

  handleBrainstorm = () => {
    this.addMessage("assistant", "----\n**Brainstorm:**\n");
    this.generateResponse(this.brainstormPrompt, 450);
  };
  handleCritic = () => {
    this.addMessage("assistant", "----\n**Critic:**\n");
    this.generateResponse(this.criticPrompt, 450);
  };

  handleSendMessage = (content: string) =>
    this.addMessage("user", content + "\n");

  // Functions

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

  addMessage(role: Message["role"], content: string) {
    if (content.length <= 0) return;
    this.messages.push({
      role,
      content,
    });
    this.save();
  }

  private async generateResponse(userMessage: string, length: number) {
    // Build conversation history for AI
    const context: Message[] = [
      { role: "system", content: this.systemPrompt + "\n" },
      {
        role: "user",
        content: `${userMessage} /nothink\n`,
      },
      ...this.messages,
      {
        role: "assistant",
        content: "<think></think>Understood.\n[Continuing:]\n",
      },
    ];

    this.isGenerating = true;
    const signal = await api.v1.createCancellationSignal();
    // Add an empty assistant message
    hyperGenerateText(
      context,
      {
        minTokens: 50,
        maxTokens: length,
        onBudgetWait: createContinueModalCallback(signal),
      },
      this.handleStreamMessage,
      "blocking",
      signal,
    )
      .catch((error) => api.v1.log("Generation failed:", error))
      .finally(() => {
        this.isGenerating = false;
        this.onUpdate();
      });
  }
}
