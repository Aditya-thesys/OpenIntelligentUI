import { createChatBridge, type AssistantMessageProps } from "@open-intelligent-ui/react/chat";
import "@open-intelligent-ui/react/styles.css";
import { openAIAdapter, openAIMessageFormat } from "@openuidev/react-headless";
import {
  AgentInterface,
  fetchLLM,
  useSystemThemeMode,
  useTheme,
  useThread,
} from "@openuidev/react-ui";
import "@openuidev/react-ui/styles/index.css";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { library } from "./library";
import { SaveThread, storage } from "./threads";

const bridge = createChatBridge();

const llm = fetchLLM({
  url: "/api/chat",
  streamAdapter: bridge.streamAdapter(openAIAdapter()),
  messageFormat: bridge.messageFormat(openAIMessageFormat),
});

// react-ui follows a streaming answer when its text changes, not when it grows later as photos
// load or a map sizes itself. This keeps the end in view unless the reader scrolled away.
function useFollowGrowth(streaming: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const scroller = element?.closest<HTMLElement>(".openui-agent-thread-scroll-area");
    if (!streaming || !element || !scroller) return;
    let height = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const grown = element.offsetHeight - height;
      height = element.offsetHeight;
      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (grown > 0 && gap - grown < 120) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [streaming]);
  return ref;
}

function AssistantMessage(props: Pick<AssistantMessageProps, "message" | "isStreaming">) {
  const sendMessage = useThread((s) => s.processMessage);
  const { mode } = useTheme();
  const follow = useFollowGrowth(props.isStreaming);
  return (
    <div ref={follow}>
      <bridge.AssistantMessage
        {...props}
        library={library}
        theme={mode}
        onAction={({ name, args: [text] }) => {
          if (name === "sendMessage" && typeof text === "string" && text)
            void sendMessage({ role: "user", content: text });
        }}
      />
    </div>
  );
}

const starters = [
  {
    displayText: "A day in San Francisco",
    prompt: "I'm in San Francisco for a day, plan a sightseeing route for me",
  },
  {
    displayText: "Savings calculator",
    prompt: "How does $300 a month grow over 20 years? Give me a chart and a slider for the return",
  },
  { displayText: "Memory game", prompt: "Let's play a memory card game with 8 pairs of emoji" },
  {
    displayText: "Spending dashboard",
    prompt: "Make a dashboard of my monthly spending with categories I can edit and a chart",
  },
];

function App() {
  return (
    <AgentInterface
      llm={llm}
      storage={storage}
      agentName="Assistant"
      starters={starters}
      components={{ AssistantMessage }}
      theme={{ mode: useSystemThemeMode() }}
      scrollVariant="always"
    >
      <SaveThread />
    </AgentInterface>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
