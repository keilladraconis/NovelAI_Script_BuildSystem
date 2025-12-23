import { Chat } from "./chat";

const { part, update, extension } = api.v1.ui;
const { get, set } = api.v1.storyStorage;

const INPUT_ID = "kse-engine-chat-input";
const SIDEBAR_ID = "kdg-sidebar";

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
  callback: () => void,
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
    ? box(row(textMarkdown(message.content?.replaceAll("\n", "\n\n") || "")))
    : row(textMarkdown(message.content?.replaceAll("\n", "\n\n") || ""));

type RadioOption = {
  id: string;
  text: string;
  icon?: IconId;
};

// RadioGroup implements a radio button group.
export class RadioGroup {
  onSwitch = (_text: string) => {};

  handleSwitch = (current: string, next: string) => {
    if (current == next) return;
    this.onSwitch(next);
  };

  render = (selected: string, options: RadioOption[]) =>
    row(
      ...options.map((o) =>
        toggleButton(
          o.text,
          () => this.handleSwitch(selected, o.id),
          o.icon,
          o.id == selected,
        ),
      ),
    );
}

// ChatUI is a set of pure functions.
export class ChatUI {
  // Hooks
  onSendMessage = (_text: string) => {};
  onClear = () => {};

  // Handlers
  handleSendMessage = () =>
    get(INPUT_ID).then((text) =>
      set(INPUT_ID, "").then(() => this.onSendMessage(text)),
    );
  handleClear = () => this.onClear();

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

  render({ messages, isGenerating, agent: { role } }: Chat) {
    return update([
      {
        ...this.sidebar,
        content: [
          column(
            textMarkdown("# Story Engine Chat"),
            row({
              ...{ style: { "scroll-snap-align": "bottom" } },
              ...column(
                ...messages
                  .filter((m) => m.role != "system")
                  .map(createMessageBubble),
              ),
            }),
            this.agentModeSelector.render(role, [
              {
                id: "riff",
                icon: "cloud-lightning",
                text: "Riff",
              },
              {
                id: "anchor",
                icon: "anchor",
                text: "Anchor",
              },
              {
                id: "critic",
                icon: "flag",
                text: "Critic",
              },
            ]),
            row(
              part.multilineTextInput({
                storageKey: `story:${INPUT_ID}`,
                placeholder: "Type your story idea or question here...",
                onSubmit: this.handleSendMessage,
              }),
              row(
                button("", this.handleSendMessage, "send", {
                  disabled: isGenerating,
                }),
                button("", this.handleClear, "trash"),
              ),
            ),
          ),
        ],
      },
    ]);
  }
}
