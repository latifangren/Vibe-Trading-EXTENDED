export const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8899";

const BACKEND_BASE_URL_KEY = "vibe_trading_extension_backend_base_url";
const BACKEND_API_KEY_KEY = "vibe_trading_extension_backend_api_key";

export const ERROR_MESSAGES = {
  corsDenied: "Chrome extension origin is not allowed by CORS_ORIGINS",
  authDenied: "Backend API key missing or invalid",
  sseInterrupted: "Connection interrupted. Reconnect or retry.",
} as const;

export type BackendErrorCode =
  | "backend_unavailable"
  | "cors_denied"
  | "auth_denied"
  | "sse_interrupted"
  | "request_failed";

export interface BackendSettings {
  baseUrl: string;
  backendApiKey: string;
}

export interface SessionItem {
  session_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_attempt_id?: string | null;
}

export interface MessageItem {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  linked_attempt_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class BackendClientError extends Error {
  code: BackendErrorCode;
  status?: number;

  constructor(message: string, code: BackendErrorCode, status?: number) {
    super(message);
    this.name = "BackendClientError";
    this.code = code;
    this.status = status;
  }
}

let memorySettings: BackendSettings = {
  baseUrl: DEFAULT_BACKEND_BASE_URL,
  backendApiKey: "",
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BACKEND_BASE_URL;
}

function backendUnavailableMessage(baseUrl: string): string {
  return `Vibe-Trading backend is not running at ${baseUrl}. Start it with: vibe-trading serve --port 8899`;
}

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.local ?? null;
}

function getFromChromeStorage(keys: string[]): Promise<Record<string, unknown>> {
  const storage = chromeStorage();
  if (!storage) return Promise.resolve({});

  return new Promise((resolve) => {
    storage.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(items);
    });
  });
}

function setInChromeStorage(values: Record<string, string>): Promise<void> {
  const storage = chromeStorage();
  if (!storage) return Promise.resolve();

  return new Promise((resolve) => {
    storage.set(values, () => {
      resolve();
    });
  });
}

export async function getBackendSettings(): Promise<BackendSettings> {
  const storage = chromeStorage();
  if (!storage) return memorySettings;

  const items = await getFromChromeStorage([BACKEND_BASE_URL_KEY, BACKEND_API_KEY_KEY]);
  const baseUrl = typeof items[BACKEND_BASE_URL_KEY] === "string"
    ? normalizeBaseUrl(items[BACKEND_BASE_URL_KEY])
    : DEFAULT_BACKEND_BASE_URL;
  const backendApiKey = typeof items[BACKEND_API_KEY_KEY] === "string"
    ? items[BACKEND_API_KEY_KEY].trim()
    : "";

  memorySettings = { baseUrl, backendApiKey };
  return memorySettings;
}

export async function saveBackendSettings(settings: BackendSettings): Promise<BackendSettings> {
  const next = {
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    backendApiKey: settings.backendApiKey.trim(),
  };
  memorySettings = next;
  await setInChromeStorage({
    [BACKEND_BASE_URL_KEY]: next.baseUrl,
    [BACKEND_API_KEY_KEY]: next.backendApiKey,
  });
  return next;
}

async function readErrorDetail(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.message === "string") return body.message;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) return text.trim();
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function errorFromResponse(response: Response): Promise<BackendClientError> {
  const detail = await readErrorDetail(response);
  if (response.status === 401 || response.status === 403) {
    return new BackendClientError(ERROR_MESSAGES.authDenied, "auth_denied", response.status);
  }
  return new BackendClientError(detail, "request_failed", response.status);
}

async function backendReachableWithoutCors(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

async function errorFromTransport(error: unknown, baseUrl: string): Promise<BackendClientError> {
  const message = error instanceof Error ? error.message : String(error);
  if (/cors|cross-origin|access-control/i.test(message)) {
    return new BackendClientError(ERROR_MESSAGES.corsDenied, "cors_denied");
  }
  if (await backendReachableWithoutCors(baseUrl)) {
    return new BackendClientError(ERROR_MESSAGES.corsDenied, "cors_denied");
  }
  return new BackendClientError(backendUnavailableMessage(baseUrl), "backend_unavailable");
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const settings = await getBackendSettings();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.backendApiKey) {
    headers.Authorization = `Bearer ${settings.backendApiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    throw await errorFromTransport(error, settings.baseUrl);
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const text = await response.text();
  return text ? JSON.parse(text) as T : {} as T;
}

export function toUiErrorMessage(error: unknown, baseUrl = DEFAULT_BACKEND_BASE_URL): string {
  if (error instanceof BackendClientError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/cors|cross-origin|access-control/i.test(message)) return ERROR_MESSAGES.corsDenied;
  if (/401|403|unauthori[sz]ed|forbidden/i.test(message)) return ERROR_MESSAGES.authDenied;
  if (/eventsource|sse|interrupted/i.test(message)) return ERROR_MESSAGES.sseInterrupted;
  return backendUnavailableMessage(normalizeBaseUrl(baseUrl));
}

export const backendClient = {
  checkBackend: () => request<SessionItem[]>("/sessions"),
  createSession: (title: string) => request<SessionItem>("/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  }),
  sendMessage: (sessionId: string, content: string) => request<{ message_id: string; attempt_id: string }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: "POST", body: JSON.stringify({ content }) },
  ),
  getMessages: (sessionId: string) => request<MessageItem[]>(`/sessions/${encodeURIComponent(sessionId)}/messages`),
  cancelSession: (sessionId: string) => request<{ status: string }>(
    `/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST" },
  ),
  sessionEventsUrl: async (sessionId: string) => {
    const settings = await getBackendSettings();
    const url = new URL(`/sessions/${encodeURIComponent(sessionId)}/events`, settings.baseUrl);
    if (settings.backendApiKey) {
      url.searchParams.set("api_key", settings.backendApiKey);
    }
    return url.toString();
  },
};
