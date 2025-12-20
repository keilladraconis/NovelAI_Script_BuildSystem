const { log } = api.v1;
const { part, update, extension } = api.v1.ui;
const { get, set } = api.v1.storyStorage;

const INPUT_ID = "kse-engine-chat-input";

const SIDEBAR = extension.sidebarPanel({
  id: "ksg-sidebar",
  name: "Scenario Engine",
  content: [],
}) as UIExtensionSidebarPanel & { id: string };

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
const multilineTextInput = (storageKey: string, placeholder: string) =>
  part.multilineTextInput({ storageKey, placeholder });

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

const generationControl = (
  isGenerating: boolean,
  waiting: number,
  interactionNeeded: boolean,
  onInteract: () => void,
): UIPartBox =>
  part.box({
    style: { display: isGenerating ? "inherit" : "none" },
    content: [
      interactionNeeded && waiting > 0
        ? button("", onInteract, "refresh-cw")
        : button("", onInteract, "time"),
      ...(interactionNeeded
        ? [text(`Waiting ${waiting} seconds to continue...`)]
        : []),
      button("", () => {}, "x"),
    ],
  });

type ChatUIParams = {
  isGenerating: boolean;
  waiting: number;
  interactionNeeded: boolean;
};

// ChatUI is a set of pure functions.
export class ChatUI {
  public onSendMessage: (text: string) => void = (_) => {};
  public onClear: () => void = () => {};
  public onInteract: () => void = () => {};

  register = async () =>
    await api.v1.ui
      .register([SIDEBAR])
      .catch((err) => log(`Error registering sidebar: ${JSON.stringify(err)}`));

  handleSendButton = async () =>
    get(INPUT_ID).then((text) =>
      set(INPUT_ID, "").then(() => this.onSendMessage(text)),
    );

  updatePanel = (
    messages: Message[],
    { isGenerating, waiting, interactionNeeded }: ChatUIParams,
  ) =>
    update([
      {
        ...SIDEBAR,
        ...{
          content: [
            column(
              textMarkdown("# Story Engine Chat"),
              row({
                ...{ style: { "scroll-snap-align": "bottom" } },
                ...column(
                  ...messages
                    .filter((m) => m.role != "system")
                    .map(createMessageBubble),
                  generationControl(
                    isGenerating,
                    waiting,
                    interactionNeeded,
                    this.onInteract,
                  ),
                ),
              }),
              row(
                multilineTextInput(
                  `story:${INPUT_ID}`,
                  "Type your story idea or question here...",
                ),
                row(
                  button("", this.handleSendButton, "send", {
                    disabled: isGenerating,
                  }),
                  button("", this.onClear, "trash"),
                ),
              ),
            ),
          ],
        },
      },
    ]);
}
