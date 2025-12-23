import {
  OnBudgetWaitCallback,
  createContinueModalCallback,
  hyperGenerateText,
} from "./hyper-generator";

const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

type AgentRole = "brainstorm" | "critic";

// Types
interface Agent {
  maxTokens: number;
  userPrompt: string;
  assistantHeader: string;
  role: AgentRole;

  load(): Promise<string>;
}

class BrainstormAgent implements Agent {
  maxTokens = 1000;
  userPrompt = "";
  assistantHeader = "----\n**Brainstorm:**\n\n";
  role: AgentRole = "brainstorm";

  async load() {
    const prompt = await getConfig("brainstorm_prompt");
    return (this.userPrompt = prompt);
  }
}

class CriticAgent implements Agent {
  maxTokens = 250;
  userPrompt = "";
  assistantHeader = "----\n**Critic:**\n\n";
  role: AgentRole = "critic";

  async load() {
    const prompt = await getConfig("critic_prompt");
    return (this.userPrompt = prompt);
  }
}

const AGENTS = {
  brainstorm: BrainstormAgent,
  critic: CriticAgent,
};

export class Chat {
  // Constants
  CHAT_HISTORY_KEY = "kse-chat-history";

  // Properties
  messages: Message[] = [];
  isGenerating = false;
  isAgentResponding = false;
  minTokens = 25;
  systemPrompt = "";
  agent: BrainstormAgent | CriticAgent = new BrainstormAgent();

  // Hooks
  onUpdate = () => {};
  onBudgetWait: OnBudgetWaitCallback = () => true;

  // Handlers
  handleClear = () => {
    this.messages = [];
    this.isGenerating = false;
    this.agent = new BrainstormAgent();
    this.save();
    this.load();
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

  ensureAssistantMessage(text: string) {
    if (!this.isAgentResponding) {
      this.addMessage("assistant", text);
    }
  }

  handleAgentSwitch = (role: string) => {
    if (this.agent.role == role) return;
    this.agent = new AGENTS[role as AgentRole]();
    this.agent.load();
    this.isAgentResponding = false;
    this.onUpdate();
  };

  handleSendMessage = (content: string) => {
    if (content.length > 0) {
      this.addMessage("user", content + "\n");
      this.isAgentResponding = false;
    }
    this.ensureAssistantMessage(this.agent.assistantHeader);
    this.generateResponse();
  };
  // Functions

  async load() {
    return Promise.all([
      get(this.CHAT_HISTORY_KEY)
        .then((history) => (this.messages = JSON.parse(history)))
        .catch(() => (this.messages = [])),
      getConfig("system_prompt").then(
        (systemPrompt: string) => (this.systemPrompt = systemPrompt),
      ),
      this.agent.load(),
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

  private async generateResponse() {
    // Build conversation history for AI
    const context: Message[] = [
      { role: "system", content: this.systemPrompt + "\n" },
      {
        role: "user",
        content: `${this.agent.userPrompt} /nothink\n`,
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
        maxTokens: this.agent.maxTokens,
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
        this.save();
      });
  }
}
