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

const createMessageBubble = (message: Message): UIPart =>
  message.role == "user"
    ? box(row(textMarkdown(message.content || "")))
    : row(textMarkdown(message.content || ""));

// ChatUI is a set of pure functions.
export class ChatUI {
  // Hooks
  onSendMessage = (_text: string) => {};
  onBrainstorm = () => {};
  onCritic = () => {};
  onClear = () => {};

  // Handlers
  handleSendMessage = () =>
    get(INPUT_ID).then((text) =>
      set(INPUT_ID, "").then(() => this.onSendMessage(text)),
    );
  handleClear = () => this.onClear();
  handleBrainstorm = () => this.onBrainstorm();
  handleCritic = () => this.onCritic();

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

  updatePanel({ messages, isGenerating }: Chat) {
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
            row(
              button("Brainstorm", this.handleBrainstorm, "feather"),
              button("Critic", this.handleCritic, "flag"),
            ),
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
