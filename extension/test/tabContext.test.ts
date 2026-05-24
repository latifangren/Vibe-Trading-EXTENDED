import { describe, expect, it, vi } from "vitest";
import {
  ENHANCED_TAB_PERMISSION_ORIGINS,
  captureCurrentTabContext,
  getCurrentTabPermissionState,
  savePreferredTabPermissionMode,
} from "@/lib/tabContext";
import { captureVisibleChartScreenshot } from "@/lib/chartVision";
import { TAB_PERMISSION_MODE_STORAGE_KEY } from "@/lib/tabContextShared";

describe("tab context sidepanel helpers", () => {
  it("loads permission state from background", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      ok: true,
      state: { mode: "safe", preferredMode: "enhanced", enhancedHostAccess: false },
    });

    await expect(getCurrentTabPermissionState()).resolves.toMatchObject({
      mode: "safe",
      preferredMode: "enhanced",
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "get-permission-state" });
  });

  it("saves preferred mode before refreshing background state", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      ok: true,
      state: { mode: "enhanced", preferredMode: "enhanced", enhancedHostAccess: true },
    });

    await expect(savePreferredTabPermissionMode("enhanced")).resolves.toMatchObject({
      mode: "enhanced",
      preferredMode: "enhanced",
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { [TAB_PERMISSION_MODE_STORAGE_KEY]: "enhanced" },
      expect.any(Function),
    );
  });

  it("passes preferred mode to capture-current-tab", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      ok: true,
      context: {
        title: "Report",
        url: "https://example.com/report",
        selectedText: "",
        pageTextExcerpt: "Body",
      },
      mode: "enhanced",
      state: { mode: "enhanced", preferredMode: "enhanced" },
    });

    await expect(captureCurrentTabContext("enhanced")).resolves.toMatchObject({ title: "Report" });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "capture-current-tab",
      preferredMode: "enhanced",
    });
  });


  it("requests visible chart screenshot from background", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      ok: true,
      screenshot: {
        dataUrl: "data:image/jpeg;base64,QUJD",
        mimeType: "image/jpeg",
        label: "visible chart screenshot",
        title: "Chart",
        url: "https://example.com/chart",
        capturedAt: "2026-05-24T00:00:00.000Z",
      },
    });

    await expect(captureVisibleChartScreenshot()).resolves.toMatchObject({ title: "Chart" });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "capture-visible-chart" });
  });
  it("defines exact optional origins for direct button permission request", () => {
    expect(ENHANCED_TAB_PERMISSION_ORIGINS).toEqual(["http://*/*", "https://*/*"]);
  });
});

