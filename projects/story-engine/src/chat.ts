import { hyperGenerate } from "./hyper-generator";
import type {
  OnBudgetWaitCallback,
  OnBudgetResumeCallback,
} from "./hyper-generator";

const { log } = api.v1;
const { get, set } = api.v1.storyStorage;
const { get: getConfig } = api.v1.config;

// Types
interface Agent {
  maxTokens: number;
  userPrompt: string;
  slug: string;
  icon: IconId;

  title(): string;
  header(): string;
  load(): Promise<void>;
}

abstract class Agent implements Agent {
  title() {
    return this.slug.charAt(0).toUpperCase() + this.slug.slice(1);
  }

  header() {
    return `\n\n----\n**${this.title()}**\n\n`;
  }

  async load() {
    const prompt = await getConfig(`${this.slug}_prompt`);
    if (prompt) this.userPrompt = prompt;
  }
}

class BrainstormAgent extends Agent {
  maxTokens = 2048;
  userPrompt = "";
  slug = "brainstorm";
  icon: IconId = "cloud-lightning";
}

class CriticAgent extends Agent {
  maxTokens = 2048;
  userPrompt = "";
  slug = "critic";
  icon: IconId = "flag";
}

class AnchorAgent extends Agent {
  maxTokens = 2048;
  userPrompt = "";
  slug = "anchor";
  icon: IconId = "anchor";
}

const AGENTS = [BrainstormAgent, AnchorAgent, CriticAgent];

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

export class Chat {
  // Constants
  CHAT_HISTORY_KEY = "kse-chat-history";

  // Properties
  messages: Message[] = [];
  isGenerating = false;
  waitTime = 0;
  isAgentResponding = false;
  minTokens = 25;
  systemPrompt = "";
  autoMode = false;
  autoCount = 0;
  agents: Agent[] = AGENTS.map((a) => {
    const theAgent = new a();
    theAgent.load();
    return theAgent;
  });
  agent: Agent;
  clearInterval = () => {};

  constructor() {
    this.agent = this.agents[0];
  }

  // Hooks
  onUpdate = (_chat: Chat) => {};
  onBudgetWait: OnBudgetWaitCallback = async () => {};

  // Handlers
  handleClear = () => {
    this.messages = [];
    this.isGenerating = false;
    this.agent = this.agents[0];
    this.save();
    this.load();
  };

  handleStreamMessage = (text: string, final: boolean) => {
    const messageToAppend = this.messages.at(-1)!;
    messageToAppend.content += text;
    if (final) {
      // Add trailing whitespace to the end of the message if needed
      if (!/\s$/.test(messageToAppend.content!))
        messageToAppend.content = messageToAppend.content + " ";
      this.save();
    } else {
      this.onUpdate(this);
    }
  };
  handleAgentSwitch = (role: string) => {
    if (this.agent.slug == role) return;
    this.agent = this.agents.find((a) => a.slug == role)!;
    this.agent.load();
    this.onUpdate(this);
  };

  handleSendMessage = (content: string) => {
    if (content.length > 0) {
      this.addMessage("user", content + "\n");
      this.isAgentResponding = false;
    }
    this.ensureAssistantMessage(this.agent.header());
    this.generateResponse();
  };

  handleSemiAutomaticContinuation = (response: string) => {
    if (!this.autoMode || this.autoCount <= 0) return;
    // If we're on the Critic agent, we'll have to parse the response to figure out what the next should be.
    // If we're on any other agent, do Critic next.
    if (this.agent.slug == "critic") {
      log("[HSAC] attempting to find TO_AGENT in this:", response);
      const toAgentMatch = /TO_AGENT: (\w+)/.exec(response);
      if (toAgentMatch) {
        this.handleAgentSwitch(toAgentMatch[1].toLowerCase());
        this.autoCount--;
        this.handleSendMessage(""); // Automatically trigger next gen.
      } else {
        log("[handleSemiAutomaticContinuation] Failed to switch agent.");
      }
    } else {
      this.handleAgentSwitch("critic");
      this.autoCount--;
      this.handleSendMessage(""); // Automatically trigger next gen.
    }
  };

  handleBudgetWait: OnBudgetWaitCallback = async (
    available: number,
    needed: number,
    time: number,
  ) => {
    this.onBudgetWait(available, needed, time);
    this.waitTime = Math.floor(time / 1000);
    this.clearInterval = setInterval(this.handleWaitingTick, 1000);
  };

  handleWaitingTick = (clear: () => Promise<void>) => {
    this.waitTime--;
    if (this.waitTime <= 0) clear();
    this.onUpdate(this);
  };

  handleBudgetResume: OnBudgetResumeCallback | undefined = () => {
    this.clearInterval();
    this.waitTime = 0;
  };

  handleCancel = () => {};

  // Functions
  ensureAssistantMessage(text: string) {
    if (!this.isAgentResponding) {
      this.addMessage("assistant", text);
      this.isAgentResponding = true;
    }
  }

  async load() {
    return Promise.all([
      get(this.CHAT_HISTORY_KEY)
        .then((history) => (this.messages = JSON.parse(history)))
        .catch(() => (this.messages = [])),
      getConfig("system_prompt").then(
        (systemPrompt: string) => (this.systemPrompt = systemPrompt),
      ),
      this.agents.map((a) => a.load()),
    ]);
  }

  save() {
    this.messages = this.messages.filter(
      (m) => m.content && m.content.length > 0,
    );
    set(this.CHAT_HISTORY_KEY, JSON.stringify(this.messages)).then(() => {
      this.onUpdate(this);
    });
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
    // Build conversation history for AI. Our prompts need to be double-spaced for GLM.
    const context: Message[] = [
      {
        role: "system",
        content: this.systemPrompt.replaceAll("\n", "\n\n") + "\n\n",
      },
      ...this.messages.slice(0, -1),
      {
        role: "user",
        content: `${this.agent.userPrompt.replaceAll("\n", "\n\n")} /nothink\n\n`,
      },
      {
        role: "assistant",
        content: "<think></think>Understood.\n\n[Continuing:]\n",
      },
      this.messages.at(-1)!,
    ];

    this.isGenerating = true;
    const signal = await api.v1.createCancellationSignal();
    this.handleCancel = signal.cancel;

    try {
      const result = await hyperGenerate(
        context,
        {
          minTokens: 50,
          maxTokens: this.agent.maxTokens,
          onBudgetWait: this.handleBudgetWait,
          onBudgetResume: this.handleBudgetResume,
        },
        this.handleStreamMessage,
        "blocking",
        signal,
      );
      this.isGenerating = false;
      signal.dispose();
      this.onUpdate(this);
      this.save();
      if (this.autoMode) {
        this.handleSemiAutomaticContinuation(result);
      }
    } catch (error: any) {
      api.v1.log("Generation failed:", error);
    }
  }
}
