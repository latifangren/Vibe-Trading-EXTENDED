import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BACKEND_BASE_URL,
  ERROR_MESSAGES,
  backendClient,
  getBackendSettings,
  saveBackendSettings,
  toUiErrorMessage,
  type BackendSettings,
  type ImageAttachmentPayload,
  type MessageItem,
} from "@/lib/backendClient";
import {
  DEFAULT_TAB_PERMISSION_STATE,
  captureCurrentTabContext,
  getCurrentTabPermissionState,
  formatTabContextPrompt,
  tabContextLabel,
  toTabContextWarning,
  type TabContext,
  type TabPermissionState,
} from "@/lib/tabContext";
import {
  captureVisibleChartScreenshot,
  chartScreenshotLabel,
  type ChartScreenshot,
} from "@/lib/chartVision";

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
  screenshot: ChartScreenshot | null,
  sendMessage: (sessionId: string, content: string, imageAttachments?: ImageAttachmentPayload[]) => Promise<unknown>,
  clearScreenshot: () => void,
): Promise<void> {
  const attachments = screenshot
    ? [{ data_url: screenshot.dataUrl, mime_type: screenshot.mimeType, label: screenshot.label }]
    : undefined;

  await sendMessage(sessionId, content, attachments);
  if (screenshot) clearScreenshot();
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
  const [tabContextEnabled, setTabContextEnabled] = useState(false);
  const [tabContext, setTabContext] = useState<TabContext | null>(null);
  const [tabContextWarning, setTabContextWarning] = useState("");
  const [tabPermissionState, setTabPermissionState] = useState<TabPermissionState>(DEFAULT_TAB_PERMISSION_STATE);
  const [isCapturingTabContext, setIsCapturingTabContext] = useState(false);
  const [chartScreenshot, setChartScreenshot] = useState<ChartScreenshot | null>(null);
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

  const refreshTabContext = useCallback(async (preferredMode = tabPermissionState.preferredMode): Promise<TabContext | null> => {
    setIsCapturingTabContext(true);
    setTabContextWarning("");
    try {
      const nextContext = await captureCurrentTabContext(preferredMode);
      setTabContext(nextContext);
      const nextState = await getCurrentTabPermissionState();
      setTabPermissionState(nextState);
      return nextContext;
    } catch (error) {
      setTabContext(null);
      if (error instanceof Error && "state" in error) {
        const state = (error as { state?: TabPermissionState }).state;
        if (state) setTabPermissionState(state);
      }
      setTabContextWarning(toTabContextWarning(error));
      return null;
    } finally {
      setIsCapturingTabContext(false);
    }
  }, [tabPermissionState.preferredMode]);

  const refreshTabPermissionState = useCallback(async () => {
    try {
      const state = await getCurrentTabPermissionState();
      setTabPermissionState(state);
      return state;
    } catch (error) {
      setTabContextWarning(toTabContextWarning(error));
      return DEFAULT_TAB_PERMISSION_STATE;
    }
  }, []);

  const handleTabContextToggle = async (checked: boolean) => {
    setTabContextEnabled(checked);
    setTabContextWarning("");
    if (checked) {
      await refreshTabPermissionState();
      await refreshTabContext();
    } else {
      setTabContext(null);
    }
  };


  const handleCaptureChartScreenshot = async () => {
    if (isCapturingChartScreenshot || isSending || isStreaming) return;
    setIsCapturingChartScreenshot(true);
    setChartScreenshotWarning("");
    try {
      setChartScreenshot(await captureVisibleChartScreenshot());
    } catch (error) {
      setChartScreenshot(null);
      setChartScreenshotWarning(error instanceof Error ? error.message : "Could not attach visible chart screenshot.");
    } finally {
      setIsCapturingChartScreenshot(false);
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
      let outboundContent = content;
      if (tabContextEnabled) {
        const attachedContext = await refreshTabContext();
        if (attachedContext) {
          outboundContent = formatTabContextPrompt(content, attachedContext);
        }
      }

      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const session = await backendClient.createSession(content.slice(0, 50));
        nextSessionId = session.session_id;
        setSessionId(nextSessionId);
        sessionIdRef.current = nextSessionId;
      }
      await connectSessionEvents(nextSessionId);
      await sendMessageWithChartScreenshot(
        nextSessionId,
        outboundContent,
        chartScreenshot,
        backendClient.sendMessage,
        () => {
          setChartScreenshot(null);
          setChartScreenshotWarning("");
        },
      );
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
  const tabContextSummary = tabContext ? tabContextLabel(tabContext) : "No tab attached";
  const chartScreenshotSummary = chartScreenshot ? chartScreenshotLabel(chartScreenshot) : "No chart screenshot attached";
  const localAccessStatus = tabPermissionState.enhancedHostAccess === false ? "Active tab fallback" : "Full local access active";

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

      <section className="tab-context-card" aria-labelledby="tab-context-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Optional</p>
            <h2 id="tab-context-title">Current tab context</h2>
          </div>
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={tabContextEnabled}
              onChange={(event) => void handleTabContextToggle(event.target.checked)}
              disabled={isSending || isStreaming || isCapturingTabContext}
            />
            <span>{tabContextEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        <p className="tab-context-copy">
          Attach title, URL, selected text, and a short cleaned page excerpt to the next prompt.
        </p>
        <div className="permission-mode-panel" role="status" aria-live="polite">
          <div className="permission-mode-heading">
            <span>Local page access</span>
            <span>{localAccessStatus}</span>
          </div>
          <p className="permission-mode-copy">
            This unpacked local extension requests http/https host access in the manifest. It can read the active page text and capture the visible tab image after you accept Chrome's install-time permission prompt.
          </p>
          <p className="permission-mode-copy">
            Automation remains future-only: no click, type, navigation, debugger, or webNavigation control is wired here.
          </p>
        </div>
        <div className="tab-context-attachment" aria-live="polite">
          <span className={`status-dot ${tabContext ? "status-dot--connected" : ""}`} aria-hidden="true" />
          <span>{tabContextSummary}</span>
        </div>
        {tabContextWarning ? (
          <p className="tab-context-warning" role="status">{tabContextWarning}</p>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          disabled={!tabContextEnabled || isSending || isStreaming || isCapturingTabContext}
          onClick={() => void refreshTabContext()}
        >
          {isCapturingTabContext ? "Refreshing" : "Refresh tab"}
        </button>
      </section>


      <section className="tab-context-card" aria-labelledby="chart-vision-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vision</p>
            <h2 id="chart-vision-title">Visible chart screenshot</h2>
          </div>
        </div>
        <p className="tab-context-copy">
          Attach the visible tab image so the backend vision model can inspect candles, drawings, and indicators.
          Screenshots may include balances, watchlists, or account details visible on the page.
        </p>
        <div className="tab-context-attachment" aria-live="polite">
          <span className={`status-dot ${chartScreenshot ? "status-dot--connected" : ""}`} aria-hidden="true" />
          <span>{chartScreenshotSummary}</span>
        </div>
        {chartScreenshotWarning ? (
          <p className="tab-context-warning" role="status">{chartScreenshotWarning}</p>
        ) : null}
        <div className="action-row">
          <button
            type="button"
            className="secondary-button"
            disabled={isSending || isStreaming || isCapturingChartScreenshot}
            onClick={() => void handleCaptureChartScreenshot()}
          >
            {isCapturingChartScreenshot ? "Capturing" : "Attach visible chart"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!chartScreenshot || isSending || isStreaming || isCapturingChartScreenshot}
            onClick={() => {
              setChartScreenshot(null);
              setChartScreenshotWarning("");
            }}
          >
            Clear chart
          </button>
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
