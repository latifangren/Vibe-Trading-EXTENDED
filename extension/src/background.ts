import {
  PAGE_TEXT_EXCERPT_LIMIT,
  SELECTED_TEXT_LIMIT,
  cleanTabText,
  extractPageContext,
  isUnsupportedTabUrl,
  getTabPermissionState,
  normalizeTabPermissionMode,
  tabCaptureInjectionErrorMessage,
  type GetPermissionStateRequest,
  type GetPermissionStateResponse,
  type CaptureCurrentTabRequest,
  type CaptureCurrentTabResponse,
  type PageExtractionResult,
  type TabCaptureErrorCode,
  type TabContext,
  type TabPermissionMode,
  type TabPermissionOriginPattern,
  type TabPermissionState,
  type CaptureVisibleChartRequest,
  type CaptureVisibleChartResponse,
} from "@/lib/tabContextShared";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Vibe-Trading sidebar setup failed", message);
  });

function isCaptureCurrentTabRequest(message: unknown): message is CaptureCurrentTabRequest {
  return Boolean(
    message
    && typeof message === "object"
    && "type" in message
    && message.type === "capture-current-tab",
  );
}

function isCaptureVisibleChartRequest(message: unknown): message is CaptureVisibleChartRequest {
  return Boolean(
    message
    && typeof message === "object"
    && "type" in message
    && message.type === "capture-visible-chart",
  );
}
function isGetPermissionStateRequest(message: unknown): message is GetPermissionStateRequest {
  return Boolean(
    message
    && typeof message === "object"
    && "type" in message
    && message.type === "get-permission-state",
  );
}

function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}

class TabCaptureError extends Error {
  constructor(
    message: string,
    readonly code: TabCaptureErrorCode,
  ) {
    super(message);
    this.name = "TabCaptureError";
  }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  const currentWindowTabs = await queryTabs({ active: true, currentWindow: true });
  if (currentWindowTabs[0]) return currentWindowTabs[0];

  const lastFocusedWindowTabs = await queryTabs({ active: true, lastFocusedWindow: true });
  return lastFocusedWindowTabs[0] ?? null;
}

function originPatternForTabUrl(url: string): TabPermissionOriginPattern | undefined {
  if (url.startsWith("http://")) return "http://*/*";
  if (url.startsWith("https://")) return "https://*/*";
  return undefined;
}

async function hasEnhancedHostAccess(originPattern: TabPermissionOriginPattern): Promise<boolean> {
  return await chrome.permissions.contains({ origins: [originPattern] });
}

async function getPermissionStateForActiveTab(preferredMode?: TabPermissionMode): Promise<TabPermissionState> {
  const storedState = await getTabPermissionState();
  const nextPreferredMode = preferredMode ?? storedState.preferredMode;
  const tab = await queryActiveTab();
  const url = tab?.url?.trim() ?? "";
  const originPattern = originPatternForTabUrl(url);
  const enhancedHostAccess = originPattern ? await hasEnhancedHostAccess(originPattern) : false;

  return {
    ...storedState,
    preferredMode: nextPreferredMode,
    mode: nextPreferredMode === "enhanced" && enhancedHostAccess ? "enhanced" : "safe",
    enhancedHostAccess,
    originPattern,
  };
}

async function captureCurrentTab(): Promise<TabContext> {
  const tab = await queryActiveTab();
  if (typeof tab?.id !== "number") {
    throw new TabCaptureError("No active browser tab found to attach.", "no-active-tab");
  }

  const url = tab.url?.trim() ?? "";
  if (!url) {
    throw new TabCaptureError("The active tab has no readable URL yet.", "empty-url");
  }
  if (isUnsupportedTabUrl(url)) {
    throw new TabCaptureError(
      "Chrome does not allow tab context on this page. Try a regular website tab.",
      "unsupported-url",
    );
  }

  let result: PageExtractionResult | undefined;
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContext,
      args: [PAGE_TEXT_EXCERPT_LIMIT, SELECTED_TEXT_LIMIT],
    });
    result = frames[0]?.result;
  } catch (error) {
    throw new TabCaptureError(tabCaptureInjectionErrorMessage(error), "script-injection-failed");
  }

  if (!result) {
    throw new TabCaptureError("Could not read content from this tab. You can still send normally.", "empty-capture-result");
  }

  return {
    title: result.title || cleanTabText(tab.title ?? "Untitled tab") || "Untitled tab",
    url,
    selectedText: result.selectedText,
    pageTextExcerpt: result.pageTextExcerpt,
    marketMetadata: result.marketMetadata,
  };
}

function captureErrorDetails(error: unknown): { message: string; code: TabCaptureErrorCode } {
  if (error instanceof TabCaptureError) return { message: error.message, code: error.code };
  const message = error instanceof Error ? error.message : String(error);
  return { message, code: "script-injection-failed" };
}

async function handleCaptureCurrentTab(request: CaptureCurrentTabRequest): Promise<CaptureCurrentTabResponse> {
  const preferredMode = typeof request.preferredMode === "string"
    ? normalizeTabPermissionMode(request.preferredMode)
    : undefined;
  let state: TabPermissionState;
  try {
    state = await getPermissionStateForActiveTab(preferredMode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackMode = preferredMode ?? "safe";
    return {
      ok: false,
      error: message,
      code: "script-injection-failed",
      mode: "safe",
      state: { mode: "safe", preferredMode: fallbackMode },
    };
  }

  try {
    const context = await captureCurrentTab();
    return { ok: true, context, mode: state.mode, state };
  } catch (error) {
    const details = captureErrorDetails(error);
    const fallbackWarning = state.preferredMode === "enhanced" && state.originPattern && !state.enhancedHostAccess
      ? "Enhanced site access is not enabled for this URL type, so Vibe-Trading tried safe tab capture instead."
      : undefined;
    return {
      ok: false,
      error: fallbackWarning ? `${fallbackWarning} ${details.message}` : details.message,
      code: details.code,
      mode: state.mode,
      state: fallbackWarning ? { ...state, warning: fallbackWarning } : state,
    };
  }
}

async function handleCaptureVisibleChart(): Promise<CaptureVisibleChartResponse> {
  const tab = await queryActiveTab();
  if (!tab) {
    return { ok: false, error: "No active browser tab found to capture." };
  }

  const url = tab.url?.trim() ?? "";
  if (!url || isUnsupportedTabUrl(url)) {
    return { ok: false, error: "Chrome does not allow chart screenshot capture on this page. Try a regular website tab." };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
    return {
      ok: true,
      screenshot: {
        dataUrl,
        mimeType: "image/jpeg",
        label: "visible chart screenshot",
        title: cleanTabText(tab.title ?? "Visible chart") || "Visible chart",
        url,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : chrome.runtime.lastError?.message ?? String(error);
    return {
      ok: false,
      error: `Could not capture the visible chart. Keep the chart tab active, then try again. Chrome error: ${message}`,
    };
  }
}
async function handleGetPermissionState(): Promise<GetPermissionStateResponse> {
  try {
    const state = await getPermissionStateForActiveTab();
    return { ok: true, state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isGetPermissionStateRequest(message)) {
    void Promise.resolve(handleGetPermissionState()).then(sendResponse);
    return true;
  }

  if (isCaptureVisibleChartRequest(message)) {
    void Promise.resolve(handleCaptureVisibleChart()).then(sendResponse);
    return true;
  }

  if (!isCaptureCurrentTabRequest(message)) return false;

  void handleCaptureCurrentTab(message).then(sendResponse);
  return true;
});
