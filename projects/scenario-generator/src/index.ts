// Scenario Generator 0.1.1 - Chat Interface
// Simple chat interface for scenario generation with BrainstormAgent and Critic agents

// Basic message interface
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

// Simple state for the chat
interface ChatState {
  messages: ChatMessage[];
  isGenerating: boolean;
  currentAgent: "brainstorm" | "critic";
}

// Initialize chat state
const chatState: ChatState = {
  messages: [],
  isGenerating: false,
  currentAgent: "brainstorm",
};

// Generate unique ID for messages
function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// Add a message to the chat
function addMessage(role: ChatMessage["role"], content: string): ChatMessage {
  const message: ChatMessage = {
    id: generateId(),
    role,
    content,
    timestamp: new Date(),
  };
  chatState.messages.push(message);
  return message;
}

// Simple response generator (placeholder logic)
async function generateResponse(userMessage: string): Promise<string> {
  // Placeholder response - in a real implementation, this would call
  // the actual AI considerations for different agents
  if (chatState.currentAgent === "brainstorm") {
    return `As the Brainstorm agent, I'll help you develop your scenario idea: "${userMessage}". Let me explore some creative directions...`;
  } else {
    return `As the Critic agent, I'll analyze your scenario: "${userMessage}". Let me provide constructive feedback to improve it...`;
  }
}

// Send user message and get response
async function sendMessage(content: string) {
  if (chatState.isGenerating) return;

  // Add user message
  addMessage("user", content);

  // Set generating state
  chatState.isGenerating = true;

  // Update UI
  updatePanel();

  try {
    // Generate response (with small delay for UX)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await generateResponse(content);
    addMessage("assistant", response);
  } catch (error) {
    addMessage("system", "Error generating response. Please try again.");
  } finally {
    chatState.isGenerating = false;
    updatePanel();
  }
}

// Render chat message bubble
function createMessageBubble(message: ChatMessage): UIPart {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const bubbleColor = isUser ? "#e3f2fd" : isSystem ? "#f3e5f5" : "#f5f5f5";

  const textColor = isSystem ? "#7b1fa2" : "#333";

  return {
    type: "row",
    style: {
      backgroundColor: bubbleColor,
      borderRadius: "8px",
      padding: "12px",
      marginBottom: "8px",
      borderLeft: isUser
        ? "3px solid #2196f3"
        : isSystem
          ? "3px solid #9c27b0"
          : "3px solid #757575",
    },
    content: [
      {
        type: "text",
        style: {
          fontSize: "12px",
          color: "#666",
          marginBottom: "4px",
          fontWeight: "bold",
        },
        text:
          message.role === "user"
            ? "You"
            : message.role === "system"
              ? "System"
              : chatState.currentAgent === "brainstorm"
                ? "Brainstorm Agent"
                : "Critic Agent",
      },
      {
        type: "text",
        style: {
          fontSize: "14px",
          color: textColor,
          lineHeight: "1.4",
        },
        text: message.content,
      },
      {
        type: "text",
        style: {
          fontSize: "10px",
          color: "#999",
          marginTop: "4px",
          textAlign: "right",
        },
        text: message.timestamp.toLocaleTimeString(),
      },
    ],
  };
}

// Render input area
function createInputArea(): UIPart {
  return {
    type: "row",
    style: {
      borderTop: "1px solid #e0e0e0",
      paddingTop: "12px",
      marginTop: "12px",
    },
    content: [
      {
        type: "multilineTextInput",
        storageKey: "scenario-input",
        placeholder: "Type your scenario idea or question here...",
        style: {
          width: "100%",
          minHeight: "60px",
          padding: "8px",
          border: "1px solid #ddd",
          borderRadius: "4px",
          fontFamily: "inherit",
          fontSize: "14px",
          resize: "vertical",
        },
      },
      {
        type: "row",
        style: {
          display: "flex",
          gap: "8px",
          marginTop: "8px",
        },
        content: [
          {
            type: "button",
            text: "Send",
            style: {
              flex: "1",
              padding: "8px 16px",
              backgroundColor: "#2196f3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            },
            disabledWhileCallbackRunning: chatState.isGenerating,
            callback: () => {
              api.v1.storyStorage
                .get("scenario-input")
                .then((input) => sendMessage(input.trim()))
                .then(() => api.v1.storyStorage.set("scenario-input", ""));
            },
          },
          {
            type: "button",
            text: "Brainstorm",
            style: {
              flex: "1",
              padding: "8px 16px",
              backgroundColor:
                chatState.currentAgent === "brainstorm" ? "#4caf50" : "#81c784",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            },
            callback: () => {
              chatState.currentAgent = "brainstorm";
              addMessage("system", "Switched to Brainstorm agent mode");
              updatePanel();
            },
          },
          {
            type: "button",
            text: "Critic",
            style: {
              flex: "1",
              padding: "8px 16px",
              backgroundColor:
                chatState.currentAgent === "critic" ? "#ff9800" : "#ffb74d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            },
            callback: () => {
              chatState.currentAgent = "critic";
              addMessage("system", "Switched to Critic agent mode");
              updatePanel();
            },
          },
        ],
      },
    ],
  };
}

// Update the panel content
function updatePanel() {
  // Find the registered panel
  const panel = api.v1.ui.extension.sidebarPanel({
    name: "ksg-sidebar",
    content: [],
  });

  // Create the chat interface
  const chatInterface: UIPart = {
    type: "column",
    style: {
      height: "100%",
      display: "flex",
      flexDirection: "column",
      fontFamily: "sans-serif",
    },
    content: [
      {
        type: "row",
        style: {
          padding: "16px",
          backgroundColor: "#f8f9fa",
          borderBottom: "1px solid #e0e0e0",
          textAlign: "center",
          fontSize: "16px",
          fontWeight: "bold",
          color: "#333",
        },
        content: [],
      },
      {
        type: "row",
        style: {
          flex: "1",
          overflowY: "auto",
          padding: "16px",
        },
        content: chatState.messages.map(createMessageBubble),
      },
      createInputArea(),
    ],
  };

  // Update the panel content
  panel.content = [chatInterface];

  // Register the updated panel
  api.v1.ui.register([panel]);
}

// Initialize the chat with a welcome message
function initializeChat() {
  addMessage(
    "system",
    "Welcome to the Scenario Generator Chat! Choose Brainstorm for creative ideas or Critic for analysis.",
  );
  updatePanel();
}

// Main execution function
(async () => {
  try {
    // Initialize the chat interface
    initializeChat();
  } catch (error) {
    console.error("Failed to initialize chat interface:", error);
  }
})();
