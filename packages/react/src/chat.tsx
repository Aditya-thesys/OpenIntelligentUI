import { useCallback } from "react";
import type { Library } from "./define";
import type { OpenUIError } from "./errors";
import { Renderer, type HostAction } from "./Renderer";

/** The parts of a react-headless chat message the bridge reads. */
export interface ChatMessage {
  id: string;
  role: string;
  content?: unknown;
}

// Structural copies of react-headless's StreamProtocolAdapter and MessageFormat, so this package
// does not depend on it; its adapters and formats fit them.
interface StreamAdapter<E> {
  parse(response: Response): AsyncIterable<E>;
}

interface MessageFormat {
  toApi(messages: ChatMessage[]): unknown;
}

export interface AssistantMessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  library: Library;
  /** The answer called `action(name, ...args)`; the arguments are model-written, validate them. */
  onAction?: (action: HostAction) => void;
  onError?: (errors: OpenUIError[]) => void;
  /** The chat's color scheme, for example react-ui's `useTheme().mode`. */
  theme?: "light" | "dark";
}

// Workaround: react-ui's Thread shows a streaming answer only once its `hasLangSyntax` gate sees
// OpenUI Lang, so answers start with this line until that gate is lifted.
const LIVE_MARKER = "root = answer\n";

const stateNote = (state: Record<string, unknown>) =>
  `\n\n(State after the user's changes: ${JSON.stringify(state)})`;

/** Prompt rule explaining the state note `messageFormat` adds; add it to `additionalRules`. */
export const stateNoteRule =
  "An earlier answer may end with `(State after the user's changes: ...)`. That is the user's edit of that answer: inputs and choices, and under `@fields` edits that components hold, such as removed or added items. Build on it.";

const answerText = (content: unknown) => {
  const text = typeof content === "string" ? content : "";
  return text.startsWith(LIVE_MARKER) ? text.slice(LIVE_MARKER.length) : text;
};

/** Connects OpenUI's react-ui `AgentInterface` to `Renderer`, sending each answer's state back. */
export function createChatBridge() {
  // One entry per answer, never evicted: entries are small and live as long as the page's
  // thread, and a dropped entry would lose that answer's edits on the next turn.
  const states = new Map<string, Record<string, unknown>>();

  function streamAdapter<E extends { type: string }>(adapter: StreamAdapter<E>): StreamAdapter<E> {
    return {
      async *parse(response) {
        const marked = new Set<unknown>();
        for await (const event of adapter.parse(response)) {
          const { delta, messageId } = event as { delta?: unknown; messageId?: unknown };
          if (
            event.type === "TEXT_MESSAGE_CONTENT" &&
            typeof delta === "string" &&
            !marked.has(messageId)
          ) {
            marked.add(messageId);
            yield { ...event, delta: LIVE_MARKER + delta };
          } else yield event;
        }
      },
    };
  }

  function messageFormat<F extends MessageFormat>(format: F): F {
    const toApi = (messages: ChatMessage[]) =>
      format.toApi(
        messages.map((m) => {
          if (m.role !== "assistant") return m;
          const state = states.get(m.id);
          const note = state && Object.keys(state).length ? stateNote(state) : "";
          return { ...m, content: answerText(m.content) + note };
        }),
      );
    return { ...format, toApi };
  }

  function AssistantMessage({
    message,
    isStreaming,
    library,
    onAction,
    onError,
    theme,
  }: AssistantMessageProps) {
    const onStateUpdate = useCallback(
      (state: Record<string, unknown>) => states.set(message.id, state),
      [message.id],
    );
    return (
      <Renderer
        key={message.id}
        library={library}
        response={answerText(message.content)}
        isStreaming={isStreaming}
        onAction={onAction}
        onError={onError}
        onStateUpdate={onStateUpdate}
        initialState={states.get(message.id)}
        theme={theme}
      />
    );
  }

  return { streamAdapter, messageFormat, AssistantMessage };
}
