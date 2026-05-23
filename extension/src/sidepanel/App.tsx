import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BACKEND_BASE_URL,
  ERROR_MESSAGES,
  backendClient,
  getBackendSettings,
  saveBackendSettings,
  toUiErrorMessage,
  type BackendSettings,
  type MessageItem,
} from "@/lib/backendClient";

type BackendStatus = "checking" | "connected" | "unavailable";
type ChatRole = "user" | "assistant" | "error";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

const statusLabels: Record<BackendStatus, string> = {
  checking: "Checking",
  connected: "Connected",
  unavailable: "Unavailable",
};

function parseEventData(event: MessageEvent): unknown {
  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
}

function extractTextDelta(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const value = record.text ?? record.delta ?? record.content ?? record.raw;
  return typeof value === "string" ? value : "";
}

function extractFailureMessage(payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return ERROR_MESSAGES.sseInterrupted;
  const record = payload as Record<string, unknown>;
  const value = record.error ?? record.detail ?? record.message;
  return typeof value === "string" && value.trim() ? value.trim() : ERROR_MESSAGES.sseInterrupted;
}

function fromBackendMessages(items: MessageItem[]): ChatMessage[] {
  return items
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: item.message_id,
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [settings, setSettings] = useState<BackendSettings>({
    baseUrl: DEFAULT_BACKEND_BASE_URL,
    backendApiKey: "",
  });
  const [baseUrlField, setBaseUrlField] = useState(DEFAULT_BACKEND_BASE_URL);
  const [backendApiKeyField, setBackendApiKeyField] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const streamBufferRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const closeEvents = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const loadMessages = useCallback(async (nextSessionId: string) => {
    try {
      const storedMessages = await backendClient.getMessages(nextSessionId);
      setMessages(fromBackendMessages(storedMessages));
      setBackendStatus("connected");
    } catch {
      return;
    }
  }, []);

  const refreshBackendStatus = useCallback(async () => {
    setBackendStatus("checking");
    try {
      await backendClient.checkBackend();
      setBackendStatus("connected");
      setErrorMessage("");
    } catch (error) {
      setBackendStatus("unavailable");
      setErrorMessage(toUiErrorMessage(error, settingsRef.current.baseUrl));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getBackendSettings().then((storedSettings) => {
      if (!alive) return;
      setSettings(storedSettings);
      settingsRef.current = storedSettings;
      setBaseUrlField(storedSettings.baseUrl);
      setBackendApiKeyField(storedSettings.backendApiKey);
      void refreshBackendStatus();
    });
    return () => {
      alive = false;
      closeEvents();
    };
  }, [closeEvents, refreshBackendStatus]);

  const finishStream = useCallback((nextSessionId: string | null) => {
    const finalText = streamBufferRef.current.trim();
    if (finalText) {
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", content: streamBufferRef.current },
      ]);
    }
    streamBufferRef.current = "";
    setStreamingText("");
    setIsStreaming(false);
    setIsSending(false);
    if (nextSessionId) void loadMessages(nextSessionId);
  }, [loadMessages]);

  const handleSseFailure = useCallback((message: string = ERROR_MESSAGES.sseInterrupted) => {
    closeEvents();
    streamBufferRef.current = "";
    setStreamingText("");
    setIsStreaming(false);
    setIsSending(false);
    setErrorMessage(message);
  }, [closeEvents]);

  const connectSessionEvents = useCallback(async (nextSessionId: string) => {
    closeEvents();
    const eventsUrl = await backendClient.sessionEventsUrl(nextSessionId);
    const source = new EventSource(eventsUrl);
    sourceRef.current = source;

    source.onopen = () => {
      setBackendStatus("connected");
    };
    source.onerror = () => {
      if (sourceRef.current === source) {
        handleSseFailure(ERROR_MESSAGES.sseInterrupted);
      }
    };

    source.addEventListener("text_delta", (event) => {
      const delta = extractTextDelta(parseEventData(event as MessageEvent));
      if (!delta) return;
      streamBufferRef.current += delta;
      setStreamingText(streamBufferRef.current);
      setBackendStatus("connected");
    });
    source.addEventListener("attempt.completed", () => {
      closeEvents();
      finishStream(sessionIdRef.current);
    });
    source.addEventListener("done", () => {
      closeEvents();
      finishStream(sessionIdRef.current);
    });
    source.addEventListener("attempt.failed", (event) => {
      handleSseFailure(extractFailureMessage(parseEventData(event as MessageEvent)));
    });
    source.addEventListener("heartbeat", () => {
      setBackendStatus("connected");
    });
  }, [closeEvents, finishStream, handleSseFailure]);

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextSettings = await saveBackendSettings({
      baseUrl: baseUrlField,
      backendApiKey: backendApiKeyField,
    });
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    setBaseUrlField(nextSettings.baseUrl);
    setBackendApiKeyField(nextSettings.backendApiKey);
    void refreshBackendStatus();
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSending || isStreaming) return;

    setIsSending(true);
    setIsStreaming(true);
    setErrorMessage("");
    setInput("");
    streamBufferRef.current = "";
    setStreamingText("");
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);

    try {
      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const session = await backendClient.createSession(content.slice(0, 50));
        nextSessionId = session.session_id;
        setSessionId(nextSessionId);
        sessionIdRef.current = nextSessionId;
      }
      await connectSessionEvents(nextSessionId);
      await backendClient.sendMessage(nextSessionId, content);
      setBackendStatus("connected");
    } catch (error) {
      closeEvents();
      streamBufferRef.current = "";
      setStreamingText("");
      setIsStreaming(false);
      setIsSending(false);
      setBackendStatus("unavailable");
      setErrorMessage(toUiErrorMessage(error, settingsRef.current.baseUrl));
    }
  };

  const handleCancel = async () => {
    if (!sessionId || isCancelling) return;
    setIsCancelling(true);
    try {
      await backendClient.cancelSession(sessionId);
      closeEvents();
      streamBufferRef.current = "";
      setStreamingText("");
      setIsStreaming(false);
      setIsSending(false);
      setErrorMessage("");
      setBackendStatus("connected");
    } catch (error) {
      setErrorMessage(toUiErrorMessage(error, settingsRef.current.baseUrl));
    } finally {
      setIsCancelling(false);
    }
  };

  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return index;
    }
    return -1;
  }, [messages]);

  const canSend = input.trim().length > 0 && !isSending && !isStreaming && !isCancelling;
  const canCancel = Boolean(sessionId) && (isSending || isStreaming) && !isCancelling;

  return (
    <main className="sidebar-shell" aria-label="Vibe-Trading Sidebar">
      <section className="hero-card" aria-labelledby="sidebar-title">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">V</span>
          <div>
            <p className="eyebrow">Vibe-Trading</p>
            <h1 id="sidebar-title">Research console</h1>
          </div>
        </div>
        <p className="hero-copy">
          Compact research chat for the local Vibe-Trading backend.
        </p>
      </section>

      <section className="status-card" aria-labelledby="status-title">
        <div className="section-heading">
          <h2 id="status-title">Backend</h2>
          <span data-testid="backend-status" className={`status-pill status-pill--${backendStatus}`} role="status">
            {statusLabels[backendStatus]}
          </span>
        </div>
        <form className="settings-form" onSubmit={handleSettingsSubmit} aria-label="Backend connection settings">
          <label>
            <span>Backend URL</span>
            <input
              value={baseUrlField}
              onChange={(event) => setBaseUrlField(event.target.value)}
              placeholder={DEFAULT_BACKEND_BASE_URL}
            />
          </label>
          <label>
            <span>Backend API key</span>
            <input
              type="password"
              value={backendApiKeyField}
              onChange={(event) => setBackendApiKeyField(event.target.value)}
              placeholder="Optional local API auth key"
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="secondary-button">Save</button>
        </form>
      </section>

      <section className="conversation-card" aria-labelledby="chat-title">
        <div className="section-heading">
          <h2 id="chat-title">Assistant</h2>
          <span className={`status-dot status-dot--${backendStatus}`} aria-hidden="true" />
        </div>
        <div className="message-list" aria-live="polite">
          {messages.length === 0 && !streamingText ? (
            <article data-testid="assistant-message" className="assistant-message">
              <span className="avatar" aria-hidden="true">P</span>
              <p>Ask a research question. The panel will create a session, open SSE, then stream the reply.</p>
            </article>
          ) : null}
          {messages.map((message, index) => (
            <article
              key={message.id}
              data-testid={message.role === "assistant" && index === latestAssistantIndex && !streamingText ? "assistant-message" : undefined}
              className={`message-bubble message-bubble--${message.role}`}
            >
              <span className="avatar" aria-hidden="true">{message.role === "user" ? "U" : "P"}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {streamingText ? (
            <article data-testid="assistant-message" className="message-bubble message-bubble--assistant is-streaming">
              <span className="avatar" aria-hidden="true">P</span>
              <p>{streamingText}</p>
            </article>
          ) : null}
        </div>
      </section>

      <form className="composer" aria-label="Chat composer" onSubmit={handleSend}>
        <label className="sr-only" htmlFor="chat-input">Message</label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isSending || isStreaming}
          rows={3}
          placeholder="Ask about a market, strategy, or research plan"
        />
        <div className="action-row">
          <button data-testid="cancel-button" type="button" className="secondary-button" disabled={!canCancel} onClick={handleCancel}>
            {isCancelling ? "Cancelling" : "Cancel"}
          </button>
          <button data-testid="send-button" type="submit" className="primary-button" disabled={!canSend}>
            {isSending || isStreaming ? "Sending" : "Send"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <div data-testid="error-banner" className="notice-banner" role="status" aria-live="polite">
          {errorMessage}
        </div>
      ) : (
        <div data-testid="error-banner" className="notice-banner notice-banner--quiet" role="status" aria-live="polite">
          Session chat uses backend credentials only. Provider keys stay on the backend.
        </div>
      )}
    </main>
  );
}
