import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/background";
import {
  type CaptureVisibleChartRequest,
  type CaptureVisibleChartResponse,
  PAGE_TEXT_EXCERPT_LIMIT,
  SELECTED_TEXT_LIMIT,
  type CaptureCurrentTabRequest,
  type CaptureCurrentTabResponse,
  type GetPermissionStateRequest,
  type GetPermissionStateResponse,
} from "@/lib/tabContextShared";

const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]?.[0];

function activeTab(url = "https://example.com/report", title = "Report"): chrome.tabs.Tab {
  return {
    id: 42,
    index: 0,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    windowId: 1,
    url,
    title,
  };
}

function mockActiveTab(tab: chrome.tabs.Tab | null): void {
  vi.mocked(chrome.tabs.query).mockImplementation((_queryInfo, callback) => {
    callback(tab ? [tab] : []);
  });
}

function mockCaptureResult(title = "Captured report"): void {
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
    {
      frameId: 0,
      result: {
        title,
        selectedText: "Selected",
        pageTextExcerpt: "Page body",
      },
    },
  ]);
}

async function sendBackgroundMessage(message: CaptureCurrentTabRequest): Promise<CaptureCurrentTabResponse>;
async function sendBackgroundMessage(message: GetPermissionStateRequest): Promise<GetPermissionStateResponse>;
async function sendBackgroundMessage(message: CaptureVisibleChartRequest): Promise<CaptureVisibleChartResponse>;
async function sendBackgroundMessage(
  message: CaptureCurrentTabRequest | GetPermissionStateRequest | CaptureVisibleChartRequest,
): Promise<CaptureCurrentTabResponse | GetPermissionStateResponse | CaptureVisibleChartResponse> {
  if (!messageListener) throw new Error("Background message listener was not registered.");

  return await new Promise((resolve) => {
    const keepAlive = messageListener(message, {}, resolve);
    expect(keepAlive).toBe(true);
  });
}

describe("extension test harness", () => {
  beforeEach(() => {
    mockActiveTab(activeTab());
    vi.mocked(chrome.permissions.contains).mockResolvedValue(false);
    mockCaptureResult();
  });

  it("installs Chrome mock and loads background setup", () => {
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it("declares all URLs host access for visible tab capture", () => {
    const manifestJson = readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8").replace(/^\uFEFF/, "");
    const manifest = JSON.parse(manifestJson) as {
      host_permissions?: string[];
    };

    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  it("captures with safe mode by default", async () => {
    const response = await sendBackgroundMessage({ type: "capture-current-tab" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.mode).toBe("safe");
    expect(response.state).toMatchObject({
      mode: "safe",
      preferredMode: "safe",
      enhancedHostAccess: false,
      originPattern: "https://*/*",
    });
    expect(response.context).toMatchObject({
      title: "Captured report",
      url: "https://example.com/report",
      selectedText: "Selected",
      pageTextExcerpt: "Page body",
    });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ["https://*/*"] });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: expect.any(Function),
      args: [PAGE_TEXT_EXCERPT_LIMIT, SELECTED_TEXT_LIMIT],
    });
  });

  it("captures in enhanced mode when host access is granted", async () => {
    vi.mocked(chrome.permissions.contains).mockResolvedValue(true);

    const response = await sendBackgroundMessage({ type: "capture-current-tab", preferredMode: "enhanced" });

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("enhanced");
    expect(response.state).toMatchObject({
      mode: "enhanced",
      preferredMode: "enhanced",
      enhancedHostAccess: true,
      originPattern: "https://*/*",
    });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ["https://*/*"] });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it("falls back to safe capture when enhanced host access is not granted", async () => {
    const response = await sendBackgroundMessage({ type: "capture-current-tab", preferredMode: "enhanced" });

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("safe");
    expect(response.state).toMatchObject({
      mode: "safe",
      preferredMode: "enhanced",
      enhancedHostAccess: false,
      originPattern: "https://*/*",
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it("returns fallback warning when enhanced fallback capture fails", async () => {
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error("Cannot access contents of the page"));

    const response = await sendBackgroundMessage({ type: "capture-current-tab", preferredMode: "enhanced" });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected capture failure.");
    expect(response.mode).toBe("safe");
    expect(response.code).toBe("script-injection-failed");
    expect(response.error).toContain("Enhanced site access is not enabled for this URL type");
    expect(response.error).toContain("Chrome does not allow tab context on this page");
    expect(response.state.warning).toContain("tried safe tab capture instead");
  });

  it("reports unsupported tab URLs without checking host permissions", async () => {
    mockActiveTab(activeTab("chrome://extensions", "Extensions"));

    const response = await sendBackgroundMessage({ type: "capture-current-tab", preferredMode: "enhanced" });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected unsupported URL failure.");
    expect(response.code).toBe("unsupported-url");
    expect(response.mode).toBe("safe");
    expect(response.state.originPattern).toBeUndefined();
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("returns friendly error when executeScript fails in safe mode", async () => {
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error("Frame was removed."));

    const response = await sendBackgroundMessage({ type: "capture-current-tab" });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected executeScript failure.");
    expect(response.code).toBe("script-injection-failed");
    expect(response.error).toBe("Could not capture this tab. You can still send the message without browser context.");
  });

  it("handles permission state requests for current http URL", async () => {
    mockActiveTab(activeTab("http://example.com/report", "Report"));
    vi.mocked(chrome.permissions.contains).mockResolvedValue(true);

    const response = await sendBackgroundMessage({ type: "get-permission-state" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.state).toMatchObject({
      mode: "safe",
      preferredMode: "safe",
      enhancedHostAccess: true,
      originPattern: "http://*/*",
    });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ["http://*/*"] });
  });


  it("captures a visible chart screenshot", async () => {
    const response = await sendBackgroundMessage({ type: "capture-visible-chart" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.screenshot.dataUrl).toBe("data:image/jpeg;base64,QUJD");
    expect(response.screenshot.mimeType).toBe("image/jpeg");
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: "jpeg", quality: 80 });
  });

  it("surfaces the Chrome captureVisibleTab failure reason", async () => {
    vi.mocked(chrome.tabs.captureVisibleTab).mockRejectedValue(new Error("Either the '<all_urls>' or 'activeTab' permission is required."));

    const response = await sendBackgroundMessage({ type: "capture-visible-chart" });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected visible chart capture failure.");
    expect(response.error).toContain("Could not capture the visible chart. Keep the chart tab active");
    expect(response.error).toContain("Either the '<all_urls>' or 'activeTab' permission is required.");
  });
  it("does not request permissions in background", async () => {
    await sendBackgroundMessage({ type: "capture-current-tab", preferredMode: "enhanced" });
    await sendBackgroundMessage({ type: "get-permission-state" });

    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });
});

