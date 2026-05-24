import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BACKEND_BASE_URL,
  ERROR_MESSAGES,
  BackendClientError,
  backendClient,
  getBackendSettings,
  saveBackendSettings,
  toUiErrorMessage,
  type BackendSettings,
  type ImageAttachmentPayload,
  type MessageItem,
  type SessionItem,
} from "@/lib/backendClient";
import {
  DEFAULT_TAB_PERMISSION_STATE,
  getCurrentTabPermissionState,
  tabContextLabel,
  toTabContextWarning,
  type TabContext,
} from "@/lib/tabContext";
import { isChartLikePage } from "@/lib/chartVision";
import {
  clearActiveSidepanelSessionId,
  getActiveSidepanelSessionId,
  saveActiveSidepanelSessionId,
} from "@/lib/sessionContinuity";
import { prepareOutboundMessage } from "@/sidepanel/sendPreparation";

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
      content: item.role === "user" ? stripTabContextPrompt(item.content) : item.content,
    }));
}

function stripTabContextPrompt(content: string): string {
  const marker = "\n\nUser question:\n";
  const markerIndex = content.lastIndexOf(marker);
  return markerIndex >= 0 ? content.slice(markerIndex + marker.length) : content;
}

export async function sendMessageWithChartScreenshot(
  sessionId: string,
  content: string,
  imageAttachments: ImageAttachmentPayload[] | undefined,
  sendMessage: (sessionId: string, content: string, imageAttachments?: ImageAttachmentPayload[]) => Promise<unknown>,
): Promise<void> {
  await sendMessage(sessionId, content, imageAttachments);
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
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [tabContext, setTabContext] = useState<TabContext | null>(null);
  const [tabContextWarning, setTabContextWarning] = useState("");
  const [, setTabPermissionState] = useState(DEFAULT_TAB_PERMISSION_STATE);
  const [isCapturingTabContext, setIsCapturingTabContext] = useState(false);
  const [chartScreenshotWarning, setChartScreenshotWarning] = useState("");
  const [isCapturingChartScreenshot, setIsCapturingChartScreenshot] = useState(false);

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

  const restoreStoredSession = useCallback(async () => {
    const storedSessionId = await getActiveSidepanelSessionId();
    if (!storedSessionId) return;

    try {
      const storedMessages = await backendClient.getMessages(storedSessionId);
      setSessionId(storedSessionId);
      sessionIdRef.current = storedSessionId;
      setMessages(fromBackendMessages(storedMessages));
      setBackendStatus("connected");
    } catch (error) {
      if (error instanceof BackendClientError && error.status === 404) {
        await clearActiveSidepanelSessionId();
        setSessionId(null);
        sessionIdRef.current = null;
        setMessages([]);
      }
    }
  }, []);

  const refreshBackendStatus = useCallback(async () => {
    setBackendStatus("checking");
    try {
      const sessions = await backendClient.checkBackend();
      setRecentSessions(sessions.slice(0, 8));
      setBackendStatus("connected");
      setErrorMessage("");
      return true;
    } catch (error) {
      setBackendStatus("unavailable");
      setErrorMessage(toUiErrorMessage(error, settingsRef.current.baseUrl));
      return false;
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
      void refreshBackendStatus().then((isConnected) => {
        if (isConnected) void restoreStoredSession();
      });
    });
    return () => {
      alive = false;
      closeEvents();
    };
  }, [closeEvents, refreshBackendStatus, restoreStoredSession]);

  useEffect(() => {
    let alive = true;
    getCurrentTabPermissionState()
      .then((state) => {
        if (!alive) return;
        setTabPermissionState(state);
      })
      .catch((error) => {
        if (!alive) return;
        setTabContextWarning(toTabContextWarning(error));
      });
    return () => {
      alive = false;
    };
  }, []);

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

  const handleNewChat = async () => {
    await clearActiveSidepanelSessionId();
    closeEvents();
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setInput("");
    setStreamingText("");
    streamBufferRef.current = "";
    setErrorMessage("");
    setTabContext(null);
    setTabContextWarning("");
    setChartScreenshotWarning("");
    setIsSending(false);
    setIsStreaming(false);
  };

  const handleSessionSelect = async (nextSessionId: string) => {
    if (!nextSessionId || nextSessionId === sessionId || isSending || isStreaming) return;
    closeEvents();
    streamBufferRef.current = "";
    setStreamingText("");
    setErrorMessage("");
    setInput("");
    setTabContext(null);
    setTabContextWarning("");
    setChartScreenshotWarning("");

    try {
      const storedMessages = await backendClient.getMessages(nextSessionId);
      setSessionId(nextSessionId);
      sessionIdRef.current = nextSessionId;
      setMessages(fromBackendMessages(storedMessages));
      await saveActiveSidepanelSessionId(nextSessionId);
      setBackendStatus("connected");
    } catch (error) {
      setBackendStatus("unavailable");
      setErrorMessage(toUiErrorMessage(error, settingsRef.current.baseUrl));
    }
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
      setIsCapturingTabContext(true);
      setIsCapturingChartScreenshot(true);
      const preparedMessage = await prepareOutboundMessage(content);
      setTabContext(preparedMessage.tabContext);
      setTabContextWarning(preparedMessage.tabContextWarning);
      setChartScreenshotWarning(preparedMessage.chartScreenshotWarning);
      try {
        const nextState = await getCurrentTabPermissionState();
        setTabPermissionState(nextState);
      } catch (error) {
        if (!preparedMessage.tabContextWarning) setTabContextWarning(toTabContextWarning(error));
      } finally {
        setIsCapturingTabContext(false);
        setIsCapturingChartScreenshot(false);
      }

      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const session = await backendClient.createSession(content.slice(0, 50));
        nextSessionId = session.session_id;
        setSessionId(nextSessionId);
        sessionIdRef.current = nextSessionId;
        setRecentSessions((current) => [
          session,
          ...current.filter((item) => item.session_id !== session.session_id),
        ].slice(0, 8));
        await saveActiveSidepanelSessionId(nextSessionId);
      }
      await connectSessionEvents(nextSessionId);
      await sendMessageWithChartScreenshot(
        nextSessionId,
        preparedMessage.content,
        preparedMessage.imageAttachments,
        backendClient.sendMessage,
      );
      setBackendStatus("connected");
    } catch (error) {
      closeEvents();
      streamBufferRef.current = "";
      setStreamingText("");
      setIsStreaming(false);
      setIsSending(false);
      setIsCapturingTabContext(false);
      setIsCapturingChartScreenshot(false);
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
  const sessionLabel = sessionId ? `Session ${sessionId.slice(0, 8)}` : "New chat";
  const tabContextSummary = tabContext ? tabContextLabel(tabContext) : "Auto tab ready";
  const chartVisionSummary = tabContext && isChartLikePage(tabContext) ? "Auto vision on" : "Auto vision when chart";

  return (
    <main className="sidebar-shell" aria-label="Vibe-Trading Sidebar">
      <header className="sidepanel-header">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">V</span>
          <div className="brand-copy">
            <p className="eyebrow">Vibe-Trading</p>
            <h1 id="sidebar-title">Research chat</h1>
          </div>
        </div>
        <div className="header-actions">
          <span data-testid="backend-status" className={`status-pill status-pill--${backendStatus}`} role="status">
            {statusLabels[backendStatus]}
          </span>
          <span className="session-pill">{sessionLabel}</span>
          {recentSessions.length ? (
            <select
              className="session-select"
              aria-label="Recent sessions"
              value={sessionId ?? ""}
              disabled={isSending || isStreaming}
              onChange={(event) => void handleSessionSelect(event.target.value)}
            >
              <option value="">Recent sessions</option>
              {recentSessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>
                  {session.title || session.session_id}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="secondary-button secondary-button--compact" onClick={() => void handleNewChat()}>
            New chat
          </button>
        </div>
      </header>

      <div className="auto-chip-row" aria-live="polite">
        <span className={`auto-chip ${tabContext ? "auto-chip--active" : ""}`}>
          <span className="status-dot status-dot--connected" aria-hidden="true" />
          <span>{isCapturingTabContext ? "Auto tab reading" : tabContextSummary}</span>
        </span>
        <span className={`auto-chip ${tabContext && isChartLikePage(tabContext) ? "auto-chip--active" : ""}`}>
          <span className={`status-dot ${isCapturingChartScreenshot ? "" : "status-dot--connected"}`} aria-hidden="true" />
          <span>{isCapturingChartScreenshot ? "Auto vision checking" : chartVisionSummary}</span>
        </span>
      </div>

      <details className="settings-details">
        <summary>
          <span>Backend settings</span>
          <span>Provider keys stay backend-only</span>
        </summary>
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
      </details>

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
        {tabContextWarning || chartScreenshotWarning ? (
          <div className="compact-warning" role="status">
            {tabContextWarning || chartScreenshotWarning}
          </div>
        ) : null}
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
