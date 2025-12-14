import { ChatMessage } from "./chat";

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
const column = (...content: UIPart[]) => part.column({ content });
const row = (...content: UIPart[]) => part.row({ content });
const box = (...content: UIPart[]) => part.box({ content });
const text = (text: string) => part.text({ text });
const textMarkdown = (text: string) => part.text({ text, markdown: true });
const multilineTextInput = (storageKey: string, placeholder: string) =>
  part.multilineTextInput({ storageKey, placeholder });
const button = (
  text: string = "",
  callback: () => void,
  iconId: IconId | undefined,
  { disabled }: Partial<UIPartButton> = {},
) => part.button({ text, callback, disabled, iconId });

const createMessageBubble = (message: ChatMessage): UIPart =>
  message.role == "user"
    ? row(textMarkdown(message.content))
    : box(row(textMarkdown(message.content)));

export class ChatUI {
  public onSendMessage: (text: string) => void = (_) => {};
  public onClear: () => void = () => {};

  register = async () =>
    await api.v1.ui
      .register([SIDEBAR])
      .catch((err) => log(`Error registering sidebar: ${JSON.stringify(err)}`));

  handleSendButton = async () =>
    get(INPUT_ID).then((text) =>
      set(INPUT_ID, "").then(() => this.onSendMessage(text)),
    );

  updatePanel = (messages: ChatMessage[], isGenerating: boolean) =>
    update([
      {
        ...SIDEBAR,
        ...{
          content: [
            column(
              text("Scenario Engine Chat"),
              row(column(...messages.map(createMessageBubble))),
              row(
                multilineTextInput(
                  `story:${INPUT_ID}`,
                  "Type your scenario idea or question here...",
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
