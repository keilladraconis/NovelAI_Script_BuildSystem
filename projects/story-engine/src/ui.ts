import { Chat } from "./chat";

const { part, update, extension } = api.v1.ui;
const { get, set } = api.v1.storyStorage;

const INPUT_ID = "kse-engine-chat-input";
const SIDEBAR_ID = "kse-sidebar";

// Basic UI helper wrappers
const column = (...content: UIPart[]) =>
  part.column({ content, style: { width: "100%" } });
const row = (...content: UIPart[]) => part.row({ content });
const box = (...content: UIPart[]) => part.box({ content });
const text = (text: string) => part.text({ text });
const textMarkdown = (text: string) =>
  part.text({
    text,
    markdown: true,
    style: {
      "user-select": "text",
      "-webkit-user-select": "text",
      width: "100%",
    },
  });

const button = (
  text: string = "",
  callback: () => void | undefined,
  iconId: IconId | undefined,
  { disabled }: Partial<UIPartButton> = {},
) => part.button({ text, callback, disabled, iconId });

const toggleButton = (
  text: string = "",
  callback: () => void,
  iconId: IconId | undefined,
  toggled: boolean,
) =>
  part.button({
    text,
    callback,
    iconId,
    style: toggled
      ? {
          "background-color": "rgb(245, 243, 194)",
          color: "rgb(19, 21, 44)",
        }
      : {},
  });

/**
 * createMessageBubble injects double-newlines because it improves how NAI
 * formats markdown. Specifically, if the AI should output `Foo\n----` it would
 * by default produce a `<h1>Foo</h1>` but if we instead do `Foo\n\n----` we get
 * `<p>Foo</p><hr>`.
 */
const createMessageBubble = (message: Message): UIPart =>
  message.role == "user"
    ? box(textMarkdown(message.content?.replaceAll("\n", "\n\n") || ""))
    : textMarkdown(message.content?.replaceAll("\n", "\n\n") || "");

type RadioOption = {
  id: string;
  text: string;
  icon?: IconId;
};

// RadioGroup implements a radio button group.
class RadioGroup {
  onSwitch = (_text: string) => {};
  onAutoCheckbox = (_value: boolean) => {};

  handleSwitch = (current: string, next: string) => {
    if (current == next) return;
    this.onSwitch(next);
  };

  render = (selected: string, semiAutomatic: boolean, options: RadioOption[]) =>
    row(
      ...options.map((o) =>
        toggleButton(
          o.text,
          () => this.handleSwitch(selected, o.id),
          o.icon,
          o.id == selected,
        ),
      ),
      part.checkboxInput({
        initialValue: semiAutomatic,
        label: "Auto",
        onChange: this.onAutoCheckbox,
      }),
    );
}

// I want this button here to do triple duty. 1. sending obviously. While generating it should turn into a red X and trigger cancellation..
// 2. If we hit a wait event, it should turn blue or something and become like, the spinning circle.
// 3. Ok clicked the blue circle. Now it should become a clock and include the seconds remaining until generation continues.
class SendButton {
  isInteractionWaiting = false;

  onSend = () => {};
  onCancel = () => {};

  setInteractionWaiting() {
    this.isInteractionWaiting = true;
  }

  handleContinue = () => {
    this.isInteractionWaiting = false;
  };
  handleSend = () => {
    this.isInteractionWaiting = false;
    this.onSend();
  };
  handleCancel = () => {
    this.isInteractionWaiting = false;
    this.onCancel();
  };

  render = (isGenerating: boolean, waitTime: number) => {
    if (isGenerating) {
      if (this.isInteractionWaiting) {
        return button("", this.handleContinue, "fast-forward");
      } else if (waitTime > 0) {
        return button(waitTime.toString(), () => {}, "time");
      } else {
        return button("", this.handleCancel, "x");
      }
    } else {
      return button("", this.handleSend, "send");
    }
  };
}

// ChatUI is a set of pure functions.
export class ChatUI {
  // Hooks
  onSendMessage = (_text: string) => {};
  onCancel = () => {};
  onClear = () => {};

  // Handlers
  handleSendMessage = () =>
    get(INPUT_ID).then((text) =>
      set(INPUT_ID, "").then(() => this.onSendMessage(text)),
    );

  // Helpers
  sidebar = extension.sidebarPanel({
    id: SIDEBAR_ID,
    name: "Scenario Engine",
    content: [],
  }) as UIExtensionSidebarPanel & { id: string };

  // Functions
  register() {
    return api.v1.ui.register([this.sidebar]);
  }

  // subcomponents
  agentModeSelector = new RadioGroup();
  sendButton = new SendButton();

  constructor() {
    this.sendButton.onSend = this.handleSendMessage;
    this.sendButton.onCancel = this.onCancel;
  }

  render({
    messages,
    isGenerating,
    waitTime,
    agent: { slug: role },
    agents,
    autoMode: autoMode,
  }: Chat) {
    return update([
      {
        ...this.sidebar,
        content: [
          {
            ...column(
              part.text({
                text: "## Story Engine",
                markdown: true,
                style: { flex: "0 0 auto" },
              }),
              {
                ...column(
                  ...messages
                    .filter((m) => m.role != "system")
                    .map(createMessageBubble)
                    .reverse(),
                ),
                ...{
                  style: {
                    flex: "1 1 auto",
                    "min-height": 0,
                    "overflow-y": "auto",
                    display: "flex",
                    "flex-direction": "column-reverse",
                    "justify-content": "flex-start",
                  },
                },
              },
              {
                ...column(
                  this.agentModeSelector.render(
                    role,
                    autoMode,
                    agents.map((a) => ({
                      id: a.slug,
                      icon: a.icon,
                      text: a.title(),
                    })),
                  ),
                  row(
                    part.multilineTextInput({
                      storageKey: `story:${INPUT_ID}`,
                      placeholder: "Type your story idea or question here...",
                      onSubmit: this.handleSendMessage,
                    }),
                    row(
                      this.sendButton.render(isGenerating, waitTime),
                      button("", this.onClear, "trash"),
                    ),
                  ),
                ),
                ...{
                  style: {
                    flex: "0 0 auto",
                    "padding-bottom": "env(safe-area-inset-bottom)",
                  },
                },
              },
            ),
            ...{
              style: {
                height: "100%",
                "min-height": 0,
                "justify-content": "flex-start",
              },
            }, // Ensure we fill the whole column and get our own scroller
          },
        ],
      },
    ]);
  }
}
